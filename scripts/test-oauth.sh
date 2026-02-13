#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# test-oauth.sh -- Manual OAuth verification for Barazo API (M3 Checkpoint)
#
# This script starts the API (with dependencies) and walks you through
# testing the full AT Protocol OAuth flow against bsky.social.
#
# Prerequisites:
#   - Docker (for PostgreSQL + Valkey)
#   - Node.js 24+, pnpm
#   - A Bluesky account (handle + app password or browser login)
#
# Usage:
#   chmod +x scripts/test-oauth.sh
#   ./scripts/test-oauth.sh [handle]
#
#   handle: Your Bluesky handle (e.g. alice.bsky.social). If omitted,
#           the script will prompt for it.
# ---------------------------------------------------------------------------
set -euo pipefail

API_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_PORT="${PORT:-3000}"
API_BASE="http://localhost:${API_PORT}"
PG_CONTAINER="barazo-test-pg"
VK_CONTAINER="barazo-test-valkey"

# Colors (if terminal supports them)
if [ -t 1 ]; then
  BOLD="\033[1m"
  GREEN="\033[0;32m"
  YELLOW="\033[0;33m"
  RED="\033[0;31m"
  CYAN="\033[0;36m"
  RESET="\033[0m"
else
  BOLD="" GREEN="" YELLOW="" RED="" CYAN="" RESET=""
fi

info()  { echo -e "${GREEN}[INFO]${RESET}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error() { echo -e "${RED}[ERROR]${RESET} $*"; }
step()  { echo -e "\n${BOLD}${CYAN}>> $*${RESET}"; }

cleanup() {
  step "Cleaning up"
  if [ -n "${API_PID:-}" ] && kill -0 "$API_PID" 2>/dev/null; then
    info "Stopping API (PID $API_PID)"
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  # Leave Docker containers running so you can re-run quickly.
  # To stop them: docker stop barazo-test-pg barazo-test-valkey
  info "Docker containers left running for quick re-runs."
  info "To stop: docker stop $PG_CONTAINER $VK_CONTAINER"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 1. Check prerequisites
# ---------------------------------------------------------------------------
step "Checking prerequisites"

command -v docker >/dev/null 2>&1 || { error "Docker not found. Install Docker first."; exit 1; }
command -v node >/dev/null 2>&1   || { error "Node.js not found. Install Node.js 24+."; exit 1; }
command -v pnpm >/dev/null 2>&1   || { error "pnpm not found. Install: npm i -g pnpm"; exit 1; }

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 24 ]; then
  warn "Node.js $NODE_MAJOR detected; Node.js 24+ recommended."
fi

info "All prerequisites met."

# ---------------------------------------------------------------------------
# 2. Start PostgreSQL + Valkey via Docker (if not already running)
# ---------------------------------------------------------------------------
step "Starting Docker dependencies"

if docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$"; then
  info "PostgreSQL container already running."
else
  info "Starting PostgreSQL 16 + pgvector..."
  docker run -d --name "$PG_CONTAINER" \
    -e POSTGRES_USER=barazo \
    -e POSTGRES_PASSWORD=barazo_dev \
    -e POSTGRES_DB=barazo \
    -p 5432:5432 \
    pgvector/pgvector:pg16 >/dev/null 2>&1 || {
      # Container might exist but be stopped
      docker start "$PG_CONTAINER" >/dev/null 2>&1
    }
fi

if docker ps --format '{{.Names}}' | grep -q "^${VK_CONTAINER}$"; then
  info "Valkey container already running."
else
  info "Starting Valkey..."
  docker run -d --name "$VK_CONTAINER" \
    -p 6379:6379 \
    valkey/valkey:8 >/dev/null 2>&1 || {
      docker start "$VK_CONTAINER" >/dev/null 2>&1
    }
fi

# Wait for PostgreSQL to accept connections
info "Waiting for PostgreSQL to be ready..."
for i in $(seq 1 30); do
  if docker exec "$PG_CONTAINER" pg_isready -U barazo >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    error "PostgreSQL did not become ready in time."
    exit 1
  fi
  sleep 1
done
info "PostgreSQL ready."

# ---------------------------------------------------------------------------
# 3. Install dependencies + run migrations
# ---------------------------------------------------------------------------
step "Installing dependencies and running migrations"

cd "$API_DIR"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Create .env if missing
if [ ! -f .env ]; then
  info "Creating .env from .env.example..."
  cp .env.example .env
  # Set a real session secret for testing
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' 's/your-session-secret-minimum-32-characters-long/barazo-dev-session-secret-for-local-testing-only/' .env
  else
    sed -i 's/your-session-secret-minimum-32-characters-long/barazo-dev-session-secret-for-local-testing-only/' .env
  fi
fi

info "Running database migrations..."
pnpm db:migrate 2>&1 || {
  warn "Migration command failed. This may be expected if tables already exist."
}

# ---------------------------------------------------------------------------
# 4. Start the API
# ---------------------------------------------------------------------------
step "Starting Barazo API on port ${API_PORT}"

# Source .env for the API process
set -a
# shellcheck disable=SC1091
source .env
set +a

pnpm dev &
API_PID=$!

# Wait for API to be healthy
info "Waiting for API to respond..."
for i in $(seq 1 30); do
  if curl -sf "${API_BASE}/api/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    error "API process exited unexpectedly. Check logs above."
    exit 1
  fi
  if [ "$i" -eq 30 ]; then
    error "API did not respond within 30 seconds."
    exit 1
  fi
  sleep 1
done
info "API is running at ${API_BASE}"

# ---------------------------------------------------------------------------
# 5. Check setup status
# ---------------------------------------------------------------------------
step "Checking community setup status"

SETUP_STATUS=$(curl -sf "${API_BASE}/api/setup/status")
echo "  Response: ${SETUP_STATUS}"

# ---------------------------------------------------------------------------
# 6. Initiate OAuth login
# ---------------------------------------------------------------------------
step "OAuth Login Flow"

HANDLE="${1:-}"
if [ -z "$HANDLE" ]; then
  echo -en "\n  ${BOLD}Enter your Bluesky handle${RESET} (e.g. alice.bsky.social): "
  read -r HANDLE
fi

if [ -z "$HANDLE" ]; then
  error "No handle provided. Exiting."
  exit 1
fi

info "Initiating OAuth login for: ${HANDLE}"
LOGIN_RESPONSE=$(curl -sf "${API_BASE}/api/auth/login?handle=${HANDLE}" 2>&1) || {
  error "Login request failed. Response: ${LOGIN_RESPONSE:-empty}"
  error "Make sure your handle is correct and the API can reach bsky.social."
  exit 1
}

AUTH_URL=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['url'])" 2>/dev/null || true)

if [ -z "$AUTH_URL" ]; then
  error "Could not extract authorization URL from response: ${LOGIN_RESPONSE}"
  exit 1
fi

info "Authorization URL obtained."

# Open in browser
echo ""
echo -e "  ${BOLD}Opening your browser to authorize with Bluesky...${RESET}"
echo ""
echo "  If the browser doesn't open, copy this URL manually:"
echo -e "  ${CYAN}${AUTH_URL}${RESET}"
echo ""

if [[ "$OSTYPE" == "darwin"* ]]; then
  open "$AUTH_URL" 2>/dev/null || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$AUTH_URL" 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# 7. Print verification checklist
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}==========================================================================${RESET}"
echo -e "${BOLD}  M3 Authentication -- Manual Verification Checklist${RESET}"
echo -e "${BOLD}==========================================================================${RESET}"
echo ""
echo -e "  ${BOLD}Step 1: Authorize in browser${RESET}"
echo "    - Your browser should show the Bluesky authorization page."
echo "    - Log in / authorize the Barazo application."
echo "    - After authorizing, you'll be redirected to the callback URL."
echo ""
echo -e "  ${BOLD}Step 2: Check the callback response${RESET}"
echo "    - The callback returns JSON with:"
echo "      { accessToken, expiresAt, did, handle }"
echo "    - Copy the accessToken value for the next steps."
echo ""
echo -e "    If the callback shows a connection error (the frontend isn't running),"
echo -e "    copy the full callback URL from the browser address bar and run:"
echo ""
echo -e "    ${CYAN}curl -v '\${CALLBACK_URL}'${RESET}"
echo ""
echo -e "  ${BOLD}Step 3: Verify GET /api/auth/me${RESET}"
echo "    - Replace ACCESS_TOKEN with the token from step 2:"
echo ""
echo -e "    ${CYAN}curl -s ${API_BASE}/api/auth/me \\\\${RESET}"
echo -e "    ${CYAN}  -H 'Authorization: Bearer ACCESS_TOKEN' | python3 -m json.tool${RESET}"
echo ""
echo "    - Expected: { \"did\": \"did:plc:...\", \"handle\": \"did:plc:...\" }"
echo "      (Handle currently shows DID -- this is a known TODO for M3.)"
echo ""
echo -e "  ${BOLD}Step 4: Verify POST /api/auth/refresh${RESET}"
echo "    - The callback set an HTTP-only cookie. Use the cookie jar:"
echo ""
echo -e "    ${CYAN}curl -s -X POST ${API_BASE}/api/auth/refresh \\\\${RESET}"
echo -e "    ${CYAN}  -b 'barazo_refresh=SESSION_ID' | python3 -m json.tool${RESET}"
echo ""
echo "    - Expected: { \"accessToken\": \"...\", \"expiresAt\": ... }"
echo "    - (You'll need to capture the cookie from the callback response"
echo "       headers to test this. Use curl -v on the callback to see it.)"
echo ""
echo -e "  ${BOLD}Step 5: Verify setup wizard${RESET}"
echo "    - Check status (should be uninitialized):"
echo ""
echo -e "    ${CYAN}curl -s ${API_BASE}/api/setup/status | python3 -m json.tool${RESET}"
echo ""
echo "    - Initialize as first admin (requires access token from step 2):"
echo ""
echo -e "    ${CYAN}curl -s -X POST ${API_BASE}/api/setup/initialize \\\\${RESET}"
echo -e "    ${CYAN}  -H 'Authorization: Bearer ACCESS_TOKEN' \\\\${RESET}"
echo -e "    ${CYAN}  -H 'Content-Type: application/json' \\\\${RESET}"
echo -e "    ${CYAN}  -d '{\"communityName\": \"My Test Forum\"}' | python3 -m json.tool${RESET}"
echo ""
echo "    - Expected: { \"initialized\": true, \"adminDid\": \"did:plc:...\","
echo "                  \"communityName\": \"My Test Forum\" }"
echo ""
echo "    - Verify status is now initialized:"
echo ""
echo -e "    ${CYAN}curl -s ${API_BASE}/api/setup/status | python3 -m json.tool${RESET}"
echo ""
echo "    - Second initialize attempt should return 409:"
echo ""
echo -e "    ${CYAN}curl -s -X POST ${API_BASE}/api/setup/initialize \\\\${RESET}"
echo -e "    ${CYAN}  -H 'Authorization: Bearer ACCESS_TOKEN' \\\\${RESET}"
echo -e "    ${CYAN}  -H 'Content-Type: application/json' \\\\${RESET}"
echo -e "    ${CYAN}  -d '{}' | python3 -m json.tool${RESET}"
echo ""
echo "    - Expected: { \"error\": \"Community already initialized\" }"
echo ""
echo -e "  ${BOLD}Step 6: Verify logout${RESET}"
echo ""
echo -e "    ${CYAN}curl -s -X DELETE ${API_BASE}/api/auth/session \\\\${RESET}"
echo -e "    ${CYAN}  -b 'barazo_refresh=SESSION_ID' -w '\\nHTTP %{http_code}\\n'${RESET}"
echo ""
echo "    - Expected: HTTP 204 (no content)"
echo ""
echo -e "  ${BOLD}Step 7: Verify token is invalidated after logout${RESET}"
echo ""
echo -e "    ${CYAN}curl -s ${API_BASE}/api/auth/me \\\\${RESET}"
echo -e "    ${CYAN}  -H 'Authorization: Bearer ACCESS_TOKEN' | python3 -m json.tool${RESET}"
echo ""
echo "    - Expected: { \"error\": \"Invalid or expired token\" }"
echo ""
echo -e "${BOLD}==========================================================================${RESET}"
echo -e "  ${GREEN}Pass criteria:${RESET} Steps 1-7 all return expected responses."
echo -e "  ${YELLOW}Known limitations:${RESET}"
echo -e "    - Handle shows DID (not resolved yet -- TODO for identity layer)"
echo -e "    - No Tap service required for auth testing (firehose is separate)"
echo -e "${BOLD}==========================================================================${RESET}"
echo ""
echo "  The API is still running. Press Ctrl+C when done testing."
echo ""

# Keep script alive until user terminates
wait "$API_PID" 2>/dev/null || true
