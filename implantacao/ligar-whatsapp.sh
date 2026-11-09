#!/usr/bin/env bash
# Liga o WhatsApp do Bybus pela Evolution API (igual ao APP TOMA): sem provedor pago, o número fica como "aparelho conectado".
# NÃO é oficial (WhatsApp Web): há risco de bloqueio do número. Sem disparo em massa. Ver docs/produto/modulo-whatsapp.md.
# Uso (no servidor, como root):  bash /opt/bybus/implantacao/ligar-whatsapp.sh
# Pode rodar de novo: reaproveita a instância e mostra um código novo se o celular ainda não estiver conectado.
set -euo pipefail

PASTA="/opt/bybus/implantacao"
ENV="$PASTA/.env"
COMPOSE=(docker compose -f "$PASTA/docker-compose.yml" --env-file "$ENV" --profile whatsapp)
[ -f "$ENV" ] || { echo "Não achei $ENV. Rode antes o instalar-servidor.sh."; exit 1; }
cd "$PASTA"

definir() { if grep -q "^$1=" "$ENV"; then sed -i "s|^$1=.*|$1=$2|" "$ENV"; else echo "$1=$2" >> "$ENV"; fi; }
valor() { grep "^$1=" "$ENV" | cut -d= -f2- || true; }
gerar_se_vazio() { [ -n "$(valor "$1")" ] || definir "$1" "$2"; }

echo "==> 1/5 Configuração"
gerar_se_vazio EVOLUTION_API_KEY "$(openssl rand -hex 24)"
gerar_se_vazio EVOLUTION_DB_PASSWORD "$(openssl rand -hex 24)"
gerar_se_vazio WHATSAPP_WEBHOOK_TOKEN "$(openssl rand -hex 32)"
definir WHATSAPP_PROVEDOR evolution
definir EVOLUTION_URL "http://evolution:8080"
gerar_se_vazio EVOLUTION_INSTANCIA bybus
INSTANCIA="$(valor EVOLUTION_INSTANCIA)"

echo "==> 2/5 Ligando a Evolution (a primeira vez baixa a imagem, pode levar alguns minutos)"
"${COMPOSE[@]}" up -d

# Chamadas à Evolution feitas de dentro da API (a Evolution não tem porta pública).
evo() { # evo MÉTODO CAMINHO [JSON]
  "${COMPOSE[@]}" exec -T -e M="$1" -e P="$2" -e B="${3:-}" api node --input-type=module -e '
    const r = await fetch(process.env.EVOLUTION_URL + process.env.P, { method: process.env.M, headers: { apikey: process.env.EVOLUTION_API_KEY, "content-type": "application/json" }, body: process.env.B || undefined });
    const t = await r.text(); console.log(t); if (!r.ok && !/already|exist|em uso|in use/i.test(t)) process.exit(1);'
}

echo "==> 3/5 Aguardando a Evolution responder"
for _ in $(seq 1 60); do
  if evo GET / >/dev/null 2>&1; then ok=1; break; fi
  sleep 5
done
[ "${ok:-}" = 1 ] || { echo "A Evolution não respondeu. Mande ao Claude: ${COMPOSE[*]} logs --tail=60 evolution"; exit 1; }

echo "==> 4/5 Instância '$INSTANCIA' e aviso das mensagens para o Bybus"
WEBHOOK="http://api:3333/api/interno/whatsapp/$(valor WHATSAPP_WEBHOOK_TOKEN)"
EVENTOS='["MESSAGES_UPSERT","MESSAGES_UPDATE","CONNECTION_UPDATE"]'
evo POST /instance/create "{\"instanceName\":\"$INSTANCIA\",\"integration\":\"WHATSAPP-BAILEYS\",\"qrcode\":true}" >/dev/null || true
evo POST "/webhook/set/$INSTANCIA" "{\"webhook\":{\"enabled\":true,\"url\":\"$WEBHOOK\",\"byEvents\":false,\"base64\":false,\"events\":$EVENTOS}}" >/dev/null

estado() { evo GET "/instance/connectionState/$INSTANCIA" 2>/dev/null | grep -o '"state":"[a-z]*"' | cut -d'"' -f4 || true; }
if [ "$(estado)" = "open" ]; then
  echo; echo "O WhatsApp já está conectado. Nada a fazer."; exit 0
fi

echo "==> 5/5 Conectar o celular"
NUMERO=""
while [ -z "$NUMERO" ]; do
  read -r -p "Número do WhatsApp que será conectado (com DDI e DDD, só números, ex.: 5548999990000): " NUMERO < /dev/tty
  NUMERO="$(echo "$NUMERO" | tr -cd '0-9')"
done
CODIGO=""
for _ in 1 2 3 4 5 6; do  # a Evolution leva alguns segundos para falar com o WhatsApp
  RESP="$(evo GET "/instance/connect/$INSTANCIA?number=$NUMERO" || true)"
  CODIGO="$(echo "$RESP" | grep -o '"pairingCode":"[^"]*"' | cut -d'"' -f4 || true)"
  [ -n "$CODIGO" ] && break
  sleep 5
done
echo
echo "================================================================"
if [ -n "$CODIGO" ]; then
  echo " No celular desse número: WhatsApp > Configurações > Aparelhos conectados"
  echo " > Conectar um aparelho > Conectar com número de telefone, e digite:"
  echo
  echo "        $CODIGO"
else
  echo " Não veio o código. Mande ao Claude a foto desta tela."
fi
echo "================================================================"
echo "Aguardando a conexão (até 3 minutos)…"
for _ in $(seq 1 36); do
  if [ "$(estado)" = "open" ]; then echo; echo "PRONTO: WhatsApp conectado ao Bybus."; exit 0; fi
  sleep 5
done
echo "Ainda não conectou. Rode este comando de novo para gerar outro código."
