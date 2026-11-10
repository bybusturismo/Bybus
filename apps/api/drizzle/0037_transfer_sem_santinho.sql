-- Dono (10/11/2026): o transfer não atende mais o Santinho. O ponto passa a ser só "Transfer — Ingleses"
-- e o bairro Santinho (se alguém o cadastrou) fica desativado (o histórico dos dias passados é mantido).
UPDATE "pontos_embarque"
SET "nome" = 'Transfer — Ingleses', "endereco" = 'Centrinho dos Ingleses e Ingleses Norte 6h40–6h50'
WHERE "nome" = 'Transfer — Ingleses e Santinho';
--> statement-breakpoint
UPDATE "transfer_bairros" SET "ativo" = false WHERE lower("nome") = 'santinho';
