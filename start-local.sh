#!/usr/bin/env bash
#
# Start CodeWizard DevOps Agents in LOCAL MODE (no Supabase credentials needed)
#
# This script runs everything against local JSON files in ./data/
# Perfect for development, demos, and testing without cloud dependencies.
#
# Usage:
#   ./start-local.sh              # Start webapp only (port 3001)
#   ./start-local.sh --with-agents # Also run the Python agents pipeline
#   ./start-local.sh --scan        # Run a one-time scan with agents
#   ./start-local.sh --port 4000   # Custom port
#   ./start-local.sh --install     # Force npm install
#
# Environment:
#   PORT=3001           Webapp port (default 3001)
#   AGENTS_PORT=8001    Agents API port (default 8001)

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WEBAPP_DIR="$ROOT_DIR/webapp"
AGENTS_DIR="$ROOT_DIR/agents"
DATA_DIR="$ROOT_DIR/data"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${BLUE}==>${NC} $*"; }
success() { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }
error() { echo -e "${RED}✗${NC} $*" >&2; }

PORT="${PORT:-3001}"
AGENTS_PORT="${AGENTS_PORT:-8001}"
MODE="webapp-only"
FORCE_INSTALL=0
EXTRA_ARGS=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --with-agents) MODE="with-agents"; shift ;;
    --scan) MODE="scan-only"; shift ;;
    --port)
      [ "$#" -ge 2 ] || { error "--port needs a value"; exit 1; }
      PORT="$2"; shift 2 ;;
    --port=*) PORT="${1#*=}"; shift ;;
    --install) FORCE_INSTALL=1; shift ;;
    -h|--help)
      awk 'NR == 1 { next } /^#/ { sub(/^#[[:space:]]?/, ""); print; next } { exit }' "${BASH_SOURCE[0]}" | sed '/./,$!d'
      exit 0 ;;
    *) EXTRA_ARGS+=("$1"); shift ;;
  esac
done

# --------------------------------------------------------------------------
# Preflight checks
# --------------------------------------------------------------------------
command -v node >/dev/null 2>&1 || { error "node not found - install Node.js 20+"; exit 1; }
command -v npm >/dev/null 2>&1 || { error "npm not found"; exit 1; }
command -v python3 >/dev/null 2>&1 || { error "python3 not found - install Python 3.11+"; exit 1; }

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  error "Node $(node -v) too old - need Node 20.9+"
  exit 1
fi

# --------------------------------------------------------------------------
# Ensure data directory exists with sample files
# --------------------------------------------------------------------------
log "Checking local data directory: $DATA_DIR"
mkdir -p "$DATA_DIR"

# Create empty JSON files if they don't exist (so the app doesn't crash)
for file in opportunities signals companies people scans devops_jobs; do
  if [ ! -f "$DATA_DIR/$file.json" ]; then
    warn "Creating empty $file.json"
    echo "[]" > "$DATA_DIR/$file.json"
  fi
done

success "Data directory ready with $(ls -1 "$DATA_DIR"/*.json | wc -l) JSON files"

# --------------------------------------------------------------------------
# Setup webapp .env.local for local mode
# --------------------------------------------------------------------------
log "Setting up webapp/.env.local for LOCAL mode (no Supabase)"
cat > "$WEBAPP_DIR/.env.local" <<EOF
# LOCAL MODE - No Supabase credentials needed
# The app will read/write JSON files in $DATA_DIR

# Leave these empty to force local mode
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=

# Optional: override data directory (default: repo-root/data)
# DATA_DIR=$DATA_DIR
EOF
success "Created webapp/.env.local (local mode)"

# --------------------------------------------------------------------------
# Setup agents .env for local mode
# --------------------------------------------------------------------------
log "Setting up agents/.env for LOCAL mode"
cat > "$AGENTS_DIR/.env" <<EOF
# LOCAL MODE - No Supabase credentials needed
# Agents will read/write JSON files in $DATA_DIR

# Force local-only mode (skip Supabase entirely)
JOBS_LOCAL_ONLY=1

# LLM (optional - only needed for AI features)
# OPENAI_API_KEY=
# ANTHROPIC_API_KEY=
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
LLM_TEMPERATURE=0.1

# Data directory for local JSON files
# DATA_DIR=$DATA_DIR

# External APIs (optional - for signals enrichment)
# NEWSAPI_KEY=
# GNEWS_API_KEY=

# Discord (optional)
# DISCORD_WEBHOOK_URL=
DISCORD_NOTIFY=false

# API
PORT=$AGENTS_PORT
API_KEY=local-dev-key-change-me
EOF
success "Created agents/.env (local mode)"

# --------------------------------------------------------------------------
# Install webapp dependencies
# --------------------------------------------------------------------------
STAMP="$WEBAPP_DIR/node_modules/.cw-install-stamp"

next_entry() {
  if [ -f "$WEBAPP_DIR/node_modules/next/dist/bin/next" ]; then
    printf '%s' "$WEBAPP_DIR/node_modules/next/dist/bin/next"
  else
    printf '%s' "$WEBAPP_DIR/node_modules/.bin/next"
  fi
}

next_works() {
  local bin="$1"
  [ -f "$bin" ] || return 1
  node "$bin" --version >/dev/null 2>&1
}

needs_install() {
  [ "$FORCE_INSTALL" -eq 1 ] && return 0
  [ -d "$WEBAPP_DIR/node_modules" ] || return 0
  next_works "$(next_entry)" || return 0
  [ -f "$STAMP" ] || return 0
  [ "$WEBAPP_DIR/package.json" -nt "$STAMP" ] && return 0
  [ -f "$WEBAPP_DIR/package-lock.json" ] && [ "$WEBAPP_DIR/package-lock.json" -nt "$STAMP" ] && return 0
  return 1
}

if needs_install; then
  log "Installing webapp dependencies..."
  (cd "$WEBAPP_DIR" && npm install --no-audit --no-fund)
fi

NEXT_BIN="$(next_entry)"
next_works "$NEXT_BIN" || {
  log "Repairing next binary links..."
  (cd "$WEBAPP_DIR" && npm rebuild >/dev/null 2>&1) || true
  NEXT_BIN="$(next_entry)"
  next_works "$NEXT_BIN" || { error "Cannot run next - delete webapp/node_modules and re-run"; exit 1; }
}
: > "$STAMP" 2>/dev/null || true

# --------------------------------------------------------------------------
# Install agents dependencies
# --------------------------------------------------------------------------
if [ "$MODE" != "webapp-only" ]; then
  log "Checking agents Python dependencies..."
  if [ ! -d "$AGENTS_DIR/.venv" ]; then
    log "Creating Python virtual environment..."
    python3 -m venv "$AGENTS_DIR/.venv"
  fi
  # shellcheck disable=SC1091
  source "$AGENTS_DIR/.venv/bin/activate"
  pip install -q --upgrade pip
  if [ -f "$AGENTS_DIR/pyproject.toml" ]; then
    pip install -q -e "$AGENTS_DIR"
  else
    pip install -q supabase httpx pydantic pydantic-settings python-dotenv tenacity
  fi
  success "Agents dependencies ready"
fi

# --------------------------------------------------------------------------
# Free ports
# --------------------------------------------------------------------------
listeners() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null || true; }
is_own_tree() {
  local pid="$1" cur="$$"
  while [ -n "$cur" ] && [ "$cur" != "0" ] && [ "$cur" != "1" ]; do
    [ "$pid" = "$cur" ] && return 0
    cur="$(ps -o ppid= -p "$cur" 2>/dev/null | tr -d ' ')"
  done
  return 1
}
free_port() {
  local port="$1" pids
  pids="$(listeners "$port")"
  [ -z "$pids" ] && return 0
  log "Port $port busy (pids: $(echo "$pids" | tr '\n' ' ')), stopping..."
  for pid in $pids; do
    is_own_tree "$pid" && { log "  Skipping own tree pid $pid"; continue; }
    kill "$pid" 2>/dev/null || true
  done
  for _ in {1..10}; do sleep 0.3; [ -z "$(listeners "$port")" ] && return 0; done
  for pid in $(listeners "$port"); do is_own_tree "$pid" && continue; kill -9 "$pid" 2>/dev/null || true; done
  sleep 0.5
}

if [ "$MODE" != "scan-only" ]; then
  free_port "$PORT"
  [ "$PORT" != "3000" ] && free_port 3000
fi
if [ "$MODE" = "with-agents" ]; then
  free_port "$AGENTS_PORT"
fi

# --------------------------------------------------------------------------
# Run modes
# --------------------------------------------------------------------------
if [ "$MODE" = "scan-only" ]; then
  log "Running one-time local scan with agents (using pipeline)..."
  source "$AGENTS_DIR/.venv/bin/activate"
  cd "$AGENTS_DIR"
  JOBS_LOCAL_ONLY=1 python run.py --no-db --json ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
  success "Scan complete. Data written to $DATA_DIR/"
  exit 0
fi

if [ "$MODE" = "with-agents" ]; then
  log "Starting agents API server on http://localhost:$AGENTS_PORT"
  log "Note: Orchestrator API requires Supabase. Use 'run.py --no-db' for local scans."
  # The orchestrator API uses supabase_client which requires Supabase
  # For local development, use the run.py script directly
  warn "Agents API not started in local mode (requires Supabase)"
  warn "Run scans manually with: JOBS_LOCAL_ONLY=1 python run.py --no-db"
fi

log "Starting Next.js webapp (DEV) on http://localhost:$PORT"
log "  App:       http://localhost:$PORT"
log "  Health:    http://localhost:$PORT/api/health"
log "  Data mode: LOCAL (JSON files in $DATA_DIR)"
[ "$MODE" = "with-agents" ] && log "  Agents API: http://localhost:$AGENTS_PORT"
echo
log "Press Ctrl-C to stop all services"
echo

cd "$WEBAPP_DIR"
exec env PORT="$PORT" JOBS_LOCAL_ONLY=1 node "$NEXT_BIN" dev -p "$PORT" ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}