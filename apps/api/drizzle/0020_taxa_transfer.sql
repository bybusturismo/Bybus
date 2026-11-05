ALTER TABLE "transfer_config" ALTER COLUMN "taxa_por_passageiro_centavos" SET DEFAULT 4500;--> statement-breakpoint
ALTER TABLE "transfer_config" ALTER COLUMN "taxa_a_confirmar" SET DEFAULT false;--> statement-breakpoint
UPDATE "transfer_config" SET "taxa_por_passageiro_centavos" = 4500, "taxa_a_confirmar" = false WHERE "taxa_por_passageiro_centavos" = 4000 AND "taxa_a_confirmar" = true;
