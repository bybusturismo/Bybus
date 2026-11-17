ALTER TABLE "afiliados" ADD COLUMN "modo_comissao" text DEFAULT 'PAGAMOS' NOT NULL;--> statement-breakpoint
-- Dono, 17/11/2026: canais internos da By Bus cadastrados como afiliados na Paytour ("Tripadvisor interno", "Decolar.com interno") ficam fora das comissões.
UPDATE "afiliados" SET "modo_comissao" = 'NENHUMA' WHERE "nome" ~* '\minterno\M';--> statement-breakpoint
-- Dono, 17/11/2026: a Inzama Travel vende e já retém os 15%, repassando 85%: aparece no relatório, nunca no contas a pagar.
UPDATE "afiliados" SET "modo_comissao" = 'RETEM', "comissao_pontos_base" = coalesce("comissao_pontos_base", 1500) WHERE "nome" ~* 'inzama';
