CREATE TABLE IF NOT EXISTS "afiliado_pagamento_itens" (
	"pagamento_id" uuid NOT NULL,
	"reserva_id" uuid NOT NULL,
	"valor_centavos" integer NOT NULL,
	CONSTRAINT "afiliado_pagamento_itens_reservaId_unique" UNIQUE("reserva_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "afiliado_pagamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"afiliado_id" uuid NOT NULL,
	"unidade_id" uuid,
	"data_pagamento" date NOT NULL,
	"periodo_de" date NOT NULL,
	"periodo_ate" date NOT NULL,
	"total_centavos" integer NOT NULL,
	"lancamento_id" uuid NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "afiliado_pagamento_itens" ADD CONSTRAINT "afiliado_pagamento_itens_pagamento_id_afiliado_pagamentos_id_fk" FOREIGN KEY ("pagamento_id") REFERENCES "public"."afiliado_pagamentos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "afiliado_pagamento_itens" ADD CONSTRAINT "afiliado_pagamento_itens_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "afiliado_pagamentos" ADD CONSTRAINT "afiliado_pagamentos_afiliado_id_afiliados_id_fk" FOREIGN KEY ("afiliado_id") REFERENCES "public"."afiliados"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "afiliado_pagamentos" ADD CONSTRAINT "afiliado_pagamentos_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "afiliado_pagamentos" ADD CONSTRAINT "afiliado_pagamentos_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "afiliado_pagamentos_data_idx" ON "afiliado_pagamentos" USING btree ("data_pagamento");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "afiliados_paytour_uq" ON "afiliados" USING btree ("paytour_afiliado_id") WHERE paytour_afiliado_id is not null;