-- Decisão do dono (09/11/2026): retirar a verificação em duas etapas de todo mundo. Desliga o código do celular de quem já tinha
-- (uma vez só, nesta migração); quem quiser pode ligar de novo em "Meu perfil".
UPDATE "usuarios" SET "totp_ativo" = false, "totp_segredo_cifrado" = NULL, "totp_ultimo_passo" = NULL WHERE "totp_ativo" = true OR "totp_segredo_cifrado" IS NOT NULL;
