//go:build unit

package service

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func creditsSnapshotExtra(fetchedAt int64, hasCredits, unlimited bool) map[string]any {
	return map[string]any{
		openaiQuotaCreditsKey: map[string]any{
			"credits": map[string]any{
				"has_credits": hasCredits,
				"unlimited":   unlimited,
			},
			"fetched_at": float64(fetchedAt),
		},
	}
}

func TestOpenAIHasSpendableCredits(t *testing.T) {
	now := time.Now()
	fresh := now.Add(-time.Hour).Unix()

	t.Run("新鲜且有积分", func(t *testing.T) {
		require.True(t, openAIHasSpendableCredits(creditsSnapshotExtra(fresh, true, false), now))
	})
	t.Run("新鲜且 unlimited", func(t *testing.T) {
		require.True(t, openAIHasSpendableCredits(creditsSnapshotExtra(fresh, false, true), now))
	})
	t.Run("过期快照不再豁免", func(t *testing.T) {
		stale := now.Add(-openAICreditsSnapshotFreshFor - time.Minute).Unix()
		require.False(t, openAIHasSpendableCredits(creditsSnapshotExtra(stale, true, false), now))
	})
	t.Run("无积分或缺失", func(t *testing.T) {
		require.False(t, openAIHasSpendableCredits(creditsSnapshotExtra(fresh, false, false), now))
		require.False(t, openAIHasSpendableCredits(map[string]any{}, now))
		require.False(t, openAIHasSpendableCredits(nil, now))
	})
	t.Run("损坏快照按无数据处理", func(t *testing.T) {
		require.False(t, openAIHasSpendableCredits(map[string]any{openaiQuotaCreditsKey: "not-an-object"}, now))
	})
}

func TestOpenAIAutoUseCreditsEnabled(t *testing.T) {
	t.Run("仅 OpenAI OAuth 母账号生效", func(t *testing.T) {
		require.True(t, openAIAutoUseCreditsEnabled(&Account{
			Platform: PlatformOpenAI, Type: AccountTypeOAuth,
			Extra: map[string]any{OpenAIAutoUseCreditsExtraKey: true},
		}))
		require.False(t, openAIAutoUseCreditsEnabled(&Account{
			Platform: PlatformOpenAI, Type: AccountTypeAPIKey,
			Extra: map[string]any{OpenAIAutoUseCreditsExtraKey: true},
		}))
		require.False(t, openAIAutoUseCreditsEnabled(&Account{
			Platform: PlatformAnthropic, Type: AccountTypeOAuth,
			Extra: map[string]any{OpenAIAutoUseCreditsExtraKey: true},
		}))
	})
	t.Run("默认关闭", func(t *testing.T) {
		require.False(t, openAIAutoUseCreditsEnabled(&Account{
			Platform: PlatformOpenAI, Type: AccountTypeOAuth, Extra: map[string]any{},
		}))
	})
}

func TestShouldAutoPauseOpenAIAccountByQuota_AutoUseCredits(t *testing.T) {
	now := time.Now().UTC()
	// 场景基线：无显式阈值，依赖全局默认阈值（1.0 = 打满才停）。
	baseExtra := func() map[string]any {
		return map[string]any{
			OpenAIAutoUseCreditsExtraKey: true,
			"codex_5h_used_percent":      100.0,
			"codex_usage_updated_at":     now.Format(time.RFC3339),
			"codex_5h_reset_at":          now.Add(time.Hour).Format(time.RFC3339),
		}
	}
	ctx := withOpenAIQuotaAutoPauseSettings(context.Background(), OpsOpenAIAccountQuotaAutoPauseSettings{
		DefaultThreshold5h: 1.0,
		DefaultThreshold7d: 1.0,
	})
	freshCredits := creditsSnapshotExtra(now.Add(-time.Minute).Unix(), true, false)
	newAccount := func(extra map[string]any) *Account {
		return &Account{ID: 1, Platform: PlatformOpenAI, Type: AccountTypeOAuth, Extra: extra}
	}

	t.Run("开关关闭时打满照常暂停（默认行为）", func(t *testing.T) {
		extra := baseExtra()
		delete(extra, OpenAIAutoUseCreditsExtraKey)
		for k, v := range freshCredits {
			extra[k] = v
		}
		paused, decision := shouldAutoPauseOpenAIAccountByQuota(ctx, newAccount(extra))
		require.True(t, paused)
		require.Equal(t, "5h", decision.window)
	})

	t.Run("开关开启且积分可花时打满不暂停", func(t *testing.T) {
		extra := baseExtra()
		for k, v := range freshCredits {
			extra[k] = v
		}
		paused, _ := shouldAutoPauseOpenAIAccountByQuota(ctx, newAccount(extra))
		require.False(t, paused)
	})

	t.Run("开关开启但积分快照缺失时照常暂停", func(t *testing.T) {
		paused, decision := shouldAutoPauseOpenAIAccountByQuota(ctx, newAccount(baseExtra()))
		require.True(t, paused)
		require.Equal(t, "5h", decision.window)
	})

	t.Run("开关开启但积分快照过期时照常暂停", func(t *testing.T) {
		extra := baseExtra()
		stale := creditsSnapshotExtra(now.Add(-openAICreditsSnapshotFreshFor-time.Minute).Unix(), true, false)
		for k, v := range stale {
			extra[k] = v
		}
		paused, _ := shouldAutoPauseOpenAIAccountByQuota(ctx, newAccount(extra))
		require.True(t, paused)
	})

	t.Run("显式配置了窗口阈值时开关不生效（管理员保护优先）", func(t *testing.T) {
		extra := baseExtra()
		extra["auto_pause_5h_threshold"] = 0.8
		for k, v := range freshCredits {
			extra[k] = v
		}
		paused, decision := shouldAutoPauseOpenAIAccountByQuota(ctx, newAccount(extra))
		require.True(t, paused)
		require.Equal(t, "5h", decision.window)
	})

	t.Run("显式阈值仅作用其窗口，未配置窗口仍可用积分续调度", func(t *testing.T) {
		extra := baseExtra()
		extra["auto_pause_5h_threshold"] = 0.8 // 5h 显式保护
		for k, v := range freshCredits {
			extra[k] = v
		}
		// 5h 打满 → 暂停（显式阈值）
		paused, _ := shouldAutoPauseOpenAIAccountByQuota(ctx, newAccount(extra))
		require.True(t, paused)

		// 去掉 5h 显式阈值，仅 7d 显式：5h 打满且积分可花 → 不暂停
		extra2 := baseExtra()
		extra2["auto_pause_7d_threshold"] = 0.8
		for k, v := range freshCredits {
			extra2[k] = v
		}
		paused2, _ := shouldAutoPauseOpenAIAccountByQuota(ctx, newAccount(extra2))
		require.False(t, paused2)
	})

	t.Run("自动用卡的消费阈值暂停不被开关覆盖", func(t *testing.T) {
		extra := baseExtra()
		extra[OpenAIAutoResetCreditEnabledExtraKey] = true
		extra[OpenAIAutoResetCredit5hThresholdExtraKey] = 0.5
		extra[OpenAIAutoResetCredit7dThresholdExtraKey] = 1.0
		for k, v := range freshCredits {
			extra[k] = v
		}
		paused, _ := shouldAutoPauseOpenAIAccountByQuota(ctx, newAccount(extra))
		require.True(t, paused)
	})
}

func TestOpenAIQuotaAutoResetService_ShouldNotifyScan_AutoUseCredits(t *testing.T) {
	now := time.Now().UTC()
	svc := &OpenAIQuotaAutoResetService{}
	ctx := withOpenAIQuotaAutoPauseSettings(context.Background(), OpsOpenAIAccountQuotaAutoPauseSettings{
		DefaultThreshold5h: 1.0,
		DefaultThreshold7d: 1.0,
	})

	t.Run("自动用卡启用照旧纳入扫描", func(t *testing.T) {
		account := &Account{Platform: PlatformOpenAI, Type: AccountTypeOAuth, Extra: map[string]any{
			OpenAIAutoResetCreditEnabledExtraKey: true,
		}}
		require.True(t, svc.shouldNotifyScan(ctx, account))
	})

	t.Run("开关关闭的暂停候选不纳入扫描", func(t *testing.T) {
		account := &Account{Platform: PlatformOpenAI, Type: AccountTypeOAuth, Extra: map[string]any{
			"codex_5h_used_percent":  100.0,
			"codex_usage_updated_at": now.Format(time.RFC3339),
			"codex_5h_reset_at":      now.Add(time.Hour).Format(time.RFC3339),
		}}
		require.False(t, svc.shouldNotifyScan(ctx, account))
	})

	t.Run("开关开启的暂停候选纳入扫描以便刷新积分", func(t *testing.T) {
		account := &Account{Platform: PlatformOpenAI, Type: AccountTypeOAuth, Extra: map[string]any{
			OpenAIAutoUseCreditsExtraKey: true,
			"codex_5h_used_percent":      100.0,
			"codex_usage_updated_at":     now.Format(time.RFC3339),
			"codex_5h_reset_at":          now.Add(time.Hour).Format(time.RFC3339),
		}}
		require.True(t, svc.shouldNotifyScan(ctx, account))
	})

	t.Run("开关开启且持有新鲜积分的账号持续纳入扫描", func(t *testing.T) {
		extra := creditsSnapshotExtra(now.Add(-time.Minute).Unix(), true, false)
		extra[OpenAIAutoUseCreditsExtraKey] = true
		account := &Account{Platform: PlatformOpenAI, Type: AccountTypeOAuth, Extra: extra}
		require.True(t, svc.shouldNotifyScan(ctx, account))
	})

	t.Run("开关开启但健康且无积分的账号不纳入扫描", func(t *testing.T) {
		account := &Account{Platform: PlatformOpenAI, Type: AccountTypeOAuth, Extra: map[string]any{
			OpenAIAutoUseCreditsExtraKey: true,
			"codex_5h_used_percent":      10.0,
			"codex_usage_updated_at":     now.Format(time.RFC3339),
		}}
		require.False(t, svc.shouldNotifyScan(ctx, account))
	})
}

func TestOpenAIQuotaAutoResetService_RefreshCreditsSnapshot(t *testing.T) {
	now := time.Now().UTC()
	balance := "120.50"
	account := &Account{
		ID: 1201, Platform: PlatformOpenAI, Type: AccountTypeOAuth,
		Status: StatusActive, Schedulable: true,
		Extra: map[string]any{
			OpenAIAutoUseCreditsExtraKey: true,
			"codex_5h_used_percent":      100.0,
			// 无 codex_usage_updated_at → usage 快照视为过期，需要刷新
		},
	}
	repo := &autoResetTestAccountRepo{account: account}
	quota := &autoResetTestQuota{usage: &OpenAIQuotaUsage{
		FetchedAt: now.Unix(),
		RateLimit: &OpenAIRateLimit{PrimaryWindow: &OpenAIRateLimitWindow{
			UsedPercent: 100, LimitWindowSeconds: 5 * 3600, ResetAfterSeconds: int64((time.Hour).Seconds()),
		}},
		RateLimitResetCredits: &OpenAIRateLimitResetCredits{AvailableCount: 0},
		Credits:               &OpenAICredits{HasCredits: true, Balance: &balance},
	}}
	svc := &OpenAIQuotaAutoResetService{accountRepo: repo, quota: quota}

	t.Run("开关开启且快照过期时只刷新不消费", func(t *testing.T) {
		require.NoError(t, svc.evaluateAccount(context.Background(), account.ID))
		require.Equal(t, int32(1), quota.queryCalls.Load())
		require.Equal(t, int32(1), quota.creditsCalls.Load())
		require.Equal(t, int32(0), quota.resetCalls.Load())
		require.Contains(t, account.Extra, "codex_usage_updated_at", "刷新后应写回 usage 快照时间")
	})

	t.Run("快照新鲜时跳过查询", func(t *testing.T) {
		require.NoError(t, svc.evaluateAccount(context.Background(), account.ID))
		require.Equal(t, int32(1), quota.queryCalls.Load())
	})

	t.Run("开关关闭时完全不查询", func(t *testing.T) {
		closedAccount := &Account{
			ID: 1202, Platform: PlatformOpenAI, Type: AccountTypeOAuth,
			Status: StatusActive, Schedulable: true,
			Extra: map[string]any{"codex_5h_used_percent": 100.0},
		}
		repo := &autoResetTestAccountRepo{account: closedAccount}
		quota := &autoResetTestQuota{usage: &OpenAIQuotaUsage{FetchedAt: now.Unix()}}
		svc := &OpenAIQuotaAutoResetService{accountRepo: repo, quota: quota}
		require.NoError(t, svc.evaluateAccount(context.Background(), closedAccount.ID))
		require.Equal(t, int32(0), quota.queryCalls.Load())
	})
}
