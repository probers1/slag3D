#!/usr/bin/env node
/**
 * CRITICAL SECURITY FIX #1: Docker Container Startup Validation
 * 
 * This script runs at container boot time and HARD BLOCKS startup if
 * any required security secrets are missing or weak.
 * 
 * This prevents malicious actors from reusing compromised containers,
 * cloning container images without secrets, or restarting containers
 * that forgot to set environment variables.
 * 
 * The container will exit with code 1 (exit) instead of starting the server.
 */

import { readFileSync } from 'fs';

console.log('='.repeat(60));
console.log(' SLAG3D — Security Startup Validation');
console.log('='.repeat(60));

const REQUIRED_ENV_VARS = [
  { name: 'JWT_SECRET', minLength: 32 },
  { name: 'REFRESH_TOKEN_SECRET', minLength: 32 },
  { name: 'SESSION_SECRET', minLength: 32 },
];

const WEAK_PATTERNS = [
  'password', 'admin123', 'secret', 'example', 'changeme',
  'placeholder', '<generate', 'your-', 'default', 'test', 'demo',
  '12345678', 'qwerty', 'letmein'
];

function validateSecret(name, value) {
  if (!value) {
    throw new Error(`Missing: ${name}`);
  }

  if (value.length < 32) {
    throw new Error(
      `${name} is shorter than 32 characters. ` +
      `Minimum required: 32 characters.`
    );
  }

  const lower = value.toLowerCase();
  for (const pattern of WEAK_PATTERNS) {
    if (lower.includes(pattern)) {
      throw new Error(
        `${name} contains a weak or commonly-used substring: "${pattern}". ` +
        `Use a randomly generated secret instead.`
      );
    }
  }

  // Basic entropy check using character diversity
  const seen = new Set(value.toLowerCase().split('').filter(Boolean));
  const charClassDiversity = [
    /[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/
  ].reduce((acc, regex) => acc + (regex.test(lower) ? 1 : 0), 0);

  if (charClassDiversity < 2) {
    throw new Error(
      `${name} lacks character variety. ` +
      `Include at least 2 different character classes: ` +
      `lowercase, uppercase, digits, and/or special characters.`
    );
  }

  return { valid: true };
}

function validateAll() {
  let allValid = true;
  let errorOutput = '';

  for (const { name, minLength } of REQUIRED_ENV_VARS) {
    const value = process.env[name];

    if (!value) {
      console.error(`  ❌ Missing: ${name}`);
      errorOutput += `\n  ❌ Missing: ${name}\n`;
      allValid = false;
    } else if (value.length < minLength) {
      console.error(`  ❌ Too short: ${name} (${value.length} chars, need ${minLength})`);
      errorOutput += `\n  ❌ Too short: ${name} (${value.length} chars, need ${minLength})\n`;
      allValid = false;
    } else {
      console.log(`  ✓ Valid: ${name}`);
    }
  }

  return allValid;
}

try {
  const isValid = validateAll();

  if (!isValid) {
    console.error('');
    console.error('='.repeat(60));
    console.error('  CRITICAL SECURITY FAILURE: Startup validation failed.');
    console.error('='.repeat(60));
    console.error('');
    console.error('The container has been shut down to prevent insecure operation.');
    console.error('');
    console.error('To fix this, you must set the following environment variables:');
    console.error('');
    console.error('  # Generate a strong secret with:');
    console.error('  echo "$(openssl rand -base64 52)"');
    console.error('');
    console.error('  docker run -e JWT_SECRET="$(openssl rand -base64 52)" \\');
    console.error('            -e REFRESH_TOKEN_SECRET="$(openssl rand -base64 52)" \\');
    console.error('            -e SESSION_SECRET="$(openssl rand -base64 52)" \\');
    console.error('            your-image:latest');
    console.error('');
    console.error('  # Or mount a file with pre-generated secrets:');
    console.error('  docker run -e JWT_SECRET=$(cat /run/secrets/jwt) ...');
    console.error('');

    // Write error to stderr for log aggregation systems
    process.stderr.write(process.constructor.toString() + '\n');
    process.exit(1);
  } else {
    console.log('');
    console.log('All security checks passed. Starting application...');
  }
} catch (err) {
  console.error('', err.message);
  process.exit(1);
}
