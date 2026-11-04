CREATE TABLE IF NOT EXISTS "checklist_itens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grupo" text NOT NULL,
	"descricao" text NOT NULL,
	"critico" boolean DEFAULT false NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "veiculos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid NOT NULL,
	"placa" text NOT NULL,
	"apelido" text,
	"tipo" text NOT NULL,
	"modelo" text,
	"ano" integer,
	"capacidade" integer,
	"chassi" text,
	"renavam" text,
	"linha_principal" text,
	"uso_publicitario" boolean DEFAULT false NOT NULL,
	"situacao" text DEFAULT 'ATIVO' NOT NULL,
	"km_atual" integer DEFAULT 0 NOT NULL,
	"observacoes" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "veiculos_abastecimentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"veiculo_id" uuid NOT NULL,
	"data" date NOT NULL,
	"km" integer NOT NULL,
	"litros" double precision NOT NULL,
	"valor_centavos" integer NOT NULL,
	"posto" text,
	"tanque_cheio" boolean DEFAULT true NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "veiculos_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"veiculo_id" uuid NOT NULL,
	"data" date NOT NULL,
	"usuario_id" uuid,
	"km" integer,
	"aprovado" boolean NOT NULL,
	"observacao" text,
	"respostas" jsonb NOT NULL,
	"ordem_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "veiculos_documentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"veiculo_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"descricao" text,
	"numero" text,
	"vencimento" date NOT NULL,
	"observacao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "veiculos_km" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"veiculo_id" uuid NOT NULL,
	"data" date NOT NULL,
	"km" integer NOT NULL,
	"fonte" text DEFAULT 'MANUAL' NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "veiculos_ordens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"veiculo_id" uuid NOT NULL,
	"plano_id" uuid,
	"tipo" text NOT NULL,
	"status" text DEFAULT 'ABERTA' NOT NULL,
	"descricao" text NOT NULL,
	"oficina" text,
	"pecas" text,
	"imobiliza" boolean DEFAULT false NOT NULL,
	"aberta_em" date NOT NULL,
	"concluida_em" date,
	"km" integer,
	"custo_centavos" integer DEFAULT 0 NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "veiculos_planos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"veiculo_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"intervalo_km" integer,
	"intervalo_dias" integer,
	"ultimo_km" integer,
	"ultima_data" date,
	"critico" boolean DEFAULT false NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_abastecimentos" ADD CONSTRAINT "veiculos_abastecimentos_veiculo_id_veiculos_id_fk" FOREIGN KEY ("veiculo_id") REFERENCES "public"."veiculos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_abastecimentos" ADD CONSTRAINT "veiculos_abastecimentos_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_checklists" ADD CONSTRAINT "veiculos_checklists_veiculo_id_veiculos_id_fk" FOREIGN KEY ("veiculo_id") REFERENCES "public"."veiculos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_checklists" ADD CONSTRAINT "veiculos_checklists_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_checklists" ADD CONSTRAINT "veiculos_checklists_ordem_id_veiculos_ordens_id_fk" FOREIGN KEY ("ordem_id") REFERENCES "public"."veiculos_ordens"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_documentos" ADD CONSTRAINT "veiculos_documentos_veiculo_id_veiculos_id_fk" FOREIGN KEY ("veiculo_id") REFERENCES "public"."veiculos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_km" ADD CONSTRAINT "veiculos_km_veiculo_id_veiculos_id_fk" FOREIGN KEY ("veiculo_id") REFERENCES "public"."veiculos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_km" ADD CONSTRAINT "veiculos_km_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_ordens" ADD CONSTRAINT "veiculos_ordens_veiculo_id_veiculos_id_fk" FOREIGN KEY ("veiculo_id") REFERENCES "public"."veiculos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_ordens" ADD CONSTRAINT "veiculos_ordens_plano_id_veiculos_planos_id_fk" FOREIGN KEY ("plano_id") REFERENCES "public"."veiculos_planos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_ordens" ADD CONSTRAINT "veiculos_ordens_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_planos" ADD CONSTRAINT "veiculos_planos_veiculo_id_veiculos_id_fk" FOREIGN KEY ("veiculo_id") REFERENCES "public"."veiculos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "veiculos_placa_uq" ON "veiculos" USING btree ("placa");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "veiculos_abastecimentos_veiculo_idx" ON "veiculos_abastecimentos" USING btree ("veiculo_id","km");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "veiculos_checklists_veiculo_idx" ON "veiculos_checklists" USING btree ("veiculo_id","data");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "veiculos_documentos_veiculo_idx" ON "veiculos_documentos" USING btree ("veiculo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "veiculos_km_veiculo_idx" ON "veiculos_km" USING btree ("veiculo_id","data");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "veiculos_ordens_veiculo_idx" ON "veiculos_ordens" USING btree ("veiculo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "veiculos_planos_veiculo_idx" ON "veiculos_planos" USING btree ("veiculo_id");