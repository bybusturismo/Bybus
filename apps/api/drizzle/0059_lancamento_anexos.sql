CREATE TABLE IF NOT EXISTS "fin_lancamento_anexos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lancamento_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"nome_arquivo" text NOT NULL,
	"mime" text NOT NULL,
	"tamanho" integer NOT NULL,
	"dados_cifrados" text NOT NULL,
	"enviado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_lancamento_anexos" ADD CONSTRAINT "fin_lancamento_anexos_lancamento_id_fin_lancamentos_id_fk" FOREIGN KEY ("lancamento_id") REFERENCES "public"."fin_lancamentos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_lancamento_anexos" ADD CONSTRAINT "fin_lancamento_anexos_enviado_por_usuarios_id_fk" FOREIGN KEY ("enviado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fin_lancamento_anexos_lanc_idx" ON "fin_lancamento_anexos" USING btree ("lancamento_id");