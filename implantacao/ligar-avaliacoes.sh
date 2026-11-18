#!/usr/bin/env bash
# Liga a leitura das avaliações do Google (perfil da empresa) e do Tripadvisor (dono, 18/11/2026).
# Pede o ID e o segredo do cliente OAuth do Google Cloud e a chave da API de conteúdo do Tripadvisor. Pode deixar um em branco
# para ligar só o outro. Nada aparece na tela; tudo fica só no .env do servidor. Passo a passo: docs/produto/modulo-marketing.md.
# Uso (no servidor): bash /opt/bybus/implantacao/ligar-avaliacoes.sh
set -euo pipefail
ENV="/opt/bybus/implantacao/.env"
[ -f "$ENV" ] || { echo "Não achei $ENV."; exit 1; }
definir() { if grep -q "^$1=" "$ENV"; then sed -i "s|^$1=.*|$1=$2|" "$ENV"; else echo "$1=$2" >> "$ENV"; fi; }
limpo() { echo "$1" | tr -d '[:space:]'; }
grep -q '^URL_PUBLICA=https://' "$ENV" || { echo "Falta URL_PUBLICA no .env (o endereço do sistema, com https). Nada foi alterado."; exit 1; }

echo "GOOGLE — cole o ID do cliente OAuth (termina com .apps.googleusercontent.com) ou só Enter para pular:"
read -r -s GID < /dev/tty; echo; GID="$(limpo "$GID")"
if [ -n "$GID" ]; then
  [[ "$GID" == *.apps.googleusercontent.com ]] || { echo "Isso não parece um ID de cliente do Google. Nada foi alterado."; exit 1; }
  echo "GOOGLE — cole o SEGREDO do cliente OAuth (não aparece) e aperte Enter:"
  read -r -s GSEG < /dev/tty; echo; GSEG="$(limpo "$GSEG")"
  [ ${#GSEG} -ge 10 ] || { echo "Segredo muito curto. Nada foi alterado."; exit 1; }
fi
echo "TRIPADVISOR — cole a chave da API de conteúdo (não aparece) ou só Enter para pular:"
read -r -s TAK < /dev/tty; echo; TAK="$(limpo "$TAK")"
if [ -n "$TAK" ] && [ ${#TAK} -lt 10 ]; then echo "Chave muito curta. Nada foi alterado."; exit 1; fi
[ -n "$GID" ] || [ -n "$TAK" ] || { echo "Nada informado. Nada foi alterado."; exit 0; }
for v in "${GID:-}" "${GSEG:-}" "$TAK"; do case "$v" in *"|"*) echo "Caractere inválido. Nada foi alterado."; exit 1;; esac; done

[ -n "$GID" ] && { definir GOOGLE_PERFIL_CLIENT_ID "$GID"; definir GOOGLE_PERFIL_CLIENT_SECRET "$GSEG"; }
[ -n "$TAK" ] && definir TRIPADVISOR_API_KEY "$TAK"
LIGOU_TA="${TAK:+sim}"
chmod 600 "$ENV"; unset GSEG TAK
COMPOSE=(docker compose -f /opt/bybus/implantacao/docker-compose.yml --env-file "$ENV")
grep -q '^WHATSAPP_PROVEDOR=evolution' "$ENV" && COMPOSE+=(--profile whatsapp)
# A API só lê o .env ao ser recriada.
"${COMPOSE[@]}" up -d --force-recreate api >/dev/null
URL="$(grep '^URL_PUBLICA=' "$ENV" | cut -d= -f2-)"
echo "PRONTO."
[ -n "$GID" ] && echo "Google: abra $URL/marketing/avaliacoes-online e clique em \"Conectar conta Google\" (entre com a conta dona do perfil)."
[ -n "$LIGOU_TA" ] && echo "Tripadvisor: na mesma tela, clique em \"Atualizar agora\"."
echo "IP deste servidor (para restringir a chave do Tripadvisor): $(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo 'não consegui descobrir')"
