'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createMatchSource,MATCHES_URL}=require('../src/match-source.cjs');

function fixture(){
 let utc=Date.parse('2026-11-02T21:00:00Z'),mono=0,enabled=false,owner=randomUUID(),response,reads=0;
 const requests=[],events=[];
 const row=()=>({number:1,apiId:3,joinId:'0665a9c0-80b7-4f32-ad47-f36b70367f10',trusted:true,online:true,stale:false,sourceAt:new Date(utc).toISOString()});
 const live=(id=3000)=>({id,server:1,serverId:3,map:'Ozeti',experience:'Madrid_KOTH_01',startedAt:new Date(utc-600000).toISOString(),endedAt:new Date(utc-1000).toISOString(),live:true,winner:null,scores:{Lonestar:10,Valkyra:20,Manticore:30}});
 const payload=()=>({fetchedAt:utc,lives:[live()],matches:[]});
 const source=createMatchSource({now:()=>utc,monoNow:()=>mono,getTarget:()=>({id:owner,enabled,server:row()}),event:(kind,detail)=>events.push({kind,...detail}),fetchImpl:async(url,options)=>{reads++;requests.push({url,options});return response?response(url,options):Response.json(payload());}});
 return {source,row,live,payload,events,requests,get reads(){return reads;},get utc(){return utc;},enable(){enabled=true;},disable(){enabled=false;},newOwner(){owner=randomUUID();},respond(handler){response=handler;},advance(ms,{wall=true}={}){mono+=ms;if(wall)utc+=ms;}};
}

test('public match reader: disabled preference makes no requests; active quiet cadence is 60s',async()=>{
 const f=fixture();await f.source.tick();assert.equal(f.reads,0);assert.equal(f.source.view().status,'disabled');
 f.enable();await f.source.tick();assert.equal(f.reads,1);assert.equal(f.source.view().ok,true);assert.equal(f.source.view().wake,null);
 for(let i=0;i<59;i++){f.advance(1000);await f.source.tick();}assert.equal(f.reads,1);
 f.advance(1000);await f.source.tick();assert.equal(f.reads,2);
 assert.equal(f.requests[0].url,MATCHES_URL);assert.deepEqual(f.requests[0].options.headers,{Accept:'application/json'});assert.ok(f.requests[0].options.signal instanceof AbortSignal);
 f.disable();assert.equal(f.source.view().status,'disabled');f.advance(60000);await f.source.tick();assert.equal(f.reads,2);f.source.close();
});

test('public match reader: concurrent ticks share one request; owner change drops late payload',async()=>{
 const f=fixture();f.enable();let finish;
 f.respond(()=>new Promise(resolve=>{finish=resolve;}));const first=f.source.tick();await f.source.tick();assert.equal(f.reads,1);
 const oldSignal=f.requests[0].options.signal;f.newOwner();assert.equal(f.source.view().wake,null);assert.equal(oldSignal.aborted,true);
 finish(Response.json(f.payload()));await first;assert.equal(f.source.view().baselineReady,false);
 f.respond(()=>Response.json(f.payload()));await f.source.tick();assert.equal(f.reads,2);assert.equal(f.source.view().ok,true);assert.equal(f.source.view().wake,null);f.source.close();
});

test('public match reader: close and disable abort requests without resurrecting state',async()=>{
 for(const action of ['close','disable']){
  const f=fixture();f.enable();let finish;f.respond(()=>new Promise(resolve=>{finish=resolve;}));const pending=f.source.tick();
  if(action==='close')f.source.close();else{f.disable();f.source.view();}
  assert.equal(f.requests[0].options.signal.aborted,true);finish(Response.json(f.payload()));await pending;
  assert.equal(f.source.view().status,'disabled');assert.equal(f.source.view().wake,null);assert.equal(f.events.length,0);f.source.close();
 }
});

test('public match reader: Retry-After and monotonic cadence limit requests after errors',async()=>{
 const f=fixture();f.enable();f.respond(()=>new Response('{}',{status:429,headers:{'Retry-After':'180'}}));await f.source.tick();
 assert.match(f.source.view().fetch.error,/429/);f.advance(179999);await f.source.tick();assert.equal(f.reads,1);
 f.advance(1);f.respond(()=>Response.json(f.payload()));await f.source.tick();assert.equal(f.reads,2);assert.equal(f.source.view().fetch.error,null);
 f.advance(59000,{wall:false});await f.source.tick();assert.equal(f.reads,2);assert.equal(f.events.filter(e=>e.kind==='match_source_recovered').length,1);f.source.close();
});

test('public match reader: excessive and malformed payloads fail closed, without retaining players',async()=>{
 const f=fixture();f.enable();f.respond(()=>new Response('[]',{headers:{'content-length':String(1024*1024+1)}}));await f.source.tick();assert.equal(f.source.view().ok,false);assert.match(f.source.view().fetch.error,/tamaño/);
 f.advance(60000);f.respond(()=>new Response('{not json'));await f.source.tick();assert.equal(f.source.view().ok,false);
 f.advance(120000);f.respond(()=>Response.json({...f.payload(),players:[{privateCanary:'DO_NOT_RETAIN'}],top:[{name:'DO_NOT_RETAIN'}]}));await f.source.tick();assert.equal(f.source.view().ok,true);assert.doesNotMatch(JSON.stringify(f.source.view()),/DO_NOT_RETAIN/);f.source.close();
});
