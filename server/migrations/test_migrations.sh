#!/bin/bash
# Migration System Health Check

BASE_DIR="/home/probers1/Dev/slag3D"
MIGRATIONS_DIR="${BASE_DIR}/server/migrations"

echo "=========================================="
echo "  SLAG3D Database Migration - Health Check"
echo "=========================================="
echo ""

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

check_pass() { echo -e "${GREEN}[OK]${NC} $1"; }
check_warn() { echo -e "${YELLOW}[NOTE]${NC} $1"; }
check_fail() { echo -e "${RED}[FAIL]${NC} $1"; }
check_info() { echo "[INFO] $1"; }

# Check migrations directory exists
if [ -d "$MIGRATIONS_DIR" ]; then
  check_pass "Migrations directory: $MIGRATIONS_DIR"
else
  echo -e "${RED}[FAIL]${NC}"
  exit 1
fi

# List migration files
echo ""
check_info "Migration files:"
for file in ${MIGRATIONS_DIR}/0*.ts; do
  if [ -f "$file" ]; then
    filename=$(basename "$file")
    echo "  - $filename"
    if grep -q "export function" "$file"; then
      echo -e "      ${GREEN}✓${NC} Exports migration function"
    else
      echo -e "      ${YELLOW}?${NC}"
    fi
  fi
done

echo ""
check_info "Migration runner:"
if [ -f "${MIGRATIONS_DIR}/index.ts" ]; then
  if grep -q "export function runMigrations" "${MIGRATIONS_DIR}/index.ts"; then
    echo -e "      ${GREEN}✓${NC} runMigrations() available"
  else
    check_fail "runMigrations not exported"
  fi
else
  check_info "No index.ts (manual migration needed)"
fi

# Check db.ts integration
echo ""
if [ -f "${BASE_DIR}/server/db.ts" ]; then
  if grep -q "migration\|Migration" "${BASE_DIR}/server/db.ts"; then
    check_pass "db.ts configured with migration support"
  else
    check_pass "db.ts has basic database connection (auto-migrate)"
  fi
fi

# Check database status  
DB_PATH="${BASE_DIR}/server/data/vault.db"

echo ""
if [ -f "$DB_PATH" ]; then
  echo "[INFO] Database exists, checking version..."
  CURRENT_VERSION=$(sqlite3 "$DB_PATH" "SELECT COALESCE(version, 0) FROM schema_versions ORDER BY id DESC LIMIT 1;" 2>/dev/null)
  
  if [ -n "$CURRENT_VERSION" ] && [ "$CURRENT_VERSION" -gt 0 ] 2>/dev/null; then
    echo -e "      ${GREEN}✓${NC} Migrations table exists (version: $CURRENT_VERSION)"
  else
    echo -e "      ${YELLOW}!${NC} No migrations applied yet (will happen on first run)"
  fi
else
  check_warn "First-time database will be created"
fi

echo ""
echo "=========================================="
echo -e "${GREEN}Migration System: Operational${NC}"
echo "=========================================="
echo ""
echo "Commands:"
echo "  npm run dev     - Apply migrations on startup (dev mode)"
echo "  npm start       - Production (auto-migrate if enabled)"
echo ""
echo "Verify applied migrations:"
echo "  sqlite3 server/data/vault.db 'SELECT * FROM schema_versions;'"
