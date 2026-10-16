package handler

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/internal/config"
	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"github.com/Wei-Shaw/sub2api/internal/pkg/oauth"
	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	"github.com/Wei-Shaw/sub2api/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/imroc/req/v3"
	"github.com/tidwall/gjson"
)

const (
	oidcOAuthCookiePath         = "/api/v1/auth/oauth/oidc"
	oidcOAuthStateCookieName    = "oidc_oauth_state"
	oidcOAuthVerifierCookie     = "oidc_oauth_verifier"
	oidcOAuthRedirectCookie     = "oidc_oauth_redirect"
	oidcOAuthNonceCookie        = "oidc_oauth_nonce"
	oidcOAuthIntentCookieName   = "oidc_oauth_intent"
	oidcOAuthBindUserCookieName = "oidc_oauth_bind_user"
	// 用户可能在 IdP 侧停留很久（注册、找回密码、2FA），10 分钟过紧导致回调时
	// state cookie 已过期（invalid_state）；放宽到 60 分钟。
	oidcOAuthCookieMaxAgeSec   = 60 * 60
	oidcOAuthDefaultRedirectTo = "/dashboard"
	oidcOAuthDefaultFrontendCB = "/auth/oidc/callback"
)

// oidcRouteVariant 描述一个 OIDC 登录入口（老前端或新前端 console）。
// 两个变体各自持有独立的 cookie 命名空间与配置解析入口，避免跨域回调时
// state/verifier cookie 串扰。
type oidcRouteVariant struct {
	cookiePath        string
	stateCookie       string
	verifierCookie    string
	redirectCookie    string
	nonceCookie       string
	intentCookie      string
	bindUserCookie    string
	defaultRedirectTo string
	config            func(ctx context.Context) (config.OIDCConnectConfig, error)
}

func (h *AuthHandler) oidcMainRouteVariant() oidcRouteVariant {
	return oidcRouteVariant{
		cookiePath:        oidcOAuthCookiePath,
		stateCookie:       oidcOAuthStateCookieName,
		verifierCookie:    oidcOAuthVerifierCookie,
		redirectCookie:    oidcOAuthRedirectCookie,
		nonceCookie:       oidcOAuthNonceCookie,
		intentCookie:      oidcOAuthIntentCookieName,
		bindUserCookie:    oidcOAuthBindUserCookieName,
		defaultRedirectTo: oidcOAuthDefaultRedirectTo,
		config:            h.getOIDCOAuthConfig,
	}
}

func (h *AuthHandler) oidcConsoleRouteVariant() oidcRouteVariant {
	return oidcRouteVariant{
		cookiePath:        "/api/v1/auth/oauth/oidc-console",
		stateCookie:       "oidc_oauth_console_state",
		verifierCookie:    "oidc_oauth_console_verifier",
		redirectCookie:    "oidc_oauth_console_redirect",
		nonceCookie:       "oidc_oauth_console_nonce",
		intentCookie:      "oidc_oauth_console_intent",
		bindUserCookie:    "oidc_oauth_console_bind_user",
		defaultRedirectTo: "/console",
		config:            h.getOIDCConsoleOAuthConfig,
	}
}

func (h *AuthHandler) getOIDCConsoleOAuthConfig(ctx context.Context) (config.OIDCConnectConfig, error) {
	if h != nil && h.settingSvc != nil {
		return h.settingSvc.GetOIDCConnectConsoleOAuthConfig(ctx)
	}
	return config.OIDCConnectConfig{}, infraerrors.NotFound("OAUTH_DISABLED", "oauth login is disabled")
}

type oidcTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in"`
	RefreshToken string `json:"refresh_token,omitempty"`
	Scope        string `json:"scope,omitempty"`
	IDToken      string `json:"id_token,omitempty"`
}

type oidcTokenExchangeError struct {
	StatusCode          int
	ProviderError       string
	ProviderDescription string
	Body                string
}

func (e *oidcTokenExchangeError) Error() string {
	if e == nil {
		return ""
	}
	parts := []string{fmt.Sprintf("token exchange status=%d", e.StatusCode)}
	if strings.TrimSpace(e.ProviderError) != "" {
		parts = append(parts, "error="+strings.TrimSpace(e.ProviderError))
	}
	if strings.TrimSpace(e.ProviderDescription) != "" {
		parts = append(parts, "error_description="+strings.TrimSpace(e.ProviderDescription))
	}
	return strings.Join(parts, " ")
}

type oidcIDTokenClaims struct {
	Email             string `json:"email,omitempty"`
	EmailVerified     *bool  `json:"email_verified,omitempty"`
	PreferredUsername string `json:"preferred_username,omitempty"`
	Name              string `json:"name,omitempty"`
	Nonce             string `json:"nonce,omitempty"`
	Azp               string `json:"azp,omitempty"`
	jwt.RegisteredClaims
}

type oidcUserInfoClaims struct {
	Email         string
	Username      string
	Subject       string
	EmailVerified *bool
	DisplayName   string
	AvatarURL     string
}

type oidcJWKSet struct {
	Keys []oidcJWK `json:"keys"`
}

type oidcJWK struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	Alg string `json:"alg"`

	N string `json:"n"`
	E string `json:"e"`

	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
}

// OIDCOAuthStart 启动通用 OIDC OAuth 登录流程（老前端入口）。
// GET /api/v1/auth/oauth/oidc/start?redirect=/dashboard
func (h *AuthHandler) OIDCOAuthStart(c *gin.Context) {
	h.oidcOAuthStart(c, h.oidcMainRouteVariant())
}

// OIDCOAuthConsoleStart 启动新前端（console）的 OIDC 登录流程。
// GET /api/v1/auth/oauth/oidc-console/start?redirect=/console
func (h *AuthHandler) OIDCOAuthConsoleStart(c *gin.Context) {
	h.oidcOAuthStart(c, h.oidcConsoleRouteVariant())
}

func (h *AuthHandler) oidcOAuthStart(c *gin.Context, v oidcRouteVariant) {
	if !h.requireActionCaptchaForOAuthLoginStart(c) {
		return
	}
	cfg, err := v.config(c.Request.Context())
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	state, err := oauth.GenerateState()
	if err != nil {
		response.ErrorFrom(c, infraerrors.InternalServer("OAUTH_STATE_GEN_FAILED", "failed to generate oauth state").WithCause(err))
		return
	}

	redirectTo := sanitizeFrontendRedirectPath(c.Query("redirect"))
	if redirectTo == "" {
		redirectTo = v.defaultRedirectTo
	}

	browserSessionKey, err := generateOAuthPendingBrowserSession()
	if err != nil {
		response.ErrorFrom(c, infraerrors.InternalServer("OAUTH_BROWSER_SESSION_GEN_FAILED", "failed to generate oauth browser session").WithCause(err))
		return
	}

	secureCookie := isRequestHTTPS(c)
	oidcSetCookie(c, v.cookiePath, v.stateCookie, encodeCookieValue(state), oidcOAuthCookieMaxAgeSec, secureCookie)
	oidcSetCookie(c, v.cookiePath, v.redirectCookie, encodeCookieValue(redirectTo), oidcOAuthCookieMaxAgeSec, secureCookie)
	intent := normalizeOAuthIntent(c.Query("intent"))
	oidcSetCookie(c, v.cookiePath, v.intentCookie, encodeCookieValue(intent), oidcOAuthCookieMaxAgeSec, secureCookie)
	captureOAuthPromoCode(c, secureCookie)
	setOAuthPendingBrowserCookie(c, browserSessionKey, secureCookie)
	clearOAuthPendingSessionCookie(c, secureCookie)
	if intent == oauthIntentBindCurrentUser {
		bindCookieValue, err := h.buildOAuthBindUserCookieFromContext(c)
		if err != nil {
			response.ErrorFrom(c, err)
			return
		}
		oidcSetCookie(c, v.cookiePath, v.bindUserCookie, encodeCookieValue(bindCookieValue), oidcOAuthCookieMaxAgeSec, secureCookie)
	} else {
		oidcClearCookie(c, v.cookiePath, v.bindUserCookie, secureCookie)
	}

	codeChallenge := ""
	if cfg.UsePKCE {
		verifier, genErr := oauth.GenerateCodeVerifier()
		if genErr != nil {
			response.ErrorFrom(c, infraerrors.InternalServer("OAUTH_PKCE_GEN_FAILED", "failed to generate pkce verifier").WithCause(genErr))
			return
		}
		codeChallenge = oauth.GenerateCodeChallenge(verifier)
		oidcSetCookie(c, v.cookiePath, v.verifierCookie, encodeCookieValue(verifier), oidcOAuthCookieMaxAgeSec, secureCookie)
	}

	nonce := ""
	if cfg.ValidateIDToken {
		nonce, err = oauth.GenerateState()
		if err != nil {
			response.ErrorFrom(c, infraerrors.InternalServer("OAUTH_NONCE_GEN_FAILED", "failed to generate oauth nonce").WithCause(err))
			return
		}
		oidcSetCookie(c, v.cookiePath, v.nonceCookie, encodeCookieValue(nonce), oidcOAuthCookieMaxAgeSec, secureCookie)
	}

	redirectURI := strings.TrimSpace(cfg.RedirectURL)
	if redirectURI == "" {
		response.ErrorFrom(c, infraerrors.InternalServer("OAUTH_CONFIG_INVALID", "oauth redirect url not configured"))
		return
	}

	authURL, err := buildOIDCAuthorizeURL(cfg, state, nonce, codeChallenge, redirectURI)
	if err != nil {
		response.ErrorFrom(c, infraerrors.InternalServer("OAUTH_BUILD_URL_FAILED", "failed to build oauth authorization url").WithCause(err))
		return
	}

	respondOAuthStart(c, authURL)
}

// OIDCOAuthCallback 处理 OIDC 回调：校验 id_token、创建/登录用户并重定向到前端（老前端入口）。
// GET /api/v1/auth/oauth/oidc/callback?code=...&state=...
func (h *AuthHandler) OIDCOAuthCallback(c *gin.Context) {
	h.oidcOAuthCallback(c, h.oidcMainRouteVariant())
}

// OIDCOAuthConsoleCallback 处理新前端（console）的 OIDC 回调。
// GET /api/v1/auth/oauth/oidc-console/callback?code=...&state=...
func (h *AuthHandler) OIDCOAuthConsoleCallback(c *gin.Context) {
	h.oidcOAuthCallback(c, h.oidcConsoleRouteVariant())
}

func (h *AuthHandler) oidcOAuthCallback(c *gin.Context, v oidcRouteVariant) {
	cfg, cfgErr := v.config(c.Request.Context())
	if cfgErr != nil {
		response.ErrorFrom(c, cfgErr)
		return
	}

	frontendCallback := strings.TrimSpace(cfg.FrontendRedirectURL)
	if frontendCallback == "" {
		frontendCallback = oidcOAuthDefaultFrontendCB
	}

	if providerErr := strings.TrimSpace(c.Query("error")); providerErr != "" {
		redirectOAuthError(c, frontendCallback, "provider_error", providerErr, c.Query("error_description"))
		return
	}

	code := strings.TrimSpace(c.Query("code"))
	state := strings.TrimSpace(c.Query("state"))
	if code == "" || state == "" {
		redirectOAuthError(c, frontendCallback, "missing_params", "missing code/state", "")
		return
	}

	secureCookie := isRequestHTTPS(c)
	defer func() {
		oidcClearCookie(c, v.cookiePath, v.stateCookie, secureCookie)
		oidcClearCookie(c, v.cookiePath, v.verifierCookie, secureCookie)
		oidcClearCookie(c, v.cookiePath, v.redirectCookie, secureCookie)
		oidcClearCookie(c, v.cookiePath, v.nonceCookie, secureCookie)
		oidcClearCookie(c, v.cookiePath, v.intentCookie, secureCookie)
		oidcClearCookie(c, v.cookiePath, v.bindUserCookie, secureCookie)
		clearOAuthPromoCodeCookie(c, secureCookie)
	}()

	expectedState, err := readCookieDecoded(c, v.stateCookie)
	if err != nil || expectedState == "" || state != expectedState {
		redirectOAuthError(c, frontendCallback, "invalid_state", "invalid oauth state", "")
		return
	}

	redirectTo, _ := readCookieDecoded(c, v.redirectCookie)
	redirectTo = sanitizeFrontendRedirectPath(redirectTo)
	if redirectTo == "" {
		redirectTo = v.defaultRedirectTo
	}
	browserSessionKey, _ := readOAuthPendingBrowserCookie(c)
	if strings.TrimSpace(browserSessionKey) == "" {
		redirectOAuthError(c, frontendCallback, "missing_browser_session", "missing oauth browser session", "")
		return
	}
	intent, _ := readCookieDecoded(c, v.intentCookie)
	intent = normalizeOAuthIntent(intent)

	codeVerifier := ""
	if cfg.UsePKCE {
		codeVerifier, _ = readCookieDecoded(c, v.verifierCookie)
		if codeVerifier == "" {
			redirectOAuthError(c, frontendCallback, "missing_verifier", "missing pkce verifier", "")
			return
		}
	}

	expectedNonce := ""
	if cfg.ValidateIDToken {
		expectedNonce, _ = readCookieDecoded(c, v.nonceCookie)
		if expectedNonce == "" {
			redirectOAuthError(c, frontendCallback, "missing_nonce", "missing oauth nonce", "")
			return
		}
	}

	redirectURI := strings.TrimSpace(cfg.RedirectURL)
	if redirectURI == "" {
		redirectOAuthError(c, frontendCallback, "config_error", "oauth redirect url not configured", "")
		return
	}

	tokenResp, err := oidcExchangeCode(c.Request.Context(), cfg, code, redirectURI, codeVerifier)
	if err != nil {
		description := ""
		var exchangeErr *oidcTokenExchangeError
		if errors.As(err, &exchangeErr) && exchangeErr != nil {
			log.Printf(
				"[OIDC OAuth] token exchange failed: status=%d provider_error=%q provider_description=%q body=%s",
				exchangeErr.StatusCode,
				exchangeErr.ProviderError,
				exchangeErr.ProviderDescription,
				truncateLogValue(exchangeErr.Body, 2048),
			)
			description = exchangeErr.Error()
		} else {
			log.Printf("[OIDC OAuth] token exchange failed: %v", err)
			description = err.Error()
		}
		redirectOAuthError(c, frontendCallback, "token_exchange_failed", "failed to exchange oauth code", singleLine(description))
		return
	}

	var idClaims *oidcIDTokenClaims
	if cfg.ValidateIDToken {
		if strings.TrimSpace(tokenResp.IDToken) == "" {
			redirectOAuthError(c, frontendCallback, "missing_id_token", "missing id_token", "")
			return
		}

		idClaims, err = oidcParseAndValidateIDToken(c.Request.Context(), cfg, tokenResp.IDToken, expectedNonce)
		if err != nil {
			log.Printf("[OIDC OAuth] id_token validation failed: %v", err)
			redirectOAuthError(c, frontendCallback, "invalid_id_token", "failed to validate id_token", "")
			return
		}
	}

	userInfoClaims, err := oidcFetchUserInfo(c.Request.Context(), cfg, tokenResp)
	if err != nil {
		log.Printf("[OIDC OAuth] userinfo fetch failed: %v", err)
		redirectOAuthError(c, frontendCallback, "userinfo_failed", "failed to fetch user info", "")
		return
	}

	subject := ""
	if idClaims != nil {
		subject = strings.TrimSpace(idClaims.Subject)
	}
	if subject == "" {
		subject = strings.TrimSpace(userInfoClaims.Subject)
	}
	if subject == "" {
		redirectOAuthError(c, frontendCallback, "missing_subject", "missing subject claim", "")
		return
	}
	issuer := ""
	if idClaims != nil {
		issuer = strings.TrimSpace(idClaims.Issuer)
	}
	if issuer == "" {
		issuer = strings.TrimSpace(cfg.IssuerURL)
	}
	if issuer == "" {
		redirectOAuthError(c, frontendCallback, "missing_issuer", "missing issuer claim", "")
		return
	}

	emailVerified := userInfoClaims.EmailVerified
	if emailVerified == nil && idClaims != nil {
		emailVerified = idClaims.EmailVerified
	}
	if idClaims != nil && userInfoClaims.Subject != "" && idClaims.Subject != "" && strings.TrimSpace(userInfoClaims.Subject) != strings.TrimSpace(idClaims.Subject) {
		redirectOAuthError(c, frontendCallback, "subject_mismatch", "userinfo subject does not match id_token", "")
		return
	}

	identityKey := oidcIdentityKey(issuer, subject)
	compatEmail := strings.TrimSpace(userInfoClaims.Email)
	if compatEmail == "" && idClaims != nil {
		compatEmail = strings.TrimSpace(idClaims.Email)
	}
	email := oidcSyntheticEmailFromIdentityKey(identityKey)
	username := firstNonEmpty(
		userInfoClaims.Username,
		func() string {
			if idClaims != nil {
				return idClaims.PreferredUsername
			}
			return ""
		}(),
		func() string {
			if idClaims != nil {
				return idClaims.Name
			}
			return ""
		}(),
		oidcFallbackUsername(subject),
	)
	identityRef := service.PendingAuthIdentityKey{
		ProviderType:    "oidc",
		ProviderKey:     issuer,
		ProviderSubject: subject,
	}
	upstreamClaims := map[string]any{
		"email":             email,
		"username":          username,
		"subject":           subject,
		"issuer":            issuer,
		"email_verified":    emailVerified != nil && *emailVerified,
		"provider_fallback": strings.TrimSpace(cfg.ProviderName),
		"suggested_display_name": firstNonEmpty(userInfoClaims.DisplayName, func() string {
			if idClaims != nil {
				return idClaims.Name
			}
			return ""
		}(), username),
		"suggested_avatar_url": userInfoClaims.AvatarURL,
	}
	if compatEmail != "" && !strings.EqualFold(strings.TrimSpace(compatEmail), strings.TrimSpace(email)) {
		upstreamClaims["compat_email"] = compatEmail
	}
	if intent == oauthIntentBindCurrentUser {
		targetUserID, err := h.readOAuthBindUserIDFromCookie(c, v.bindUserCookie)
		if err != nil {
			redirectOAuthError(c, frontendCallback, "invalid_state", "invalid oauth bind target", "")
			return
		}
		if err := h.createOAuthPendingSession(c, oauthPendingSessionPayload{
			Intent:                 oauthIntentBindCurrentUser,
			Identity:               identityRef,
			TargetUserID:           &targetUserID,
			ResolvedEmail:          email,
			RedirectTo:             redirectTo,
			BrowserSessionKey:      browserSessionKey,
			UpstreamIdentityClaims: upstreamClaims,
			CompletionResponse: map[string]any{
				"redirect": redirectTo,
			},
		}); err != nil {
			redirectOAuthError(c, frontendCallback, "session_error", "failed to continue oauth bind", "")
			return
		}
		redirectToFrontendCallback(c, frontendCallback)
		return
	}

	existingIdentityUser, err := h.findOAuthIdentityUser(c.Request.Context(), identityRef)
	if err != nil {
		redirectOAuthError(c, frontendCallback, "session_error", infraerrors.Reason(err), infraerrors.Message(err))
		return
	}
	if existingIdentityUser != nil {
		if err := h.createOAuthPendingSession(c, oauthPendingSessionPayload{
			Intent:                 oauthIntentLogin,
			Identity:               identityRef,
			TargetUserID:           &existingIdentityUser.ID,
			ResolvedEmail:          existingIdentityUser.Email,
			RedirectTo:             redirectTo,
			BrowserSessionKey:      browserSessionKey,
			UpstreamIdentityClaims: upstreamClaims,
			CompletionResponse: map[string]any{
				"redirect": redirectTo,
			},
		}); err != nil {
			redirectOAuthError(c, frontendCallback, "session_error", "failed to continue oauth login", "")
			return
		}
		redirectToFrontendCallback(c, frontendCallback)
		return
	}

	compatEmailUser, err := h.findOIDCCompatEmailUser(c.Request.Context(), compatEmail)
	if err != nil {
		redirectOAuthError(c, frontendCallback, "session_error", infraerrors.Reason(err), infraerrors.Message(err))
		return
	}

	if cfg.RequireEmailVerified {
		if emailVerified == nil || !*emailVerified {
			redirectOAuthError(c, frontendCallback, "email_not_verified", "email is not verified", "")
			return
		}
	}

	// 快捷路径：当上游返回已验证邮箱、部署不要求额外确认且本地没有同邮箱账号时，
	// 直接信任上游身份完成注册/登录，避免展示 choice 页。
	if compatEmailUser == nil &&
		strings.TrimSpace(compatEmail) != "" &&
		emailVerified != nil && *emailVerified {
		if handled := h.tryOIDCVerifiedEmailFastPath(
			c,
			frontendCallback,
			redirectTo,
			identityRef,
			compatEmail,
			username,
			upstreamClaims,
		); handled {
			return
		}
	}

	if h.isForceEmailOnThirdPartySignup(c.Request.Context()) {
		if err := h.createOIDCOAuthChoicePendingSession(
			c,
			identityRef,
			email,
			email,
			redirectTo,
			browserSessionKey,
			upstreamClaims,
			compatEmail,
			compatEmailUser,
			true,
		); err != nil {
			redirectOAuthError(c, frontendCallback, "session_error", "failed to continue oauth login", "")
			return
		}
		redirectToFrontendCallback(c, frontendCallback)
		return
	}

	if err := h.createOIDCOAuthChoicePendingSession(
		c,
		identityRef,
		email,
		email,
		redirectTo,
		browserSessionKey,
		upstreamClaims,
		compatEmail,
		compatEmailUser,
		h.isForceEmailOnThirdPartySignup(c.Request.Context()),
	); err != nil {
		redirectOAuthError(c, frontendCallback, "session_error", "failed to continue oauth login", "")
		return
	}
	redirectToFrontendCallback(c, frontendCallback)
}

func (h *AuthHandler) findOIDCCompatEmailUser(ctx context.Context, email string) (*dbent.User, error) {
	client := h.entClient()
	if client == nil {
		return nil, infraerrors.ServiceUnavailable("PENDING_AUTH_NOT_READY", "pending auth service is not ready")
	}

	email = strings.TrimSpace(strings.ToLower(email))
	if email == "" ||
		strings.HasSuffix(email, service.LinuxDoConnectSyntheticEmailDomain) ||
		strings.HasSuffix(email, service.OIDCConnectSyntheticEmailDomain) ||
		strings.HasSuffix(email, service.WeChatConnectSyntheticEmailDomain) ||
		strings.HasSuffix(email, service.DingTalkConnectSyntheticEmailDomain) {
		return nil, nil
	}

	userEntity, err := findUserByNormalizedEmail(ctx, client, email)
	if err != nil {
		if errors.Is(err, service.ErrUserNotFound) {
			return nil, nil
		}
		return nil, infraerrors.InternalServer("COMPAT_EMAIL_LOOKUP_FAILED", "failed to look up compat email user").WithCause(err)
	}
	return userEntity, nil
}

func (h *AuthHandler) createOIDCOAuthChoicePendingSession(
	c *gin.Context,
	identity service.PendingAuthIdentityKey,
	suggestedEmail string,
	resolvedEmail string,
	redirectTo string,
	browserSessionKey string,
	upstreamClaims map[string]any,
	compatEmail string,
	compatEmailUser *dbent.User,
	forceEmailOnSignup bool,
) error {
	suggestionEmail := strings.TrimSpace(suggestedEmail)
	canonicalEmail := strings.TrimSpace(resolvedEmail)
	if suggestionEmail == "" {
		suggestionEmail = canonicalEmail
	}

	completionResponse := map[string]any{
		"step":                      oauthPendingChoiceStep,
		"adoption_required":         true,
		"redirect":                  strings.TrimSpace(redirectTo),
		"email":                     suggestionEmail,
		"resolved_email":            canonicalEmail,
		"existing_account_email":    "",
		"existing_account_bindable": false,
		"create_account_allowed":    h.oauthCreateAccountAllowed(c.Request.Context()),
		"force_email_on_signup":     forceEmailOnSignup,
		"choice_reason":             "third_party_signup",
		// pending 建号端点（RegisterOAuthEmailAccount）恒要求本地邮箱验证码，
		// 与全局 email_verify_enabled 无关；显式告知前端渲染验证码输入。
		"email_verification_required": true,
	}
	if strings.TrimSpace(compatEmail) != "" {
		completionResponse["compat_email"] = strings.TrimSpace(compatEmail)
	}
	if compatEmailUser != nil {
		completionResponse["email"] = strings.TrimSpace(compatEmailUser.Email)
		completionResponse["existing_account_email"] = strings.TrimSpace(compatEmailUser.Email)
		completionResponse["existing_account_bindable"] = true
		completionResponse["choice_reason"] = "compat_email_match"
	}
	if forceEmailOnSignup && compatEmailUser == nil {
		completionResponse["choice_reason"] = "force_email_on_signup"
	}

	resolvedChoiceEmail := suggestionEmail
	if compatEmailUser != nil {
		resolvedChoiceEmail = strings.TrimSpace(compatEmailUser.Email)
	}
	var targetUserID *int64
	if compatEmailUser != nil && compatEmailUser.ID > 0 {
		targetUserID = &compatEmailUser.ID
	}

	return h.createOAuthPendingSession(c, oauthPendingSessionPayload{
		Intent:                 oauthIntentLogin,
		Identity:               identity,
		TargetUserID:           targetUserID,
		ResolvedEmail:          resolvedChoiceEmail,
		RedirectTo:             redirectTo,
		BrowserSessionKey:      browserSessionKey,
		UpstreamIdentityClaims: upstreamClaims,
		CompletionResponse:     completionResponse,
	})
}

type completeOIDCOAuthRequest struct {
	InvitationCode   string `json:"invitation_code" binding:"required"`
	AffCode          string `json:"aff_code,omitempty"`
	AdoptDisplayName *bool  `json:"adopt_display_name,omitempty"`
	AdoptAvatar      *bool  `json:"adopt_avatar,omitempty"`
}

// CompleteOIDCOAuthRegistration completes a pending OAuth registration by validating
// the invitation code and creating the user account.
// POST /api/v1/auth/oauth/oidc/complete-registration
func (h *AuthHandler) CompleteOIDCOAuthRegistration(c *gin.Context) {
	var req completeOIDCOAuthRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "INVALID_REQUEST", "message": err.Error()})
		return
	}

	secureCookie := isRequestHTTPS(c)
	sessionToken, err := readOAuthPendingSessionCookie(c)
	if err != nil {
		clearOAuthPendingSessionCookie(c, secureCookie)
		clearOAuthPendingBrowserCookie(c, secureCookie)
		response.ErrorFrom(c, service.ErrPendingAuthSessionNotFound)
		return
	}
	browserSessionKey, err := readOAuthPendingBrowserCookie(c)
	if err != nil {
		clearOAuthPendingSessionCookie(c, secureCookie)
		clearOAuthPendingBrowserCookie(c, secureCookie)
		response.ErrorFrom(c, service.ErrPendingAuthBrowserMismatch)
		return
	}
	pendingSvc, err := h.pendingIdentityService()
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	session, err := pendingSvc.GetBrowserSession(c.Request.Context(), sessionToken, browserSessionKey)
	if err != nil {
		clearOAuthPendingSessionCookie(c, secureCookie)
		clearOAuthPendingBrowserCookie(c, secureCookie)
		response.ErrorFrom(c, err)
		return
	}
	if err := ensurePendingOAuthCompleteRegistrationSession(session); err != nil {
		response.ErrorFrom(c, err)
		return
	}
	if updatedSession, handled, err := h.legacyCompleteRegistrationSessionStatus(c, session); err != nil {
		response.ErrorFrom(c, err)
		return
	} else if handled {
		c.JSON(http.StatusOK, buildPendingOAuthSessionStatusPayload(updatedSession))
		return
	} else {
		session = updatedSession
	}
	if err := h.ensureBackendModeAllowsNewUserLogin(c.Request.Context()); err != nil {
		response.ErrorFrom(c, err)
		return
	}

	email := strings.TrimSpace(session.ResolvedEmail)
	username := pendingSessionStringValue(session.UpstreamIdentityClaims, "username")
	if email == "" || username == "" {
		response.ErrorFrom(c, infraerrors.BadRequest("PENDING_AUTH_SESSION_INVALID", "pending auth registration context is invalid"))
		return
	}

	client := h.entClient()
	if client == nil {
		response.ErrorFrom(c, infraerrors.ServiceUnavailable("PENDING_AUTH_NOT_READY", "pending auth service is not ready"))
		return
	}
	if err := ensurePendingOAuthRegistrationIdentityAvailable(c.Request.Context(), client, session); err != nil {
		respondPendingOAuthBindingApplyError(c, err)
		return
	}
	decision, err := h.ensurePendingOAuthAdoptionDecision(c, session.ID, oauthAdoptionDecisionRequest{
		AdoptDisplayName: req.AdoptDisplayName,
		AdoptAvatar:      req.AdoptAvatar,
	})
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	tokenPair, user, err := h.authService.LoginOrRegisterOAuthWithTokenPairAndPromoCode(
		c.Request.Context(),
		email,
		username,
		req.InvitationCode,
		req.AffCode,
		pendingOAuthPromoCode(session),
		"oidc",
	)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	if err := applyPendingOAuthAdoptionAndConsumeSession(c.Request.Context(), client, h.authService, h.userService, session, decision, user.ID); err != nil {
		respondPendingOAuthBindingApplyError(c, err)
		return
	}
	h.authService.RecordSuccessfulLogin(c.Request.Context(), user.ID)
	clearOAuthPendingSessionCookie(c, secureCookie)
	clearOAuthPendingBrowserCookie(c, secureCookie)

	c.JSON(http.StatusOK, gin.H{
		"access_token":  tokenPair.AccessToken,
		"refresh_token": tokenPair.RefreshToken,
		"expires_in":    tokenPair.ExpiresIn,
		"token_type":    "Bearer",
	})
}

func (h *AuthHandler) getOIDCOAuthConfig(ctx context.Context) (config.OIDCConnectConfig, error) {
	if h != nil && h.settingSvc != nil {
		return h.settingSvc.GetOIDCConnectOAuthConfig(ctx)
	}
	if h == nil || h.cfg == nil {
		return config.OIDCConnectConfig{}, infraerrors.ServiceUnavailable("CONFIG_NOT_READY", "config not loaded")
	}
	if !h.cfg.OIDC.Enabled {
		return config.OIDCConnectConfig{}, infraerrors.NotFound("OAUTH_DISABLED", "oauth login is disabled")
	}
	return h.cfg.OIDC, nil
}

func oidcExchangeCode(
	ctx context.Context,
	cfg config.OIDCConnectConfig,
	code string,
	redirectURI string,
	codeVerifier string,
) (*oidcTokenResponse, error) {
	client := req.C().SetTimeout(30 * time.Second)

	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("client_id", cfg.ClientID)
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)
	if strings.TrimSpace(codeVerifier) != "" {
		form.Set("code_verifier", codeVerifier)
	}

	r := client.R().
		SetContext(ctx).
		SetHeader("Accept", "application/json")

	switch strings.ToLower(strings.TrimSpace(cfg.TokenAuthMethod)) {
	case "", "client_secret_post":
		form.Set("client_secret", cfg.ClientSecret)
	case "client_secret_basic":
		r.SetBasicAuth(cfg.ClientID, cfg.ClientSecret)
	case "none":
	default:
		return nil, fmt.Errorf("unsupported token_auth_method: %s", cfg.TokenAuthMethod)
	}

	resp, err := r.SetFormDataFromValues(form).Post(cfg.TokenURL)
	if err != nil {
		return nil, fmt.Errorf("request token: %w", err)
	}
	body := strings.TrimSpace(resp.String())
	if !resp.IsSuccessState() {
		providerErr, providerDesc := parseOAuthProviderError(body)
		return nil, &oidcTokenExchangeError{
			StatusCode:          resp.StatusCode,
			ProviderError:       providerErr,
			ProviderDescription: providerDesc,
			Body:                body,
		}
	}

	tokenResp, ok := oidcParseTokenResponse(body)
	if !ok {
		return nil, &oidcTokenExchangeError{StatusCode: resp.StatusCode, Body: body}
	}
	if strings.TrimSpace(tokenResp.TokenType) == "" {
		tokenResp.TokenType = "Bearer"
	}
	if strings.TrimSpace(tokenResp.AccessToken) == "" && strings.TrimSpace(tokenResp.IDToken) == "" {
		return nil, &oidcTokenExchangeError{StatusCode: resp.StatusCode, Body: body}
	}
	return tokenResp, nil
}

func oidcParseTokenResponse(body string) (*oidcTokenResponse, bool) {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil, false
	}

	accessToken := strings.TrimSpace(getGJSON(body, "access_token"))
	idToken := strings.TrimSpace(getGJSON(body, "id_token"))
	if accessToken != "" || idToken != "" {
		tokenType := strings.TrimSpace(getGJSON(body, "token_type"))
		refreshToken := strings.TrimSpace(getGJSON(body, "refresh_token"))
		scope := strings.TrimSpace(getGJSON(body, "scope"))
		expiresIn := gjson.Get(body, "expires_in").Int()
		return &oidcTokenResponse{
			AccessToken:  accessToken,
			TokenType:    tokenType,
			ExpiresIn:    expiresIn,
			RefreshToken: refreshToken,
			Scope:        scope,
			IDToken:      idToken,
		}, true
	}

	values, err := url.ParseQuery(body)
	if err != nil {
		return nil, false
	}
	accessToken = strings.TrimSpace(values.Get("access_token"))
	idToken = strings.TrimSpace(values.Get("id_token"))
	if accessToken == "" && idToken == "" {
		return nil, false
	}
	expiresIn := int64(0)
	if raw := strings.TrimSpace(values.Get("expires_in")); raw != "" {
		if v, parseErr := strconv.ParseInt(raw, 10, 64); parseErr == nil {
			expiresIn = v
		}
	}
	return &oidcTokenResponse{
		AccessToken:  accessToken,
		TokenType:    strings.TrimSpace(values.Get("token_type")),
		ExpiresIn:    expiresIn,
		RefreshToken: strings.TrimSpace(values.Get("refresh_token")),
		Scope:        strings.TrimSpace(values.Get("scope")),
		IDToken:      idToken,
	}, true
}

func oidcFetchUserInfo(
	ctx context.Context,
	cfg config.OIDCConnectConfig,
	token *oidcTokenResponse,
) (*oidcUserInfoClaims, error) {
	if strings.TrimSpace(cfg.UserInfoURL) == "" {
		return &oidcUserInfoClaims{}, nil
	}
	if token == nil || strings.TrimSpace(token.AccessToken) == "" {
		return nil, errors.New("missing access_token for userinfo request")
	}

	client := req.C().SetTimeout(30 * time.Second)
	authorization, err := buildBearerAuthorization(token.TokenType, token.AccessToken)
	if err != nil {
		return nil, fmt.Errorf("invalid token for userinfo request: %w", err)
	}

	resp, err := client.R().
		SetContext(ctx).
		SetHeader("Accept", "application/json").
		SetHeader("Authorization", authorization).
		Get(cfg.UserInfoURL)
	if err != nil {
		return nil, fmt.Errorf("request userinfo: %w", err)
	}
	if !resp.IsSuccessState() {
		return nil, fmt.Errorf("userinfo status=%d", resp.StatusCode)
	}

	return oidcParseUserInfo(resp.String(), cfg), nil
}

func oidcParseUserInfo(body string, cfg config.OIDCConnectConfig) *oidcUserInfoClaims {
	claims := &oidcUserInfoClaims{}
	claims.Email = firstNonEmpty(
		getGJSON(body, cfg.UserInfoEmailPath),
		getGJSON(body, "email"),
		getGJSON(body, "user.email"),
		getGJSON(body, "data.email"),
		getGJSON(body, "attributes.email"),
	)
	claims.Username = firstNonEmpty(
		getGJSON(body, cfg.UserInfoUsernamePath),
		getGJSON(body, "preferred_username"),
		getGJSON(body, "username"),
		getGJSON(body, "name"),
		getGJSON(body, "user.username"),
		getGJSON(body, "user.name"),
	)
	claims.Subject = firstNonEmpty(
		getGJSON(body, cfg.UserInfoIDPath),
		getGJSON(body, "sub"),
		getGJSON(body, "id"),
		getGJSON(body, "user_id"),
		getGJSON(body, "uid"),
		getGJSON(body, "user.id"),
	)
	if verified, ok := getGJSONBool(body, "email_verified"); ok {
		claims.EmailVerified = &verified
	}
	claims.DisplayName = firstNonEmpty(
		getGJSON(body, "name"),
		getGJSON(body, "nickname"),
		getGJSON(body, "display_name"),
		getGJSON(body, "preferred_username"),
		getGJSON(body, "username"),
	)
	claims.AvatarURL = firstNonEmpty(
		getGJSON(body, "picture"),
		getGJSON(body, "avatar_url"),
		getGJSON(body, "avatar"),
		getGJSON(body, "profile_image_url"),
		getGJSON(body, "user.avatar"),
		getGJSON(body, "user.avatar_url"),
	)
	claims.Email = strings.TrimSpace(claims.Email)
	claims.Username = strings.TrimSpace(claims.Username)
	claims.Subject = strings.TrimSpace(claims.Subject)
	claims.DisplayName = strings.TrimSpace(claims.DisplayName)
	claims.AvatarURL = strings.TrimSpace(claims.AvatarURL)
	return claims
}

func getGJSONBool(body string, path string) (bool, bool) {
	path = strings.TrimSpace(path)
	if path == "" {
		return false, false
	}
	res := gjson.Get(body, path)
	if !res.Exists() {
		return false, false
	}
	return res.Bool(), true
}

func buildOIDCAuthorizeURL(cfg config.OIDCConnectConfig, state, nonce, codeChallenge, redirectURI string) (string, error) {
	u, err := url.Parse(cfg.AuthorizeURL)
	if err != nil {
		return "", fmt.Errorf("parse authorize_url: %w", err)
	}

	q := u.Query()
	q.Set("response_type", "code")
	q.Set("client_id", cfg.ClientID)
	q.Set("redirect_uri", redirectURI)
	if strings.TrimSpace(cfg.Scopes) != "" {
		q.Set("scope", cfg.Scopes)
	}
	q.Set("state", state)
	if strings.TrimSpace(nonce) != "" {
		q.Set("nonce", nonce)
	}
	if strings.TrimSpace(codeChallenge) != "" {
		q.Set("code_challenge", codeChallenge)
		q.Set("code_challenge_method", "S256")
	}

	u.RawQuery = q.Encode()
	return u.String(), nil
}

func oidcParseAndValidateIDToken(ctx context.Context, cfg config.OIDCConnectConfig, idToken string, expectedNonce string) (*oidcIDTokenClaims, error) {
	idToken = strings.TrimSpace(idToken)
	if idToken == "" {
		return nil, errors.New("missing id_token")
	}
	allowed := oidcAllowedSigningAlgs(cfg.AllowedSigningAlgs)
	if len(allowed) == 0 {
		return nil, errors.New("empty allowed signing algorithms")
	}

	jwks, err := oidcFetchJWKSet(ctx, cfg.JWKSURL)
	if err != nil {
		return nil, err
	}
	leeway := time.Duration(cfg.ClockSkewSeconds) * time.Second
	claims := &oidcIDTokenClaims{}

	parsed, err := jwt.ParseWithClaims(
		idToken,
		claims,
		func(token *jwt.Token) (any, error) {
			alg := strings.TrimSpace(token.Method.Alg())
			if !containsString(allowed, alg) {
				return nil, fmt.Errorf("unexpected signing algorithm: %s", alg)
			}
			kid, _ := token.Header["kid"].(string)
			return oidcFindPublicKey(jwks, strings.TrimSpace(kid), alg)
		},
		jwt.WithValidMethods(allowed),
		jwt.WithAudience(cfg.ClientID),
		jwt.WithIssuer(cfg.IssuerURL),
		jwt.WithLeeway(leeway),
	)
	if err != nil {
		return nil, err
	}
	if !parsed.Valid {
		return nil, errors.New("id_token invalid")
	}
	if strings.TrimSpace(claims.Subject) == "" {
		return nil, errors.New("id_token missing sub")
	}
	if expectedNonce != "" && strings.TrimSpace(claims.Nonce) != strings.TrimSpace(expectedNonce) {
		return nil, errors.New("id_token nonce mismatch")
	}
	if len(claims.Audience) > 1 {
		if strings.TrimSpace(claims.Azp) == "" || strings.TrimSpace(claims.Azp) != strings.TrimSpace(cfg.ClientID) {
			return nil, errors.New("id_token azp mismatch")
		}
	}
	return claims, nil
}

func oidcAllowedSigningAlgs(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return []string{"RS256", "ES256", "PS256"}
	}
	seen := make(map[string]struct{})
	out := make([]string, 0, 4)
	for _, part := range strings.Split(raw, ",") {
		alg := strings.ToUpper(strings.TrimSpace(part))
		if alg == "" {
			continue
		}
		if _, ok := seen[alg]; ok {
			continue
		}
		seen[alg] = struct{}{}
		out = append(out, alg)
	}
	return out
}

func oidcFetchJWKSet(ctx context.Context, jwksURL string) (*oidcJWKSet, error) {
	jwksURL = strings.TrimSpace(jwksURL)
	if jwksURL == "" {
		return nil, errors.New("missing jwks_url")
	}
	resp, err := req.C().
		SetTimeout(30*time.Second).
		R().
		SetContext(ctx).
		SetHeader("Accept", "application/json").
		Get(jwksURL)
	if err != nil {
		return nil, fmt.Errorf("request jwks: %w", err)
	}
	if !resp.IsSuccessState() {
		return nil, fmt.Errorf("jwks status=%d", resp.StatusCode)
	}
	set := &oidcJWKSet{}
	if err := json.Unmarshal(resp.Bytes(), set); err != nil {
		return nil, fmt.Errorf("parse jwks: %w", err)
	}
	if len(set.Keys) == 0 {
		return nil, errors.New("jwks empty keys")
	}
	return set, nil
}

func oidcFindPublicKey(set *oidcJWKSet, kid, alg string) (any, error) {
	if set == nil {
		return nil, errors.New("jwks not loaded")
	}
	alg = strings.ToUpper(strings.TrimSpace(alg))
	kid = strings.TrimSpace(kid)

	var lastErr error
	for i := range set.Keys {
		k := set.Keys[i]
		if strings.TrimSpace(k.Use) != "" && !strings.EqualFold(strings.TrimSpace(k.Use), "sig") {
			continue
		}
		if kid != "" && strings.TrimSpace(k.Kid) != kid {
			continue
		}
		if strings.TrimSpace(k.Alg) != "" && !strings.EqualFold(strings.TrimSpace(k.Alg), alg) {
			continue
		}
		pk, err := k.publicKey()
		if err != nil {
			lastErr = err
			continue
		}
		if pk != nil {
			return pk, nil
		}
	}
	if lastErr != nil {
		return nil, lastErr
	}
	if kid != "" {
		return nil, fmt.Errorf("jwk not found for kid=%s", kid)
	}
	return nil, errors.New("jwk not found")
}

func (k oidcJWK) publicKey() (any, error) {
	switch strings.ToUpper(strings.TrimSpace(k.Kty)) {
	case "RSA":
		n, err := decodeBase64URLBigInt(k.N)
		if err != nil {
			return nil, fmt.Errorf("decode rsa n: %w", err)
		}
		eBytes, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(k.E))
		if err != nil {
			return nil, fmt.Errorf("decode rsa e: %w", err)
		}
		if len(eBytes) == 0 {
			return nil, errors.New("empty rsa e")
		}
		e := 0
		for _, b := range eBytes {
			e = (e << 8) | int(b)
		}
		if e <= 0 {
			return nil, errors.New("invalid rsa exponent")
		}
		if n.Sign() <= 0 {
			return nil, errors.New("invalid rsa modulus")
		}
		return &rsa.PublicKey{N: n, E: e}, nil
	case "EC":
		var curve elliptic.Curve
		switch strings.TrimSpace(k.Crv) {
		case "P-256":
			curve = elliptic.P256()
		case "P-384":
			curve = elliptic.P384()
		case "P-521":
			curve = elliptic.P521()
		default:
			return nil, fmt.Errorf("unsupported ec curve: %s", k.Crv)
		}
		x, err := decodeBase64URLBigInt(k.X)
		if err != nil {
			return nil, fmt.Errorf("decode ec x: %w", err)
		}
		y, err := decodeBase64URLBigInt(k.Y)
		if err != nil {
			return nil, fmt.Errorf("decode ec y: %w", err)
		}
		if !curve.IsOnCurve(x, y) { //nolint:staticcheck // JWK 以裸坐标给出公钥；替换为 ecdsa.ParseUncompressedPublicKey 需改变点编码，待单独迁移
			return nil, errors.New("ec point is not on curve")
		}
		return &ecdsa.PublicKey{Curve: curve, X: x, Y: y}, nil //nolint:staticcheck // 同上
	default:
		return nil, fmt.Errorf("unsupported jwk kty: %s", k.Kty)
	}
}

func decodeBase64URLBigInt(raw string) (*big.Int, error) {
	buf, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return nil, err
	}
	if len(buf) == 0 {
		return nil, errors.New("empty value")
	}
	return new(big.Int).SetBytes(buf), nil
}

func containsString(values []string, target string) bool {
	target = strings.TrimSpace(target)
	for _, v := range values {
		if strings.EqualFold(strings.TrimSpace(v), target) {
			return true
		}
	}
	return false
}

func oidcIdentityKey(issuer, subject string) string {
	issuer = strings.TrimSpace(strings.ToLower(issuer))
	subject = strings.TrimSpace(subject)
	return issuer + "\x1f" + subject
}

func oidcSyntheticEmailFromIdentityKey(identityKey string) string {
	identityKey = strings.TrimSpace(identityKey)
	if identityKey == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(identityKey))
	return "oidc-" + hex.EncodeToString(sum[:16]) + service.OIDCConnectSyntheticEmailDomain
}

func oidcFallbackUsername(subject string) string {
	subject = strings.TrimSpace(subject)
	if subject == "" {
		return "oidc_user"
	}
	sum := sha256.Sum256([]byte(subject))
	return "oidc_" + hex.EncodeToString(sum[:])[:12]
}

func oidcSetCookie(c *gin.Context, path, name, value string, maxAgeSec int, secure bool) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     path,
		MaxAge:   maxAgeSec,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func oidcClearCookie(c *gin.Context, path, name string, secure bool) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     path,
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

// tryOIDCVerifiedEmailFastPath 在 OIDC 上游已返回已验证邮箱时尝试跳过 choice/pending 页。
// 返回 true 表示已经写出重定向响应；返回 false 表示调用方应继续回退到常规 choice 流程。
func (h *AuthHandler) tryOIDCVerifiedEmailFastPath(
	c *gin.Context,
	frontendCallback string,
	redirectTo string,
	identity service.PendingAuthIdentityKey,
	compatEmail string,
	username string,
	upstreamClaims map[string]any,
) bool {
	if h == nil || h.authService == nil || h.settingSvc == nil {
		return false
	}
	ctx := c.Request.Context()
	if h.isForceEmailOnThirdPartySignup(ctx) {
		return false
	}
	if h.settingSvc.IsInvitationCodeEnabled(ctx) {
		return false
	}
	if err := h.ensureBackendModeAllowsNewUserLogin(ctx); err != nil {
		log.Printf("[OIDC OAuth] verified-email fast path blocked by backend mode: reason=%s", infraerrors.Reason(err))
		clearOAuthPendingSessionCookie(c, isRequestHTTPS(c))
		clearOAuthPendingBrowserCookie(c, isRequestHTTPS(c))
		redirectOAuthError(c, frontendCallback, "login_blocked", infraerrors.Reason(err), infraerrors.Message(err))
		return true
	}

	verifiedEmail := strings.TrimSpace(strings.ToLower(compatEmail))
	upstreamMetadata := make(map[string]any, len(upstreamClaims)+1)
	for k, v := range upstreamClaims {
		upstreamMetadata[k] = v
	}
	if syntheticEmail := pendingSessionStringValue(upstreamClaims, "email"); syntheticEmail != "" && !strings.EqualFold(syntheticEmail, verifiedEmail) {
		upstreamMetadata["synthetic_email"] = syntheticEmail
	}
	upstreamMetadata["email"] = verifiedEmail
	input := service.EmailOAuthIdentityInput{
		ProviderType:     strings.TrimSpace(identity.ProviderType),
		ProviderKey:      strings.TrimSpace(identity.ProviderKey),
		ProviderSubject:  strings.TrimSpace(identity.ProviderSubject),
		Email:            verifiedEmail,
		EmailVerified:    true,
		Username:         strings.TrimSpace(username),
		DisplayName:      pendingSessionStringValue(upstreamClaims, "suggested_display_name"),
		AvatarURL:        pendingSessionStringValue(upstreamClaims, "suggested_avatar_url"),
		UpstreamMetadata: upstreamMetadata,
	}
	tokenPair, _, err := h.authService.LoginOrRegisterVerifiedEmailOAuthWithSignupCodes(
		ctx,
		input,
		"",
		"",
		readOAuthPromoCode(c),
	)
	if err != nil {
		log.Printf("[OIDC OAuth] verified-email fast path skipped: reason=%s", infraerrors.Reason(err))
		return false
	}

	if strings.EqualFold(strings.TrimSpace(identity.ProviderType), "oidc") {
		h.oidcSyncAsync(strings.TrimSpace(strings.ToLower(input.Email)), func(ctx context.Context, svc *service.OIDCUserSyncService, email string) {
			svc.CheckDrift(ctx, email)
		})
	}

	fragment := url.Values{}
	fragment.Set("access_token", tokenPair.AccessToken)
	fragment.Set("refresh_token", tokenPair.RefreshToken)
	fragment.Set("expires_in", fmt.Sprintf("%d", tokenPair.ExpiresIn))
	fragment.Set("token_type", "Bearer")
	fragment.Set("redirect", redirectTo)
	clearOAuthPendingSessionCookie(c, isRequestHTTPS(c))
	clearOAuthPendingBrowserCookie(c, isRequestHTTPS(c))
	redirectWithFragment(c, frontendCallback, fragment)
	return true
}

type oidcTokenExchangeRequest struct {
	IDToken string `json:"id_token" binding:"required"`
}

// OIDCTokenExchange 用上游 id_token 换取本站会话 token（供 Mikiko App 等原生客户端使用，
// 客户端本地完成 PKCE 授权码交换后只需把 id_token 交给本站做信任转移）。
// POST /api/v1/auth/oauth/oidc/token-exchange
func (h *AuthHandler) OIDCTokenExchange(c *gin.Context) {
	var req oidcTokenExchangeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "Invalid request: "+err.Error())
		return
	}

	cfg, err := h.getOIDCOAuthConfig(c.Request.Context())
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	// 端点自身强制校验签名；validate_id_token 未开启时 JWKS 可能缺省，按 discovery 补齐。
	if strings.TrimSpace(cfg.JWKSURL) == "" {
		jwksURL, metaErr := oidcDiscoveryJWKSURL(c.Request.Context(), strings.TrimSpace(cfg.DiscoveryURL))
		if metaErr != nil || jwksURL == "" {
			response.ErrorFrom(c, infraerrors.InternalServer("OAUTH_CONFIG_INVALID", "oauth jwks url not configured"))
			return
		}
		cfg.JWKSURL = jwksURL
	}

	claims, err := oidcParseAndValidateIDToken(c.Request.Context(), cfg, req.IDToken, "")
	if err != nil {
		response.ErrorFrom(c, infraerrors.Unauthorized("OAUTH_ID_TOKEN_INVALID", "id_token validation failed"))
		return
	}
	// 受众校验：id_token 必须签发给本站配置的 client（azp 或 aud）。
	authorizedParty := strings.TrimSpace(claims.Azp)
	if authorizedParty == "" && len(claims.Audience) > 0 {
		authorizedParty = claims.Audience[0]
	}
	if !strings.EqualFold(authorizedParty, strings.TrimSpace(cfg.ClientID)) {
		response.ErrorFrom(c, infraerrors.Unauthorized("OAUTH_ID_TOKEN_INVALID", "id_token audience mismatch"))
		return
	}

	subject := strings.TrimSpace(claims.Subject)
	if subject == "" {
		response.ErrorFrom(c, infraerrors.Unauthorized("OAUTH_ID_TOKEN_INVALID", "missing subject claim"))
		return
	}
	identityRef := service.PendingAuthIdentityKey{
		ProviderType:    "oidc",
		ProviderKey:     "oidc",
		ProviderSubject: subject,
	}

	identityUser, err := h.findOAuthIdentityUser(c.Request.Context(), identityRef)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}

	var svcUser *service.User
	if identityUser != nil {
		svcUser = &service.User{ID: identityUser.ID, Email: identityUser.Email, Role: identityUser.Role, Status: identityUser.Status}
	} else {
		email := strings.TrimSpace(strings.ToLower(claims.Email))
		emailVerified := claims.EmailVerified != nil && *claims.EmailVerified
		if email == "" || !emailVerified {
			// 未验证邮箱的首次登录必须走浏览器完成 choice/验证流程，不能凭 id_token 直接建号。
			response.ErrorFrom(c, infraerrors.Forbidden("OAUTH_EMAIL_NOT_VERIFIED", "complete the first sign-in in the browser before using token exchange"))
			return
		}
		_, regUser, regErr := h.authService.LoginOrRegisterVerifiedEmailOAuthWithSignupCodes(
			c.Request.Context(),
			service.EmailOAuthIdentityInput{
				ProviderType:    "oidc",
				ProviderKey:     "oidc",
				ProviderSubject: subject,
				Email:           email,
				EmailVerified:   true,
				Username:        strings.TrimSpace(claims.PreferredUsername),
				DisplayName:     strings.TrimSpace(claims.Name),
			},
			"", "", "",
		)
		if regErr != nil {
			response.ErrorFrom(c, regErr)
			return
		}
		svcUser = &service.User{ID: regUser.ID, Email: regUser.Email, Role: regUser.Role, Status: regUser.Status}
	}

	if svcUser.Status != service.StatusActive {
		response.ErrorFrom(c, infraerrors.Forbidden("USER_NOT_ACTIVE", "user is not active"))
		return
	}

	if err := h.ensureBackendModeAllowsUser(c.Request.Context(), svcUser); err != nil {
		response.ErrorFrom(c, err)
		return
	}

	h.authService.RecordSuccessfulLogin(c.Request.Context(), svcUser.ID)
	h.oidcSyncAsync(svcUser.Email, func(ctx context.Context, svc *service.OIDCUserSyncService, email string) {
		svc.CheckDrift(ctx, email)
	})

	tokenPair, err := h.authService.GenerateTokenPair(c.Request.Context(), svcUser, "")
	if err != nil {
		response.InternalError(c, "Failed to generate token pair")
		return
	}
	writeOAuthTokenPairResponse(c, tokenPair)
}

// oidcDiscoveryJWKSURL 拉取 discovery 文档并返回 jwks_uri。
func oidcDiscoveryJWKSURL(ctx context.Context, discoveryURL string) (string, error) {
	type discoveryDoc struct {
		JWKSURI string `json:"jwks_uri"`
	}
	var doc discoveryDoc
	resp, err := req.C().SetTimeout(15*time.Second).R().SetContext(ctx).
		SetHeader("Accept", "application/json").
		SetSuccessResult(&doc).
		Get(discoveryURL)
	if err != nil {
		return "", fmt.Errorf("request discovery document: %w", err)
	}
	if !resp.IsSuccessState() {
		return "", fmt.Errorf("discovery request failed: status=%d", resp.StatusCode)
	}
	return strings.TrimSpace(doc.JWKSURI), nil
}
