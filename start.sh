#!/usr/bin/env bash
# 赛博坦9号星城 · 一键启动脚本
# 作用：自检 Node → 装后端依赖 → 后台起后端(ws:9527) → 起前端静态服务(http:9528)
#       → 自动打开浏览器 → 按 Ctrl+C 一并清理两个进程。
#       （端口 9527/9528 特意与其它项目如 1-kickbadguy 的 8080/5173 错开，避免冲突）
# 评委/评委 agent 只需在 2-cybertron/ 目录执行：  bash start.sh
# 可选环境变量：
#   CYBERTRON_WEB_PORT   前端端口（默认 9528）
#   PORT                 后端端口（默认 9527，与前端默认连接地址一致，一般不改）
#   CYBERTRON_LLM_API_KEY 设了则 agent 言行由真实模型生成，不设走剧本轨（默认，离线稳定）
#   NO_OPEN=1            不自动打开浏览器（无头/CI 环境用）

set -euo pipefail

# 切到脚本所在目录（即 2-cybertron/），保证相对路径稳定
cd "$(dirname "$0")"

WEB_PORT="${CYBERTRON_WEB_PORT:-9528}"
WEB_URL="http://localhost:${WEB_PORT}/index.html"

echo "=============================================="
echo "  赛博坦 · Cybertron 9 号星城 — 一键启动"
echo "=============================================="

# 1) 自检 Node >= 18
if ! command -v node >/dev/null 2>&1; then
  echo "✗ 未找到 node。请先安装 Node.js ≥ 18（https://nodejs.org）后重试。"
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "✗ Node 版本过低（当前 $(node -v)），需要 ≥ 18。"
  exit 1
fi
echo "✓ Node $(node -v)"

# 2) 安装后端依赖（仅首次需要；已装则跳过）
if [ ! -d server/node_modules ]; then
  echo "• 安装后端依赖（ws）……"
  (cd server && npm install --silent)
else
  echo "✓ 后端依赖已就绪"
fi

# 轨道提示
if [ -n "${CYBERTRON_LLM_API_KEY:-}" ]; then
  echo "✓ 检测到 CYBERTRON_LLM_API_KEY → agent 言行将由真实模型生成（失败自动回退剧本）"
else
  echo "✓ 未设 API key → 走剧本轨（离线稳定、开箱即玩）"
fi

# 3) 端口占用预检：被占则明确报错退出，避免被其它项目的残留服务静默顶替
#    （否则 5173/8080 若被别的项目占着，浏览器会打开那个项目的页面，看起来像启动错了程序）
BACKEND_PORT="${PORT:-9527}"
check_port() {
  port="$1"
  label="$2"
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    who="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1, "PID", $2}')"
    echo "✗ 端口 ${port}（${label}）已被占用：$who"
    echo "  这多半是其它项目（如 1-kickbadguy）的残留服务。请先关掉它，或换端口："
    if [ "$port" = "$BACKEND_PORT" ]; then
      echo "    PORT=9529 bash start.sh    # 换后端端口（注意前端默认连 9527，换后需在浏览器控制台 localStorage.setItem('WS_URL','ws://localhost:9529') 后刷新）"
    else
      echo "    CYBERTRON_WEB_PORT=9530 bash start.sh    # 换前端端口"
    fi
    exit 1
  fi
}
check_port "$BACKEND_PORT" "后端 WebSocket"
check_port "$WEB_PORT" "前端静态服务"

# 4) 后台启动后端与前端，退出时统一清理
PIDS=()
cleanup() {
  echo ""
  echo "• 正在关闭星城……"
  for pid in "${PIDS[@]:-}"; do
    if [ -n "${pid:-}" ] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
  echo "✓ 已停止。再见~"
}
trap cleanup EXIT INT TERM

echo "• 启动后端（ws://0.0.0.0:${PORT:-9527}）……"
(cd server && npm start) &
PIDS+=("$!")

echo "• 启动前端静态服务（${WEB_URL}）……"
(cd server && node static-server.js "$WEB_PORT") &
PIDS+=("$!")

# 5) 等前端端口就绪后自动打开浏览器
sleep 1
if [ "${NO_OPEN:-0}" != "1" ]; then
  if command -v open >/dev/null 2>&1; then
    open "$WEB_URL" >/dev/null 2>&1 || true        # macOS
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$WEB_URL" >/dev/null 2>&1 || true     # Linux
  fi
fi

echo ""
echo "=============================================="
echo "  赛博坦9号星城已启动 🚀"
echo "  浏览器打开： ${WEB_URL}"
echo "  （若没自动弹出，手动复制上面地址到浏览器）"
echo "  按 Ctrl+C 停止并清理所有进程"
echo "=============================================="

# 阻塞等待：任一后台进程退出即收尾
wait
