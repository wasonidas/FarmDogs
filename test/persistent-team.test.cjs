'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createPersistentTeam,validatePersistentTeam}=require('../src/persistent-team.cjs');
const JOIN='11111111-1111-4111-8111-111111111111';
function fixture(){
 let utc=Date.parse('2026-11-02T19:00:00Z'),mono=0,conflict=null,externalStop=null,prepareHook=null,monitorHook=null,matchRound=null;
 let row={number:1,apiId:3,joinId:JOIN,map:'Ozeti',experience:'Madrid_KOTH_01',trusted:true,online:true,scoresTrusted:true,sourceAt:new Date(utc).toISOString(),factions:[{name:'Lonestar',score:5},{name:'Valkyra',score:10},{name:'Manticore',score:30}]};
 let native={enabled:false,armed:false,active:false,running:false,controllerFresh:true,controllerSessionId:null,operatorStoppedSessionId:null,ownerId:null,sessionId:null,count:0,entryConfirmation:{status:'idle'}};
 const calls={prepare:[],renew:[],release:[],monitor:0},events=[];
 const report=()=>{const at=native.controllerReportAt??new Date(utc).toISOString();return structuredClone({controllerPid:1234,controllerAlive:true,controllerReportAt:at,controllerReportAgeMs:utc-Date.parse(at),controllerReportSessionId:native.controllerSessionId,controllerReportRead:true,controllerReportStatus:'read',controllerIdentitySource:'report',controllerOperatorStoppedSessionId:native.operatorStoppedSessionId,...native});};
 const clicker={view:report,blocking:()=>native.enabled||native.armed||native.running,async prepareOwned(request){calls.prepare.push(request);if(prepareHook)await prepareHook(request);if(request.canArm&&await request.canArm()!==true)return {...native,enabled:false};const sessionId=randomUUID();native={...native,ownerId:request.ownerId,sessionId,controllerSessionId:sessionId,enabled:true,armed:true,active:false,running:false,count:0,entryConfirmation:{status:'idle'}};return {...native};},renewOwned(id){assert.equal(id,native.ownerId);assert.equal(native.enabled,true);calls.renew.push(id);return {...native};},releaseOwned(id){calls.release.push(id);if(native.ownerId===id)native={...native,enabled:false,armed:false,active:false,running:false};return !clicker.blocking();},async prepareStopMonitor(options={}){calls.monitor++;if(monitorHook)await monitorHook(options);if(options.canContinue&&await options.canContinue()!==true)return {...native};const id=randomUUID();native={...native,sessionId:id,controllerSessionId:id,enabled:false,armed:false};return {...native};}};
 const engine=createPersistentTeam({now:()=>utc,monoNow:()=>mono,teamClicker:clicker,getInputs:()=>({server:row,conflictReason:conflict,operatorStopId:externalStop,matchRound}),event:(kind,data)=>events.push({kind,...data})});
 return {engine,calls,events,get stamp(){return new Date(utc).toISOString();},get native(){return native;},setNative(value){native={...native,...value};},setRow(value){row={...row,...value};},get row(){return row;},setHistory(value){matchRound=value;},setConflict(value){conflict=value;},setExternalStop(value){externalStop=value;},setPrepareHook(value){prepareHook=value;},setMonitorHook(value){monitorHook=value;},advance(ms,{wall=true,fresh=false}={}){mono+=ms;if(wall)utc+=ms;if(fresh)row={...row,sourceAt:new Date(utc).toISOString()};},scores(max,ms=30000){mono+=ms;utc+=ms;row={...row,sourceAt:new Date(utc).toISOString(),factions:[{name:'Lonestar',score:0},{name:'Valkyra',score:1},{name:'Manticore',score:max}]};},complete(capturedAt){native={...native,enabled:false,armed:false,running:false,entryConfirmation:{status:'confirmed',sessionId:native.sessionId,ownerId:native.ownerId,actualTeam:'green',...(capturedAt?{capturedAt}:{})}};},start:extra=>engine.configure({enabled:true,server:1,expectedJoinId:JOIN,team:'green',intervalMs:20,...extra})};
}
const roundStart='2026-11-02T18:30:00.000Z';
test('mouse pause is projected only while its owned selector attempt exists',async()=>{
 const f=fixture();await f.start();f.setNative({userPause:{kind:'mouse',active:true,remainingMs:3000,buttonsDown:false,resumeAt:'2026-11-02T19:00:03Z'}});await f.engine.tick();assert.equal(f.engine.view().userPause.active,true);assert.equal(f.calls.renew.length,1);
 f.complete();await f.engine.tick();assert.equal(f.engine.view().status,'watching');assert.equal(f.engine.view().userPause,null);assert.equal(f.engine.view().ownerId,null);
});
function history(f,{currentId=100,currentStartedAt=roundStart,done=null,wake=null,...extra}={}){return {ok:true,status:'ready',baselineReady:true,server:1,apiId:3,joinId:JOIN,sourceAt:f.stamp,observedAt:f.stamp,current:currentId?{id:currentId,startedAt:currentStartedAt,observedAt:f.stamp}:null,lastCompleted:done,wake,...extra};}
function historyWake(f,kind,id,{startedAt=roundStart,endedAt=null,nextRoundId=null,sourceAt=f.stamp,observedAt=f.stamp}={}){return {kind,eventId:`3:${id}:${kind}`,roundId:id,sourceAt,observedAt,startedAt,endedAt,previousRoundId:100,nextRoundId};}

test('Siempre verde: confirma una entrada, duerme sin renovar ni preparar, y crea otro propietario en otra ronda',async()=>{
 const f=fixture();await f.start();const first=f.engine.view();assert.equal(f.calls.prepare.length,1);f.complete();await f.engine.tick();assert.equal(f.engine.view().enabled,true);assert.equal(f.engine.view().status,'watching');assert.equal(f.engine.view().ownerId,null);
 for(let n=0;n<12;n++){f.scores(n+1);await f.engine.tick();}
 assert.equal(f.calls.prepare.length,1);assert.equal(f.calls.renew.length,0);f.scores(95);await f.engine.tick();assert.equal(f.calls.prepare.length,2);assert.notEqual(f.engine.view().ownerId,first.ownerId);assert.notEqual(f.engine.view().sessionId,first.sessionId);assert.equal(f.engine.view().lastTrigger,'high_score');
});

test('Siempre verde: espera por API sin primer intento cuando startNow es false, y F8 funciona antes del primer selector',async()=>{
 const f=fixture();await f.start({startNow:false});assert.equal(f.calls.monitor,1);assert.equal(f.calls.prepare.length,0);assert.equal(f.engine.view().status,'watching');f.setNative({operatorStoppedSessionId:f.native.sessionId});await f.engine.tick();assert.equal(f.engine.view().enabled,false);assert.equal(f.calls.prepare.length,0);assert.match(f.engine.view().reason,/F8/);
});

test('Siempre verde: preparar sólo F8 espera sin ticks prematuros y una cancelación/F8 tardía no reactiva la preferencia',async()=>{
 for(const action of ['ready','stop','close','F8']){
  const f=fixture();let resolve;f.setNative({controllerFresh:false});f.setMonitorHook(()=>new Promise(done=>{resolve=done;}));const pending=f.start({startNow:false});
  assert.equal(f.engine.view().cleanupPending,true);f.advance(16000,{fresh:true});await f.engine.tick();assert.equal(f.engine.view().status,'preparing');assert.equal(f.calls.prepare.length,0);
  if(action==='stop'||action==='close')f.engine[action]();else if(action==='F8')f.setExternalStop('stop-during-monitor');
  resolve();await pending;
  if(action==='ready'){assert.equal(f.engine.view().status,'watching');assert.equal(f.engine.view().enabled,true);assert.equal(f.engine.view().cleanupPending,false);}
  else{assert.equal(f.engine.view().enabled,false);assert.notEqual(f.engine.view().status,'watching');}
  assert.equal(f.calls.prepare.length,0);
 }
});

test('Siempre verde: F8 quieto apaga la preferencia y ninguna puntuación posterior puede rearmarla',async()=>{
 const f=fixture();await f.start();f.complete();await f.engine.tick();f.setNative({operatorStoppedSessionId:f.native.sessionId});await f.engine.tick();assert.equal(f.engine.view().enabled,false);f.scores(99,180000);await f.engine.tick();assert.equal(f.calls.prepare.length,1);assert.equal(f.engine.blocking(),false);
});

test('Siempre verde: una F8 anterior no impide una acción nueva, pero una F8 externa nueva sí cancela',async()=>{
 const f=fixture();f.setNative({operatorStoppedSessionId:randomUUID()});f.setExternalStop('old-stop');await f.start();assert.equal(f.engine.view().enabled,true);f.setExternalStop('new-stop');await f.engine.tick();assert.equal(f.engine.view().enabled,false);assert.equal(f.native.enabled,false);
});

test('Siempre verde: el mismo 95 no reinicia ventanas vencidas; un 96 de una muestra nueva sí',async()=>{
 const f=fixture();await f.start({startNow:false,attemptMinutes:1});f.scores(95);await f.engine.tick();assert.equal(f.calls.prepare.length,1);f.advance(60000,{fresh:true});await f.engine.tick();assert.equal(f.native.enabled,false);assert.equal(f.engine.view().enabled,true);
 for(let n=0;n<5;n++){f.scores(95);await f.engine.tick();}assert.equal(f.calls.prepare.length,1);
 f.scores(96);await f.engine.tick();assert.equal(f.calls.prepare.length,2);assert.equal(f.engine.view().lastTrigger,'high_score');
});

test('Siempre verde: reconoce un reinicio alto a bajo sin esperar a ver exactamente 100',async()=>{
 const f=fixture();f.scores(99,0);await f.start({startNow:false});f.scores(0);await f.engine.tick();assert.equal(f.calls.prepare.length,1);assert.equal(f.engine.view().lastTrigger,'score_reset');
});

test('Siempre verde: entrar al final de la ronda no silencia un reset fresco diez segundos después',async()=>{
 const f=fixture();f.scores(95,0);await f.start();const first=f.engine.view().ownerId;f.complete();await f.engine.tick();f.scores(0,10000);await f.engine.tick();assert.equal(f.calls.prepare.length,2);assert.notEqual(f.engine.view().ownerId,first);assert.equal(f.engine.view().lastTrigger,'score_reset');
});

test('Siempre verde: un reset viejo o una fuente desconocida no abre otra ventana después de confirmar',async()=>{
 const f=fixture();f.scores(99,0);await f.start();f.complete();await f.engine.tick();f.setRow({factions:[{name:'A',score:0},{name:'B',score:0},{name:'C',score:0}]});await f.engine.tick();assert.equal(f.calls.prepare.length,1);f.advance(90001);await f.engine.tick();assert.equal(f.calls.prepare.length,1);assert.equal(f.engine.view().status,'waiting_source');
});

test('Siempre verde: el cambio de mapa es un disparador, nunca una orden con coordenadas o apertura de juego',async()=>{
 const f=fixture();await f.start({startNow:false});f.advance(30000,{fresh:true});f.setRow({map:'Bakurani'});await f.engine.tick();assert.equal(f.calls.prepare.length,1);assert.equal(f.engine.view().lastTrigger,'map_changed');const grant=f.calls.prepare[0];assert.equal(grant.team,'green');assert.equal('x' in grant,false);assert.equal('joinId' in grant,false);assert.equal('launcher' in grant,false);
});

test('Siempre verde: se ignoran duplicados y muestras atrasadas, incluso si su marcador se modifica',async()=>{
 const f=fixture();await f.start({startNow:false});f.setRow({factions:[{name:'Lonestar',score:99},{name:'Valkyra',score:0},{name:'Manticore',score:0}]});await f.engine.tick();assert.equal(f.calls.prepare.length,0);f.setRow({sourceAt:'2026-11-02T18:59:59Z'});await f.engine.tick();assert.equal(f.calls.prepare.length,0);
});

test('Siempre verde: datos no fiables no generan intentos ni convierten una ausencia en final de partida',async()=>{
 for(const mutate of [f=>f.setRow({trusted:false}),f=>f.setRow({scoresTrusted:false}),f=>f.setRow({factions:[{name:'A',score:99},{name:'B',score:Infinity},{name:'C',score:0}]}),f=>f.setRow({factions:[{name:'A',score:99},{name:'A',score:0},{name:'C',score:0}]}),f=>f.advance(90001)]){
  const f=fixture();await f.start({startNow:false});f.scores(99);mutate(f);await f.engine.tick();assert.equal(f.calls.prepare.length,0);assert.equal(f.engine.view().status,'waiting_source');assert.equal(f.engine.view().enabled,true);
 }
});

test('Siempre verde: cambia ID interno o JOIN ID y requiere una acción nueva aunque nombre/número no cambien',async()=>{
 for(const value of [{apiId:9},{joinId:'22222222-2222-4222-8222-222222222222'}]){const f=fixture();await f.start({startNow:false});f.scores(99);f.setRow(value);await f.engine.tick();assert.equal(f.calls.prepare.length,0);assert.equal(f.engine.view().status,'paused_identity');f.setRow({apiId:3,joinId:JOIN});f.scores(99);await f.engine.tick();assert.equal(f.calls.prepare.length,0);}
});

test('Siempre verde: controlador muerto o sustituido tras una lectura fresca queda pausado, sin reinicio automático',async()=>{
 for(const mutation of [{controllerFresh:false,controllerAlive:false},{controllerSessionId:randomUUID()},{controllerPid:5678},{controllerReportStatus:'unexpected_format'}]){const f=fixture();await f.start();await f.engine.tick();f.complete();await f.engine.tick();f.setNative(mutation);await f.engine.tick();assert.equal(f.engine.view().status,'paused_controller');f.setNative({controllerFresh:true,controllerAlive:true,controllerPid:1234,controllerReportStatus:'read',controllerSessionId:f.native.sessionId});f.scores(99,180000);await f.engine.tick();assert.equal(f.calls.prepare.length,1);}
});

test('Siempre verde quieto: un hueco de 1–5 s espera sin trabajo activo y exige dos reportes frescos distintos antes de armar',async()=>{
 for(const delay of [1000,3000,5000]){
  const f=fixture();await f.start({startNow:false});await f.engine.tick();const old=f.stamp;f.scores(95,delay);f.setNative({controllerFresh:false,controllerReportAt:old});await f.engine.tick();assert.equal(f.engine.view().status,'waiting_controller');assert.equal(f.calls.prepare.length,0);assert.equal(f.calls.renew.length,0);
  const diagnostic=f.events.find(e=>e.kind==='persistent_team_controller_wait');assert.equal(diagnostic.controllerPid,1234);assert.equal(diagnostic.controllerAlive,true);assert.equal(diagnostic.controllerFresh,false);assert.equal(diagnostic.controllerReportAgeMs,delay);assert.equal('token' in diagnostic,false);
  f.setNative({controllerFresh:true,controllerReportAt:f.stamp});await f.engine.tick();assert.equal(f.engine.view().controllerRecovery.freshReports,1);await f.engine.tick();assert.equal(f.engine.view().controllerRecovery.freshReports,1);assert.equal(f.calls.prepare.length,0);
  f.advance(1000,{fresh:true});f.setNative({controllerReportAt:f.stamp});await f.engine.tick();assert.equal(f.calls.prepare.length,1);assert.equal(f.engine.view().status,'waiting_selector');assert.equal(f.events.some(e=>e.kind==='persistent_team_controller_recovered'),true);
 }
});

test('Siempre verde quieto: lectura temporalmente ausente sólo permite esperar con la identidad cacheada viva',async()=>{
 const f=fixture();await f.start({startNow:false});await f.engine.tick();const old=f.stamp;f.advance(4000,{fresh:true});f.setNative({controllerFresh:false,controllerReportAt:old,controllerReportRead:false,controllerReportStatus:'unavailable',controllerIdentitySource:'cached'});await f.engine.tick();assert.equal(f.engine.view().status,'waiting_controller');assert.equal(f.calls.prepare.length,0);
 f.setNative({controllerFresh:true,controllerReportRead:true,controllerReportStatus:'read',controllerIdentitySource:'report',controllerReportAt:f.stamp});await f.engine.tick();assert.equal(f.engine.view().status,'waiting_controller');f.advance(1000,{fresh:true});f.setNative({controllerReportAt:f.stamp});await f.engine.tick();assert.equal(f.engine.view().status,'watching');assert.equal(f.calls.prepare.length,0);
});

test('Siempre verde quieto: F8 propia durante un hueco corta incluso con reporte antiguo y no puede recuperarse',async()=>{
 const f=fixture();await f.start({startNow:false});await f.engine.tick();const old=f.stamp;f.advance(4000,{fresh:true});f.setNative({controllerFresh:false,controllerReportAt:old});await f.engine.tick();assert.equal(f.engine.view().status,'waiting_controller');f.setNative({controllerOperatorStoppedSessionId:f.native.sessionId});await f.engine.tick();assert.equal(f.engine.view().enabled,false);assert.match(f.engine.view().reason,/F8/);f.scores(99,1000);f.setNative({controllerFresh:true,controllerReportAt:f.stamp});await f.engine.tick();assert.equal(f.calls.prepare.length,0);
});

test('Siempre verde quieto: espera como máximo 15 s y no admite cambio PID/SID o retroceso monotónico durante el hueco',async()=>{
 for(const action of ['timeout','dead','pid','sid','clock']){
  const f=fixture();await f.start({startNow:false});await f.engine.tick();const old=f.stamp;f.advance(4000,{fresh:true});f.setNative({controllerFresh:false,controllerReportAt:old});await f.engine.tick();assert.equal(f.engine.view().status,'waiting_controller');
  if(action==='timeout')f.advance(15000,{fresh:true});else if(action==='dead')f.setNative({controllerAlive:false});else if(action==='pid')f.setNative({controllerPid:5678});else if(action==='sid')f.setNative({controllerReportSessionId:randomUUID()});else f.advance(-1,{wall:false});
  await f.engine.tick();assert.equal(f.engine.view().status,'paused_controller');assert.equal(f.calls.prepare.length,0);assert.equal(f.calls.renew.length,0);
 }
});

test('Siempre verde activo: un hueco de lectura sigue revocando entradas inmediatamente, sin recuperación quieta',async()=>{
 const f=fixture();await f.start();f.setNative({active:true,running:true,count:20});await f.engine.tick();f.setNative({controllerFresh:false});await f.engine.tick();assert.equal(f.engine.view().status,'paused_controller');assert.equal(f.native.enabled,false);assert.equal(f.engine.view().controllerRecovery,null);
});

test('Siempre verde: sustituir el PID durante la preparación posterior a quieto no concede clics',async()=>{
 const f=fixture();await f.start({startNow:false});await f.engine.tick();f.setPrepareHook(()=>f.setNative({controllerPid:5678}));f.scores(95);await f.engine.tick();assert.equal(f.native.enabled,false);assert.equal(f.engine.view().status,'paused_error');assert.equal(f.calls.renew.length,0);
});

test('Siempre verde: un ACK de la sesión anterior tiene ocho segundos de gracia al preparar la siguiente, sin apropiación',async()=>{
 for(const accepted of [true,false]){
  const f=fixture();await f.start();await f.engine.tick();const old=f.native.sessionId;f.complete();await f.engine.tick();f.scores(30,120000);await f.engine.tick();f.scores(95);await f.engine.tick();const latest=f.native.sessionId;assert.notEqual(old,latest);
  f.setNative({controllerSessionId:old});f.advance(1000);await f.engine.tick();assert.notEqual(f.engine.view().status,'paused_controller');
  if(accepted){f.setNative({controllerSessionId:latest});f.advance(1000);await f.engine.tick();assert.equal(f.engine.view().status,'waiting_selector');}
  else{f.advance(7000);await f.engine.tick();assert.equal(f.engine.view().status,'paused_controller');assert.equal(f.native.enabled,false);}
 }
});

test('Siempre verde: antes del primer ACK, archivo todavía ausente conserva sólo la gracia fría de ocho segundos',async()=>{
 const f=fixture();f.setNative({controllerFresh:false,controllerAlive:false,controllerReportRead:false,controllerReportStatus:'unavailable',controllerIdentitySource:'none',controllerPid:null});await f.start({startNow:false});f.advance(1000,{fresh:true});await f.engine.tick();assert.equal(f.engine.view().status,'watching');assert.equal(f.calls.prepare.length,0);f.advance(7000,{fresh:true});await f.engine.tick();assert.equal(f.engine.view().status,'paused_controller');assert.equal(f.calls.prepare.length,0);
});

test('Siempre verde: espera verde bloqueado durante más de cinco minutos después de adquirir el selector',async()=>{
 const f=fixture();await f.start();f.setNative({active:true,running:true,count:20});await f.engine.tick();assert.equal(f.engine.view().selectorAcquired,true);
 for(let n=0;n<12;n++){f.advance(30000,{fresh:true});await f.engine.tick();}
 assert.equal(f.engine.view().enabled,true);assert.equal(f.engine.view().status,'selecting');assert.equal(f.native.enabled,true);assert.equal(f.calls.prepare.length,1);assert.ok(f.calls.renew.length>0);
 f.complete();await f.engine.tick();assert.equal(f.engine.view().status,'watching');
});

test('Siempre verde: el límite del intento también usa reloj monotónico y nunca se renueva hasta infinito',async()=>{
 const f=fixture();await f.start({attemptMinutes:1,selectionTimeoutMinutes:2});f.setNative({active:true,count:10});await f.engine.tick();f.advance(120000,{wall:false});await f.engine.tick();assert.equal(f.native.enabled,false);assert.equal(f.engine.view().enabled,true);assert.equal(f.engine.view().status,'watching');assert.equal(f.calls.prepare.length,1);
});

test('Siempre verde: selección de otro color, propietario o parada inesperada no se anuncia como entrada propia',async()=>{
 for(const fields of [{ownerId:randomUUID()},{sessionId:randomUUID()},{enabled:false,entryConfirmation:{status:'confirmed',actualTeam:'blue'}}]){const f=fixture();await f.start();f.setNative(fields);await f.engine.tick();assert.equal(f.engine.view().status,'paused_error');assert.equal(f.engine.view().lastConfirmedAt,undefined);}
});

test('Siempre verde: conflicto de movimiento/entrada revoca el selector y bloquea reactivación silenciosa',async()=>{
 const f=fixture();await f.start();f.setConflict('Movimiento activo.');await f.engine.tick();assert.equal(f.native.enabled,false);assert.equal(f.engine.view().status,'paused_error');assert.equal(f.engine.view().reasonCode,'task_conflict');const recorded=f.events.findLast(value=>value.kind==='persistent_team_state');assert.equal(recorded.reasonCode,'task_conflict');assert.equal('reason' in recorded,false);f.setConflict(null);f.scores(99);await f.engine.tick();assert.equal(f.calls.prepare.length,1);
});

test('Siempre verde: cerrar o detener durante una preparación asíncrona no concede un intento tardío',async()=>{
 for(const action of ['stop','close']){const f=fixture();let resolve;f.setPrepareHook(()=>new Promise(done=>{resolve=done;}));const pending=f.start();assert.equal(f.engine.view().status,'preparing');f.engine[action]();resolve();await pending;assert.equal(f.engine.view().enabled,false);assert.equal(f.native.enabled,false);assert.equal(f.calls.renew.length,0);}
});

test('Siempre verde: rechazo de configuración no altera una selección anterior ni acepta duraciones inválidas',async()=>{
 const base={enabled:true,server:1,expectedJoinId:JOIN,team:'green',intervalMs:20};
 for(const invalid of [{server:0},{team:'any'},{intervalMs:1},{threshold:100},{threshold:true},{attemptMinutes:0},{selectionTimeoutMinutes:4},{selectionTimeoutMinutes:721},{startNow:'yes'},{expectedJoinId:'fake'}])assert.throws(()=>validatePersistentTeam({...base,...invalid}));
 const f=fixture();await f.start();await assert.rejects(f.start({team:'any'}));assert.equal(f.engine.view().enabled,true);assert.equal(f.calls.prepare.length,1);await assert.rejects(f.start());assert.equal(f.calls.prepare.length,1);
});

test('Siempre verde historial: fin administrativo por debajo de 95 y mismo mapa despierta una sola vez',async()=>{
 const f=fixture();f.setHistory(history(f));await f.start({startNow:false});await f.engine.tick();f.advance(10000,{fresh:true});
 const end='2026-11-02T19:00:05.000Z',done={id:100,startedAt:roundStart,endedAt:end};f.setHistory(history(f,{currentId:null,done,wake:historyWake(f,'completed',100,{endedAt:end})}));await f.engine.tick();assert.equal(f.calls.prepare.length,1);assert.equal(f.engine.view().lastTrigger,'round_completed');assert.equal(f.row.map,'Ozeti');assert.equal(f.row.factions.at(-1).score,30);
 await f.engine.tick();assert.equal(f.calls.prepare.length,1);
});

test('Siempre verde historial: un hecho válido no depende de disponer de puntuaciones, pero sí de la identidad reciente',async()=>{
 for(const invalidCatalog of [false,true]){
  const f=fixture();f.setRow({scoresTrusted:false,factions:[]});f.setHistory(history(f));await f.start({startNow:false});await f.engine.tick();f.advance(10000,{fresh:true});const end='2026-11-02T19:00:05Z';f.setHistory(history(f,{currentId:null,done:{id:100,startedAt:roundStart,endedAt:end},wake:historyWake(f,'completed',100,{endedAt:end})}));if(invalidCatalog)f.setRow({trusted:false});await f.engine.tick();assert.equal(f.calls.prepare.length,invalidCatalog?0:1);assert.equal(f.engine.view().status,invalidCatalog?'waiting_source':'waiting_selector');
 }
});

test('Siempre verde historial: la primera lectura de una preferencia nueva siempre es baseline silencioso',async()=>{
 const f=fixture();await f.start({startNow:false});await f.engine.tick();f.advance(10000,{fresh:true});const end='2026-11-02T19:00:05Z';const first=history(f,{currentId:null,done:{id:100,startedAt:roundStart,endedAt:end},wake:historyWake(f,'completed',100,{endedAt:end})});f.setHistory(first);await f.engine.tick();assert.equal(f.calls.prepare.length,0);assert.equal(f.engine.view().historyBaselineReady,true);await f.engine.tick();assert.equal(f.calls.prepare.length,0);
 f.advance(10000,{fresh:true});const start='2026-11-02T19:00:15Z';f.setHistory(history(f,{currentId:101,currentStartedAt:start,wake:historyWake(f,'new_round',101,{startedAt:start,nextRoundId:101})}));await f.engine.tick();assert.equal(f.calls.prepare.length,1);assert.equal(f.engine.view().lastTrigger,'round_changed');
});

test('Siempre verde historial: conserva un fin recibido durante un intento si ocurrió después de la captura real de entrada',async()=>{
 const f=fixture();f.setHistory(history(f));await f.start();f.advance(1000,{fresh:true});const captured=f.stamp;f.complete(captured);f.advance(2000,{fresh:true});const end='2026-11-02T19:00:02Z',next='2026-11-02T19:00:02.500Z';
 f.setHistory(history(f,{currentId:101,currentStartedAt:next,done:{id:100,startedAt:roundStart,endedAt:end},wake:historyWake(f,'completed',100,{endedAt:end,nextRoundId:101})}));await f.engine.tick();assert.equal(f.engine.view().status,'watching');assert.equal(f.engine.view().historyPendingCount,1);assert.equal(f.engine.view().selectionConfirmedAt,captured);assert.equal(f.calls.prepare.length,1);
 await f.engine.tick();assert.equal(f.calls.prepare.length,2);assert.equal(f.engine.view().lastTrigger,'round_completed');assert.equal(f.engine.view().historyPendingCount,0);
});

test('Siempre verde historial: un resultado tardío de la ronda anterior no rearma tras seleccionar ya la siguiente',async()=>{
 const f=fixture();f.setHistory(history(f));await f.start();f.advance(10000,{fresh:true});f.complete(f.stamp);await f.engine.tick();f.advance(1000,{fresh:true});const end='2026-11-02T19:00:05Z',next='2026-11-02T19:00:06Z';
 f.setHistory(history(f,{currentId:101,currentStartedAt:next,done:{id:100,startedAt:roundStart,endedAt:end},wake:historyWake(f,'completed',100,{endedAt:end,nextRoundId:101})}));await f.engine.tick();assert.equal(f.calls.prepare.length,1);assert.equal(f.engine.view().historyPendingCount,0);
 f.advance(1000,{fresh:true});f.setHistory(history(f,{currentId:101,currentStartedAt:next,wake:historyWake(f,'new_round',101,{startedAt:next,nextRoundId:101})}));await f.engine.tick();assert.equal(f.calls.prepare.length,1);
});

test('Siempre verde historial: el mismo fin enriquecido con la ronda nueva no crea una segunda adquisición',async()=>{
 const f=fixture();f.setHistory(history(f));await f.start({startNow:false});await f.engine.tick();f.advance(10000,{fresh:true});const end=f.stamp,done={id:100,startedAt:roundStart,endedAt:end},wake=historyWake(f,'completed',100,{endedAt:end});
 f.setHistory(history(f,{currentId:null,done,wake}));await f.engine.tick();assert.equal(f.calls.prepare.length,1);f.advance(5000,{fresh:true});const next='2026-11-02T19:00:12Z',enriched={...wake,nextRoundId:101};f.setHistory(history(f,{currentId:101,currentStartedAt:next,done,wake:enriched}));f.complete('2026-11-02T19:00:11Z');await f.engine.tick();assert.equal(f.engine.view().status,'watching');await f.engine.tick();assert.equal(f.calls.prepare.length,1);
 f.advance(1000,{fresh:true});f.setHistory(history(f,{currentId:101,currentStartedAt:next,done,wake:historyWake(f,'new_round',101,{startedAt:next,nextRoundId:101})}));await f.engine.tick();assert.equal(f.calls.prepare.length,1);assert.equal(f.engine.view().historyPendingCount,0);
});

test('Siempre verde historial: hechos de otro servidor, caducados, desconocidos o con fechas corruptas nunca despiertan',async()=>{
 const invalid=[value=>({...value,server:2}),value=>({...value,apiId:9}),value=>({...value,joinId:randomUUID()}),value=>({...value,status:'unknown'}),value=>({...value,sourceAt:'2026-11-02T18:55:00Z'}),value=>({...value,wake:{...value.wake,sourceAt:'2026-11-02T18:55:00Z'}}),value=>({...value,wake:{...value.wake,eventId:'other-event'}}),value=>({...value,wake:{...value.wake,endedAt:'not-a-date'}})];
 for(const mutate of invalid){const f=fixture();f.setHistory(history(f));await f.start({startNow:false});await f.engine.tick();f.advance(10000,{fresh:true});const end='2026-11-02T19:00:05Z',value=history(f,{currentId:null,done:{id:100,startedAt:roundStart,endedAt:end},wake:historyWake(f,'completed',100,{endedAt:end})});f.setHistory(mutate(value));await f.engine.tick();assert.equal(f.calls.prepare.length,0);}
});

test('Siempre verde historial: F8 y recuperación del controlador siguen precediendo a cualquier evento público',async()=>{
 for(const action of ['F8','gap']){const f=fixture();f.setHistory(history(f));await f.start({startNow:false});await f.engine.tick();const old=f.stamp;f.advance(10000,{fresh:true});const end='2026-11-02T19:00:05Z';f.setHistory(history(f,{currentId:null,done:{id:100,startedAt:roundStart,endedAt:end},wake:historyWake(f,'completed',100,{endedAt:end})}));if(action==='F8')f.setNative({operatorStoppedSessionId:f.native.sessionId});else f.setNative({controllerFresh:false,controllerReportAt:old});await f.engine.tick();assert.equal(f.calls.prepare.length,0);assert.equal(f.engine.view().status,action==='F8'?'disabled':'waiting_controller');}
});
