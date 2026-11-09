#!/usr/bin/env bash
# Instalador do Bybus Gestão num servidor Ubuntu 24.04 novo (ex.: VPS da Contabo), rodado como root.
# Uso (no servidor):
#   curl -fsSL https://raw.githubusercontent.com/bybusturismo/Bybus/<branch>/implantacao/instalar-servidor.sh -o instalar.sh
#   bash instalar.sh
# Pode rodar de novo sem estragar nada: atualiza o código e reaproveita o .env e o banco existentes.
set -euo pipefail

REPO="https://github.com/bybusturismo/Bybus.git"
BRANCH="${BYBUS_BRANCH:-producao}"
PASTA="/opt/bybus"
DOMINIO="${BYBUS_DOMINIO:-gestao.bybusturismo.com.br}"
COMPOSE=(docker compose -f "$PASTA/implantacao/docker-compose.yml" --env-file "$PASTA/implantacao/.env")

passo() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
aviso() { printf '\033[1;33m[aviso] %s\033[0m\n' "$1"; }

[ "$(id -u)" -eq 0 ] || { echo "Rode como root (entre com: ssh root@IP)."; exit 1; }
grep -q "Ubuntu" /etc/os-release || aviso "Este instalador foi feito para Ubuntu 24.04."
export DEBIAN_FRONTEND=noninteractive

# DNS estável no servidor (o DNS padrão de alguns VPS falha de vez em quando: "Could not resolve host").
if [ -d /etc/systemd ] && [ ! -f /etc/systemd/resolved.conf.d/dns.conf ]; then
  mkdir -p /etc/systemd/resolved.conf.d
  printf '[Resolve]\nDNS=1.1.1.1 8.8.8.8\nFallbackDNS=9.9.9.9\n' > /etc/systemd/resolved.conf.d/dns.conf
  systemctl restart systemd-resolved || true
fi

passo "1/7 Atualizando o sistema"
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confold upgrade
apt-get -y -q install ca-certificates curl git openssl ufw fail2ban unattended-upgrades docker.io docker-compose-v2

passo "2/7 Segurança do servidor (firewall, atualizações automáticas, bloqueio de tentativas de senha)"
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true
systemctl enable --now fail2ban >/dev/null 2>&1 || true
systemctl enable --now docker >/dev/null
# DNS fixo para o Docker (em alguns VPS o DNS interno falha ao montar as imagens: erro EAI_AGAIN).
if [ ! -f /etc/docker/daemon.json ]; then
  printf '{\n  "dns": ["1.1.1.1", "8.8.8.8"]\n}\n' > /etc/docker/daemon.json
  systemctl restart docker
fi
timedatectl set-timezone UTC || true

# Memória extra (swap) para a montagem das imagens, se o servidor tiver menos de 6 GB.
if [ "$(free -m | awk '/Mem:/ {print $2}')" -lt 6000 ] && ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

passo "3/7 Baixando o código do sistema"
if [ -d "$PASTA/.git" ]; then
  git -C "$PASTA" fetch -q origin "$BRANCH"
  git -C "$PASTA" checkout -q "$BRANCH"
  git -C "$PASTA" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$PASTA"
fi

passo "4/7 Configuração (.env com segredos gerados aqui no servidor)"
ENV="$PASTA/implantacao/.env"
definir() { if grep -q "^$1=" "$ENV"; then sed -i "s|^$1=.*|$1=$2|" "$ENV"; else echo "$1=$2" >> "$ENV"; fi; }
# Gera o segredo só se ainda estiver vazio (rodar de novo não troca senhas já em uso).
gerar_se_vazio() { grep -q "^$1=..*" "$ENV" || definir "$1" "$2"; }
if [ ! -f "$ENV" ]; then
  EMAIL_ADMIN=""
  while [ -z "$EMAIL_ADMIN" ]; do
    read -r -p "E-mail do administrador (login do sistema): " EMAIL_ADMIN < /dev/tty
  done
  cp "$PASTA/implantacao/producao.env.exemplo" "$ENV"
  definir DOMINIO "$DOMINIO"
  definir URL_PUBLICA "https://$DOMINIO"
  definir ADMIN_EMAIL "$EMAIL_ADMIN"
  definir ADMIN_SENHA_INICIAL "Bybus-$(openssl rand -hex 4)-$(openssl rand -hex 4)-7"
else
  echo "Já existe um .env: mantido (só os segredos que faltam são gerados)."
fi
gerar_se_vazio POSTGRES_PASSWORD "$(openssl rand -hex 24)"
gerar_se_vazio CHAVE_CRIPTOGRAFIA "$(openssl rand -base64 32)"
gerar_se_vazio INTEGRACAO_EMAIL_TOKEN "$(openssl rand -hex 32)"
gerar_se_vazio WHATSAPP_WEBHOOK_TOKEN "$(openssl rand -hex 32)"
# Usados só se o WhatsApp (Evolution) for ligado, mas o Docker exige que existam.
# Decisão do dono (09/11/2026): sem verificação em duas etapas.
definir EXIGIR_MFA_ADMIN false
gerar_se_vazio COFRE_CHAVE "$(openssl rand -hex 32)"
gerar_se_vazio META_WA_VERIFY_TOKEN "$(openssl rand -hex 24)"
gerar_se_vazio EVOLUTION_API_KEY "$(openssl rand -hex 24)"
gerar_se_vazio EVOLUTION_DB_PASSWORD "$(openssl rand -hex 24)"
SENHA_ADMIN="$(grep '^ADMIN_SENHA_INICIAL=' "$ENV" | cut -d= -f2- || true)"
chmod 600 "$ENV"
mkdir -p "$PASTA/implantacao/backups"

passo "5/7 Conferindo o endereço $DOMINIO"
IP_SERVIDOR="$(curl -fsS -4 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
IP_DOMINIO="$(getent ahostsv4 "$DOMINIO" | awk 'NR==1 {print $1}' || true)"
if [ "$IP_DOMINIO" != "$IP_SERVIDOR" ]; then
  aviso "$DOMINIO aponta para '${IP_DOMINIO:-nada}', mas este servidor é $IP_SERVIDOR."
  aviso "Confira no Cloudflare: registro A 'gestao' = $IP_SERVIDOR, nuvem CINZA. Sem isso o HTTPS não é emitido."
fi

passo "6/7 Montando e ligando o sistema (leva alguns minutos na primeira vez)"
# WhatsApp ligado (ligar-whatsapp.sh): a Evolution sobe junto.
if grep -q '^WHATSAPP_PROVEDOR=evolution' "$ENV"; then COMPOSE+=(--profile whatsapp); fi
# Se a internet oscilar no meio da montagem, tenta de novo (até 3 vezes).
for tentativa in 1 2 3; do
  if "${COMPOSE[@]}" up -d --build; then break; fi
  [ "$tentativa" -eq 3 ] && { echo "A montagem falhou 3 vezes. Mande ao Claude a foto das últimas linhas."; exit 1; }
  aviso "Falhou ao montar (tentativa $tentativa). Tentando de novo em 20 segundos..."; sleep 20
done

passo "7/7 Aguardando o sistema responder"
ok=""
for _ in $(seq 1 60); do
  if curl -fsS --max-time 5 "https://$DOMINIO/api/saude" >/dev/null 2>&1; then ok="https"; break; fi
  sleep 5
done
if [ -z "$ok" ] && "${COMPOSE[@]}" exec -T api wget -qO- http://localhost:3333/api/saude >/dev/null 2>&1; then ok="interno"; fi

# A senha inicial só serve para o primeiro acesso: sai do .env assim que o administrador foi criado.
if [ -n "$SENHA_ADMIN" ] && "${COMPOSE[@]}" logs api 2>/dev/null | grep -q "Administrador .* pronto"; then
  sed -i '/^ADMIN_SENHA_INICIAL=/d' "$ENV"
fi

echo
echo "================================================================"
case "$ok" in
  https)   echo " PRONTO: https://$DOMINIO" ;;
  interno) echo " O sistema está ligado, mas o HTTPS ainda não respondeu."
           echo " Confira o registro 'gestao' no Cloudflare (IP $IP_SERVIDOR, nuvem cinza) e espere alguns minutos." ;;
  *)       echo " O sistema não respondeu. Mande ao Claude a saída do comando:"
           echo "   ${COMPOSE[*]} logs --tail=80 api web" ;;
esac
if [ -n "$SENHA_ADMIN" ]; then
  echo
  echo " Primeiro acesso:"
  echo "   E-mail: $(grep '^ADMIN_EMAIL=' "$ENV" | cut -d= -f2)"
  echo "   Senha temporária: $SENHA_ADMIN"
  echo " Anote a senha AGORA (ela não fica guardada). No 1º login o sistema pede"
  echo " uma senha nova e o MFA (app autenticador no celular). NÃO mande esta senha no chat."
fi
echo "================================================================"
