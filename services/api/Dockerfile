FROM node:24-bookworm-slim AS web
WORKDIR /build/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
COPY design/tokens/ /build/design/tokens/
RUN npm run build:client

FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY services/api/package.json services/api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATABASE_PATH=/data/simlink.sqlite WEB_ROOT=/app/public
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=web --chown=node:node /build/apps/web/dist/client ./public
COPY --chown=node:node services/api/package.json ./
COPY --chown=node:node services/api/src ./src
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8787
CMD ["node", "src/server.mjs"]
