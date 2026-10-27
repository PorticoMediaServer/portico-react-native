import test from 'node:test';
import assert from 'node:assert/strict';
import {MusicSectionPager} from '../src-next/screens/destinations/music/paging.ts';

test('music cursor bookmarks remain bounded while previous windows retain a genuine path back to the first page',async()=>{
 const reads:string[]=[];
 const pager=new MusicSectionPager<{id:string}>({current:()=>true,publish:()=>{},read:async cursor=>{
  reads.push(cursor);const offset=cursor?Number(cursor):0;
  return {items:[{id:String(offset)}],nextCursor:offset<80?String(offset+1):'',total:81,revision:'real',offset};
 }});
 await pager.load();while(pager.getSnapshot().canNext)await pager.next(pager.getSnapshot());
 assert.equal(reads.length,81);assert.equal(pager.getSnapshot().items.length,3);
 let previous=0;while(pager.getSnapshot().canPrevious){await pager.previous(pager.getSnapshot());assert(pager.getSnapshot().items.length<=3);assert(++previous<=81);}
 assert.equal(pager.getSnapshot().offset,0);assert.equal(pager.getSnapshot().items[0].id,'0');
 await pager.next(pager.getSnapshot());assert.equal(pager.getSnapshot().items.at(-1)!.id,'1');pager.dispose();
});

test('retained row identity survives appends; rows evicted from the bounded window are not retained in snapshots',async()=>{
 const pager=new MusicSectionPager<{id:string}>({current:()=>true,publish:()=>{},read:async cursor=>{const n=Number(cursor||0);return {items:[{id:String(n)}],nextCursor:n<5?String(n+1):'',offset:n,total:6,revision:'r'};}});
 await pager.load();const first=pager.getSnapshot().items[0];await pager.next(pager.getSnapshot());assert.equal(pager.getSnapshot().items[0],first);
 await pager.next(pager.getSnapshot());await pager.next(pager.getSnapshot());assert.equal(pager.getSnapshot().items.includes(first),false);pager.dispose();
});

test('scroll continuation cannot evict a focused original row, even if focus moves during the request',async()=>{
 let release:(()=>void)|undefined;let started:(()=>void)|undefined;
 const held=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});let calls=0;
 const pager=new MusicSectionPager<{id:string}>({current:()=>true,publish:()=>{},read:async cursor=>{const n=Number(cursor||0);calls++;if(n===3){started!();await held;}return {items:[{id:String(n)}],nextCursor:n<5?String(n+1):'',offset:n,total:6,revision:'r'};}});
 await pager.load();await pager.next(pager.getSnapshot());await pager.next(pager.getSnapshot());const original=pager.getSnapshot(),first=original.items[0];
 pager.focus(first,original);await pager.next(original);assert.equal(calls,3);assert.equal(pager.getSnapshot(),original,'real focused host is still offered');
 pager.blur(first);const next=pager.next(original);await entered;pager.focus(first,original);release!();await next;
 assert.equal(pager.getSnapshot().items[0],first,'late response cannot drop a host focused during IO');assert.equal(pager.getSnapshot().canNext,true);
 pager.blur(first);await pager.next(pager.getSnapshot());assert.equal(pager.getSnapshot().items.includes(first),false);pager.dispose();
});
