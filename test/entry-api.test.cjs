'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fsp=fs.promises,path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events');
const {createObserver}=require('../src/server.cjs');
const joinId='0665a9c0-80b7-4f32-ad47-f36b70367f10';
const request={server:1,expectedJoinId:joinId,team:'red',durationMinutes:5,startPlayers:20,intervalSeconds:30,holdMs:400};
async function fixture(t,{players=25,sourceConfigured=true,sourceName='[ESP] wardogsspain.com | #1'}={}){
 const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'farmdogs-entry-api-'));
 let utc=Date.parse('2026-10-31T15:00:00Z'),mono=0,driverState=null,population=players;
 const calls=[];
 const entryDriver={available:()=>true,view:()=>driverState?{...driverState,at:new Date(utc).toISOString(),capturedAt:new Date(utc).toISOString()}:null,blocking:()=>false,
  start:async input=>{calls.push('entry');driverState={sessionId:input.id,server:input.server,joinId:input.joinId,phase:'navigating',chainConfirmed:false,gamePid:1234,gameWindow:5678,frameId:'55555555-5555-4555-8555-555555555555'};},
  tick:async()=>{},checkReady:async ownerId=>driverState?.sessionId===ownerId,stop:({ownerId})=>{if(driverState?.sessionId===ownerId)calls.push('entry-stop');}
 };
 const service=createObserver({port:0,dataDir:dir,utcNow:()=>utc,monoNow:()=>mono,accountProvider:()=>({available:false}),entryDriver,
  launcher:{availability:()=>({game:true,movement:true,automaticMovement:true,automaticEntry:true}),openGame:async()=>calls.push('game'),openMovementBackground:async()=>calls.push('movement'),openMovement:async()=>{}},
  screenReader:{view:()=>({status:'verified_capture',scene:'gameplay_hud',gameForeground:true,gamePid:1234,gameWindow:5678,frameId:'77777777-7777-4777-8777-777777777777',capturedAt:new Date(utc).toISOString()}),refresh:async()=>{},stop:()=>{},busy:false},
  teamClickerOptions:{capabilityCheck:()=>true,isProcessAlive:()=>true,reader:{view:()=>({status:'verified_capture',scene:'deploying',entryConfirmed:true,gameForeground:true,gamePid:1234,gameWindow:5678,frameId:'88888888-8888-4888-8888-888888888888',capturedAt:new Date(utc).toISOString()}),refresh:async()=>{},stop:()=>{},busy:false},spawnProcess:()=>{calls.push('team');const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;}},
  fetchImpl:async url=>{assert.equal(url,'https://api.wardogsspain.com/api/portal/public/wardogs-servers');return Response.json({configured:sourceConfigured,fetchedAt:utc,servers:[{id:1,num:1,name:sourceName,joinId,players:population,maxPlayers:100,online:true,configured:true,sedeoActivo:true,sedeo:{tope:20,esperaMin:30,cobroN:50}}]});}
 });
 const url=await service.ready;
 t.after(async()=>{await service.close();const relative=path.relative(os.tmpdir(),dir);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(dir).startsWith('farmdogs-entry-api-'));await fsp.rm(dir,{recursive:true,force:true});});
 const state=async()=>fetch(url+'/api/state').then(r=>r.json());
 const post=async(route,input={},extra={})=>{const s=await state();return fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':s.token,...extra},body:JSON.stringify(input)});};
 function nativeTeam(extra={}){const command=JSON.parse(fs.readFileSync(path.join(dir,'team-clicker-command.json'),'utf8'));fs.writeFileSync(path.join(dir,'team-clicker-state.json'),JSON.stringify({format:'wardogs-team-clicker-state-v1',at:new Date(utc).toISOString(),pid:9994,sessionId:command.sessionId,armed:false,active:false,running:false,gamePid:1234,gameWindow:5678,targets:{},...extra}));}
 return {dir,service,state,post,calls,phase(value,extra={}){driverState={...driverState,phase:value,chainConfirmed:true,...extra};},advance(ms){utc+=ms;mono+=ms;},players(value){population=value;},
  nativeTeam,
  async completeTeam(){
   const attemptId='66666666-6666-4666-8666-666666666666';nativeTeam({armed:true,active:true,running:true,count:2,attemptId,attemptStartedAt:new Date(utc-1).toISOString()});await service.tick();await new Promise(resolve=>setImmediate(resolve));
   assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'team-clicker-command.json'),'utf8')).entryAttemptId,attemptId);
   nativeTeam({completedAttemptId:attemptId,gamePid:0,gameWindow:0});driverState={...driverState,phase:'gameplay_hud'};await service.tick();
  },
  nativeMovement(extra={}){fs.writeFileSync(path.join(dir,'movement-state.json'),JSON.stringify({at:new Date(utc).toISOString(),pid:9993,armed:false,busy:false,count:0,endUtc:new Date(utc+3600000).toISOString(),error:null,...extra}));}
 };
}

test('API entrada: protege destino y atestación, y no empieza movimiento al abrir el juego',async t=>{
 const f=await fixture(t);assert.equal((await f.state()).capabilities.automaticEntry,true);
 assert.equal((await f.post('/api/entry/start',request,{'X-Session-Token':'bad'})).status,403);
 assert.equal((await f.post('/api/entry/start',request,{Origin:'https://untrusted.example'})).status,403);
 for(const extra of [{expectedJoinId:'bad'},{presenceMode:'entry'},{trustedEntry:{}},{entryProof:{}},{team:'purple'}])assert.equal((await f.post('/api/entry/start',{...request,...extra})).status,400);
 assert.deepEqual(f.calls,[]);
 assert.equal((await f.post('/api/entry/start',request)).status,200);
 const s=await f.state();assert.equal(s.entry.status,'waiting_game');assert.equal(s.entry.connected,false);assert.equal(s.autoSeeding,null);assert.deepEqual(f.calls,['entry','game']);
 for(const [route,input] of [['/api/movement/start',{confirmedDeployed:true,durationMinutes:5}],['/api/team-clicker/config',{enabled:true,team:'blue',intervalMs:20,startMode:'automatic'}],['/api/activity/start',{durationMinutes:5}],['/api/open/game',request]])assert.equal((await f.post(route,input)).status,400);
 assert.equal((await f.post('/api/entry/stop',{expectedSessionId:'other'})).status,400);assert.equal((await f.state()).entry.id,s.entry.id);
});

test('API entrada: el catálogo oficial acepta título nuevo y el formulario no puede forjar su confianza',async t=>{
 const renamed=await fixture(t,{sourceName:'Nombre completamente nuevo | Modo del día'});
 assert.equal((await renamed.post('/api/entry/start',request)).status,200);assert.deepEqual(renamed.calls,['entry','game']);
 const untrusted=await fixture(t,{sourceName:'Nombre completamente nuevo',sourceConfigured:false});
 const forged={...request,trusted:true,configured:true,online:true,stale:false,servers:[{number:1,joinId,name:'Nombre completamente nuevo',trusted:true,configured:true,online:true}]};
 const response=await untrusted.post('/api/entry/start',forged);assert.equal(response.status,400);assert.match((await response.json()).error,/lectura reciente/);assert.deepEqual(untrusted.calls,[]);
});

test('API entrada: equipo confirmado y HUD de la cadena entregan seeding sin Steam web',async t=>{
 const f=await fixture(t);f.nativeMovement();assert.equal((await f.post('/api/seeding/start',request)).status,200);
 const started=(await f.state()).entry;f.phase('team_selector');await f.service.tick();let s=await f.state();assert.equal(s.teamClicker.ownerId,started.id);assert.equal(s.autoSeeding,null);assert.equal(f.calls.filter(x=>x==='team').length,1);
 await f.completeTeam();s=await f.state();
 assert.equal(s.entry.status,'completed');assert.equal(s.entry.connected,true);assert.equal(s.autoSeeding.presenceMode,'entry');assert.equal(s.autoSeeding.entryId,started.id);assert.equal(s.autoSeeding.confirmedServer,null);assert.equal(s.autoSeeding.status,'starting_movement');assert.equal(s.teamClicker.enabled,false);assert.equal(f.calls.filter(x=>x==='game').length,1);assert.equal(f.calls.filter(x=>x==='movement').length,1);
 await f.post('/api/entry/stop',{expectedSessionId:started.id});assert.equal((await f.state()).autoSeeding.status,'cancelled');
});

test('API entrada: apertura manual solo conecta y F8 no rearma un intento detenido',async t=>{
 const f=await fixture(t);await f.post('/api/open/game',request);assert.equal((await f.state()).entry.seeding,false);
 f.phase('team_selector');await f.service.tick();await f.completeTeam();
 assert.equal((await f.state()).entry.status,'completed');assert.equal((await f.state()).autoSeeding,null);assert.equal(f.calls.includes('movement'),false);
 await f.post('/api/entry/start',request);f.phase('cancelled',{operatorStopped:true});await f.service.tick();assert.equal((await f.state()).entry.status,'cancelled');const starts=f.calls.length;
 f.phase('team_selector',{operatorStopped:false});await f.service.tick();assert.equal(f.calls.length,starts);assert.equal((await f.state()).autoSeeding,null);
});

test('API entrada: programación y actividad usan el mismo flujo con el presupuesto restante',async t=>{
 const f=await fixture(t,{players:5});
 assert.equal((await f.post('/api/opening/schedule',{...request,madridStart:'2026-10-31T16:01',onlyEligible:false,seeding:{durationMinutes:5,intervalSeconds:30,holdMs:400}})).status,200);
 f.advance(60000);await f.service.refresh();await f.service.tick();let s=await f.state();assert.equal(s.entry.server,1);assert.equal(s.entry.team,'red');assert.equal(s.entry.seeding,true);assert.match(s.opening.reason,/Entrada automática/);assert.equal(s.autoSeeding,null);assert.deepEqual(f.calls,['entry','game']);
 await f.post('/api/seeding/stop');assert.equal((await f.state()).entry.status,'cancelled');
 assert.equal((await f.post('/api/activity/start',{durationMinutes:5,serverNumbers:[1],team:'green'})).status,200);await f.service.tick();f.advance(30000);await f.service.refresh();await f.service.tick();s=await f.state();
 assert.equal(s.activity.status,'prepared');assert.equal(s.entry.server,1);assert.equal(s.entry.team,'green');assert.equal(s.entry.endAt,s.activity.endAt);assert.match(s.activity.reason,/Entrada automática/);assert.equal(s.autoSeeding,null);assert.equal(f.calls.filter(x=>x==='game').length,2);
});

test('API entrada: Detener actividad no cancela una entrada manual que no le pertenece',async t=>{
 const f=await fixture(t);await f.post('/api/entry/start',request);const before=(await f.state()).entry;
 await f.post('/api/activity/stop');const after=(await f.state()).entry;assert.equal(after.id,before.id);assert.equal(after.status,before.status);
 await f.post('/api/entry/stop');assert.equal((await f.state()).entry.status,'cancelled');
});
