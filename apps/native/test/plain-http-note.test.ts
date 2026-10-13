/**
 * The quiet plain-HTTP line on sign-in: the server decides, the app never guesses from an
 * address, and any failure to find out means no line.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {addressSaysPlainHttp, serverSaysPlainHttp} from '../src/app/plain-http-note.ts';

type Answer = {secure: boolean; remote: boolean; plainHttpOutsideHome: boolean; clientAddress?: string; accessUrls?: string[]};

/** A network where only the listed origins answer `/v1/networking/connection`. */
function network(answers: Record<string, Answer | 'garbage' | 404>) {
  const asked: string[] = [];
  const fetcher = (async (input: unknown) => {
    const url = new URL(String(input));
    asked.push(url.origin + url.pathname);
    const answer = answers[url.origin];
    if (answer === undefined) throw new TypeError('Network request failed');
    if (answer === 404) return new Response(JSON.stringify({error: {code: 'not_found', message: 'no'}}), {status: 404, headers: {'Content-Type': 'application/json'}});
    return new Response(answer === 'garbage' ? '<html>' : JSON.stringify({clientAddress: '203.0.113.7', accessUrls: [], ...answer}), {status: 200, headers: {'Content-Type': 'application/json'}});
  }) as typeof fetch;
  return {asked, fetcher};
}

test('a server reached over plain HTTP from outside its home networks says so', async () => {
  const {asked, fetcher} = network({'http://203.0.113.9:32500': {secure: false, remote: true, plainHttpOutsideHome: true}});
  assert.equal(await addressSaysPlainHttp('203.0.113.9', fetcher), true);
  assert.deepEqual(asked, ['https://203.0.113.9/v1/networking/connection', 'https://203.0.113.9:32500/v1/networking/connection', 'http://203.0.113.9:32500/v1/networking/connection'], 'asked in the order a sign-in tries, and nothing else');
});

test('at home, or over HTTPS, there is nothing to say', async () => {
  assert.equal(await addressSaysPlainHttp('192.168.1.20', network({'http://192.168.1.20:32500': {secure: false, remote: false, plainHttpOutsideHome: false}}).fetcher), false);
  assert.equal(await addressSaysPlainHttp('media.example.com', network({'https://media.example.com': {secure: true, remote: true, plainHttpOutsideHome: false}}).fetcher), false);
  // A secure address that answers first decides, even when a plain one would also answer.
  assert.equal(await addressSaysPlainHttp('media.example.com', network({'https://media.example.com': {secure: true, remote: true, plainHttpOutsideHome: false}, 'http://media.example.com:32500': {secure: false, remote: true, plainHttpOutsideHome: true}}).fetcher), false);
});

test('not finding out means no line: nothing answers, an older server, an unreadable answer, not an address', async () => {
  assert.equal(await addressSaysPlainHttp('203.0.113.9', network({}).fetcher), false);
  assert.equal(await addressSaysPlainHttp('http://203.0.113.9:32500', network({'http://203.0.113.9:32500': 404}).fetcher), false);
  assert.equal(await addressSaysPlainHttp('http://203.0.113.9:32500', network({'http://203.0.113.9:32500': 'garbage'}).fetcher), false);
  const none = network({});
  assert.equal(await addressSaysPlainHttp('not an address', none.fetcher), false);
  assert.equal(await addressSaysPlainHttp('', none.fetcher), false);
  assert.deepEqual(none.asked, [], 'something that cannot be an address is never contacted');
});

test('a cancelled question is dropped', async () => {
  const abort = new AbortController();
  abort.abort();
  const {fetcher} = network({'http://203.0.113.9:32500': {secure: false, remote: true, plainHttpOutsideHome: true}});
  assert.equal(await addressSaysPlainHttp('http://203.0.113.9:32500', fetcher, abort.signal), false);
});

test('a server already being talked to is asked directly', async () => {
  assert.equal(await serverSaysPlainHttp({connection: async () => ({secure: false, remote: true, plainHttpOutsideHome: true, clientAddress: '203.0.113.7', accessUrls: []})}), true);
  assert.equal(await serverSaysPlainHttp({connection: async () => ({secure: true, remote: true, plainHttpOutsideHome: false, clientAddress: '203.0.113.7', accessUrls: []})}), false);
  assert.equal(await serverSaysPlainHttp({connection: async () => { throw new Error('older server'); }}), false);
});
