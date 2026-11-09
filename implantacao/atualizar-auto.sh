#!/usr/bin/env bash
# Atualizador automático do Bybus Gestão (decisão do dono, 09/11/2026): roda a cada 10 minutos pelo systemd.
# Só publica o que estiver na área "producao" do projeto (liberada pelo dono). Antes: cópia do banco. Depois: confere a saúde;
# se o sistema não voltar, retorna à versão anterior do código sozinho. Registro em /var/log/bybus-atualizacao.log.
set -uo pipefail

PASTA="/opt/bybus"
RAMO="${BYBUS_RAMO_PRODUCAO:-producao}"
ENV="$PASTA/implantacao/.env"
LOG="/var/log/bybus-atualizacao.log"
exec 9>/run/bybus-atualizacao.lock
flock -n 9 || exit 0
registrar() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }

cd "$PASTA" || exit 1
git fetch -q origin "$RAMO" 2>>"$LOG" || { registrar "sem acesso ao GitHub; tento de novo depois"; exit 0; }
NOVA="$(git rev-parse "origin/$RAMO")"
ATUAL="$(git rev-parse HEAD)"
[ "$NOVA" = "$ATUAL" ] && exit 0
[ "$NOVA" = "$(git rev-parse -q --verify refs/bybus/recusada 2>/dev/null)" ] && exit 0

COMPOSE=(docker compose -f "$PASTA/implantacao/docker-compose.yml" --env-file "$ENV")
grep -q '^WHATSAPP_PROVEDOR=evolution' "$ENV" && COMPOSE+=(--profile whatsapp)
DOMINIO="$(grep '^DOMINIO=' "$ENV" | cut -d= -f2-)"

saudavel() {
  for _ in $(seq 1 36); do
    curl -fsS --max-time 5 "https://$DOMINIO/api/saude" >/dev/null 2>&1 && return 0
    sleep 5
  done
  return 1
}

registrar "nova versão ${NOVA:0:7} (atual ${ATUAL:0:7}): começando"
mkdir -p "$PASTA/implantacao/backups"
COPIA="$PASTA/implantacao/backups/antes-atualizacao-$(date -u +%Y%m%d-%H%M).dump"
if ! "${COMPOSE[@]}" exec -T db pg_dump -U bybus -d bybus -Fc > "$COPIA" 2>>"$LOG"; then
  registrar "falhou a cópia do banco: atualização cancelada"; rm -f "$COPIA"; exit 1
fi
find "$PASTA/implantacao/backups" -name 'antes-atualizacao-*.dump' -mtime +14 -delete

git checkout -q -B "$RAMO" "origin/$RAMO"
if "${COMPOSE[@]}" up -d --build >>"$LOG" 2>&1 && saudavel; then
  registrar "versão ${NOVA:0:7} no ar"
  exit 0
fi

registrar "a versão ${NOVA:0:7} não subiu: voltando para ${ATUAL:0:7} (cópia do banco em $COPIA)"
git checkout -q -B "$RAMO" "$ATUAL"
"${COMPOSE[@]}" up -d --build >>"$LOG" 2>&1
if saudavel; then registrar "voltou para ${ATUAL:0:7}"; else registrar "ATENÇÃO: o sistema não voltou nem na versão anterior"; fi
# Não tenta de novo a mesma versão a cada 10 min: só quando sair outra.
git update-ref "refs/bybus/recusada" "$NOVA"
exit 1
