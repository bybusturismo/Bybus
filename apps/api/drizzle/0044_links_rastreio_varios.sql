-- Uma reserva pode ter mais de um link do mapa válido (o da véspera e o da saída do ônibus, 11/11/2026).
ALTER TABLE "rastreio_links" DROP CONSTRAINT IF EXISTS "rastreio_links_pkey";--> statement-breakpoint
ALTER TABLE "rastreio_links" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "rastreio_links" ADD PRIMARY KEY ("id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rastreio_links_reserva_idx" ON "rastreio_links" USING btree ("reserva_id");
