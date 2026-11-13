CREATE TABLE IF NOT EXISTS "veiculos_ordens_anexos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ordem_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"nome_arquivo" text NOT NULL,
	"mime" text NOT NULL,
	"tamanho" integer NOT NULL,
	"dados_cifrados" text NOT NULL,
	"enviado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "veiculos_ordens" ADD COLUMN "km_revisao" integer;--> statement-breakpoint
ALTER TABLE "veiculos_ordens" ADD COLUMN "valor_pecas_centavos" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "veiculos_ordens" ADD COLUMN "valor_servico_centavos" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_ordens_anexos" ADD CONSTRAINT "veiculos_ordens_anexos_ordem_id_veiculos_ordens_id_fk" FOREIGN KEY ("ordem_id") REFERENCES "public"."veiculos_ordens"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_ordens_anexos" ADD CONSTRAINT "veiculos_ordens_anexos_enviado_por_usuarios_id_fk" FOREIGN KEY ("enviado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "veiculos_ordens_anexos_ordem_idx" ON "veiculos_ordens_anexos" USING btree ("ordem_id");