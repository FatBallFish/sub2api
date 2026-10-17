package service

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/ent/user"
	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
	"github.com/imroc/req/v3"
	"golang.org/x/crypto/bcrypt"
)

// OIDCUserSyncService 在用户账密登录/改密时把账号同步到 Keycloak（Admin REST API）。
// 仅当系统设置「登录/改密时自动同步到 OIDC」（oidc_user_sync_enabled）开启且配置完整时工作。
//
// 三个入口（均应异步调用，不阻塞主流程）：
//   - SyncLogin：账密登录成功 → 建号（不存在）/补密（无密码 credential）；已有密码不覆盖
//   - SyncPasswordChange：本站改密/重置成功 → reset-password 双写 + 刷新快照
//   - CheckDrift：OIDC 登录成功 → 对比 Keycloak credential createdDate 与快照，标记漂移
type OIDCUserSyncService struct {
	settingSvc *SettingService
	entClient  *dbent.Client

	mu         sync.Mutex
	token      string
	tokenExpAt time.Time
}

func NewOIDCUserSyncService(settingService *SettingService, entClient *dbent.Client) *OIDCUserSyncService {
	return &OIDCUserSyncService{settingSvc: settingService, entClient: entClient}
}

type oidcUserSyncConfig struct {
	AdminURL     string
	Realm        string
	ClientID     string
	ClientSecret string
}

func (s *OIDCUserSyncService) config(ctx context.Context) (*oidcUserSyncConfig, error) {
	if s == nil || s.settingSvc == nil {
		return nil, fmt.Errorf("oidc user sync service not ready")
	}
	if !s.settingSvc.IsOIDCUserSyncEnabled(ctx) {
		return nil, fmt.Errorf("oidc user sync disabled")
	}
	settings, err := s.settingSvc.settingRepo.GetMultiple(ctx, []string{
		SettingKeyOIDCUserSyncAdminURL,
		SettingKeyOIDCUserSyncRealm,
		SettingKeyOIDCUserSyncClientID,
		SettingKeyOIDCUserSyncClientSecret,
	})
	if err != nil {
		return nil, fmt.Errorf("load oidc user sync settings: %w", err)
	}
	cfg := &oidcUserSyncConfig{
		AdminURL:     strings.TrimRight(strings.TrimSpace(settings[SettingKeyOIDCUserSyncAdminURL]), "/"),
		Realm:        strings.TrimSpace(settings[SettingKeyOIDCUserSyncRealm]),
		ClientID:     strings.TrimSpace(settings[SettingKeyOIDCUserSyncClientID]),
		ClientSecret: strings.TrimSpace(settings[SettingKeyOIDCUserSyncClientSecret]),
	}
	if cfg.AdminURL == "" || cfg.Realm == "" || cfg.ClientID == "" || cfg.ClientSecret == "" {
		return nil, fmt.Errorf("oidc user sync config incomplete")
	}
	return cfg, nil
}

func (s *OIDCUserSyncService) adminToken(ctx context.Context, cfg *oidcUserSyncConfig) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.token != "" && time.Now().Before(s.tokenExpAt) {
		return s.token, nil
	}
	var result struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	resp, err := req.C().SetTimeout(10 * time.Second).R().SetContext(ctx).
		SetFormData(map[string]string{
			"grant_type":    "client_credentials",
			"client_id":     cfg.ClientID,
			"client_secret": cfg.ClientSecret,
		}).
		SetSuccessResult(&result).
		Post(cfg.AdminURL + "/realms/" + cfg.Realm + "/protocol/openid-connect/token")
	if err != nil {
		return "", fmt.Errorf("request admin token: %w", err)
	}
	if !resp.IsSuccessState() || result.AccessToken == "" {
		return "", fmt.Errorf("admin token: status=%d body=%s", resp.StatusCode, truncateSyncLog(resp.String(), 256))
	}
	s.token = result.AccessToken
	s.tokenExpAt = time.Now().Add(time.Duration(result.ExpiresIn-30) * time.Second)
	return s.token, nil
}

func (s *OIDCUserSyncService) adminURL(cfg *oidcUserSyncConfig, path string) string {
	return cfg.AdminURL + "/admin/realms/" + cfg.Realm + path
}

// oidcSyncUserOrigin 同步建号时写入 Keycloak 用户属性 origin 的固定值，
// 标识该账号源自 Mikiko CC（sub2api）注册。改密双写只对该属性匹配的用户生效。
const oidcSyncUserOrigin = "mikikocc"

// keycloakUserSummary findKeycloakUser 的查询结果。
type keycloakUserSummary struct {
	ID string
	// HasPassword 是否已有密码 credential。
	HasPassword bool
	// Origin 用户属性 origin 的值（多值取第一个）；未配置为空。
	Origin string
}

// findKeycloakUser 按邮箱精确查询 Keycloak 用户；不存在时 ID 为空。
func (s *OIDCUserSyncService) findKeycloakUser(ctx context.Context, cfg *oidcUserSyncConfig, email string) (keycloakUserSummary, error) {
	token, err := s.adminToken(ctx, cfg)
	if err != nil {
		return keycloakUserSummary{}, err
	}
	type kcUser struct {
		ID         string         `json:"id"`
		Attributes map[string]any `json:"attributes"`
	}
	var users []kcUser
	resp, err := req.C().SetTimeout(10*time.Second).R().SetContext(ctx).
		SetHeader("Authorization", "Bearer "+token).
		SetSuccessResult(&users).
		Get(s.adminURL(cfg, "/users?email="+queryEscape(email)+"&exact=true"))
	if err != nil {
		return keycloakUserSummary{}, fmt.Errorf("query keycloak users: %w", err)
	}
	if !resp.IsSuccessState() {
		return keycloakUserSummary{}, fmt.Errorf("query keycloak users: status=%d", resp.StatusCode)
	}
	if len(users) == 0 {
		return keycloakUserSummary{}, nil
	}
	found := users[0]
	createdAt, err := s.passwordCredentialCreatedAt(ctx, cfg, found.ID)
	if err != nil {
		return keycloakUserSummary{}, err
	}
	origin := strings.TrimSpace(firstAttributeString(found.Attributes["origin"]))
	return keycloakUserSummary{ID: found.ID, HasPassword: createdAt != nil, Origin: origin}, nil
}

// firstAttributeString 归一化 Keycloak 属性值：单值字符串或字符串数组均取第一个。
func firstAttributeString(v any) string {
	switch typed := v.(type) {
	case string:
		return typed
	case []any:
		if len(typed) > 0 {
			if s, ok := typed[0].(string); ok {
				return s
			}
		}
	}
	return ""
}

type kcCredential struct {
	Type        string `json:"type"`
	CreatedDate int64  `json:"createdDate"`
}

// passwordCredentialCreatedAt 返回 password credential 的 createdDate（epoch ms）；无密码返回 nil。
func (s *OIDCUserSyncService) passwordCredentialCreatedAt(ctx context.Context, cfg *oidcUserSyncConfig, userID string) (*int64, error) {
	token, err := s.adminToken(ctx, cfg)
	if err != nil {
		return nil, err
	}
	var creds []kcCredential
	resp, err := req.C().SetTimeout(10*time.Second).R().SetContext(ctx).
		SetHeader("Authorization", "Bearer "+token).
		SetSuccessResult(&creds).
		Get(s.adminURL(cfg, "/users/"+userID+"/credentials"))
	if err != nil {
		return nil, fmt.Errorf("list credentials: %w", err)
	}
	if !resp.IsSuccessState() {
		return nil, fmt.Errorf("list credentials: status=%d", resp.StatusCode)
	}
	for _, c := range creds {
		if c.Type == "password" && c.CreatedDate > 0 {
			createdAt := c.CreatedDate
			return &createdAt, nil
		}
	}
	return nil, nil
}

// createKeycloakUser 创建 Keycloak 用户；origin 非空时写入用户属性 origin（注册来源标识）。
func (s *OIDCUserSyncService) createKeycloakUser(ctx context.Context, cfg *oidcUserSyncConfig, email, origin string) (string, error) {
	token, err := s.adminToken(ctx, cfg)
	if err != nil {
		return "", err
	}
	// Keycloak 24+ 默认 user-profile 将 firstName/lastName 设为必填，
	// 缺失会导致账号无法完成登录（"Account is not fully set up"）。
	emailName := email
	if idx := strings.Index(email, "@"); idx > 0 {
		emailName = email[:idx]
	}
	body := map[string]any{
		"username":      email,
		"email":         email,
		"enabled":       true,
		"emailVerified": true,
		"firstName":     emailName,
		"lastName":      "sub2api",
	}
	if origin != "" {
		// origin 为单值属性（非多值数组），与 Keycloak 用户字段的配置保持一致。
		body["attributes"] = map[string]string{"origin": origin}
	}
	resp, err := req.C().SetTimeout(10*time.Second).R().SetContext(ctx).
		SetHeader("Authorization", "Bearer "+token).
		SetBody(body).
		Post(s.adminURL(cfg, "/users"))
	if err != nil {
		return "", fmt.Errorf("create keycloak user: %w", err)
	}
	if resp.StatusCode != 201 {
		return "", fmt.Errorf("create keycloak user: status=%d body=%s", resp.StatusCode, truncateSyncLog(resp.String(), 256))
	}
	location := resp.Header.Get("Location")
	if idx := strings.LastIndex(location, "/"); idx >= 0 {
		return location[idx+1:], nil
	}
	// 兜底：按邮箱再查一次
	found, err := s.findKeycloakUser(ctx, cfg, email)
	return found.ID, err
}

func (s *OIDCUserSyncService) resetPassword(ctx context.Context, cfg *oidcUserSyncConfig, userID, password string) error {
	token, err := s.adminToken(ctx, cfg)
	if err != nil {
		return err
	}
	resp, err := req.C().SetTimeout(10*time.Second).R().SetContext(ctx).
		SetHeader("Authorization", "Bearer "+token).
		SetBody(map[string]any{"type": "password", "value": password, "temporary": false}).
		Put(s.adminURL(cfg, "/users/"+userID+"/reset-password"))
	if err != nil {
		return fmt.Errorf("reset keycloak password: %w", err)
	}
	if !resp.IsSuccessState() {
		return fmt.Errorf("reset keycloak password: status=%d body=%s", resp.StatusCode, truncateSyncLog(resp.String(), 256))
	}
	return nil
}

func syncLog(reason string, err error) {
	logger.LegacyPrintf("service.oidc_sync", "[OIDC UserSync] skip: %s: %v", reason, err)
}

// localUserID 按邮箱查本地用户 ID（同步落库用）。
func (s *OIDCUserSyncService) localUserID(ctx context.Context, email string) int64 {
	if s.entClient == nil {
		return 0
	}
	id, err := s.entClient.User.Query().Where(user.EmailEqualFold(email)).OnlyID(ctx)
	if err != nil {
		return 0
	}
	return id
}

// SyncLogin 账密登录成功后的触发式同步：建号/补密（不覆盖已有密码）。
func (s *OIDCUserSyncService) SyncLogin(ctx context.Context, email, password string) {
	if !s.syncableUser(email) || password == "" {
		return
	}
	userID := s.localUserID(ctx, email)
	if userID == 0 {
		return
	}
	cfg, err := s.config(ctx)
	if err != nil {
		syncLog("not configured", err)
		return
	}
	found, err := s.findKeycloakUser(ctx, cfg, email)
	if err != nil {
		syncLog("lookup failed", err)
		return
	}
	kcID := found.ID
	if kcID == "" {
		kcID, err = s.createKeycloakUser(ctx, cfg, email, oidcSyncUserOrigin)
		if err != nil {
			syncLog("create user failed", err)
			return
		}
	}
	if !found.HasPassword {
		if err := s.resetPassword(ctx, cfg, kcID, password); err != nil {
			syncLog("backfill password failed", err)
			return
		}
	}
	// 快照当前 credential 时间戳（无论是否补写）
	var snap *int64
	if createdAt, err := s.passwordCredentialCreatedAt(ctx, cfg, kcID); err == nil {
		snap = createdAt
	}
	s.recordSyncResult(ctx, userID, snap, false)
}

// SyncLoginWithoutPassword 触发式同步的轻量形态：仅在 Keycloak 侧不存在该用户时
// 建号（携带 origin 标识），不写入密码——供 GitHub/Google 等其他三方登录联动建号，
// 密码留给用户后续自行设置。
func (s *OIDCUserSyncService) SyncLoginWithoutPassword(ctx context.Context, email string) {
	if !s.syncableUser(email) {
		return
	}
	userID := s.localUserID(ctx, email)
	if userID == 0 {
		return
	}
	cfg, err := s.config(ctx)
	if err != nil {
		syncLog("not configured", err)
		return
	}
	found, err := s.findKeycloakUser(ctx, cfg, email)
	if err != nil {
		syncLog("lookup failed", err)
		return
	}
	kcID := found.ID
	if kcID == "" {
		kcID, err = s.createKeycloakUser(ctx, cfg, email, oidcSyncUserOrigin)
		if err != nil {
			syncLog("create user failed", err)
			return
		}
	}
	var snap *int64
	if createdAt, err := s.passwordCredentialCreatedAt(ctx, cfg, kcID); err == nil {
		snap = createdAt
	}
	s.recordSyncResult(ctx, userID, snap, false)
}

// SyncPasswordChange 本站改密/重置成功后的双写：覆盖 Keycloak 密码并刷新快照。
// 仅当 Keycloak 侧用户的 origin 属性为 mikikocc（即由本站同步创建的账号）时才推送；
// 用户不存在、无 origin 或值不一致时跳过，不动本地同步标记。
func (s *OIDCUserSyncService) SyncPasswordChange(ctx context.Context, email, newPassword string) {
	if !s.syncableUser(email) || newPassword == "" {
		return
	}
	userID := s.localUserID(ctx, email)
	if userID == 0 {
		return
	}
	cfg, err := s.config(ctx)
	if err != nil {
		syncLog("not configured", err)
		return
	}
	found, err := s.findKeycloakUser(ctx, cfg, email)
	if err != nil {
		syncLog("lookup failed", err)
		return
	}
	if found.ID == "" {
		syncLog("origin gate", fmt.Errorf("keycloak user not found, skip password push"))
		return
	}
	if found.Origin != oidcSyncUserOrigin {
		syncLog("origin gate", fmt.Errorf("origin=%q, want %q, skip password push", found.Origin, oidcSyncUserOrigin))
		return
	}
	if err := s.resetPassword(ctx, cfg, found.ID, newPassword); err != nil {
		// 本地密码已改、远端失败 → 置 drift，下次登录由提示引导收敛
		syncLog("push password failed", err)
		s.recordSyncResult(ctx, userID, nil, true)
		return
	}
	var snap *int64
	if createdAt, err := s.passwordCredentialCreatedAt(ctx, cfg, found.ID); err == nil {
		snap = createdAt
	}
	s.recordSyncResult(ctx, userID, snap, false)
}

// CheckDrift OIDC 登录成功后对比 Keycloak credential 时间戳与本地快照。
func (s *OIDCUserSyncService) CheckDrift(ctx context.Context, email string) {
	if !s.syncableUser(email) {
		return
	}
	userID := s.localUserID(ctx, email)
	if userID == 0 {
		return
	}
	cfg, err := s.config(ctx)
	if err != nil {
		return
	}
	local, err := s.entClient.User.Query().Where(user.IDEQ(userID)).Only(ctx)
	if err != nil || local.OidcPasswordCredAt == nil {
		return // 从未同步过，无需 drift 检测
	}
	found, err := s.findKeycloakUser(ctx, cfg, email)
	if err != nil || found.ID == "" {
		return
	}
	createdAt, err := s.passwordCredentialCreatedAt(ctx, cfg, found.ID)
	if err != nil || createdAt == nil {
		return
	}
	drift := *createdAt != *local.OidcPasswordCredAt
	if drift == local.OidcPasswordDrift {
		return
	}
	update := s.entClient.User.UpdateOneID(userID).SetOidcPasswordDrift(drift)
	if drift && local.OidcPasswordDrift == false {
		// Keycloak 侧密码比快照新：本地旧密码已不可信，立即作废
		// （写入随机哈希，用户需经 OIDC 登录后在控制台重置，重置会双写回
		// Keycloak 并刷新快照，drift 随之解除）。
		if randomPassword, randErr := randomHexString(32); randErr == nil {
			if hashed, hashErr := HashPasswordBcrypt(randomPassword); hashErr == nil {
				update = update.SetPasswordHash(hashed)
			}
		}
	}
	if _, err := update.Save(ctx); err != nil {
		syncLog("update drift flag failed", err)
	}
}

// syncableUser 排除合成邮箱（无真实邮箱的 OAuth 用户无从同步）。
func (s *OIDCUserSyncService) syncableUser(email string) bool {
	email = strings.TrimSpace(strings.ToLower(email))
	if email == "" || strings.Contains(email, " ") {
		return false
	}
	for _, suffix := range []string{
		OIDCConnectSyntheticEmailDomain, LinuxDoConnectSyntheticEmailDomain,
		WeChatConnectSyntheticEmailDomain, DingTalkConnectSyntheticEmailDomain,
	} {
		if strings.HasSuffix(email, suffix) {
			return false
		}
	}
	return true
}

// recordSyncResult 落库 synced_at / 快照 / drift（snap==nil 且 markDrift 时只置 drift）。
func (s *OIDCUserSyncService) recordSyncResult(ctx context.Context, userID int64, snap *int64, markDrift bool) {
	if s.entClient == nil || userID <= 0 {
		return
	}
	update := s.entClient.User.UpdateOneID(userID).SetOidcSyncedAt(time.Now())
	if snap != nil {
		update = update.SetOidcPasswordCredAt(*snap)
	}
	update = update.SetOidcPasswordDrift(markDrift)
	if _, err := update.Save(ctx); err != nil {
		syncLog("record sync result failed", err)
	}
}

func truncateSyncLog(body string, max int) string {
	if len(body) <= max {
		return body
	}
	return body[:max] + "..."
}

// HashPasswordBcrypt 包级 bcrypt 加密（OIDCUserSyncService 不依赖 AuthService）。
func HashPasswordBcrypt(password string) (string, error) {
	hashedBytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hashedBytes), nil
}

func queryEscape(v string) string { return url.QueryEscape(v) }
