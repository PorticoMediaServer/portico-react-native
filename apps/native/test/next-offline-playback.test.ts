import test from 'node:test';
import assert from 'node:assert/strict';
import type {LocalSession, PlaybackApi} from '../../../packages/client-core/src/index';
import type {OfflineEntry, OfflineSnapshot} from '../platform/offline-downloads';
import type {LocalMedia, LocalProgress} from '../platform/local-playback';
import {NativeOfflinePlayback} from '../src-next/platform/playback/offline-playback';

function setup() {
  let session: LocalSession | undefined = {accessToken:'throwaway',expiresAt:'2100-01-01T00:00:00Z',sessionFamilyId:'family-1',tokenGeneration:'1',authorizationHorizon:'2100-01-01T00:00:00Z',viewer:{authority:'local',serverId:'server',accountId:'account',profileId:'profile',role:'viewer'}};
  const viewer = session.viewer;
  const entry: OfflineEntry = {id:'copy',itemId:'movie',title:'Movie',subtitle:'',quality:'original',artworkUrl:'',state:'ready',error:'',waiting:'',held:false,bytes:10,bytesDone:10,addedAt:1,onServer:false,changedOnServer:false,
    receipt:{receiptId:'receipt',algorithm:'ed25519',keyId:'key',payload:'fixture',signature:'fixture',revision:1,claims:{kind:'portico.download-receipt',version:'1',receiptId:'receipt',keyId:'key',viewer,itemId:'movie',preparationId:'preparation',quality:'original',qualityLabel:'Original',artifact:{sha256:'a'.repeat(64),bytes:10},issuedAt:'2026-01-01T00:00:00Z',expiresAt:'2100-01-01T00:00:00Z'}}};
  let snapshot: OfflineSnapshot = {supported:true,ready:true,entries:[entry],settings:{wifiOnly:true,deleteWatched:false,autoNext:false,limitBytes:0},freeBytes:100,usedBytes:10,otherBytes:0,pendingProgress:0};
  let reason: ReturnType<import('../platform/offline-downloads').OfflineDownloads['playabilityReason']> = null;
  const media: LocalMedia = {entryId:'copy',itemId:'movie',playId:'play_actual-journal',fileUrl:'file:///private/Downloads/copy/movie.mp4',durationSeconds:600,startSeconds:42};
  let load: () => Promise<LocalMedia> = async () => media;
  const progress: LocalProgress[] = [], network: string[] = [];
  const owner = new NativeOfflinePlayback(() => session, {getSnapshot:() => snapshot,playabilityReason:() => reason,localMedia:() => load(),recordProgress:value => progress.push(value)});
  const inner: PlaybackApi = {createPlayback:async id => {network.push('create:'+id);throw new Error('unexpected network start');},progressPlayback:async id => {network.push('progress:'+id);},stopPlayback:async id => {network.push('stop:'+id);}};
  return {owner,entry,media,progress,network,api:owner.wrap(inner),getSession:() => session,setSession:(value:LocalSession|undefined) => {session=value;},setEntries:(entries: readonly OfflineEntry[]) => {snapshot={...snapshot,entries};},setReason:(value:typeof reason) => {reason=value;},setLoad:(value:typeof load) => {load=value;}};
}
const observed = {generation:1,sequence:1,positionSeconds:51,state:'playing' as const};

test('the admitted artifact uses the real local session and journal without a server session', async () => {
  const x = setup(), source = await x.owner.prepare(x.entry, () => true), session = source.session();
  assert.equal(session.id,'local:copy:1'); assert.equal(session.mode,'local');
  assert.equal(session.streamUrl,x.media.fileUrl); assert.equal(session.resumeSeconds,42);
  assert.equal(source.owner.sessionFamilyId,'family-1'); assert.deepEqual(source.artifact,{sha256:'a'.repeat(64),bytes:10});
  await x.api.progressPlayback(session.id,observed); await x.api.stopPlayback(session.id);
  assert.deepEqual(x.network,[]); assert.equal(x.progress.length,1);
  assert.equal(x.progress[0]?.playId,x.media.playId);
  await x.api.progressPlayback('server-session',observed);
  assert.deepEqual(x.network,['progress:server-session']);
});

test('a late file read cannot cross a renewed installation family or a retired caller', async () => {
  for (const change of ['family','caller'] as const) {
    const x = setup(); let resolve!: (value:LocalMedia) => void, current = true;
    x.setLoad(() => new Promise(done => {resolve=done;}));
    const pending = x.owner.prepare(x.entry,() => current);
    if (change === 'family') x.setSession({...x.getSession()!,sessionFamilyId:'family-2'}); else current=false;
    resolve(x.media); await assert.rejects(pending); assert.deepEqual(x.progress,[]);
  }
});

test('same entry IDs cannot authorize replaced artifacts, another viewer or ambiguous rows', async () => {
  for (const change of ['hash','bytes','viewer','duplicate'] as const) {
    const x = setup(), source = await x.owner.prepare(x.entry,() => true), receipt = x.entry.receipt!;
    const claims = {...receipt.claims,...(change==='viewer'?{viewer:{...receipt.claims.viewer,profileId:'other'}}:{}),artifact:{...receipt.claims.artifact,...(change==='hash'?{sha256:'b'.repeat(64)}:change==='bytes'?{bytes:11}:{})}};
    x.setEntries(change==='duplicate'?[x.entry,x.entry]:[{...x.entry,receipt:{...receipt,claims}}]);
    assert.equal(source.current(),false); assert.throws(source.session);
  }
});

test('current receipt expiry or owner loss drops progress before it reaches the offline journal', async () => {
  const x = setup(), source = await x.owner.prepare(x.entry,() => true), session = source.session();
  x.setReason('needs_check_in'); assert.throws(source.session);
  await x.api.progressPlayback(session.id,observed); assert.equal(x.progress.length,0);
  x.setReason(null); x.setSession(undefined);
  await x.api.progressPlayback(session.id,observed); assert.equal(x.progress.length,0); assert.deepEqual(x.network,[]);
});

test('same-artifact receipt renewal stays usable; disposal and nonlocal addresses cannot admit playback', async () => {
  const x = setup(), source = await x.owner.prepare(x.entry,() => true);
  x.setEntries([{...x.entry,receipt:{...x.entry.receipt!,revision:2,payload:'renewed',signature:'renewed'}}]);
  assert.equal(source.current(),true); assert.equal(source.session().mode,'local');
  x.owner.dispose(); assert.equal(source.current(),false); assert.throws(source.session);
  for (const fileUrl of ['https://example.invalid/movie','file://other-host/movie','file:///movie?token=not-local']) {
    const y = setup(); y.setLoad(async () => ({...y.media,fileUrl}));
    await assert.rejects(y.owner.prepare(y.entry,() => true));
  }
});
