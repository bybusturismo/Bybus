CREATE TABLE IF NOT EXISTS "avaliacao_externas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"semana" date NOT NULL,
	"canal" text NOT NULL,
	"alvo" text DEFAULT 'PROPRIA' NOT NULL,
	"unidade_id" uuid,
	"nota_centesimos" integer NOT NULL,
	"quantidade" integer NOT NULL,
	"registrado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bio_botoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rotulo" text NOT NULL,
	"url" text NOT NULL,
	"tipo" text DEFAULT 'OUTRO' NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"destaque" boolean DEFAULT false NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bio_cliques" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dia" date NOT NULL,
	"chave" text NOT NULL,
	"origem" text DEFAULT 'direto' NOT NULL,
	"contagem" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campanha_custos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campanha_id" uuid NOT NULL,
	"dia" date NOT NULL,
	"custo_centavos" integer NOT NULL,
	"cliques" integer,
	"impressoes" integer,
	"fonte" text DEFAULT 'CSV' NOT NULL,
	"importado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fluxos_mensagem" (
	"codigo" text PRIMARY KEY NOT NULL,
	"ligado" boolean DEFAULT false NOT NULL,
	"texto_pt" text,
	"texto_en" text,
	"texto_es" text,
	"extra" text,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_por" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nps_respostas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reserva_id" uuid NOT NULL,
	"saida_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_expira_em" timestamp with time zone NOT NULL,
	"idioma" text DEFAULT 'pt' NOT NULL,
	"enviado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"nota" integer,
	"comentario" text,
	"respondido_em" timestamp with time zone,
	"classe" text,
	"aceitou_convite" boolean,
	"caso_status" text,
	"caso_nota" text,
	"caso_responsavel_id" uuid,
	"caso_atualizado_em" timestamp with time zone,
	CONSTRAINT "nps_respostas_reservaId_unique" UNIQUE("reserva_id"),
	CONSTRAINT "nps_respostas_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orcamentos_grupo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"organizacao" text NOT NULL,
	"tipo_grupo" text DEFAULT 'OUTRO' NOT NULL,
	"telefone" text,
	"email" text,
	"data_pretendida" date,
	"pessoas" integer NOT NULL,
	"servico" text NOT NULL,
	"cidade_origem" text,
	"mensagem" text,
	"consentimento_em" timestamp with time zone NOT NULL,
	"consentimento_versao" text NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"status" text DEFAULT 'NOVO' NOT NULL,
	"responsavel_id" uuid,
	"anotacoes" text,
	"anonimizado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "relatorios_marketing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" text NOT NULL,
	"de" date NOT NULL,
	"ate" date NOT NULL,
	"unidade_id" uuid,
	"dados" jsonb NOT NULL,
	"resumo_numeros" text NOT NULL,
	"resumo_ia" text,
	"gerado_por" uuid,
	"gerado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "avaliacao_pedidos" ADD COLUMN "idioma" text DEFAULT 'pt' NOT NULL;--> statement-breakpoint
ALTER TABLE "avaliacao_pedidos" ADD COLUMN "canal_avaliacao" text DEFAULT 'NENHUM' NOT NULL;--> statement-breakpoint
ALTER TABLE "avaliacao_pedidos" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "avaliacao_pedidos" ADD COLUMN "pedido_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "avaliacao_pedidos" ADD COLUMN "lembrete_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "avaliacao_pedidos" ADD COLUMN "avaliado_em" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "avaliacao_externas" ADD CONSTRAINT "avaliacao_externas_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "avaliacao_externas" ADD CONSTRAINT "avaliacao_externas_registrado_por_usuarios_id_fk" FOREIGN KEY ("registrado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campanha_custos" ADD CONSTRAINT "campanha_custos_campanha_id_campanhas_id_fk" FOREIGN KEY ("campanha_id") REFERENCES "public"."campanhas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campanha_custos" ADD CONSTRAINT "campanha_custos_importado_por_usuarios_id_fk" FOREIGN KEY ("importado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fluxos_mensagem" ADD CONSTRAINT "fluxos_mensagem_atualizado_por_usuarios_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nps_respostas" ADD CONSTRAINT "nps_respostas_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nps_respostas" ADD CONSTRAINT "nps_respostas_saida_id_saidas_id_fk" FOREIGN KEY ("saida_id") REFERENCES "public"."saidas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nps_respostas" ADD CONSTRAINT "nps_respostas_caso_responsavel_id_usuarios_id_fk" FOREIGN KEY ("caso_responsavel_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orcamentos_grupo" ADD CONSTRAINT "orcamentos_grupo_responsavel_id_usuarios_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "relatorios_marketing" ADD CONSTRAINT "relatorios_marketing_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "relatorios_marketing" ADD CONSTRAINT "relatorios_marketing_gerado_por_usuarios_id_fk" FOREIGN KEY ("gerado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "avaliacao_externas_semana_idx" ON "avaliacao_externas" USING btree ("semana");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bio_cliques_uq" ON "bio_cliques" USING btree ("dia","chave","origem");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campanha_custos_dia_uq" ON "campanha_custos" USING btree ("campanha_id","dia");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nps_respostas_resp_idx" ON "nps_respostas" USING btree ("respondido_em");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nps_respostas_saida_idx" ON "nps_respostas" USING btree ("saida_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orcamentos_grupo_status_idx" ON "orcamentos_grupo" USING btree ("status","criado_em");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "relatorios_marketing_periodo_idx" ON "relatorios_marketing" USING btree ("de");