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

// CreemProductBinding maps a trusted Creem one-time Product to a local entitlement.
type CreemProductBinding struct{ ent.Schema }

func (CreemProductBinding) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "creem_product_bindings"}}
}

func (CreemProductBinding) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("provider_instance_id"),
		field.String("external_product_id").MaxLen(128).NotEmpty(),
		field.String("target_type").MaxLen(20).NotEmpty(),
		field.Int64("plan_id").Optional().Nillable(),
		field.Float("credited_balance").Optional().Nillable().SchemaType(map[string]string{dialect.Postgres: "decimal(20,2)"}),
		field.String("product_name").MaxLen(255).Default(""),
		field.Int64("price_minor"),
		field.String("currency").MaxLen(3).NotEmpty(),
		field.String("billing_type").MaxLen(20).Default("onetime"),
		field.String("product_status").MaxLen(20).Default("active"),
		field.String("tax_mode").MaxLen(20).Default("exclusive"),
		field.String("environment").MaxLen(10).NotEmpty(),
		field.Bool("enabled").Default(true).StructTag(`json:"enabled"`),
		field.String("health_status").MaxLen(20).Default("healthy"),
		field.String("health_reason").SchemaType(map[string]string{dialect.Postgres: "text"}).Default(""),
		field.Int("sort_order").Default(0),
		field.Time("last_synced_at").Optional().Nillable().SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
		field.Time("created_at").Immutable().Default(time.Now).SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now).SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
	}
}

func (CreemProductBinding) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("provider_instance_id", "external_product_id").Unique(),
		index.Fields("target_type", "plan_id", "enabled"),
		index.Fields("provider_instance_id", "enabled"),
	}
}
