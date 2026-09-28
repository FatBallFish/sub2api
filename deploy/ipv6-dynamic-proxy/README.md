# IPv6 Dynamic Proxy Pool

This service exposes an authenticated SOCKS5 and HTTP CONNECT proxy. Each upstream TCP connection binds a rotating IPv6 source address from the configured `/64`.

The service only resolves IPv6 upstream addresses. This is intentional: the pool is an IPv6 egress pool and must not silently fall back to IPv4.

Configuration is stored in `/etc/ipv6-pool-proxy/ipv6-pool-proxy.env`:

```text
LISTEN=0.0.0.0:19080
PROXY_USERNAME=replace-me
PROXY_PASSWORD=replace-me
IPV6_PREFIX=2a03:4000:47:a0c::/64
IPV6_DEVICE=eth0
IPV6_START=4096
POOL_SIZE=10000
```

The firewall should restrict TCP/19080 to the Sub2API server that consumes this proxy. Do not expose the port publicly without authentication and an explicit source allowlist.
