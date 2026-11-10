-- Link do perfil no Google da Floripa by Bus (dono, 10/11/2026). Não sobrescreve um link já configurado pela tela.
INSERT INTO "marketing_config" ("chave", "valor")
SELECT 'link_google_' || "id", 'https://maps.app.goo.gl/ApHoQ2bE7i17i8QA8' FROM "unidades" WHERE "codigo" = 'FLN'
ON CONFLICT ("chave") DO NOTHING;
