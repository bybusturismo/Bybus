# Bybus Gestão — imagens de produção (contexto: raiz do repositório).
#   docker compose -f implantacao/docker-compose.yml --env-file implantacao/.env up -d --build
# Alvo "api": Node 22 + API Fastify (migra e prepara o banco ao subir).
# Alvo "web": Caddy servindo o front-end, com HTTPS automático e /api encaminhado para a API.

FROM node:22-alpine AS base
WORKDIR /app
# Certificado extra opcional (só para builds atrás de proxy corporativo): --secret id=ca,src=arquivo.crt
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm install -g pnpm@10.0.0 --no-fund --no-audit

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps
RUN pnpm --filter @bybus/core build && pnpm --filter @bybus/api build && pnpm --filter @bybus/web exec vite build

FROM base AS api
ENV NODE_ENV=production HOST=0.0.0.0 PORTA=3333
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    pnpm install --frozen-lockfile --prod --filter "@bybus/api..."
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/drizzle apps/api/drizzle
COPY --chmod=755 implantacao/iniciar-api.sh /usr/local/bin/iniciar-api
WORKDIR /app/apps/api
USER node
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:3333/api/saude').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["iniciar-api"]

FROM caddy:2-alpine AS web
COPY implantacao/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
