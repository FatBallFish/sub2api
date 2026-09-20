# STATE Kit v2 Host Adapter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the current Host Service v2 host and a custom STATE Kit v0.3.4 package so all documented resource and manual-action workflows work without losing existing custom behavior.

**Architecture:** Add the v0.3.4 adapter RPCs and UI messages as additive capabilities on the current v2 contract. Keep capability-derived account scoping and secret filtering in the host, accept Host Service v1/v2 in the plugin, and advertise optional resources/actions through runtime responses rather than version assumptions.

**Tech Stack:** Go, protobuf/gRPC, HashiCorp go-plugin broker, Gin, Vue 3/TypeScript, Vitest, Python packaging, Ed25519/OpenSSL, systemd.

---

### Task 1: Extend The Host Plugin Contract

**Files:**
- Modify: `backend/pkg/pluginapi/v1/plugin.proto`
- Regenerate: `backend/pkg/pluginapi/v1/plugin.pb.go`
- Regenerate: `backend/pkg/pluginapi/v1/plugin_grpc.pb.go`
- Test: `backend/internal/service/plugin_host_services_broker_test.go`

**Step 1: Write failing broker tests**

Add a probe implementation that exposes `RunAction` and a Host Service probe that calls `ListResources` and `ResolveProxy`. Assert v2 remains the preferred version and the existing legacy fallback still negotiates v1.

**Step 2: Verify red**

Run: `go test ./internal/service -run 'TestOfferPluginHostServices|TestPluginAction' -count=1`

Expected: compile failure because the new RPC messages and methods do not exist.

**Step 3: Extend the proto additively**

Add:

```proto
rpc RunAction(RunActionRequest) returns (RunActionResponse);
rpc ListResources(ListResourcesRequest) returns (ListResourcesResponse);
rpc ResolveProxy(ResolveProxyRequest) returns (ResolveProxyResponse);
```

Retain every existing v2 field and field number. Add account/proxy summary messages and action request/response messages using the field numbers from the v0.3.4 adapter contract.

**Step 4: Regenerate bindings**

Use pinned `protoc-gen-go` and `protoc-gen-go-grpc` versions matching the repository-generated headers. Format generated and handwritten Go files.

**Step 5: Verify green**

Run: `go test ./pkg/pluginapi/v1 ./internal/service -run 'TestOfferPluginHostServices' -count=1`

**Step 6: Commit**

```bash
git add backend/pkg/pluginapi/v1 backend/internal/service/plugin_host_services_broker_test.go
git commit -m "feat(pluginapi): add STATE Kit action and resource RPCs"
```

### Task 2: Add Scoped Resource And Proxy Services

**Files:**
- Create: `backend/internal/service/plugin_resource_directory.go`
- Create: `backend/internal/service/plugin_resource_directory_test.go`
- Modify: `backend/internal/service/plugin_host_services.go`
- Modify: `backend/internal/service/plugin_manager.go`
- Modify: `backend/cmd/server/wire_gen.go`

**Step 1: Write failing directory tests**

Cover safe account summaries, active/non-expired proxy filtering, credential-free JSON, authenticated URL resolution, error redaction, capability scope enforcement, and unsupported-directory behavior.

**Step 2: Verify red**

Run: `go test ./internal/service -run 'TestPluginResourceDirectory' -count=1`

Expected: compile failure because the directory implementation and RPC handlers do not exist.

**Step 3: Implement against current v2 interfaces**

Reuse `PluginAccountScope` and current account metadata instead of restoring the old v1 directory interface. Inject account/proxy repositories through a resource-directory wrapper and implement `ListResources`/`ResolveProxy` on `pluginHostServiceServer`.

**Step 4: Verify green**

Run: `go test ./internal/service -run 'TestPlugin(Resource|Host)|TestBuildHostServices' -count=1`

**Step 5: Commit**

```bash
git add backend/internal/service backend/cmd/server/wire_gen.go
git commit -m "feat(plugin): expose scoped account and proxy resources"
```

### Task 3: Add The Administrator Action Endpoint

**Files:**
- Modify: `backend/internal/service/plugin_manager.go`
- Modify: `backend/internal/handler/admin/plugin_handler.go`
- Modify: `backend/internal/server/routes/admin.go`
- Test: `backend/internal/service/plugin_manager_routing_test.go`
- Test: `backend/internal/handler/admin/plugin_handler_test.go` or a focused new test
- Test: `backend/internal/server/routes/plugin_routes_test.go` or a focused new test

**Step 1: Write failing tests**

Assert actions require a running plugin, reject payloads over 32 KiB, time out, preserve plugin error details internally, return a safe handler error, and remain behind admin plus step-up middleware.

**Step 2: Verify red**

Run the focused service, handler, and route tests and confirm missing action methods/routes cause failure.

**Step 3: Implement**

Add `PluginManager.RunAction`, `PluginHandler.RunAction`, and `POST /admin/plugins/:id/actions`. Never create a temporary runtime for an action.

**Step 4: Verify green**

Run: `go test ./internal/service ./internal/handler/admin ./internal/server/routes -run 'Plugin.*Action' -count=1`

**Step 5: Commit**

```bash
git add backend/internal/service backend/internal/handler/admin backend/internal/server/routes
git commit -m "feat(plugin): add guarded runtime action endpoint"
```

### Task 4: Complete The Host UI Bridge

**Files:**
- Modify: `frontend/src/api/admin/plugins.ts`
- Modify: `frontend/src/views/admin/PluginsView.vue`
- Create: `frontend/src/views/admin/pluginResources.ts`
- Create: `frontend/src/views/admin/__tests__/pluginResources.spec.ts`
- Modify or create focused tests for `PluginsView.vue`
- Modify: `backend/internal/handler/admin/plugin_handler.go`
- Modify: backend plugin asset CSP tests

**Step 1: Write failing frontend and CSP tests**

Cover `plugin.action`, `plugin.resources`, message/token/window validation, paginated account collection, group IDs, safe proxy mapping, stale responses, and `frame-src 'self' about:` without relaxing other sandbox directives.

**Step 2: Verify red**

Run the focused Vitest files and backend CSP/handler tests. Confirm the missing bridge branches and CSP directive fail.

**Step 3: Implement the bridge**

Use existing admin APIs for stopped-plugin resource loading. Send actions through the existing step-up helper. Keep the sandbox iframe at `allow-scripts` only.

**Step 4: Verify green**

Run:

```bash
pnpm --dir frontend exec vitest run src/views/admin/__tests__/pluginResources.spec.ts
pnpm --dir frontend run typecheck
go test ./internal/handler/admin -run Plugin -count=1
```

**Step 5: Commit**

```bash
git add frontend/src/api/admin/plugins.ts frontend/src/views/admin backend/internal/handler/admin
git commit -m "feat(frontend): enable STATE Kit resources and actions"
```

### Task 5: Make The Custom Plugin Negotiate v1 And v2

**Repository:** `/Users/fatballfish/Documents/Projects/GoProjects/Personal/sub2api-state-kit`

**Files:**
- Modify: `plugin/internal/pluginapi/v1/plugin.proto`
- Regenerate: `plugin/internal/pluginapi/v1/plugin.pb.go`
- Regenerate: `plugin/internal/pluginapi/v1/plugin_grpc.pb.go`
- Modify: `plugin/internal/pluginapi/v1/runtime.go`
- Modify: `plugin/internal/engine/engine.go`
- Test: `plugin/internal/engine/engine_test.go`
- Test: `plugin/integration/host_contract_test.go.txt`

**Step 1: Write failing negotiation tests**

Assert Host Service API 1 and 2 are accepted, zero and versions above the supported maximum are rejected, and resources/actions are feature-detected.

**Step 2: Verify red**

Run: `go test ./internal/engine -run HostServices -count=1`

Expected: v2 is rejected by the current exact-version check.

**Step 3: Implement range negotiation and sync the additive contract**

Accept versions 1 through 2. Keep protocol, transport API, and UI bridge versions unchanged. Regenerate bindings from the synchronized proto.

**Step 4: Verify green**

Run: `go test ./...` from `plugin/` and `node --test ui-tests/*.test.cjs`.

**Step 5: Commit**

```bash
git add plugin
git commit -m "feat(plugin): support Host Service v2"
```

### Task 6: Create The Custom Signing Identity And Package

**Repository:** `/Users/fatballfish/Documents/Projects/GoProjects/Personal/sub2api-state-kit`

**Files:**
- Modify: `scripts/package_plugin.py`
- Modify: `plugin/internal/engine/config.go` or version constant location
- Create/modify public trust files under `plugin/release/`
- Private key: outside repository under `~/.config/sub2api-state-kit/signing/`

**Step 1: Write packaging tests or deterministic validation checks**

Assert version `0.3.4-custom.1`, a distinct publisher key ID, manifest/runtime version equality, exact payload hashes, and successful signature verification.

**Step 2: Generate the key securely**

Create an Ed25519 private key with mode `0600` outside both repositories. Commit only the base64 raw public key and trust YAML.

**Step 3: Update packaging metadata**

Use a distinct key ID and custom version. Do not impersonate `state-kit-release-v1`.

**Step 4: Build and verify**

Run:

```bash
python3 scripts/package_plugin.py build --private-key <external-key> --output ./artifacts
python3 scripts/package_plugin.py verify --package ./artifacts/sub2api-state-kit_plugin_v0.3.4-custom.1.s2plugin
```

**Step 5: Commit**

```bash
git add scripts/package_plugin.py plugin/release plugin/internal
git commit -m "build(plugin): add custom signed release identity"
```

### Task 7: Run Full Local Acceptance

**Host worktree:** `.worktrees/statekit-v2-adapter`

**Step 1: Host backend**

Run: `go test ./...` from `backend/`.

**Step 2: Host frontend**

Run lint, typecheck, focused/critical Vitest, and production build.

**Step 3: Plugin**

Run `go test -race ./...`, Node UI tests, package verification, and the host contract integration suite against the adapted host source.

**Step 4: Review diffs**

Confirm no unrelated generated files, credentials, build artifacts, or existing custom behavior were changed.

### Task 8: Integrate, Push, Deploy, And Exercise The Plugin

**Step 1: Integrate branches**

Fast-forward or cherry-pick reviewed host commits onto `custom_main`; push host `custom_main`. Push plugin `custom_main` to its origin.

**Step 2: Build the host with the exact version**

Use `-X main.Version=0.2.7 -X main.BuildType=release`. Verify `sub2api --version` reports exactly `0.2.7` before upload.

**Step 3: Back up remote state and deploy host**

Back up the binary, config, and plugin installation directory. Atomically install the host binary and restart systemd with rollback on failure.

**Step 4: Trust and upload the custom plugin**

Merge the new publisher key into `config.yaml`, restart once, upload the signed package through the admin API, and enable it at 100% rollout.

**Step 5: Configure account 5747**

Save the existing dynamic proxy plus account 5747, `pro`, `gpt-6-astra`, with `allow_without_ticket=true`. Enable STATE only after proxy and business-egress checks pass.

**Step 6: Run live acceptance actions**

Run proxy test, business egress check, and model test through the plugin action endpoint. Poll passive status until each action completes and record safe summaries only.

**Step 7: Final verification**

Confirm exact host version, service health, trusted/enabled plugin, all three readiness flags, account configuration, observable ticket state, clean warning/error logs, matching remote branch SHAs, and retained rollback artifacts.
