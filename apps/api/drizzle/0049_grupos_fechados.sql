CREATE TABLE IF NOT EXISTS "grupos_anexos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grupo_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"nome_arquivo" text NOT NULL,
	"mime" text NOT NULL,
	"tamanho" integer NOT NULL,
	"dados_cifrados" text NOT NULL,
	"enviado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grupos_fechados" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid,
	"nome" text NOT NULL,
	"estilo" text DEFAULT 'ESCOLA' NOT NULL,
	"status" text DEFAULT 'ORCAMENTO' NOT NULL,
	"data_passeio" date,
	"horario_inicio" text,
	"local_inicio" text,
	"guia_id" uuid,
	"veiculo" text,
	"roteiro" text,
	"duracao_texto" text,
	"almoco" boolean DEFAULT false NOT NULL,
	"local_almoco" text,
	"pessoas" integer,
	"pessoas_minimo" integer,
	"cortesias" integer DEFAULT 0 NOT NULL,
	"valor_por_pessoa_centavos" integer,
	"valor_total_centavos" integer,
	"sinal_percentual" integer DEFAULT 50 NOT NULL,
	"nf_emitida" boolean DEFAULT false NOT NULL,
	"nf_numero" text,
	"razao_social" text,
	"cnpj" text,
	"endereco" text,
	"representante_nome" text,
	"representante_cargo" text,
	"representante_telefone" text,
	"representante_email" text,
	"representante_cpf_cifrado" text,
	"observacoes" text,
	"orcamento_id" uuid,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fin_lancamentos" ADD COLUMN "grupo_fechado_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grupos_anexos" ADD CONSTRAINT "grupos_anexos_grupo_id_grupos_fechados_id_fk" FOREIGN KEY ("grupo_id") REFERENCES "public"."grupos_fechados"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grupos_anexos" ADD CONSTRAINT "grupos_anexos_enviado_por_usuarios_id_fk" FOREIGN KEY ("enviado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grupos_fechados" ADD CONSTRAINT "grupos_fechados_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grupos_fechados" ADD CONSTRAINT "grupos_fechados_guia_id_pessoas_id_fk" FOREIGN KEY ("guia_id") REFERENCES "public"."pessoas"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grupos_fechados" ADD CONSTRAINT "grupos_fechados_orcamento_id_orcamentos_grupo_id_fk" FOREIGN KEY ("orcamento_id") REFERENCES "public"."orcamentos_grupo"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grupos_fechados" ADD CONSTRAINT "grupos_fechados_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grupos_anexos_grupo_idx" ON "grupos_anexos" USING btree ("grupo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grupos_fechados_data_idx" ON "grupos_fechados" USING btree ("data_passeio");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grupos_fechados_nome_idx" ON "grupos_fechados" USING btree ("nome");