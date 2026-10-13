import test from 'node:test';
import assert from 'node:assert/strict';
import {encodedRoutePath, routePath} from '../../../packages/contracts/src/routes.ts';
import {FakePlaybackServer, fakeHttp} from '../../../packages/client-core/src/playback-v1/testing/fake-server.ts';
import {SessionsClient} from '../../../packages/client-core/src/playback-v1/sessions.ts';

test('the shared playback fixture preserves a nested file path without bypassing route validation', async () => {
  const client = new SessionsClient(fakeHttp(new FakePlaybackServer()));
  const session = await client.start({itemId: 'movie-1'}, {state: 'playing'}, 'fixture-route-0000000001');
  const parameters = {grant: 'grant-' + session.id, file: session.presentation.generation + '/master.m3u8'};
  assert.throws(() => encodedRoutePath('get_media_grant_file', parameters), /Invalid encoded route parameter/);
  assert.equal(session.presentation.url, routePath('get_media_grant_file', parameters));
  assert.equal(decodeURIComponent(session.presentation.url.split('/').at(-1)!), parameters.file);
});
