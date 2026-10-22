#!/usr/bin/env bash
# Sobe o ambiente local completo com dados FICTÍCIOS: migra, semeia, inicia API (3333) e web (5173).
set -euo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL="${DATABASE_URL:-postgres://bybus:bybus_dev_local@localhost:5432/bybus_dev}"
export CHAVE_CRIPTOGRAFIA="${CHAVE_CRIPTOGRAFIA:-$(printf 'chave-de-desenvolvimento-32bytes' | base64)}"
export AMBIENTE=desenvolvimento EXIGIR_MFA_ADMIN="${EXIGIR_MFA_ADMIN:-false}" SEMEAR_FICTICIOS=true
pnpm --filter @bybus/core build
pnpm --filter @bybus/api db:migrate
pnpm --filter @bybus/api db:seed
pnpm --filter @bybus/api dev &
pnpm --filter @bybus/web dev
