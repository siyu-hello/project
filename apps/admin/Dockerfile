FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
RUN npm ci --ignore-scripts --workspace apps/admin --include-workspace-root
COPY apps/admin apps/admin
RUN npm run build --workspace apps/admin
FROM nginx:1.28-alpine
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
