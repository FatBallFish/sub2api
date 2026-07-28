//go:build unit

package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/stretchr/testify/require"
)

func TestGlobalPlanAppliesToGroup(t *testing.T) {
	tests := []struct {
		name     string
		snapshot *GlobalPlanSnapshot
		groupID  int64
		want     bool
	}{
		{name: "nil snapshot", groupID: 1},
		{name: "invalid group", snapshot: &GlobalPlanSnapshot{ApplicableGroupMode: PlanApplicableGroupModeAll}},
		{name: "all groups", snapshot: &GlobalPlanSnapshot{ApplicableGroupMode: PlanApplicableGroupModeAll}, groupID: 1, want: true},
		{name: "whitelist match", snapshot: &GlobalPlanSnapshot{ApplicableGroupMode: PlanApplicableGroupModeWhitelist, ApplicableGroupIDs: []int64{1, 2}}, groupID: 2, want: true},
		{name: "whitelist miss", snapshot: &GlobalPlanSnapshot{ApplicableGroupMode: PlanApplicableGroupModeWhitelist, ApplicableGroupIDs: []int64{1, 2}}, groupID: 3},
		{name: "blacklist match", snapshot: &GlobalPlanSnapshot{ApplicableGroupMode: PlanApplicableGroupModeBlacklist, ApplicableGroupIDs: []int64{1, 2}}, groupID: 2},
		{name: "blacklist miss", snapshot: &GlobalPlanSnapshot{ApplicableGroupMode: PlanApplicableGroupModeBlacklist, ApplicableGroupIDs: []int64{1, 2}}, groupID: 3, want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, globalPlanAppliesToGroup(tt.snapshot, tt.groupID))
		})
	}
}

func TestGlobalPlanServiceHasApplicableRemainingRejectsInvalidIdentity(t *testing.T) {
	svc := NewGlobalPlanService(nil)

	available, err := svc.HasApplicableRemaining(context.Background(), 0, 1, time.Time{})
	require.NoError(t, err)
	require.False(t, available)

	available, err = svc.HasApplicableRemaining(context.Background(), 1, 0, time.Time{})
	require.NoError(t, err)
	require.False(t, available)

	available, err = svc.HasApplicableRemaining(context.Background(), 1, 1, time.Time{})
	require.NoError(t, err)
	require.False(t, available)
}

func TestAPIKeyServiceGlobalPlanEligibilityChecker(t *testing.T) {
	cfg := &config.Config{}
	svc := NewAPIKeyService(nil, nil, nil, nil, nil, nil, cfg)

	available, err := svc.HasApplicableGlobalPlanRemaining(context.Background(), 1, 2)
	require.NoError(t, err)
	require.False(t, available)

	svc.SetGlobalPlanEligibilityChecker(globalPlanEligibilityStub{available: true})
	available, err = svc.HasApplicableGlobalPlanRemaining(context.Background(), 1, 2)
	require.NoError(t, err)
	require.True(t, available)

	wantErr := errors.New("global plan unavailable")
	svc.SetGlobalPlanEligibilityChecker(globalPlanEligibilityStub{err: wantErr})
	available, err = svc.HasApplicableGlobalPlanRemaining(context.Background(), 1, 2)
	require.ErrorIs(t, err, wantErr)
	require.False(t, available)
}
