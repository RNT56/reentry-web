FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY public ./public
COPY scripts/build.mjs ./scripts/build.mjs
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173 DATABASE_PATH=/data/reentry.sqlite
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force && mkdir /data && chown node:node /data
COPY --from=build --chown=node:node /app/dist/public ./dist/public
COPY --chown=node:node server ./server
COPY --chown=node:node src/domain ./src/domain
COPY --chown=node:node scripts/backup.mjs ./scripts/backup.mjs
USER node
VOLUME /data
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:4173/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/index.js"]
