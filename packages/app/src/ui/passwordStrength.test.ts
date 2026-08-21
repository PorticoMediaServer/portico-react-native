import {porticoPasswordStrength, validPorticoPassword} from './passwordStrength';

test('password strength never rejects a baseline-valid medium password', () => {
  expect(validPorticoPassword('Portico8')).toBe(true);
  expect(porticoPasswordStrength('Portico8')).toBe('Medium');
});

test('password strength rewards materially longer varied passphrases', () => {
  expect(porticoPasswordStrength('portico')).toBe('Weak');
  expect(porticoPasswordStrength('Long Portico Passphrase 8!')).toBe('Strong');
});
