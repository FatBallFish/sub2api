package service

import (
	"encoding/json"
	"time"
)

// OpenAIAutoUseCreditsExtraKey 开启后：账号未显式配置某窗口的暂停阈值且该窗口
// 未禁用自动暂停时，若 Codex 积分快照新鲜可花，则窗口打满不自动暂停调度，
// 请求由上游按积分承接。显式配置了阈值的窗口照常百分比暂停（管理员保护意图优先）。
const OpenAIAutoUseCreditsExtraKey = "auto_use_credits_when_window_full"

// openAICreditsSnapshotFreshFor bounds how long a cached Codex credits
// snapshot (codex_credits_snapshot, written by /wham/usage reads) keeps an
// account exempt from window-exhaustion pauses. If credits actually run dry
// earlier, the upstream starts answering 429 and the reactive rate-limit path
// parks the account until the window resets, so a generous freshness window
// costs at most one wasted request.
const openAICreditsSnapshotFreshFor = 24 * time.Hour

// openAIAutoUseCreditsEnabled 只对 OpenAI OAuth 母账号生效，与自动用卡同一账号
// 范围；默认关闭，历史账号升级后行为不变。
func openAIAutoUseCreditsEnabled(account *Account) bool {
	if !isOpenAIAutoResetCreditAccount(account) || account.Extra == nil {
		return false
	}
	return resolveAccountExtraBool(account.Extra, OpenAIAutoUseCreditsExtraKey)
}

// openAIHasSpendableCredits reports whether the account's cached Codex credits
// snapshot shows a spendable balance (has_credits or unlimited) that is fresh
// enough to keep the account schedulable after its 5h/7d window is exhausted.
// The snapshot shape matches openAICreditsSnapshot as persisted by
// OpenAIQuotaService.CacheCreditsSnapshot; the extra map value may be a
// map[string]any after a DB round-trip, so it is re-encoded before decoding.
func openAIHasSpendableCredits(extra map[string]any, now time.Time) bool {
	if len(extra) == 0 {
		return false
	}
	raw, ok := extra[openaiQuotaCreditsKey]
	if !ok || raw == nil {
		return false
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return false
	}
	var snapshot openAICreditsSnapshot
	if err := json.Unmarshal(encoded, &snapshot); err != nil || snapshot.Credits == nil {
		return false
	}
	if !snapshot.Credits.HasCredits && !snapshot.Credits.Unlimited {
		return false
	}
	if snapshot.FetchedAt <= 0 {
		return false
	}
	return now.Sub(time.Unix(snapshot.FetchedAt, 0)) < openAICreditsSnapshotFreshFor
}
