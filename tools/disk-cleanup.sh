#!/usr/bin/env bash
# 兰木 · CVM 磁盘清理脚本
#
# 清理项（均只动缓存与禁用旧版，不删业务数据、不动 swap、不动 openclaw 依赖）：
#   1) npm 缓存                — npm cache clean --force
#   2) Docker 构建缓存 + 悬空镜像 — docker builder prune -af / image prune -f
#   3) journal 日志真空至 200M   — journalctl --vacuum-size=200M
#   4) snap 禁用旧版            — snap remove --revision=<旧版>
#
# 用法：sudo bash tools/disk-cleanup.sh
# 可重复运行：无缓存可清时各步自动跳过。
set -uo pipefail

[ "$(id -u)" -eq 0 ] || { echo "✗ 需 root（journal 真空、snap 移除需特权）。用法：sudo bash $0" >&2; exit 1; }

# sudo 下 nvm 管理的 npm 不在 PATH，主动定位（$HOME 优先，回退 /root，再回退系统路径）
NPM_BIN="$(command -v npm || true)"
if [ -z "$NPM_BIN" ]; then
  for p in "$HOME"/.nvm/versions/node/*/bin/npm /root/.nvm/versions/node/*/bin/npm /usr/bin/npm /usr/local/bin/npm; do
    [ -x "$p" ] && { NPM_BIN="$p"; break; }
  done
fi

# 根分区「已用」字节数
used() { df -B1 / | awk 'NR==2{print $3}'; }
# 字节 → 人类可读
human() {
  awk -v b="$1" 'BEGIN{
    if (b>=1099511627776) printf "%.1fT", b/1099511627776
    else if (b>=1073741824) printf "%.1fG", b/1073741824
    else if (b>=1048576)   printf "%.1fM", b/1048576
    else                    printf "%.0fK", b/1024
  }'
}

TOTAL_BEFORE=$(used)
echo "══ 兰木 CVM 磁盘清理 ══"
echo "清理前：$(df -h / | awk 'NR==2{print $3" used / "$2" total / "$4" avail ("$5")"}')"
echo

# 跑一步并报告该步释放量；命令输出原样透传（仅滤掉 libonion.so 预载噪声）
run_step() {
  local label="$1"; shift
  local before; before=$(used)
  echo "▶ $label"
  "$@" 2>&1 | grep -v 'libonion' || true
  local after; after=$(used)
  local freed=$(( before - after ))
  if [ "$freed" -gt 0 ]; then echo "  → 释放 $(human "$freed")"; else echo "  → 无释放"; fi
  echo
}

cmd_npm() {
  if [ -z "${NPM_BIN:-}" ]; then echo "  无 npm，跳过"; return; fi
  "$NPM_BIN" cache clean --force >/dev/null 2>&1
  echo "  npm 缓存已清（$NPM_BIN）"
}

cmd_docker() {
  if ! command -v docker >/dev/null || ! docker info >/dev/null 2>&1; then
    echo "  docker 未运行或不可用，跳过"; return
  fi
  docker builder prune -af 2>/dev/null | tail -1
  docker image prune -f   2>/dev/null | tail -1
}

cmd_journal() {
  command -v journalctl >/dev/null || { echo "  无 journalctl，跳过"; return; }
  journalctl --vacuum-size=200M 2>/dev/null | tail -1
}

cmd_snap() {
  if ! command -v snap >/dev/null; then echo "  无 snap，跳过"; return; fi
  local removed=0
  while read -r name rev; do
    [ -n "$name" ] || continue
    if snap remove "$name" --revision="$rev" >/dev/null 2>&1; then
      echo "  移除 $name r$rev"; removed=$(( removed + 1 ))
    else
      echo "  跳过 $name r$rev（移除失败，可能正被使用）"
    fi
  done < <(snap list --all 2>/dev/null | awk '/disabled/{print $1, $3}')
  [ "$removed" -eq 0 ] && echo "  无禁用旧版可移除"
}

run_step "npm 缓存"                cmd_npm
run_step "Docker 构建缓存 + 悬空镜像" cmd_docker
run_step "journal 日志（真空至 200M）" cmd_journal
run_step "snap 禁用旧版"            cmd_snap

TOTAL_AFTER=$(used)
FREED=$(( TOTAL_BEFORE - TOTAL_AFTER ))
echo "══ 完成 ══"
echo "清理后：$(df -h / | awk 'NR==2{print $3" used / "$2" total / "$4" avail ("$5")"}')"
if [ "$FREED" -gt 0 ]; then echo "本次共释放 $(human "$FREED")"; else echo "本次无可释放空间（缓存已干净）"; fi
