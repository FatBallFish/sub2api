# IPv6 SOCKS Proxy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy and verify 100 authenticated public and unauthenticated local SOCKS5 listeners with one stable, unique IPv6 egress per listener pair.

**Architecture:** A tested Python CLI owns the stable mapping ledger, renders a sing-box host configuration, synchronizes IPv6 aliases, and reconciles firewall access. systemd restores aliases and starts a single sing-box process; acceptance checks compare every listener's observed public IPv6 with its ledger assignment.

**Tech Stack:** Python 3 standard library, unittest, sing-box 1.13.19, systemd, iproute2, nftables/iptables-nft, curl.

---

### Task 1: Management Model And Renderer

**Files:**
- Create: `deploy/ipv6-proxy/ipv6_proxyctl.py`
- Create: `deploy/ipv6-proxy/tests/test_ipv6_proxyctl.py`

**Step 1: Write failing model tests**

Cover stable unique IPv6 generation inside `2a0a:4cc0:101:319::/64`, sequential public/private ports, collision rejection, and preservation of existing entries.

**Step 2: Run tests and verify RED**

Run: `python3 -m unittest discover -s deploy/ipv6-proxy/tests -v`

Expected: import or missing-function failures caused by the absent implementation.

**Step 3: Implement the minimum ledger functions**

Implement JSON load/save, validation, `add`, and `remove` with atomic replacement and mode `0600` for sensitive state.

**Step 4: Run tests and verify GREEN**

Run the same unittest command and require zero failures.

**Step 5: Add failing renderer tests**

Assert that each entry produces two SOCKS inbounds, one source-bound direct outbound, and two inbound-to-outbound route rules. Assert public users are populated and local users are empty.

**Step 6: Implement rendering and verify GREEN**

Render deterministic JSON and rerun all tests.

### Task 2: CLI Safety And Credential Lifecycle

**Files:**
- Modify: `deploy/ipv6-proxy/ipv6_proxyctl.py`
- Modify: `deploy/ipv6-proxy/tests/test_ipv6_proxyctl.py`

**Step 1: Write failing CLI tests**

Cover `init`, `list`, `add`, `remove`, `render`, `rotate-credentials`, duplicate ports, invalid IDs, and refusal to remove an unknown entry.

**Step 2: Verify RED**

Run the focused unittest module and confirm failures are due to missing behavior.

**Step 3: Implement minimal CLI behavior**

Keep credentials in a separate root-only environment file. Never print credentials except for the explicit `show-credentials` command.

**Step 4: Verify GREEN**

Run the entire management test suite.

### Task 3: Deployment Assets

**Files:**
- Create: `deploy/ipv6-proxy/install.sh`
- Create: `deploy/ipv6-proxy/systemd/ipv6-proxy.service`
- Create: `deploy/ipv6-proxy/systemd/ipv6-proxy-prepare.service`
- Create: `deploy/ipv6-proxy/README.md`

**Step 1: Add static validation assertions**

Add tests that load unit files and assert ordering, restart policy, restricted filesystem access, and `ExecStartPre` configuration validation.

**Step 2: Verify RED**

Run tests before creating assets.

**Step 3: Create installer and units**

Pin sing-box 1.13.19 with a known SHA-256, install under `/usr/local/bin`, install the CLI under `/usr/local/sbin`, create `/etc/ipv6-proxy-manager`, and enable the two services. Make installation idempotent.

**Step 4: Validate locally**

Run:

```bash
bash -n deploy/ipv6-proxy/install.sh
python3 -m unittest discover -s deploy/ipv6-proxy/tests -v
```

### Task 4: Two-Egress Proof On Target

**Files:**
- Remote temporary configuration under `/run/ipv6-proxy-proof`

**Step 1: Install the pinned sing-box binary without enabling production**

Verify its checksum and version.

**Step 2: Add two temporary IPv6 aliases with cleanup traps**

Wait for DAD and fail on `dadfailed`.

**Step 3: Run a minimal two-listener configuration**

Validate it with `sing-box check`, start it in the foreground/background under `/run`, and query both SOCKS ports.

**Step 4: Assert independent egress**

Require listener A to return address A, listener B to return address B, and A not equal B. Repeat requests to catch route drift.

**Step 5: Clean up proof state**

Stop the proof process and remove both temporary aliases regardless of outcome.

### Task 5: Install Initial 100-Entry Deployment

**Files:**
- Remote: `/usr/local/sbin/ipv6-proxyctl`
- Remote: `/etc/ipv6-proxy-manager/proxies.json`
- Remote: `/etc/ipv6-proxy-manager/credentials.env`
- Remote: `/etc/ipv6-proxy-manager/sing-box.json`
- Remote: `/etc/systemd/system/ipv6-proxy-prepare.service`
- Remote: `/etc/systemd/system/ipv6-proxy.service`

**Step 1: Transfer the tested deployment bundle**

Copy into a temporary remote staging directory and verify hashes.

**Step 2: Run the idempotent installer**

Generate one random credential pair and 100 stable mappings. Do not emit secrets to command output.

**Step 3: Validate before activation**

Run ledger validation, `sing-box check`, port-conflict checks, and IPv6 duplicate checks.

**Step 4: Activate aliases and service**

Enable preparation and proxy services, then require active systemd state.

### Task 6: Firewall Reconciliation

**Files:**
- Modify: `deploy/ipv6-proxy/ipv6_proxyctl.py`
- Modify: `deploy/ipv6-proxy/tests/test_ipv6_proxyctl.py`

**Step 1: Write failing firewall command tests**

Assert only enabled public ports are accepted and local ports are never exposed.

**Step 2: Implement idempotent reconciliation**

Integrate with the existing 1Panel IPv4 input chain without changing its default policy. Persist reconciliation through the prepare service.

**Step 3: Verify rule placement and reachability**

Check the live nftables rules and test a public listener from the local workstation.

### Task 7: Full Acceptance

**Files:**
- No new files

**Step 1: Validate inventory and listeners**

Require exactly 100 enabled entries, 100 unique IPv6 addresses, 100 public ports, 100 local ports, and 200 listening sockets.

**Step 2: Verify all local egress mappings**

Query all 100 local SOCKS listeners. Fail if any observed address differs from its ledger value or if the set cardinality is not 100.

Repeat several requests through the same listener and require an identical
address on every request.

**Step 3: Verify public authentication**

For sampled public ports, prove missing and bad credentials fail. Then query all 100 with valid credentials and enforce exact mapping and uniqueness.

**Step 4: Verify restart persistence**

Restart preparation/proxy services and repeat inventory, listener, and egress checks.

**Step 5: Confirm server health**

Verify the existing `sub2api.service`, SSH, and original default IPv6 egress remain healthy.

### Task 8: Handoff

**Files:**
- Update: `deploy/ipv6-proxy/README.md`

Document CLI examples, credential and ledger paths, public/private proxy URL formats, backup requirements, and rollback steps. Report paths and verification counts without printing credentials.

Document that Sub2API entries use `socks5h`, retain a stable `proxy_id`, and set
`fallback_mode=none` to prevent direct or backup-proxy egress changes.
