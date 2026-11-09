CREATE TABLE IF NOT EXISTS "cofre_config" (
	"id" text PRIMARY KEY DEFAULT 'padrao' NOT NULL,
	"gestor_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cofre_itens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"setor_id" uuid NOT NULL,
	"titulo" text NOT NULL,
	"categoria" text,
	"url" text,
	"usuario_cifrado" text,
	"senha_cifrada" text,
	"notas_cifradas" text,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_por" uuid,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cofre_membros" (
	"setor_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"pode_editar" boolean DEFAULT false NOT NULL,
	CONSTRAINT "cofre_membros_setor_id_usuario_id_pk" PRIMARY KEY("setor_id","usuario_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cofre_registro" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid,
	"titulo" text,
	"usuario_id" uuid,
	"acao" text NOT NULL,
	"detalhe" text,
	"em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cofre_setores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cofre_config" ADD CONSTRAINT "cofre_config_gestor_id_usuarios_id_fk" FOREIGN KEY ("gestor_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cofre_itens" ADD CONSTRAINT "cofre_itens_setor_id_cofre_setores_id_fk" FOREIGN KEY ("setor_id") REFERENCES "public"."cofre_setores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cofre_itens" ADD CONSTRAINT "cofre_itens_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cofre_itens" ADD CONSTRAINT "cofre_itens_atualizado_por_usuarios_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cofre_membros" ADD CONSTRAINT "cofre_membros_setor_id_cofre_setores_id_fk" FOREIGN KEY ("setor_id") REFERENCES "public"."cofre_setores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cofre_membros" ADD CONSTRAINT "cofre_membros_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cofre_registro" ADD CONSTRAINT "cofre_registro_item_id_cofre_itens_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."cofre_itens"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cofre_registro" ADD CONSTRAINT "cofre_registro_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cofre_itens_setor_idx" ON "cofre_itens" USING btree ("setor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cofre_registro_em_idx" ON "cofre_registro" USING btree ("em");--> statement-breakpoint
-- Gestor do Cofre: o primeiro administrador cadastrado (pode ser trocado depois).
INSERT INTO "cofre_config" ("id", "gestor_id")
SELECT 'padrao', u."id" FROM "usuarios" u JOIN "perfis" p ON p."id" = u."perfil_id" WHERE p."codigo" = 'ADMIN' ORDER BY u."criado_em" LIMIT 1
ON CONFLICT ("id") DO NOTHING;
