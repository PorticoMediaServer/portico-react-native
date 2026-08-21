import {mobileChromeScope, mobileShellChromePolicy, mobileShellShowsProductChrome} from './shells';

describe('mobile shell chrome ownership', () => {
  test.each([
    {route: 'home', fullBleed: true, ownsChrome: true, description: 'Home shell chrome'},
    {route: 'detail', fullBleed: true, ownsChrome: false, description: 'Detail route-owned chrome'},
    {route: 'player', fullBleed: true, ownsChrome: false, description: 'Player route-owned chrome'},
    {route: 'library', fullBleed: false, ownsChrome: false, description: 'ordinary screen scaffold chrome'},
  ])('$route resolves $description without reserving duplicate content space', ({route, fullBleed, ownsChrome}) => {
    const policy = mobileShellChromePolicy(route);

    expect(policy).toEqual({fullBleed, ownsChrome, reservesContentSpace: false});
    expect(mobileShellShowsProductChrome(policy, true)).toBe(ownsChrome);
  });

  test.each(['channels', 'saved', 'downloads', 'search', 'settings', 'person'])(
    '%s delegates the complete chrome stack to the screen scaffold',
    route => {
      const policy = mobileShellChromePolicy(route);
      expect(policy).toEqual({fullBleed: false, ownsChrome: false, reservesContentSpace: false});
      expect(mobileShellShowsProductChrome(policy, true)).toBe(false);
    },
  );

  test('the account gate suppresses even Home-owned product chrome', () => {
    const homePolicy = mobileShellChromePolicy('home');
    expect(mobileShellShowsProductChrome(homePolicy, false)).toBe(false);
    expect(mobileShellShowsProductChrome(homePolicy, true)).toBe(true);
  });

  test('canonicalizes filter predicates and distinguishes viewer scopes', () => {
    expect(mobileChromeScope('library', 'server-a', 'profile-a', {filters: ['genre:Drama', 'year:2024']}))
      .toBe(mobileChromeScope('library', 'server-a', 'profile-a', {filters: ['year:2024', 'genre:Drama']}));
    expect(mobileChromeScope('library', 'server-a', 'profile-a', {filters: ['genre:Drama']}))
      .not.toBe(mobileChromeScope('library', 'server-a', 'profile-b', {filters: ['genre:Drama']}));
  });
});
