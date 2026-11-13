CREATE TABLE IF NOT EXISTS "configuracoes" (
	"chave" text PRIMARY KEY NOT NULL,
	"valor" text NOT NULL,
	"atualizado_por" uuid,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "configuracoes" ADD CONSTRAINT "configuracoes_atualizado_por_usuarios_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Dados públicos da empresa (base de conhecimento e papel timbrado). Quem assina é preenchido pelo administrador na tela.
INSERT INTO "configuracoes" ("chave", "valor") VALUES
  ('empresa_razao_social', 'By Bus Turismo Ltda.'),
  ('empresa_cnpj', '09.529.650/0001-01'),
  ('empresa_endereco', 'Avenida Madre Benvenuta, nº 687, Santa Mônica, Florianópolis/SC, CEP 88035-000'),
  ('contrato_foro', 'Florianópolis/SC')
ON CONFLICT ("chave") DO NOTHING;
