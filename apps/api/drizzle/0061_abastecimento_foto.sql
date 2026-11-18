CREATE TABLE IF NOT EXISTS "veiculos_abastecimentos_fotos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"abastecimento_id" uuid NOT NULL,
	"tipo" text DEFAULT 'CUPOM' NOT NULL,
	"nome_arquivo" text NOT NULL,
	"mime" text NOT NULL,
	"tamanho" integer NOT NULL,
	"dados_cifrados" text NOT NULL,
	"enviado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "veiculos_abastecimentos" ALTER COLUMN "veiculo_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "veiculos_abastecimentos" ALTER COLUMN "km" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "veiculos_abastecimentos" ALTER COLUMN "litros" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "veiculos_abastecimentos" ALTER COLUMN "valor_centavos" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "veiculos_abastecimentos" ADD COLUMN "situacao" text DEFAULT 'CONFERIDO' NOT NULL;--> statement-breakpoint
ALTER TABLE "veiculos_abastecimentos" ADD COLUMN "origem" text DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "veiculos_abastecimentos" ADD COLUMN "forma_pagamento" text;--> statement-breakpoint
ALTER TABLE "veiculos_abastecimentos" ADD COLUMN "lancamento_id" uuid;--> statement-breakpoint
ALTER TABLE "veiculos_abastecimentos" ADD COLUMN "leitura_ia" jsonb;--> statement-breakpoint
ALTER TABLE "veiculos_abastecimentos" ADD COLUMN "observacao" text;--> statement-breakpoint
ALTER TABLE "veiculos_abastecimentos" ADD COLUMN "pessoa_id" uuid;--> statement-breakpoint
ALTER TABLE "veiculos_abastecimentos" ADD COLUMN "conferido_por" uuid;--> statement-breakpoint
ALTER TABLE "veiculos_abastecimentos" ADD COLUMN "conferido_em" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_abastecimentos_fotos" ADD CONSTRAINT "veiculos_abastecimentos_fotos_abastecimento_id_veiculos_abastecimentos_id_fk" FOREIGN KEY ("abastecimento_id") REFERENCES "public"."veiculos_abastecimentos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_abastecimentos_fotos" ADD CONSTRAINT "veiculos_abastecimentos_fotos_enviado_por_usuarios_id_fk" FOREIGN KEY ("enviado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "veiculos_abastecimentos_fotos_idx" ON "veiculos_abastecimentos_fotos" USING btree ("abastecimento_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_abastecimentos" ADD CONSTRAINT "veiculos_abastecimentos_lancamento_id_fin_lancamentos_id_fk" FOREIGN KEY ("lancamento_id") REFERENCES "public"."fin_lancamentos"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_abastecimentos" ADD CONSTRAINT "veiculos_abastecimentos_pessoa_id_pessoas_id_fk" FOREIGN KEY ("pessoa_id") REFERENCES "public"."pessoas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "veiculos_abastecimentos" ADD CONSTRAINT "veiculos_abastecimentos_conferido_por_usuarios_id_fk" FOREIGN KEY ("conferido_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
