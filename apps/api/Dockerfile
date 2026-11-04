FROM node:24.19.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
RUN npm ci --ignore-scripts --omit=dev --workspace apps/api --include-workspace-root
COPY apps/api apps/api
WORKDIR /app/apps/api
ENV NODE_ENV=production TZ=UTC DO_NOT_TRACK=1
EXPOSE 3000
CMD ["sh", "-c", "node prisma/migrate.mjs && node prisma/seed.mjs && node src/main.mjs"]
