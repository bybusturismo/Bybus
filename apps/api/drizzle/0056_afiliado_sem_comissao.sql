ALTER TABLE "afiliados" ADD COLUMN "sem_comissao" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Canais internos da By Bus cadastrados como afiliados na Paytour ("Tripadvisor interno", "Decolar.com interno"): fora das comissões (dono, 17/11/2026).
UPDATE "afiliados" SET "sem_comissao" = true WHERE "nome" ~* '\minterno\M';
