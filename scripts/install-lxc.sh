#!/usr/bin/env bash
# ==============================================================================
# SLAG3D - Debian LXC Installation Script
# Automated deployment of SLAG3D on Debian 12 (Bookworm) / Ubuntu 22.04+ LXC
# ==============================================================================

set -euo pipefail

echo "=========================================================="
echo "  SLAG3D (Storage, Library, & Asset Grid) Installer"
echo "=========================================================="

# 1. Verify root privileges
if [ "$(id -u)" -ne 0 ]; then
  echo "[-] ERROR: This script must be run as root inside the Debian LXC container." >&2
  exit 1
fi

APP_DIR="/opt/slag3d"
DATA_DIR="/data"
UPLOADS_DIR="/uploads"

echo "[+] Updating apt package repositories..."
apt-get update -y

echo "[+] Installing core system dependencies, Chromium shared libraries, and 7-Zip..."
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  gnupg \
  git \
  build-essential \
  p7zip-full \
  chromium \
  libnss3 \
  libxss1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libgtk-3-0 \
  libgbm1 \
  libdrm2 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libpango-1.0-0 \
  libcairo2

# 2. Install Node.js v20 LTS via NodeSource
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d'.' -f1)" != "v20" ]; then
  echo "[+] Setting up NodeSource repository for Node.js v20 LTS..."
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
fi

echo "[+] Node.js version: $(node -v)"
echo "[+] npm version: $(npm -v)"

# 3. Create persistent directories
echo "[+] Setting up persistent storage mountpoints..."
mkdir -p "${DATA_DIR}" "${UPLOADS_DIR}/thumbnails" "${UPLOADS_DIR}/models" "${UPLOADS_DIR}/tmp"
chmod -R 755 "${DATA_DIR}" "${UPLOADS_DIR}"

# 4. Clone or copy application code to /opt/slag3d
echo "[+] Deploying application files to ${APP_DIR}..."
mkdir -p "${APP_DIR}"
if [ -f "./package.json" ]; then
  cp -r . "${APP_DIR}/"
fi

cd "${APP_DIR}"

echo "[+] Installing application npm dependencies (including native better-sqlite3)..."
npm install --production=false

echo "[+] Building production frontend assets..."
npm run build

# 5. Create and configure systemd service
SERVICE_FILE="/etc/systemd/system/slag3d.service"
echo "[+] Registering systemd service at ${SERVICE_FILE}..."

cat <<EOF > "${SERVICE_FILE}"
[Unit]
Description=SLAG3D 3D Printer Model Tracking & Asset Grid Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Security hardening
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

echo "[+] Reloading systemd daemon and enabling slag3d.service..."
systemctl daemon-reload
systemctl enable slag3d.service
systemctl restart slag3d.service

echo ""
echo "=========================================================="
echo "  SLAG3D Installation Complete!"
echo "=========================================================="
echo "  Status: systemctl status slag3d.service"
echo "  Logs:   journalctl -u slag3d.service -f"
echo "  URL:    http://$(hostname -I | awk '{print $1}'):3000"
echo "  Default Admin: admin / admin123"
echo "=========================================================="
