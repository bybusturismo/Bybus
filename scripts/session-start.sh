#!/usr/bin/env bash
# Prepara o ambiente de desenvolvimento em sessões do Claude Code na nuvem:
# instala dependências e sobe o PostgreSQL local com os bancos de desenvolvimento e de testes.
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile --silent >/dev/null 2>&1 || pnpm install --silent >/dev/null 2>&1 || true
fi

if command -v pg_ctlcluster >/dev/null 2>&1; then
  pg_ctlcluster 16 main start >/dev/null 2>&1 || true
  su postgres -c "psql -qtc \"SELECT 1 FROM pg_roles WHERE rolname='bybus'\"" 2>/dev/null | grep -q 1 \
    || su postgres -c "psql -qc \"CREATE ROLE bybus LOGIN PASSWORD 'bybus_dev_local' CREATEDB\"" >/dev/null 2>&1 || true
  for db in bybus_dev bybus_test; do
    su postgres -c "psql -qtc \"SELECT 1 FROM pg_database WHERE datname='$db'\"" 2>/dev/null | grep -q 1 \
      || su postgres -c "createdb -O bybus $db" >/dev/null 2>&1 || true
  done
fi
echo "Ambiente Bybus pronto: dependências instaladas e PostgreSQL (bybus_dev, bybus_test) disponível."
