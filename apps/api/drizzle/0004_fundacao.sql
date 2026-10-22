CREATE TYPE "public"."linha_negocio" AS ENUM('CITY_TOUR', 'FRETAMENTO', 'PUBLICIDADE', 'RECREATIVO');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "perfis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"permissoes" text[] DEFAULT '{}'::text[] NOT NULL,
	"sistema" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "perfis_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pessoas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"papeis" text[] DEFAULT '{}'::text[] NOT NULL,
	"unidade_id" uuid,
	"telefone" text,
	"email" text,
	"documento_tipo" text,
	"documento_cifrado" text,
	"documento_final" text,
	"cnh_categoria" text,
	"cnh_validade" date,
	"cadastur_numero" text,
	"cadastur_validade" date,
	"idiomas" text[] DEFAULT '{}'::text[] NOT NULL,
	"diaria_centavos" integer,
	"observacoes" text,
	"usuario_id" uuid,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pessoas_usuarioId_unique" UNIQUE("usuario_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "unidades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"nome" text NOT NULL,
	"cidade" text NOT NULL,
	"uf" text NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unidades_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usuarios_unidades" (
	"usuario_id" uuid NOT NULL,
	"unidade_id" uuid NOT NULL,
	CONSTRAINT "usuarios_unidades_usuario_id_unidade_id_pk" PRIMARY KEY("usuario_id","unidade_id")
);
--> statement-breakpoint
-- Dados de referência: praças e perfis padrão (ADR 0005).
INSERT INTO "unidades" ("codigo","nome","cidade","uf") VALUES
  ('FLN','Florianópolis (Floripa by Bus)','Florianópolis','SC'),
  ('BC','Balneário Camboriú (BC by Bus)','Balneário Camboriú','SC'),
  ('BNU','Blumenau','Blumenau','SC')
ON CONFLICT ("codigo") DO NOTHING;--> statement-breakpoint
INSERT INTO "perfis" ("codigo","nome","descricao","permissoes","sistema") VALUES
  ('ADMIN','Administrador','Acesso total, inclusive usuários, perfis e praças.',ARRAY['usuarios:gerenciar','auditoria:ver','unidades:gerenciar','pessoas:gerenciar','pessoas:ver','pontos:gerenciar','saidas:gerenciar','saidas:decidir','reservas:editar','importacoes:executar','manifesto:ver','manifesto:documentos','manifesto:contatos','embarque:registrar'],true),
  ('SUPERVISOR','Supervisor / líder','Decide saídas, vê documentos completos, gerencia equipe e pontos.',ARRAY['auditoria:ver','pessoas:gerenciar','pessoas:ver','pontos:gerenciar','saidas:gerenciar','saidas:decidir','reservas:editar','importacoes:executar','manifesto:ver','manifesto:documentos','manifesto:contatos','embarque:registrar'],true),
  ('ATENDENTE','Atendente / vendedor','Monta listas, lança e importa reservas.',ARRAY['pessoas:ver','saidas:gerenciar','reservas:editar','importacoes:executar','manifesto:ver','manifesto:contatos'],true),
  ('GUIA','Guia de turismo','Vê a lista e registra o embarque.',ARRAY['manifesto:ver','manifesto:contatos','embarque:registrar'],true),
  ('MOTORISTA','Motorista','Vê a lista (sem contatos).',ARRAY['manifesto:ver'],true)
ON CONFLICT ("codigo") DO NOTHING;--> statement-breakpoint
ALTER TABLE "passeios" ADD COLUMN "unidade_id" uuid;--> statement-breakpoint
UPDATE "passeios" SET "unidade_id" = (SELECT "id" FROM "unidades" WHERE "codigo" = 'FLN');--> statement-breakpoint
ALTER TABLE "passeios" ALTER COLUMN "unidade_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "passeios" ADD COLUMN "linha" "linha_negocio" DEFAULT 'CITY_TOUR' NOT NULL;--> statement-breakpoint
ALTER TABLE "saidas" ADD COLUMN "guia_id" uuid;--> statement-breakpoint
ALTER TABLE "saidas" ADD COLUMN "motorista_id" uuid;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "perfil_id" uuid;--> statement-breakpoint
UPDATE "usuarios" u SET "perfil_id" = p."id" FROM "perfis" p WHERE p."codigo" = u."perfil"::text;--> statement-breakpoint
ALTER TABLE "usuarios" ALTER COLUMN "perfil_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "todas_unidades" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Usuários existentes: administradores veem todas as praças; demais, Florianópolis (única operação no sistema até aqui).
UPDATE "usuarios" SET "todas_unidades" = true WHERE "perfil"::text = 'ADMIN';--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pessoas" ADD CONSTRAINT "pessoas_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pessoas" ADD CONSTRAINT "pessoas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usuarios_unidades" ADD CONSTRAINT "usuarios_unidades_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usuarios_unidades" ADD CONSTRAINT "usuarios_unidades_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pessoas_unidade_idx" ON "pessoas" USING btree ("unidade_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "passeios" ADD CONSTRAINT "passeios_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saidas" ADD CONSTRAINT "saidas_guia_id_pessoas_id_fk" FOREIGN KEY ("guia_id") REFERENCES "public"."pessoas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saidas" ADD CONSTRAINT "saidas_motorista_id_pessoas_id_fk" FOREIGN KEY ("motorista_id") REFERENCES "public"."pessoas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_perfil_id_perfis_id_fk" FOREIGN KEY ("perfil_id") REFERENCES "public"."perfis"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
INSERT INTO "usuarios_unidades" ("usuario_id","unidade_id")
  SELECT u."id", (SELECT "id" FROM "unidades" WHERE "codigo" = 'FLN') FROM "usuarios" u WHERE u."perfil"::text <> 'ADMIN'
  ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "usuarios" DROP COLUMN IF EXISTS "perfil";--> statement-breakpoint
DROP TYPE "public"."perfil";