# IPv6 SOCKS5 Proxy Manager

This host exposes one stable IPv6 egress address per SOCKS5 port pair:

- Public listeners: `0.0.0.0:21001-21100`, with shared username/password authentication.
- Private listeners: `127.0.0.1:12001-12100`, without authentication.
- Public port `21000 + ID` and private port `12000 + ID` use the same fixed IPv6 egress.

The initial 100 mappings stay stable across requests and service restarts because the
IPv6 address is stored in the state file. Do not delete and recreate an account's proxy
mapping when that account must retain the same egress IP.

## Inspect the mappings

```bash
sudo ipv6-proxyctl list
sudo ipv6-proxyctl verify --repeat 2
sudo systemctl status ipv6-proxy.service
```

`verify` sends traffic through every enabled private listener and requires every
observed address to match the stored mapping and to be unique.

## Add or remove ports

Changes are written first, then activated with `apply`:

```bash
sudo ipv6-proxyctl add 10
sudo ipv6-proxyctl apply

sudo ipv6-proxyctl remove 42
sudo ipv6-proxyctl apply
```

`remove` disables the mapping ID; IDs and ports are never reused automatically. Check
the resulting ports and IPv6 addresses with `ipv6-proxyctl list`.

## Public credentials

All public listeners use the same credentials. Display or rotate them as root:

```bash
sudo ipv6-proxyctl show-credentials
sudo ipv6-proxyctl rotate-credentials
sudo ipv6-proxyctl apply
```

Rotating credentials changes all public ports. SOCKS5 username/password authentication
does not encrypt the transport; use it only where exposing raw SOCKS5 is acceptable, or
place an encrypted tunnel in front of the service.

## sub2api configuration

Create one local proxy record per desired account mapping, for example:

```text
socks5h://127.0.0.1:12001
```

Bind the account to that proxy's fixed `proxy_id` and set `fallback_mode=none`. With the
same `proxy_id`, the account keeps the same egress IPv6 across requests and restarts.
The `socks5h` scheme keeps DNS resolution on the proxy side. If the mapping is disabled
or unavailable, `fallback_mode=none` makes the request fail instead of leaking through
the host's direct connection.

## Files

- Stable mapping state: `/etc/ipv6-proxy-manager/proxies.json`
- Public credentials: `/etc/ipv6-proxy-manager/credentials.env` (mode `0600`)
- Generated sing-box config: `/etc/ipv6-proxy-manager/sing-box.json`
- Manager command: `/usr/local/sbin/ipv6-proxyctl`
- Service units: `/etc/systemd/system/ipv6-proxy*.service`
- This guide: `/usr/local/share/doc/ipv6-proxy-manager/README.md`

Back up `proxies.json` and `credentials.env`. The state file is the source of truth for
the fixed port-to-IPv6 assignments.
