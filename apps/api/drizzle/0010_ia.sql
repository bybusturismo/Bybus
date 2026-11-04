CREATE TABLE IF NOT EXISTS "ia_acoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"avaliacao_id" uuid NOT NULL,
	"titulo" text NOT NULL,
	"detalhe" text NOT NULL,
	"area" text NOT NULL,
	"prioridade" text DEFAULT 'media' NOT NULL,
	"prazo_dias" integer,
	"status" text DEFAULT 'SUGERIDA' NOT NULL,
	"decidida_por" uuid,
	"decidida_em" timestamp with time zone,
	"observacao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ia_avaliacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_ref" date NOT NULL,
	"origem" text DEFAULT 'MANUAL' NOT NULL,
	"status" text DEFAULT 'EXECUTANDO' NOT NULL,
	"modelo" text NOT NULL,
	"modelo_sintese" text NOT NULL,
	"iniciada_por" uuid,
	"iniciada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"concluida_em" timestamp with time zone,
	"erro" text,
	"retratos" jsonb,
	"sintese" jsonb,
	"custo_micro_usd" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ia_pareceres" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"avaliacao_id" uuid NOT NULL,
	"gestor" text NOT NULL,
	"rodada" integer NOT NULL,
	"conteudo" jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ia_uso" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"mes_ref" text NOT NULL,
	"tipo" text NOT NULL,
	"modelo" text NOT NULL,
	"tokens_entrada" integer DEFAULT 0 NOT NULL,
	"tokens_saida" integer DEFAULT 0 NOT NULL,
	"tokens_cache_leitura" integer DEFAULT 0 NOT NULL,
	"tokens_cache_escrita" integer DEFAULT 0 NOT NULL,
	"custo_micro_usd" integer DEFAULT 0 NOT NULL,
	"usuario_id" uuid,
	"avaliacao_id" uuid,
	"gestor" text,
	"ferramentas" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ia_acoes" ADD CONSTRAINT "ia_acoes_avaliacao_id_ia_avaliacoes_id_fk" FOREIGN KEY ("avaliacao_id") REFERENCES "public"."ia_avaliacoes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ia_acoes" ADD CONSTRAINT "ia_acoes_decidida_por_usuarios_id_fk" FOREIGN KEY ("decidida_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ia_avaliacoes" ADD CONSTRAINT "ia_avaliacoes_iniciada_por_usuarios_id_fk" FOREIGN KEY ("iniciada_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ia_pareceres" ADD CONSTRAINT "ia_pareceres_avaliacao_id_ia_avaliacoes_id_fk" FOREIGN KEY ("avaliacao_id") REFERENCES "public"."ia_avaliacoes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ia_uso" ADD CONSTRAINT "ia_uso_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ia_uso" ADD CONSTRAINT "ia_uso_avaliacao_id_ia_avaliacoes_id_fk" FOREIGN KEY ("avaliacao_id") REFERENCES "public"."ia_avaliacoes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ia_acoes_avaliacao_idx" ON "ia_acoes" USING btree ("avaliacao_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ia_acoes_status_idx" ON "ia_acoes" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ia_avaliacoes_data_idx" ON "ia_avaliacoes" USING btree ("data_ref");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ia_pareceres_uq" ON "ia_pareceres" USING btree ("avaliacao_id","gestor","rodada");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ia_uso_mes_idx" ON "ia_uso" USING btree ("mes_ref");