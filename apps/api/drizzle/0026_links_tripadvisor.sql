-- Páginas do Tripadvisor por praça (dono, 09/11/2026). Não sobrescreve um link já configurado pela tela.
INSERT INTO "marketing_config" ("chave", "valor")
SELECT 'link_tripadvisor_' || "id", 'https://www.tripadvisor.com/Attraction_Review-g303576-d2362697-Reviews-Floripa_by_Bus-Florianopolis_State_of_Santa_Catarina.html' FROM "unidades" WHERE "codigo" = 'FLN'
ON CONFLICT ("chave") DO NOTHING;--> statement-breakpoint
INSERT INTO "marketing_config" ("chave", "valor")
SELECT 'link_tripadvisor_' || "id", 'https://www.tripadvisor.com/Attraction_Review-g680306-d10686390-Reviews-BC_by_Bus-Balneario_Camboriu_State_of_Santa_Catarina.html' FROM "unidades" WHERE "codigo" = 'BC'
ON CONFLICT ("chave") DO NOTHING;
