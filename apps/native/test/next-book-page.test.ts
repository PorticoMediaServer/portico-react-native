import test from 'node:test';
import assert from 'node:assert/strict';
import {screenModule} from './helpers/screen-harness.mjs';

const entity = {id: 'book-1', libraryId: 'books', kind: 'book', title: 'The Martian', author: 'Andy Weir', narrators: ['R. C. Bray'],
  duration: 39200, count: 17, overview: 'A stranded astronaut.', bookProgress: {bookId: 'book-1', itemId: 'file-1', partPositionMs: 530000,
    positionMs: 530000, durationMs: 1000000, remainingMs: 470000, chapter: {index: 6, title: 'Chapter 6', startMs: 500000, endMs: 560000}}};
const chapters = [
  {id: 'file-1:1', libraryId: 'books', kind: 'chapter', title: 'Chapter 1', duration: 100, playback: {itemId: 'file-1', startSeconds: 0}},
  {id: 'file-1:6', libraryId: 'books', kind: 'chapter', title: 'Chapter 6', duration: 100, playback: {itemId: 'file-1', startSeconds: 500}},
];
const listening = {target: {kind: 'book', id: 'book-1'}, actions: ['play', 'enqueue'], resume: {itemId: 'file-1', positionSeconds: 530}, resumeUnavailable: false};

class FakeLibraryContentService {
  static page: any;
  select = async (_route: any) => {};
  subscribe = () => () => {};
  getSnapshot = () => FakeLibraryContentService.page;
  dispose = () => {};
}

async function controller(overrides: any = {}) {
  const starts: any[] = [], writes: any[] = [];
  FakeLibraryContentService.page = {phase: 'ready', error: null, sections: [{id: 'chapters', entries: chapters}, {id: 'files', entries: []}],
    projection: {entity, sections: [{id: 'chapters', entries: chapters}], listening}};
  const {NativeAudiobookController} = await screenModule(new URL('../src-next/screens/destinations/audiobooks/model.ts', import.meta.url), {
    react: {default: {}},
    '../../../shell/bootstrap': {default: {}},
    '../lifetime': {default: {}, nativeDestinationLifetime: () => ({scope: {serverId: 'server', viewerId: 'viewer'}, current: () => true})},
    '../../../../../../packages/client-core/src/library-content': {default: {}, LibraryContentService: FakeLibraryContentService},
    '../../../../../../packages/client-core/src/container-state': {default: {},
      getContainerState: async () => ({revision: 4, watched: false}),
      setContainerState: async (_api: any, _kind: any, _id: any, input: any) => {writes.push(input); return {revision: 5, watched: input.watched};}},
  });
  const context = {api: {}, playback: {start: async (input: any) => {starts.push(input);}}};
  const value = new NativeAudiobookController({context, kind: 'book', libraryId: 'books', id: 'book-1', ...overrides});
  return {value, starts, writes};
}

test('the book page reads the real catalog entity and chapters', async () => {
  const {value} = await controller();
  await value.load();
  const state = value.getSnapshot();
  assert.equal(state.phase, 'ready');
  assert.equal(state.entity?.title, 'The Martian');
  assert.equal(state.entity?.narrators?.[0], 'R. C. Bray');
  assert.equal(state.sections.find((section: any) => section.id === 'chapters')?.entries.length, 2);
  assert.equal(state.listening?.resume?.positionSeconds, 530);
  value.dispose();
});

test('resume starts the chapter at the real server position', async () => {
  const {value, starts} = await controller();
  await value.load();
  await value.resume();
  assert.equal(starts.length, 1);
  assert.equal(starts[0].entry.id, 'file-1:6');
  assert.deepEqual(starts[0].target, {itemId: 'file-1', startSeconds: 530});
  value.dispose();
});

test('start over starts the first real chapter at zero', async () => {
  const {value, starts} = await controller();
  await value.load();
  await value.startOver();
  assert.equal(starts[0].entry.id, 'file-1:1');
  assert.deepEqual(starts[0].target, {itemId: 'file-1', startSeconds: 0});
  value.dispose();
});

test('mark finished writes the real book container revision', async () => {
  const {value, writes} = await controller();
  await value.load();
  await value.markFinished();
  assert.deepEqual(writes, [{expectedRevision: 4, watched: true}]);
  assert.equal(value.getSnapshot().finished, true);
  value.dispose();
});
