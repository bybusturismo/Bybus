ALTER TABLE "auditoria" DROP CONSTRAINT "auditoria_usuario_id_usuarios_id_fk";
--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "totp_ultimo_passo" integer;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "bloqueios" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
