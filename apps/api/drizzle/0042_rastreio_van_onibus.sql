DROP INDEX IF EXISTS "rastreio_sessoes_aberta_uq";--> statement-breakpoint
ALTER TABLE "rastreio_sessoes" ADD COLUMN "tipo" text DEFAULT 'ONIBUS' NOT NULL;--> statement-breakpoint
ALTER TABLE "transfer_reservas" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "transfer_reservas" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "transfer_reservas" ADD COLUMN "local_origem" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rastreio_sessoes_aberta_tipo_uq" ON "rastreio_sessoes" USING btree ("saida_id","tipo") WHERE "rastreio_sessoes"."encerrada_em" is null;