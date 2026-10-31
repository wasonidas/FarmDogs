'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createEntryFlow}=require('../src/entry-flow.cjs');

const joinId='0665a9c0-80b7-4f32-ad47-f36b70367f10';
const input={server:1,joinId,team:'blue',durationMinutes:15,intervalSeconds:30,holdMs:500,startPlayers:20,seeding:true};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(){
 let utc=Date.parse('2026-10-31T15:00:00Z'),mono=100,d=null,t={ownerId:null,enabled:false},a=null,driverBusy=false,teamBusy=false;
 const calls=[],events=[],hooks={},motion={};
 const driver={
  async start(value){calls.push(['driver-start',value]);d={sessionId:value.id,server:value.server,joinId:value.joinId,phase:'waiting_game',at:new Date(utc).toISOString()};if(hooks.driverStart)await hooks.driverStart(value);},
  view:()=>d?structuredClone(d):null,
  tick:async()=>{if(hooks.driverTick)await hooks.driverTick();},
  async checkReady(owner){calls.push(['driver-guard',owner]);return hooks.driverGuard?hooks.driverGuard(owner):true;},
  blocking:owner=>driverBusy&&(!owner||d?.sessionId===owner),
  stop(value){if(d?.sessionId!==value.ownerId)return;calls.push(['driver-stop',value]);d={...d,phase:'cancelled',reason:value.reason};if(hooks.driverStop)hooks.driverStop(value);}
 };
 const teamClicker={
  async prepareOwned(value){calls.push(['team-prepare',value]);t={ownerId:value.ownerId,sessionId:randomUUID(),enabled:false,preparing:true,reason:'Preparando equipo',entryConfirmation:{status:'idle'}};if(hooks.teamPrepare)await hooks.teamPrepare(value);if(await value.canArm()===true)t={...t,enabled:true,reason:'Esperando equipo'};t={...t,preparing:false};return structuredClone(t);},
  renewOwned(owner){assert.equal(t.ownerId,owner);calls.push(['team-renew',owner]);},
  releaseOwned(owner){if(t.ownerId!==owner)return;calls.push(['team-release',owner]);t={...t,enabled:false,preparing:false,entryConfirmation:{status:'idle'},stopping:teamBusy};},
  view:()=>structuredClone(t),blocking:()=>t.enabled===true||t.preparing===true||teamBusy
 };
 const automatic={
  async start(settings,options){calls.push(['movement-start',structuredClone(settings),structuredClone(options)]);a={...settings,id:randomUUID(),entryId:options.trustedEntry.entryId,entryProof:structuredClone(options.trustedEntry),status:'waiting'};if(hooks.autoStart)await hooks.autoStart();return structuredClone(a);},
  view:()=>a?structuredClone(a):null,active:()=>!!a&&!['cancelled','error','expired'].includes(a.status),
  stop(reason){calls.push(['movement-stop',reason]);if(a)a={...a,status:'cancelled'};}
 };
 const flow=createEntryFlow({now:()=>utc,monoNow:()=>mono,driver,teamClicker,automatic,event:(kind,detail)=>events.push({kind,...detail}),
  launcher:{async openGame(){calls.push(['game-open']);if(hooks.openGame)await hooks.openGame();}},
  getTarget:(server,id)=>hooks.target?hooks.target(server,id):{server,joinId:id},getInputs:()=>({movement:{...motion}})
 });
 return {flow,calls,events,hooks,motion,driver,teamClicker,automatic,
  advance(ms){utc+=ms;mono+=ms;},wall(ms){utc+=ms;},mono(ms){mono+=ms;},
  screen(phase,changes={}){d={...d,phase,at:new Date(utc).toISOString(),capturedAt:new Date(utc).toISOString(),frameId:randomUUID(),gamePid:123,gameWindow:456,chainConfirmed:['team_selector','deploying','gameplay_hud'].includes(phase),...changes};},
  completeTeam(changes={}){const attemptId=randomUUID();t={...t,enabled:false,completedAttemptId:attemptId,entryConfirmation:{status:'confirmed',attemptId,gamePid:123,gameWindow:456,frameId:randomUUID(),capturedAt:new Date(utc).toISOString(),...changes}};},
  setDriver(value){d={...d,...value};},setTeam(value){t={...t,...value};},setAutomatic(value){a=value;},
  driverBusy(value){driverBusy=value;},teamBusy(value){teamBusy=value;},get utc(){return utc;},get team(){return t;}
 };
}
async function reachTeam(f,settings=input){await f.flow.start(settings);f.screen('team_selector');await f.flow.tick();assert.equal(f.flow.view().status,'choosing_team');}
async function complete(f,settings=input){await reachTeam(f,settings);f.completeTeam();f.screen('gameplay_hud');await f.flow.tick();}

test('entrada completa: une destino verificado, equipo, HUD y seeding con una sola apertura',async()=>{
 const f=fixture();await f.flow.start(input);const id=f.flow.view().id;
 assert.equal(f.flow.view().status,'waiting_game');assert.equal(f.flow.view().connected,false);assert.deepEqual(f.calls.map(c=>c[0]),['driver-start','game-open']);
 f.screen('navigating');await f.flow.tick();assert.equal(f.flow.view().status,'navigating');
 f.screen('joining');await f.flow.tick();assert.equal(f.flow.view().status,'joining');
 f.screen('team_selector');await f.flow.tick();assert.equal(f.flow.view().status,'choosing_team');assert.equal(f.team.ownerId,id);
 f.screen('deploying');await f.flow.tick();assert.equal(f.calls.filter(c=>c[0]==='team-renew').length,1);assert.equal(f.calls.some(c=>c[0]==='movement-start'),false);
 f.completeTeam();await f.flow.tick();assert.equal(f.flow.view().status,'deploying');assert.equal(f.calls.some(c=>c[0]==='movement-start'),false);
 f.advance(1000);f.screen('gameplay_hud');await f.flow.tick();
 const state=f.flow.view(),start=f.calls.find(c=>c[0]==='movement-start');
 assert.equal(state.status,'completed');assert.equal(state.connected,true);assert.equal(state.connectionSource,'verified_entry_ui_chain');assert.equal(f.flow.active(),false);
 assert.equal(start[1].presenceMode,'entry');assert.equal(start[1].purpose,'seeding');assert.equal(start[1].confirmedServer,undefined);assert.equal(start[1].confirmedDeployed,undefined);
 assert.equal(start[2].endAt,state.endAt);assert.deepEqual(start[2].trustedEntry,{entryId:id,server:1,joinId,gamePid:123,gameWindow:456,confirmedAt:state.deployedAt});
 assert.ok(f.calls.findIndex(c=>c[0]==='driver-stop')<f.calls.findIndex(c=>c[0]==='movement-start'));
 assert.ok(f.calls.findIndex(c=>c[0]==='team-release')<f.calls.findIndex(c=>c[0]==='movement-start'));
 await f.flow.tick();assert.equal(f.calls.filter(c=>c[0]==='movement-start').length,1);assert.equal(f.calls.filter(c=>c[0]==='game-open').length,1);
});

test('entrada sin seeding termina tras HUD y no solicita movimiento',async()=>{
 const f=fixture();await complete(f,{...input,seeding:false});assert.equal(f.flow.view().status,'completed');assert.equal(f.flow.view().connected,true);assert.equal(f.calls.some(c=>c[0]==='movement-start'),false);
});
test('el equipo aleatorio necesita capacidad y confirma un color real, conservando la petición',async()=>{
 const unsupported=fixture();await assert.rejects(unsupported.flow.start({...input,team:'any'}),/Actualiza/);assert.equal(unsupported.calls.length,0);
 const f=fixture();f.setTeam({automaticAnyTeamAvailable:true});await reachTeam(f,{...input,team:'any'});assert.equal(f.calls.find(c=>c[0]==='team-prepare')[1].team,'any');f.completeTeam({actualTeam:'green'});f.screen('gameplay_hud');await f.flow.tick();assert.equal(f.flow.view().status,'completed');assert.equal(f.flow.view().team,'any');assert.equal(f.flow.view().actualTeam,'green');
 const invalid=fixture();invalid.setTeam({automaticAnyTeamAvailable:true});await reachTeam(invalid,{...input,team:'any'});invalid.completeTeam({actualTeam:'any'});invalid.screen('gameplay_hud');await invalid.flow.tick();assert.equal(invalid.flow.view().status,'error');assert.equal(invalid.calls.some(c=>c[0]==='movement-start'),false);
});
test('OCR lento no bloquea concesión de equipo ni confirmación fresca de DESPLEGANDO',async()=>{
 const f=fixture();await reachTeam(f);const read=deferred();let renewedAt=f.utc,renewals=0;
 f.teamClicker.renewOwned=owner=>{assert.equal(owner,f.team.ownerId);assert.ok(f.utc-renewedAt<8000,'la concesión nativa habría caducado');renewedAt=f.utc;renewals++;};
 f.hooks.driverTick=()=>read.promise;
 try{
  for(let i=0;i<6;i++){f.advance(2000);const responsive=await Promise.race([f.flow.tick().then(()=>true),new Promise(resolve=>setImmediate(()=>resolve(false)))]);assert.equal(responsive,true);}
  assert.equal(renewals,6);assert.equal(f.flow.view().status,'choosing_team');
  f.completeTeam();f.screen('deploying');await f.flow.tick();assert.equal(f.flow.view().status,'deploying');assert.ok(f.flow.view().teamChosenAt);assert.equal(f.calls.some(c=>c[0]==='movement-start'),false);
 }finally{f.flow.stop();read.resolve();}
});

test('F8 recogido por el watcher durante el arranque impide conceder el primer clic',async()=>{
 const f=fixture();f.hooks.teamPrepare=()=>f.advance(16000);f.hooks.driverGuard=()=>{assert.equal(f.team.enabled,false);f.setDriver({phase:'cancelled',operatorStopped:true,chainConfirmed:false,chainInvalidated:true,reason:'Detenido con F8.'});return false;};
 await f.flow.start(input);f.screen('team_selector');await f.flow.tick();assert.equal(f.team.enabled,false);assert.equal(f.flow.view().status,'cancelled');assert.equal(f.flow.view().operatorStopped,true);assert.equal(f.calls.some(c=>c[0]==='movement-start'),false);
});

test('la guarda de arranque revalida destino y ventana después de su espera',async()=>{
 for(const changed of [{server:2},{joinId:randomUUID()},{gamePid:999},{gameWindow:999},{chainConfirmed:false}]){
  const f=fixture();f.hooks.driverGuard=()=>{f.setDriver(changed);return true;};await f.flow.start(input);f.screen('team_selector');await f.flow.tick();assert.equal(f.team.enabled,false);await f.flow.tick();assert.equal(f.flow.view().status,'error');assert.equal(f.calls.some(c=>c[0]==='movement-start'),false);
 }
});

test('entrada: foco de escritorio se transmite solo como supresión y un modo desconocido no abre nada',async()=>{
 const f=fixture();await f.flow.start({...input,initialFocus:'desktop'});assert.equal(f.calls.find(c=>c[0]==='driver-start')[1].initialFocus,'desktop');assert.equal(f.flow.view().initialFocus,'desktop');f.flow.stop();
 const second=fixture();await assert.rejects(second.flow.start({...input,initialFocus:'any_process'}),/foco inicial/);assert.equal(second.calls.length,0);
});

test('la selección, un HUD antiguo o una cadena ajena no prueban entrada ni preparan equipo',async()=>{
 for(const change of [{chainConfirmed:false},{server:2},{joinId:randomUUID()},{sessionId:randomUUID()},{frameId:'old'},{capturedAt:'2026-10-31T14:00:00Z'},{capturedAt:'2026-10-31T15:01:00Z'},{gamePid:0},{gameWindow:0}]){
  const f=fixture();await f.flow.start(input);f.screen('team_selector',change);await f.flow.tick();assert.equal(f.calls.some(c=>c[0]==='team-prepare'),false,JSON.stringify(change));assert.equal(f.calls.some(c=>c[0]==='movement-start'),false);
 }
 const f=fixture();await f.flow.start(input);f.screen('gameplay_hud');await f.flow.tick();assert.equal(f.flow.view().connected,false);assert.equal(f.calls.some(c=>c[0]==='movement-start'),false);
});

test('solo DESPLEGANDO confirmado del mismo proceso y ventana completa el equipo',async()=>{
 for(const change of [{status:'waiting'},{attemptId:'old'},{gamePid:321},{gameWindow:654},{frameId:'old'},{capturedAt:'2026-10-31T14:00:00Z'}]){
  const f=fixture();await reachTeam(f);f.completeTeam(change);f.screen('gameplay_hud');await f.flow.tick();assert.equal(f.flow.view().status,'error',JSON.stringify(change));assert.equal(f.calls.some(c=>c[0]==='movement-start'),false);
 }
});

test('el traspaso espera acuse de ambos controladores y usa prueba fresca aunque stop borre la escena',async()=>{
 const f=fixture();await reachTeam(f);f.driverBusy(true);f.teamBusy(true);f.completeTeam();f.screen('gameplay_hud');await f.flow.tick();
 assert.equal(f.flow.view().status,'deploying');assert.equal(f.calls.some(c=>c[0]==='movement-start'),false);
 f.advance(1000);f.driverBusy(false);await f.flow.tick();assert.equal(f.calls.some(c=>c[0]==='movement-start'),false);
 f.advance(1000);f.teamBusy(false);await f.flow.tick();assert.equal(f.flow.view().status,'completed');assert.equal(f.calls.filter(c=>c[0]==='movement-start').length,1);
});

test('una prueba de HUD que caduca esperando el desarme no inicia seeding',async()=>{
 const f=fixture();await reachTeam(f);f.driverBusy(true);f.completeTeam();f.screen('gameplay_hud');await f.flow.tick();f.advance(5001);f.driverBusy(false);await f.flow.tick();
 assert.equal(f.flow.view().status,'error');assert.match(f.flow.view().reason,/caduc/);assert.equal(f.calls.some(c=>c[0]==='movement-start'),false);
});

test('F8 y Detener son terminales durante entrada, equipo y movimiento preparado',async()=>{
 const f=fixture();await f.flow.start(input);const id=f.flow.view().id;f.motion.autoOperatorStopped=id;await f.flow.tick();assert.equal(f.flow.view().status,'cancelled');assert.equal(f.flow.view().operatorStopped,true);
 f.motion.autoOperatorStopped=null;f.screen('team_selector');await f.flow.tick();assert.equal(f.calls.some(c=>c[0]==='team-prepare'),false);
 const team=fixture();await reachTeam(team);team.setTeam({enabled:false,operatorStopped:true,reason:'Detenido con F8'});await team.flow.tick();assert.equal(team.flow.view().status,'cancelled');
 const moved=fixture();await complete(moved);const movement=moved.automatic.view().id;moved.flow.stop();assert.equal(moved.automatic.view().status,'cancelled');assert.equal(moved.flow.view().movementSessionId,movement);assert.equal(moved.flow.view().operatorStopped,true);
});

test('cancelar durante la apertura o preparación pendiente no deja controles ni repite el intento',async()=>{
 const f=fixture(),wait=deferred();f.hooks.driverStart=()=>wait.promise;const starting=f.flow.start(input);f.flow.stop();await assert.rejects(f.flow.start(input),/curso|deteni/);wait.resolve();await starting;
 assert.equal(f.flow.view().status,'cancelled');assert.equal(f.calls.some(c=>c[0]==='game-open'),false);f.screen('team_selector');await f.flow.tick();assert.equal(f.calls.some(c=>c[0]==='team-prepare'),false);
 const team=fixture(),prepare=deferred();team.hooks.teamPrepare=()=>prepare.promise;await team.flow.start(input);team.screen('team_selector');const pending=team.flow.tick();await Promise.resolve();await Promise.resolve();team.flow.stop();prepare.resolve();await pending;
 assert.equal(team.flow.view().status,'cancelled');assert.equal(team.team.enabled,false);assert.equal(team.calls.some(c=>c[0]==='movement-start'),false);
});

test('cancelar mientras se abre el controlador cancela la sesión propia antes de retornar',async()=>{
 const f=fixture(),wait=deferred();await reachTeam(f);f.hooks.autoStart=()=>wait.promise;f.completeTeam();f.screen('gameplay_hud');const ticking=f.flow.tick();
 for(let i=0;i<4;i++)await Promise.resolve();assert.equal(f.flow.view().status,'starting_seeding');assert.equal(f.automatic.active(),true);f.flow.stop();assert.equal(f.automatic.active(),false);wait.resolve();await ticking;
 assert.equal(f.flow.view().status,'cancelled');assert.equal(f.automatic.active(),false);assert.equal(f.calls.filter(c=>c[0]==='movement-start').length,1);
});

test('parar una entrada histórica no cancela un equipo, driver o movimiento ajeno',async()=>{
 const f=fixture();await complete(f);const before=f.calls.length;
 f.setDriver({sessionId:randomUUID()});f.setTeam({ownerId:randomUUID(),enabled:true});const alien={id:randomUUID(),purpose:'break',status:'waiting'};f.setAutomatic(alien);f.flow.stop();
 assert.deepEqual(f.automatic.view(),alien);assert.deepEqual(f.calls.slice(before).map(c=>c[0]),[]);
});

test('duración incluye entrada, cap externo y reloj monotónico aunque retroceda UTC',async()=>{
 const f=fixture(),endAt=new Date(f.utc+30000).toISOString();await f.flow.start(input,{endAt});f.advance(30000);await f.flow.tick();assert.equal(f.flow.view().status,'expired');assert.equal(f.calls.filter(c=>c[0]==='game-open').length,1);
 const rollback=fixture();await rollback.flow.start({...input,durationMinutes:1});rollback.wall(-3600000);rollback.mono(60000);await rollback.flow.tick();assert.equal(rollback.flow.view().status,'expired');
 const invalid=fixture();await assert.rejects(invalid.flow.start(input,{endAt:new Date(invalid.utc+16*60000).toISOString()}),/Límite/);assert.deepEqual(invalid.calls,[]);
});

test('errores e identidades cambiadas cierran el flujo sin reconexiones ni preparación repetida',async()=>{
 const f=fixture();f.hooks.openGame=()=>{throw Error('Apertura incierta');};await assert.rejects(f.flow.start(input),/incierta/);assert.equal(f.flow.view().status,'error');await f.flow.tick();assert.equal(f.calls.filter(c=>c[0]==='game-open').length,1);
 for(const phase of ['afk_kick','server_restart','join_wrong_server','error']){const g=fixture();await g.flow.start(input);g.screen(phase,{reason:'Mensaje visible'});await g.flow.tick();assert.equal(g.flow.view().status,'error');assert.equal(g.calls.some(c=>c[0]==='movement-start'),false);}
 const changed=fixture();await reachTeam(changed);changed.screen('gameplay_hud',{gameWindow:789});await changed.flow.tick();assert.equal(changed.flow.view().status,'error');assert.equal(changed.team.enabled,false);
});

test('validación y exclusión no producen efectos externos',async()=>{
 for(const change of [{server:0},{joinId:'steam://other'},{team:'any'},{durationMinutes:0},{intervalSeconds:1},{holdMs:1},{startPlayers:101},{seeding:undefined},{trustedEntry:{entryId:randomUUID()}}]){const f=fixture();await assert.rejects(f.flow.start({...input,...change}));assert.deepEqual(f.calls,[]);}
 const target=fixture();target.hooks.target=()=>({server:2,joinId});await assert.rejects(target.flow.start(input),/destino/);assert.deepEqual(target.calls,[]);
 const team=fixture();team.setTeam({enabled:true});await assert.rejects(team.flow.start(input),/otro automatismo/);assert.deepEqual(team.calls,[]);
 const movement=fixture();movement.setAutomatic({id:randomUUID(),purpose:'break',status:'waiting'});await assert.rejects(movement.flow.start(input),/otro automatismo/);assert.deepEqual(movement.calls,[]);
});

test('cierre y ticks concurrentes no duplican preparación ni renuevan una sesión cancelada',async()=>{
 const f=fixture(),wait=deferred();await f.flow.start(input);f.screen('team_selector');f.hooks.teamPrepare=()=>wait.promise;const one=f.flow.tick(),two=f.flow.tick();for(let i=0;i<3;i++)await Promise.resolve();
 assert.equal(f.calls.filter(c=>c[0]==='team-prepare').length,1);f.flow.close();wait.resolve();await Promise.all([one,two]);assert.equal(f.flow.view().status,'interrupted');assert.equal(f.team.enabled,false);await assert.rejects(f.flow.start(input),/cerrada/);
});

test('caducar durante esperas asíncronas detiene el flujo sin afirmar una entrega tardía',async()=>{
 const read=fixture(),reading=deferred();await read.flow.start({...input,durationMinutes:1});read.screen('team_selector');read.hooks.driverTick=()=>reading.promise;const pending=read.flow.tick();for(let i=0;i<3;i++)await Promise.resolve();read.advance(60000);reading.resolve();await pending;
 assert.equal(read.flow.view().status,'expired');assert.equal(read.calls.some(c=>c[0]==='team-prepare'),false);
 const movement=fixture(),opening=deferred();await reachTeam(movement,{...input,durationMinutes:1});movement.completeTeam();movement.screen('gameplay_hud');movement.hooks.autoStart=()=>opening.promise;const handoff=movement.flow.tick();for(let i=0;i<4;i++)await Promise.resolve();movement.advance(60000);opening.resolve();await handoff;
 assert.equal(movement.flow.view().status,'expired');assert.equal(movement.automatic.active(),false);
});
