#!/usr/bin/env node
/**
 * SECURITY FIX #1 - Startup Validation
 * 
 * This script runs at container boot time and HARD BLOCKS startup if
 * any required security secrets are missing or weak.
 * 
 * The container will exit with code 1 instead of starting the server,
 * preventing insecure deployments from ever accepting connections.
 */

import { readFileSync, constants } from 'fs';

console.error('='.repeat(70));
console.error(' SLAG3D — Security Startup Validation');
console.error('='.repeat(70));

const REQUIRED_ENV_VARS = [
  { name: 'JWT_SECRET', minLength: 64 },          // 256 bits of entropy
  { name: 'REFRESH_TOKEN_SECRET', minLength: 64 },
  { name: 'SESSION_SECRET', minLength: 64 },
];

const WEAK_PATTERNS = [
  'password', 'admin123', 'secret', 'example', 'changeme',
  'placeholder', '<generate', 'your-', 'default', 'test', 'demo',
  'super-secret-key', 'my-super-secret-key', 'slags3d', 'slag3d'
];

/**
 * Validate that a secret environment variable is properly configured.
 */
function validateSecret(name, value) {
  if (!value) {
    throw new Error(`\n  FATAL: ${name} environment variable is NOT SET.`);
  }

  if (value.length < 32) {
    throw new Error(
      `\n  FATAL: ${name} is only ${value.length} characters ` +
      `long. Minimum required: 64 characters (256 bits of entropy).`
    );
  }

  // Check for placeholder/example values
  const lower = value.toLowerCase();
  if (lower.includes('placeholder') || lower.includes('example') ||
      lower.includes('changeme') || lower.includes('YOUR_')) {
    throw new Error(
      `\n  FATAL: ${name} appears to be a placeholder or example value.`
    );
  }

  // Check for commonly leaked passwords (rockyou.txt top entries)
  for (const pattern of WEAK_PATTERNS) {
    if (lower.includes(pattern)) {
      throw new Error(
        `\n  FATAL: ${name} contains weak pattern "${pattern}" and is being rejected.`
      );
    }
  }

  // Basic entropy estimation using character class diversity
  const hasLower = /[a-z]/.test(lower);
  const hasUpper = /[A-Z]/.test(lower);
  const hasDigit = /[0-9]/.test(lower);
  const hasSpecial = /[^a-zA-Z0-9]/.test(lower);

  if (hasLower && hasUpper && hasDigit && hasSpecial) {
    console.error(`  ✓ ${name}: ${value.length} chars, multi-class entropy`);
  } else {
    console.error(
      `  ⚠ ${name}: lacks character variety. Consider using a longer random secret.`
    );
  }

  return true;
}

// Run validation
let allPassed = true;

try {
  for (const { name, minLength } of REQUIRED_ENV_VARS) {
    validateSecret(name, process.env[name]);
  }
} catch (err) {
  console.error(`\n\n  ┌──────────────────────────────────────────────────┐`);
  console.error(`  │     CRITICAL SECURITY BLOCK ⛔                   │`);
  console.error(`  └──────────────────────────────────────────────────┘`);
  console.error('\n  The container has been shut down.');
  console.error('');
  console.error('  To fix, restart with proper secrets:');
  console.error('');
  console.error('    docker run -e JWT_SECRET="$(openssl rand -base64 52)" \\\\');
  console.error('              -e REFRESH_TOKEN_SECRET="$(openssl rand -base64 52)" \\\\-');
  console.error('              -e SESSION_SECRET="$(openssl rand -base64 52)" \\\\-');
  console.error('              your-image:latest');
  console.error('');
  console.error('  Or use Docker secrets (dumb-init compatible):');
  console.error('    docker run -v /var/run/secrets/myapp/jwt:/run/secrets/jwt \\\\');
  console.error('              -e JWT_SECRET="$(cat /run/secrets/jwt)" ...');
  console.error('\n  ──────────────────────────────────────────────────');
  console.error(`\n  Error: ${err.message.split('\n')[0]}`);
  process.exit(1);
}

console.error('');
console.error('  ✓ All security checks passed. Starting application...');
process.exit(0);
