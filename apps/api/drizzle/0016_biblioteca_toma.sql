CREATE TABLE IF NOT EXISTS "biblioteca_acessos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pagina_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"nivel" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "biblioteca_anexos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pagina_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"tipo" text NOT NULL,
	"uso" text NOT NULL,
	"tamanho" integer NOT NULL,
	"dados" "bytea" NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "biblioteca_colaboradores" (
	"pagina_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"ultima_edicao_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "biblioteca_colaboradores_pagina_id_usuario_id_pk" PRIMARY KEY("pagina_id","usuario_id")
);
--> statement-breakpoint
ALTER TABLE "biblioteca_paginas" ADD COLUMN "icone" text;--> statement-breakpoint
ALTER TABLE "biblioteca_paginas" ADD COLUMN "texto_busca" text;--> statement-breakpoint
ALTER TABLE "biblioteca_paginas" ADD COLUMN "excluida_em" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "biblioteca_acessos" ADD CONSTRAINT "biblioteca_acessos_pagina_id_biblioteca_paginas_id_fk" FOREIGN KEY ("pagina_id") REFERENCES "public"."biblioteca_paginas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "biblioteca_acessos" ADD CONSTRAINT "biblioteca_acessos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "biblioteca_anexos" ADD CONSTRAINT "biblioteca_anexos_pagina_id_biblioteca_paginas_id_fk" FOREIGN KEY ("pagina_id") REFERENCES "public"."biblioteca_paginas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "biblioteca_anexos" ADD CONSTRAINT "biblioteca_anexos_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "biblioteca_colaboradores" ADD CONSTRAINT "biblioteca_colaboradores_pagina_id_biblioteca_paginas_id_fk" FOREIGN KEY ("pagina_id") REFERENCES "public"."biblioteca_paginas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "biblioteca_colaboradores" ADD CONSTRAINT "biblioteca_colaboradores_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "biblioteca_acessos_uq" ON "biblioteca_acessos" USING btree ("pagina_id","usuario_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "biblioteca_anexos_pagina_idx" ON "biblioteca_anexos" USING btree ("pagina_id");