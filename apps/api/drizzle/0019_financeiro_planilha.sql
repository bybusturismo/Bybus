CREATE TABLE IF NOT EXISTS "fin_fechamentos_caixa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conta_id" uuid NOT NULL,
	"data" date NOT NULL,
	"saldo_inicial_centavos" bigint NOT NULL,
	"entradas_centavos" bigint NOT NULL,
	"saidas_centavos" bigint NOT NULL,
	"saldo_calculado_centavos" bigint NOT NULL,
	"saldo_contado_centavos" bigint NOT NULL,
	"diferenca_centavos" bigint NOT NULL,
	"observacao" text,
	"fechado_por" uuid,
	"fechado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fin_fornecedores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"nome_normalizado" text NOT NULL,
	"contato_cifrado" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_fornecedores_nomeNormalizado_unique" UNIQUE("nome_normalizado")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fin_revendas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"descricao" text NOT NULL,
	"fornecedor" text,
	"unidade_id" uuid,
	"data_venda" date NOT NULL,
	"valor_venda_centavos" bigint NOT NULL,
	"valor_repasse_centavos" bigint NOT NULL,
	"comissao_centavos" bigint DEFAULT 0 NOT NULL,
	"vendedor" text,
	"venda_lancamento_id" uuid,
	"repasse_lancamento_id" uuid,
	"comissao_lancamento_id" uuid,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fin_sinonimos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" text NOT NULL,
	"texto" text NOT NULL,
	"alvo" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fin_lancamentos" ADD COLUMN "fornecedor_id" uuid;--> statement-breakpoint
ALTER TABLE "fin_lancamentos" ADD COLUMN "chave_importacao" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_fechamentos_caixa" ADD CONSTRAINT "fin_fechamentos_caixa_conta_id_fin_contas_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."fin_contas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_fechamentos_caixa" ADD CONSTRAINT "fin_fechamentos_caixa_fechado_por_usuarios_id_fk" FOREIGN KEY ("fechado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_revendas" ADD CONSTRAINT "fin_revendas_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_revendas" ADD CONSTRAINT "fin_revendas_venda_lancamento_id_fin_lancamentos_id_fk" FOREIGN KEY ("venda_lancamento_id") REFERENCES "public"."fin_lancamentos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_revendas" ADD CONSTRAINT "fin_revendas_repasse_lancamento_id_fin_lancamentos_id_fk" FOREIGN KEY ("repasse_lancamento_id") REFERENCES "public"."fin_lancamentos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_revendas" ADD CONSTRAINT "fin_revendas_comissao_lancamento_id_fin_lancamentos_id_fk" FOREIGN KEY ("comissao_lancamento_id") REFERENCES "public"."fin_lancamentos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_revendas" ADD CONSTRAINT "fin_revendas_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fin_fechamentos_caixa_uq" ON "fin_fechamentos_caixa" USING btree ("conta_id","data");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fin_revendas_data_idx" ON "fin_revendas" USING btree ("data_venda");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fin_sinonimos_uq" ON "fin_sinonimos" USING btree ("tipo","texto");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_lancamentos" ADD CONSTRAINT "fin_lancamentos_fornecedor_id_fin_fornecedores_id_fk" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."fin_fornecedores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fin_lanc_chave_importacao_uq" ON "fin_lancamentos" USING btree ("chave_importacao") WHERE chave_importacao is not null;