CREATE TABLE IF NOT EXISTS "veiculos_links_gps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"veiculo_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"descricao" text NOT NULL,
	"expira_em" timestamp with time zone,
	"revogado_em" timestamp with time zone,
	"ultimo_acesso_em" timestamp with time zone,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "veiculos_links_gps_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_links_gps" ADD CONSTRAINT "veiculos_links_gps_veiculo_id_veiculos_id_fk" FOREIGN KEY ("veiculo_id") REFERENCES "public"."veiculos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_links_gps" ADD CONSTRAINT "veiculos_links_gps_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "veiculos_links_gps_veiculo_idx" ON "veiculos_links_gps" USING btree ("veiculo_id");