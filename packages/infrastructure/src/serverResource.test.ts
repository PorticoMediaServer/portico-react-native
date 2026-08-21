import {
  rotatePrivateArtworkCacheKey,
  serverImageSource,
} from './serverResource';
import {
  beginServerSessionEnvironment,
  setServerSession,
} from './clientEnvironment';
import type {ViewerScope} from '@porticomediaserver/client-core';

const viewerScope: ViewerScope = {
  accountId: 'account-one',
  authority: 'hosted',
  authorizationRevision: 'authorization-a',
  profileId: 'profile-a',
  serverId: 'server-one',
};

const porticoSession = {
  apiBaseUrl: 'https://server.example:32500',
  accessToken: 'portico-server-token',
  ...viewerScope,
};

let environmentStage: ReturnType<typeof beginServerSessionEnvironment>;

function activateSession(session: typeof porticoSession): void {
  environmentStage?.failClosed();
  setServerSession(session);
  environmentStage = beginServerSessionEnvironment();
  environmentStage.activate(session);
}

beforeEach(() => activateSession(porticoSession));
afterEach(() => {
  environmentStage?.failClosed();
  setServerSession(undefined);
});

describe('serverImageSource', () => {
  it('adds the server-scoped bearer credential to same-origin API artwork', () => {
    const source = serverImageSource(
      'https://server.example:32500/api/artwork/media-1/poster.jpg?width=780',
      porticoSession,
    );
    expect(source?.headers).toEqual({Authorization: 'Bearer portico-server-token'});
    const url = new URL(source?.uri ?? '') as URL & {
      pathname: string;
      searchParams: {get(name: string): string | null};
    };
    expect(url.pathname).toBe('/api/artwork/media-1/poster.jpg');
    expect(url.searchParams.get('width')).toBe('780');
    expect(url.searchParams.get('__portico_viewer')).toMatch(/^v\d+-[0-9a-f]+$/);
    expect(source?.uri).not.toContain('account-one');
  });

  it('supports Local Auth credentials for same-origin API artwork', () => {
    const localSession = {
      apiBaseUrl: 'https://server.example:32500',
      accessToken: 'local-session-token',
      accountId: 'local-account',
      authority: 'local' as const,
      authorizationRevision: 'local-revision',
      profileId: 'local-profile',
      serverId: 'server.example',
    };
    activateSession(localSession as typeof porticoSession);
    const source = serverImageSource('/api/artwork/media-1/poster.jpg', localSession);
    expect(source?.headers).toEqual({Authorization: 'Bearer local-session-token'});
    expect(source?.uri).toContain('/api/artwork/media-1/poster.jpg?__portico_viewer=');
  });

  it('rekeys the same private artwork for a new credential generation', () => {
    const first = serverImageSource('/api/artwork/media-1/poster.jpg', porticoSession);
    rotatePrivateArtworkCacheKey();
    activateSession({...porticoSession, accessToken: 'rotated-token'});
    const second = serverImageSource('/api/artwork/media-1/poster.jpg', {
      ...porticoSession,
      accessToken: 'rotated-token',
    });
    expect(first?.uri).not.toBe(second?.uri);
    expect(second?.headers).toEqual({Authorization: 'Bearer rotated-token'});
  });

  it('fails closed instead of returning an unscoped private URL', () => {
    expect(serverImageSource('/api/artwork/media-1/poster.jpg', {
      apiBaseUrl: porticoSession.apiBaseUrl,
      accessToken: porticoSession.accessToken,
    })).toBeUndefined();
    expect(serverImageSource('/api/artwork/media-1/poster.jpg', {})).toBeUndefined();
  });

  it('resolves relative public server resources without leaking credentials', () => {
    expect(serverImageSource('/public/channel-logo.png', porticoSession)).toEqual({
      uri: 'https://server.example:32500/public/channel-logo.png',
    });
  });

  it('never forwards a server credential to external artwork', () => {
    expect(serverImageSource('https://image.tmdb.org/t/p/w780/poster.jpg', porticoSession)).toEqual({
      uri: 'https://image.tmdb.org/t/p/w780/poster.jpg',
    });
  });

  it('does not forward credentials to a deceptive host or non-API route', () => {
    expect(serverImageSource('https://server.example.attacker.test/api/artwork/poster.jpg', porticoSession)).toEqual({
      uri: 'https://server.example.attacker.test/api/artwork/poster.jpg',
    });
    expect(serverImageSource('https://server.example:32500/public/poster.jpg', porticoSession)).toEqual({
      uri: 'https://server.example:32500/public/poster.jpg',
    });
  });

  it('returns undefined for an absent resource', () => {
    expect(serverImageSource(undefined, porticoSession)).toBeUndefined();
  });
});
