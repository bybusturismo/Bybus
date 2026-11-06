CREATE TABLE IF NOT EXISTS "respostas_rapidas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"atalho" text NOT NULL,
	"titulo" text NOT NULL,
	"idioma" text DEFAULT 'PT' NOT NULL,
	"texto" text NOT NULL,
	"revisada" boolean DEFAULT false NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "banco_midias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"tipo" text NOT NULL,
	"uso" text NOT NULL,
	"tamanho" integer NOT NULL,
	"dados" "bytea" NOT NULL,
	"passeio" text,
	"ponto_turistico" text,
	"temporada" text,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conteudo_midias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conteudo_id" uuid NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"nome" text NOT NULL,
	"tipo" text NOT NULL,
	"uso" text NOT NULL,
	"tamanho" integer NOT NULL,
	"dados" "bytea" NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ig_comentarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"id_externo" text NOT NULL,
	"midia_id" text,
	"pai_id_externo" text,
	"autor_id" text,
	"autor_usuario" text,
	"texto" text,
	"escrito_em" timestamp with time zone,
	"oculto" boolean DEFAULT false NOT NULL,
	"lido" boolean DEFAULT false NOT NULL,
	"resposta_texto" text,
	"resposta_id_externo" text,
	"resposta_status" text,
	"resposta_por" uuid,
	"resposta_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ig_metricas_dia" (
	"data" date PRIMARY KEY NOT NULL,
	"seguidores" integer,
	"alcance" integer,
	"visualizacoes" integer,
	"visitas_perfil" integer,
	"cliques_site" integer,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ig_midia_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"midia_id" uuid NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ig_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"id_externo" text NOT NULL,
	"tipo" text NOT NULL,
	"legenda" text,
	"link" text,
	"publicado_em" timestamp with time zone,
	"curtidas" integer,
	"comentarios" integer,
	"salvamentos" integer,
	"compartilhamentos" integer,
	"alcance" integer,
	"visualizacoes" integer,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conteudos" ADD COLUMN "aprovado_por" uuid;--> statement-breakpoint
ALTER TABLE "conteudos" ADD COLUMN "aprovado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conteudos" ADD COLUMN "tipo_post" text;--> statement-breakpoint
ALTER TABLE "conteudos" ADD COLUMN "agendar_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conteudos" ADD COLUMN "pub_status" text;--> statement-breakpoint
ALTER TABLE "conteudos" ADD COLUMN "pub_simulado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conteudos" ADD COLUMN "pub_erro" text;--> statement-breakpoint
ALTER TABLE "conteudos" ADD COLUMN "pub_container_id" text;--> statement-breakpoint
ALTER TABLE "conteudos" ADD COLUMN "pub_id_externo" text;--> statement-breakpoint
ALTER TABLE "conteudos" ADD COLUMN "pub_tentativas" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conteudos" ADD COLUMN "pub_proxima_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conteudos" ADD COLUMN "pub_iniciada_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conteudos" ADD COLUMN "pub_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wa_conversas" ADD COLUMN "canal" text DEFAULT 'WHATSAPP' NOT NULL;--> statement-breakpoint
ALTER TABLE "wa_conversas" ADD COLUMN "id_contato" text;--> statement-breakpoint
ALTER TABLE "wa_conversas" ADD COLUMN "ultima_entrada_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wa_conversas" ADD COLUMN "etiquetas" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "wa_conversas" ADD COLUMN "atendente_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "respostas_rapidas" ADD CONSTRAINT "respostas_rapidas_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "banco_midias" ADD CONSTRAINT "banco_midias_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conteudo_midias" ADD CONSTRAINT "conteudo_midias_conteudo_id_conteudos_id_fk" FOREIGN KEY ("conteudo_id") REFERENCES "public"."conteudos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conteudo_midias" ADD CONSTRAINT "conteudo_midias_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ig_comentarios" ADD CONSTRAINT "ig_comentarios_resposta_por_usuarios_id_fk" FOREIGN KEY ("resposta_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ig_midia_tokens" ADD CONSTRAINT "ig_midia_tokens_midia_id_conteudo_midias_id_fk" FOREIGN KEY ("midia_id") REFERENCES "public"."conteudo_midias"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "respostas_rapidas_atalho_idioma_uq" ON "respostas_rapidas" USING btree ("atalho","idioma");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "banco_midias_criado_idx" ON "banco_midias" USING btree ("criado_em");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conteudo_midias_conteudo_idx" ON "conteudo_midias" USING btree ("conteudo_id","ordem");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ig_comentarios_externo_uq" ON "ig_comentarios" USING btree ("id_externo");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ig_comentarios_data_idx" ON "ig_comentarios" USING btree ("criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ig_midia_tokens_hash_uq" ON "ig_midia_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ig_midia_tokens_expira_idx" ON "ig_midia_tokens" USING btree ("expira_em");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ig_posts_externo_uq" ON "ig_posts" USING btree ("id_externo");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ig_posts_data_idx" ON "ig_posts" USING btree ("publicado_em");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conteudos" ADD CONSTRAINT "conteudos_aprovado_por_usuarios_id_fk" FOREIGN KEY ("aprovado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wa_conversas" ADD CONSTRAINT "wa_conversas_atendente_id_usuarios_id_fk" FOREIGN KEY ("atendente_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conteudos_pub_idx" ON "conteudos" USING btree ("pub_status","agendar_em");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_conversas_atendente_idx" ON "wa_conversas" USING btree ("atendente_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_conversas_canal_idx" ON "wa_conversas" USING btree ("canal");