-- Encontro da van com o ônibus no Villa Romana às 07:45 (dono, 06/11/2026). Só preenche onde ainda não há horário.
UPDATE "transfer_config" SET "chegada_prevista" = '07:45'
WHERE "chegada_prevista" IS NULL
  AND "ponto_encontro_id" IN (SELECT "id" FROM "pontos_embarque" WHERE lower("nome") LIKE '%villa romana%');
