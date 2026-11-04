#!/usr/bin/env node
/**
 * Docker container startup validation.
 *
 * Runs before the server starts and hard-blocks startup when required
 * security secrets are missing, too short, or obviously weak. This prevents
 * containers from accepting connections with placeholder credentials.
 */

const REQUIRED_ENV_VARS = [
  { name: 'JWT_SECRET', minLength: 32 },
  { name: 'REFRESH_TOKEN_SECRET', minLength: 32 },
  { name: 'SESSION_SECRET', minLength: 32 },
];

const WEAK_PATTERNS = [
  'password', 'admin123', 'secret', 'example', 'changeme',
  'placeholder', '<generate', 'your-', 'default', 'test', 'demo',
  '12345678', 'qwerty', 'letmein', 'paste-', '-here',
];

function validateSecret(name, value, minLength) {
  if (!value) {
    throw new Error(`Missing: ${name}`);
  }

  if (value.length < minLength) {
    throw new Error(
      `${name} is only ${value.length} characters long. ` +
      `Minimum required: ${minLength} characters.`
    );
  }

  // Angle brackets only appear in the .env.example placeholders, never in
  // output from `openssl rand -base64`.
  if (value.includes('<') || value.includes('>')) {
    throw new Error(`${name} still contains an .env.example placeholder.`);
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

  // Require at least two character classes so trivially predictable values
  // such as long runs of a single character are rejected.
  const charClassDiversity = [
    /[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/,
  ].reduce((acc, regex) => acc + (regex.test(value) ? 1 : 0), 0);

  if (charClassDiversity < 2) {
    throw new Error(
      `${name} lacks character variety. Include at least two of: ` +
      `lowercase, uppercase, digits, special characters.`
    );
  }
}

console.log('='.repeat(60));
console.log(' SLAG3D — Security Startup Validation');
console.log('='.repeat(60));

try {
  for (const { name, minLength } of REQUIRED_ENV_VARS) {
    validateSecret(name, process.env[name], minLength);
    console.log(`  ✓ Valid: ${name}`);
  }
} catch (err) {
  console.error('');
  console.error('='.repeat(60));
  console.error('  CRITICAL SECURITY FAILURE: Startup validation failed.');
  console.error('='.repeat(60));
  console.error('');
  console.error(`  ${err.message}`);
  console.error('');
  console.error('The container has been shut down to prevent insecure operation.');
  console.error('');
  console.error('Generate strong secrets with:');
  console.error('  openssl rand -base64 52');
  console.error('');
  console.error('Then set JWT_SECRET, REFRESH_TOKEN_SECRET and SESSION_SECRET');
  console.error('as environment variables for the container.');
  console.error('');
  process.exit(1);
}

console.log('');
console.log('All security checks passed. Starting application...');
