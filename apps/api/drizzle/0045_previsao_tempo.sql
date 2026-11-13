CREATE TABLE IF NOT EXISTS "tempo_normais" (
	"unidade_id" uuid NOT NULL,
	"dia_ano" text NOT NULL,
	"prob_chuva" integer NOT NULL,
	"temp_min" integer NOT NULL,
	"temp_max" integer NOT NULL,
	"chuva_mm" double precision NOT NULL,
	CONSTRAINT "tempo_normais_unidade_id_dia_ano_pk" PRIMARY KEY("unidade_id","dia_ano")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tempo_previsoes" (
	"unidade_id" uuid NOT NULL,
	"data" date NOT NULL,
	"icone" text NOT NULL,
	"temp_min" integer,
	"temp_max" integer,
	"chuva_mm" double precision,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tempo_previsoes_unidade_id_data_pk" PRIMARY KEY("unidade_id","data")
);
--> statement-breakpoint
ALTER TABLE "unidades" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "unidades" ADD COLUMN "longitude" double precision;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tempo_normais" ADD CONSTRAINT "tempo_normais_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tempo_previsoes" ADD CONSTRAINT "tempo_previsoes_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Centro das praças (coordenadas públicas da cidade) para a previsão do tempo.
UPDATE "unidades" SET "latitude" = -27.5954, "longitude" = -48.5480 WHERE "codigo" = 'FLN' AND "latitude" IS NULL;--> statement-breakpoint
UPDATE "unidades" SET "latitude" = -26.9906, "longitude" = -48.6348 WHERE "codigo" = 'BC' AND "latitude" IS NULL;--> statement-breakpoint
UPDATE "unidades" SET "latitude" = -26.9194, "longitude" = -49.0661 WHERE "codigo" = 'BNU' AND "latitude" IS NULL;
