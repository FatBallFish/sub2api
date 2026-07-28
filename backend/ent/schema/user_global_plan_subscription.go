package schema

import (
	"time"

	"github.com/Wei-Shaw/sub2api/ent/schema/mixins"

	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// UserGlobalPlanSubscription holds user-level global plan entitlements.
type UserGlobalPlanSubscription struct {
	ent.Schema
}

func (UserGlobalPlanSubscription) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "user_global_plan_subscriptions"},
	}
}

func (UserGlobalPlanSubscription) Mixin() []ent.Mixin {
	return []ent.Mixin{
		mixins.SoftDeleteMixin{},
	}
}

func (UserGlobalPlanSubscription) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("user_id"),
		field.Int64("plan_id"),
		field.String("plan_category").
			MaxLen(64).
			Default("default"),
		field.String("applicable_group_mode").
			MaxLen(20).
			Default("all"),
		field.JSON("applicable_group_ids", []int64{}).
			Default([]int64{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.String("status").
			MaxLen(20).
			Default("active"),
		field.Time("starts_at").
			SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
		field.Time("expires_at").
			SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
		field.Time("current_period_start").
			SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
		field.Time("current_period_end").
			SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
		field.String("quota_period").
			MaxLen(20).
			Default("week"),
		field.Float("quota_limit_usd").
			SchemaType(map[string]string{dialect.Postgres: "decimal(20,10)"}).
			Default(0),
		field.Float("quota_used_usd").
			SchemaType(map[string]string{dialect.Postgres: "decimal(20,10)"}).
			Default(0),
		field.Int("tier_rank").
			Default(0),
		field.String("plan_name_snapshot").
			MaxLen(100).
			Default(""),
		field.Int64("source_order_id").
			Optional().
			Nillable(),
		field.Int64("assigned_by").
			Optional().
			Nillable(),
		field.Time("assigned_at").
			Default(time.Now).
			SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
		field.String("notes").
			Optional().
			Nillable().
			SchemaType(map[string]string{dialect.Postgres: "text"}),
		field.Time("last_reset_at").
			Optional().
			Nillable().
			SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
		field.JSON("metadata", map[string]any{}).
			Optional().
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.Time("created_at").
			Immutable().
			Default(time.Now).
			SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now).
			SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
	}
}

func (UserGlobalPlanSubscription) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).
			Ref("global_plan_subscriptions").
			Field("user_id").
			Unique().
			Required(),
		edge.From("plan", SubscriptionPlan.Type).
			Ref("global_plan_subscriptions").
			Field("plan_id").
			Unique().
			Required(),
		edge.From("source_order", PaymentOrder.Type).
			Ref("global_plan_subscriptions").
			Field("source_order_id").
			Unique(),
		edge.From("assigned_by_user", User.Type).
			Ref("assigned_global_plan_subscriptions").
			Field("assigned_by").
			Unique(),
		edge.To("usage_logs", UsageLog.Type),
	}
}

func (UserGlobalPlanSubscription) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("user_id"),
		index.Fields("plan_id"),
		index.Fields("status"),
		index.Fields("user_id", "plan_category", "status"),
		index.Fields("expires_at"),
		index.Fields("current_period_end"),
		index.Fields("user_id", "status", "expires_at"),
		index.Fields("deleted_at"),
	}
}
