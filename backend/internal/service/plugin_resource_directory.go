package service

import (
	"context"
	"time"

	pluginv1 "github.com/Wei-Shaw/sub2api/pkg/pluginapi/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// PluginResourceDirectory exposes credential-free resource summaries and resolves
// an authenticated proxy URL only after the plugin selects an allowed proxy id.
type PluginResourceDirectory interface {
	ListPluginResources(context.Context, PluginAccountScope) (*pluginv1.ListResourcesResponse, error)
	ResolvePluginProxy(context.Context, int64) (string, error)
}

type pluginResourceDirectory struct {
	PluginAccountDirectory
	proxies ProxyRepository
}

func NewPluginResourceDirectory(base PluginAccountDirectory, proxies ProxyRepository) PluginAccountDirectory {
	return &pluginResourceDirectory{PluginAccountDirectory: base, proxies: proxies}
}

func (d *pluginResourceDirectory) ListPluginResources(ctx context.Context, scope PluginAccountScope) (*pluginv1.ListResourcesResponse, error) {
	infos, err := d.ListPluginAccounts(ctx, scope, PlatformOpenAI, AccountTypeOAuth)
	if err != nil {
		return nil, err
	}
	out := &pluginv1.ListResourcesResponse{ActionsSupported: true}
	for _, info := range infos {
		out.Accounts = append(out.Accounts, &pluginv1.AccountSummary{Id: info.ID, Name: info.Name})
	}
	if d.proxies == nil {
		return out, nil
	}
	proxies, err := d.proxies.ListActive(ctx)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	for i := range proxies {
		proxy := &proxies[i]
		if !proxy.IsActive() || proxy.IsExpired(now) {
			continue
		}
		out.Proxies = append(out.Proxies, &pluginv1.ProxySummary{
			Id: proxy.ID, Name: proxy.Name, Protocol: proxy.Protocol,
			Host: proxy.Host, Port: int32(proxy.Port),
		})
	}
	return out, nil
}

func (d *pluginResourceDirectory) ResolvePluginProxy(ctx context.Context, id int64) (string, error) {
	if d.proxies == nil {
		return "", nil
	}
	proxy, err := d.proxies.GetByID(ctx, id)
	if err != nil {
		return "", err
	}
	if proxy == nil || !proxy.IsActive() || proxy.IsExpired(time.Now()) {
		return "", nil
	}
	return proxy.URL(), nil
}

func (s *pluginHostServiceServer) ListResources(ctx context.Context, req *pluginv1.ListResourcesRequest) (*pluginv1.ListResourcesResponse, error) {
	if s == nil || s.directory == nil || s.scope.Empty() {
		return nil, status.Error(codes.PermissionDenied, "资源目录不可用")
	}
	directory, ok := s.directory.(PluginResourceDirectory)
	if !ok {
		return nil, status.Error(codes.Unimplemented, "资源目录不受支持")
	}
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "请求为空")
	}
	out, err := directory.ListPluginResources(ctx, s.scope)
	if err != nil {
		return nil, status.Error(codes.Internal, "资源目录读取失败")
	}
	return out, nil
}

func (s *pluginHostServiceServer) ResolveProxy(ctx context.Context, req *pluginv1.ResolveProxyRequest) (*pluginv1.ResolveProxyResponse, error) {
	if s == nil || s.directory == nil || s.scope.Empty() {
		return nil, status.Error(codes.PermissionDenied, "代理目录不可用")
	}
	directory, ok := s.directory.(PluginResourceDirectory)
	if !ok {
		return nil, status.Error(codes.Unimplemented, "代理目录不受支持")
	}
	if req == nil || req.ProxyId <= 0 {
		return nil, status.Error(codes.InvalidArgument, "proxy_id 无效")
	}
	proxyURL, err := directory.ResolvePluginProxy(ctx, req.ProxyId)
	if err != nil {
		return nil, status.Error(codes.Unavailable, "选中的代理不可用")
	}
	return &pluginv1.ResolveProxyResponse{Found: proxyURL != "", ProxyUrl: proxyURL}, nil
}
