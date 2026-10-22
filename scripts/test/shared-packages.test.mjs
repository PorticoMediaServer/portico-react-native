import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const parts={
 'player-core':['src','test','scripts','package.json','tsconfig.json'],
 'client-core':['src','package.json','tsconfig.json'],
 contracts:['src','package.json'],design:['src','package.json','COMPONENTS.md','LICENSE-LUCIDE'],
 i18n:['src','scripts','baselines','package.json'],
};
function fixture(t){
 const root=mkdtempSync(path.join(tmpdir(),'portico-shared-')),server=path.join(root,'server'),native=path.join(root,'native');
 t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(path.join(native,'scripts'),{recursive:true});mkdirSync(path.join(native,'packages'));mkdirSync(server);
 copyFileSync(new URL('../shared-packages.mjs',import.meta.url),path.join(native,'scripts/shared-packages.mjs'));
 for(const [pkg,names] of Object.entries(parts))for(const part of names){const dest=path.join(server,'packages',pkg,part);mkdirSync(path.dirname(dest),{recursive:true});if(['src','test','scripts','baselines'].includes(part)){mkdirSync(dest);writeFileSync(path.join(dest,'fixture.ts'),'export const value=1;\n');}else writeFileSync(dest,part.endsWith('.json')?'{}\n':'fixture\n');}
 const git=(...args)=>{const r=spawnSync('git',['-C',server,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 git('init','-q');git('add','.');git('commit','-qm','Record the shared package sync fixture.');
 const run=(mode,env={})=>spawnSync(process.execPath,[path.join(native,'scripts/shared-packages.mjs'),mode],{cwd:root,encoding:'utf8',env:{...process.env,CI:'',PORTICO_SERVER_REPO:server,...env}});
 return {server,native,run,git};
}
test('sync writes the complete player package and locks the exact committed canonical source',t=>{
 const f=fixture(t),write=f.run('--write');assert.equal(write.status,0,write.stderr);const lock=JSON.parse(readFileSync(path.join(f.native,'packages/portico-server.lock.json'),'utf8'));
 assert.equal(lock.revision,f.git('rev-parse','HEAD'));assert.ok(lock.packages.includes('packages/player-core'));
 for(const part of parts['player-core'])assert.ok(existsSync(path.join(f.native,'packages/player-core',part)),part);
 assert.equal(f.run('--check',{CI:'1'}).status,0);assert.equal(f.run('--revision').stdout.trim(),lock.revision);
});
test('check rejects missing, edited and extra player files, and write repairs byte-for-byte drift',t=>{
 const f=fixture(t);assert.equal(f.run('--write').status,0);const file=path.join(f.native,'packages/player-core/src/fixture.ts');rmSync(file);assert.notEqual(f.run('--check').status,0);assert.equal(f.run('--write').status,0);writeFileSync(file,'changed\n');assert.notEqual(f.run('--check').status,0);assert.equal(f.run('--write').status,0);writeFileSync(path.join(path.dirname(file),'extra.ts'),'extra');assert.notEqual(f.run('--check').status,0);assert.equal(f.run('--write').status,0);assert.equal(f.run('--check').status,0);
});
test('write refuses dirty or untracked player source; CI rejects a server commit different from the lock',t=>{
 const f=fixture(t);assert.equal(f.run('--write').status,0);const source=path.join(f.server,'packages/player-core/src/fixture.ts');writeFileSync(source,'changed\n');const dirty=f.run('--write');assert.notEqual(dirty.status,0);assert.match(dirty.stderr,/uncommitted changes/);f.git('checkout','--',source);writeFileSync(path.join(path.dirname(source),'new.ts'),'new');assert.notEqual(f.run('--write').status,0);f.git('add','.');f.git('commit','-qm','Record an additional shared fixture file.');assert.notEqual(f.run('--check',{CI:'1'}).status,0);assert.equal(f.run('--write').status,0);assert.equal(f.run('--check',{CI:'1'}).status,0);
});
