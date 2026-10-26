# Một image cho cả 3 process (task 6.4): admin (mặc định), search-api, worker — chọn bằng lệnh khởi động:
#   admin      : npm run docker-start          (prisma migrate deploy + react-router-serve, cổng 3000)
#   search-api : npm run start:search-api      (cổng SEARCH_API_PORT, mặc định 8787)
#   worker     : npm run start:worker          (metrics/health trên WORKER_METRICS_PORT, mặc định 9464)
# Bí mật chỉ qua env lúc chạy; không có .env nào trong image (.dockerignore).

FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build && npm run build:services

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl tini
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=build /app/build ./build
# Code nguồn admin cần lúc chạy: react-router-serve chỉ đọc build/; prisma migrate cần prisma/.
USER node
EXPOSE 3000 8787 9464
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "docker-start"]
