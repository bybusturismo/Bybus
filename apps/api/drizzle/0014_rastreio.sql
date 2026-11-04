CREATE TABLE IF NOT EXISTS "rastreio_links" (
	"reserva_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rastreio_links_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rastreio_posicoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sessao_id" uuid NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"precisao_m" double precision,
	"velocidade" double precision,
	"direcao" double precision,
	"registrada_em" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rastreio_sessoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"saida_id" uuid NOT NULL,
	"motorista_usuario_id" uuid NOT NULL,
	"iniciada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"encerrada_em" timestamp with time zone,
	"ultima_posicao_em" timestamp with time zone,
	"ultimo_ponto_visitado" integer DEFAULT -1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pontos_embarque" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "pontos_embarque" ADD COLUMN "longitude" double precision;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rastreio_links" ADD CONSTRAINT "rastreio_links_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rastreio_posicoes" ADD CONSTRAINT "rastreio_posicoes_sessao_id_rastreio_sessoes_id_fk" FOREIGN KEY ("sessao_id") REFERENCES "public"."rastreio_sessoes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rastreio_sessoes" ADD CONSTRAINT "rastreio_sessoes_saida_id_saidas_id_fk" FOREIGN KEY ("saida_id") REFERENCES "public"."saidas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rastreio_sessoes" ADD CONSTRAINT "rastreio_sessoes_motorista_usuario_id_usuarios_id_fk" FOREIGN KEY ("motorista_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rastreio_posicoes_sessao_tempo_uq" ON "rastreio_posicoes" USING btree ("sessao_id","registrada_em");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rastreio_posicoes_tempo_idx" ON "rastreio_posicoes" USING btree ("registrada_em");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rastreio_sessoes_saida_idx" ON "rastreio_sessoes" USING btree ("saida_id","iniciada_em");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rastreio_sessoes_aberta_uq" ON "rastreio_sessoes" USING btree ("saida_id") WHERE "rastreio_sessoes"."encerrada_em" is null;--> statement-breakpoint
UPDATE "perfis" SET "permissoes" = array_append("permissoes", 'rastreio:transmitir') WHERE "codigo" = 'MOTORISTA' AND NOT ('rastreio:transmitir' = ANY("permissoes"));
