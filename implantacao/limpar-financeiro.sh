#!/usr/bin/env bash
# Zera os lançamentos do financeiro para recomeçar a importação do zero (pedido do dono, 11/11/2026).
# Antes de apagar, faz uma cópia completa do banco (dá para voltar). Pede para digitar APAGAR.
# Apaga: contas a pagar/receber, linhas de extrato e transferências, extratos importados, conciliações recusadas,
#        revendas, fechamentos do caixa, importações registradas e pendências da planilha; zera os saldos iniciais das contas.
# Mantém: contas (bancos, caixa, cartão), categorias, sinônimos, regras, favorecidos e todo o resto do sistema.
# Uso (no servidor): bash /opt/bybus/implantacao/limpar-financeiro.sh
set -euo pipefail
PASTA="/opt/bybus"
ENV="$PASTA/implantacao/.env"
[ -f "$ENV" ] || { echo "Não achei $ENV."; exit 1; }
COMPOSE=(docker compose -f "$PASTA/implantacao/docker-compose.yml" --env-file "$ENV")
grep -q '^WHATSAPP_PROVEDOR=evolution' "$ENV" && COMPOSE+=(--profile whatsapp)
psql() { "${COMPOSE[@]}" exec -T db psql -U bybus -d bybus -v ON_ERROR_STOP=1 -At "$@"; }

echo "Hoje o financeiro tem:"
psql -c "select '  ' || count(*) || ' lançamentos' from fin_lancamentos"
psql -c "select '  ' || count(*) || ' linhas de extrato/transferências' from fin_extrato_linhas"
echo
echo "ATENÇÃO: isto apaga TODOS os lançamentos do financeiro, de todas as praças."
read -r -p "Para continuar, digite APAGAR (em maiúsculas): " RESPOSTA < /dev/tty
[ "$RESPOSTA" = "APAGAR" ] || { echo "Nada foi apagado."; exit 0; }

mkdir -p "$PASTA/implantacao/backups"
COPIA="$PASTA/implantacao/backups/antes-de-limpar-financeiro-$(date +%Y%m%d-%H%M%S).dump"
echo "Fazendo a cópia de segurança do banco..."
"${COMPOSE[@]}" exec -T db pg_dump -U bybus -d bybus -Fc > "$COPIA"
[ -s "$COPIA" ] || { echo "A cópia de segurança falhou. Nada foi apagado."; exit 1; }
chmod 600 "$COPIA"

psql <<'SQL'
BEGIN;
DELETE FROM fin_recusas;
DELETE FROM fin_revendas;
DELETE FROM fin_extrato_linhas;
DELETE FROM fin_extratos;
DELETE FROM fin_lancamentos;
DELETE FROM fin_fechamentos_caixa;
DELETE FROM fin_importacoes;
DELETE FROM fin_planilha_pendencias;
UPDATE fin_contas SET saldo_inicial_centavos = 0, saldo_inicial_em = NULL;
INSERT INTO auditoria (acao, entidade, dados) VALUES ('FIN_FINANCEIRO_ZERADO', 'fin_lancamentos', jsonb_build_object('origem', 'limpar-financeiro.sh'));
COMMIT;
SQL

echo
echo "PRONTO: lançamentos apagados. Contas, categorias e sinônimos foram mantidos."
echo "Cópia de segurança (para voltar, se precisar): $COPIA"
