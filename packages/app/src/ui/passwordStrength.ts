import {productMessageText} from '@portico-react-native/infrastructure';

export const porticoPasswordRequirements = [
  {label: productMessageText('auth.password.requirement.minimum-length'), test: (value: string) => value.length >= 8},
  {label: productMessageText('auth.password.requirement.uppercase'), test: (value: string) => /[A-Z]/.test(value)},
  {label: productMessageText('auth.password.requirement.lowercase'), test: (value: string) => /[a-z]/.test(value)},
  {label: productMessageText('auth.password.requirement.number-or-special'), test: (value: string) => /[^A-Za-z]/.test(value)},
] as const;

export type PasswordStrength = 'Weak' | 'Medium' | 'Strong';

export function validPorticoPassword(value: string): boolean {
  return porticoPasswordRequirements.every(requirement => requirement.test(value));
}

export function porticoPasswordStrength(value: string): PasswordStrength {
  if (!validPorticoPassword(value)) return 'Weak';
  const hasNumber = /\d/.test(value);
  const hasSpecial = /[^A-Za-z0-9]/.test(value);
  return value.length >= 16 || (value.length >= 12 && hasNumber && hasSpecial)
    ? 'Strong'
    : 'Medium';
}

export function passwordStrengthLabel(strength: PasswordStrength): string {
  if (strength === 'Strong') return productMessageText('auth.password.strength.strong');
  if (strength === 'Medium') return productMessageText('auth.password.strength.medium');
  return productMessageText('auth.password.strength.weak');
}
