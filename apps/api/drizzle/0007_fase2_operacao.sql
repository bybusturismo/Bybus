CREATE TABLE IF NOT EXISTS "escalas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passeio_id" uuid NOT NULL,
	"data" date NOT NULL,
	"guia_id" uuid,
	"motorista_id" uuid,
	"origem" text DEFAULT 'ESCALA' NOT NULL,
	"motivo" text,
	"publicada" boolean DEFAULT false NOT NULL,
	"alterado_por" uuid,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fechamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"saida_id" uuid NOT NULL,
	"versao" integer NOT NULL,
	"automatico" boolean DEFAULT false NOT NULL,
	"fechado_por" uuid,
	"fechado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"resumo" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mensagens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" text NOT NULL,
	"reserva_id" uuid,
	"saida_id" uuid,
	"destino" text,
	"texto" text NOT NULL,
	"status" text DEFAULT 'PENDENTE' NOT NULL,
	"provedor" text,
	"erro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"enviada_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "passeios" ADD COLUMN "motorista_padrao_id" uuid;--> statement-breakpoint
ALTER TABLE "passeios" ADD COLUMN "veiculo_padrao" text;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "pagamento" text;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "forma_pagamento" text;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "origem_cliente" text;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "conferencia" text DEFAULT 'PENDENTE' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "conferida_por" uuid;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "conferida_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "hospedagem_informada" text;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "pediu_transfer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "informado_pelo_cliente_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "token_embarque_hash" text;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "token_embarque_expira_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "saidas" ADD COLUMN "lista_fechada_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "saidas" ADD COLUMN "lista_versao" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "escalas" ADD CONSTRAINT "escalas_passeio_id_passeios_id_fk" FOREIGN KEY ("passeio_id") REFERENCES "public"."passeios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "escalas" ADD CONSTRAINT "escalas_guia_id_pessoas_id_fk" FOREIGN KEY ("guia_id") REFERENCES "public"."pessoas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "escalas" ADD CONSTRAINT "escalas_motorista_id_pessoas_id_fk" FOREIGN KEY ("motorista_id") REFERENCES "public"."pessoas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "escalas" ADD CONSTRAINT "escalas_alterado_por_usuarios_id_fk" FOREIGN KEY ("alterado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fechamentos" ADD CONSTRAINT "fechamentos_saida_id_saidas_id_fk" FOREIGN KEY ("saida_id") REFERENCES "public"."saidas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fechamentos" ADD CONSTRAINT "fechamentos_fechado_por_usuarios_id_fk" FOREIGN KEY ("fechado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mensagens" ADD CONSTRAINT "mensagens_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mensagens" ADD CONSTRAINT "mensagens_saida_id_saidas_id_fk" FOREIGN KEY ("saida_id") REFERENCES "public"."saidas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "escalas_passeio_data_uq" ON "escalas" USING btree ("passeio_id","data");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fechamentos_saida_versao_uq" ON "fechamentos" USING btree ("saida_id","versao");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mensagens_reserva_tipo_uq" ON "mensagens" USING btree ("reserva_id","tipo");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mensagens_saida_idx" ON "mensagens" USING btree ("saida_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "passeios" ADD CONSTRAINT "passeios_motorista_padrao_id_pessoas_id_fk" FOREIGN KEY ("motorista_padrao_id") REFERENCES "public"."pessoas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reservas" ADD CONSTRAINT "reservas_conferida_por_usuarios_id_fk" FOREIGN KEY ("conferida_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_tokenEmbarqueHash_unique" UNIQUE("token_embarque_hash");--> statement-breakpoint
-- Nova permissão: montar a escala mensal e trocar guia/motorista (administrador e supervisor).
UPDATE "perfis" SET "permissoes" = array_append("permissoes", 'escala:gerenciar') WHERE "codigo" IN ('ADMIN', 'SUPERVISOR') AND NOT ('escala:gerenciar' = ANY("permissoes"));
