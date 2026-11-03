#!/bin/bash
# Script to initialize Docker secrets for SLAG3D
# Usage: ./scripts/init-secret.sh --type session_secret

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
SECRET_BASE="$ROOT_DIR/secrets"

mkdir -p "$SECRET_BASE"

init_session_secret() {
    echo "Generating secure SESSION_SECRET..."
    # Use openssl to generate a cryptographically secure random string (>= 64 chars)
    local secret
    secret=$(openssl rand -hex 32)  # 64 hex characters = 128 bits
    
    if [[ -z "$secret" ]]; then
        # Fallback: use node crypto module's randomness
        secret=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    fi
    
    # Ensure minimum length
    while [ ${#secret} -lt 64 ]; do
        secret="${secret}$(openssl rand -hex 16)"
    done
    
    echo "$secret" > "$SECRET_BASE/session_secret.txt"
    chmod 600 "$SECRET_BASE/session_secret.txt"  # Owner read/write only
    echo "✓ Created: $SECRET_BASE/session_secret.txt (mode: $(stat -c '%a' "$SECRET_BASE/session_secret.txt"))"
    echo "Secret length: ${#secret} characters"
    echo ""
    echo "⚠️  IMPORTANT: Store this secret securely. Example usage commands:"
    echo "  docker-compose up -d --force-recreate --secret-add 'name=session_secret,file=./secrets/session_secret.txt'"
    echo "  docker service create --secret session_secret ... ( Swarm mode)"
    echo ""
    echo "Or use the environment variable directly (for testing only):"
    echo "export SESSION_SECRET='$secret'"
    echo "docker-compose up -d"
}

# Check if arguments passed
if [[ $# -eq 0 ]]; then
    init_session_secret
elif [[ "$1" == "--help" || "$1" == "-h" ]]; then
    echo "Usage: $0 --type <secret_name>"
    echo ""
    echo "Generate Docker secrets for SLAG3D:"
    echo "  $0                           # Generate session_secret only"
    echo "  $0 --type session_secret      # Alias (same as above)"
    echo ""
    echo "The secret file will be stored in: $SECRET_BASE/session_secret.txt"
    echo "Permissions set to 600 (owner read/write only)"
else
    echo "Unknown option: $1"
    echo "Use '$0' or '$0 --help'"
    exit 1
fi

echo "Done!"
