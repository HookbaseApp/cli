#!/bin/bash
# Quick smoke test: run every list command and check for crashes
export HOOKBASE_API_URL=http://127.0.0.1:8787

RED='\033[0;31m'
GREEN='\033[0;32m'
DIM='\033[0;90m'
RESET='\033[0m'

pass=0
fail=0

run() {
  local label="$1"
  shift
  printf "%-45s" "$label"
  output=$("$@" 2>&1)
  rc=$?
  if [ $rc -eq 0 ]; then
    echo -e "${GREEN}OK${RESET} ${DIM}$(echo "$output" | head -1)${RESET}"
    ((pass++))
  else
    echo -e "${RED}FAIL (exit $rc)${RESET}"
    echo "$output" | head -3 | sed 's/^/  /'
    ((fail++))
  fi
}

echo "=== Inbound ==="
run "sources list"            hookbase sources list
run "destinations list"       hookbase destinations list
run "routes list"             hookbase routes list
run "events list"             hookbase events list
run "deliveries list"         hookbase deliveries list

echo ""
echo "=== Outbound ==="
run "outbound applications"   hookbase outbound applications list
run "outbound endpoints"      hookbase outbound endpoints list
run "outbound messages"       hookbase outbound messages list
run "outbound dlq"            hookbase outbound dlq list
run "outbound send (--help)"  hookbase outbound send --help

echo ""
echo "=== Tools ==="
run "cron list"               hookbase cron list
run "cron list --all"         hookbase cron list --all
run "tunnels list"            hookbase tunnels list
run "api-keys list"           hookbase api-keys list

echo ""
echo "=== Other ==="
run "analytics (--help)"      hookbase analytics --help

echo ""
echo "================================"
echo -e "Passed: ${GREEN}${pass}${RESET}  Failed: ${RED}${fail}${RESET}"
