'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {normalizeMatchRounds,createMatchRoundTracker}=require('../src/match-rounds.cjs');
const {createMatchSource}=require('../src/match-source.cjs');
const {createPersistentTeam}=require('../src/persistent-team.cjs');

// Minimal public facts projected from the real GET retained on 02/11 at
// 19:00:30.578 UTC (research/.../external-match-signals/matches-followup.json).
// Embedded here so source exports remain self-contained without private research.
// No player names, player IDs, account data or original full response are retained.
const REAL={
 fetchedAt:1793646024317,observedAt:Date.parse('2026-11-02T19:00:30.578Z'),
 live1:{id:2556,server:1,serverId:3,map:'Ozeti',experience:'Madrid_KOTH_01',startedAt:'2026-11-02T18:52:10.563Z',endedAt:'2026-11-02T19:00:10.616Z',live:true,winner:null},
 live4:{id:2538,server:4,serverId:8,map:'Zestafona',experience:'Detroit_KOTH_01',startedAt:'2026-11-02T05:05:11.256Z',endedAt:'2026-11-02T19:00:10.881Z',live:true,winner:null},
 live5:{id:2553,server:5,serverId:7,map:'Zestafona',experience:'Detroit_KOTH_01',startedAt:'2026-11-02T17:50:44.609Z',endedAt:'2026-11-02T19:00:10.922Z',live:true,winner:null},
 old5:{id:2284,server:5,serverId:5,map:'Bakurani',experience:'Bakurani_KOTH_02',startedAt:'2026-10-26T05:06:52.808Z',endedAt:'2026-10-26T07:20:52.889Z',live:true,winner:null},
 final99:{id:2551,server:1,serverId:3,map:'Zestafona',experience:'Detroit_KOTH_01',startedAt:'2026-11-02T17:35:44.248Z',endedAt:'2026-11-02T18:51:10.675Z',live:false,winner:'Manticore',scores:[{name:'Lonestar',color:'#4CB1EF',score:22},{name:'Valkyra',color:'#FA503E',score:15},{name:'Manticore',color:'#1DD65C',score:99}]}
};
const JOIN='0665a9c0-80b7-4f32-ad47-f36b70367f10';
const iso=value=>new Date(value).toISOString();
const catalog=(now,number=1)=>({number,apiId:{1:3,4:8,5:7}[number],joinId:JOIN,sourceAt:iso(now),trusted:true,online:true,stale:false});
const realPayload=()=>({fetchedAt:REAL.fetchedAt,live:structuredClone(REAL.live1),lives:[REAL.live1,REAL.live4,REAL.live5,REAL.old5].map(row=>structuredClone(row)),matches:[structuredClone(REAL.final99)]});

test('real projection replay: final99 is history, live endedAt is a heartbeat, and old #5 belongs to another internal server',()=>{
 const payload=realPayload(),first=normalizeMatchRounds(payload,catalog(REAL.observedAt),REAL.observedAt);
 assert.equal(first.ok,true);assert.equal(first.current.id,2556);assert.equal(first.current.observedAt,REAL.live1.endedAt);assert.equal(first.lastCompleted.id,2551);assert.equal(first.lastCompleted.winner,'Manticore');
 const fifth=normalizeMatchRounds(payload,catalog(REAL.observedAt,5),REAL.observedAt);assert.equal(fifth.ok,true);assert.equal(fifth.current.id,2553);assert.notEqual(fifth.current.id,REAL.old5.id);
 const fourth=normalizeMatchRounds(payload,catalog(REAL.observedAt,4),REAL.observedAt);assert.equal(fourth.ok,true);assert.equal(fourth.current.startedAt,REAL.live4.startedAt);
 let now=REAL.observedAt;const tracker=createMatchRoundTracker({now:()=>now});assert.equal(tracker.observe(payload,catalog(now)).wake,null);
 now+=60000;const moved=realPayload();moved.fetchedAt+=60000;moved.lives=moved.lives.filter(row=>row.id!==REAL.old5.id).map(row=>({...row,endedAt:iso(Date.parse(row.endedAt)+60000)}));
 const next=tracker.observe(moved,catalog(now));assert.equal(next.ok,true);assert.equal(next.current.id,2556);assert.equal(next.wake,null,'An advancing live heartbeat is not a completed round.');
});

test('captured final99 event-time replay: final then next live produces one stable hint, without requiring 100',()=>{
 // Only this scheduling/baseline is synthetic: replay the captured final row
 // while its real end timestamp is fresh. This is not a newly observed round.
 const end=Date.parse(REAL.final99.endedAt);let now=end-30000;
 const tracker=createMatchRoundTracker({now:()=>now});
 const before={...REAL.final99,live:true,winner:null,endedAt:iso(now-1000)};
 assert.equal(tracker.observe({fetchedAt:now,lives:[before],matches:[]},catalog(now)).wake,null);
 now=end+30000;const finished=tracker.observe({fetchedAt:now,lives:[],matches:[structuredClone(REAL.final99)]},catalog(now));
 assert.equal(finished.wake.kind,'completed');assert.equal(finished.wake.roundId,2551);const originalKey=finished.wake.eventKey,originalSource=finished.wake.sourceAt;
 now+=60000;const live={...REAL.live1,endedAt:iso(now-1000)};
 const next=tracker.observe({fetchedAt:now,lives:[live],matches:[structuredClone(REAL.final99)]},catalog(now));
 assert.equal(next.ok,true);assert.equal(next.wake.eventKey,originalKey);assert.equal(next.wake.sourceAt,originalSource);assert.equal(next.wake.nextRoundId,2556);
 now+=31000;assert.equal(tracker.view(catalog(now)).wake,null,'A following snapshot does not renew the original wake TTL.');
});

function streamingFixture(){
 let now=REAL.observedAt,mono=0,owner=randomUUID(),enabled=true,fetchNumber=0;
 const streams=[],events=[],requests=[];
 const source=createMatchSource({now:()=>now,monoNow:()=>mono,getTarget:()=>({id:owner,enabled,server:catalog(now)}),event:(kind,detail)=>events.push({kind,...detail}),fetchImpl:async(url,options)=>{
  fetchNumber++;requests.push({url,signal:options.signal});let controller;const body=new ReadableStream({start(value){controller=value;}});streams.push(controller);return new Response(body,{headers:{'content-type':'application/json'}});
 }});
 return {source,events,requests,streams,get fetchNumber(){return fetchNumber;},nextOwner(){owner=randomUUID();},disable(){enabled=false;},advance(ms){now+=ms;mono+=ms;},finish(index,payload){streams[index].enqueue(new TextEncoder().encode(JSON.stringify(payload)));streams[index].close();}};
}

test('streaming ownership replay: old response body finishes after a new owner and cannot clear or seed the new request',async()=>{
 const f=streamingFixture(),old=f.source.tick();await Promise.resolve();await Promise.resolve();
 f.nextOwner();f.source.view();assert.equal(f.requests[0].signal.aborted,true);const next=f.source.tick();await Promise.resolve();await Promise.resolve();assert.equal(f.fetchNumber,2);
 const hostile=realPayload();hostile.players=[{name:'PRIVATE_BODY_CANARY'}];f.finish(0,hostile);await old;
 assert.equal(f.source.view().fetch.inFlight,true);assert.equal(f.source.view().baselineReady,false);assert.equal(f.source.view().wake,null);
 f.finish(1,realPayload());await next;assert.equal(f.source.view().baselineReady,true);assert.equal(f.source.view().current.id,2556);assert.equal(f.source.view().wake,null);assert.doesNotMatch(JSON.stringify({view:f.source.view(),events:f.events}),/PRIVATE_BODY_CANARY/);f.source.close();
});

test('malformed response replay: parser failures never retain a response fragment in status or events',async()=>{
 const events=[],now=REAL.observedAt,canary='PRIVATE_PARSE_CANARY';
 // Stable owner is essential; the reader must process the error rather than
 // accidentally discard it because the fixture changed identity.
 const owner=randomUUID(),reader=createMatchSource({now:()=>now,monoNow:()=>0,getTarget:()=>({id:owner,enabled:true,server:catalog(now)}),event:(kind,detail)=>events.push({kind,...detail}),fetchImpl:async()=>new Response(canary+' is not json')});
 await reader.tick();assert.equal(reader.view().ok,false);assert.equal(events.length,1);assert.doesNotMatch(JSON.stringify({view:reader.view(),events}),new RegExp(canary));reader.close();
});

function pipelineFixture(){
 // Controlled logical time and scripted HTTP/native reports. No helper process,
 // capture, input API or account exists in this fixture.
 const origin=Date.parse('2026-11-02T19:00:00Z');let now=origin,mono=0,score=30,fetchHook=null,reader;
 let payload={fetchedAt:now,lives:[{...REAL.live1,id:9000,startedAt:iso(now-600000),endedAt:iso(now-1000)}],matches:[]};
 let report={enabled:false,armed:false,active:false,running:false,ownerId:null,sessionId:null,operatorStoppedSessionId:null,count:0,entryConfirmation:{status:'idle'}};
 const calls={prepare:[],renew:[],release:[],monitor:0,http:0},events=[];
 const row=()=>({...catalog(origin+Math.floor(mono/30000)*30000),map:'Ozeti',experience:'Madrid_KOTH_01',scoresTrusted:true,factions:[{name:'Lonestar',score:0},{name:'Valkyra',score:1},{name:'Manticore',score}]});
 const native=()=>({...report,controllerFresh:true,controllerAlive:true,controllerPid:4321,controllerSessionId:report.sessionId,controllerReportSessionId:report.sessionId,controllerReportAt:iso(now),controllerReportAgeMs:0,controllerReportRead:true,controllerReportStatus:'read',controllerIdentitySource:'report',controllerOperatorStoppedSessionId:report.operatorStoppedSessionId});
 const clicker={view:native,blocking:()=>report.enabled||report.armed||report.running,
  async prepareStopMonitor({canContinue}={}){calls.monitor++;if(canContinue&&canContinue()!==true)return native();report={...report,sessionId:randomUUID(),enabled:false,armed:false,active:false,running:false};return native();},
  async prepareOwned(request){calls.prepare.push(request);if(request.canArm&&request.canArm()!==true)return {...native(),enabled:false};report={...report,ownerId:request.ownerId,sessionId:randomUUID(),enabled:true,armed:true,active:false,running:false,count:0,entryConfirmation:{status:'idle'}};return native();},
  renewOwned(owner){assert.equal(owner,report.ownerId);assert.equal(report.enabled,true);calls.renew.push(owner);},
  releaseOwned(owner){calls.release.push(owner);if(report.ownerId===owner)report={...report,enabled:false,armed:false,active:false,running:false};return !clicker.blocking();}
 };
 const engine=createPersistentTeam({now:()=>now,monoNow:()=>mono,teamClicker:clicker,getInputs:()=>({server:row(),matchRound:reader?.view()}),event:(kind,detail)=>events.push({kind,...detail})});
 reader=createMatchSource({now:()=>now,monoNow:()=>mono,getTarget:()=>({id:engine.view().id,enabled:engine.view().enabled,server:row()}),event:(kind,detail)=>events.push({kind,...detail}),fetchImpl:async(url,options)=>{calls.http++;return fetchHook?fetchHook(url,options):Response.json(payload);}});
 return {engine,reader,calls,events,get now(){return now;},get report(){return report;},get payload(){return payload;},setPayload(value){payload=value;},setFetch(value){fetchHook=value;},setScore(value){score=value;},advance(ms){now+=ms;mono+=ms;},
  async start(){await engine.configure({enabled:true,server:1,expectedJoinId:JOIN,team:'green',startNow:false});},
  async cycle(){await reader.tick();await engine.tick();},
  complete(capturedAt=now){report={...report,enabled:false,armed:false,active:false,running:false,count:1,entryConfirmation:{status:'confirmed',ownerId:report.ownerId,sessionId:report.sessionId,actualTeam:'green',capturedAt:iso(capturedAt)}};},
  f8(){report={...report,operatorStoppedSessionId:report.sessionId};},
  close(){engine.close();reader.close();}
 };
}

test('one-hour logical quiet soak: source, tracker and preference stay passive across 61 fresh heartbeats',async()=>{
 const f=pipelineFixture();await f.start();await f.cycle();
 for(let second=1;second<=3600;second++){
  f.advance(1000);
  if(second%60===0)f.setPayload({fetchedAt:f.now,lives:[{...f.payload.lives[0],endedAt:iso(f.now-1000)}],matches:[]});
  await f.cycle();assert.equal(f.engine.view().enabled,true);assert.equal(f.engine.view().status,'watching');
 }
 assert.equal(f.calls.http,61);assert.equal(f.calls.prepare.length,0);assert.equal(f.calls.renew.length,0);assert.equal(f.engine.view().attemptCount,0);assert.equal(f.report.enabled,false);f.close();
});

test('same-map early-ending replay: below-95 completion wakes once and the next live row does not restart a confirmed selection',async()=>{
 // Administrative completion and clocks here are synthetic; only the record
 // shape is derived from captured public facts. No real early ending is claimed.
 const f=pipelineFixture();await f.start();await f.cycle();const initial=f.payload.lives[0],end=f.now+45000;
 f.advance(60000);const final={...initial,live:false,winner:'Manticore',endedAt:iso(end),scores:[{name:'Manticore',score:37}]};f.setPayload({fetchedAt:f.now,lives:[],matches:[final]});await f.cycle();
 assert.equal(f.calls.prepare.length,1);assert.equal(f.engine.view().lastTrigger,'round_completed');assert.equal(f.engine.view().status,'waiting_selector');
 f.advance(1000);f.complete();await f.engine.tick();assert.equal(f.engine.view().status,'watching');assert.equal(f.engine.view().enabled,true);const owner=f.calls.prepare[0].ownerId;
 f.advance(59000);const next={...initial,id:9001,startedAt:iso(end+1000),endedAt:iso(f.now-1000)};f.setPayload({fetchedAt:f.now,lives:[next],matches:[final]});await f.cycle();
 assert.equal(f.calls.prepare.length,1,'The following live row is the same already-handled boundary.');assert.equal(f.report.enabled,false);
 const nextEnd=f.now+45000;f.advance(60000);const secondFinal={...next,live:false,winner:'Lonestar',endedAt:iso(nextEnd),scores:[{name:'Lonestar',score:23}]};f.setPayload({fetchedAt:f.now,lives:[],matches:[final,secondFinal]});await f.cycle();
 assert.equal(f.calls.prepare.length,2);assert.notEqual(f.calls.prepare[1].ownerId,owner);assert.equal(f.engine.view().lastTrigger,'round_completed');f.close();
});

test('unknown history replay: expired HTTP history cannot wake, while a fresh public high score still works',async()=>{
 const f=pipelineFixture();await f.start();await f.cycle();f.advance(120000);f.setFetch(async()=>{throw Error('scripted transport outage');});await f.reader.tick();assert.equal(f.reader.view().ok,false);
 await f.engine.tick();assert.equal(f.calls.prepare.length,0);f.setScore(95);f.advance(30000);await f.engine.tick();assert.equal(f.calls.prepare.length,1);assert.equal(f.engine.view().lastTrigger,'high_score');f.close();
});

test('F8 during an old streamed fetch: a new explicit activation receives a clean baseline, not the late old result',async()=>{
 const f=pipelineFixture();await f.start();await f.cycle();f.advance(60000);let stream;
 f.setFetch(async()=>new Response(new ReadableStream({start(controller){stream=controller;}})));
 const pending=f.reader.tick();await Promise.resolve();await Promise.resolve();f.f8();await f.engine.tick();assert.equal(f.engine.view().enabled,false);f.reader.view();
 const previous=f.payload.lives[0],late={fetchedAt:f.now,lives:[],matches:[{...previous,live:false,winner:'Manticore',endedAt:iso(f.now-1000)}]};
 await f.start();f.setFetch(null);f.setPayload({fetchedAt:f.now,lives:[{...previous,endedAt:iso(f.now-1000)}],matches:[]});await f.reader.tick();await f.engine.tick();
 stream.enqueue(new TextEncoder().encode(JSON.stringify(late)));stream.close();await pending;await f.engine.tick();assert.equal(f.engine.view().enabled,true);assert.equal(f.engine.view().status,'watching');assert.equal(f.calls.prepare.length,0);assert.equal(f.engine.view().attemptCount,0);assert.equal(f.report.enabled,false);f.close();
});
