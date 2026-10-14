FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY server ./server
RUN npm run build

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY public ./public
RUN mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production STATE_DIR=/data WEB_CONCURRENCY=1
EXPOSE 3000
CMD ["node", "dist/main.js"]
