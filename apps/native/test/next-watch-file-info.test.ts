import test from 'node:test';
import assert from 'node:assert/strict';
import {HttpLocalApi} from '../../../packages/client-core/src/index.ts';
import {defaultI18n} from '../../../packages/i18n/src/index.ts';
import {parseOptions} from '../../../packages/client-core/src/playback-v1/types.ts';
import {readNativeFileInfo} from '../src-next/screens/watch/file-info.ts';

const scope = {serverId: 'server', viewerId: 'viewer'}, target = {libraryId: 'library', itemId: 'movie'};
const file = (id: string, owner = false) => ({id, size: 2147483648, container: 'mkv', duration: 600, available: true,
  ...(owner ? {path: '/private/' + id} : {}), video: {codec: 'hevc', width: 3840, height: 2160, dynamicRange: 'hdr10'}, audio: [{codec: 'truehd', language: 'en', channels: 8}], subtitles: [{codec: 'srt', language: 'en'}]});
const page = (files = [file('v1')], rest = {}) => ({scope: {...scope, ...target, viewerFence: 'fence'}, revision: {catalog: 1, viewer: 2}, kind: 'movie', files, ...rest});
const version = (id: string, parts = [id]) => ({id, durationMs: 600000, sizeBytes: 2147483648, parts: parts.map((id, index) => ({id, index, durationMs: 300000})),
  video: [{id: 'video', codec: 'hevc', profile: 'Main 10', width: 3840, height: 2160, hdr: 'hdr10'}], audio: [{id: 'audio', codec: 'truehd', language: 'en', channels: 8}], subtitles: [{id: 'sub', format: 'srt', language: 'en'}]});
const options = parseOptions({itemId: 'movie', versions: [version('v1'), version('v2')]});
function api(respond: (url: URL) => unknown) {
  const paths: string[] = [];
  return {paths, client: new HttpLocalApi('https://portico.test', '', async input => {
    const url = new URL(String(input)); paths.push(url.pathname + url.search);
    return new Response(JSON.stringify(respond(url)), {status: 200});
  })};
}

test('reads real lazy File info pages and never ordinary details or guessed menu counts', async () => {
  const data = api(url => url.searchParams.has('cursor') ? page([file('v2')]) : page([file('v1')], {nextCursor: 'next'}));
  const {model} = await readNativeFileInfo(data.client, scope, target, options, {t: defaultI18n.t}, false, new AbortController().signal);
  assert.deepEqual(model.files.map(row => row.id), ['v1', 'v2']);
  assert.equal(model.owner, undefined);
  assert.deepEqual(data.paths, ['/v1/items/movie/file-info?limit=37', '/v1/items/movie/file-info?cursor=next&limit=37']);
  assert.ok(model.files[0]!.display.video.some(part => part.text === 'HEVC'));
  assert.ok(model.files[0]!.display.audio[0]!.parts.some(part => part.text === '7.1'));
});

test('only the endpoint owner projection grants the drawn phone/TV paths and actions', async () => {
  const data = api(() => page([file('v1', true)], {manage: {delete: true, split: false, merge: true}}));
  const phone = await readNativeFileInfo(data.client, scope, target, options, {t: defaultI18n.t}, false, new AbortController().signal);
  assert.equal(phone.locations?.[0]?.path, '/private/v1');
  assert.deepEqual(phone.locations?.[0]?.actions.map(action => action.id), ['delete-version']);
  assert.deepEqual(phone.model.owner?.actions.map(action => action.id), ['merge-title']);
  const tv = await readNativeFileInfo(data.client, scope, target, options, {t: defaultI18n.t}, true, new AbortController().signal);
  assert.deepEqual(tv.model.owner?.actions.map(action => action.id), ['merge-title']);
  assert.deepEqual(tv.locations?.[0]?.actions.map(action => action.id), ['delete-version']);
});

test('rejects changed revision/permissions, duplicate file IDs and looping cursors across pages', async () => {
  for (const second of [page([file('v2')], {revision: {catalog: 2, viewer: 2}}), page([file('v2')], {manage: {delete: false, split: false, merge: false}}), page([file('v1')]), page([file('v2')], {nextCursor: 'next'})]) {
    const data = api(url => url.searchParams.has('cursor') ? second : page([file('v1')], {nextCursor: 'next'}));
    await assert.rejects(readNativeFileInfo(data.client, scope, target, options, {t: defaultI18n.t}, false, new AbortController().signal));
  }
});

test('three physical files in two authoritative groups stay two versions; unavailable/unmatched rows stay absent', async () => {
  const data = api(() => page([file('v1', true), file('part2', true), file('v2', true), file('unmatched', true), {...file('gone', true), available: false}], {manage: {delete: true, split: true, merge: false}}));
  const offered = parseOptions({itemId: 'movie', versions: [version('v1', ['v1', 'part2']), version('v2'), version('gone')]});
  const info = await readNativeFileInfo(data.client, scope, target, offered, {t: defaultI18n.t}, false, new AbortController().signal);
  assert.deepEqual(info.model.files.map(row => row.id), ['v1', 'v2']);
  assert.deepEqual(info.groups.map(group => group.members.map(member => member.id)), [['v1', 'part2'], ['v2']]);
  assert.deepEqual(info.locations?.map(location => [location.id, location.versionId]), [['v1', 'v1'], ['part2', 'v1'], ['v2', 'v2']]);
  assert.ok(info.model.files[0]!.display.video.some(part => part.text === 'Main 10'));
});

test('ambiguous member identity and a wrong options target fail closed', async () => {
  const data = api(() => page());
  for (const offered of [parseOptions({itemId: 'other', versions: [version('v1')]}), parseOptions({itemId: 'movie', versions: [version('v1'), version('v2', ['v1'])]})]) {
    await assert.rejects(readNativeFileInfo(data.client, scope, target, offered, {t: defaultI18n.t}, false, new AbortController().signal));
  }
});
