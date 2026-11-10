CREATE TABLE IF NOT EXISTS "fin_importacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid,
	"arquivo" text,
	"origem" text DEFAULT 'PLANILHA' NOT NULL,
	"lancamentos" integer DEFAULT 0 NOT NULL,
	"transferencias" integer DEFAULT 0 NOT NULL,
	"saldos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contas_criadas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"desfeita_em" timestamp with time zone,
	"desfeita_por" uuid,
	"resultado_desfazer" jsonb
);
--> statement-breakpoint
ALTER TABLE "fin_extrato_linhas" ADD COLUMN "importacao_id" uuid;--> statement-breakpoint
ALTER TABLE "fin_lancamentos" ADD COLUMN "importacao_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_importacoes" ADD CONSTRAINT "fin_importacoes_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_importacoes" ADD CONSTRAINT "fin_importacoes_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_importacoes" ADD CONSTRAINT "fin_importacoes_desfeita_por_usuarios_id_fk" FOREIGN KEY ("desfeita_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fin_importacoes_criado_idx" ON "fin_importacoes" USING btree ("criado_em");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_extrato_linhas" ADD CONSTRAINT "fin_extrato_linhas_importacao_id_fin_importacoes_id_fk" FOREIGN KEY ("importacao_id") REFERENCES "public"."fin_importacoes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fin_lancamentos" ADD CONSTRAINT "fin_lancamentos_importacao_id_fin_importacoes_id_fk" FOREIGN KEY ("importacao_id") REFERENCES "public"."fin_importacoes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Importações feitas antes deste registro: cada importação gravou tudo numa transação só, então os lançamentos dela
-- têm o mesmo criado_em (hora da transação). Cada grupo vira uma importação "ANTERIOR", que pode ser desfeita pela tela.
INSERT INTO "fin_importacoes" ("unidade_id", "origem", "lancamentos", "criado_por", "criado_em")
SELECT "unidade_id", 'ANTERIOR', count(*)::int, "criado_por", "criado_em"
FROM "fin_lancamentos"
WHERE "origem" = 'PLANILHA' AND "importacao_id" IS NULL
GROUP BY "unidade_id", "criado_por", "criado_em";
--> statement-breakpoint
UPDATE "fin_lancamentos" l SET "importacao_id" = i."id"
FROM "fin_importacoes" i
WHERE l."origem" = 'PLANILHA' AND l."importacao_id" IS NULL AND i."origem" = 'ANTERIOR'
  AND i."criado_em" = l."criado_em" AND i."criado_por" IS NOT DISTINCT FROM l."criado_por" AND i."unidade_id" IS NOT DISTINCT FROM l."unidade_id";
--> statement-breakpoint
-- Transferências entre contas gravadas na mesma transação da importação.
UPDATE "fin_extrato_linhas" x SET "importacao_id" = i."id"
FROM "fin_importacoes" i
WHERE x."importacao_id" IS NULL AND i."origem" = 'ANTERIOR' AND x."status" = 'TRANSFERENCIA' AND x."manual" = true AND x."extrato_id" IS NULL
  AND x."criado_em" = i."criado_em" AND x."decidido_por" IS NOT DISTINCT FROM i."criado_por";
--> statement-breakpoint
UPDATE "fin_importacoes" i SET "transferencias" = (SELECT count(*)::int FROM "fin_extrato_linhas" x WHERE x."importacao_id" = i."id")
WHERE i."origem" = 'ANTERIOR';
--> statement-breakpoint
-- Nome do arquivo, pelo registro de auditoria da importação (feito logo depois, pela mesma pessoa).
UPDATE "fin_importacoes" i SET "arquivo" = (
  SELECT a."dados"->>'arquivo' FROM "auditoria" a
  WHERE a."acao" = 'FIN_PLANILHA_IMPORTADA' AND a."usuario_id" IS NOT DISTINCT FROM i."criado_por"
    AND a."criado_em" >= i."criado_em" AND a."criado_em" < i."criado_em" + interval '10 minutes'
  ORDER BY a."criado_em" LIMIT 1)
WHERE i."origem" = 'ANTERIOR' AND i."arquivo" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fin_lanc_importacao_idx" ON "fin_lancamentos" ("importacao_id");
