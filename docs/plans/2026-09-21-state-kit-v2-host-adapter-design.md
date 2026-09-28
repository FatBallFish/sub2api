# STATE Kit v2 Host Adapter Design

## Goal

Run a custom-signed STATE Kit derived from v0.3.4 against the current `custom_main` host while preserving the host's existing Host Service v2 contract and all prior custom functionality. Restore the deployed host version string to exactly `0.2.7` and enable the complete plugin workflow: resource discovery, proxy actions, business egress checks, model tests, and HTML preview.

## Constraints

- Do not apply the upstream v0.2.7 adapter patch wholesale. It was authored against an older host and would overwrite current v2 account metadata, capability scoping, generated protocol code, and unrelated custom changes.
- Keep `HostServiceAPIVersion = 2` as the host's preferred protocol.
- Keep the host's v2-to-v1 fallback so the original signed v0.3.4 package and other v1-only plugins remain usable.
- Make the custom plugin accept both Host Service v1 and v2.
- Resource-list responses must never expose OAuth credentials, proxy credentials, tickets, or authenticated proxy URLs.
- Resolve authenticated proxy URLs only inside the plugin process through the scoped Host Service RPC.
- All state-changing plugin actions remain admin-only and step-up protected.

## Compatibility Model

The host first offers Host Service v2. A custom plugin accepts v2 and uses the additive resource and action capabilities. If a plugin explicitly rejects v2 as unsupported, the host retries v1 on the same broker. The custom plugin also accepts v1 so its package remains usable on older official 0.2.7 hosts with the documented adapter.

The resource and proxy RPCs are additive methods on the existing service descriptor. Unsupported hosts return gRPC `Unimplemented`; the plugin keeps its existing manual-ID and manual-proxy fallback behavior. Action availability is explicitly advertised rather than inferred from the version number.

## Host Changes

Extend the current protocol definitions with `RunAction`, `ListResources`, and `ResolveProxy`, regenerating Go bindings without replacing existing v2 messages or fields. Add a resource directory that reuses the current capability-derived account scope, emits only safe account/proxy summaries, and resolves only active, non-expired proxies.

Expose `POST /admin/plugins/:id/actions` through the existing admin and step-up middleware. The manager calls actions only on the running plugin, applies bounded payload and timeout limits, and never starts temporary runtimes for actions.

Extend the sandbox UI bridge with `plugin.action` and `plugin.resources`. Account/group data is loaded through existing admin APIs so it is available while the plugin process is stopped. Permit only `self` and `about:` frames in the plugin asset CSP for the isolated HTML preview.

## Plugin Changes

Create `custom_main` from the local repository's current `main`. Accept Host Service v1 and v2 instead of requiring exact v1. Keep runtime feature detection for resources and actions. Align the vendored protocol definition with the host's additive RPC surface and retain all v0.3.4 behavior.

Publish as `0.3.4-custom.1`. Generate a new Ed25519 key outside the repository, use a distinct publisher key ID, and commit only the public key/trust snippet. The remote host trusts both the original publisher and the custom publisher for rollback compatibility.

## Deployment And Validation

Build the host with `main.Version=0.2.7` and `BuildType=release`. Back up the current binary, configuration, and installed plugin package before deployment. Deploy the host first, then upload/enable the custom-signed package through supported host APIs.

Use account `5747`, plan `pro`, and model `gpt-6-astra`. Preserve `allow_without_ticket=true` during validation. Verify in order:

1. Host health and exact `0.2.7` version.
2. Plugin signature trusted and runtime enabled.
3. `host_ready`, `resources_ready`, and `actions_ready` are true.
4. Dynamic proxy test and automatic proxy save succeed.
5. Business egress check succeeds through account 5747's loopback SOCKS5H proxy.
6. Model test completes and reports the actual model/match status.
7. Saved configuration contains account 5747 as enabled with the requested plan/model.
8. Ticket acquisition reaches a terminal observable state without breaking ordinary traffic.

Rollback restores the previous host binary/config and the prior signed plugin artifact.

## Test Strategy

- Host protocol and broker tests cover v2, v1 fallback, resources, proxy resolution, actions, payload limits, and secret redaction.
- Host handler/route tests cover authentication, step-up protection, errors, and CSP.
- Frontend unit tests cover bridge validation, group/account resource mapping, action dispatch, and stale-response protection.
- Plugin Go and UI tests cover v1/v2 acceptance and capability readiness.
- Run host backend tests, frontend lint/typecheck/critical tests/build, plugin `go test -race ./...`, and plugin UI tests before packaging.
