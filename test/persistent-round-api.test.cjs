'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createObserver}=require('../src/server.cjs');
const {validatePersistentTeam}=require('../src/persistent-team.cjs');

async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'farmdogs-round-source-api-'));
 let utc=Date.parse('2026-11-02T21:00:00Z'),mono=0,matchesReads=0,final=false,current={enabled:false,status:'disabled'};
 const id='0665a9c0-80b7-4f32-ad47-f36b70367f10',roundStartedAt=new Date(utc-600000).toISOString();
 const persistentTeam={view:()=>({...current}),blocking:()=>current.enabled===true,configure:async input=>{current={...validatePersistentTeam(input),id:randomUUID(),enabled:true,status:'watching'};return current;},tick:async()=>{},stop:()=>{current={...current,enabled:false,status:'disabled'};},close:()=>persistentTeam.stop()};
 const service=createObserver({port:0,dataDir:dir,utcNow:()=>utc,monoNow:()=>mono,autoUpdate:false,persistentTeam,accountProvider:()=>({available:false}),
  teamClickerOptions:{capabilityCheck:()=>true,spawnProcess:()=>{throw Error('No native process may be started.');}},
  launcher:{availability:()=>({game:true,movement:true,automaticMovement:true}),openGame:async()=>{throw Error('No game may be opened.');},openMovement:async()=>{throw Error('No movement may be opened.');}},
  fetchImpl:async(url,options)=>{
   assert.deepEqual(options.headers,{Accept:'application/json'});
   if(url.endsWith('/wardogs-servers'))return Response.json({configured:true,fetchedAt:utc,servers:[{id:3,num:1,joinId:id,name:'WARDOGS SPAIN #1',map:'Ozeti',players:100,maxPlayers:100,configured:true,online:true,factions:[{name:'Lonestar',score:10},{name:'Valkyra',score:20},{name:'Manticore',score:30}]}]});
   assert.equal(url,'https://api.wardogsspain.com/api/portal/public/wardogs-matches');matchesReads++;
   const round={id:3000,server:1,serverId:3,map:'Ozeti',startedAt:roundStartedAt,endedAt:new Date(utc-1000).toISOString(),live:!final,winner:final?'Manticore':null};
   return Response.json({fetchedAt:utc,lives:final?[]:[round],matches:final?[round]:[],players:[{name:'DO_NOT_RETAIN_API'}]});
  }
 });
 const url=await service.ready;
 const state=async()=>{const response=await fetch(url+'/api/state');assert.equal(response.status,200);return response.json();};
 const post=async(route,input={})=>{const s=await state();const r=await fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':s.token},body:JSON.stringify(input)});assert.equal(r.status,200);return r.json();};
 t.after(async()=>{await service.close();const rel=path.relative(os.tmpdir(),dir);assert.ok(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));await fs.rm(dir,{recursive:true,force:true});});
 return {service,state,post,dir,id,persistentTeam,get reads(){return matchesReads;},advance(ms){utc+=ms;mono+=ms;},finish(){final=true;}};
}

test('round source API: no extra query while disabled; one per minute only for owner, first history silent',async t=>{
 const f=await fixture(t);await f.service.tick();assert.equal(f.reads,0);assert.equal((await f.state()).matchSource.status,'disabled');
 const started=await f.post('/api/persistent-team/start',{enabled:true,server:1,expectedJoinId:f.id,team:'green',startNow:false});assert.equal(started.persistentTeam.enabled,true);
 await f.service.tick();let s=await f.state();assert.equal(f.reads,1);assert.equal(s.matchSource.status,'baseline');assert.equal(s.matchSource.wake,null);
 f.advance(59000);await f.service.refresh();await f.service.tick();assert.equal(f.reads,1);
 f.advance(1000);f.finish();await f.service.tick();s=await f.state();assert.equal(f.reads,2);assert.equal(s.matchSource.wake.kind,'completed');assert.equal(s.matchSource.wake.roundId,3000);
 assert.doesNotMatch(JSON.stringify(s.matchSource),/DO_NOT_RETAIN_API/);const log=await fs.readFile(path.join(f.dir,'events.jsonl'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});assert.doesNotMatch(log,/DO_NOT_RETAIN_API/);
 await f.post('/api/persistent-team/stop',{expectedSessionId:started.persistentTeam.id});assert.equal((await f.state()).matchSource.status,'disabled');
 f.advance(60000);await f.service.refresh();await f.service.tick();assert.equal(f.reads,2);
});

test('round source API: fresh preference never replays history from previous preference',async t=>{
 const f=await fixture(t),input={server:1,expectedJoinId:f.id,team:'green',startNow:false};
 await f.post('/api/persistent-team/start',input);await f.service.tick();f.advance(60000);f.finish();await f.service.refresh();await f.service.tick();assert.equal((await f.state()).matchSource.wake.kind,'completed');
 f.persistentTeam.stop();await f.service.tick();assert.equal((await f.state()).matchSource.wake,null);
 await f.post('/api/persistent-team/start',input);await f.service.tick();const state=await f.state();assert.equal(state.matchSource.status,'baseline');assert.equal(state.matchSource.wake,null);assert.equal(f.reads,3);
});
