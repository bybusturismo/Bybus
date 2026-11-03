CREATE TABLE IF NOT EXISTS "integracoes_estado" (
	"chave" text PRIMARY KEY NOT NULL,
	"cursor" text,
	"ultima_execucao_em" timestamp with time zone,
	"ultimo_resultado" jsonb,
	"ultimo_erro" text,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
