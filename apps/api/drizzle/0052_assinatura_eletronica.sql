CREATE TABLE IF NOT EXISTS "assinatura_documentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grupo_id" uuid,
	"titulo" text NOT NULL,
	"status" text DEFAULT 'PENDENTE' NOT NULL,
	"codigo_verificacao" text NOT NULL,
	"blocos_json" text NOT NULL,
	"pdf_cifrado" text NOT NULL,
	"hash_original" text NOT NULL,
	"pdf_final_cifrado" text,
	"hash_final" text,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"concluido_em" timestamp with time zone,
	"cancelado_em" timestamp with time zone,
	CONSTRAINT "assinatura_documentos_codigoVerificacao_unique" UNIQUE("codigo_verificacao")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assinatura_signatarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documento_id" uuid NOT NULL,
	"ordem" integer NOT NULL,
	"papel" text NOT NULL,
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"cpf_cifrado" text,
	"token_hash" text NOT NULL,
	"codigo_hash" text,
	"codigo_expira_em" timestamp with time zone,
	"codigo_tentativas" integer DEFAULT 0 NOT NULL,
	"codigos_enviados" integer DEFAULT 0 NOT NULL,
	"visualizado_em" timestamp with time zone,
	"assinado_em" timestamp with time zone,
	"nome_digitado" text,
	"cpf_digitado_cifrado" text,
	"ip" text,
	"navegador" text,
	CONSTRAINT "assinatura_signatarios_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assinatura_documentos" ADD CONSTRAINT "assinatura_documentos_grupo_id_grupos_fechados_id_fk" FOREIGN KEY ("grupo_id") REFERENCES "public"."grupos_fechados"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assinatura_documentos" ADD CONSTRAINT "assinatura_documentos_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assinatura_signatarios" ADD CONSTRAINT "assinatura_signatarios_documento_id_assinatura_documentos_id_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."assinatura_documentos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assinatura_documentos_grupo_idx" ON "assinatura_documentos" USING btree ("grupo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assinatura_signatarios_doc_idx" ON "assinatura_signatarios" USING btree ("documento_id");