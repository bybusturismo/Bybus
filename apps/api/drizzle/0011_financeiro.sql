CREATE TABLE IF NOT EXISTS "fin_categorias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"nome" text NOT NULL,
	"tipo" text NOT NULL,
	"grupo" text NOT NULL,
	"ordem" integer DEFAULT 100 NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"sistema" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_categorias_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fin_contas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid,
	"nome" text NOT NULL,
	"tipo" text NOT NULL,
	"banco" text,
	"final_conta" text,
	"saldo_inicial_centavos" bigint DEFAULT 0 NOT NULL,
	"saldo_inicial_em" date,
	"dia_fechamento" integer,
	"dia_vencimento" integer,
	"conta_pagamento_id" uuid,
	"ativa" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fin_extrato_linhas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conta_id" uuid NOT NULL,
	"extrato_id" uuid,
	"id_unico" text NOT NULL,
	"data" date NOT NULL,
	"valor_centavos" bigint NOT NULL,
	"descricao" text DEFAULT '' NOT NULL,
	"documento" text,
	"status" text DEFAULT 'PENDENTE' NOT NULL,
	"lancamento_id" uuid,
	"par_linha_id" uuid,
	"manual" boolean DEFAULT false NOT NULL,
	"observacao" text,
	"decidido_por" uuid,
	"decidido_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fin_extratos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conta_id" uuid NOT NULL,
	"arquivo" text,
	"formato" text NOT NULL,
	"inicio" date,
	"fim" date,
	"saldo_centavos" bigint,
	"linhas" integer DEFAULT 0 NOT NULL,
	"novas" integer DEFAULT 0 NOT NULL,
	"repetidas" integer DEFAULT 0 NOT NULL,
	"importado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fin_lancamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" text NOT NULL,
	"descricao" text NOT NULL,
	"contraparte" text,
	"categoria_id" uuid NOT NULL,
	"conta_id" uuid,
	"unidade_id" uuid,
	"linha" text,
	"veiculo" text,
	"canal" text,
	"forma" text,
	"valor_centavos" bigint NOT NULL,
	"competencia" date NOT NULL,
	"vencimento" date NOT NULL,
	"situacao" text DEFAULT 'ABERTO' NOT NULL,
	"pago_em" date,
	"valor_pago_centavos" bigint,
	"juros_centavos" bigint DEFAULT 0 NOT NULL,
	"multa_centavos" bigint DEFAULT 0 NOT NULL,
	"desconto_centavos" bigint DEFAULT 0 NOT NULL,
	"grupo_id" uuid,
	"parcela_numero" integer,
	"parcela_total" integer,
	"recorrente" boolean DEFAULT false NOT NULL,
	"observacao" text,
	"origem" text DEFAULT 'MANUAL' NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fin_recusas" (
	"linha_id" uuid NOT NULL,
	"lancamento_id" uuid NOT NULL,
	"recusado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fin_regras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"texto" text NOT NULL,
	"tipo" text,
	"categoria_id" uuid NOT NULL,
	"unidade_id" uuid,
	"linha" text,
	"prioridade" integer DEFAULT 0 NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_contas" ADD CONSTRAINT "fin_contas_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_extrato_linhas" ADD CONSTRAINT "fin_extrato_linhas_conta_id_fin_contas_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."fin_contas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_extrato_linhas" ADD CONSTRAINT "fin_extrato_linhas_extrato_id_fin_extratos_id_fk" FOREIGN KEY ("extrato_id") REFERENCES "public"."fin_extratos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_extrato_linhas" ADD CONSTRAINT "fin_extrato_linhas_lancamento_id_fin_lancamentos_id_fk" FOREIGN KEY ("lancamento_id") REFERENCES "public"."fin_lancamentos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_extrato_linhas" ADD CONSTRAINT "fin_extrato_linhas_decidido_por_usuarios_id_fk" FOREIGN KEY ("decidido_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_extratos" ADD CONSTRAINT "fin_extratos_conta_id_fin_contas_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."fin_contas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_extratos" ADD CONSTRAINT "fin_extratos_importado_por_usuarios_id_fk" FOREIGN KEY ("importado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_lancamentos" ADD CONSTRAINT "fin_lancamentos_categoria_id_fin_categorias_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."fin_categorias"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_lancamentos" ADD CONSTRAINT "fin_lancamentos_conta_id_fin_contas_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."fin_contas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_lancamentos" ADD CONSTRAINT "fin_lancamentos_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_lancamentos" ADD CONSTRAINT "fin_lancamentos_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_recusas" ADD CONSTRAINT "fin_recusas_linha_id_fin_extrato_linhas_id_fk" FOREIGN KEY ("linha_id") REFERENCES "public"."fin_extrato_linhas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_recusas" ADD CONSTRAINT "fin_recusas_lancamento_id_fin_lancamentos_id_fk" FOREIGN KEY ("lancamento_id") REFERENCES "public"."fin_lancamentos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_recusas" ADD CONSTRAINT "fin_recusas_recusado_por_usuarios_id_fk" FOREIGN KEY ("recusado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_regras" ADD CONSTRAINT "fin_regras_categoria_id_fin_categorias_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."fin_categorias"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_regras" ADD CONSTRAINT "fin_regras_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fin_contas_unidade_idx" ON "fin_contas" USING btree ("unidade_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fin_linhas_conta_id_uq" ON "fin_extrato_linhas" USING btree ("conta_id","id_unico");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fin_linhas_lancamento_uq" ON "fin_extrato_linhas" USING btree ("lancamento_id") WHERE lancamento_id is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fin_linhas_conta_data_idx" ON "fin_extrato_linhas" USING btree ("conta_id","data");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fin_linhas_status_idx" ON "fin_extrato_linhas" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fin_extratos_conta_idx" ON "fin_extratos" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fin_lanc_tipo_situacao_venc_idx" ON "fin_lancamentos" USING btree ("tipo","situacao","vencimento");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fin_lanc_unidade_idx" ON "fin_lancamentos" USING btree ("unidade_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fin_lanc_grupo_idx" ON "fin_lancamentos" USING btree ("grupo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fin_lanc_competencia_idx" ON "fin_lancamentos" USING btree ("competencia");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fin_recusas_uq" ON "fin_recusas" USING btree ("linha_id","lancamento_id");