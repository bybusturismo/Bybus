CREATE TABLE IF NOT EXISTS "paytour_produtos" (
	"produto" text PRIMARY KEY NOT NULL,
	"pedidos" integer DEFAULT 0 NOT NULL,
	"ultima_vez_em" timestamp with time zone DEFAULT now() NOT NULL,
	"decisao" text,
	"passeio_id" uuid,
	"decidido_por" uuid,
	"decidido_em" timestamp with time zone
);
