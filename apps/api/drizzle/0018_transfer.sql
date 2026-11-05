CREATE TABLE IF NOT EXISTS "transfer_bairros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passeio_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"ordem_busca" integer NOT NULL,
	"horario_referencia" text,
	"horario_a_confirmar" boolean DEFAULT true NOT NULL,
	"ponto_embarque_id" uuid,
	"ativo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transfer_config" (
	"passeio_id" uuid PRIMARY KEY NOT NULL,
	"taxa_por_passageiro_centavos" integer DEFAULT 4000 NOT NULL,
	"taxa_a_confirmar" boolean DEFAULT true NOT NULL,
	"intervalo_minutos" integer DEFAULT 5 NOT NULL,
	"ponto_encontro_id" uuid,
	"chegada_prevista" text,
	"motorista_padrao_id" uuid,
	"veiculo_padrao_id" uuid,
	"veiculo_padrao_texto" text,
	"lugares_padrao" integer,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transfer_dias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"saida_id" uuid NOT NULL,
	"veiculo_id" uuid,
	"veiculo_texto" text,
	"motorista_id" uuid,
	"lugares" integer,
	"ponto_encontro_id" uuid,
	"chegada_prevista" text,
	"observacoes" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_dias_saidaId_unique" UNIQUE("saida_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transfer_reservas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_dia_id" uuid NOT NULL,
	"reserva_id" uuid NOT NULL,
	"bairro_id" uuid,
	"endereco_busca" text,
	"horario_busca" text,
	"ordem" integer DEFAULT 0 NOT NULL,
	"situacao" text DEFAULT 'A_CONFIRMAR' NOT NULL,
	"situacao_em" timestamp with time zone,
	"situacao_por" uuid,
	"taxa_centavos" integer DEFAULT 0 NOT NULL,
	"taxa_forma" text,
	"taxa_situacao" text DEFAULT 'A_RECEBER' NOT NULL,
	"recebido_por" uuid,
	"recebido_em" timestamp with time zone,
	"editados" text[] DEFAULT '{}'::text[] NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_reservas_reservaId_unique" UNIQUE("reserva_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer_bairros" ADD CONSTRAINT "transfer_bairros_passeio_id_passeios_id_fk" FOREIGN KEY ("passeio_id") REFERENCES "public"."passeios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer_bairros" ADD CONSTRAINT "transfer_bairros_ponto_embarque_id_pontos_embarque_id_fk" FOREIGN KEY ("ponto_embarque_id") REFERENCES "public"."pontos_embarque"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer_config" ADD CONSTRAINT "transfer_config_passeio_id_passeios_id_fk" FOREIGN KEY ("passeio_id") REFERENCES "public"."passeios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer_config" ADD CONSTRAINT "transfer_config_ponto_encontro_id_pontos_embarque_id_fk" FOREIGN KEY ("ponto_encontro_id") REFERENCES "public"."pontos_embarque"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer_config" ADD CONSTRAINT "transfer_config_motorista_padrao_id_pessoas_id_fk" FOREIGN KEY ("motorista_padrao_id") REFERENCES "public"."pessoas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer_config" ADD CONSTRAINT "transfer_config_veiculo_padrao_id_veiculos_id_fk" FOREIGN KEY ("veiculo_padrao_id") REFERENCES "public"."veiculos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer_dias" ADD CONSTRAINT "transfer_dias_saida_id_saidas_id_fk" FOREIGN KEY ("saida_id") REFERENCES "public"."saidas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer_dias" ADD CONSTRAINT "transfer_dias_veiculo_id_veiculos_id_fk" FOREIGN KEY ("veiculo_id") REFERENCES "public"."veiculos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer_dias" ADD CONSTRAINT "transfer_dias_motorista_id_pessoas_id_fk" FOREIGN KEY ("motorista_id") REFERENCES "public"."pessoas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer_dias" ADD CONSTRAINT "transfer_dias_ponto_encontro_id_pontos_embarque_id_fk" FOREIGN KEY ("ponto_encontro_id") REFERENCES "public"."pontos_embarque"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer_reservas" ADD CONSTRAINT "transfer_reservas_transfer_dia_id_transfer_dias_id_fk" FOREIGN KEY ("transfer_dia_id") REFERENCES "public"."transfer_dias"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer_reservas" ADD CONSTRAINT "transfer_reservas_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer_reservas" ADD CONSTRAINT "transfer_reservas_bairro_id_transfer_bairros_id_fk" FOREIGN KEY ("bairro_id") REFERENCES "public"."transfer_bairros"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer_reservas" ADD CONSTRAINT "transfer_reservas_situacao_por_usuarios_id_fk" FOREIGN KEY ("situacao_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer_reservas" ADD CONSTRAINT "transfer_reservas_recebido_por_usuarios_id_fk" FOREIGN KEY ("recebido_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "transfer_bairros_passeio_nome_uq" ON "transfer_bairros" USING btree ("passeio_id",lower("nome"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transfer_reservas_dia_idx" ON "transfer_reservas" USING btree ("transfer_dia_id","ordem");--> statement-breakpoint
UPDATE "perfis" SET "permissoes" = array_append("permissoes", 'transfer:operar') WHERE "codigo" = 'MOTORISTA' AND NOT ('transfer:operar' = ANY("permissoes"));
--> statement-breakpoint
UPDATE "perfis" SET "permissoes" = array_append("permissoes", 'transfer:gerenciar') WHERE "codigo" = 'SUPERVISOR' AND NOT ('transfer:gerenciar' = ANY("permissoes"));
