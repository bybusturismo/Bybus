-- Dono, 18/11/2026: o perfil padrão Motorista passa a fazer o checklist do veículo, o diário de km e mandar a foto do cupom de abastecimento.
UPDATE "perfis" SET "permissoes" = array_append("permissoes", 'frota:checklist') WHERE "codigo" = 'MOTORISTA' AND NOT ('frota:checklist' = ANY("permissoes"));
