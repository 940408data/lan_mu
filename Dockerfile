# ════════════════════════════════════════════════
# 生产 Dockerfile — nginx 托管预构建的 dist/ 静态产物
# 用法：先本地 npm run build && node tools/gen-index.js，再 docker compose build
# 完整多阶段构建见 Dockerfile.full（含 Playwright 构建层，适用于 CI/CD）
# ════════════════════════════════════════════════
FROM nginx:alpine AS runtime

LABEL org.opencontainers.image.title="lan-mu" \
      org.opencontainers.image.description="兰木 · 书法古籍数字文创"

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY dist/ /usr/share/nginx/html/

USER nginx

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
