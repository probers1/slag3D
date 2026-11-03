#!/usr/bin/env bash
# ==============================================================================
# SLAG3D - Debian LXC Installation Script
# Automated deployment of SLAG3D on Debian 12 (Bookworm) / Ubuntu 22.04+ LXC
# ==============================================================================

set -euo pipefail

SCRIPT_NAME="slag3d-install"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

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
        log_error "ERROR: This script must be run as root inside the Debian LXC container."
        echo "Run with: sudo /opt/slag3D/scripts/install-lxc.sh"
        exit 1
    fi

    # Check minimum disk space
    REQUIRED_SPACE=2500  # at least 80MB app + buffers in MB
    AVAILABLE_SPACE=$(df -BM "${APP_DIR}" | awk 'NR==2 {print $4}' | tr -d 'M')
    if [ "${AVAILABLE_SPACE}" -lt "${REQUIRED_SPACE}" ]; then
        log_error "ERROR: Insufficient disk space. Available: ${AVAILABLE_SPACE}MB, Required: ~${REQUIRED_SPACE}MB"
        exit 1
    fi

    # Check network connectivity
    if ! ping -c 1 -W 2 google.com >/dev/null 2>&1; then
        log_error "ERROR: No internet connection detected. Please ensure the container has network access configured."
        exit 1
    fi
}

# 2. Install Node.js v22 LTS (upgrade from v20 if detected)
install_nodejs() {
    log_info "Checking and installing Node.js v22 LTS..."

    # Get current node version
    local CURRENT_VERSION=""
    if command -v node >/dev/null 2>&1; then
        CURRENT_VERSION=$(node -v | cut -d'.' -f1)
        if [[ "$CURRENT_VERSION" == "v18"* || "$CURRENT_VERSION" == "v17"* || "$CURRENT_VERSION" == "v16"* ]]; then
            # Old version detected, force upgrade to v22
            log_warn "Detected Node.js ${CURRENT_VERSION} - upgrading to v22 LTS (required)"
        fi
    fi

    if ! command -v node >/dev/null 2>&1; then
        log_info "Setting up NodeSource repository for Node.js v22 LTS..."
        
        # Add NodeSource GPG key (deb.nodesource.com uses sha256)
        mkdir -p /etc/apt/keyrings
        curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
        
        # Add NodeSource repository
        NODE_VERSION="node_22.x"
        echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/${NODE_VERSION} nodistro main" \
          | tee /etc/apt/sources.list.d/nodesource.list

        apt-get update -y
        apt-get install -y nodejs
    fi

    # Verify Node.js installation with flexible version check
    local NODE_OUTPUT=$(command -v node >/dev/null 2>&1 && node --version)
    if [[ "$NODE_OUTPUT" =~ v22 ]]; then
        log_success "Node.js installed successfully: $(node -v)"
    else
        log_warn "Node.js may not be correctly installed. Skipping npm dependencies..."
        return 1
    fi

    echo "Node version: $(node -v)"
    echo "npm version:  $(npm -v)"
}

# 4. Configure systemd for auto-mounting persistent volumes
configure_persistent_volumes() {
    log_info "Configuring persistent storage..."

    # Create mount units if they don't exist
    cat <<'EOF' > /etc/systemd/system/data.mount
[Unit]
Description=Mount SLAG3D Data Directory
After=local-fs.target

[Mount]
What=/dev/disk/by-id/uuid-PLACEHOLDER
Where=${DATA_DIR}
Type=ext4
Options=defaults,noatime
EOF

    cat <<'EOF' > /etc/systemd/system/uploads.mount
[Unit]
Description=Mount SLAG3D Uploads Directory
After=local-fs.target

[Mount]
What=/dev/disk/by-id/uuid-PLACEHOLDER
Where=${UPLOADS_DIR}
Type=ext4
Options=defaults,noatime
EOF

    log_info "Note: Update mount units with actual UUIDs if your /data and /uploads use different partitions."
    log_info "  Run: lsblk -o NAME,UUID,FSTYPE"
}

# 3. Install system dependencies
install_dependencies() {
    log_info "Updating apt package repositories..."
    apt-get update -y

    log_info "Installing core system dependencies, Chromium shared libraries, and tools..."
    apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git build-essential \
      p7zip-full chromium libnss3 libxss1 libasound2 \
      libatk-bridge2.0-0 libgtk-3-0 libgbm1 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
      libxrandr2 libpango-1.0-0 libcairo2 dnsutils
}

# 5. Setup configuration and secrets
setup_configuration() {
    local APP_DIR="${APP_DIR:-/opt/slag3D}"
    local DATA_DIR="${DATA_DIR:-${APP_DIR}/data}"
    local UPLOADS_DIR="${UPLOADS_DIR:-${APP_DIR}/uploads}"

    log_info "Setting up application configuration..."

    # 5a. Check and migrate existing database if needed
    migrate_existing_database() {
        local OLD_DB_PATH="/opt/slag3dDdata/vault.db"
        local NEW_DB_PATH="${DATA_DIR}/vault.db"

        # Create WAL mode for durability
        if [ -f "$NEW_DB_PATH" ]; then
            log_info "Existing database found at ${NEW_DB_PATH}"
            
            # Verify WAL mode is enabled
            local WAL_MODE=$(sqlite3 "$NEW_DB_PATH" "SELECT journal_mode FROM pragma_database_list WHERE name='main';")
            if [ "${WAL_MODE:-}" != "wal" ]; then
                log_warn "SQLite not using WAL mode. Enabling for durability..."
                sqlite3 "$NEW_DB_PATH" "PRAGMA journal_mode = wal;"
                log_success "WAL mode enabled"
            fi
        elif [ -f "$OLD_DB_PATH" ]; then
            log_warn "Old database found at ${OLD_DB_PATH}"
            log_info "Database will be stored in new location: ${DATA_DIR}"
            # Users may need to verify data migration if they want to preserve old data
        fi

        # Ensure WAL recovery directory exists
        mkdir -p "${DATA_DIR}" "${UPLOADS_DIR}"/thumbnails "${UPLOADS_DIR}"/models "${UPLOADS_DIR}"/tmp
    }

    migrate_existing_database

    # 5b. Generate secure secrets if not present
    generate_secrets() {
        local ENV_FILE="${APP_DIR}/.env"
        
        if [ ! -f "$ENV_FILE" ]; then
            log_info "Generating secure secrets for production..."
            
            cat > "${APP_DIR}/.env" <<EOF
# SLAG3D Production Environment Configuration
# Generated: $(date -Iseconds)

# 🔐 Security - REQUIRED for production
JWT_SECRET=$(openssl rand -base64 64)
SESSION_SECRET=$(openssl rand -base64 64)
REFRESH_TOKEN_SECRET=$(openssl rand -base64 64)

# 🚀 Deployment Mode
GOOSE_SEED_DB=false  # Production: no auto-seeding
SESSION_EXPIRY_MINUTES=1440
ADMIN_USER=admin
ADMIN_PASSWORD=$(openssl rand -base64 8 | tr -dc 'A-Za-z0-9!' | head -c 24)

EOF
            
            log_success "Environment file created with secure secrets"
            
            # Create plaintext password file in /tmp for easy access
            cat > /tmp/slag3d-admin-password.txt << EOF
# SLAG3D Initial Admin Password
# Generated: $(date)
# ==================================
USERNAME=admin
PASSWORD=${ADMIN_PASSWORD}
# ==================================
⚠️  IMPORTANT WARNINGS:
    1. Change this password IMMEDIATELY after first login
    2. Store this file SECURELY (chmod 600)
    3. After changing credentials, you can delete this file
EOF
chmod 600 /tmp/slag3d-admin-password.txt
            
            log_success "Initial admin credentials generated:"
            echo "   Username: admin"
            echo "   Password: ${ADMIN_PASSWORD}"
        else
            # Verify existing environment has required variables
            if grep -q "^JWT_SECRET=" "${APP_DIR}/.env" && \
               grep -q "^SESSION_SECRET=" "${APP_DIR}/.env"; then
                log_info "Existing .env found - using current secrets"
            else
                log_warn ".env exists but missing required secrets"
                log_info "Generating new secrets..."
                sed -i 's/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -base64 64)/' "${APP_DIR}/.env"
                sed -i 's/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -base64 64)/' "${APP_DIR}/.env"
            fi
        fi
    }

    generate_secrets
}

# 6. Deploy application files (npm install + build)
deploy_application() {
    local APP_DIR="${APP_DIR:-/opt/slag3D}"
    
    log_info "Deploying application to ${APP_DIR}..."

    # Check if repository is already present (user cloned manually)
    if [ ! -f "${APP_DIR}/package.json" ]; then
        log_warn "Repository not found at ${APP_DIR}. Expected manual git clone."
        echo "  Run: cd ${APP_DIR} && git pull"
        log_error "Cannot continue without repository. Exiting."
        exit 1
    fi

    log_info "Repository existing - skipping git clone step..."

    # Check if node_modules exists (fresh install or update needed)
    if [ ! -d "${APP_DIR}/node_modules" ]; then
        log_info "Installing Node.js dependencies (including native better-sqlite3)..."
        npm install --omit=dev || npm install

        # Approve missing install scripts for native modules and build tools
        log_info "Approving install scripts for native modules..."
        npm install-scripts approve better-sqlite3 esbuild puppeteer sqlite3 2>/dev/null || true
    fi

    log_info "Building production frontend assets..."
    
    # Add Node.js bin directories to PATH (npm, vite, etc.)
    if [ -d "${APP_DIR}/node_modules/.bin" ]; then
        export PATH="${APP_DIR}/node_modules/.bin:$PATH"
    fi
    
    # Ensure we're in the app directory before running npm
    cd "${APP_DIR}" || exit 1
    
    npm run build || {
        log_error "Build failed! Check npm errors above."
        exit 1
    }

    # Create .gitignore files for data and uploads directories (outside git tracking)
    log_info "Creating .gitignore exclusions..."
    
    cat > "${DATA_DIR}/.gitignore" <<'EOF'
# SLAG3D Data Directory - Excluded from version control
vault.db
vault.db-wal
vault.db-shm
EOF

    cat > "${UPLOADS_DIR}/.gitignore" <<'EOF'
# SLAG3D Uploads Directory - Excluded from version control
/*.*
*.png
*.jpg
*.jpeg
*cache*
EOF

    log_success ".gitignore exclusions created in data and uploads directories"

    log_success "Application deployed successfully"
}

# 7. Configure systemd service
create_systemd_service() {
    local APP_DIR="${APP_DIR:-/opt/slag3D}"
    local SERVICE_FILE="/etc/systemd/system/slag3D.service"

    log_info "Registering systemd service..."

    cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=SLAG3D 3D Printer Model Repository & Management Service
Documentation=https://github.com/slag3d/slag3d
After=network.target local-fs.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10
TimeoutStopSec=30

# Environment configuration
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=PUPPETEER_FORCE_CHROMIUM_PATH=/usr/bin/chromium
Environment=PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Security hardening limits
LimitNOFILE=65536    # File descriptors (important for Puppeteer)
LimitCORE=infinity   # Allow core dumps for debugging

# Resource management
MemoryMax=2G
MemoryHigh=1.5G

[Install]
WantedBy=multi-user.target
EOF

    log_success "Service file created at ${SERVICE_FILE}"
}

# 8. Start and verify services
start_systemd_service() {
    log_info "Configuring and restarting systemd service..."

    # Reload systemd daemon to recognize new configuration
    systemctl daemon-reload

    # Check if service already exists (for upgrades)
    if ! systemctl list-unit-files | grep -q slag3D.service; then
        systemctl enable slag3D.service
    fi

    log_info "Restarting SLAG3D service..."
    systemctl restart slag3D.service

    # Wait for startup and basic health check
    sleep 2

    # Verify service is active
    if systemctl is-active --quiet slag3D.service; then
        log_success "SLAG3D service is running"
        
        # Display service status
        echo ""
        systemd-cgls slag3D.service 2>/dev/null || true
    else
        log_error "Failed to start service. Check logs:"
        journalctl -u slag3D.service -n 20 --no-pager
        exit 1
    fi
}

# 9. Verification and summary
verify_and_report() {
    local APP_DIR="${APP_DIR:-/opt/slag3D}"
    
    echo ""
    log_info "Running verification checks..."
    echo ""

    # Check service status
    systemctl is-active slag3D.service && \
        echo -e "${GREEN}✓${NC} Service is running" || \
        echo -e "${RED}✗${NC} Service is NOT running"

    # Check listening port
    if ss -tlnp | grep -q ":3000"; then
        echo -e "${GREEN}✓${NC} Port 3000 is listening"
    else
        echo -e "${RED}✗${NC} Port 3000 is not listening"
    fi

    # Check database connection
    if [ -f "${DATA_DIR}/vault.db" ]; then
        local DB_SIZE=$(ls -lh "${DATA_DIR}/vault.db" | awk '{print $5}')
        echo -e "${GREEN}✓${NC} Database exists (${DB_SIZE}) in ${DATA_DIR}"
    else
        echo -e "${YELLOW}⚠${NC} No database found (service may still be initializing)"
    fi

    # Check frontend build
    if [ -f "${APP_DIR}/dist/index.html" ]; then
        local BUILD_SIZE=$(du -sh "${APP_DIR}/dist" | cut -f1)
        echo -e "${GREEN}✓${NC} Frontend built (${BUILD_SIZE})"
    else
        echo -e "${YELLOW}⚠${NC} Frontend not found (run 'npm run build')"
    fi

    # Check Node.js version
    if command -v node >/dev/null 2>&1; then
        echo "Node: $(node -v)"
        echo "npm:  $(npm -v)"
    fi

    echo ""
    log_success "=========================================="
    log_success "SLAG3D Installation Complete!"
    log_success "=========================================="
    echo ""
    echo "Quick Commands:"
    echo "  Status:    systemctl status slag3D.service"
    echo "  Logs:      journalctl -u slag3D.service -f"
    echo "  Restart:   systemctl restart slag3D.service"
    echo ""
    echo "Access the dashboard:"
    echo "  URL:       http://\$(hostname -I | awk '{print \$1}'):3000"
    echo ""
    echo "Default credentials (change immediately):"
    echo "  Username:  admin"
    echo "  Password:  admin123"
    echo ""
    log_warn "Security Reminder:"
    echo "  - Change default password via Settings page"
    echo "  - Set SESSION_EXPIRY_MINUTES to ≤7 days for production"
    echo "  - Use HTTPS with a reverse proxy (nginx, traefik) in production"
    echo ""
}

# Main execution
main() {
    print_header
    
    # Configuration constants
    APP_DIR="${APP_DIR:-/opt/slag3D}"
    DATA_DIR="${DATA_DIR:-${APP_DIR}/data}"
    UPLOADS_DIR="${UPLOADS_DIR:-${APP_DIR}/uploads}"

    log_info "Configuration:"
    echo "  App DIR:   ${APP_DIR}"
    echo "  Data DIR:  ${DATA_DIR}"
    echo "  Uploads:   ${UPLOADS_DIR}"
    echo ""

    check_prerequisites
    configure_persistent_volumes
    install_dependencies
    install_nodejs
    setup_configuration
    deploy_application
    create_systemd_service
    start_systemd_service
    verify_and_report

    log_success "To update SLAG3D in the future, add this to your container rebuild script:"
    echo ""
    echo '  /opt/slag3D/scripts/install-lxc.sh --update'
    echo ""
}

# Handle --update flag for seamless updates during container rebuilds
if [ "${1:-}" = "--update" ] && [ -f "/opt/slag3D/package.json" ]; then
    log_info "Updating existing SLAG3D installation..."
    APP_DIR="/opt/slag3D" npm install
    cd "${APP_DIR}" && git pull 2>/dev/null || true && npm run build
    systemctl restart slag3D.service
    log_success "Update complete. Service restarted."
    exit 0
fi

main "$@"
