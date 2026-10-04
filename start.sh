#!/usr/bin/env bash
#
# Start the CodeWizard DevOps Agents server (the Next.js app in webapp/).
#
# Dependencies are installed automatically on the first run, so a fresh clone
# only needs:  ./start.sh
#
# Usage:
#   ./start.sh                # dev server with hot reload on $PORT (default 3001)
#   ./start.sh --prod         # production server (builds first if .next is missing)
#   ./start.sh --port 4000    # override the port
#   ./start.sh --install      # force `npm install` even if node_modules looks fine
#   ./start.sh --no-kill-ports  # never stop whatever holds the ports
#   ./start.sh -- --turbopack # any extra flags are forwarded to `next dev/start`
#
# Any process listening on $PORT or on 3000 is stopped first (SIGTERM, then
# SIGKILL), so a previous instance never blocks startup. Processes in this
# script's own tree are never touched.
#
# Environment:
#   PORT   listen port   (default 3001)
#   MODE   dev | prod    (default dev)

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WEBAPP_DIR="$ROOT_DIR/webapp"
STAMP="$WEBAPP_DIR/node_modules/.cw-install-stamp"

PORT="${PORT:-3001}"
MODE="${MODE:-dev}"
FORCE_INSTALL=0
KILL_PORTS=1
EXTRA_ARGS=()

die() { echo "error: $*" >&2; exit 1; }

usage() {
  # Print the leading comment block (everything after the shebang) as usage.
  awk 'NR == 1 { next } /^#/ { sub(/^#[[:space:]]?/, ""); print; next } { exit }' "${BASH_SOURCE[0]}" | sed '/./,$!d'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --prod|--production) MODE="prod"; shift ;;
    --dev) MODE="dev"; shift ;;
    --install) FORCE_INSTALL=1; shift ;;
    --no-kill-ports) KILL_PORTS=0; shift ;;
    --port)
      [ "$#" -ge 2 ] || die "--port needs a value"
      PORT="$2"; shift 2 ;;
    --port=*) PORT="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; while [ "$#" -gt 0 ]; do EXTRA_ARGS+=("$1"); shift; done ;;
    *) EXTRA_ARGS+=("$1"); shift ;;
  esac
done

[ -d "$WEBAPP_DIR" ] || die "webapp/ not found next to this script ($ROOT_DIR)"

# --------------------------------------------------------------------------
# Preflight: node + npm
# --------------------------------------------------------------------------
command -v node >/dev/null 2>&1 || die "node not found - install Node.js 20+ (https://nodejs.org)"
command -v npm >/dev/null 2>&1 || die "npm not found - it ships with Node.js"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  die "Node $(node -v) is too old - Next.js 16 needs Node 20.9+"
fi

# --------------------------------------------------------------------------
# Env file: seed .env.local from the example on a fresh clone
# --------------------------------------------------------------------------
if [ ! -f "$WEBAPP_DIR/.env.local" ] && [ -f "$WEBAPP_DIR/.env.example" ]; then
  echo "==> webapp/.env.local missing, seeding it from .env.example"
  echo "    (edit it with real values; the app falls back to local JSON without them)"
  cp "$WEBAPP_DIR/.env.example" "$WEBAPP_DIR/.env.local"
fi

# --------------------------------------------------------------------------
# Dependencies
# --------------------------------------------------------------------------
next_entry() {
  # The package's real entrypoint first: node_modules/.bin is sometimes
  # materialised as flat copies (broken symlinks), which fail to resolve.
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
  if [ "$FORCE_INSTALL" -eq 1 ]; then return 0; fi
  [ -d "$WEBAPP_DIR/node_modules" ] || return 0
  next_works "$(next_entry)" || return 0
  # manifests edited after the last install => treat as stale
  [ -f "$STAMP" ] || return 0
  if [ "$WEBAPP_DIR/package.json" -nt "$STAMP" ]; then return 0; fi
  if [ -f "$WEBAPP_DIR/package-lock.json" ] && [ "$WEBAPP_DIR/package-lock.json" -nt "$STAMP" ]; then
    return 0
  fi
  return 1
}

NEXT_BIN=""

if needs_install; then
  echo "==> installing webapp dependencies (npm install)"
  (cd "$WEBAPP_DIR" && npm install --no-audit --no-fund)
fi

NEXT_BIN="$(next_entry)"

if ! next_works "$NEXT_BIN"; then
  # node_modules/.bin can arrive as copies instead of symlinks (unpacked or
  # copied trees); npm rebuild re-creates the links without touching the tree.
  echo "==> next binary looks broken, repairing bin links (npm rebuild)"
  (cd "$WEBAPP_DIR" && npm rebuild >/dev/null 2>&1) || true
  NEXT_BIN="$(next_entry)"
  next_works "$NEXT_BIN" || die "cannot run $NEXT_BIN - delete webapp/node_modules and re-run"
fi

: > "$STAMP" 2>/dev/null || true

# --------------------------------------------------------------------------
# Build (prod only, and only when .next/BUILD_ID is missing)
# --------------------------------------------------------------------------
if [ "$MODE" = "prod" ] && [ ! -f "$WEBAPP_DIR/.next/BUILD_ID" ]; then
  echo "==> no production build found, building"
  (cd "$WEBAPP_DIR" && node "$NEXT_BIN" build)
fi

# --------------------------------------------------------------------------
# Free the ports
# --------------------------------------------------------------------------
listeners() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null || true; }

# Never kill the script itself or anything it was launched from.
is_own_tree() {
  local pid="$1" cur="$$"
  while [ -n "$cur" ] && [ "$cur" != "0" ] && [ "$cur" != "1" ]; do
    if [ "$pid" = "$cur" ]; then return 0; fi
    cur="$(ps -o ppid= -p "$cur" 2>/dev/null | tr -d ' ')"
  done
  return 1
}

free_port() {
  local port="$1" pids pid cmd attempt
  pids="$(listeners "$port")"
  if [ -z "$pids" ]; then return 0; fi

  echo "==> port $port is busy (pid: $(echo "$pids" | tr '\n' ' ')), stopping it"
  for pid in $pids; do
    if is_own_tree "$pid"; then
      echo "    pid $pid belongs to this script's own process tree - skipping"
      continue
    fi
    cmd="$(ps -o command= -p "$pid" 2>/dev/null | cut -c1-64)"
    echo "    kill $pid${cmd:+  ($cmd)}"
    kill "$pid" 2>/dev/null || true
  done

  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    sleep 0.3
    if [ -z "$(listeners "$port")" ]; then
      echo "    port $port is free"
      return 0
    fi
  done

  for pid in $(listeners "$port"); do
    if is_own_tree "$pid"; then continue; fi
    echo "    kill -9 $pid"
    kill -9 "$pid" 2>/dev/null || true
  done
  sleep 0.5
  if [ -n "$(listeners "$port")" ]; then
    echo "    WARNING: port $port is still held by: $(listeners "$port" | tr '\n' ' ')" >&2
    echo "    WARNING: the server will probably fail to bind - free it manually (needs sudo?)" >&2
  else
    echo "    port $port is free"
  fi
}

if [ "$KILL_PORTS" -eq 1 ]; then
  free_port "$PORT"
  # 3000 is always reclaimed: a stray dev server there is never what we want.
  if [ "$PORT" != "3000" ]; then free_port 3000; fi
fi

# --------------------------------------------------------------------------
# Start
# --------------------------------------------------------------------------
if [ "$MODE" = "prod" ]; then
  TARGET="start"
else
  TARGET="dev"
fi

echo "==> starting Next.js ($TARGET) on http://localhost:$PORT"
echo "    app: http://localhost:$PORT   health: http://localhost:$PORT/api/health"
echo "    Ctrl-C to stop"
echo

cd "$WEBAPP_DIR"
exec env PORT="$PORT" node "$NEXT_BIN" "$TARGET" -p "$PORT" ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}