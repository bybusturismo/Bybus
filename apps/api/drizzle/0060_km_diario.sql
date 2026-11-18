CREATE TABLE IF NOT EXISTS "veiculos_km_diario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"veiculo_id" uuid NOT NULL,
	"data" date NOT NULL,
	"km_inicial" integer NOT NULL,
	"km_final" integer NOT NULL,
	"consumo_litros" double precision,
	"observacao" text,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_km_diario" ADD CONSTRAINT "veiculos_km_diario_veiculo_id_veiculos_id_fk" FOREIGN KEY ("veiculo_id") REFERENCES "public"."veiculos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_km_diario" ADD CONSTRAINT "veiculos_km_diario_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "veiculos_km_diario_dia_uk" ON "veiculos_km_diario" USING btree ("veiculo_id","data");