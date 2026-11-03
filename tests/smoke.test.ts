import { validatePasswordStrength } from '../server/lib/passwordValidation.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
}

console.log('Running smoke tests...');

// Password validation tests
assert(validatePasswordStrength('Short1A') === false, 'Short password should fail');
assert(validatePasswordStrength('longenoughbutnoupper123') === false, 'Missing uppercase should fail');
assert(validatePasswordStrength('LongEnoughButNoNumberABC') === false, 'Missing number should fail');
assert(validatePasswordStrength('ValidPass123') === true, 'Valid password should pass');
assert(validatePasswordStrength('AnotherValid1Password') === true, 'Valid password should pass');

console.log('All smoke tests passed.');
