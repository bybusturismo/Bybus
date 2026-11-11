ALTER TABLE "passageiros" ADD COLUMN "voucher" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "passageiros_voucher_idx" ON "passageiros" USING btree ("voucher");