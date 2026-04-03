#!/bin/bash
set -e

# ========== AI Tag Gallery 一键部署脚本 ==========

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "╔══════════════════════════════════════╗"
echo "║       AI Tag Gallery 极简 Docker 部署║"
echo "╚══════════════════════════════════════╝"
echo -e "${NC}"

# 检查 Docker
if ! command -v docker &> /dev/null; then
  echo -e "${YELLOW}[INFO] Docker 未安装，正在安装...${NC}"
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo -e "${GREEN}[OK] Docker 安装完成${NC}"
fi

if ! command -v docker compose &> /dev/null; then
  echo -e "${RED}[ERR] docker compose 不可用，请检查 Docker 版本 >= 20.10${NC}"
  exit 1
fi

# 获取项目目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 创建必要目录
mkdir -p data uploads/images uploads/thumbs uploads/tmp public

# ===== 配置 .env =====
if [ ! -f .env ]; then
  echo -e "${YELLOW}[配置] 首次部署，创建 .env 文件${NC}"
  cp .env.example .env

  # 生成随机 SESSION_SECRET
  SECRET=$(openssl rand -base64 32 | tr -d '=/+' | head -c 40)
  sed -i "s|SESSION_SECRET=.*|SESSION_SECRET=${SECRET}|" .env

  echo -e "${GREEN}[OK] .env 已生成，如需配置第三方登录，请自行修改 .env 文件中的 FRONTEND_URL 等信息${NC}"
else
  echo -e "${GREEN}[OK] .env 已存在，跳过配置${NC}"
fi

# ===== 构建并启动 =====

echo -e "${CYAN}[BUILD] 构建 Docker 镜像...${NC}"
docker compose -f docker/docker-compose.yml build

echo -e "${CYAN}[START] 启动服务...${NC}"
docker compose -f docker/docker-compose.yml up -d

# 等待健康检查
echo -e "${YELLOW}[WAIT] 等待服务就绪...${NC}"
for i in $(seq 1 30); do
  if docker compose -f docker/docker-compose.yml exec -T aitag wget -q --spider http://localhost:3000/api/health 2>/dev/null; then
    echo -e "${GREEN}"
    echo "╔══════════════════════════════════════╗"
    echo "║        部署成功！🎉                  ║"
    echo "╠══════════════════════════════════════╣"
    echo "║  访问地址: http://<你的VPS_IP>:9478  ║"
    echo "╚══════════════════════════════════════╝"
    echo -e "${NC}"
    exit 0
  fi
  sleep 2
done

echo -e "${RED}[ERR] 服务启动超时，请检查日志: docker compose -f docker/docker-compose.yml logs${NC}"
exit 1
