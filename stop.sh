#!/usr/bin/env bash
# 停止房型设计平台（关闭占用 8000 端口的 uvicorn 进程）
PORT="${PORT:-8000}"
echo "▶ 正在停止占用端口 $PORT 的服务 ..."
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then kill $PIDS 2>/dev/null && echo "✅ 已停止"; else echo "未找到运行中的服务"; fi
else
  pkill -f "uvicorn backend.app.main:app" && echo "✅ 已停止" || echo "未找到运行中的服务"
fi
