#!/usr/bin/env bash
# Gera o app Android "By Bus" (arquivo .apk) no próprio servidor e deixa para baixar em https://<domínio>/app/by-bus.apk
# (pedido do dono, 11/11/2026: começar sem Google Play, instalando o arquivo direto).
# O app é uma "casca" que abre o sistema: as telas se atualizam sozinhas a cada publicação. Só é preciso gerar de novo
# quando mudar algo do próprio app (nome, ícone, permissões) — eu aviso quando for o caso.
# A CHAVE de assinatura é criada na primeira vez e fica só neste servidor (implantacao/android-chave/). NÃO APAGUE:
# sem ela, os celulares não aceitam atualizar o app (teria que desinstalar e instalar de novo).
# Uso (no servidor): bash /opt/bybus/implantacao/gerar-app-android.sh
set -euo pipefail
PASTA="/opt/bybus"
APP="$PASTA/app-celular"
CHAVES="$PASTA/implantacao/android-chave"
SDK="$PASTA/implantacao/android-sdk"
SAIDA="$PASTA/implantacao/app-download"
ENV="$PASTA/implantacao/.env"
[ -d "$APP/android" ] || { echo "Não achei $APP/android. Espere a atualização automática do servidor e tente de novo."; exit 1; }
DOMINIO="$(grep '^DOMINIO=' "$ENV" | cut -d= -f2- || true)"
mkdir -p "$CHAVES" "$SDK" "$SAIDA"
chmod 700 "$CHAVES"

passo() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }

# Imagens fixas (versões com mais de 2 semanas).
NODE_IMG="node:22.20.0-bookworm-slim"
JDK_IMG="eclipse-temurin:21.0.8_9-jdk-noble"
FERRAMENTAS="commandlinetools-linux-13114758_latest.zip"

passo "1/4 Chave de assinatura"
if [ ! -f "$CHAVES/bybus.keystore" ]; then
  SENHA="$(openssl rand -hex 16)"
  printf '%s' "$SENHA" > "$CHAVES/senha"
  chmod 600 "$CHAVES/senha"
  docker run --rm -v "$CHAVES:/chave" "$JDK_IMG" keytool -genkeypair -v -keystore /chave/bybus.keystore -alias bybus \
    -keyalg RSA -keysize 4096 -validity 10000 -storepass "$SENHA" -keypass "$SENHA" \
    -dname "CN=By Bus Turismo, O=By Bus Turismo, L=Florianopolis, ST=SC, C=BR" >/dev/null
  chmod 600 "$CHAVES/bybus.keystore"
  echo "Chave criada em $CHAVES (fica só neste servidor; não apague esta pasta)."
else
  echo "Usando a chave que já existe."
fi
SENHA="$(cat "$CHAVES/senha")"

passo "2/4 Pacotes do app"
docker run --rm -v "$APP:/app" -w /app "$NODE_IMG" sh -c "npm ci --no-audit --no-fund && npx cap sync android"

passo "3/4 Ferramentas do Android (só na primeira vez demora; ficam guardadas)"
docker run --rm -v "$SDK:/sdk" "$JDK_IMG" bash -c "
  set -e
  if [ ! -x /sdk/cmdline-tools/latest/bin/sdkmanager ]; then
    apt-get update -qq && apt-get install -y -qq unzip curl >/dev/null
    curl -fsSL -o /tmp/ferramentas.zip https://dl.google.com/android/repository/$FERRAMENTAS
    mkdir -p /sdk/cmdline-tools && unzip -q /tmp/ferramentas.zip -d /sdk/cmdline-tools && mv /sdk/cmdline-tools/cmdline-tools /sdk/cmdline-tools/latest
  fi
  yes | /sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root=/sdk --licenses >/dev/null
  /sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root=/sdk 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0' >/dev/null
"

passo "4/4 Montando o app (alguns minutos)"
VERSAO_CODIGO="$(date -u +%y%m%d%H)"   # sempre maior que a anterior: o celular aceita a atualização
VERSAO_NOME="1.0.$(date -u +%Y%m%d)"
docker run --rm -v "$APP:/app" -v "$SDK:/sdk" -v "$CHAVES:/chave:ro" -v "$SAIDA:/saida" -w /app/android \
  -e ANDROID_HOME=/sdk -e ANDROID_SDK_ROOT=/sdk \
  -e BYBUS_KEYSTORE=/chave/bybus.keystore -e BYBUS_KEYSTORE_SENHA="$SENHA" \
  -e BYBUS_VERSAO_CODIGO="$VERSAO_CODIGO" -e BYBUS_VERSAO_NOME="$VERSAO_NOME" \
  "$JDK_IMG" bash -c "chmod +x gradlew && ./gradlew --no-daemon -q assembleRelease && cp app/build/outputs/apk/release/app-release.apk /saida/by-bus.apk"
chmod 644 "$SAIDA/by-bus.apk"
# Volta os arquivos do app ao que está no GitHub (a montagem mexe em alguns; a atualização automática precisa deles limpos).
git -C "$PASTA" checkout -q -- app-celular 2>/dev/null || true

echo
echo "================================================================"
echo " PRONTO: app By Bus versão $VERSAO_NOME"
echo " Link para baixar no celular: https://${DOMINIO:-SEU-DOMINIO}/app/by-bus.apk"
echo "================================================================"
