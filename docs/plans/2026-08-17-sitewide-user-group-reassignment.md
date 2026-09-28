# Sitewide User Group Reassignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a safe, rerunnable Python administrator script that reconciles active users, subscriptions, and API key group bindings by DingTalk department.

**Architecture:** The script separates a standard-library HTTP client from pure catalog parsing and reconciliation planning. It performs a complete read and preflight first, then executes per-user/per-platform operations in assign-key-revoke order, with dry-run as the default.

**Tech Stack:** Python 3 standard library (`argparse`, `dataclasses`, `datetime`, `json`, `re`, `urllib`), `unittest`

---

### Task 1: Pure Reconciliation Rules

**Files:**
- Create: `/Users/fatballfish/Documents/Projects/PycharmProjects/playground/sub2/test_全站用户分组重分配.py`
- Create: `/Users/fatballfish/Documents/Projects/PycharmProjects/playground/sub2/全站用户分组重分配.py`

**Step 1: Write the failing tests**

Add tests for department classification, strict managed-group parsing, duplicate catalog rejection, wrong-type quota mapping, per-platform highest-quota selection, 200 USD fallback, whitelist normalization, and active/unexpired API key filtering.

**Step 2: Run tests to verify they fail**

Run: `python3 -m unittest -v test_全站用户分组重分配.py`

Expected: FAIL because the target module has no implementation.

**Step 3: Write minimal pure implementation**

Implement immutable group metadata, catalog construction, user classification, key activity checks, and a pure `build_user_plan` function.

**Step 4: Run tests to verify they pass**

Run: `python3 -m unittest -v test_全站用户分组重分配.py`

Expected: all Task 1 tests PASS.

### Task 2: API Collection And Preflight

**Files:**
- Modify: `/Users/fatballfish/Documents/Projects/PycharmProjects/playground/sub2/test_全站用户分组重分配.py`
- Modify: `/Users/fatballfish/Documents/Projects/PycharmProjects/playground/sub2/全站用户分组重分配.py`

**Step 1: Write the failing tests**

Use a fake API client to assert paginated collection, user filters, department batch lookup, active subscription indexing, API key pagination, and fatal preflight behavior.

**Step 2: Run tests to verify they fail**

Run: `python3 -m unittest -v test_全站用户分组重分配.py`

Expected: FAIL on missing collection functions.

**Step 3: Write minimal implementation**

Implement the `AdminAPI` request wrapper and data collection functions. Keep the production host, Admin API Key, whitelist, timeout, validity, and page size at the top of the script.

**Step 4: Run tests to verify they pass**

Run: `python3 -m unittest -v test_全站用户分组重分配.py`

Expected: all Task 1 and Task 2 tests PASS.

### Task 3: Safe Execution And CLI

**Files:**
- Modify: `/Users/fatballfish/Documents/Projects/PycharmProjects/playground/sub2/test_全站用户分组重分配.py`
- Modify: `/Users/fatballfish/Documents/Projects/PycharmProjects/playground/sub2/全站用户分组重分配.py`

**Step 1: Write the failing tests**

Add tests proving dry-run performs no writes, apply executes assign before key updates and revocations, a key failure suppresses revocation for that platform, whitelist users are skipped, and any execution error produces a failed summary.

**Step 2: Run tests to verify they fail**

Run: `python3 -m unittest -v test_全站用户分组重分配.py`

Expected: FAIL on missing executor and CLI behavior.

**Step 3: Write minimal implementation**

Implement per-platform execution, readable plan and summary output, `--apply`, and process exit codes. Do not add network concurrency because predictable ordering and safer failure isolation matter more than speed for this one-off administrator operation.

**Step 4: Run tests to verify they pass**

Run: `python3 -m unittest -v test_全站用户分组重分配.py`

Expected: all tests PASS.

### Task 4: Final Verification

**Files:**
- Verify: `/Users/fatballfish/Documents/Projects/PycharmProjects/playground/sub2/全站用户分组重分配.py`
- Verify: `/Users/fatballfish/Documents/Projects/PycharmProjects/playground/sub2/test_全站用户分组重分配.py`

**Step 1: Compile both files**

Run: `python3 -m py_compile 全站用户分组重分配.py test_全站用户分组重分配.py`

Expected: exit code 0.

**Step 2: Run the complete unit suite**

Run: `python3 -m unittest -v test_全站用户分组重分配.py`

Expected: all tests PASS without network access.

**Step 3: Inspect the final diff and configuration**

Confirm that only the intended files changed, dry-run is the default, production credentials are not printed, and no test calls the real API.

### Task 5: Append-Only Progress Reporting

**Files:**
- Modify: `/Users/fatballfish/Documents/Projects/PycharmProjects/playground/sub2/test_全站用户分组重分配.py`
- Modify: `/Users/fatballfish/Documents/Projects/PycharmProjects/playground/sub2/全站用户分组重分配.py`

**Step 1: Write the failing tests**

Add callback-based tests for paginated loading progress, department batches, group discovery, per-user API-key loading, plan generation, and write-operation progress before and after each request.

**Step 2: Run tests to verify they fail**

Run: `python3 -m unittest -v test_全站用户分组重分配.ProgressReportingTests`

Expected: FAIL because collection, planning, and execution do not accept a progress callback.

**Step 3: Write minimal implementation**

Thread an optional progress callback through collection, planning, and execution. Keep pure reconciliation functions output-free, and pass `print` from the CLI.

**Step 4: Run tests to verify they pass**

Run: `python3 -m unittest -v test_全站用户分组重分配.ProgressReportingTests`

Expected: all progress tests PASS, followed by the complete suite.

### Task 6: Security Technology Department Classification

**Files:**
- Modify: `/Users/fatballfish/Documents/Projects/PycharmProjects/playground/sub2/test_全站用户分组重分配.py`
- Modify: `/Users/fatballfish/Documents/Projects/PycharmProjects/playground/sub2/全站用户分组重分配.py`

**Step 1: Write the failing test**

Assert that `安全技术部` and `安全技术部/安全平台组` are research, while `集团/安全技术部` and an unrelated `技术部` remain non-research under the new prefix rule.

**Step 2: Run the focused test to verify it fails**

Run: `python3 -m unittest -v test_全站用户分组重分配.ReassignmentRuleTests.test_security_technology_department_uses_literal_prefix`

Expected: FAIL because the current classifier only checks for `研发部`.

**Step 3: Implement the literal prefix check**

Add a named `安全技术部` prefix constant and combine `startswith` with the existing `研发部` containment rule.

**Step 4: Run focused and complete tests**

Expected: the focused test and complete suite PASS.
