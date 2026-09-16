# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS development
COPY . .

FROM development AS build
RUN npm run build
RUN npm run build:api

FROM node:22-bookworm-slim AS api-production
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5174 \
    GROCERY_GETTER_DB_PATH=/app/data/grocery-getter.sqlite
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/server-dist ./server-dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 5174
CMD ["node", "server-dist/server/index.js"]

FROM nginx:1.27-alpine AS web-production
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 5173
