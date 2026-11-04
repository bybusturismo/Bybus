CREATE TABLE IF NOT EXISTS "usuarios_fotos" (
	"usuario_id" uuid PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"dados" text NOT NULL,
	"atualizada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usuarios_fotos" ADD CONSTRAINT "usuarios_fotos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
