import {profileAdministrationProofInput, validProfilePIN} from './ProfileManagementModal';

describe('profile management credentials', () => {
  it('uses an exact four-digit value as a primary-profile PIN proof', () => {
    expect(profileAdministrationProofInput(' 2468 ')).toEqual({pin: '2468'});
  });

  it('keeps account passwords distinct from profile PINs', () => {
    expect(profileAdministrationProofInput('TuxIsMyHomeboy!')).toEqual({password: 'TuxIsMyHomeboy!'});
    expect(profileAdministrationProofInput('12345')).toEqual({password: '12345'});
  });

  it('accepts only four numeric digits for a profile PIN', () => {
    expect(validProfilePIN('2468')).toBe(true);
    expect(validProfilePIN('246')).toBe(false);
    expect(validProfilePIN('24a8')).toBe(false);
  });
});
