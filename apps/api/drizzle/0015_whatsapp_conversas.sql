CREATE TABLE IF NOT EXISTS "wa_conversas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telefone" text NOT NULL,
	"chave" text NOT NULL,
	"jid" text,
	"nome" text,
	"unidade_id" uuid,
	"ultima_mensagem_em" timestamp with time zone,
	"nao_lidas" integer DEFAULT 0 NOT NULL,
	"arquivada" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wa_mensagens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversa_id" uuid NOT NULL,
	"direcao" text NOT NULL,
	"texto" text,
	"tipo" text DEFAULT 'TEXTO' NOT NULL,
	"id_externo" text,
	"status" text NOT NULL,
	"enviada_por" uuid,
	"mensagem_fila_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wa_conversas" ADD CONSTRAINT "wa_conversas_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wa_mensagens" ADD CONSTRAINT "wa_mensagens_conversa_id_wa_conversas_id_fk" FOREIGN KEY ("conversa_id") REFERENCES "public"."wa_conversas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wa_mensagens" ADD CONSTRAINT "wa_mensagens_enviada_por_usuarios_id_fk" FOREIGN KEY ("enviada_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wa_mensagens" ADD CONSTRAINT "wa_mensagens_mensagem_fila_id_mensagens_id_fk" FOREIGN KEY ("mensagem_fila_id") REFERENCES "public"."mensagens"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wa_conversas_chave_uq" ON "wa_conversas" USING btree ("chave");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_conversas_ultima_idx" ON "wa_conversas" USING btree ("ultima_mensagem_em");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wa_mensagens_id_externo_uq" ON "wa_mensagens" USING btree ("id_externo");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wa_mensagens_fila_uq" ON "wa_mensagens" USING btree ("mensagem_fila_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_mensagens_conversa_idx" ON "wa_mensagens" USING btree ("conversa_id","criado_em");--> statement-breakpoint
UPDATE "perfis" SET "permissoes" = (SELECT array_agg(DISTINCT p) FROM unnest("permissoes" || ARRAY['whatsapp:ver','whatsapp:responder']) p) WHERE "codigo" IN ('SUPERVISOR','ATENDENTE');
