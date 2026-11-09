CREATE TABLE IF NOT EXISTS "usuarios_anexos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"nome" text NOT NULL,
	"mime" text NOT NULL,
	"tamanho" integer NOT NULL,
	"dados_cifrados" text NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usuarios_fichas" (
	"usuario_id" uuid PRIMARY KEY NOT NULL,
	"apelido" text,
	"nascimento" date,
	"telefone" text,
	"vinculo" text,
	"cargo" text,
	"admissao" date,
	"desligamento" date,
	"dados_cifrados" text,
	"pix_alterado_em" timestamp with time zone,
	"pix_alterado_por" uuid,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_por" uuid
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usuarios_anexos" ADD CONSTRAINT "usuarios_anexos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usuarios_fichas" ADD CONSTRAINT "usuarios_fichas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usuarios_anexos_usuario_idx" ON "usuarios_anexos" USING btree ("usuario_id");