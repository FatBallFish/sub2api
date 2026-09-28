package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// CreemRefundEvent records an externally initiated refund and its clawback result.
type CreemRefundEvent struct{ ent.Schema }

func (CreemRefundEvent) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "creem_refund_events"}}
}

func (CreemRefundEvent) Fields() []ent.Field {
	return []ent.Field{
		field.String("event_id").MaxLen(128).NotEmpty().Unique(),
		field.String("provider_refund_id").MaxLen(128).NotEmpty().Unique(),
		field.Int64("provider_instance_id"),
		field.Int64("payment_order_id").Optional().Nillable(),
		field.String("transaction_id").MaxLen(128).NotEmpty(),
		field.Int64("refund_amount_minor"),
		field.Int64("cumulative_refunded_minor"),
		field.Int64("transaction_amount_paid_minor"),
		field.String("currency").MaxLen(3).NotEmpty(),
		field.Float("refund_ratio").SchemaType(map[string]string{dialect.Postgres: "decimal(12,10)"}).Default(0),
		field.String("status").MaxLen(20).Default("received"),
		field.JSON("recovery_snapshot", map[string]any{}).Optional().SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.JSON("raw_payload", map[string]any{}).Optional().SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.Int("attempts").Default(0),
		field.String("last_error").SchemaType(map[string]string{dialect.Postgres: "text"}).Default(""),
		field.Time("processed_at").Optional().Nillable().SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
		field.Time("created_at").Immutable().Default(time.Now).SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now).SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
	}
}

func (CreemRefundEvent) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("payment_order_id"),
		index.Fields("provider_instance_id", "status"),
		index.Fields("transaction_id"),
		index.Fields("status", "created_at"),
	}
}
