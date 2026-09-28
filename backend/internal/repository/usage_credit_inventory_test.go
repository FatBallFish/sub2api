package repository

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestUsageLogRepositoryGetRemainingCreditInventory(t *testing.T) {
	db, mock := newSQLMock(t)
	repo := &usageLogRepository{sql: db}

	mock.ExpectQuery("SELECT COALESCE\\(SUM\\(GREATEST\\(balance, 0\\)\\), 0\\)").
		WillReturnRows(sqlmock.NewRows([]string{"remaining_balance"}).AddRow(12.5))
	mock.ExpectQuery("SELECT COALESCE\\(SUM\\(GREATEST\\(\\s+CASE\\s+WHEN current_period_end <= NOW\\(\\) THEN quota_limit_usd").
		WillReturnRows(sqlmock.NewRows([]string{"remaining_global_plan"}).AddRow(80.0))
	mock.ExpectQuery("SELECT COALESCE\\(SUM\\(GREATEST\\([\\s\\S]*THEN LEAST\\(").
		WillReturnRows(sqlmock.NewRows([]string{"remaining_group_subscription"}).AddRow(60.0))

	inventory, err := repo.getRemainingCreditInventory(context.Background())
	require.NoError(t, err)
	require.InDelta(t, 12.5, inventory.remainingBalanceCredits, 0.0001)
	require.InDelta(t, 140.0, inventory.remainingSubscriptionCredits, 0.0001)
	require.NoError(t, mock.ExpectationsWereMet())
}
