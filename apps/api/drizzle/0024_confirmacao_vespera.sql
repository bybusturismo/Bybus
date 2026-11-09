CREATE TABLE IF NOT EXISTS "confirmacao_regras" (
	"id" text PRIMARY KEY DEFAULT 'padrao' NOT NULL,
	"ligado" boolean DEFAULT true NOT NULL,
	"contar_por" text DEFAULT 'RESERVAS' NOT NULL,
	"pagas_para_confirmar" integer DEFAULT 10 NOT NULL,
	"total_para_confirmar" integer DEFAULT 16 NOT NULL,
	"pagas_minimas_no_total" integer DEFAULT 8 NOT NULL,
	"hora_previa" text DEFAULT '09:00' NOT NULL,
	"hora_limite" text DEFAULT '18:00' NOT NULL,
	"atualizado_por" uuid,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saidas" ADD COLUMN "confirmada_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "saidas" ADD COLUMN "confirmada_por" uuid;--> statement-breakpoint
ALTER TABLE "saidas" ADD COLUMN "confirmada_automatica" boolean;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "confirmacao_regras" ADD CONSTRAINT "confirmacao_regras_atualizado_por_usuarios_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Listas já fechadas contam como saídas confirmadas (o fechamento das 21h confirma).
UPDATE "saidas" SET "confirmada_em" = "lista_fechada_em", "confirmada_automatica" = true WHERE "lista_fechada_em" IS NOT NULL AND "confirmada_em" IS NULL;
