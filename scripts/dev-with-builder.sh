#!/bin/bash
# KPubData 개발 환경 — Builder(API) + Studio(UI) 동시 기동
#
# 사용법:
#   ./scripts/dev-with-builder.sh          # Studio 만 (데모 모드, mock 데이터)
#   ./scripts/dev-with-builder.sh --real   # Builder + Studio (실 연동)
#
# 데모 모드는 Builder 를 띄우지 않는다 — Studio 가 부르지 않는다 (#730).
#
# --real 은 Builder 를 Studio 가 실제로 쓸 수 있게 띄운다 (#730):
#   - KPUBDATA_BUILDER_ALLOWED_ORIGINS: Builder 의 CORS 는 default-deny 이고 Vite 에는
#     proxy 가 없어서 localhost:5173 → :8000 은 교차 오리진이다. 미리 export 한 값이
#     있으면 그것을 쓴다.
#   - --warehouse: 없으면 /warehouse/* 가 404 라 Tables·SQL 화면이 열리지 않는다.
#     KPUBDATA_BUILDER_WAREHOUSE 를 export 했으면 그 경로를 쓴다.
#
# 전제 조건 (--real):
#   - kpubdata-builder가 ../kpubdata-builder에 있어야 함
#   - Builder 의 의존성 설치는 Builder 저장소의 안내를 따른다 (Studio 는 Builder HTTP 만 안다, #511)
#   - uv, node/npm이 설치되어 있어야 함

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STUDIO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MODE="${1:-}"

if [ "$MODE" != "--real" ]; then
  echo "================================================"
  echo " KPubData Dev Environment"
  echo "================================================"
  echo ""
  echo " Studio:  $STUDIO_DIR (port 5173)"
  echo " Mode:    DEMO (mock data, Builder 를 띄우지 않음)"
  echo ""
  echo "================================================"
  echo ""
  cd "$STUDIO_DIR"
  exec npm run dev
fi

BUILDER_DIR="$(cd "$STUDIO_DIR/../kpubdata-builder" 2>/dev/null && pwd || true)"
if [ -z "$BUILDER_DIR" ] || [ ! -d "$BUILDER_DIR/src/kpubdata_builder" ]; then
  echo "error: kpubdata-builder not found at $STUDIO_DIR/../kpubdata-builder"
  echo "  expected: ../kpubdata-builder relative to kpubdata-studio"
  exit 1
fi

# Vite 는 localhost 와 127.0.0.1 어느 쪽으로도 열 수 있고, 브라우저에는 서로 다른 오리진이다.
ALLOWED_ORIGINS="${KPUBDATA_BUILDER_ALLOWED_ORIGINS:-http://localhost:5173,http://127.0.0.1:5173}"
# serve 의 기본 --output-dir 는 Builder 디렉터리의 build/ 다. 카탈로그를 그 안에 둔다.
# 디렉터리가 없으면 serve 가 "unable to open database file" 로 죽으므로 먼저 만든다.
OUTPUT_DIR="$BUILDER_DIR/build"
WAREHOUSE_DIR="${KPUBDATA_BUILDER_WAREHOUSE:-$OUTPUT_DIR/warehouse}"
mkdir -p "$OUTPUT_DIR"

echo "================================================"
echo " KPubData Dev Environment"
echo "================================================"
echo ""
echo " Builder: $BUILDER_DIR (port 8000)"
echo " Studio:  $STUDIO_DIR (port 5173)"
echo " Mode:    REAL (Builder API 실 연동)"
echo " CORS:    $ALLOWED_ORIGINS"
echo " Tables:  $WAREHOUSE_DIR"
echo ""
echo "================================================"
echo ""

BUILDER_PID=""
STUDIO_PID=""

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
KPUBDATA_BUILDER_ALLOWED_ORIGINS="$ALLOWED_ORIGINS" \
  uv run --extra dev kpubdata-builder serve --host 127.0.0.1 --port 8000 \
    --output-dir "$OUTPUT_DIR" --warehouse "$WAREHOUSE_DIR" &
BUILDER_PID=$!

# Wait for Builder to be ready
READY=""
for i in $(seq 1 30); do
  if curl -sf http://localhost:8000/healthz > /dev/null 2>&1; then
    echo "[builder] Ready."
    READY=1
    break
  fi
  sleep 1
done
if [ -z "$READY" ]; then
  echo "error: Builder did not answer http://localhost:8000/healthz within 30 seconds"
  exit 1
fi

# Start Studio (foreground)
echo "[studio]  Starting on http://localhost:5173 ..."
cd "$STUDIO_DIR"
env VITE_USE_REAL_BUILDER=true VITE_DEV_BYPASS_AUTH=true npm run dev
