#!/usr/bin/env bash
# Corbel V0.1 — API Test Script
# Usage: ./scripts/test-api.sh [host:port]

set -euo pipefail

BASE="${1:-http://localhost:3000}"
API="${BASE}/api/v1"

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo -e "${CYAN}  Corbel V0.1 — API Test${NC}"
echo -e "${CYAN}  Target: ${BASE}${NC}"
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo ""

# Health check
echo -e "${YELLOW}▸ GET /api/v1/health${NC}"
HEALTH=$(curl -s "${API}/health")
echo "$HEALTH" | python3 -m json.tool 2>/dev/null || echo "$HEALTH"
echo ""

# List devices
echo -e "${YELLOW}▸ GET /api/v1/devices${NC}"
DEVICES=$(curl -s "${API}/devices")
DEVICE_COUNT=$(echo "$DEVICES" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
echo -e "${GREEN}  Found ${DEVICE_COUNT} devices${NC}"

# Show first 5 devices
echo "$DEVICES" | python3 -c "
import sys, json
devices = json.load(sys.stdin)
for d in devices[:5]:
    data_count = len(d.get('data', []))
    order_count = len(d.get('orders', []))
    status_icon = '🟢' if d['status'] == 'online' else ('🔴' if d['status'] == 'offline' else '⚪')
    print(f\"  {status_icon} {d['name']:<30} {d.get('manufacturer','?'):<15} {d.get('model','?'):<20} Data:{data_count} Orders:{order_count}\")
if len(devices) > 5:
    print(f'  ... and {len(devices) - 5} more')
" 2>/dev/null || echo "$DEVICES" | head -20
echo ""

# Get first device details
FIRST_ID=$(echo "$DEVICES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')" 2>/dev/null || echo "")

if [ -n "$FIRST_ID" ]; then
  echo -e "${YELLOW}▸ GET /api/v1/devices/${FIRST_ID}${NC}"
  DEVICE=$(curl -s "${API}/devices/${FIRST_ID}")
  echo "$DEVICE" | python3 -m json.tool 2>/dev/null || echo "$DEVICE"
  echo ""

  echo -e "${YELLOW}▸ GET /api/v1/devices/${FIRST_ID}/raw${NC}"
  RAW=$(curl -s "${API}/devices/${FIRST_ID}/raw")
  echo "$RAW" | python3 -c "
import sys, json
data = json.load(sys.stdin)
expose = data.get('expose', [])
print(f\"  Raw expose for: {data.get('name', '?')}\")
print(f\"  Expose entries: {len(expose) if isinstance(expose, list) else 'N/A'}\")
" 2>/dev/null || echo "$RAW" | head -10
  echo ""
fi

echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}  Test complete!${NC}"
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
