import test from 'node:test';
import assert from 'node:assert/strict';
import {screenModule} from './helpers/screen-harness.mjs';

const card = {id: 'playlist-1', kind: 'playlist', title: 'Road trip', count: 3, navigation: {view: 'playlist', entityId: 'playlist-1'}};

class FakeSavedService {
  static instances = [];
  route;
  intent;
  disposed = false;
  snapshot = {phase: 'idle', projection: null, playlist: null, error: null};
  constructor(options) {this.options = options; FakeSavedService.instances.push(this);}
  subscribe = () => () => {};
  select = async route => {
    this.route = route;
    this.snapshot = {phase: 'ready', projection: route.view === 'playlists' ? {sections: [{entries: [card]}]} : null,
      playlist: route.view === 'playlist' ? {revision: 7} : null, error: null};
  };
  mutate = async intent => {this.intent = intent;};
  getSnapshot = () => this.snapshot;
  dispose = () => {this.disposed = true;};
}

async function port() {
  const {MusicPlaylistPort} = await screenModule(new URL('../src-next/screens/destinations/music/playlist-port.ts', import.meta.url), {
    react: {default: {}},
    '../../../../../../packages/client-core/src/saved': {default: {}, SavedService: FakeSavedService},
  });
  return new MusicPlaylistPort({api: {request: async () => ({})}, scope: {serverId: 'server', viewerId: 'viewer'},
    current: () => true, requestId: async () => 'request-id'});
}

test('the playlist port lists the profile playlists from the Saved producer', async () => {
  FakeSavedService.instances = [];
  const value = await port();
  await value.load();
  const snapshot = value.getSnapshot();
  assert.equal(snapshot.phase, 'ready');
  assert.deepEqual(snapshot.playlists.map(playlist => playlist.id), ['playlist-1']);
  assert.deepEqual(FakeSavedService.instances[0].route, {view: 'playlists'});
  value.dispose();
});

test('adding to a playlist selects its real revision and uses SavedService add', async () => {
  FakeSavedService.instances = [];
  const value = await port();
  await value.load();
  await value.add('playlist-1', 'album-1');
  const writer = FakeSavedService.instances.at(-1);
  assert.deepEqual(writer.route, {view: 'playlist', playlistId: 'playlist-1'});
  assert.deepEqual(writer.intent, {action: 'add', itemId: 'album-1'});
  assert.equal(writer.disposed, true);
  assert.equal(value.getSnapshot().busy, false);
  value.dispose();
});
