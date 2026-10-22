CREATE TYPE "public"."canal" AS ENUM('PAYTOUR', 'VIATOR', 'DECOLAR', 'CIVITATIS', 'BALCAO', 'OUTRO');--> statement-breakpoint
CREATE TYPE "public"."categoria" AS ENUM('ADULTO', 'SENIOR', 'INFANTIL', 'COLO', 'CORTESIA');--> statement-breakpoint
CREATE TYPE "public"."perfil" AS ENUM('ADMIN', 'SUPERVISOR', 'ATENDENTE', 'GUIA', 'MOTORISTA');--> statement-breakpoint
CREATE TYPE "public"."status_embarque" AS ENUM('PENDENTE', 'EMBARCOU', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."status_reserva" AS ENUM('CONFIRMADA', 'CANCELADA');--> statement-breakpoint
CREATE TYPE "public"."status_saida" AS ENUM('PREVISTA', 'CONFIRMADA', 'CANCELADA', 'REALIZADA');--> statement-breakpoint
CREATE TYPE "public"."tipo_documento" AS ENUM('CPF', 'RG', 'PASSAPORTE', 'RNM', 'DNI_MERCOSUL', 'CERTIDAO_NASCIMENTO', 'OUTRO');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auditoria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid,
	"acao" text NOT NULL,
	"entidade" text,
	"entidade_id" text,
	"dados" jsonb,
	"ip" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "passageiros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reserva_id" uuid NOT NULL,
	"nome" text DEFAULT '' NOT NULL,
	"categoria" "categoria" NOT NULL,
	"documento_tipo" "tipo_documento",
	"documento_cifrado" text,
	"documento_final" text,
	"documento_valido" boolean,
	"documento_pais" text,
	"ponto_embarque_id" uuid,
	"embarque" "status_embarque" DEFAULT 'PENDENTE' NOT NULL,
	"embarque_em" timestamp with time zone,
	"embarque_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "passeios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"nome" text NOT NULL,
	"cidade" text NOT NULL,
	"capacidade_padrao" integer NOT NULL,
	"minimo_confirmacao" integer NOT NULL,
	"minimo_supervisor" integer NOT NULL,
	"padrao_produto" text,
	"ativo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "passeios_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pontos_embarque" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passeio_id" uuid NOT NULL,
	"ordem" integer NOT NULL,
	"horario" text NOT NULL,
	"nome" text NOT NULL,
	"endereco" text,
	"eh_transfer" boolean DEFAULT false NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reservas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"saida_id" uuid NOT NULL,
	"canal" "canal" NOT NULL,
	"canal_origem" "canal",
	"codigo_externo" text,
	"referencias" text[] DEFAULT '{}'::text[] NOT NULL,
	"contato_nome" text NOT NULL,
	"contato_telefone" text,
	"contato_email" text,
	"ponto_embarque_id" uuid,
	"status" "status_reserva" DEFAULT 'CONFIRMADA' NOT NULL,
	"observacoes" text,
	"origem" text DEFAULT 'MANUAL' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saidas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passeio_id" uuid NOT NULL,
	"data" date NOT NULL,
	"status" "status_saida" DEFAULT 'PREVISTA' NOT NULL,
	"capacidade" integer NOT NULL,
	"veiculo" text,
	"guia" text,
	"motorista" text,
	"observacoes" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessoes" (
	"id" text PRIMARY KEY NOT NULL,
	"usuario_id" uuid NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"ultimo_uso" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"revogada" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"senha_hash" text NOT NULL,
	"perfil" "perfil" NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"trocar_senha" boolean DEFAULT true NOT NULL,
	"totp_segredo_cifrado" text,
	"totp_ativo" boolean DEFAULT false NOT NULL,
	"tentativas_falhas" integer DEFAULT 0 NOT NULL,
	"bloqueado_ate" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "passageiros" ADD CONSTRAINT "passageiros_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "passageiros" ADD CONSTRAINT "passageiros_ponto_embarque_id_pontos_embarque_id_fk" FOREIGN KEY ("ponto_embarque_id") REFERENCES "public"."pontos_embarque"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "passageiros" ADD CONSTRAINT "passageiros_embarque_por_usuarios_id_fk" FOREIGN KEY ("embarque_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pontos_embarque" ADD CONSTRAINT "pontos_embarque_passeio_id_passeios_id_fk" FOREIGN KEY ("passeio_id") REFERENCES "public"."passeios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reservas" ADD CONSTRAINT "reservas_saida_id_saidas_id_fk" FOREIGN KEY ("saida_id") REFERENCES "public"."saidas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reservas" ADD CONSTRAINT "reservas_ponto_embarque_id_pontos_embarque_id_fk" FOREIGN KEY ("ponto_embarque_id") REFERENCES "public"."pontos_embarque"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saidas" ADD CONSTRAINT "saidas_passeio_id_passeios_id_fk" FOREIGN KEY ("passeio_id") REFERENCES "public"."passeios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessoes" ADD CONSTRAINT "sessoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auditoria_criado_idx" ON "auditoria" USING btree ("criado_em");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "passageiros_reserva_idx" ON "passageiros" USING btree ("reserva_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pontos_passeio_ordem_uq" ON "pontos_embarque" USING btree ("passeio_id","ordem");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reservas_canal_codigo_uq" ON "reservas" USING btree ("canal","codigo_externo");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservas_saida_idx" ON "reservas" USING btree ("saida_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "saidas_passeio_data_uq" ON "saidas" USING btree ("passeio_id","data");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessoes_usuario_idx" ON "sessoes" USING btree ("usuario_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "usuarios_email_uq" ON "usuarios" USING btree (lower("email"));