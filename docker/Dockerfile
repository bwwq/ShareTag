# --------- Stage 1: Build Frontend ---------
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY client/package*.json ./client/

# 安装依赖
RUN npm install
RUN cd client && npm install

# 复制整库源码并编译前端
COPY . .
RUN cd client && npm run build

# --------- Stage 2: Production Server ---------
FROM node:20-alpine AS base
WORKDIR /app

# 安装 sharp 需要的依赖
RUN apk add --no-cache vips-dev

COPY package*.json ./
RUN npm ci --omit=dev

COPY server/ ./server/

# 从 builder 复制编译好的前端到 public
COPY --from=builder /app/public ./public/

# 创建必要的数据和应用目录
RUN mkdir -p data uploads/images uploads/thumbs uploads/tmp

EXPOSE 3000
ENV NODE_ENV=production

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server/index.js"]

