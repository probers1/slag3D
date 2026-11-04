#!/usr/bin/env bash
# =============================================================================
# SLAG3D Proxmox LXC update script
# =============================================================================
# Performs a full application update for an existing LXC deployment:
#   1. Stop the systemd service
#   2. git pull (fetch latest code)
#   3. Install dependencies
#   4. Build production bundles (client + server)
#   5. Start the service and wait for the healthcheck
#
# Must be run inside the LXC container (as root) from the app directory
# (/opt/slag3D by default).
#
# Usage: sudo /opt/slag3D/scripts/update.sh
# =============================================================================

set -euo pipefail

APP_DIR="${SLAG3D_APP_DIR:-/opt/slag3D}"
SERVICE="${SLAG3D_SERVICE:-slag3D.service}"
HEALTH_URL="http://127.0.0.1:3000/api/health"
HEALTH_TIMEOUT_SECS="${SLAG3D_HEALTH_TIMEOUT:-120}"

log() { echo "[SLAG3D-UPDATE] $*"; }
fail() { echo "[SLAG3D-UPDATE] ERROR: $*" >&2; exit 1; }

if [ ! -d "$APP_DIR/.git" ]; then
  fail "Application directory not found: $APP_DIR (expected a git checkout)."
fi

cd "$APP_DIR"

log "Stopping systemd service ${SERVICE} ..."
systemctl stop "$SERVICE" 2>/dev/null || log "Service ${SERVICE} was not running (skipping stop)."

log "Pulling latest changes ..."
git pull

log "Installing dependencies ..."
npm ci 2>/dev/null || npm install

log "Building production bundles ..."
npm run build

log "Starting systemd service ${SERVICE} ..."
systemctl start "$SERVICE"

log "Waiting for healthcheck at ${HEALTH_URL} (timeout ${HEALTH_TIMEOUT_SECS}s) ..."
elapsed=0
healthy=false
until curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; do
  if [ "$elapsed" -ge "$HEALTH_TIMEOUT_SECS" ]; then
    break
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done

if curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
  log "SUCCESS: SLAG3D updated and healthy."
  systemctl status "$SERVICE" --no-pager || true
  exit 0
fi

log "FAILED: service did not become healthy in time."
systemctl status "$SERVICE" --no-pager || true
exit 1
