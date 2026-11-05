'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {EventEmitter}=require('node:events');
const {createObserver}=require('../src/server.cjs');
const {validatePersistentTeam}=require('../src/persistent-team.cjs');

async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'farmdogs-repeat-api-'));
 let utc=Date.parse('2026-11-02T18:00:00Z'),mono=0,launches=0,configurationCount=0,closeCount=0;
 const calls=[],ids=['0665a9c0-80b7-4f32-ad47-f36b70367f10','9c430e28-f454-4751-bad1-07d5199f8287'];
 let current={enabled:false,status:'disabled',reason:'Desactivado.',cleanupPending:false};
 const persistentTeam={
  configure:async input=>{const settings=validatePersistentTeam(input);configurationCount++;current={...settings,id:randomUUID(),enabled:true,status:settings.startNow?'waiting_selector':'watching',reason:'Preparado entre partidas.',cleanupPending:false};return current;},
  view:()=>({...current}),blocking:()=>current.enabled||current.cleanupPending,
  stop:reason=>{current={...current,enabled:false,status:'disabled',reason,cleanupPending:false};return current;},
  tick:async()=>{},close:()=>{closeCount++;persistentTeam.stop('La app se cerró.');}
 };
 const service=createObserver({port:0,dataDir:dir,utcNow:()=>utc,monoNow:()=>mono,autoUpdate:false,persistentTeam,accountProvider:()=>({available:false}),
  teamClickerOptions:{capabilityCheck:()=>true,spawnProcess:()=>{launches++;const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;}},
  launcher:{availability:()=>({game:true,movement:true,automaticMovement:true}),openGame:async()=>{calls.push('game');throw Error('La prueba no debe abrir el juego.');},openMovement:async()=>{calls.push('movement');},openMovementBackground:async()=>{calls.push('background');}},
  fetchImpl:async url=>{assert.equal(url,'https://api.wardogsspain.com/api/portal/public/wardogs-servers');return Response.json({configured:true,fetchedAt:utc,servers:ids.map((id,index)=>({id:index+1,num:index+1,name:'[ESP] wardogsspain.com | #'+(index+1),joinId:id,players:25,maxPlayers:100,configured:true,online:true,sedeoActivo:true,factions:[{name:'Lonestar',score:10},{name:'Valkyra',score:20},{name:'Manticore',score:30}]}))});}
 });
 const url=await service.ready;
 const state=async()=>{const r=await fetch(url+'/api/state');assert.equal(r.status,200);return r.json();};
 const post=async(route,body={},headers={})=>{const s=await state();return fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':s.token,...headers},body:JSON.stringify(body)});};
 t.after(async()=>{await service.close();const relative=path.relative(os.tmpdir(),dir);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(dir,{recursive:true,force:true});});
 return {service,state,post,ids,calls,persistentTeam,get launches(){return launches;},get configurationCount(){return configurationCount;},get closeCount(){return closeCount;},advance(ms){utc+=ms;mono+=ms;}};
}
const repeatInput=id=>({server:1,expectedJoinId:id,team:'green',intervalMs:20,startNow:false});

test('API repetir equipo: permisos, identidad reciente y preparación pasiva sin abrir el juego',async t=>{
 const f=await fixture(t),input=repeatInput(f.ids[0]);
 assert.equal((await f.post('/api/persistent-team/start',input,{'X-Session-Token':'invalid'})).status,403);
 assert.equal((await f.post('/api/persistent-team/start',input,{Origin:'https://other.example'})).status,403);
 assert.equal((await f.post('/api/persistent-team/start',{...input,expectedJoinId:f.ids[1]})).status,400);
 assert.equal((await f.post('/api/persistent-team/start',{...input,team:'any'})).status,400);
 assert.equal(f.configurationCount,0);
 assert.equal((await f.post('/api/persistent-team/start',input)).status,200);
 const s=await f.state();assert.equal(s.capabilities.persistentTeam,true);assert.equal(s.persistentTeam.status,'watching');assert.equal(s.persistentTeam.enabled,true);assert.equal(s.persistentTeam.startNow,false);assert.equal(s.persistentTeam.team,'green');assert.equal(s.persistentTeam.server,1);assert.equal(s.config.selectedServer,1);
 assert.deepEqual(f.calls,[]);assert.equal(f.launches,0);assert.equal(f.configurationCount,1);
 assert.equal((await f.post('/api/persistent-team/start',input)).status,400);assert.equal(f.configurationCount,1);
 const id=s.persistentTeam.id;
 assert.equal((await f.post('/api/persistent-team/stop',{expectedSessionId:randomUUID()})).status,400);assert.equal((await f.state()).persistentTeam.id,id);assert.equal((await f.state()).persistentTeam.enabled,true);
 assert.equal((await f.post('/api/persistent-team/stop',{expectedSessionId:id})).status,200);assert.equal((await f.state()).persistentTeam.enabled,false);
});

test('API repetir equipo: bloquea otras entradas, movimiento, horarios y cambios durante espera entre partidas',async t=>{
 const f=await fixture(t);await f.post('/api/persistent-team/start',repeatInput(f.ids[0]));
 const blocked=[['/api/entry/start',{server:1,expectedJoinId:f.ids[0],team:'green',seeding:false}],['/api/open/game',{server:1,expectedJoinId:f.ids[0]}],['/api/open/movement',{}],['/api/movement/start',{durationMinutes:5,intervalSeconds:60,holdMs:500,confirmedDeployed:true}],['/api/seeding/start',{server:1,expectedJoinId:f.ids[0]}],['/api/activity/start',{durationMinutes:10}],['/api/opening/schedule',{server:1,expectedJoinId:f.ids[0],madridStart:'2026-11-02T19:30'}],['/api/watch/start',{}],['/api/config',(await f.state()).config],['/api/team-clicker/config',{enabled:true,team:'blue',intervalMs:20,startMode:'automatic'}]];
 for(const [route,input]of blocked){const response=await f.post(route,input);assert.equal(response.status,400,route);assert.match((await response.json()).error,/Repetir equipo/,route);}
 assert.equal((await f.state()).persistentTeam.enabled,true);assert.deepEqual(f.calls,[]);assert.equal(f.launches,0);
 assert.equal((await f.post('/api/seeding/stop')).status,200);assert.equal((await f.state()).persistentTeam.enabled,false);
});

test('API repetir equipo: exclusión inversa con selector de un intento, programación y seguimiento',async t=>{
 const f=await fixture(t),repeat=repeatInput(f.ids[0]);
 assert.equal((await f.post('/api/team-clicker/config',{enabled:true,team:'blue',intervalMs:20,startMode:'automatic'})).status,200);
 assert.equal((await f.post('/api/persistent-team/start',repeat)).status,400);await f.post('/api/team-clicker/stop');
 assert.equal((await f.post('/api/opening/schedule',{server:1,expectedJoinId:f.ids[0],madridStart:'2026-11-02T19:30',onlyEligible:false})).status,200);
 assert.equal((await f.post('/api/persistent-team/start',repeat)).status,400);await f.post('/api/opening/cancel');
 assert.equal((await f.post('/api/watch/start')).status,200);assert.equal((await f.post('/api/persistent-team/start',repeat)).status,400);await f.post('/api/watch/stop');
 assert.equal((await f.post('/api/persistent-team/start',repeat)).status,200);assert.deepEqual(f.calls,[]);
});

test('API repetir equipo: parada común, lectura F8 y cierre no reactivan la preferencia',async t=>{
 const f=await fixture(t);await f.post('/api/persistent-team/start',repeatInput(f.ids[0]));
 assert.equal((await f.post('/api/team-clicker/stop')).status,200);assert.equal((await f.state()).persistentTeam.enabled,false);
 await f.post('/api/persistent-team/start',repeatInput(f.ids[0]));f.persistentTeam.stop('Detenido con F8.');f.advance(1000);await f.service.tick();assert.equal((await f.state()).persistentTeam.enabled,false);assert.equal(f.configurationCount,2);
 await f.post('/api/persistent-team/start',repeatInput(f.ids[0]));await f.service.close();assert.equal(f.persistentTeam.view().enabled,false);assert.equal(f.closeCount,1);assert.deepEqual(f.calls,[]);
});

test('API con coordinador real: marcador despierta un intento propio, DESPLEGANDO conserva el modo y F8 lo apaga',async t=>{
 const syncFs=require('node:fs'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'farmdogs-repeat-integration-'));
 let utc=Date.parse('2026-11-02T18:00:00Z'),mono=0,score=20,reads=0,launches=0;
 const joinId='0665a9c0-80b7-4f32-ad47-f36b70367f10',commandFile=path.join(dir,'team-clicker-command.json'),nativeFile=path.join(dir,'team-clicker-state.json');
 const stamp=()=>new Date(utc).toISOString();
 function syncNative(extra={}){const command=JSON.parse(syncFs.readFileSync(commandFile,'utf8'));const report={format:'wardogs-team-clicker-state-v1',at:stamp(),pid:process.pid,sessionId:command.sessionId,armed:command.enabled,active:false,running:false,count:0,targets:{},...extra};syncFs.writeFileSync(nativeFile,JSON.stringify(report));return report;}
 const reader={busy:false,stop(){},refresh:async()=>{reads++;},view:()=>({status:'verified_capture',scene:'deploying',entryConfirmed:true,gameForeground:true,gamePid:process.pid,gameWindow:42,frameId:'88888888-8888-4888-8888-888888888888',capturedAt:stamp()})};
 const service=createObserver({port:0,dataDir:dir,autoUpdate:false,utcNow:()=>utc,monoNow:()=>mono,accountProvider:()=>({available:false}),
  teamClickerOptions:{capabilityCheck:()=>true,reader,spawnProcess:()=>{launches++;const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>{syncNative();child.emit('spawn');});return child;}},
  launcher:{availability:()=>({game:true,movement:true,automaticMovement:true}),openGame:async()=>{throw Error('No debe abrir el juego.');},openMovement:async()=>{throw Error('No debe abrir herramientas.');},openMovementBackground:async()=>{throw Error('No debe abrir movimiento.');}},
  fetchImpl:async()=>Response.json({configured:true,fetchedAt:utc,servers:[{id:3,num:1,joinId,name:'WARDOGS SPAIN #1',map:'Ozeti',experience:'Madrid_KOTH_01',players:100,maxPlayers:100,configured:true,online:true,sedeoActivo:false,factions:[{name:'Lonestar',color:'#4CB1EF',score:10},{name:'Valkyra',color:'#FA503E',score:5},{name:'Manticore',color:'#1DD65C',score}]}]})
 });
 const url=await service.ready,state=async()=>{const response=await fetch(url+'/api/state');return response.json();};
 const post=async(route,input)=>{const current=await state();return fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':current.token},body:JSON.stringify(input)});};
 t.after(async()=>{await service.close();const relative=path.relative(os.tmpdir(),dir);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(dir,{recursive:true,force:true});});
 assert.equal((await post('/api/persistent-team/start',{server:1,expectedJoinId:joinId,team:'green',intervalMs:20,startNow:false})).status,200);
 assert.equal((await state()).persistentTeam.status,'watching');assert.equal(reads,0);assert.equal(launches,1);assert.equal(JSON.parse(syncFs.readFileSync(commandFile)).enabled,false);
 utc+=31000;mono+=31000;score=96;syncNative();await service.refresh();await service.tick();
 let current=await state();assert.equal(current.persistentTeam.status,'waiting_selector');assert.equal(current.teamClicker.ownerId,current.persistentTeam.ownerId);assert.equal(current.teamClicker.enabled,true);assert.equal(reads,0);
 const attemptId='99999999-9999-4999-8999-999999999999',attempt={active:true,running:true,armed:true,count:1,attemptId,attemptStartedAt:stamp(),gamePid:process.pid,gameWindow:42,actualTeam:'green'};
 syncNative(attempt);await service.tick();await new Promise(setImmediate);
 const acknowledged=JSON.parse(syncFs.readFileSync(commandFile));assert.equal(acknowledged.entryAttemptId,attemptId);assert.equal(reads,1);
 syncNative({...attempt,active:false,running:false,armed:false,completedAttemptId:attemptId,completedActualTeam:'green'});await service.tick();
 current=await state();assert.equal(current.persistentTeam.enabled,true);assert.equal(current.persistentTeam.status,'watching');assert.equal(current.teamClicker.enabled,false);assert.equal(current.teamClicker.entryConfirmation.status,'confirmed');
 await service.tick();assert.equal(reads,1,'En juego normal no vuelve a lanzar OCR.');assert.equal(launches,1);
 syncNative({operatorStoppedSessionId:current.teamClicker.sessionId});await service.tick();assert.equal((await state()).persistentTeam.enabled,false);assert.match((await state()).persistentTeam.reason,/F8/);
});

test('API: repetir equipo después de una entrada completada sobrevive al temporizador real, tanto ahora como en la próxima partida',async t=>{
 for(const startNow of [false,true])await t.test(startNow?'elegir ahora y repetir':'esperar siguiente partida',async t=>{
  const syncFs=require('node:fs'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'farmdogs-repeat-after-entry-'));
  let utc=Date.parse('2026-11-05T18:00:00Z'),mono=0,score=20,gameOpens=0,roundTicks=0,d=null;
  const joinId='0665a9c0-80b7-4f32-ad47-f36b70367f10',commandFile=path.join(dir,'team-clicker-command.json'),nativeFile=path.join(dir,'team-clicker-state.json');
  const stamp=()=>new Date(utc).toISOString();
  function syncNative(extra={}){
   const command=JSON.parse(syncFs.readFileSync(commandFile,'utf8'));
   syncFs.writeFileSync(nativeFile,JSON.stringify({format:'wardogs-team-clicker-state-v1',at:stamp(),pid:process.pid,sessionId:command.sessionId,armed:command.enabled,active:false,running:false,count:0,targets:{},...extra}));
  }
  function screen(phase){d={...d,phase,at:stamp(),capturedAt:stamp(),frameId:randomUUID(),gamePid:process.pid,gameWindow:42,chainConfirmed:true};}
  const driver={available:()=>true,recoveryAvailable:()=>true,blocking:()=>false,
   async start(request){d={sessionId:request.id,server:request.server,joinId:request.joinId,phase:'waiting_game',at:stamp()};},
   view:()=>d?{...d}:null,tick:async()=>{},checkReady:async()=>true,stop({ownerId}){if(d?.sessionId===ownerId)d={...d,phase:'cancelled'};}};
  const reader={busy:false,stop(){},refresh:async()=>{},view:()=>({status:'verified_capture',scene:'deploying',entryConfirmed:true,gameForeground:true,gamePid:process.pid,gameWindow:42,frameId:randomUUID(),capturedAt:stamp()})};
  const service=createObserver({port:0,dataDir:dir,autoUpdate:false,utcNow:()=>utc,monoNow:()=>mono,accountProvider:()=>({available:false}),entryDriver:driver,
   matchSource:{tick:async()=>{roundTicks++;},view:()=>({ok:false,status:'unknown',wake:null}),close(){}},
   teamClickerOptions:{capabilityCheck:()=>true,reader,spawnProcess:()=>{const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>{syncNative();child.emit('spawn');});return child;}},
   launcher:{availability:()=>({game:true,movement:true,automaticMovement:true,automaticEntry:true}),openGame:async()=>{gameOpens++;},openMovement:async()=>{throw Error('No movement expected.');},openMovementBackground:async()=>{throw Error('No movement expected.');}},
   fetchImpl:async()=>Response.json({configured:true,fetchedAt:utc,servers:[{id:3,num:1,joinId,name:'WARDOGS SPAIN #1',map:'Ozeti',experience:'Madrid_KOTH_01',players:100,maxPlayers:100,configured:true,online:true,sedeoActivo:false,factions:[{name:'Lonestar',color:'#4CB1EF',score:10},{name:'Valkyra',color:'#FA503E',score:5},{name:'Manticore',color:'#1DD65C',score}]}]})
  });
  t.after(async()=>{await service.close();const relative=path.relative(os.tmpdir(),dir);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(dir,{recursive:true,force:true});});
  const url=await service.ready,state=async()=>{const response=await fetch(url+'/api/state');return response.json();};
  const post=async(route,input)=>{const s=await state();return fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':s.token},body:JSON.stringify(input)});};
  async function confirmTeam(){
   const attemptId=randomUUID(),attempt={active:true,running:true,armed:true,count:1,attemptId,attemptStartedAt:stamp(),gamePid:process.pid,gameWindow:42,actualTeam:'green'};
   syncNative(attempt);await service.tick();await new Promise(setImmediate);
   assert.equal(JSON.parse(syncFs.readFileSync(commandFile,'utf8')).entryAttemptId,attemptId);
   syncNative({...attempt,active:false,running:false,armed:false,completedAttemptId:attemptId,completedActualTeam:'green'});
   screen('gameplay_hud');await service.tick();
  }
  assert.equal((await post('/api/entry/start',{server:1,expectedJoinId:joinId,team:'green',durationMinutes:15,seeding:false})).status,200);
  screen('team_selector');await service.tick();await confirmTeam();
  const completed=(await state()).entry;assert.equal(completed.status,'completed');assert.equal(completed.cleanupPending,false);assert.equal(gameOpens,1);
  assert.equal((await post('/api/persistent-team/start',{server:1,expectedJoinId:joinId,team:'green',intervalMs:20,startNow})).status,200);
  syncNative();
  // Unlike service.tick(), the production timer starts entry and persistent
  // ticks concurrently. This exact ordering used to advertise false cleanup
  // for the historical entry and permanently pause the new preference.
  const beforeTimer=roundTicks,deadline=performance.now()+3000;
  while(roundTicks===beforeTimer&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
  assert.ok(roundTicks>beforeTimer,'El temporizador de producción debe haber recorrido los coordinadores.');
  let current=await state();assert.equal(current.entry.id,completed.id);assert.equal(current.entry.status,'completed');
  assert.equal(current.persistentTeam.status,startNow?'waiting_selector':'watching');assert.equal(current.persistentTeam.enabled,true);
  if(!startNow){utc+=31000;mono+=31000;score=96;syncNative();await service.refresh();await service.tick();current=await state();assert.equal(current.persistentTeam.status,'waiting_selector');assert.equal(current.persistentTeam.lastTrigger,'high_score');}
  const owner=current.persistentTeam.ownerId;assert.equal(current.teamClicker.ownerId,owner);assert.notEqual(owner,completed.id);
  await confirmTeam();current=await state();assert.equal(current.persistentTeam.status,'watching');assert.equal(current.persistentTeam.enabled,true);assert.equal(current.teamClicker.enabled,false);assert.equal(gameOpens,1);
 });
});
