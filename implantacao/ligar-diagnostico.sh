#!/usr/bin/env bash
# Liga o diagnóstico só de leitura (/api/diagnostico) para o assistente acompanhar a produção (dono, 19/11/2026).
# Gera uma senha nova (troca a anterior, se houver), grava só no .env e mostra UMA vez, para colar no formulário seguro da
# conversa com o assistente (nunca no chat). Para desligar: bash ligar-diagnostico.sh desligar
# Uso (no servidor): bash /opt/bybus/implantacao/ligar-diagnostico.sh
set -euo pipefail
ENV="/opt/bybus/implantacao/.env"
[ -f "$ENV" ] || { echo "Não achei $ENV."; exit 1; }
COMPOSE=(docker compose -f /opt/bybus/implantacao/docker-compose.yml --env-file "$ENV")
grep -q '^WHATSAPP_PROVEDOR=evolution' "$ENV" && COMPOSE+=(--profile whatsapp)
if [ "${1:-}" = "desligar" ]; then
  sed -i '/^DIAGNOSTICO_TOKEN=/d' "$ENV"
  "${COMPOSE[@]}" up -d --force-recreate api >/dev/null
  echo "PRONTO: diagnóstico desligado (o endereço deixou de existir)."
  exit 0
fi
TOKEN="$(openssl rand -hex 32)"
if grep -q '^DIAGNOSTICO_TOKEN=' "$ENV"; then sed -i "s|^DIAGNOSTICO_TOKEN=.*|DIAGNOSTICO_TOKEN=$TOKEN|" "$ENV"; else echo "DIAGNOSTICO_TOKEN=$TOKEN" >> "$ENV"; fi
chmod 600 "$ENV"
mkdir -p /opt/bybus/implantacao/estado
# A API só lê o .env ao ser recriada.
"${COMPOSE[@]}" up -d --force-recreate api >/dev/null
echo
echo "PRONTO: diagnóstico ligado. Copie a senha abaixo e cole SÓ no formulário seguro que o assistente abriu (não no chat):"
echo
echo "    $TOKEN"
echo
echo "Depois de colar, limpe a tela com: clear"
