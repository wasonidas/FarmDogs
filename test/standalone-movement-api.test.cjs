'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fsp=fs.promises;
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {createObserver}=require('../src/server.cjs');

const joinId='0665a9c0-80b7-4f32-ad47-f36b70367f10';
const sessionInput={durationMinutes:5,intervalSeconds:30,holdMs:400,confirmedDeployed:true};
async function fixture(t,{offline=true}={}){
 const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'farmdogs-break-api-'));let utc=Date.parse('2026-10-31T11:00:00Z'),mono=0;
 const calls=[];let screen={status:'verified_capture',scene:'gameplay_hud',gameForeground:true,gamePid:1234,gameWindow:5678,frameId:'55555555-5555-4555-8555-555555555555',capturedAt:new Date(utc).toISOString()};
 const service=createObserver({port:0,dataDir:dir,utcNow:()=>utc,monoNow:()=>mono,accountProvider:()=>({available:false}),
  launcher:{availability:()=>({game:true,movement:true,automaticMovement:true}),openMovementBackground:async()=>calls.push('controller'),openGame:async()=>calls.push('game'),openMovement:async()=>calls.push('tools')},
  screenReader:{view:()=>({...screen}),refresh:async()=>{},stop:()=>{},busy:false},
  teamClickerOptions:{capabilityCheck:()=>true,spawnProcess:()=>{calls.push('clicker');const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;}},
  fetchImpl:async()=>{if(offline)throw Error('Fuente pública no disponible en esta prueba.');return Response.json({configured:true,fetchedAt:utc,servers:[{id:1,num:1,name:'[ESP] wardogsspain.com | #1',joinId,players:5,maxPlayers:100,online:true,configured:true,sedeoActivo:true}]});}
 });
 const url=await service.ready;
 t.after(async()=>{await service.close();const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(dir));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(dir).startsWith('farmdogs-break-api-'));await fsp.rm(dir,{recursive:true,force:true});});
 const state=async()=>fetch(url+'/api/state').then(r=>r.json());
 const post=async(route,body={},extra={})=>{const s=await state();return fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':s.token,...extra},body:JSON.stringify(body)});};
 return {service,state,post,calls,get utc(){return utc;},advance(ms){utc+=ms;mono+=ms;},capture(values={}){screen={...screen,capturedAt:new Date(utc).toISOString(),...values};},
  native(armed=false,id=null,extra={}){fs.writeFileSync(path.join(dir,'movement-state.json'),JSON.stringify({at:new Date(utc).toISOString(),pid:700,armed,busy:false,count:0,autoSessionId:id,endUtc:new Date(utc+3600000).toISOString(),error:null,...extra}));},command(){return JSON.parse(fs.readFileSync(path.join(dir,'movement-command.json'),'utf8'));}
 };
}

test('API movimiento temporal: funciona sin fuente ni Steam y no abre el juego ni atribuye servidor',async t=>{
 const f=await fixture(t);let s=await f.state();assert.equal(s.capabilities.standaloneMovement,true);assert.equal(s.account.available,false);assert.ok(s.servers.every(server=>!server.trusted));
 assert.equal((await f.post('/api/movement/start',sessionInput,{'X-Session-Token':'bad'})).status,403);
 assert.equal((await f.post('/api/movement/start',sessionInput,{Origin:'https://untrusted.example'})).status,403);
 assert.equal((await f.post('/api/movement/start',{...sessionInput,confirmedDeployed:false})).status,400);assert.deepEqual(f.calls,[]);
 f.native();assert.equal((await f.post('/api/movement/start',sessionInput)).status,200);assert.deepEqual(f.calls,['controller']);await f.service.tick();
 s=await f.state();assert.equal(s.autoSeeding.purpose,'break');assert.equal(s.autoSeeding.server,null);assert.equal(s.autoSeeding.startPlayers,null);assert.equal(s.autoSeeding.thresholdObservedAt,null);assert.equal(s.autoSeeding.status,'starting_movement');assert.equal(s.lastLaunch,null);assert.equal(f.command().kind,'start');assert.equal(f.command().gamePid,1234);
 assert.ok(s.events.some(event=>event.kind==='auto_seeding_started'&&event.purpose==='break'&&event.server===null));
});

test('API movimiento temporal: pausa por foco, exige nueva captura y F8 es terminal',async t=>{
 const f=await fixture(t);f.native();await f.post('/api/movement/start',sessionInput);await f.service.tick();const id=(await f.state()).autoSeeding.id;f.native(true,id);
 f.capture({gameForeground:false});await f.service.tick();assert.equal((await f.state()).autoSeeding.status,'waiting_game');assert.equal(f.command().kind,'stop');
 f.advance(6000);f.native();await f.service.tick();assert.notEqual(f.command().kind,'start');f.capture({gameForeground:true});await f.service.tick();assert.equal(f.command().kind,'start');
 f.native(false,id,{autoOperatorStopped:id});await f.service.tick();assert.equal((await f.state()).autoSeeding.status,'cancelled');assert.equal(f.command().cancelled,true);f.native();f.capture();await f.service.tick();assert.equal(f.command().kind,'stop');
});

test('API movimiento temporal: cancelar no desactiva una selección de equipo ajena',async t=>{
 const f=await fixture(t);await f.post('/api/team-clicker/config',{enabled:true,team:'green',intervalMs:20,startMode:'automatic'});
 const before=(await f.state()).teamClicker;assert.equal((await f.post('/api/movement/start',sessionInput)).status,400);await f.post('/api/movement/stop');
 let s=await f.state();assert.equal(s.teamClicker.enabled,true);assert.equal(s.teamClicker.sessionId,before.sessionId);assert.equal(s.autoSeeding,null);
 await f.post('/api/team-clicker/stop');f.native();await f.post('/api/movement/start',sessionInput);const id=(await f.state()).autoSeeding.id;
 assert.equal((await f.post('/api/team-clicker/config',{enabled:true,team:'red',intervalMs:20,startMode:'automatic'})).status,400);assert.equal((await f.post('/api/movement/stop',{expectedSessionId:'other'})).status,400);assert.equal((await f.state()).autoSeeding.id,id);
 await f.post('/api/movement/stop',{expectedSessionId:id});s=await f.state();assert.equal(s.autoSeeding.status,'cancelled');assert.equal(f.command().cancelled,true);
});

test('API movimiento temporal: programación y seeding no permiten inyectar propósito break',async t=>{
 const f=await fixture(t,{offline:false});const schedule={server:1,expectedJoinId:joinId,madridStart:'2026-10-31T13:00',onlyEligible:false,seeding:{durationMinutes:5,purpose:'break',confirmedDeployed:true}};
 for(const [route,input]of [
  ['/api/seeding/start',{server:1,expectedJoinId:joinId,...sessionInput,purpose:'break'}],
  ['/api/activity/start',{durationMinutes:5,seeding:{purpose:'break',confirmedDeployed:true}}],
  ['/api/opening/schedule',schedule]
 ])assert.equal((await f.post(route,input)).status,400);
 assert.deepEqual(f.calls,[]);assert.equal((await f.state()).autoSeeding,null);
 const valid={...schedule};delete valid.seeding;assert.equal((await f.post('/api/opening/schedule',valid)).status,200);assert.equal((await f.post('/api/movement/start',sessionInput)).status,400);await f.post('/api/opening/cancel');
 f.native();await f.post('/api/seeding/start',{server:1,expectedJoinId:joinId,durationMinutes:5,presenceMode:'manual',confirmedServer:1});const before=(await f.state()).autoSeeding;
 assert.equal((await f.post('/api/movement/start',sessionInput)).status,400);await f.post('/api/movement/stop');const after=(await f.state()).autoSeeding;assert.equal(after.id,before.id);assert.notEqual(after.status,'cancelled');
});
