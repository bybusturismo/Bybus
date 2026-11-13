ALTER TABLE "afiliados" ADD COLUMN "usuario_id" uuid;--> statement-breakpoint
ALTER TABLE "afiliados" ADD COLUMN "dados_bancarios_cifrado" text;--> statement-breakpoint
ALTER TABLE "afiliados" ADD COLUMN "dados_bancarios_em" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "afiliados" ADD CONSTRAINT "afiliados_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Perfil do portal do afiliado: só a própria página (comissões, dados bancários, link e QR code).
INSERT INTO "perfis" ("codigo", "nome", "descricao", "permissoes", "sistema")
VALUES ('AFILIADO', 'Afiliado', 'Parceiro que vende pelo link/QR code: vê só as próprias comissões e dados.', ARRAY['afiliado:portal'], true)
ON CONFLICT ("codigo") DO NOTHING;
