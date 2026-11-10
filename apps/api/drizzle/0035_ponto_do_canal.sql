ALTER TABLE "reservas" ADD COLUMN "ponto_canal_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reservas" ADD CONSTRAINT "reservas_ponto_canal_id_pontos_embarque_id_fk" FOREIGN KEY ("ponto_canal_id") REFERENCES "public"."pontos_embarque"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
