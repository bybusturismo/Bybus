#!/bin/sh
# Sobe a API: aplica migrações, prepara dados de referência (e o 1º administrador, se informado) e inicia.
set -e
node dist/db/migrar.js
node dist/db/semear.js
exec node dist/server.js
