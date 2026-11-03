/**
 * Validates password strength: minimum 12 characters, at least one uppercase letter, and at least one number.
 */
export function validatePasswordStrength(password: string): boolean {
  if (password.length < 12) {
    return false;
  }
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  return hasUppercase && hasNumber;
}
