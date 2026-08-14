#!/usr/bin/env bash
# 兰木部署回退脚本
#
# 用法：
#   ./tools/rollback.sh snapshot            部署前快照：保留当前 lan-mu:latest 为 lan-mu:prev
#   ./tools/rollback.sh prev                秒级单步回退到 lan-mu:prev（仅镜像，dist 不变）
#   ./tools/rollback.sh tag <git-tag>       完整回退：git checkout <tag> → 重建 dist → docker build → up
#   ./tools/rollback.sh                     显示帮助
#
# 关键陷阱：镜像不含重媒体（jpg/png/pdf 走 /media volume）。
#   'prev' 仅回退镜像内 HTML/CSS/字体；跨版本回退务必用 'tag' 同步重建 dist，
#   否则旧镜像 HTML 引用新 dist 图可能 404。详见 docs/部署回退与镜像策略.md

set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "✗ 不在 git 仓库内" >&2; exit 1; }

usage() {
  cat <<'EOF'
兰木部署回退

  ./tools/rollback.sh snapshot            部署前保留当前镜像为 lan-mu:prev
  ./tools/rollback.sh prev               秒级回退到 lan-mu:prev（仅镜像，dist 不变）
  ./tools/rollback.sh tag <git-tag>      完整回退：checkout tag → gen-index → docker build → up

注意：镜像不含重媒体（走 /media volume）。跨版本回退用 'tag' 同步重建 dist。
      详见 docs/部署回退与镜像策略.md
EOF
}

wait_healthy() {
  for i in $(seq 1 15); do
    if curl -sf http://127.0.0.1:8080/healthz >/dev/null 2>&1; then
      echo "✓ healthz 就绪（${i}s）"
      return 0
    fi
    sleep 1
  done
  echo "⚠ healthz 15s 内未就绪，查 docker logs lan-mu" >&2
  return 1
}

case "${1:-}" in
  snapshot)
    docker tag lan-mu:latest lan-mu:prev
    echo "✓ 已保留 lan-mu:latest → lan-mu:prev（单步回退备用）"
    ;;
  prev)
    if ! docker image inspect lan-mu:prev >/dev/null 2>&1; then
      echo "✗ 无 lan-mu:prev。部署前先执行 ./tools/rollback.sh snapshot" >&2
      exit 1
    fi
    echo "→ 回退镜像到 lan-mu:prev（dist 不变，仅适用同版本镜像构建问题回退）"
    docker tag lan-mu:prev lan-mu:latest
    docker compose up -d
    wait_healthy || true
    ;;
  tag)
    TAG="${2:-}"
    if [ -z "$TAG" ]; then
      echo "✗ 用法: ./tools/rollback.sh tag <git-tag>" >&2
      exit 1
    fi
    if ! git rev-parse --verify "refs/tags/$TAG" >/dev/null 2>&1; then
      echo "✗ tag $TAG 不存在" >&2
      exit 1
    fi
    ORIG=$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse HEAD)
    echo "→ checkout $TAG（来自 $ORIG）"
    git checkout --quiet "$TAG"
    echo "→ 重建 dist 站点页（works 改动时改用 npm run build 全量）"
    node tools/gen-index.js
    echo "→ docker build + up"
    docker compose build
    docker compose up -d
    wait_healthy || true
    echo "→ 切回 $ORIG"
    git checkout --quiet "$ORIG"
    echo "✓ 完整回退完成（基于 $TAG）"
    ;;
  ""|-h|--help)
    usage
    ;;
  *)
    echo "✗ 未知命令: $1" >&2
    usage
    exit 1
    ;;
esac
