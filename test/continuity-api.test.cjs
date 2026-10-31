const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createObserver}=require('../src/server.cjs');
const {defaultProfiles}=require('../src/domain.cjs');
const {VIP_SOURCE,SEED_SOURCE}=require('../src/account-import.cjs');

const joinId='9c430e28-f454-4751-bad1-07d5199f8287';
const frameId='55555555-5555-4555-8555-555555555555';
const admittedSeed=(players=20)=>({estado:'aguantando',servidor:2,dentro:true,porJugadores:true,cobroN:50,jugadores:players});

async function fixture(t,{players=20,active=false,phase='lleno',publicWaiting=true}={}){
 const tempRoot=await fs.realpath(os.tmpdir());
 const dir=await fs.mkdtemp(path.join(tempRoot,'wardogs-continuity-api-'));
 let service,utc=Date.parse('2026-10-31T10:00:00Z'),mono=0,readerRefreshes=0;
 const calls=[],rows=[{id:2,num:2,name:'[ESP] wardogsspain.com | #2',joinId,players,maxPlayers:100,online:true,configured:true,sedeoActivo:active,sedeo:{estado:phase,aguantando:publicWaiting,tope:20,esperaMin:30,cobroN:50}}];
 const iso=()=>new Date(utc).toISOString();
 let screen={status:'verified_capture',scene:'gameplay_hud',capturedAt:iso(),frameId,gameForeground:true,gamePid:1234,gameWindow:5678};
 t.after(async()=>{
  if(service)await service.close();
  const target=await fs.realpath(dir),relative=path.relative(tempRoot,target);
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
  assert.equal(path.dirname(target),tempRoot);
  assert.ok(path.basename(target).startsWith('wardogs-continuity-api-'));
  await fs.rm(target,{recursive:true,force:true});
 });
 const profiles=defaultProfiles().map(profile=>profile.server===2?{...profile,verifiedAt:iso(),source:'Regla simulada para la integración de continuidad.'}:profile);
 await fs.writeFile(path.join(dir,'settings.json'),JSON.stringify({profiles,selectedServer:2,durationMinutes:60}));
 service=createObserver({port:0,dataDir:dir,utcNow:()=>utc,monoNow:()=>mono,
  fetchImpl:async url=>{
   assert.equal(url,'https://api.wardogsspain.com/api/portal/public/wardogs-servers');
   return Response.json({configured:true,fetchedAt:utc,servers:rows});
  },
  launcher:{availability:()=>({game:true,movement:true,automaticMovement:true}),openMovementBackground:async()=>calls.push('controller'),openGame:async()=>calls.push('game')},
  screenReader:{busy:false,refresh:async()=>{readerRefreshes++;},stop:()=>{},view:()=>structuredClone(screen)}
 });
 const url=await service.ready;
 const state=async()=>{const response=await fetch(url+'/api/state');assert.equal(response.status,200);return response.json();};
 const post=async(route,input={})=>{const current=await state();return fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':current.token},body:JSON.stringify(input)});};
 const account=async(seed=admittedSeed(rows[0].players))=>{
  const at=iso(),response=await post('/api/account/import',{format:'wardogs-account-snapshot-v1',observedAt:at,
   vip:{observedAt:at,source:VIP_SOURCE,data:{prioridad:{comprobado:true,tiene:false,caduca:null},historial:[]}},
   seeding:{observedAt:at,source:SEED_SOURCE,data:{ahora:at,...seed}}
  });
  assert.equal(response.status,200);await response.json();
 };
 const native=async(armed=false,id=null)=>fs.writeFile(path.join(dir,'movement-state.json'),JSON.stringify({at:iso(),pid:700,armed,busy:false,count:0,autoSessionId:id,endUtc:new Date(utc+3600000).toISOString(),error:null}));
 return {dir,rows,calls,service,state,post,account,native,iso,
  advance(ms){utc+=ms;mono+=ms;},
  capture(values={}){screen={...screen,capturedAt:iso(),...values};},
  get readerRefreshes(){return readerRefreshes;},
  start:()=>post('/api/seeding/start',{server:2,expectedJoinId:joinId,durationMinutes:60}),
  command:async()=>JSON.parse(await fs.readFile(path.join(dir,'movement-command.json'),'utf8'))
 };
}

test('API continuidad: cerrar la admisión pública mantiene el movimiento de un ciclo reconocido y su umbral',async t=>{
 const f=await fixture(t,{players:19,active:true,phase:'puntua',publicWaiting:false});
 await f.account({estado:'sedeando',servidor:2,contando:true,contadoAt:f.iso(),dentro:true});await f.native();
 assert.equal((await f.start()).status,200);await f.service.tick();
 let s=await f.state();assert.equal(s.autoSeeding.status,'waiting_match');assert.equal(s.autoSeeding.thresholdObservedAt,null);
 f.advance(30000);f.rows[0].players=20;f.rows[0].sedeo.estado='lleno';await f.account();await f.native();f.capture();await f.service.refresh();await f.service.tick();
 s=await f.state();assert.equal(s.autoSeeding.status,'starting_movement');const threshold=s.autoSeeding.thresholdObservedAt,id=s.autoSeeding.id;assert.equal(threshold,f.iso());
 await f.native(true,id);await f.service.tick();assert.equal((await f.state()).autoSeeding.status,'moving');
 f.advance(30000);f.rows[0].sedeoActivo=false;f.rows[0].sedeo.aguantando=true;await f.account();await f.native(true,id);f.capture();await f.service.refresh();await f.service.tick();
 s=await f.state();assert.equal(s.autoSeeding.status,'moving');assert.equal(s.autoSeeding.thresholdObservedAt,threshold);assert.equal((await f.command()).kind,'start');
 assert.deepEqual(s.seedingContinuity,{'1':false,'2':true,'3':false,'4':false,'5':false});assert.equal(s.servers.find(server=>server.number===2).entryCandidate,false);
 f.advance(30000);f.rows[0].players=19;f.rows[0].sedeo.estado='no_puntua';await f.account();await f.native(true,id);f.capture();await f.service.refresh();await f.service.tick();
 s=await f.state();assert.equal(s.autoSeeding.status,'moving');assert.equal(s.autoSeeding.thresholdObservedAt,threshold);assert.equal(s.seedingContinuity[2],true);assert.equal((await f.command()).kind,'start');assert.equal(s.account.condition.rewardVerified,false);assert.deepEqual(f.calls,['controller','game']);
});

test('API continuidad: iniciar sobre un ciclo ya admitido prepara el controlador sin volver a abrir el juego',async t=>{
 const f=await fixture(t);await f.account();await f.native();
 assert.equal((await f.state()).seedingContinuity[2],true);assert.equal((await f.start()).status,200);await f.service.tick();
 const s=await f.state();assert.equal(s.autoSeeding.status,'starting_movement');assert.equal((await f.command()).kind,'start');assert.equal(s.lastLaunch,null);assert.deepEqual(f.calls,['controller']);
});

for(const scenario of ['cuenta antigua','otro servidor','sin señal pública de espera']){
 test(`API continuidad: ${scenario} impide iniciar sin abrir herramientas ni escribir una sesión`,async t=>{
  const f=await fixture(t);
  if(scenario==='sin señal pública de espera'){delete f.rows[0].sedeo.aguantando;f.advance(30000);await f.service.refresh();}
  await f.account(scenario==='otro servidor'?{...admittedSeed(),servidor:1}:admittedSeed());
  if(scenario==='cuenta antigua'){f.advance(100001);await f.service.refresh();}
  await f.native();f.capture();const before=await f.state();assert.equal(before.servers.find(server=>server.number===2).trusted,true);assert.equal(before.seedingContinuity[2],false);
  const response=await f.start();assert.equal(response.status,400);assert.match((await response.json()).error,/no admite nuevos seeders/);
  assert.equal((await f.state()).autoSeeding,null);assert.deepEqual(f.calls,[]);
  for(const name of ['movement-command.json','auto-seeding-session.json'])await assert.rejects(fs.stat(path.join(f.dir,name)),{code:'ENOENT'});
 });
}

for(const onlyEligible of [true,false]){
 test(`API continuidad: una programación nueva no reutiliza el ciclo privado (solo elegibles: ${onlyEligible})`,async t=>{
  const f=await fixture(t,{players:19,phase:'no_puntua'});await f.account();
  assert.equal((await f.state()).seedingContinuity[2],true);
  assert.equal((await f.post('/api/opening/schedule',{server:2,expectedJoinId:joinId,madridStart:'2026-10-31T11:01',onlyEligible,seeding:{durationMinutes:30}})).status,200);
  f.advance(60000);await f.service.refresh();await f.service.tick();const s=await f.state();
  assert.equal(s.opening.status,onlyEligible?'blocked':'uncertain');assert.equal(s.autoSeeding,null);assert.deepEqual(f.calls,[]);assert.equal(s.seedingContinuity[2],true);
 });
}

test('API continuidad: actividad pública espera una admisión nueva aunque la cuenta tenga otro ciclo en espera',async t=>{
 const f=await fixture(t,{players:19,phase:'no_puntua'});await f.account();
 assert.equal((await f.post('/api/activity/start',{durationMinutes:10,minPlayers:1,maxEntryPlayers:19,serverNumbers:[2]})).status,200);
 await f.service.tick();f.advance(30000);await f.service.refresh();await f.service.tick();const s=await f.state();
 assert.equal(s.activity.status,'watching');assert.deepEqual(s.activity.samples,[]);assert.equal(s.autoSeeding,null);assert.equal(s.seedingContinuity[2],true);assert.deepEqual(f.calls,['controller']);
});

for(const [scene,status] of [['afk_kick','game_afk_kick'],['server_restart','game_server_restart']]){
 test(`API diagnóstico: ${scene} reciente llega desde la captura sin atribuir servidor y caduca`,async t=>{
  const f=await fixture(t);await f.account();await f.native();assert.equal((await f.start()).status,200);await f.service.tick();
  const id=(await f.state()).autoSeeding.id;f.advance(2000);await f.account({estado:'nada'});await f.native(true,id);f.capture({scene});await f.service.tick();
  let s=await f.state();assert.equal(s.autoSeeding.status,'waiting_source');assert.equal((await f.command()).kind,'stop');assert.ok(f.readerRefreshes>=2);
  for(const diagnostic of Object.values(s.diagnostics)){
   assert.equal(diagnostic.status,status);assert.equal(diagnostic.observedServer,null);assert.equal(diagnostic.screenEvidence.server,null);assert.equal(diagnostic.screenEvidence.scene,scene);assert.equal(diagnostic.screenEvidence.frameId,frameId);assert.equal(diagnostic.screenEvidence.gamePid,1234);assert.equal(diagnostic.screenEvidence.gameWindow,5678);
  }
  f.advance(5001);s=await f.state();
  for(const diagnostic of Object.values(s.diagnostics)){assert.equal(diagnostic.status,'no_seeding_cycle');assert.equal(diagnostic.screenEvidence,undefined);assert.equal(diagnostic.observedServer,null);}
 });
}
