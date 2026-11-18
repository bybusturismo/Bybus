CREATE TABLE IF NOT EXISTS "avaliacoes_online" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canal" text NOT NULL,
	"unidade_id" uuid,
	"id_externo" text NOT NULL,
	"referencia" text,
	"autor" text,
	"nota" integer NOT NULL,
	"titulo" text,
	"texto" text,
	"idioma" text,
	"publicada_em" timestamp with time zone,
	"url" text,
	"resposta" text,
	"respondida_em" timestamp with time zone,
	"lida" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "avaliacoes_online" ADD CONSTRAINT "avaliacoes_online_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "avaliacoes_online_uk" ON "avaliacoes_online" USING btree ("canal","id_externo");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "avaliacoes_online_data_idx" ON "avaliacoes_online" USING btree ("publicada_em");