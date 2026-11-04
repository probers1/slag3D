#!/usr/bin/env bash
# ==============================================================================
# SLAG3D - Debian LXC Installation Script
# Automated deployment of SLAG3D on Debian 12 (Bookworm) / Ubuntu 22.04+ LXC
# ==============================================================================

set -euo pipefail

SCRIPT_NAME="slag3d-install"

# Global Environment Variables
APP_DIR="${APP_DIR:-/opt/slag3D}"
DATA_DIR="${DATA_DIR:-${APP_DIR}/data}"
UPLOADS_DIR="${UPLOADS_DIR:-${APP_DIR}/uploads}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC}  $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1" >&2; }

# Read a value from a .env style file (supports optional quotes)
read_env_value() {
    local key="$1" file="$2" default="${3:-}"
    local value=""

    if [ -f "$file" ]; then
        value=$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1 | cut -d '=' -f 2- || true)
        value=$(printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
        if [[ "$value" == \"*\" ]] || [[ "$value" == \'*\' ]]; then
            value="${value:1:${#value}-2}"
        fi
    fi

    if [ -z "$value" ]; then
        value="$default"
    fi

    printf '%s' "$value"
}

# Generate a random 20 character alphanumeric admin password.
# `cut` is used instead of `head -c` because `head` closes the pipe early,
# which triggers SIGPIPE in the producer and aborts the installer under
# `set -euo pipefail`.
generate_admin_password() {
    local password
    password=$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c 1-20)
    if [ "${#password}" -lt 16 ]; then
        password=$(openssl rand -hex 16 | cut -c 1-20)
    fi
    printf '%s' "$password"
}

print_header() {
    echo "=========================================================="
    echo "  SLAG3D (Storage, Library, & Asset Grid) Installer"
    echo "=========================================================="
}

# 1. Verify environment requirements
check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check root privileges
    if [ "$(id -u)" -ne 0 ]; then
        log_error "ERROR: This script must be run as root inside the LXC container."
        echo "Run with: sudo /opt/slag3D/scripts/install-lxc.sh"
        exit 1
    fi

    # Ensure target parent directory exists before checking disk space
    mkdir -p "${APP_DIR}"

    # Check minimum disk space (2.5GB)
    REQUIRED_SPACE=2500
    AVAILABLE_SPACE=$(df -BM "${APP_DIR}" | awk 'NR==2 {print $4}' | tr -d 'M')
    if [ "${AVAILABLE_SPACE}" -lt "${REQUIRED_SPACE}" ]; then
        log_error "ERROR: Insufficient disk space. Available: ${AVAILABLE_SPACE}MB, Required: ~${REQUIRED_SPACE}MB"
        exit 1
    fi

    # Check network connectivity
    if ! ping -c 1 -W 2 google.com >/dev/null 2>&1; then
        log_error "ERROR: No internet connection detected. Please verify container network settings."
        exit 1
    fi
}

# 2. Install Node.js v22 LTS
install_nodejs() {
    log_info "Checking Node.js v22 LTS installation..."

    local NEED_INSTALL=false
    if command -v node >/dev/null 2>&1; then
        local MAJOR_VERSION
        MAJOR_VERSION=$(node -v | cut -d'.' -f1 | tr -d 'v')
        if [ "$MAJOR_VERSION" -lt 22 ]; then
            log_warn "Detected Node.js v${MAJOR_VERSION} - upgrading to v22 LTS..."
            NEED_INSTALL=true
        fi
    else
        NEED_INSTALL=true
    fi

    if [ "$NEED_INSTALL" = true ]; then
        log_info "Setting up NodeSource repository for Node.js v22 LTS..."
        mkdir -p /etc/apt/keyrings
        curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --overwrite
        
        NODE_VERSION="node_22.x"
        echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/${NODE_VERSION} nodistro main" \
          | tee /etc/apt/sources.list.d/nodesource.list

        apt-get update -y
        apt-get install -y nodejs
    fi

    if node -v | grep -q "v22"; then
        log_success "Node.js environment ready: $(node -v) (npm $(npm -v))"
    else
        log_error "Failed to verify Node.js v22 installation."
        exit 1
    fi
}

# 3. Install system dependencies (includes python3-setuptools for node-gyp build support on Python 3.12+)
install_dependencies() {
    log_info "Updating apt package repositories..."
    apt-get update -y

    log_info "Installing system libraries, build tools, and Chromium runtime..."
    apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git build-essential \
      python3 python3-setuptools p7zip-full chromium \
      libnss3 libxss1 libasound2 libatk-bridge2.0-0 \
      libgtk-3-0 libgbm1 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libpango-1.0-0 libcairo2 dnsutils sqlite3
}

# 4. Setup configuration and secrets
setup_configuration() {
    log_info "Configuring storage directories..."

    mkdir -p "${DATA_DIR}"

    # Database migration check
    local OLD_DB_PATH="/opt/slag3d/data/vault.db"
    local DOCKER_DB_PATH="/data/vault.db"
    local NEW_DB_PATH="${DATA_DIR}/vault.db"

    if [ -f "$NEW_DB_PATH" ]; then
        log_info "Existing database found at ${NEW_DB_PATH}"
        local WAL_MODE
        WAL_MODE=$(sqlite3 "$NEW_DB_PATH" "PRAGMA journal_mode;" 2>/dev/null || true)
        if [ "${WAL_MODE:-}" != "wal" ]; then
            log_warn "Enabling WAL mode for SQLite durability..."
            sqlite3 "$NEW_DB_PATH" "PRAGMA journal_mode = wal;"
            log_success "WAL mode enabled"
        fi
    elif [ -f "$OLD_DB_PATH" ]; then
        log_warn "Migrating database from ${OLD_DB_PATH}..."
        cp "$OLD_DB_PATH" "$NEW_DB_PATH"
    elif [ -f "$DOCKER_DB_PATH" ]; then
        log_warn "Migrating database from ${DOCKER_DB_PATH}..."
        cp "$DOCKER_DB_PATH" "$NEW_DB_PATH"
    fi

    # Environment configuration generation
    local ENV_FILE="${APP_DIR}/.env"
    if [ ! -f "$ENV_FILE" ]; then
        log_info "Generating secure production secrets..."
        
        JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
        SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n')
        REFRESH_TOKEN_SECRET=$(openssl rand -base64 48 | tr -d '\n')
        ADMIN_PASSWORD=$(generate_admin_password)

        cat > "${ENV_FILE}" <<ENDOFENV
# SLAG3D Production Environment Configuration
# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)

JWT_SECRET="${JWT_SECRET}"
SESSION_SECRET="${SESSION_SECRET}"
REFRESH_TOKEN_SECRET="${REFRESH_TOKEN_SECRET}"

# Creates the admin account below on first startup (only when no users exist).
GOOSE_SEED_DB=true
SESSION_EXPIRY_MINUTES=1440
ADMIN_USER=admin
ADMIN_PASSWORD="${ADMIN_PASSWORD}"

# Storage location for uploaded models and rendered thumbnails.
UPLOADS_DIR="${UPLOADS_DIR}"
ENDOFENV

        chmod 600 "${ENV_FILE}"
        log_success "Environment file saved to ${ENV_FILE}"
        log_success "Generated Admin Password: ${ADMIN_PASSWORD}"
    else
        log_info "Existing .env configuration preserved."

        if ! grep -q '^ADMIN_USER=' "$ENV_FILE"; then
            printf '\nADMIN_USER=admin\n' >> "$ENV_FILE"
            log_info "Added ADMIN_USER=admin to ${ENV_FILE}"
        fi

        if ! grep -q '^ADMIN_PASSWORD=' "$ENV_FILE"; then
            local NEW_ADMIN_PASSWORD
            NEW_ADMIN_PASSWORD=$(generate_admin_password)
            printf '\nADMIN_PASSWORD="%s"\n' "$NEW_ADMIN_PASSWORD" >> "$ENV_FILE"
            log_success "Generated Admin Password: ${NEW_ADMIN_PASSWORD}"
        fi

        if ! grep -q '^UPLOADS_DIR=' "$ENV_FILE"; then
            printf '\nUPLOADS_DIR="%s"\n' "$UPLOADS_DIR" >> "$ENV_FILE"
            log_info "Added UPLOADS_DIR=${UPLOADS_DIR} to ${ENV_FILE}"
        fi
    fi

    # Credentials and paths that must be used after installation
    ADMIN_USER=$(read_env_value "ADMIN_USER" "$ENV_FILE" "admin")
    ADMIN_PASSWORD=$(read_env_value "ADMIN_PASSWORD" "$ENV_FILE" "")
    UPLOADS_DIR=$(read_env_value "UPLOADS_DIR" "$ENV_FILE" "${APP_DIR}/uploads")

    mkdir -p "${UPLOADS_DIR}/thumbnails" "${UPLOADS_DIR}/models" "${UPLOADS_DIR}/tmp"
    log_success "Uploads directory: ${UPLOADS_DIR}"
}

# 5. Deploy application files & post-build pruning
deploy_application() {
    log_info "Deploying application to ${APP_DIR}..."

    if [ ! -f "${APP_DIR}/package.json" ]; then
        log_error "package.json not found in ${APP_DIR}. Clone repository before running installer."
        exit 1
    fi

    cd "${APP_DIR}"

    # Install dependencies (npm respects allowScripts in package.json)
    log_info "Installing dependencies..."
    npm ci || npm install

    log_info "Building production client and server bundles..."
    npm run build

    # Verify build artifacts
    if [ ! -f "${APP_DIR}/dist/server.js" ] || [ ! -f "${APP_DIR}/dist/index.html" ]; then
        log_error "Build failed: output files missing in dist/"
        exit 1
    fi

    # Post-build pruning: remove devDependencies to shrink container footprint
    log_info "Pruning devDependencies to optimize disk usage..."
    npm prune --omit=dev

    # Clear npm/V8 build caches
    rm -rf ~/.npm ~/.cache /tmp/v8-compile-cache-*

    # Create gitignore files for unmanaged persistent data
    cat > "${DATA_DIR}/.gitignore" <<'EOF'
vault.db
vault.db-wal
vault.db-shm
EOF

    cat > "${UPLOADS_DIR}/.gitignore" <<'EOF'
/*
!.gitignore
EOF

    log_success "Application built and dependencies pruned successfully."
}

# 6. Configure systemd service
create_systemd_service() {
    local SERVICE_FILE="/etc/systemd/system/slag3D.service"

    log_info "Registering systemd service..."

    cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=SLAG3D Service
After=network.target local-fs.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/node ${APP_DIR}/dist/server.js
Restart=on-failure
RestartSec=10
TimeoutStopSec=30

Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DB_PATH=${DATA_DIR}/vault.db
Environment=UPLOADS_DIR=${UPLOADS_DIR}
Environment=PUPPETEER_FORCE_CHROMIUM_PATH=/usr/bin/chromium
Environment=PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
Environment=PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

LimitNOFILE=65536
MemoryMax=2G
MemoryHigh=1.5G

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable slag3D.service
    log_success "Service unit registered."
}

# 7. Start and verify service execution
start_systemd_service() {
    log_info "Starting SLAG3D service..."
    systemctl restart slag3D.service
    sleep 2

    if systemctl is-active --quiet slag3D.service; then
        log_success "SLAG3D service is active"
    else
        log_error "Service startup failed. Recent logs:"
        journalctl -u slag3D.service -n 20 --no-pager
        exit 1
    fi
}

# 7b. Wait until the HTTP API answers
wait_for_api() {
    local port="${1:-3000}"
    local url="http://127.0.0.1:${port}/api/health"

    log_info "Waiting for the API to become ready..."
    for _ in $(seq 1 60); do
        if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
            log_success "API is responding on port ${port}"
            return 0
        fi
        sleep 1
    done

    log_error "API did not become ready within 60 seconds. Recent logs:"
    journalctl -u slag3D.service -n 20 --no-pager || true
    return 1
}

# 7c. Verify that the configured admin credentials actually work.
# The admin account is only auto-seeded on an empty database, so an existing
# installation can keep an old password while .env advertises a new one.
# When that happens the password is re-synced with the configured value.
verify_admin_login() {
    local user="$1" pass="$2" port="${3:-3000}"
    local payload

    payload=$(node -e 'process.stdout.write(JSON.stringify({ username: process.argv[1], password: process.argv[2] }))' "$user" "$pass")

    curl -fsS --max-time 5 \
        -H 'Content-Type: application/json' \
        --data "$payload" \
        "http://127.0.0.1:${port}/api/auth/login" >/dev/null 2>&1
}

sync_admin_credentials() {
    local user="$1" pass="$2" port="${3:-3000}"

    if [ -z "$pass" ]; then
        log_warn "No ADMIN_PASSWORD configured - skipping admin credential verification."
        return 0
    fi

    if verify_admin_login "$user" "$pass" "$port"; then
        log_success "Admin credentials verified (user: ${user})"
        return 0
    fi

    log_warn "Admin login with the configured password failed - syncing the admin account."

    if [ ! -f "${APP_DIR}/scripts/set-admin-password.js" ]; then
        log_error "scripts/set-admin-password.js is missing. Run 'git pull' in ${APP_DIR} and retry."
        return 1
    fi

    if ! (cd "$APP_DIR" && DB_PATH="${DATA_DIR}/vault.db" ADMIN_USER="$user" ADMIN_PASSWORD="$pass" node scripts/set-admin-password.js); then
        log_error "Failed to sync the admin account."
        return 1
    fi

    if verify_admin_login "$user" "$pass" "$port"; then
        log_success "Admin password synced and login verified"
        return 0
    fi

    log_error "Admin login still fails after resetting the password. Check 'journalctl -u slag3D.service'."
    return 1
}

# 8. Report final status
verify_and_report() {
    echo ""
    log_info "Running verification checks:"

    systemctl is-active slag3D.service && log_success "Service running" || log_error "Service halted"
    
    if ss -tlnp | grep -q ":3000"; then
        log_success "Port 3000 actively listening"
    else
        log_warn "Port 3000 not listening yet (service warming up)"
    fi

    local ENV_FILE="${APP_DIR}/.env"
    local PASS_DISP="[Check ${APP_DIR}/.env for admin credentials]"
    local USER_DISP="admin"

    if [ -f "$ENV_FILE" ]; then
        PASS_DISP=$(read_env_value "ADMIN_PASSWORD" "$ENV_FILE" "$PASS_DISP")
        USER_DISP=$(read_env_value "ADMIN_USER" "$ENV_FILE" "admin")
    fi

    echo ""
    log_success "=========================================="
    log_success "SLAG3D Installation Complete!"
    log_success "=========================================="
    echo "Dashboard URL: http://$(hostname -I | awk '{print $1}'):3000"
    echo "Admin User:    ${USER_DISP}"
    echo "Admin Pass:    ${PASS_DISP}"
    echo ""
    echo "Change or reset the admin password with:"
    echo "  cd ${APP_DIR} && npm run set-admin -- 'YourNewPassword'"
    echo ""
}

main() {
    print_header
    check_prerequisites
    install_dependencies
    install_nodejs
    setup_configuration
    deploy_application
    create_systemd_service
    start_systemd_service
    wait_for_api 3000
    sync_admin_credentials "$ADMIN_USER" "$ADMIN_PASSWORD" 3000
    verify_and_report
}

# Rebuild / update flag execution handler
if [ "${1:-}" = "--update" ] && [ -f "/opt/slag3D/package.json" ]; then
    log_info "Updating SLAG3D installation..."
    cd /opt/slag3D
    git pull 2>/dev/null || true
    npm ci || npm install
    npm run build
    npm prune --omit=dev
    rm -rf ~/.npm ~/.cache
    systemctl restart slag3D.service
    if wait_for_api 3000; then
        UPDATE_ADMIN_USER=$(read_env_value "ADMIN_USER" "/opt/slag3D/.env" "admin")
        UPDATE_ADMIN_PASSWORD=$(read_env_value "ADMIN_PASSWORD" "/opt/slag3D/.env" "")
        sync_admin_credentials "$UPDATE_ADMIN_USER" "$UPDATE_ADMIN_PASSWORD" 3000 || true
    fi
    log_success "Update complete. Service restarted."
    exit 0
fi

main "$@"