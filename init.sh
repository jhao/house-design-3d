#!/usr/bin/env bash
# 初始化：创建虚拟环境并安装后端依赖（仅占位，不写入任何密钥）
set -e
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  echo "▶ 创建 Python 虚拟环境 .venv ..."
  python3 -m venv .venv
fi

echo "▶ 安装依赖（fastapi / uvicorn / httpx）..."
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -r backend/requirements.txt

echo "✅ 初始化完成。下一步运行 ./start.sh 启动平台。"
