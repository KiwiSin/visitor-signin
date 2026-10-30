# ---- Build the web app -------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web ./web
RUN npm run build

# ---- Runtime -------------------------------------------------------------------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    UPLOAD_DIR=/data/uploads \
    PORT=8080
# pg_dump / psql for backups; tzdata so TZ works
RUN apk add --no-cache postgresql17-client tzdata
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY migrations ./migrations
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /data/uploads /backups && chown -R node:node /data /backups
USER node
EXPOSE 8080
CMD ["node", "server/index.js"]
