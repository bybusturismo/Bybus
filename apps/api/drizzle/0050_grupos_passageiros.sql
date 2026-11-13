CREATE TABLE IF NOT EXISTS "grupos_passageiros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grupo_id" uuid NOT NULL,
	"ordem" integer NOT NULL,
	"nome" text NOT NULL,
	"tipo_documento" text,
	"documento_cifrado" text,
	"nascimento" date,
	"categoria" text DEFAULT 'ALUNO' NOT NULL,
	"origem" text DEFAULT 'EQUIPE' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grupos_fechados" ADD COLUMN "lista_token_hash" text;--> statement-breakpoint
ALTER TABLE "grupos_fechados" ADD COLUMN "lista_expira_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "grupos_fechados" ADD COLUMN "lista_atualizada_em" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grupos_passageiros" ADD CONSTRAINT "grupos_passageiros_grupo_id_grupos_fechados_id_fk" FOREIGN KEY ("grupo_id") REFERENCES "public"."grupos_fechados"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grupos_passageiros_grupo_idx" ON "grupos_passageiros" USING btree ("grupo_id","ordem");--> statement-breakpoint
ALTER TABLE "grupos_fechados" ADD CONSTRAINT "grupos_fechados_listaTokenHash_unique" UNIQUE("lista_token_hash");