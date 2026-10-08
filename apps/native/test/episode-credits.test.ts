import test from 'node:test';
import assert from 'node:assert/strict';
import {loadEpisodeCast} from '../src/screens/title/episode-credits.ts';

const credit = (i: number) => ({id: `cast-${i}`, name: `Person ${i}`, role: `Role ${i}`, department: 'Acting', provider: 'test'});

test('See all follows every cast cursor in billing order beyond the first 30', async () => {
  const paths: string[] = [];
  const request = async <T>(path: string): Promise<T> => {
    paths.push(path);
    const cursor = new URL(path, 'https://server.test').searchParams.get('cursor');
    const start = cursor ? Number(cursor) : 0;
    const credits = Array.from({length: Math.min(30, 75 - start)}, (_, i) => credit(start + i));
    return {group: 'cast', credits, total: 75, ...(start + credits.length < 75 ? {nextCursor: String(start + credits.length)} : {})} as T;
  };
  const cast = await loadEpisodeCast({request}, 'episode');
  assert.equal(cast.length, 75);
  assert.equal(cast[74]?.id, 'cast-74');
  assert.deepEqual(paths.map(path => new URL(path, 'https://server.test').searchParams.get('cursor')), [null, '30', '60']);
});

test('incomplete cast pagination fails so the first page can remain visible', async () => {
  await assert.rejects(loadEpisodeCast({request: async <T>() => ({group: 'cast', credits: [credit(0)], total: 2} as T)}, 'episode'));
});
