CREATE TABLE IF NOT EXISTS "doc_arquivos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pasta_id" uuid NOT NULL,
	"titulo" text NOT NULL,
	"descricao" text,
	"nome_arquivo" text NOT NULL,
	"mime" text NOT NULL,
	"tamanho" integer NOT NULL,
	"dados_cifrados" text NOT NULL,
	"vencimento" date,
	"ativo" boolean DEFAULT true NOT NULL,
	"enviado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "doc_pastas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"ordem" integer DEFAULT 100 NOT NULL,
	"acesso" text DEFAULT 'TODOS' NOT NULL,
	"perfis" text[] DEFAULT '{}'::text[] NOT NULL,
	"usuarios" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "doc_arquivos" ADD CONSTRAINT "doc_arquivos_pasta_id_doc_pastas_id_fk" FOREIGN KEY ("pasta_id") REFERENCES "public"."doc_pastas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "doc_arquivos" ADD CONSTRAINT "doc_arquivos_enviado_por_usuarios_id_fk" FOREIGN KEY ("enviado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_arquivos_pasta_idx" ON "doc_arquivos" USING btree ("pasta_id");--> statement-breakpoint
-- Pastas iniciais (dono, 11/11/2026): Societário e Sócios restritas (só o administrador até alguém ser incluído).
INSERT INTO "doc_pastas" ("nome", "descricao", "ordem", "acesso")
SELECT * FROM (VALUES
  ('Societário', 'Contrato social e alterações, cartão CNPJ, atas.', 10, 'RESTRITO'),
  ('Contratos', 'Clientes, fornecedores, parceiros e aluguel.', 20, 'TODOS'),
  ('Fiscal e licenças', 'Alvarás, certidões, Cadastur, ANTT e licenças.', 30, 'TODOS'),
  ('Sócios', 'Documentos pessoais dos sócios.', 40, 'RESTRITO')
) AS v(nome, descricao, ordem, acesso)
WHERE NOT EXISTS (SELECT 1 FROM "doc_pastas");
