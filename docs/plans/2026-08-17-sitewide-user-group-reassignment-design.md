# Sitewide User Group Reassignment Design

## Goal

Create a standalone Python script that reconciles active ordinary users into the correct research or non-research OpenAI and Anthropic subscription groups, migrates their active API keys, and removes redundant subscriptions.

## Scope

- Process only users with `status=active` and `role=user`.
- Skip users whose email appears in the case-insensitive built-in whitelist.
- Classify a user as research when the `dingtalk_department` custom attribute contains `研发部`; otherwise classify the user as non-research.
- Use only Sub2API administrator endpoints authenticated by the hard-coded Admin API Key.
- Default to dry-run. Require `--apply` for writes.

## Managed Groups

The script recognizes active subscription groups whose names strictly match one of these prefixes followed by a positive integer daily USD quota:

- `OpenAI - 研发分组 -`
- `Anthropic - 研发分组 -`
- `OpenAI - 非研发分组 -`
- `Anthropic - 非研发分组 -`

The group platform must agree with the prefix. Duplicate groups for the same platform, employee type, and quota are fatal catalog errors.

## Reconciliation Rules

Reconciliation runs independently for OpenAI and Anthropic.

1. Convert every active managed subscription into a candidate for the user's required employee type. A wrong-type subscription maps to the same platform and quota in the correct type.
2. Choose the highest-quota candidate as the platform winner.
3. If the user has no managed subscription for that platform, choose the correct 200 USD group.
4. Assign the winner for 999 days when the user does not already have an active subscription to it.
5. Rebind every active, unexpired API key currently bound to any managed group on that platform to the winner.
6. After all required key updates succeed, revoke every other active managed subscription for that platform.

Thus, a research user with a 200 USD research subscription and a 500 USD non-research subscription finishes with only the 500 USD research subscription, and all managed OpenAI keys point to it.

## Safety And Failure Handling

Before any write, the script fetches all required data and builds the complete plan. It aborts if group names are ambiguous, a default 200 USD group is absent, or any wrong-type quota lacks a corresponding correct-type group.

Writes are ordered as assign, key migration, then revoke. If assignment or any key update fails for a user and platform, the script does not revoke old subscriptions for that user and platform. Processing continues for other users, records failures, and exits non-zero. Re-running is safe because the plan is recalculated from current state and existing winning subscriptions or key bindings are not rewritten unnecessarily.

## API Flow

- `GET /api/v1/admin/users` with `status=active`, `role=user`, and pagination.
- `GET /api/v1/admin/user-attributes` to find the `dingtalk_department` definition.
- `POST /api/v1/admin/user-attributes/batch` in bounded batches. Because the batch endpoint omits users without stored attributes, confirm omitted users through `GET /api/v1/admin/users/:id/attributes`; any failed confirmation aborts preflight.
- `GET /api/v1/admin/groups/all` for the active group catalog.
- `GET /api/v1/admin/subscriptions?status=active` with pagination.
- `GET /api/v1/admin/users/:id/api-keys` with pagination.
- `POST /api/v1/admin/subscriptions/assign` for missing winners.
- `PUT /api/v1/admin/api-keys/:id` to change `group_id`.
- `POST /api/v1/admin/subscriptions/:id/revoke` after successful key migration.

## Testing

Keep planning and execution logic separate from HTTP calls. Unit tests cover classification, strict group parsing, catalog validation, highest-quota selection, wrong-type conversion, default assignment, whitelist handling, active-key filtering, operation order, dry-run behavior, and revoke suppression after a write failure. Syntax compilation and the complete unit suite provide final verification without contacting the configured production host.
