CREATE TABLE IF NOT EXISTS "vendas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pedido_codigo" text NOT NULL,
	"fonte" text NOT NULL,
	"canal_venda" text NOT NULL,
	"valor_centavos" integer NOT NULL,
	"subtotal_centavos" integer,
	"desconto_centavos" integer DEFAULT 0 NOT NULL,
	"cupom_externo_id" text,
	"metodo_pagamento" text,
	"metodo_pagamento_externo" text,
	"tipo_pagamento" text,
	"parcelas" integer,
	"data_hora_compra" timestamp with time zone,
	"operador_id" text,
	"afiliado_id" text,
	"afiliado_comissao_centavos" integer,
	"parceiro_id" text,
	"parceiro_comissao_centavos" integer,
	"pagamento_pendente_centavos" integer DEFAULT 0 NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"cliente_cidade" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendas_pedidoCodigo_unique" UNIQUE("pedido_codigo")
);
--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "venda_id" uuid;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "valor_centavos" integer;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "desconto_centavos" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendas_compra_idx" ON "vendas" USING btree ("data_hora_compra");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reservas" ADD CONSTRAINT "reservas_venda_id_vendas_id_fk" FOREIGN KEY ("venda_id") REFERENCES "public"."vendas"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservas_venda_idx" ON "reservas" USING btree ("venda_id");