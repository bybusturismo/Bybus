#!/usr/bin/env bash
# Liga o envio de e-mail do sistema (link de "Esqueci minha senha"). Usa o Gmail com uma "senha de app":
# Conta Google > Segurança > Verificação em duas etapas (ligada) > Senhas de app > criar "Bybus Gestão".
# A senha de app é pedida SEM aparecer na tela e fica só no .env do servidor.  Uso: bash ligar-email.sh
set -euo pipefail
ENV="/opt/bybus/implantacao/.env"
[ -f "$ENV" ] || { echo "Não achei $ENV."; exit 1; }
definir() { if grep -q "^$1=" "$ENV"; then sed -i "s|^$1=.*|$1=$2|" "$ENV"; else echo "$1=$2" >> "$ENV"; fi; }
read -r -p "E-mail que vai enviar (ex.: admbybus@gmail.com): " EMAIL < /dev/tty
echo "Cole a SENHA DE APP do Google (16 letras; não aparece na tela) e aperte Enter:"
read -r -s SENHA < /dev/tty; echo
EMAIL="$(echo "$EMAIL" | tr -d '[:space:]')"; SENHA="$(echo "$SENHA" | tr -d '[:space:]')"
[[ "$EMAIL" == *@*.* ]] && [ ${#SENHA} -ge 8 ] || { echo "E-mail ou senha de app inválidos. Nada foi alterado."; exit 1; }
case "$SENHA" in *"|"*) echo "Caractere inválido. Nada foi alterado."; exit 1;; esac
definir EMAIL_USUARIO "$EMAIL"
definir EMAIL_SENHA "$SENHA"
chmod 600 "$ENV"; unset SENHA
COMPOSE=(docker compose -f /opt/bybus/implantacao/docker-compose.yml --env-file "$ENV")
grep -q '^WHATSAPP_PROVEDOR=evolution' "$ENV" && COMPOSE+=(--profile whatsapp)
"${COMPOSE[@]}" up -d >/dev/null
echo "PRONTO: e-mail ligado. Teste em https://$(grep '^DOMINIO=' "$ENV" | cut -d= -f2-) > Esqueci minha senha."
