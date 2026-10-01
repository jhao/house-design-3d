#!/usr/bin/env bash
# 一键启动：初始化(若需要) + 启动前后端同体服务
# 访问地址： http://localhost:8000
set -e
cd "$(dirname "$0")"

# 若尚未初始化则先初始化
if [ ! -d ".venv" ]; then
  ./init.sh
fi

# shellcheck disable=SC1091
source .venv/bin/activate
export PYTHONPATH="$(pwd)"
export DISPLAY_RATIO="${DISPLAY_RATIO:-200}"

echo ""
echo "  🏠 房型设计平台启动中 ..."
echo "  ▶ 打开浏览器访问： http://localhost:8000"
echo "  ▶ 关闭服务：Ctrl+C  （或运行 ./stop.sh）"
echo ""
exec uvicorn backend.app.main:app --host "${HOST:-0.0.0.0}" --port "${PORT:-8000}"
