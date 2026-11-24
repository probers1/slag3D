#!/usr/bin/env bash
# =============================================================================
# SLAG3D Proxmox LXC update script
# =============================================================================
# Performs a full application update for an existing LXC deployment:
#   1. Stop the systemd service
#   2. fetch and fast-forward to the latest remote default branch
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
UPDATE_BRANCH="${SLAG3D_UPDATE_BRANCH:-}" # Optional override; defaults to origin/HEAD (main)

log() { echo "[SLAG3D-UPDATE] $*"; }
fail() { echo "[SLAG3D-UPDATE] ERROR: $*" >&2; exit 1; }

if [ ! -d "$APP_DIR/.git" ]; then
  fail "Application directory not found: $APP_DIR (expected a git checkout)."
fi

cd "$APP_DIR"

log "Stopping systemd service ${SERVICE} ..."
systemctl stop "$SERVICE" 2>/dev/null || log "Service ${SERVICE} was not running (skipping stop)."

log "Fetching latest git refs from origin ..."
git fetch --prune origin || fail "Could not fetch from origin; check network/credentials and retry."
git remote set-head origin -a >/dev/null 2>&1 || true

# Use the remote's default branch (origin/HEAD), not whichever branch happens
# to be checked out. There are currently no version tags in this repository,
# so "latest" means the default branch HEAD.
DEFAULT_BRANCH="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
DEFAULT_BRANCH="${DEFAULT_BRANCH#origin/}"
BRANCH="${UPDATE_BRANCH:-${DEFAULT_BRANCH:-main}}"

git rev-parse --verify --quiet "refs/remotes/origin/$BRANCH" >/dev/null \
  || fail "Remote branch origin/$BRANCH was not found; set SLAG3D_UPDATE_BRANCH to a valid branch."

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
  log "Switching from '$CURRENT_BRANCH' to '$BRANCH' ..."
  git checkout "$BRANCH" || fail "Could not switch to '$BRANCH'; resolve local changes and retry."
fi

BEFORE="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse "origin/$BRANCH")"

if [ "$BEFORE" = "$REMOTE_HEAD" ]; then
  log "Already at latest $BRANCH ($BEFORE)."
else
  if ! git merge-base --is-ancestor "$BEFORE" "$REMOTE_HEAD"; then
    fail "Local branch has commits not present in origin/$BRANCH; resolve them before updating."
  fi
  log "Fast-forwarding $BEFORE -> $REMOTE_HEAD ..."
  git merge --ff-only "origin/$BRANCH" \
    || fail "Cannot fast-forward to origin/$BRANCH; resolve local commits/changes and retry."
fi

AFTER="$(git rev-parse HEAD)"
[ "$AFTER" = "$REMOTE_HEAD" ] || fail "Update did not reach origin/$BRANCH HEAD."
log "Now at $BRANCH $AFTER."

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
