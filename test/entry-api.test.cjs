'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fsp=fs.promises,path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events');
const {createObserver}=require('../src/server.cjs');
const joinId='0665a9c0-80b7-4f32-ad47-f36b70367f10';
const request={server:1,expectedJoinId:joinId,team:'red',durationMinutes:5,startPlayers:20,intervalSeconds:30,holdMs:400};
async function fixture(t,{players=25,sourceConfigured=true,sourceName='[ESP] wardogsspain.com | #1',movementAvailable=true,automaticEntryAvailable=true}={}){
 const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'farmdogs-entry-api-'));
 let utc=Date.parse('2026-10-31T15:00:00Z'),mono=0,driverState=null,population=players,gameLaunch=async()=>{},scene='gameplay_hud',restartConfirmed=false,sourceStale=false;
 const calls=[];
 const entryDriver={available:()=>automaticEntryAvailable,recoveryAvailable:()=>true,view:()=>driverState?{...driverState,at:new Date(utc).toISOString(),capturedAt:new Date(utc).toISOString()}:null,blocking:()=>false,
  start:async input=>{calls.push('entry');driverState={sessionId:input.id,server:input.server,joinId:input.joinId,phase:'navigating',chainConfirmed:false,gamePid:1234,gameWindow:5678,frameId:'55555555-5555-4555-8555-555555555555'};},
  tick:async()=>{},checkReady:async ownerId=>driverState?.sessionId===ownerId,stop:({ownerId})=>{if(driverState?.sessionId===ownerId)calls.push('entry-stop');}
 };
 const service=createObserver({port:0,dataDir:dir,utcNow:()=>utc,monoNow:()=>mono,accountProvider:()=>({available:false}),entryDriver,
  launcher:{availability:()=>({game:true,movement:true,automaticMovement:movementAvailable,automaticEntry:true}),openGame:async()=>{calls.push('game');await gameLaunch();},openMovementBackground:async()=>calls.push('movement'),openMovement:async()=>{}},
   screenReader:{view:()=>({status:'verified_capture',scene,restartConfirmed,gameForeground:true,gamePid:1234,gameWindow:5678,frameId:'77777777-7777-4777-8777-777777777777',capturedAt:new Date(utc).toISOString()}),refresh:async()=>{},stop:()=>{},busy:false},
  teamClickerOptions:{capabilityCheck:()=>true,isProcessAlive:()=>true,reader:{view:()=>({status:'verified_capture',scene:'deploying',entryConfirmed:true,gameForeground:true,gamePid:1234,gameWindow:5678,frameId:'88888888-8888-4888-8888-888888888888',capturedAt:new Date(utc).toISOString()}),refresh:async()=>{},stop:()=>{},busy:false},spawnProcess:()=>{calls.push('team');const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;}},
   fetchImpl:async url=>{assert.equal(url,'https://api.wardogsspain.com/api/portal/public/wardogs-servers');return Response.json({configured:sourceConfigured,fetchedAt:utc,servers:[{id:1,num:1,name:sourceName,joinId,players:population,maxPlayers:100,online:true,stale:sourceStale,configured:true,sedeoActivo:true,sedeo:{tope:20,esperaMin:30,cobroN:50}}]});}
 });
 const url=await service.ready;
 t.after(async()=>{await service.close();const relative=path.relative(os.tmpdir(),dir);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(dir).startsWith('farmdogs-entry-api-'));await fsp.rm(dir,{recursive:true,force:true});});
 const state=async()=>fetch(url+'/api/state').then(r=>r.json());
 const post=async(route,input={},extra={})=>{const s=await state();return fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':s.token,...extra},body:JSON.stringify(input)});};
 function nativeTeam(extra={}){const command=JSON.parse(fs.readFileSync(path.join(dir,'team-clicker-command.json'),'utf8'));fs.writeFileSync(path.join(dir,'team-clicker-state.json'),JSON.stringify({format:'wardogs-team-clicker-state-v1',at:new Date(utc).toISOString(),pid:9994,sessionId:command.sessionId,armed:false,active:false,running:false,gamePid:1234,gameWindow:5678,targets:{},...extra}));}
 return {dir,service,state,post,calls,game:fn=>gameLaunch=fn,phase(value,extra={}){driverState={...driverState,phase:value,chainConfirmed:true,...extra};},advance(ms){utc+=ms;mono+=ms;},players(value){population=value;},screen(value,strict=false){scene=value;restartConfirmed=strict;},stale(value){sourceStale=value;},
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
 const f=await fixture(t);const capabilities=(await f.state()).capabilities;assert.equal(capabilities.automaticEntry,true);assert.equal(capabilities.deferredEntryFocus,true);
 assert.equal((await f.post('/api/entry/start',request,{'X-Session-Token':'bad'})).status,403);
 assert.equal((await f.post('/api/entry/start',request,{Origin:'https://untrusted.example'})).status,403);
 for(const extra of [{expectedJoinId:'bad'},{presenceMode:'entry'},{trustedEntry:{}},{entryProof:{}},{team:'purple'}])assert.equal((await f.post('/api/entry/start',{...request,...extra})).status,400);
 assert.deepEqual(f.calls,[]);
 assert.equal((await f.post('/api/entry/start',request)).status,200);
 const s=await f.state();assert.equal(s.entry.status,'waiting_game');assert.equal(s.entry.connected,false);assert.equal(s.autoSeeding,null);assert.deepEqual(f.calls,['entry','game']);
 for(const [route,input] of [['/api/movement/start',{confirmedDeployed:true,durationMinutes:5}],['/api/team-clicker/config',{enabled:true,team:'blue',intervalMs:20,startMode:'automatic'}],['/api/activity/start',{durationMinutes:5}],['/api/open/game',request]])assert.equal((await f.post(route,input)).status,400);
 assert.equal((await f.post('/api/entry/stop',{expectedSessionId:'other'})).status,400);assert.equal((await f.state()).entry.id,s.entry.id);
});

test('API recuperación: ningún formulario puede conceder un plan, diagnóstico ni supresión interna de apertura/foco',async t=>{
 const f=await fixture(t);
 const routes=[['/api/entry/start',request],['/api/seeding/start',request],['/api/opening/schedule',{...request,madridStart:'2026-10-31T16:01',onlyEligible:false,seeding:{durationMinutes:5}}],['/api/activity/start',{durationMinutes:5,serverNumbers:[1]}]];
 for(const [route,base] of routes)for(const extra of [{recovery:{id:joinId}},{restartConfirmed:true},{disconnect:{cause:'server_restart'}},{launch:false},{launchGame:false},{initialFocus:'none'}])assert.equal((await f.post(route,{...base,...extra})).status,400,route+JSON.stringify(extra));
 assert.equal((await f.post('/api/opening/schedule',{...routes[2][1],seeding:{durationMinutes:5,recovery:{}}})).status,400);
 assert.deepEqual(f.calls,[]);assert.equal((await f.state()).entry,null);
});

test('API recuperación: conserva el trabajo programado pero cambia UUID de entrada y su cancelación exacta detiene el hijo',async t=>{
 const f=await fixture(t);f.nativeMovement();
 assert.equal((await f.post('/api/opening/schedule',{...request,madridStart:'2026-10-31T16:01',onlyEligible:false,seeding:{durationMinutes:5,intervalSeconds:30,holdMs:400}})).status,200);
 const job=(await f.state()).opening;f.advance(60000);await f.service.refresh();f.nativeMovement();await f.service.tick();const root=(await f.state()).entry;
 f.phase('team_selector');await f.service.tick();await f.completeTeam();assert.equal((await f.state()).entry.status,'completed');
 f.screen('server_restart',true);f.nativeMovement();await f.service.tick();await f.service.tick();let s=await f.state();
 assert.equal(s.entry.status,'recovering_source');assert.notEqual(s.entry.id,root.id);assert.equal(s.entry.endAt,root.endAt);assert.deepEqual(s.entryOrigin,{kind:'scheduled',ownerId:job.id,entryId:s.entry.id});assert.equal(f.calls.filter(call=>call==='game').length,1);
 assert.equal((await f.post('/api/entry/stop',{expectedSessionId:root.id})).status,400);assert.equal((await f.state()).entry.status,'recovering_source');
 f.stale(true);f.advance(30000);await f.service.refresh();f.nativeMovement();await f.service.tick();s=await f.state();assert.equal(s.servers[0].trusted,false);assert.equal(s.entry.status,'recovering_source');assert.deepEqual(s.entry.recovery.sourceSamples,[]);
 assert.equal((await f.post('/api/opening/cancel',{expectedJobId:'another-job'})).status,400);assert.equal((await f.state()).entry.status,'recovering_source');
 assert.equal((await f.post('/api/opening/cancel',{expectedJobId:job.id})).status,200);s=await f.state();assert.equal(s.entry.status,'cancelled');assert.equal(s.opening.status,'cancelled');
 f.stale(false);f.advance(30000);await f.service.refresh();f.nativeMovement();await f.service.tick();assert.equal((await f.state()).entry.status,'cancelled');assert.equal(f.calls.filter(call=>call==='game').length,1);
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

test('API entrada: casilla anti-AFK inicia pausa vinculada al desplegar, sin población ni Steam y con duración propia',async t=>{
 const f=await fixture(t,{players:0});assert.equal((await f.state()).capabilities.entryAntiAfk,true);f.nativeMovement();
 const response=await f.post('/api/entry/start',{...request,seeding:false,antiAfk:true,antiAfkSettings:{durationMinutes:7,intervalSeconds:17,holdMs:800}});assert.equal(response.status,200);
 const entry=(await f.state()).entry;assert.equal((await f.state()).autoSeeding,null);assert.equal(f.calls.includes('movement'),false);
 f.phase('team_selector');await f.service.tick();assert.equal((await f.state()).autoSeeding,null);
 f.advance(2000);f.nativeMovement();await f.completeTeam();let s=await f.state();
 assert.equal(s.entry.status,'completed');assert.equal(s.entry.antiAfk,true);assert.equal(s.entry.seeding,false);assert.equal(s.account.available,false);assert.equal(s.autoSeeding.purpose,'break');assert.equal(s.autoSeeding.presenceMode,'entry');assert.equal(s.autoSeeding.entryId,entry.id);assert.equal(s.autoSeeding.confirmedDeployed,undefined);assert.equal(s.autoSeeding.startPlayers,null);assert.equal(s.autoSeeding.thresholdObservedAt,null);assert.equal(s.autoSeeding.status,'starting_movement');
 assert.equal(Date.parse(s.autoSeeding.endAt)-Date.parse(s.autoSeeding.createdAt),7*60000);assert.equal(Date.parse(s.autoSeeding.createdAt)-Date.parse(entry.createdAt),2000);assert.equal(s.autoSeeding.intervalSeconds,17);assert.equal(s.autoSeeding.holdMs,800);assert.equal(f.calls.filter(x=>x==='movement').length,1);
 f.nativeMovement({autoSessionId:s.autoSeeding.id,autoOperatorStopped:s.autoSeeding.id});await f.service.tick();s=await f.state();assert.equal(s.autoSeeding.status,'cancelled');
 f.nativeMovement();await f.service.tick();assert.equal((await f.state()).autoSeeding.status,'cancelled');
});

test('API entrada: anti-AFK es explícito, requiere controlador y rechaza ajustes o pruebas forjadas antes de abrir',async t=>{
 const f=await fixture(t);for(const extra of [{antiAfk:'true'},{antiAfk:false,antiAfkSettings:{}},{antiAfkSettings:{}},{antiAfk:true,seeding:true},{antiAfk:true,antiAfkSettings:{presenceMode:'manual'}},{antiAfk:true,antiAfkSettings:{confirmedDeployed:true}},{antiAfk:true,antiAfkSettings:{durationMinutes:0}},{antiAfk:true,antiAfkSettings:{intervalSeconds:301}},{antiAfk:true,antiAfkSettings:{holdMs:99}},{antiAfk:true,trustedEntry:{}},{antiAfk:true,entryProof:{}}]){
  assert.equal((await f.post('/api/entry/start',{...request,seeding:false,...extra})).status,400);assert.deepEqual(f.calls,[]);
 }
 const missing=await fixture(t,{movementAvailable:false});assert.equal((await missing.state()).capabilities.entryAntiAfk,false);assert.equal((await missing.post('/api/entry/start',{...request,seeding:false,antiAfk:true})).status,400);assert.deepEqual(missing.calls,[]);
 assert.equal((await f.post('/api/entry/start',{...request,seeding:false})).status,200);f.nativeMovement();f.phase('team_selector');await f.service.tick();await f.completeTeam();assert.equal((await f.state()).autoSeeding,null);assert.equal(f.calls.includes('movement'),false);
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

test('API sedeo máximo: entra en un vacío con plazo de doce horas y entrega movimiento al desplegar solo, sin Steam web',async t=>{
 const f=await fixture(t,{players:0});f.nativeMovement();assert.equal((await f.state()).capabilities.maximumSeeding,true);
 const response=await f.post('/api/activity/start',{strategy:'maximum',durationMinutes:720,minPlayers:16,maxEntryPlayers:19,serverNumbers:[1],team:'green',initialFocus:'desktop',seeding:{startPlayers:20,intervalSeconds:30,holdMs:400}});
 assert.equal(response.status,200);let s=await f.state();const job=s.activity;assert.equal(job.strategy,'maximum');assert.equal(job.minPlayers,0);assert.equal(job.maxEntryPlayers,99);assert.equal(job.seeding.startPlayers,1);assert.equal(job.endAt,'2026-11-01T03:00:00.000Z');assert.equal(s.entry,null);
 await f.service.tick();assert.equal((await f.state()).entry,null);f.advance(30000);await f.service.refresh();f.nativeMovement();await f.service.tick();s=await f.state();
 assert.equal(s.activity.status,'prepared');assert.equal(s.entry.server,1);assert.equal(s.entry.team,'green');assert.equal(s.entry.startPlayers,1);assert.equal(s.entry.endAt,job.endAt);assert.equal(s.autoSeeding,null);assert.deepEqual(s.entryOrigin,{kind:'activity',ownerId:job.id,entryId:s.entry.id});
 f.players(1);f.advance(30000);await f.service.refresh();f.nativeMovement();f.phase('team_selector');await f.service.tick();await f.completeTeam();s=await f.state();
 assert.equal(s.entry.status,'completed');assert.equal(s.account.available,false);assert.equal(s.autoSeeding.presenceMode,'entry');assert.equal(s.autoSeeding.server,1);assert.equal(s.autoSeeding.startPlayers,1);assert.equal(s.autoSeeding.intervalSeconds,30);assert.equal(s.autoSeeding.holdMs,400);assert.equal(s.autoSeeding.endAt,job.endAt);assert.equal(s.autoSeeding.status,'starting_movement');assert.equal(s.update.installBlocked,true);
 const command=JSON.parse(fs.readFileSync(path.join(f.dir,'movement-command.json'),'utf8'));assert.equal(command.kind,'start');assert.equal(command.sessionId,s.autoSeeding.id);assert.equal(command.endAt,job.endAt);assert.equal(command.gamePid,s.autoSeeding.entryProof.gamePid);
 f.screen('unknown');f.nativeMovement({armed:true,autoSessionId:s.autoSeeding.id});await f.service.tick();s=await f.state();assert.equal(s.autoSeeding.status,'waiting_game');assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'movement-command.json'),'utf8')).kind,'stop');
 f.screen('gameplay_hud');f.nativeMovement();await f.service.tick();assert.equal((await f.state()).autoSeeding.status,'starting_movement');
 f.advance(719*60000);f.nativeMovement();await f.service.tick();s=await f.state();assert.equal(s.autoSeeding.status,'expired');assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'movement-command.json'),'utf8')).kind,'stop');assert.equal(f.calls.filter(call=>call==='game').length,1);
});

test('API sedeo máximo: requiere componentes automáticos antes de preparar vigilancia y rechaza estrategia inválida',async t=>{
 for(const config of [{automaticEntryAvailable:false},{movementAvailable:false}]){
  const f=await fixture(t,{players:0,...config});assert.equal((await f.state()).capabilities.maximumSeeding,false);
  assert.equal((await f.post('/api/activity/start',{strategy:'maximum',durationMinutes:720})).status,400);assert.equal((await f.state()).activity,null);assert.deepEqual(f.calls,[]);
 }
 const f=await fixture(t,{players:0});assert.equal((await f.post('/api/activity/start',{strategy:'anything',durationMinutes:720})).status,400);assert.equal((await f.state()).activity,null);assert.deepEqual(f.calls,[]);
});

test('API sedeo máximo: Detener conserva la propiedad del trabajo y no rearma ni cancela otra entrada',async t=>{
 const f=await fixture(t,{players:1});f.nativeMovement();assert.equal((await f.post('/api/activity/start',{strategy:'maximum',durationMinutes:720,serverNumbers:[1],team:'red'})).status,200);const job=(await f.state()).activity;
 await f.service.tick();f.advance(30000);await f.service.refresh();f.nativeMovement();await f.service.tick();f.phase('team_selector');await f.service.tick();await f.completeTeam();let s=await f.state();assert.equal(s.autoSeeding.status,'starting_movement');
 assert.equal((await f.post('/api/activity/stop',{expectedJobId:job.id})).status,200);s=await f.state();assert.equal(s.entry.status,'cancelled');assert.equal(s.autoSeeding.status,'cancelled');f.advance(30000);await f.service.refresh();f.nativeMovement();await f.service.tick();assert.equal(f.calls.filter(call=>call==='game').length,1);
 await f.post('/api/entry/start',{...request,seeding:false});const own=(await f.state()).entry;assert.equal((await f.post('/api/activity/stop',{expectedJobId:job.id})).status,200);s=await f.state();assert.equal(s.entry.id,own.id);assert.equal(s.entry.status,own.status);assert.equal(s.entryOrigin.kind,'manual');
});

test('API entrada: Detener actividad no cancela una entrada manual que no le pertenece',async t=>{
 const f=await fixture(t);await f.post('/api/entry/start',request);const before=(await f.state()).entry;
 await f.post('/api/activity/stop');const after=(await f.state()).entry;assert.equal(after.id,before.id);assert.equal(after.status,before.status);
 await f.post('/api/entry/stop');assert.equal((await f.state()).entry.status,'cancelled');
});

test('API entrada: programación y actividad conservan foco desktop y exponen origen ligado al trabajo y entrada exactos',async t=>{
 const f=await fixture(t,{players:5});assert.equal((await f.state()).entryOrigin,null);
 const scheduled=await f.post('/api/opening/schedule',{...request,madridStart:'2026-10-31T16:01',onlyEligible:false,initialFocus:'desktop'});assert.equal(scheduled.status,200);const job=(await f.state()).opening;assert.equal(job.initialFocus,'desktop');
 f.advance(60000);await f.service.refresh();await f.service.tick();let s=await f.state();assert.equal(s.entry.initialFocus,'desktop');assert.deepEqual(s.entryOrigin,{kind:'scheduled',ownerId:job.id,entryId:s.entry.id});assert.equal(s.entry.server,job.server);assert.equal(s.entry.joinId,job.joinId);assert.equal(s.entry.createdAt,'2026-10-31T15:01:00.000Z');
 await f.post('/api/entry/stop',{expectedSessionId:s.entry.id});
 const watching=await f.post('/api/activity/start',{durationMinutes:5,serverNumbers:[1],team:'green',initialFocus:'desktop'});assert.equal(watching.status,200);const activity=(await f.state()).activity;assert.equal(activity.initialFocus,'desktop');
 await f.service.tick();f.advance(30000);await f.service.refresh();await f.service.tick();s=await f.state();assert.equal(s.entry.initialFocus,'desktop');assert.deepEqual(s.entryOrigin,{kind:'activity',ownerId:activity.id,entryId:s.entry.id});assert.equal(s.entry.server,s.activity.selectedServer);assert.equal(s.entry.joinId,s.activity.selectedJoinId);assert.equal(s.entry.endAt,s.activity.endAt);
});

test('API trabajos: initialFocus inválido no crea programación ni vigilancia',async t=>{
 const f=await fixture(t,{players:5});
 for(const focus of [null,'other',false]){
  assert.equal((await f.post('/api/opening/schedule',{...request,madridStart:'2026-10-31T16:01',onlyEligible:false,initialFocus:focus})).status,400);
  assert.equal((await f.post('/api/activity/start',{durationMinutes:5,initialFocus:focus})).status,400);
 }
 const s=await f.state();assert.equal(s.opening,null);assert.equal(s.activity,null);assert.equal(s.entryOrigin,null);assert.deepEqual(f.calls,[]);
});

test('API trabajos: cancelaciones dirigidas rechazan IDs antiguos sin afectar el trabajo actual y mantienen la API legacy',async t=>{
 const f=await fixture(t,{players:5}),schedule={...request,madridStart:'2026-10-31T16:01',onlyEligible:false};
 await f.post('/api/opening/schedule',schedule);let before=(await f.state()).opening;
 assert.equal((await f.post('/api/opening/cancel',{expectedJobId:'other'})).status,400);assert.deepEqual((await f.state()).opening,before);assert.equal((await f.post('/api/opening/cancel',{expectedJobId:before.id})).status,200);
 await f.post('/api/opening/schedule',schedule);const next=(await f.state()).opening;assert.notEqual(next.id,before.id);assert.equal((await f.post('/api/opening/cancel',{expectedJobId:before.id})).status,400);assert.deepEqual((await f.state()).opening,next);assert.equal((await f.post('/api/opening/cancel')).status,200);
 await f.post('/api/activity/start',{durationMinutes:5});before=(await f.state()).activity;
 assert.equal((await f.post('/api/activity/stop',{expectedJobId:'other'})).status,400);assert.deepEqual((await f.state()).activity,before);assert.equal((await f.post('/api/activity/stop',{expectedJobId:before.id})).status,200);
 await f.post('/api/activity/start',{durationMinutes:5});const current=(await f.state()).activity;assert.notEqual(current.id,before.id);assert.equal((await f.post('/api/activity/stop',{expectedJobId:before.id})).status,400);assert.deepEqual((await f.state()).activity,current);assert.equal((await f.post('/api/activity/stop')).status,200);
});

test('API programación: F8 dirigido durante lanzamiento revoca su entrada y un callback tardío no cambia el siguiente trabajo',async t=>{
 const f=await fixture(t,{players:5});let release,entered;const ready=new Promise(resolve=>entered=resolve);f.game(()=>{entered();return new Promise(resolve=>release=resolve);});
 await f.post('/api/opening/schedule',{...request,madridStart:'2026-10-31T16:01',onlyEligible:false,initialFocus:'desktop'});const job=(await f.state()).opening;f.advance(60000);await f.service.refresh();const pending=f.service.tick();await ready;
 try{
  let s=await f.state();assert.equal(s.opening.status,'launching');assert.equal(s.entryOrigin.ownerId,job.id);assert.equal(s.entry.status,'opening');
  assert.equal((await f.post('/api/opening/cancel',{expectedJobId:'other'})).status,400);assert.equal((await f.state()).entry.status,'opening');assert.equal((await f.post('/api/opening/cancel')).status,400,'cancel legacy no concede nuevas facultades durante lanzamiento');
  assert.equal((await f.post('/api/opening/cancel',{expectedJobId:job.id})).status,200);s=await f.state();assert.equal(s.opening.status,'cancelled');assert.equal(s.entry.status,'cancelled');
  assert.equal((await f.post('/api/opening/schedule',{...request,madridStart:'2026-10-31T16:02',onlyEligible:false,initialFocus:'driver'})).status,200);const next=(await f.state()).opening;release();await pending;s=await f.state();assert.deepEqual(s.opening,next);assert.equal(s.entry.status,'cancelled');assert.equal(f.calls.filter(c=>c==='game').length,1);
 }finally{release?.();await pending;}
});

test('API programación: cancelar su ID detiene el seeding entregado pero nunca una nueva entrada manual ajena',async t=>{
 const f=await fixture(t);f.nativeMovement();await f.post('/api/opening/schedule',{...request,madridStart:'2026-10-31T16:01',onlyEligible:false,initialFocus:'desktop',seeding:{durationMinutes:5}});const job=(await f.state()).opening;
 f.advance(60000);await f.service.refresh();f.nativeMovement();await f.service.tick();f.phase('team_selector');await f.service.tick();await f.completeTeam();let s=await f.state();assert.equal(s.entry.status,'completed');assert.equal(s.autoSeeding.status,'starting_movement');
 assert.equal((await f.post('/api/opening/cancel',{expectedJobId:'other'})).status,400);assert.equal((await f.state()).autoSeeding.status,'starting_movement');assert.equal((await f.post('/api/opening/cancel',{expectedJobId:job.id})).status,200);s=await f.state();assert.equal(s.entry.status,'cancelled');assert.equal(s.autoSeeding.status,'cancelled');
 await f.post('/api/entry/start',{...request,seeding:false});const manual=(await f.state()).entry;assert.deepEqual((await f.state()).entryOrigin,{kind:'manual',ownerId:null,entryId:manual.id});
 assert.equal((await f.post('/api/opening/cancel',{expectedJobId:job.id})).status,200);s=await f.state();assert.equal(s.entry.id,manual.id);assert.equal(s.entry.status,manual.status);assert.equal(s.entryOrigin.kind,'manual');
});

test('API actividad: parar su ID cancela el seeding entregado y no afecta una nueva entrada manual',async t=>{
 const f=await fixture(t,{players:5});f.nativeMovement();await f.post('/api/activity/start',{durationMinutes:5,serverNumbers:[1],team:'red',initialFocus:'desktop'});const job=(await f.state()).activity;
 await f.service.tick();f.advance(30000);await f.service.refresh();f.nativeMovement();await f.service.tick();f.phase('team_selector');await f.service.tick();await f.completeTeam();let s=await f.state();assert.equal(s.entry.status,'completed');assert.equal(s.autoSeeding.status,'waiting_match');assert.deepEqual(s.entryOrigin,{kind:'activity',ownerId:job.id,entryId:s.entry.id});
 assert.equal((await f.post('/api/activity/stop',{expectedJobId:'other'})).status,400);assert.equal((await f.state()).autoSeeding.status,'waiting_match');assert.equal((await f.post('/api/activity/stop',{expectedJobId:job.id})).status,200);s=await f.state();assert.equal(s.entry.status,'cancelled');assert.equal(s.autoSeeding.status,'cancelled');
 await f.post('/api/entry/start',{...request,seeding:false});const manual=(await f.state()).entry;assert.equal((await f.post('/api/activity/stop',{expectedJobId:job.id})).status,200);s=await f.state();assert.equal(s.entry.id,manual.id);assert.equal(s.entry.status,manual.status);assert.equal(s.entryOrigin.kind,'manual');
});

test('API origen: una entrada rechazada antes de crear UUID no reasigna el origen de la entrada anterior',async t=>{
 const f=await fixture(t);await f.post('/api/opening/schedule',{...request,madridStart:'2026-10-31T16:01',onlyEligible:false,initialFocus:'desktop'});f.advance(60000);await f.service.refresh();await f.service.tick();await f.post('/api/entry/stop');const before=await f.state();assert.equal(before.entryOrigin.kind,'scheduled');
 assert.equal((await f.post('/api/entry/start',{...request,team:'invalid'})).status,400);const after=await f.state();assert.deepEqual(after.entryOrigin,before.entryOrigin);assert.equal(after.entry.id,before.entry.id);assert.equal(after.entry.status,before.entry.status);
});
