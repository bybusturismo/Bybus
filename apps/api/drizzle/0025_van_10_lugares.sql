-- Van do transfer: motorista + 10 passageiros (dono, 09/11/2026). Só preenche onde ainda não há valor.
UPDATE "transfer_config" SET "lugares_padrao" = 10 WHERE "lugares_padrao" IS NULL;
