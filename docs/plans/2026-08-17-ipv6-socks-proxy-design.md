# IPv6 SOCKS Proxy Design

## Goal

Deploy 100 stable SOCKS5 proxy pairs on `159.195.14.17`. Every pair must use
one unique IPv6 source address from `2a0a:4cc0:101:319::/64`, and no two pairs
may share an egress address.

## Architecture

Run sing-box directly on the host. Each proxy entry owns:

- one stable IPv6 address;
- one authenticated public listener on `0.0.0.0:21001-21100`;
- one unauthenticated local listener on `127.0.0.1:12001-12100`;
- one direct outbound whose `inet6_bind_address` is that entry's IPv6 address;
- routing rules that send both listeners only to that outbound.

This has the same observable egress property as the SOP's mihomo plus bound
HTTP-proxy chain, but sing-box performs the source-address bind directly. The
acceptance test, rather than configuration inspection alone, is authoritative:
every listener must return its assigned IPv6 and all 100 returned addresses
must be unique.

## State And Operations

`/etc/ipv6-proxy-manager/proxies.json` is the stable asset ledger. It records
the entry ID, IPv6 address, public port, private port, and enabled state. Random
IPv6 suffixes are generated once and reused across restarts.

`/usr/local/sbin/ipv6-proxyctl` manages the deployment:

- `list`
- `add COUNT`
- `remove ID`
- `apply`
- `verify`
- `rotate-credentials`
- `show-credentials`

Generated files are validated before replacement. The script synchronizes
addresses, renders sing-box configuration, reconciles the public firewall rule,
and restarts the service only after validation succeeds.

## Authentication And Exposure

All public listeners share one randomly generated strong username/password.
The credential file is `/etc/ipv6-proxy-manager/credentials.env`, owned by root
with mode `0600`. Public listeners require credentials; missing or incorrect
credentials must fail.

Private listeners bind only to `127.0.0.1` and have an empty user list, so the
host-installed sub2api service can use them without credentials. Docker IPv6
is not enabled or required.

Sub2API proxy records should use `socks5h://127.0.0.1:120xx` and
`fallback_mode=none`. The account keeps its existing `proxy_id`; the manager
never rotates an enabled entry's IPv6 or ports. Consequently, repeated requests
and service restarts preserve the account's egress IPv6. Removing an entry is a
deliberate breaking operation and must be refused while it is assigned in
Sub2API operational practice.

The host firewall allows only enabled public SOCKS ports. No management web UI
is exposed. A CLI is preferred because adding a web control plane would add a
second authentication surface without improving the current single-host use
case.

## Service Lifecycle

A systemd address-preparation service restores configured IPv6 aliases before
sing-box starts. sing-box runs as a dedicated restricted service and is enabled
at boot. The firewall reconciliation is repeatable and runs during apply and at
boot.

## Verification

Deployment is accepted only when all of the following pass:

1. The ledger contains 100 enabled entries with unique IPv6 addresses and ports.
2. All IPv6 aliases exist without `tentative` or `dadfailed` state.
3. sing-box configuration validation succeeds.
4. All 100 public and 100 private TCP listeners exist.
5. Every private listener returns exactly its assigned IPv6 without credentials.
6. Every public listener rejects missing and incorrect credentials.
7. Every public listener returns exactly its assigned IPv6 with valid credentials.
8. The 100 observed egress addresses are unique.
9. Repeated requests through the same listener keep the same egress address.
10. The mapping survives a service restart.
11. The temporary proof addresses and any failed deployment artifacts are removed.

## Security Notes

SOCKS5 username/password authentication is not encrypted. A strong random
credential prevents unauthenticated use but does not provide transport secrecy.
TLS or a VPN would be required if credential confidentiality on the network path
becomes a requirement.
