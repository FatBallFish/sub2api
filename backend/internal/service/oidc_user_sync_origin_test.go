//go:build unit

package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/stretchr/testify/require"
)

// oidcSyncKCStub 用 httptest 模拟 Keycloak Admin REST 的最小面：
// token、按邮箱查用户、凭证列表、建号、reset-password。
type oidcSyncKCStub struct {
	mu sync.Mutex
	// users 按邮箱返回的用户；kcUser JSON 形态（id/attributes）。
	users map[string]map[string]any
	// hasPassword 控制 credentials 列表是否含 password 项。
	hasPassword bool

	createBodies   []map[string]any
	resetPasswords map[string]string
}

func newOIDCSyncKCStub() *oidcSyncKCStub {
	return &oidcSyncKCStub{
		users:          map[string]map[string]any{},
		resetPasswords: map[string]string{},
	}
}

func (s *oidcSyncKCStub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	path := r.URL.Path

	if strings.HasSuffix(path, "/protocol/openid-connect/token") {
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "t", "expires_in": 300})
		return
	}
	switch {
	case path == "/admin/realms/mikiko/users" && r.Method == http.MethodPost:
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		s.createBodies = append(s.createBodies, body)
		w.Header().Set("Location", "http://kc/admin/realms/mikiko/users/created-1")
		w.WriteHeader(http.StatusCreated)
		return
	case path == "/admin/realms/mikiko/users" && r.Method == http.MethodGet:
		email := r.URL.Query().Get("email")
		out := []map[string]any{}
		if u, ok := s.users[email]; ok {
			out = append(out, u)
		}
		_ = json.NewEncoder(w).Encode(out)
		return
	case strings.HasSuffix(path, "/credentials"):
		creds := []map[string]any{}
		if s.hasPassword {
			creds = append(creds, map[string]any{"type": "password", "createdDate": 1700000000000})
		}
		_ = json.NewEncoder(w).Encode(creds)
		return
	case strings.HasSuffix(path, "/reset-password") && r.Method == http.MethodPut:
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		parts := strings.Split(path, "/")
		s.resetPasswords[parts[len(parts)-2]] = body["value"].(string)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.WriteHeader(http.StatusNotFound)
}

func (s *oidcSyncKCStub) addUser(id, email string, attributes map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.users[email] = map[string]any{"id": id, "attributes": attributes}
}

func newOIDCSyncTestService(t *testing.T, kc *oidcSyncKCStub) (*OIDCUserSyncService, *dbent.Client) {
	t.Helper()
	server := httptest.NewServer(kc)
	t.Cleanup(server.Close)

	client := newPaymentConfigServiceTestClient(t)
	repo := &paymentConfigSettingRepoStub{values: map[string]string{
		SettingKeyOIDCUserSyncEnabled:      "true",
		SettingKeyOIDCUserSyncAdminURL:     server.URL,
		SettingKeyOIDCUserSyncRealm:        "mikiko",
		SettingKeyOIDCUserSyncClientID:     "sub2api-sync",
		SettingKeyOIDCUserSyncClientSecret: "secret",
	}}
	svc := NewOIDCUserSyncService(NewSettingService(repo, nil), client)
	return svc, client
}

func createOIDCSyncTestUser(t *testing.T, client *dbent.Client, email string) int64 {
	t.Helper()
	u, err := client.User.Create().
		SetEmail(email).
		SetUsername(email).
		SetPasswordHash("hash").
		Save(context.Background())
	require.NoError(t, err)
	return u.ID
}

func TestSyncLoginCreatesKeycloakUserWithOrigin(t *testing.T) {
	kc := newOIDCSyncKCStub()
	svc, client := newOIDCSyncTestService(t, kc)
	email := "origin-create@example.com"
	createOIDCSyncTestUser(t, client, email)

	svc.SyncLogin(context.Background(), email, "pw-1")

	require.Len(t, kc.createBodies, 1)
	body := kc.createBodies[0]
	require.Equal(t, email, body["username"])
	attrs, ok := body["attributes"].(map[string]any)
	require.True(t, ok, "create body should carry attributes")
	require.Equal(t, []any{"mikikocc"}, attrs["origin"])
	// 新建账号无密码 → 立即补写
	require.Equal(t, map[string]string{"created-1": "pw-1"}, kc.resetPasswords)
}

func TestSyncPasswordChangeOriginGate(t *testing.T) {
	t.Run("skips when keycloak user has no origin attribute", func(t *testing.T) {
		kc := newOIDCSyncKCStub()
		kc.hasPassword = true
		kc.addUser("u-1", "gate@example.com", map[string]any{})
		svc, client := newOIDCSyncTestService(t, kc)
		uid := createOIDCSyncTestUser(t, client, "gate@example.com")

		svc.SyncPasswordChange(context.Background(), "gate@example.com", "pw-new")

		require.Empty(t, kc.resetPasswords, "password push must be skipped")
		updated, err := client.User.Get(context.Background(), uid)
		require.NoError(t, err)
		require.Nil(t, updated.OidcSyncedAt, "sync result must not be recorded")
		require.False(t, updated.OidcPasswordDrift)
	})

	t.Run("skips when origin value mismatches", func(t *testing.T) {
		kc := newOIDCSyncKCStub()
		kc.hasPassword = true
		kc.addUser("u-2", "mismatch@example.com", map[string]any{"origin": []any{"elsewhere"}})
		svc, client := newOIDCSyncTestService(t, kc)
		createOIDCSyncTestUser(t, client, "mismatch@example.com")

		svc.SyncPasswordChange(context.Background(), "mismatch@example.com", "pw-new")

		require.Empty(t, kc.resetPasswords)
	})

	t.Run("pushes when origin is mikikocc", func(t *testing.T) {
		kc := newOIDCSyncKCStub()
		kc.hasPassword = true
		kc.addUser("u-3", "match@example.com", map[string]any{"origin": []any{"mikikocc"}})
		svc, client := newOIDCSyncTestService(t, kc)
		uid := createOIDCSyncTestUser(t, client, "match@example.com")

		svc.SyncPasswordChange(context.Background(), "match@example.com", "pw-new")

		require.Equal(t, map[string]string{"u-3": "pw-new"}, kc.resetPasswords)
		updated, err := client.User.Get(context.Background(), uid)
		require.NoError(t, err)
		require.NotNil(t, updated.OidcSyncedAt)
		require.False(t, updated.OidcPasswordDrift)
	})

	t.Run("skips when keycloak user missing entirely", func(t *testing.T) {
		kc := newOIDCSyncKCStub()
		svc, client := newOIDCSyncTestService(t, kc)
		uid := createOIDCSyncTestUser(t, client, "ghost@example.com")

		svc.SyncPasswordChange(context.Background(), "ghost@example.com", "pw-new")

		require.Empty(t, kc.createBodies, "password change must not create the keycloak user")
		require.Empty(t, kc.resetPasswords)
		updated, err := client.User.Get(context.Background(), uid)
		require.NoError(t, err)
		require.Nil(t, updated.OidcSyncedAt)
	})
}
