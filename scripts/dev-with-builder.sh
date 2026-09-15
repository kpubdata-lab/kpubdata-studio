#!/bin/bash
# KPubData 개발 환경 — Builder(API) + Studio(UI) 동시 기동
#
# 사용법:
#   ./scripts/dev-with-builder.sh          # Builder + Studio (데모 모드)
#   ./scripts/dev-with-builder.sh --real   # Builder + Studio (실 연동)
#
# 전제 조건:
#   - kpubdata-builder가 ../kpubdata-builder에 있어야 함
#   - kpubdata가 ../kpubdata에 있어야 함 (builder 의존)
#   - uv, node/npm이 설치되어 있어야 함

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STUDIO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILDER_DIR="$(cd "$STUDIO_DIR/../kpubdata-builder" && pwd)"

if [ ! -d "$BUILDER_DIR/src/kpubdata_builder" ]; then
  echo "error: kpubdata-builder not found at $BUILDER_DIR"
  echo "  expected: ../kpubdata-builder relative to kpubdata-studio"
  exit 1
fi

MODE="${1:-}"

echo "================================================"
echo " KPubData Dev Environment"
echo "================================================"
echo ""
echo " Builder: $BUILDER_DIR (port 8000)"
echo " Studio:  $STUDIO_DIR (port 5173)"

if [ "$MODE" = "--real" ]; then
  echo " Mode:    REAL (Builder API 실 연동)"
  STUDIO_ENV="VITE_USE_REAL_BUILDER=true VITE_DEV_BYPASS_AUTH=true"
else
  echo " Mode:    DEMO (mock data)"
  STUDIO_ENV=""
fi

echo ""
echo "================================================"
echo ""

# Cleanup on exit
cleanup() {
  echo ""
  echo "Shutting down..."
  kill $BUILDER_PID $STUDIO_PID 2>/dev/null || true
  wait $BUILDER_PID $STUDIO_PID 2>/dev/null || true
  echo "Done."
}
trap cleanup EXIT INT TERM

# Start Builder (background)
echo "[builder] Starting on http://localhost:8000 ..."
cd "$BUILDER_DIR"
KPUBDATA_BUILDER_DEV_MODE=true \
  uv run --extra dev kpubdata-builder serve --host 127.0.0.1 --port 8000 &
BUILDER_PID=$!

# Wait for Builder to be ready
for i in $(seq 1 30); do
  if curl -sf http://localhost:8000/healthz > /dev/null 2>&1; then
    echo "[builder] Ready."
    break
  fi
  sleep 1
done

# Start Studio (foreground)
echo "[studio]  Starting on http://localhost:5173 ..."
cd "$STUDIO_DIR"
if [ -n "$STUDIO_ENV" ]; then
  env $STUDIO_ENV npm run dev
else
  npm run dev
fi
