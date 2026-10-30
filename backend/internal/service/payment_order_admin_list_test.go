//go:build unit

package service

import (
	"context"
	"database/sql"
	"testing"
	"time"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/ent/enttest"
	"github.com/Wei-Shaw/sub2api/internal/payment"
	"github.com/stretchr/testify/require"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	_ "modernc.org/sqlite"
)

func TestAdminListOrdersFiltersByDateRange(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:payment_order_admin_list?mode=memory&cache=shared&_fk=1")
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	_, err = db.Exec("PRAGMA foreign_keys = ON")
	require.NoError(t, err)

	drv := entsql.OpenDB(dialect.SQLite, db)
	client := enttest.NewClient(t, enttest.WithOptions(dbent.Driver(drv)))
	t.Cleanup(func() { _ = client.Close() })

	user, err := client.User.Create().
		SetEmail("order-dates@example.com").
		SetPasswordHash("hash").
		SetUsername("order-dates-user").
		Save(ctx)
	require.NoError(t, err)

	now := time.Now().UTC()
	createOrder := func(name string, createdAt time.Time) {
		_, err := client.PaymentOrder.Create().
			SetUserID(user.ID).
			SetUserEmail(user.Email).
			SetUserName(user.Username).
			SetAmount(10).
			SetPayAmount(10).
			SetFeeRate(0).
			SetRechargeCode("RC-" + name).
			SetOutTradeNo(name).
			SetPaymentType(payment.TypeAlipay).
			SetPaymentTradeNo("").
			SetOrderType(payment.OrderTypeBalance).
			SetStatus(OrderStatusPending).
			SetExpiresAt(createdAt.Add(time.Hour)).
			SetClientIP("127.0.0.1").
			SetSrcHost("api.example.com").
			SetCreatedAt(createdAt).
			Save(ctx)
		require.NoError(t, err)
	}
	createOrder("sub2_order_old", now.AddDate(0, 0, -10))
	createOrder("sub2_order_mid", now.AddDate(0, 0, -2))
	createOrder("sub2_order_new", now)

	svc := &PaymentService{entClient: client}

	// 无时间过滤：全部 3 条
	all, total, err := svc.AdminListOrders(ctx, 0, OrderListParams{Page: 1, PageSize: 50})
	require.NoError(t, err)
	require.Len(t, all, 3)
	require.Equal(t, 3, total)

	// start_date=昨天：只剩最近两条（含今天与昨天附近创建的 mid/new）
	start := now.AddDate(0, 0, -3)
	recent, total, err := svc.AdminListOrders(ctx, 0, OrderListParams{Page: 1, PageSize: 50, StartTime: &start})
	require.NoError(t, err)
	require.Len(t, recent, 2)
	require.Equal(t, 2, total)

	// 闭开区间 [now-3d, now-1d)：只命中 mid（now-2d），排除 new（>= 上界）与 old（< 下界）
	end := now.AddDate(0, 0, -1)
	windowed, total, err := svc.AdminListOrders(ctx, 0, OrderListParams{Page: 1, PageSize: 50, StartTime: &start, EndTime: &end})
	require.NoError(t, err)
	require.Len(t, windowed, 1)
	require.Equal(t, 1, total)
	require.Equal(t, "sub2_order_mid", windowed[0].OutTradeNo)
}
