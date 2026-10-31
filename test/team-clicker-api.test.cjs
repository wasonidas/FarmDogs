'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const fsSync=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {createObserver}=require('../src/server.cjs');
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wardogs-clicker-api-test-'));
 let mono=0,launches=0,utc=Date.parse('2026-10-31T08:00:00Z');
 const id='0665a9c0-80b7-4f32-ad47-f36b70367f10';
 const service=createObserver({port:0,dataDir:dir,utcNow:()=>utc,monoNow:()=>mono,accountProvider:()=>({available:false}),
  teamClickerOptions:{capabilityCheck:()=>true,spawnProcess:()=>{launches++;const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;}},
  launcher:{availability:()=>({game:true,movement:true,automaticMovement:true}),openGame:async()=>{throw Error('La prueba no debe abrir Steam.');},openMovementBackground:async()=>{},openMovement:async()=>{}},
  fetchImpl:async()=>Response.json({configured:true,fetchedAt:utc,servers:[{id:1,num:1,name:'[ESP] wardogsspain.com | #1',joinId:id,players:20,maxPlayers:100,online:true,configured:true,sedeoActivo:true}]})
 });
 const url=await service.ready;
 const state=async()=>{const response=await fetch(url+'/api/state');return response.json();};
 const post=async(route,body={},headers={})=>{const current=await state();return fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':current.token,...headers},body:JSON.stringify(body)});};
 t.after(async()=>{await service.close();const rel=path.relative(os.tmpdir(),dir);assert.ok(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));await fs.rm(dir,{recursive:true,force:true});});
 return {dir,service,state,post,id,get launches(){return launches;},advance(ms){mono+=ms;utc+=ms;}};
}
const settings={enabled:true,team:'blue',intervalMs:20,hotkey:'F6'};

test('API equipo automático: permiso explícito, espera sin teclas y cancelación terminal del nativo',async t=>{
 const f=await fixture(t),input={enabled:true,team:'red',intervalMs:20,startMode:'automatic'};
 assert.equal((await f.post('/api/team-clicker/config',input)).status,200);
 const before=(await f.state()).teamClicker;assert.equal(before.startMode,'automatic');assert.equal(before.automaticSelectionAvailable,true);assert.equal(before.waitingAutomatic,true);assert.equal(before.running,false);assert.equal(before.hotkey,null);assert.equal(before.captureKey,null);assert.doesNotMatch(before.reason,/F6|F9/);
 // Inspect synchronously: the production reader is another process, so its
 // handle can close while the service briefly waits to replace the command.
 const command=JSON.parse(fsSync.readFileSync(path.join(f.dir,'team-clicker-command.json')));assert.equal(command.startMode,'automatic');assert.equal(command.enabled,true);assert.equal(command.selectedTeam,'red');
 assert.equal((await f.post('/api/team-clicker/calibrate',{team:'red'})).status,400);
 const native={format:'wardogs-team-clicker-state-v1',at:(await f.state()).now,pid:process.pid,sessionId:before.sessionId,armed:false,running:false,active:false,count:4,automaticStoppedSessionId:before.sessionId,automaticStopReason:'Autoclic detenido por cambio de ventana.',targets:{}};
 await fs.writeFile(path.join(f.dir,'team-clicker-state.json'),JSON.stringify(native));await f.service.tick();
 const afterState=await f.state(),after=afterState.teamClicker;assert.equal(after.enabled,false);assert.match(after.reason,/cambio de ventana/,JSON.stringify(afterState.events.filter(event=>event.kind==='team_clicker_error')));assert.equal((await f.post('/api/team-clicker/heartbeat',{sessionId:before.sessionId})).status,400);assert.equal(JSON.parse(fsSync.readFileSync(path.join(f.dir,'team-clicker-command.json'))).enabled,false);
});
test('API autoclic: cambios protegidos y preparar separado de iniciar clics',async t=>{
 const f=await fixture(t);
 assert.equal((await f.post('/api/team-clicker/config',settings,{'X-Session-Token':'invalid'})).status,403);
 assert.equal((await f.post('/api/team-clicker/config',settings,{Origin:'https://untrusted.example'})).status,403);
 assert.equal(f.launches,0);assert.equal((await f.post('/api/team-clicker/config',settings)).status,200);
 const s=await f.state();assert.equal(s.teamClicker.enabled,true);assert.equal(s.teamClicker.running,false);assert.equal(f.launches,1);
 assert.equal((await f.post('/api/team-clicker/calibrate',{team:'red'})).status,400);
 assert.equal((await f.post('/api/team-clicker/calibrate',{team:'blue'})).status,200);
 assert.equal((await f.state()).teamClicker.calibratingTeam,'blue');
});
test('API autoclic: parada común y cierre invalidan permisos sin reanudación',async t=>{
 const f=await fixture(t);await f.post('/api/team-clicker/config',settings);const before=(await f.state()).teamClicker;
 assert.equal((await f.post('/api/team-clicker/heartbeat',{sessionId:before.sessionId})).status,200);
 await f.post('/api/seeding/stop');assert.equal((await f.state()).teamClicker.enabled,false);
 assert.equal((await f.post('/api/team-clicker/heartbeat',{sessionId:before.sessionId})).status,400);
 await f.post('/api/team-clicker/config',settings);
 assert.equal((await f.post('/api/team-clicker/stop',{expectedSessionId:before.sessionId})).status,400);
 const current=(await f.state()).teamClicker;assert.equal(current.enabled,true);
 assert.equal((await f.post('/api/team-clicker/stop',{expectedSessionId:current.sessionId})).status,200);
 await f.post('/api/team-clicker/config',settings);await f.service.close();
 const command=JSON.parse(fsSync.readFileSync(path.join(f.dir,'team-clicker-command.json')));assert.equal(command.enabled,false);
});
test('API autoclic: exclusión con sesión manual, vigilancia y horario en ambos sentidos',async t=>{
 const f=await fixture(t);await f.post('/api/team-clicker/config',settings);
 const session={server:1,expectedJoinId:f.id,durationMinutes:25,startPlayers:20,intervalSeconds:60,holdMs:500,presenceMode:'manual',confirmedServer:1};
 assert.equal((await f.post('/api/seeding/start',session)).status,400);
 assert.equal((await f.post('/api/activity/start',{durationMinutes:25,minPlayers:1,maxEntryPlayers:19,seeding:session})).status,400);
 assert.equal((await f.post('/api/opening/schedule',{server:1,expectedJoinId:f.id,madridStart:'2026-10-31T09:30',onlyEligible:false})).status,400);
 await f.post('/api/team-clicker/stop');assert.equal((await f.post('/api/seeding/start',session)).status,200);
 assert.equal((await f.post('/api/team-clicker/config',settings)).status,400);await f.post('/api/seeding/stop');
 assert.equal((await f.post('/api/opening/schedule',{server:1,expectedJoinId:f.id,madridStart:'2026-10-31T09:30',onlyEligible:false})).status,200);
 assert.equal((await f.post('/api/team-clicker/config',settings)).status,400);
});

test('API autoclic: no inicia movimiento hasta desarmar una tecla preparada aunque no estuviera clicando',async t=>{
 const f=await fixture(t);await f.post('/api/team-clicker/config',settings);const before=await f.state();
 const native={format:'wardogs-team-clicker-state-v1',at:before.now,pid:process.pid,sessionId:before.teamClicker.sessionId,armed:true,running:false,count:0,targets:{}};
 const nativePath=path.join(f.dir,'team-clicker-state.json');await fs.writeFile(nativePath,JSON.stringify(native));
 assert.equal((await f.post('/api/team-clicker/stop',{expectedSessionId:native.sessionId})).status,200);
 assert.equal((await f.state()).teamClicker.stopping,true);
 const session={server:1,expectedJoinId:f.id,durationMinutes:25,startPlayers:20,intervalSeconds:60,holdMs:500,presenceMode:'manual',confirmedServer:1};
 assert.equal((await f.post('/api/seeding/start',session)).status,400);
 await fs.writeFile(nativePath,JSON.stringify({...native,armed:false}));
 assert.equal((await f.state()).teamClicker.stopping,false);
 assert.equal((await f.post('/api/seeding/start',session)).status,200);
});
