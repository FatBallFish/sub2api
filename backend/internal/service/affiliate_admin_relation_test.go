//go:build unit

package service

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type adminRelationAffiliateRepoStub struct {
	setInput  *AdminSetInviteRelationInput
	setCalls  int
	unbindIDs []int64
}

func (r *adminRelationAffiliateRepoStub) EnsureUserAffiliate(ctx context.Context, userID int64) (*AffiliateSummary, error) {
	return &AffiliateSummary{UserID: userID}, nil
}
func (r *adminRelationAffiliateRepoStub) GetAffiliateByCode(ctx context.Context, code string) (*AffiliateSummary, error) {
	return nil, ErrAffiliateCodeInvalid
}
func (r *adminRelationAffiliateRepoStub) BindInviter(ctx context.Context, userID, inviterID int64) (bool, error) {
	return false, nil
}
func (r *adminRelationAffiliateRepoStub) AccrueQuota(ctx context.Context, inviterID, inviteeUserID int64, amount float64, freezeHours int, sourceOrderID *int64) (bool, error) {
	return false, nil
}
func (r *adminRelationAffiliateRepoStub) GetAccruedRebateFromInvitee(ctx context.Context, inviterID, inviteeUserID int64) (float64, error) {
	return 0, nil
}
func (r *adminRelationAffiliateRepoStub) ThawFrozenQuota(ctx context.Context, userID int64) (float64, error) {
	return 0, nil
}
func (r *adminRelationAffiliateRepoStub) TransferQuotaToBalance(ctx context.Context, userID int64) (float64, float64, error) {
	return 0, 0, nil
}
func (r *adminRelationAffiliateRepoStub) WithdrawQuota(ctx context.Context, userID int64, amount float64, operationID string) (*AffiliateWithdrawResult, error) {
	return nil, nil
}
func (r *adminRelationAffiliateRepoStub) ListInvitees(ctx context.Context, inviterID int64, limit int) ([]AffiliateInvitee, error) {
	return nil, nil
}
func (r *adminRelationAffiliateRepoStub) UpdateUserAffCode(ctx context.Context, userID int64, newCode string) error {
	return nil
}
func (r *adminRelationAffiliateRepoStub) ResetUserAffCode(ctx context.Context, userID int64) (string, error) {
	return "", nil
}
func (r *adminRelationAffiliateRepoStub) SetUserRebateRate(ctx context.Context, userID int64, ratePercent *float64) error {
	return nil
}
func (r *adminRelationAffiliateRepoStub) BatchSetUserRebateRate(ctx context.Context, userIDs []int64, ratePercent *float64) error {
	return nil
}
func (r *adminRelationAffiliateRepoStub) ListUsersWithCustomSettings(ctx context.Context, filter AffiliateAdminFilter) ([]AffiliateAdminEntry, int64, error) {
	return nil, 0, nil
}
func (r *adminRelationAffiliateRepoStub) ListAffiliateInviteRecords(ctx context.Context, filter AffiliateRecordFilter) ([]AffiliateInviteRecord, int64, error) {
	return nil, 0, nil
}
func (r *adminRelationAffiliateRepoStub) ListAffiliateRebateRecords(ctx context.Context, filter AffiliateRecordFilter) ([]AffiliateRebateRecord, int64, error) {
	return nil, 0, nil
}
func (r *adminRelationAffiliateRepoStub) ListAffiliateTransferRecords(ctx context.Context, filter AffiliateRecordFilter) ([]AffiliateTransferRecord, int64, error) {
	return nil, 0, nil
}
func (r *adminRelationAffiliateRepoStub) GetAffiliateUserOverview(ctx context.Context, userID int64) (*AffiliateUserOverview, error) {
	return nil, nil
}
func (r *adminRelationAffiliateRepoStub) AdminSetInviteBinding(ctx context.Context, inviteeID, inviterID int64, invitedAt time.Time, force bool) (*AffiliateInviteBinding, error) {
	r.setCalls++
	input := AdminSetInviteRelationInput{InviterID: inviterID, InviteeID: inviteeID, InvitedAt: invitedAt, Force: force}
	r.setInput = &input
	return &AffiliateInviteBinding{InviteeID: inviteeID, InviterID: inviterID, InvitedAt: invitedAt}, nil
}
func (r *adminRelationAffiliateRepoStub) AdminUnbindInvites(ctx context.Context, inviteeIDs []int64) (int, error) {
	r.unbindIDs = inviteeIDs
	return len(inviteeIDs), nil
}
func (r *adminRelationAffiliateRepoStub) GetActiveBindingByInvitee(ctx context.Context, inviteeID int64) (*AffiliateInviteBinding, error) {
	return nil, nil
}

func TestAdminSetInviteRelationValidation(t *testing.T) {
	repo := &adminRelationAffiliateRepoStub{}
	svc := &AffiliateService{repo: repo}
	ctx := context.Background()

	t.Run("拒绝自己邀请自己", func(t *testing.T) {
		_, err := svc.AdminSetInviteRelation(ctx, AdminSetInviteRelationInput{InviterID: 7, InviteeID: 7})
		require.ErrorIs(t, err, ErrAffiliateSelfInvite)
		require.Zero(t, repo.setCalls)
	})

	t.Run("拒绝无效用户 ID", func(t *testing.T) {
		_, err := svc.AdminSetInviteRelation(ctx, AdminSetInviteRelationInput{InviterID: 0, InviteeID: 7})
		require.Error(t, err)
		_, err = svc.AdminSetInviteRelation(ctx, AdminSetInviteRelationInput{InviterID: 7, InviteeID: -1})
		require.Error(t, err)
		require.Zero(t, repo.setCalls)
	})

	t.Run("拒绝未来邀请时间", func(t *testing.T) {
		_, err := svc.AdminSetInviteRelation(ctx, AdminSetInviteRelationInput{
			InviterID: 1, InviteeID: 2,
			InvitedAt: time.Now().Add(48 * time.Hour),
		})
		require.ErrorIs(t, err, ErrAffiliateInviteTimeInvalid)
		require.Zero(t, repo.setCalls)
	})

	t.Run("合法输入透传 force 与邀请时间", func(t *testing.T) {
		invitedAt := time.Now().Add(-72 * time.Hour).Truncate(time.Second)
		binding, err := svc.AdminSetInviteRelation(ctx, AdminSetInviteRelationInput{
			InviterID: 1, InviteeID: 2, InvitedAt: invitedAt, Force: true,
		})
		require.NoError(t, err)
		require.Equal(t, int64(2), binding.InviteeID)
		require.Equal(t, 1, repo.setCalls)
		require.True(t, repo.setInput.Force)
		require.Equal(t, invitedAt.Unix(), repo.setInput.InvitedAt.Unix())
	})

	t.Run("邀请时间零值默认当前时间", func(t *testing.T) {
		before := time.Now().Add(-time.Minute)
		_, err := svc.AdminSetInviteRelation(ctx, AdminSetInviteRelationInput{InviterID: 1, InviteeID: 3})
		require.NoError(t, err)
		require.True(t, repo.setInput.InvitedAt.After(before))
	})
}

func TestAdminUnbindInviteRelations(t *testing.T) {
	repo := &adminRelationAffiliateRepoStub{}
	svc := &AffiliateService{repo: repo}

	unbound, err := svc.AdminUnbindInviteRelations(context.Background(), []int64{11, 12})
	require.NoError(t, err)
	require.Equal(t, 2, unbound)
	require.Equal(t, []int64{11, 12}, repo.unbindIDs)
}
