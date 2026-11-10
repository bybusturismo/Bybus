-- Dono (10/11/2026): a fiscalização de trânsito do turismo exige a lista de passageiros com o documento completo.
-- O perfil padrão GUIA passa a ver o documento inteiro (cada visualização continua registrada na auditoria).
UPDATE "perfis" SET "permissoes" = array_append("permissoes", 'manifesto:documentos')
WHERE "codigo" = 'GUIA' AND NOT ('manifesto:documentos' = ANY("permissoes"));
