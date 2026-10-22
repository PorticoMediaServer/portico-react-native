import test from 'node:test';
import assert from 'node:assert/strict';
import type {Webhook, WebhookDelivery} from '../../../packages/client-core/src/api-access.ts';
import type {Alert, Job} from '../../../packages/client-core/src/console.ts';
import type {MetadataSettings} from '../../../packages/client-core/src/metadata-settings.ts';
import {SPLITTABLE_KINDS} from '../../../packages/client-core/src/title-identity.ts';
import {attentionChoices, channelMapBatches, channelOverride, credentialRequest, fileTools, keyChange, mergeDeliveries, mergeOrder, mergeSearchGroup, metadataSave, parseChannelMapPage, subtitleChanges, ratingChoices, recentProblems, saveChannelMap, typedClock, unsavedChannelEdits, webhookChange, webhookDraft, webhookDraftProblem, withChoice, withEvents, workInProgress, type ChannelOverride} from '../src/screens/server/owner-rules.ts';

// ── Keys and tokens ──

test('a key needs a name and something it may do', () => {
  const form = {name: ' Home Assistant ', ticked: new Set(['read', 'playback'] as const), offered: ['read', 'playback', 'library', 'admin'] as const, days: 0 as const, firstSentAt: 0};
  assert.deepEqual(credentialRequest(form), {name: 'Home Assistant', scopes: ['read', 'playback']});
  assert.equal(credentialRequest({...form, name: '  '}), undefined);
  assert.equal(credentialRequest({...form, ticked: new Set()}), undefined);
});

test('"Everything" stands alone, and a scope this server does not offer is never sent', () => {
  const offered = ['read', 'playback', 'library', 'admin'] as const;
  assert.deepEqual(credentialRequest({name: 'x', ticked: new Set(['read', 'admin'] as const), offered, days: 0, firstSentAt: 0})?.scopes, ['admin']);
  assert.deepEqual(credentialRequest({name: 'x', ticked: new Set(['read', 'library'] as const), offered: ['read'], days: 0, firstSentAt: 0})?.scopes, ['read']);
  assert.equal(credentialRequest({name: 'x', ticked: new Set(['admin'] as const), offered: ['read'], days: 0, firstSentAt: 0}), undefined);
});

test('the expiry is counted from when the form was first sent, so a retry asks for the same key', () => {
  const at = Date.UTC(2026, 9, 14, 12);
  const form = {name: 'x', ticked: new Set(['read'] as const), offered: ['read'] as const, days: 30 as const, firstSentAt: at};
  assert.equal(credentialRequest(form)?.expiresAt, new Date(at + 30 * 86_400_000).toISOString());
  assert.deepEqual(credentialRequest(form), credentialRequest({...form}));
  assert.equal('expiresAt' in credentialRequest({...form, days: 0})!, false);
});

// ── Webhooks ──

const hook: Webhook = {id: 'w1', name: 'Chat', url: 'https://example.com/hook', events: ['title.added', 'scan.finished'], enabled: true, secretHint: 'ab12', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', waiting: 0, failing: 0, dropped: 0, revision: 1};

test('a webhook cannot be saved without a name, a usable address and an event', () => {
  const draft = webhookDraft(hook);
  assert.equal(webhookDraftProblem(draft), undefined);
  assert.equal(webhookDraftProblem({...draft, name: ' '}), 'name');
  assert.equal(webhookDraftProblem({...draft, url: ''}), 'address');
  assert.equal(webhookDraftProblem({...draft, url: 'ftp://example.com'}), 'addressInvalid');
  assert.equal(webhookDraftProblem({...draft, url: 'https://me:secret@example.com/hook'}), 'addressInvalid');
  assert.equal(webhookDraftProblem({...draft, events: []}), 'events');
  // A new webhook starts on, with nothing chosen.
  assert.deepEqual(webhookDraft(), {name: '', url: '', events: [], enabled: true, secret: ''});
});

test('an edit sends only what changed, and nothing when nothing did', () => {
  const draft = webhookDraft(hook);
  assert.equal(webhookChange(hook, draft), undefined);
  assert.equal(webhookChange(hook, {...draft, events: ['scan.finished', 'title.added']}), undefined);
  assert.deepEqual(webhookChange(hook, {...draft, enabled: false}), {enabled: false});
  assert.deepEqual(webhookChange(hook, {...draft, name: ' Chat room ', events: ['title.added']}), {name: 'Chat room', events: ['title.added']});
  // An edit never carries a secret: replacing it is its own action.
  assert.equal('secret' in (webhookChange(hook, {...draft, url: 'https://example.com/other', secret: 'typed'}) ?? {}), false);
});

test('choosing a whole group of events keeps each once, in the order chosen', () => {
  assert.deepEqual(withEvents(['scan.started'], ['title.added', 'scan.started'], true), ['scan.started', 'title.added']);
  assert.deepEqual(withEvents(['scan.started', 'title.added', 'title.removed'], ['title.added', 'title.removed'], false), ['scan.started']);
});

test('the delivery log keeps older pages under a first page that is read again', () => {
  const d = (id: string, state: WebhookDelivery['state'] = 'delivered'): WebhookDelivery => ({id, event: 'title.added', state, attempts: 1, createdAt: '2026-10-14T00:00:00Z', status: 200, durationMs: 5});
  const shown = [d('3', 'pending'), d('2'), d('1')];
  assert.deepEqual(mergeDeliveries(shown, [d('4'), d('3'), d('2')], false).map(x => `${x.id}:${x.state}`), ['4:delivered', '3:delivered', '2:delivered', '1:delivered']);
  assert.deepEqual(mergeDeliveries(shown, [d('1'), d('0')], true).map(x => x.id), ['3', '2', '1', '0']);
  assert.deepEqual(mergeDeliveries(undefined, [d('1')], false).map(x => x.id), ['1']);
});

// ── People ──

const systems = [{id: 'mpaa', name: 'MPA', region: 'US', screens: [], values: [{code: 'G', label: 'G', minimumAge: 0}, {code: 'PG-13', label: 'PG-13', minimumAge: 13}]}];

test('where the server has rating systems, a rating is chosen in one', () => {
  const chosen = ratingChoices({ratingSystem: 'mpaa', maxContentRating: 'PG-13'}, systems);
  assert.equal(chosen.system?.id, 'mpaa');
  assert.deepEqual(chosen.ratings.map(r => r.code), ['G', 'PG-13']);
  assert.equal(chosen.ratings[1]!.minimumAge, 13);
  // No system chosen yet: there is nothing to pick a rating from.
  assert.deepEqual(ratingChoices({ratingSystem: '', maxContentRating: ''}, systems), {open: false, ratings: []});
});

test('a limit saved before systems existed stays as it is until changed, and a server without systems offers the plain list', () => {
  const plain = ratingChoices({ratingSystem: '', maxContentRating: 'TV-14'}, systems);
  assert.equal(plain.open, true);
  assert.ok(plain.ratings.some(r => r.code === 'TV-14'));
  assert.equal(ratingChoices({ratingSystem: '', maxContentRating: ''}, []).open, true);
});

test('the rating in force is always among the choices, so opening the page never changes it', () => {
  const kept = ratingChoices({ratingSystem: 'mpaa', maxContentRating: 'NC-17'}, systems);
  assert.deepEqual(kept.ratings.map(r => r.code), ['G', 'PG-13', 'NC-17']);
  // A system the server no longer publishes: the saved rating is still shown.
  assert.deepEqual(ratingChoices({ratingSystem: 'gone', maxContentRating: '15'}, systems).ratings.map(r => r.code), ['15']);
});

test('a time of day is read as people type it, and nothing else is', () => {
  assert.equal(typedClock('8'), 480);
  assert.equal(typedClock('08:30'), 510);
  assert.equal(typedClock(' 20.15 '), 1215);
  assert.equal(typedClock('2330'), 1410);
  assert.equal(typedClock('0:00'), 0);
  for (const bad of ['', '24:00', '12:60', 'noon', '8pm', '1:2:3', '-1']) assert.equal(typedClock(bad), undefined, bad);
});

// ── Metadata ──

const settings: MetadataSettings = {revision: 4, localArtworkLimitBytes: 10 * 2 ** 30, localArtworkUsedBytes: 1, includeAdult: false, tmdbCredentialConfigured: true, tvdbCredentialConfigured: false, openSubtitlesKeyConfigured: false, openSubtitlesUsername: 'sam', openSubtitlesPasswordConfigured: true,
  openSubtitles: {keySource: 'none', accountSource: 'owner', account: 'not_checked', problem: '', checkedAt: '', retryAt: '', downloadsRemaining: 0, downloadsAllowed: 0, downloadsResetAt: ''}};

test('the subtitle provider’s key and account are sent only as edited', () => {
  const base = {limitBytes: settings.localArtworkLimitBytes, includeAdult: false, tmdb: {typed: '', remove: false}, tvdb: {typed: '', remove: false}};
  // Untouched: nothing about the subtitle provider is sent.
  assert.deepEqual(metadataSave(settings, {...base, subtitles: {key: {typed: '', remove: false}, username: 'sam', password: ''}}), {expectedRevision: 4, localArtworkLimitBytes: settings.localArtworkLimitBytes, includeAdult: false});
  // A new key, another account with its password.
  assert.deepEqual(metadataSave(settings, {...base, subtitles: {key: {typed: 'k1', remove: false}, username: ' alex ', password: 'pw'}}), {expectedRevision: 4, localArtworkLimitBytes: settings.localArtworkLimitBytes, includeAdult: false, openSubtitlesApiKey: 'k1', openSubtitlesUsername: 'alex', openSubtitlesPassword: 'pw'});
  // Removing the account sends an empty name.
  assert.deepEqual(subtitleChanges(settings, {key: {typed: '', remove: false}, username: '', password: ''}), {openSubtitlesUsername: ''});
});

test('a provider key is left alone, replaced or removed', () => {
  assert.equal(keyChange({typed: '', remove: false}), undefined);
  assert.equal(keyChange({typed: ' abc ', remove: false}), 'abc');
  assert.equal(keyChange({typed: 'abc', remove: true}), '');
});

test('saving metadata settings sends the keys only when they were edited', () => {
  const draft = {limitBytes: 20 * 2 ** 30, includeAdult: false, tmdb: {typed: '', remove: true}, tvdb: {typed: '', remove: false}};
  assert.deepEqual(metadataSave(settings, draft), {expectedRevision: 4, localArtworkLimitBytes: 20 * 2 ** 30, includeAdult: false, tmdbReadToken: ''});
});

test('settings that moved on the server: what was not changed here takes the server’s value', () => {
  const draft = {limitBytes: 20 * 2 ** 30, includeAdult: false, tmdb: {typed: '', remove: false}, tvdb: {typed: 'k', remove: false}};
  const now = {...settings, revision: 5, includeAdult: true};
  assert.deepEqual(metadataSave(settings, draft, now), {expectedRevision: 5, localArtworkLimitBytes: 20 * 2 ** 30, includeAdult: true, tvdbProjectKey: 'k'});
});

test('the same setting changed here and, differently, on the server is the one real conflict', () => {
  const draft = {limitBytes: 20 * 2 ** 30, includeAdult: false, tmdb: {typed: '', remove: false}, tvdb: {typed: '', remove: false}};
  assert.equal(metadataSave(settings, draft, {...settings, revision: 5, localArtworkLimitBytes: 30 * 2 ** 30}), 'conflict');
  // Changed to the same value on both sides is no conflict.
  assert.notEqual(metadataSave(settings, draft, {...settings, revision: 5, localArtworkLimitBytes: 20 * 2 ** 30}), 'conflict');
});

test('a title that needs attention offers only what the server named for it', () => {
  assert.deepEqual(attentionChoices({actions: ['accept', 'search', 'id', 'dismiss'], parentId: ''}), ['search', 'id', 'dismiss']);
  assert.deepEqual(attentionChoices({actions: ['parent'], parentId: 'show1'}), ['parent']);
  // "Open the show" needs a show to open.
  assert.deepEqual(attentionChoices({actions: ['parent', 'dismiss'], parentId: ''}), ['dismiss']);
  assert.deepEqual(attentionChoices({actions: [], parentId: 'show1'}), []);
});

// ── Live TV ──

test('a channel that cannot be read is left out of the mapping list alone', () => {
  const page = parseChannelMapPage({items: [{channelId: 'a', name: 'One', sourceNumber: '1', number: '1', group: 'News', guideChannelId: '', hidden: false, overridden: false}, {channelId: '', name: 'bad'}, null, {channelId: 'b', name: 'Two', hidden: true, overridden: true, number: '22'}], nextCursor: 'next'});
  assert.deepEqual(page.items.map(c => c.channelId), ['a', 'b']);
  assert.deepEqual(page.items[1], {channelId: 'b', name: 'Two', sourceNumber: '', number: '22', group: '', guideChannelId: '', hidden: true, overridden: true});
  assert.equal(page.nextCursor, 'next');
  assert.throws(() => parseChannelMapPage({items: 'no'}));
  assert.equal(parseChannelMapPage({items: [], nextCursor: 7}).nextCursor, '');
});

test('the mapping shows a number only when it was set here, and the owner’s edit over what is saved', () => {
  const sent = {channelId: 'a', name: 'One', sourceNumber: '1', number: '1', group: '', guideChannelId: 'one.tv', hidden: false, overridden: false};
  assert.deepEqual(channelOverride(sent, {}), {number: '', guideChannelId: 'one.tv', hidden: false});
  assert.deepEqual(channelOverride({...sent, number: '101', overridden: true}, {}), {number: '101', guideChannelId: 'one.tv', hidden: false});
  const edit = {number: '7', guideChannelId: '', hidden: true};
  assert.equal(channelOverride(sent, {a: edit}), edit);
});

const manyEdits = (n: number): Record<string, ChannelOverride> => Object.fromEntries(Array.from({length: n}, (_, i) => [`c${i}`, {number: ` ${i} `, guideChannelId: '', hidden: false}]));

test('channel changes go in batches the server accepts, trimmed', () => {
  const batches = channelMapBatches(manyEdits(450));
  assert.deepEqual(batches.map(b => b.length), [200, 200, 50]);
  assert.deepEqual(batches[0]![1], {channelId: 'c1', number: '1', guideChannelId: '', hidden: false});
});

test('batches are saved one after another, each against the revision the last one left', async () => {
  const seen: number[] = [];
  const out = await saveChannelMap(manyEdits(450), {revision: async () => 9, put: async revision => { seen.push(revision); }});
  assert.deepEqual(seen, [9, 10, 11]);
  assert.deepEqual(out, {saved: 450, total: 450});
});

test('a batch the server calls out of date is sent again against the source as it is now, silently', async () => {
  const seen: number[] = [];
  let revision = 9, refused = false;
  const out = await saveChannelMap(manyEdits(250), {
    revision: async () => revision,
    put: async at => { seen.push(at); if (seen.length === 2 && !refused) { refused = true; revision = 40; throw Object.assign(new Error('moved'), {code: 'revision_mismatch', status: 412}); } },
  });
  assert.deepEqual(seen, [9, 10, 40]);
  assert.deepEqual(out, {saved: 250, total: 250});
});

test('a refused batch stops the save and says how far it got; the rest stay to be saved again', async () => {
  const edits = manyEdits(450);
  const failure = Object.assign(new Error('no'), {code: 'validation_failed', status: 422});
  let calls = 0;
  const out = await saveChannelMap(edits, {revision: async () => 1, put: async () => { if (++calls === 2) throw failure; }});
  assert.equal(out.saved, 200);
  assert.equal(out.total, 450);
  assert.equal(out.error, failure);
  const left = unsavedChannelEdits(edits, out.saved);
  assert.equal(Object.keys(left).length, 250);
  assert.equal(Object.keys(left)[0], 'c200');
});

test('a revision that cannot be read saves nothing', async () => {
  const out = await saveChannelMap(manyEdits(3), {revision: async () => { throw new Error('offline'); }, put: async () => { assert.fail('nothing is sent'); }});
  assert.equal(out.saved, 0);
  assert.ok(out.error);
});

test('choosing a group or channel keeps each once', () => {
  assert.deepEqual(withChoice(['a', 'b'], 'a', true), ['b', 'a']);
  assert.deepEqual(withChoice(['a', 'b'], 'b', false), ['a']);
  assert.deepEqual(withChoice([], 'x', false), []);
});

// ── A title's files ──

test('a version can be split off only where the server can split, the file is on disk, and another version stays behind', () => {
  assert.deepEqual(fileTools({kind: 'movie'}, {available: true}, 2, SPLITTABLE_KINDS), ['split', 'delete']);
  assert.deepEqual(fileTools({kind: 'movie'}, {available: true}, 1, SPLITTABLE_KINDS), ['delete']);
  assert.deepEqual(fileTools({kind: 'movie'}, {available: false}, 2, SPLITTABLE_KINDS), ['delete']);
  // An episode is placed by show, season and number: splitting is never offered for one.
  assert.deepEqual(fileTools({kind: 'episode'}, {available: true}, 3, SPLITTABLE_KINDS), ['delete']);
});

test('the other title of a merge is looked for among titles of the same kind', () => {
  assert.equal(mergeSearchGroup('movie'), 'movies');
  assert.equal(mergeSearchGroup('show'), 'shows');
  assert.equal(mergeSearchGroup('episode'), 'episodes');
  assert.equal(mergeSearchGroup('song'), 'songs');
  assert.equal(mergeSearchGroup('album'), 'albums');
  assert.equal(mergeSearchGroup('artist'), 'artists');
  assert.equal(mergeSearchGroup('book'), 'books');
  assert.equal(mergeSearchGroup('collection'), undefined);
});

test('the title that is kept stays; the other goes into it', () => {
  const a = {id: 'a'}, b = {id: 'b'};
  assert.deepEqual(mergeOrder(a, b, 'a'), {from: b, into: a});
  assert.deepEqual(mergeOrder(a, b, 'b'), {from: a, into: b});
});

// ── The television Dashboard ──

const job = (id: string, state: Job['state'], updatedAt: number, kind = 'library_scan'): Job => ({id, kind, resource: 'Movies', trigger: 'manual', state, phase: '', revision: 1, attempt: 1, createdAt: updatedAt - 1000, updatedAt, nextAt: 0, settingsRevision: 1, lane: 'scan', actions: ['cancel']});
const alert = (id: string, status: string, lastAt: number): Alert => ({id, code: 'low_storage', severity: 'warning', status, firstAt: lastAt - 5000, lastAt, occurrences: 1, revision: 1});

test('background work in progress: what is running first, then what waits; finished and failed work is not shown', () => {
  const jobs = [job('done', 'succeeded', 50), job('wait', 'queued', 40), job('run-old', 'running', 10), job('fail', 'failed', 60), job('run-new', 'running', 30), job('held', 'paused', 20), job('gone', 'cancelled', 70)];
  assert.deepEqual(workInProgress(jobs).map(j => j.id), ['run-new', 'run-old', 'wait', 'held']);
  assert.equal(workInProgress(Array.from({length: 20}, (_, i) => job('j' + i, 'running', i))).length, 8);
  assert.deepEqual(workInProgress([]), []);
});

test('recent problems: open alerts and work that failed in the last day, newest first', () => {
  const now = 10 * 24 * 3600 * 1000;
  const problems = recentProblems([alert('a1', 'open', now - 1000), alert('a2', 'resolved', now - 10), alert('a3', 'acknowledged', now - 5000)], [job('recent', 'failed', now - 2000), job('old', 'failed', now - 2 * 24 * 3600 * 1000), job('fine', 'succeeded', now - 1)], now);
  assert.deepEqual(problems.map(p => p.id), ['alert:a1', 'job:recent', 'alert:a3']);
  assert.equal(recentProblems([], [], now).length, 0);
  assert.equal(recentProblems(Array.from({length: 9}, (_, i) => alert('x' + i, 'open', now - i)), [], now).length, 6);
});
