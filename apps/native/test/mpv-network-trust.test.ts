/** How the mpv engines trust the server, on both platforms: mpv itself may speak only plain HTTP
 * (to the in-app relay, which checks the server's certificate with the app's own HTTP client),
 * and should it ever be handed an HTTPS address it verifies the certificate instead of mpv's
 * default of trusting it unchecked. Read from the engines' sources, as the options are set there. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const android = read('../android/app/src/main/java/tv/getportico/portico/native/PorticoMpvController.kt');
const apple = read('../Native/PorticoMpvController.swift');
const androidRelay = read('../android/app/src/main/java/tv/getportico/portico/native/PorticoMpvRelay.kt');
const appleRelay = read('../Native/PorticoMpvRelay.swift');

/** Every value an engine gives an mpv option, in either platform's spelling. */
function optionValues(source: string, name: string): string[] {
  const kotlin = [...source.matchAll(new RegExp(`"${name}" to "([^"]*)"`, 'g'))].map(m => m[1]);
  const swift = [...source.matchAll(new RegExp(`\\("${name}", "([^"]*)"\\)`, 'g'))].map(m => m[1]);
  return [...kotlin, ...swift];
}

for (const [platform, source] of [['Android', android], ['Apple', apple]] as const) {
  test(`${platform}: mpv verifies TLS certificates`, () => {
    assert.deepEqual(optionValues(source, 'tls-verify'), ['yes']);
    assert.doesNotMatch(source, /tls-verify", "no"|"tls-verify" to "no"/);
  });

  test(`${platform}: mpv's own network access is plain HTTP to the relay, never TLS`, () => {
    for (const name of ['stream-lavf-o', 'demuxer-lavf-o']) {
      const values = optionValues(source, name);
      assert.equal(values.length, 1, `${name} is set once`);
      const protocols = decodeURIComponent(values[0].replace(/^protocol_whitelist=%\d+%/, '')).split(',');
      assert.deepEqual(protocols.sort(), ['crypto', 'file', 'http', 'tcp']);
      for (const refused of ['https', 'tls', 'rtmps', 'ftp', 'udp']) assert.ok(!protocols.includes(refused), refused);
    }
    assert.match(source, /access-references["]?(?:, | to )"no"/);
  });
}

test('the relays fetch with the app\'s own HTTP clients and refuse redirects', () => {
  assert.match(androidRelay, /OkHttpClient\.Builder\(\)\.followRedirects\(false\)\.followSslRedirects\(false\)/);
  assert.doesNotMatch(androidRelay, /hostnameVerifier|sslSocketFactory|X509TrustManager/, 'no custom trust on Android');
  assert.match(appleRelay, /URLSession/);
  assert.doesNotMatch(appleRelay, /serverTrust|SecTrust|\.useCredential/, 'no custom trust on Apple');
});
