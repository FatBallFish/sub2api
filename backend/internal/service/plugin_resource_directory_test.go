package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	pluginv1 "github.com/Wei-Shaw/sub2api/pkg/pluginapi/v1"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type resourceProxyRepository struct {
	ProxyRepository
	entries []Proxy
	err     error
}

func (r *resourceProxyRepository) ListActive(context.Context) ([]Proxy, error) {
	return r.entries, r.err
}

func (r *resourceProxyRepository) GetByID(_ context.Context, id int64) (*Proxy, error) {
	for i := range r.entries {
		if r.entries[i].ID == id {
			return &r.entries[i], r.err
		}
	}
	return nil, r.err
}

func TestPluginResourceDirectoryCatalogAndResolution(t *testing.T) {
	past := time.Now().Add(-time.Minute)
	proxies := &resourceProxyRepository{entries: []Proxy{
		{ID: 3, Name: "Front", Protocol: "http", Host: "front.example", Port: 8080, Username: "private-user", Password: "private-password", Status: StatusActive},
		{ID: 4, Name: "Expired", Status: StatusActive, ExpiresAt: &past},
		{ID: 5, Name: "Inactive", Status: "inactive"},
	}}
	base := &fakeAccountDirectory{infos: []PluginAccountInfo{
		{ID: 7, Name: "Mail Pro", Platform: PlatformOpenAI, AccountType: AccountTypeOAuth},
	}}
	directory := NewPluginResourceDirectory(base, proxies)
	scope := newPluginAccountScope(pluginAccountScopeEntry{Platform: PlatformOpenAI, AccountType: AccountTypeOAuth})
	server := newPluginHostServiceServer("test.plugin", newFakePluginKVStore(), directory, scope)

	out, err := server.ListResources(context.Background(), &pluginv1.ListResourcesRequest{})
	require.NoError(t, err)
	require.Len(t, out.Accounts, 1)
	require.Equal(t, "Mail Pro", out.Accounts[0].Name)
	require.Len(t, out.Proxies, 1)
	require.Equal(t, int64(3), out.Proxies[0].Id)
	require.True(t, out.ActionsSupported)
	encoded, err := json.Marshal(out)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "private-")

	for _, id := range []int64{3, 4, 5, 999} {
		resolved, resolveErr := server.ResolveProxy(context.Background(), &pluginv1.ResolveProxyRequest{ProxyId: id})
		require.NoError(t, resolveErr)
		require.Equal(t, id == 3, resolved.Found)
		if id != 3 {
			require.Empty(t, resolved.ProxyUrl)
		}
	}
	proxies.entries[0].Password = "updated"
	resolved, err := server.ResolveProxy(context.Background(), &pluginv1.ResolveProxyRequest{ProxyId: 3})
	require.NoError(t, err)
	require.Contains(t, resolved.ProxyUrl, "updated")

	proxies.err = errors.New("private-password")
	_, err = server.ResolveProxy(context.Background(), &pluginv1.ResolveProxyRequest{ProxyId: 3})
	require.Error(t, err)
	require.NotContains(t, err.Error(), "private-password")
}

func TestPluginResourceDirectoryCapabilityGateAndLegacy(t *testing.T) {
	tests := []struct {
		name      string
		directory PluginAccountDirectory
		scope     PluginAccountScope
		code      codes.Code
	}{
		{name: "missing directory", code: codes.PermissionDenied},
		{name: "empty scope", directory: NewPluginResourceDirectory(&fakeAccountDirectory{}, &resourceProxyRepository{}), code: codes.PermissionDenied},
		{name: "legacy directory", directory: &fakeAccountDirectory{}, scope: newPluginAccountScope(pluginAccountScopeEntry{Platform: PlatformOpenAI, AccountType: AccountTypeOAuth}), code: codes.Unimplemented},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			server := newPluginHostServiceServer("test.plugin", newFakePluginKVStore(), tc.directory, tc.scope)
			_, err := server.ListResources(context.Background(), &pluginv1.ListResourcesRequest{})
			require.Equal(t, tc.code, status.Code(err))
			_, err = server.ResolveProxy(context.Background(), &pluginv1.ResolveProxyRequest{ProxyId: 3})
			require.Equal(t, tc.code, status.Code(err))
		})
	}
}

func TestPluginResourceDirectoryRejectsInvalidProxyID(t *testing.T) {
	directory := NewPluginResourceDirectory(&fakeAccountDirectory{}, &resourceProxyRepository{})
	scope := newPluginAccountScope(pluginAccountScopeEntry{Platform: PlatformOpenAI, AccountType: AccountTypeOAuth})
	server := newPluginHostServiceServer("test.plugin", newFakePluginKVStore(), directory, scope)

	_, err := server.ResolveProxy(context.Background(), &pluginv1.ResolveProxyRequest{})
	require.Equal(t, codes.InvalidArgument, status.Code(err))
	require.False(t, strings.Contains(strings.ToLower(err.Error()), "password"))
}
