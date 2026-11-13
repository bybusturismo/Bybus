CREATE TABLE IF NOT EXISTS "orcamentos_rota" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" text NOT NULL,
	"unidade_id" uuid,
	"cliente" text NOT NULL,
	"contato" text,
	"grupo_id" uuid,
	"data_passeio" date,
	"horario_inicio" text,
	"veiculo" text DEFAULT 'ONIBUS' NOT NULL,
	"pessoas" integer,
	"pontos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"distancia_km" double precision,
	"duracao_rota_min" integer,
	"folga_min" integer DEFAULT 30 NOT NULL,
	"carga_horaria_min" integer,
	"valor_calculado_centavos" integer,
	"valor_final_centavos" integer,
	"validade_dias" integer DEFAULT 15 NOT NULL,
	"observacoes" text,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orcamentos_rota_numero_unique" UNIQUE("numero")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orcamentos_rota" ADD CONSTRAINT "orcamentos_rota_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orcamentos_rota" ADD CONSTRAINT "orcamentos_rota_grupo_id_grupos_fechados_id_fk" FOREIGN KEY ("grupo_id") REFERENCES "public"."grupos_fechados"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orcamentos_rota" ADD CONSTRAINT "orcamentos_rota_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orcamentos_rota_criado_idx" ON "orcamentos_rota" USING btree ("criado_em");