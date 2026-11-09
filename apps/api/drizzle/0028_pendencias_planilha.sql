CREATE TABLE IF NOT EXISTS "fin_planilha_pendencias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid,
	"arquivo" text,
	"hash" text NOT NULL,
	"conteudo_cifrado" text,
	"pendentes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"resolvido_em" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_planilha_pendencias" ADD CONSTRAINT "fin_planilha_pendencias_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_planilha_pendencias" ADD CONSTRAINT "fin_planilha_pendencias_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fin_planilha_pendencias_hash_uq" ON "fin_planilha_pendencias" USING btree ("hash");