CREATE TABLE IF NOT EXISTS "afiliados" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid,
	"nome" text NOT NULL,
	"tipo" text DEFAULT 'HOTEL' NOT NULL,
	"codigo" text NOT NULL,
	"comissao_pontos_base" integer,
	"contato" text,
	"paytour_afiliado_id" text,
	"observacoes" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "afiliados_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "avaliacao_notas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reserva_id" uuid NOT NULL,
	"saida_id" uuid NOT NULL,
	"nota" integer NOT NULL,
	"comentario" text,
	"registrado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "avaliacao_notas_reservaId_unique" UNIQUE("reserva_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "avaliacao_pedidos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reserva_id" uuid NOT NULL,
	"saida_id" uuid NOT NULL,
	"texto" text NOT NULL,
	"status" text DEFAULT 'PENDENTE' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "avaliacao_pedidos_reservaId_unique" UNIQUE("reserva_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campanha_resultados" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campanha_id" uuid NOT NULL,
	"mes" text NOT NULL,
	"reservas" integer DEFAULT 0 NOT NULL,
	"passageiros" integer DEFAULT 0 NOT NULL,
	"receita_centavos" integer,
	"fonte" text DEFAULT 'MANUAL' NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campanhas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid,
	"nome" text NOT NULL,
	"midia" text NOT NULL,
	"inicio" date NOT NULL,
	"fim" date,
	"investimento_centavos" integer DEFAULT 0 NOT NULL,
	"cupom" text,
	"utm_campanha" text,
	"meta_reservas" integer,
	"observacoes" text,
	"ativa" boolean DEFAULT true NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conteudos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid,
	"titulo" text NOT NULL,
	"rede" text NOT NULL,
	"status" text DEFAULT 'IDEIA' NOT NULL,
	"data_prevista" date,
	"legenda" text,
	"link" text,
	"responsavel_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "marketing_config" (
	"chave" text PRIMARY KEY NOT NULL,
	"valor" text NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_por" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "biblioteca_paginas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pai_id" uuid,
	"titulo" text NOT NULL,
	"conteudo" text DEFAULT '' NOT NULL,
	"acesso" text DEFAULT 'EQUIPE' NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"chave_semente" text,
	"criado_por" uuid,
	"atualizado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "afiliados" ADD CONSTRAINT "afiliados_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "avaliacao_notas" ADD CONSTRAINT "avaliacao_notas_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "avaliacao_notas" ADD CONSTRAINT "avaliacao_notas_saida_id_saidas_id_fk" FOREIGN KEY ("saida_id") REFERENCES "public"."saidas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "avaliacao_notas" ADD CONSTRAINT "avaliacao_notas_registrado_por_usuarios_id_fk" FOREIGN KEY ("registrado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "avaliacao_pedidos" ADD CONSTRAINT "avaliacao_pedidos_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "avaliacao_pedidos" ADD CONSTRAINT "avaliacao_pedidos_saida_id_saidas_id_fk" FOREIGN KEY ("saida_id") REFERENCES "public"."saidas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campanha_resultados" ADD CONSTRAINT "campanha_resultados_campanha_id_campanhas_id_fk" FOREIGN KEY ("campanha_id") REFERENCES "public"."campanhas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campanha_resultados" ADD CONSTRAINT "campanha_resultados_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campanhas" ADD CONSTRAINT "campanhas_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campanhas" ADD CONSTRAINT "campanhas_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conteudos" ADD CONSTRAINT "conteudos_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conteudos" ADD CONSTRAINT "conteudos_responsavel_id_usuarios_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "marketing_config" ADD CONSTRAINT "marketing_config_atualizado_por_usuarios_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "biblioteca_paginas" ADD CONSTRAINT "biblioteca_paginas_pai_id_biblioteca_paginas_id_fk" FOREIGN KEY ("pai_id") REFERENCES "public"."biblioteca_paginas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "biblioteca_paginas" ADD CONSTRAINT "biblioteca_paginas_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "biblioteca_paginas" ADD CONSTRAINT "biblioteca_paginas_atualizado_por_usuarios_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "avaliacao_notas_saida_idx" ON "avaliacao_notas" USING btree ("saida_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "avaliacao_pedidos_saida_idx" ON "avaliacao_pedidos" USING btree ("saida_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campanha_resultados_campanha_idx" ON "campanha_resultados" USING btree ("campanha_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campanha_resultados_mes_uq" ON "campanha_resultados" USING btree ("campanha_id","mes");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campanhas_inicio_idx" ON "campanhas" USING btree ("inicio");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conteudos_data_idx" ON "conteudos" USING btree ("data_prevista");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "biblioteca_pai_idx" ON "biblioteca_paginas" USING btree ("pai_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "biblioteca_chave_uq" ON "biblioteca_paginas" USING btree ("chave_semente");