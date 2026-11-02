const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAutoSeeding,advanceAutoSeeding,isAdmittedSeedingContinuation}=require('../src/auto-seeding.cjs');
const {randomUUID}=require('node:crypto');
const now=Date.parse('2026-10-30T10:00:00Z');
const session=()=>createAutoSeeding({server:2,durationMinutes:60},now);
const inputs=()=>({server:{number:2,trusted:true,players:20,seedingActive:true},account:{seedingFresh:true,seeding:{servidor:2,estado:'aguantando',dentro:true}},screen:{status:'verified_capture',scene:'gameplay_hud',capturedAt:new Date(now).toISOString(),gameForeground:true,gamePid:6612},movement:{available:true,status:'stopped',armed:false}});
const admittedInputs=()=>{const i=inputs();i.server.seedingActive=false;i.server.publicRule={estado:'lleno',aguantando:true};return i;};
test('seeding automático: espera a 20 y arranca sin hotkey cuando presencia y pantalla coinciden',()=>{
 const s=session(),i=inputs();i.server.players=19;let r=advanceAutoSeeding(s,i,now);assert.equal(r.session.status,'waiting_match');assert.equal(r.command,null);
 i.server.players=20;r=advanceAutoSeeding(r.session,i,now);assert.equal(r.command,'start');assert.equal(r.session.status,'starting_movement');assert.equal(r.session.thresholdObservedAt,new Date(now).toISOString());assert.equal(r.session.startedMovementAt,null);
});
test('seeding automático: población sola, otro servidor, menús o capturas antiguas nunca arrancan',()=>{
 for(const alter of [i=>i.account.seedingFresh=false,i=>i.account.seeding.servidor=1,i=>i.screen.scene='main_menu',i=>i.screen.gameForeground=false,i=>i.screen.capturedAt=new Date(now-5001).toISOString(),i=>i.server.trusted=false]){const i=inputs();alter(i);assert.equal(advanceAutoSeeding(session(),i,now).command,null);}
});
test('seeding automático: cambiar de ventana pausa y volver a una escena válida reanuda sin F8',()=>{
 const i=inputs();let r=advanceAutoSeeding(session(),i,now);i.movement={available:true,status:'running',armed:true,autoSessionId:r.session.id};i.screen.gameForeground=false;
 r=advanceAutoSeeding(r.session,i,now);assert.equal(r.command,'stop');assert.equal(r.session.status,'waiting_game');
 i.movement.armed=false;i.movement.status='stopped';i.screen.gameForeground=true;r=advanceAutoSeeding(r.session,i,now);assert.equal(r.command,'start');
});
test('seeding automático: una bajada de población tras comenzar no presupone que la partida ha terminado',()=>{
 const i=inputs();let r=advanceAutoSeeding(session(),i,now);i.server.players=19;i.movement={available:true,status:'running',armed:true,autoSessionId:r.session.id};r=advanceAutoSeeding(r.session,i,now);assert.equal(r.session.status,'moving');assert.equal(r.command,null);
});
test('seeding automático: recuerda el umbral observado mientras se espera el despliegue',()=>{
 const i=inputs();i.screen.scene='main_menu';let r=advanceAutoSeeding(session(),i,now);assert.equal(r.command,null);assert.equal(r.session.status,'waiting_game');assert.equal(r.session.thresholdObservedAt,new Date(now).toISOString());
 i.server.players=19;i.screen.scene='gameplay_hud';r=advanceAutoSeeding(r.session,i,now);assert.equal(r.command,'start');assert.equal(r.session.startedMovementAt,null);
});

test('seeding automático: observar 20 antes del HUD no permite mover en un calentamiento posterior con un jugador',()=>{
 const i=inputs();i.screen.scene='main_menu';let r=advanceAutoSeeding(session(),i,now);assert.equal(r.session.thresholdObservedAt,new Date(now).toISOString());
 i.server.players=1;Object.assign(i.screen,{scene:'gameplay_hud',matchWaiting:true});r=advanceAutoSeeding(r.session,i,now);
 assert.equal(r.session.status,'waiting_match');assert.equal(r.session.thresholdObservedAt,null);assert.equal(r.command,null);assert.match(r.session.reason,/Calentamiento/);
 delete i.screen.matchWaiting;i.server.players=19;r=advanceAutoSeeding(r.session,i,now);assert.equal(r.session.status,'waiting_match');assert.equal(r.command,null);assert.equal(r.session.thresholdObservedAt,null);
 i.server.players=20;r=advanceAutoSeeding(r.session,i,now);assert.equal(r.command,'start');assert.equal(r.session.status,'starting_movement');
});

test('seeding automático: cartel fresco de espera detiene movimiento incluso con 20 y obliga a observar de nuevo el umbral',()=>{
 const i=inputs();let r=advanceAutoSeeding(session(),i,now);assert.equal(r.command,'start');i.movement={available:true,status:'running',armed:true,autoSessionId:r.session.id};
 i.screen.matchWaiting=true;r=advanceAutoSeeding(r.session,i,now);assert.equal(r.session.status,'waiting_match');assert.equal(r.command,'stop');assert.equal(r.session.thresholdObservedAt,null);assert.equal(r.session.operatorStopped,false);
 i.movement.armed=false;delete i.screen.matchWaiting;r=advanceAutoSeeding(r.session,i,now);assert.equal(r.command,'start');assert.equal(r.session.thresholdObservedAt,new Date(now).toISOString());
 i.server.players=19;i.movement={available:true,status:'running',armed:true,autoSessionId:r.session.id};r=advanceAutoSeeding(r.session,i,now);assert.equal(r.session.status,'moving');assert.equal(r.command,null);assert.ok(r.session.thresholdObservedAt);
});

test('seeding automático: señal de calentamiento caducada, no verificada o ajena no borra el umbral observado',()=>{
 const proof={entryId:randomUUID(),server:2,joinId:randomUUID(),gamePid:1234,gameWindow:5678,confirmedAt:new Date(now).toISOString()};
 const create=()=>createAutoSeeding({server:2,durationMinutes:30,presenceMode:'entry'},now,{trustedEntry:proof});
 const entryInput=()=>({...inputs(),screen:{status:'verified_capture',scene:'gameplay_hud',gameForeground:true,gamePid:1234,gameWindow:5678,capturedAt:new Date(now).toISOString()}});
 for(const edit of [i=>i.screen.capturedAt=new Date(now-5001).toISOString(),i=>i.screen.capturedAt=new Date(now+1).toISOString(),i=>i.screen.status='unknown',i=>i.screen.scene='unknown',i=>i.screen.gameForeground=false,i=>i.screen.gamePid=999,i=>i.screen.gameWindow=999]){
  const i=entryInput();let r=advanceAutoSeeding(create(),i,now);i.screen.matchWaiting=true;edit(i);r=advanceAutoSeeding(r.session,i,now);assert.equal(r.session.thresholdObservedAt,new Date(now).toISOString());assert.equal(r.session.status,'waiting_game');assert.notEqual(r.command,'start');
 }
 const i=entryInput();let r=advanceAutoSeeding(create(),i,now);i.screen.matchWaiting=true;r=advanceAutoSeeding(r.session,i,now);assert.equal(r.session.status,'waiting_match');assert.equal(r.session.thresholdObservedAt,null);
 const strict=entryInput();strict.screen.matchWaiting='true';assert.equal(advanceAutoSeeding(create(),strict,now).command,'start');
});

test('seeding automático: la falta temporal de presencia, fuente o controlador no oculta un calentamiento fresco',()=>{
 for(const edit of [i=>i.account.seedingFresh=false,i=>i.server.trusted=false,i=>i.movement.available=false]){
  const i=inputs();let r=advanceAutoSeeding(session(),i,now);assert.ok(r.session.thresholdObservedAt);const reset=structuredClone(i);edit(reset);reset.screen.matchWaiting=true;r=advanceAutoSeeding(r.session,reset,now);assert.equal(r.session.thresholdObservedAt,null);assert.notEqual(r.command,'start');
  i.server.players=1;r=advanceAutoSeeding(r.session,i,now);assert.equal(r.session.status,'waiting_match');assert.equal(r.command,null);assert.equal(r.session.thresholdObservedAt,null);
 }
});
test('seeding automático: parada explícita y límite impiden rearmados posteriores',()=>{
 const s=session(),i=inputs();i.movement.autoOperatorStopped=s.id;let r=advanceAutoSeeding(s,i,now);assert.equal(r.session.status,'cancelled');delete i.movement.autoOperatorStopped;assert.notEqual(advanceAutoSeeding(r.session,i,now).command,'start');
 r=advanceAutoSeeding(session(),i,now+3600000);assert.equal(r.session.status,'expired');assert.equal(r.command,'stop');
});

test('continuidad admitida: puede preparar movimiento con la admisión pública cerrada y cuenta dentro del ciclo',()=>{
 const i=admittedInputs();assert.equal(isAdmittedSeedingContinuation(i.server,i.account),true);
 const r=advanceAutoSeeding(session(),i,now);assert.equal(r.command,'start');assert.equal(r.session.status,'starting_movement');assert.equal(r.session.thresholdObservedAt,new Date(now).toISOString());
});

test('continuidad admitida: el cambio público true a false no detiene un ciclo privado reconocido',()=>{
 const i=inputs();let r=advanceAutoSeeding(session(),i,now);assert.equal(r.command,'start');
 i.movement={available:true,status:'running',armed:true,autoSessionId:r.session.id};i.server.seedingActive=false;i.server.publicRule={estado:'lleno',aguantando:true};
 r=advanceAutoSeeding(r.session,i,now);assert.equal(r.session.status,'moving');assert.equal(r.command,null);
 i.server.players=19;i.server.publicRule.estado='no_puntua';r=advanceAutoSeeding(r.session,i,now);assert.equal(isAdmittedSeedingContinuation(i.server,i.account),true);assert.equal(r.session.status,'moving');assert.equal(r.command,null);assert.equal(r.session.thresholdObservedAt,new Date(now).toISOString());
});

test('continuidad admitida: fuente, identidad y población públicas inválidas no sirven de prueba',()=>{
 for(const alter of [i=>delete i.server,i=>i.server.trusted=false,i=>i.server.trusted=1,i=>i.server.number=0,i=>i.server.number=6,i=>i.server.number='2',i=>delete i.server.players,i=>i.server.players='20',i=>i.server.players=-1,i=>i.server.players=101,i=>i.server.players=20.5]){
  const i=admittedInputs();alter(i);assert.equal(isAdmittedSeedingContinuation(i.server,i.account),false);
 }
});

test('continuidad admitida: ausencia, lectura antigua, otro servidor o fase pública incompatible bloquean o detienen',()=>{
 for(const alter of [i=>delete i.account,i=>i.account.seedingFresh=false,i=>delete i.account.seeding,i=>i.account.seeding.servidor=1,i=>i.account.seeding.estado='sedeando',i=>i.account.seeding.dentro=false,i=>i.account.seeding.dentro='true',i=>delete i.server.seedingActive,i=>i.server.seedingActive='false',i=>delete i.server.publicRule,i=>delete i.server.publicRule.aguantando,i=>i.server.publicRule.aguantando=false,i=>i.server.publicRule.estado='competicion',i=>i.server.publicRule.estado='desconocido']){
  const i=admittedInputs();alter(i);assert.equal(isAdmittedSeedingContinuation(i.server,i.account),false);
  const s=session();let r=advanceAutoSeeding(s,i,now);assert.equal(r.session.status,'waiting_source');assert.equal(r.command,null);
  i.movement={available:true,status:'running',armed:true,autoSessionId:s.id};r=advanceAutoSeeding(s,i,now);assert.equal(r.session.status,'waiting_source');assert.equal(r.command,'stop');
 }
});

test('continuidad admitida: respeta el umbral configurado y no lo deduce de la fase privada',()=>{
 const i=admittedInputs(),s=createAutoSeeding({server:2,durationMinutes:60,startPlayers:30},now);
 let r=advanceAutoSeeding(s,i,now);assert.equal(r.session.status,'waiting_match');assert.equal(r.command,null);assert.equal(r.session.thresholdObservedAt,null);
 i.server.players=30;r=advanceAutoSeeding(r.session,i,now);assert.equal(r.command,'start');assert.equal(r.session.thresholdObservedAt,new Date(now).toISOString());
 i.server.players=19;i.movement={available:true,status:'running',armed:true,autoSessionId:s.id};r=advanceAutoSeeding(r.session,i,now);assert.equal(r.session.status,'moving');assert.equal(r.command,null);
});

test('continuidad admitida: HUD, foco, parada explícita y duración siguen mandando',()=>{
 for(const alter of [i=>i.screen.scene='team_selection',i=>i.screen.gameForeground=false,i=>i.screen.capturedAt=new Date(now-5001).toISOString()]){
  const i=admittedInputs(),s=session();i.movement={available:true,status:'running',armed:true,autoSessionId:s.id};alter(i);const r=advanceAutoSeeding(s,i,now);assert.equal(r.session.status,'waiting_game');assert.equal(r.command,'stop');
 }
 const i=admittedInputs(),s=session();i.movement.autoOperatorStopped=s.id;let r=advanceAutoSeeding(s,i,now);assert.equal(r.session.status,'cancelled');assert.equal(r.command,'stop');delete i.movement.autoOperatorStopped;assert.notEqual(advanceAutoSeeding(r.session,i,now).command,'start');
 r=advanceAutoSeeding(session(),i,now+3600000);assert.equal(r.session.status,'expired');assert.equal(r.command,'stop');
});

const manualSession=()=>createAutoSeeding({server:2,durationMinutes:25,presenceMode:'manual',confirmedServer:2},now);

test('prueba manual: puede arrancar sin cuenta solo al alcanzar umbral y HUD reciente',()=>{
 const s=manualSession(),i=inputs();delete i.account;i.server.players=19;
 assert.equal(s.manualConfirmedAt,new Date(now).toISOString());assert.equal(s.manualConfirmedAt,s.createdAt);assert.equal(s.confirmedServer,2);assert.equal(s.presenceMode,'manual');assert.match(s.reason,/Prueba sin lectura Steam: presencia confirmada por el usuario/);
 let r=advanceAutoSeeding(s,i,now);assert.equal(r.session.status,'waiting_match');assert.equal(r.command,null);
 i.server.players=20;i.screen.scene='team_selection';r=advanceAutoSeeding(r.session,i,now);assert.equal(r.session.status,'waiting_game');assert.equal(r.command,null);
 i.screen.scene='gameplay_hud';r=advanceAutoSeeding(r.session,i,now);assert.equal(r.command,'start');assert.match(r.session.reason,/^Prueba sin lectura Steam:/);assert.equal(Object.hasOwn(r.session,'account'),false);
 const accountDefault=advanceAutoSeeding(session(),i,now);assert.equal(accountDefault.session.status,'waiting_presence');assert.equal(accountDefault.command,null);assert.equal(session().presenceMode,'account');assert.equal(session().manualConfirmedAt,null);
});

test('prueba manual: rechaza modo desconocido y confirmación ausente, distinta o no entera',()=>{
 for(const input of [{presenceMode:'other'},{presenceMode:'manual'},{presenceMode:'manual',confirmedServer:1},{presenceMode:'manual',confirmedServer:'2'},{presenceMode:'manual',confirmedServer:2.5}])assert.throws(()=>createAutoSeeding({server:2,durationMinutes:25,...input},now));
 for(const alter of [s=>delete s.confirmedServer,s=>s.confirmedServer=1,s=>s.manualConfirmedAt='bad',s=>s.manualConfirmedAt=new Date(now-1).toISOString(),s=>s.presenceMode='other']){
  const s=manualSession();alter(s);const r=advanceAutoSeeding(s,inputs(),now);assert.equal(r.session.status,'error');assert.equal(r.command,'stop');
 }
});

test('prueba manual: permite comprobar AFK con seeding cerrado y no habilita el modo de cuenta',()=>{
 const i=inputs();i.server.seedingActive=false;delete i.account;
 assert.equal(advanceAutoSeeding(manualSession(),i,now).command,'start');
 const account=advanceAutoSeeding(session(),i,now);assert.equal(account.command,null);assert.equal(account.session.status,'waiting_source');
});

test('prueba manual: conserva la identidad pública, controlador reciente, escena, foco y PID',()=>{
 for(const alter of [i=>i.server.trusted=false,i=>i.server.number=1,i=>delete i.server.players,i=>i.server.players='20',i=>i.movement.available=false,i=>i.movement.status='error',i=>i.screen.scene='buy_menu',i=>i.screen.gameForeground=false,i=>i.screen.gamePid=0,i=>i.screen.capturedAt=new Date(now-5001).toISOString(),i=>i.screen.capturedAt=new Date(now+1).toISOString()]){
  const i=inputs();delete i.account;alter(i);assert.notEqual(advanceAutoSeeding(manualSession(),i,now).command,'start');
 }
});

test('prueba manual: cambiar de ventana, F8 y duración siguen deteniendo movimiento',()=>{
 const s=manualSession(),i=inputs();delete i.account;i.movement={available:true,status:'running',armed:true,autoSessionId:s.id};i.screen.gameForeground=false;
 let r=advanceAutoSeeding(s,i,now);assert.equal(r.session.status,'waiting_game');assert.equal(r.command,'stop');assert.match(r.session.reason,/^Prueba sin lectura Steam:/);
 i.screen.gameForeground=true;i.movement.autoOperatorStopped=s.id;r=advanceAutoSeeding(r.session,i,now);assert.equal(r.command,'stop');assert.equal(r.session.status,'cancelled');delete i.movement.autoOperatorStopped;assert.notEqual(advanceAutoSeeding(r.session,i,now).command,'start');
 const expired=advanceAutoSeeding(manualSession(),inputs(),now+25*60000);assert.equal(expired.command,'stop');assert.equal(expired.session.status,'expired');assert.match(expired.session.reason,/sesión de prueba/);
});

const breakSession=()=>createAutoSeeding({purpose:'break',durationMinutes:5,intervalSeconds:30,holdMs:400,confirmedDeployed:true},now);

test('anti-AFK tras entrada: prueba interna de servidor/ventana sustituye sólo a la confirmación manual',()=>{
 const proof={entryId:randomUUID(),server:2,joinId:randomUUID(),gamePid:1234,gameWindow:5678,confirmedAt:new Date(now-1000).toISOString()};
 const s=createAutoSeeding({purpose:'break',server:2,durationMinutes:5,intervalSeconds:17,holdMs:700,presenceMode:'entry'},now,{trustedEntry:proof});
 assert.equal(s.purpose,'break');assert.equal(s.presenceMode,'entry');assert.equal(s.entryId,proof.entryId);assert.deepEqual(s.entryProof,proof);assert.equal(s.confirmedDeployed,undefined);assert.equal(s.confirmedServer,null);assert.equal(s.startPlayers,null);assert.equal(s.thresholdObservedAt,null);assert.equal(s.endAt,new Date(now+300000).toISOString());
 const i={movement:{available:true,status:'stopped',armed:false},screen:{status:'verified_capture',scene:'gameplay_hud',gameForeground:true,gamePid:1234,gameWindow:5678,capturedAt:new Date(now).toISOString()}};
 assert.equal(advanceAutoSeeding(s,i,now).command,'start');assert.equal(advanceAutoSeeding(s,i,now).session.thresholdObservedAt,null);
 for(const alter of [p=>delete p.entryId,p=>p.server=1,p=>p.gamePid=0,p=>p.gameWindow=0,p=>p.confirmedAt=new Date(now-5001).toISOString(),p=>p.confirmedAt=new Date(now+1).toISOString()]){const p=structuredClone(proof);alter(p);assert.throws(()=>createAutoSeeding({purpose:'break',server:2,durationMinutes:5,presenceMode:'entry'},now,{trustedEntry:p}),/entrada automática/);}
 assert.throws(()=>createAutoSeeding({purpose:'break',server:2,durationMinutes:5,presenceMode:'entry',entryProof:proof,trustedEntry:proof,confirmedDeployed:true},now),/entrada automática/);
});

test('anti-AFK de entrada conserva vínculo, HUD reciente, F8 y fin sin generar recuperación de seeding',()=>{
 const proof={entryId:randomUUID(),server:2,joinId:randomUUID(),gamePid:1234,gameWindow:5678,confirmedAt:new Date(now).toISOString()};
 const create=()=>createAutoSeeding({purpose:'break',server:2,durationMinutes:5,presenceMode:'entry'},now,{trustedEntry:proof});
 const input=()=>({movement:{available:true,status:'stopped',armed:false},screen:{status:'verified_capture',scene:'gameplay_hud',gameForeground:true,gamePid:1234,gameWindow:5678,capturedAt:new Date(now).toISOString()}});
 for(const alter of [i=>i.screen.gamePid=999,i=>i.screen.gameWindow=999,i=>i.screen.gameForeground=false,i=>i.screen.capturedAt=new Date(now-5001).toISOString(),i=>i.screen.scene='unknown']){const i=input();alter(i);assert.notEqual(advanceAutoSeeding(create(),i,now).command,'start');}
 for(const alter of [s=>s.entryId=randomUUID(),s=>s.entryProof=null,s=>s.server=1,s=>s.confirmedDeployed=true,s=>s.deploymentConfirmedAt=s.createdAt+'x']){const s=create();alter(s);assert.equal(advanceAutoSeeding(s,input(),now).session.status,'error');}
 const stopped=create(),i=input();i.movement.autoOperatorStopped=stopped.id;const result=advanceAutoSeeding(stopped,i,now);assert.equal(result.session.status,'cancelled');delete i.movement.autoOperatorStopped;assert.notEqual(advanceAutoSeeding(result.session,i,now).command,'start');
 assert.equal(advanceAutoSeeding(create(),input(),now+300000).session.status,'expired');
 const restart=input();Object.assign(restart.screen,{scene:'server_restart',restartConfirmed:true,frameId:randomUUID()});const ended=advanceAutoSeeding(create(),restart,now);assert.equal(ended.session.status,'error');assert.equal(ended.command,'stop');assert.equal(ended.session.disconnect,undefined);
});

test('movimiento temporal: no depende de servidor, población, cuenta Steam ni admisión',()=>{
 const s=breakSession();assert.equal(s.purpose,'break');assert.equal(s.server,null);assert.equal(s.startPlayers,null);assert.equal(s.confirmedDeployed,true);assert.doesNotMatch(s.reason,/Steam|población|seeding|VIP/);
 const i=inputs();delete i.server;delete i.account;
 let r=advanceAutoSeeding(s,i,now);assert.equal(r.command,'start');assert.equal(r.session.status,'starting_movement');assert.equal(r.session.thresholdObservedAt,null);
 i.server={number:5,trusted:false,players:0,seedingActive:false};i.account={seedingFresh:false};i.movement={available:true,status:'running',armed:true,autoSessionId:s.id};
 r=advanceAutoSeeding(r.session,i,now);assert.equal(r.session.status,'moving');assert.equal(r.command,null);assert.doesNotMatch(r.session.reason,/Steam|prueba|seeding|VIP/);
});

test('movimiento temporal independiente conserva su autorización aunque el HUD muestre calentamiento',()=>{
 const i=inputs();delete i.server;delete i.account;i.screen.matchWaiting=true;let r=advanceAutoSeeding(breakSession(),i,now);assert.equal(r.command,'start');assert.equal(r.session.thresholdObservedAt,null);
 i.movement={available:true,status:'running',armed:true,autoSessionId:r.session.id};r=advanceAutoSeeding(r.session,i,now);assert.equal(r.session.status,'moving');assert.equal(r.command,null);
 const proof={entryId:randomUUID(),server:2,joinId:randomUUID(),gamePid:1234,gameWindow:5678,confirmedAt:new Date(now).toISOString()};
 const entryBreak=createAutoSeeding({purpose:'break',server:2,durationMinutes:5,presenceMode:'entry'},now,{trustedEntry:proof});Object.assign(i.screen,{gamePid:1234,gameWindow:5678});i.movement={available:true,status:'stopped',armed:false};assert.equal(advanceAutoSeeding(entryBreak,i,now).command,'start');
});

test('movimiento temporal: exige autorización explícita y rechaza confirmaciones alteradas',()=>{
 for(const confirmedDeployed of [undefined,false,'true',1])assert.throws(()=>createAutoSeeding({purpose:'break',durationMinutes:5,confirmedDeployed},now),/Confirma/);
 assert.throws(()=>createAutoSeeding({purpose:'unknown',server:2,durationMinutes:5},now),/sesión/);
 for(const alter of [s=>s.confirmedDeployed=false,s=>s.deploymentConfirmedAt='bad',s=>s.deploymentConfirmedAt=new Date(now+1).toISOString(),s=>s.server=2,s=>s.startPlayers=1,s=>s.presenceMode='account']){
  const s=breakSession();alter(s);const r=advanceAutoSeeding(s,inputs(),now);assert.equal(r.session.status,'error');assert.equal(r.command,'stop');
 }
});

test('movimiento temporal: HUD reciente y foco siguen siendo obligatorios y una pausa exige pruebas nuevas',()=>{
 for(const alter of [i=>i.screen.scene='team_selection',i=>i.screen.gameForeground=false,i=>i.screen.gamePid=0,i=>i.screen.capturedAt=new Date(now-5001).toISOString(),i=>i.screen.capturedAt=new Date(now+1).toISOString(),i=>i.movement.available=false,i=>i.movement.status='error']){
  const i=inputs();alter(i);assert.notEqual(advanceAutoSeeding(breakSession(),i,now).command,'start');
 }
 const s=breakSession(),i=inputs();i.movement={available:true,status:'running',armed:true,autoSessionId:s.id};i.screen.gameForeground=false;
 let r=advanceAutoSeeding(s,i,now);assert.equal(r.command,'stop');assert.equal(r.session.status,'waiting_game');
 i.movement.armed=false;i.screen.gameForeground=true;i.screen.capturedAt=new Date(now-5001).toISOString();r=advanceAutoSeeding(r.session,i,now);assert.notEqual(r.command,'start');
 i.screen.capturedAt=new Date(now).toISOString();r=advanceAutoSeeding(r.session,i,now);assert.equal(r.command,'start');
});

test('movimiento temporal: F8, fin y otro controlador no permiten continuar',()=>{
 const s=breakSession(),i=inputs();i.movement.autoOperatorStopped=s.id;
 let r=advanceAutoSeeding(s,i,now);assert.equal(r.session.status,'cancelled');assert.equal(r.command,'stop');delete i.movement.autoOperatorStopped;assert.notEqual(advanceAutoSeeding(r.session,i,now).command,'start');
 r=advanceAutoSeeding(breakSession(),i,now+5*60000);assert.equal(r.session.status,'expired');assert.equal(r.command,'stop');assert.match(r.session.reason,/movimiento temporal/);
 i.movement={available:true,armed:true,status:'running',autoSessionId:'other'};r=advanceAutoSeeding(breakSession(),i,now);assert.equal(r.session.status,'error');assert.equal(r.command,'stop');
});

test('entrada propia: sólo el reinicio estricto fresco deja una evidencia de recuperación; nunca una expulsión AFK',()=>{
 const proof={entryId:randomUUID(),server:2,joinId:randomUUID(),gamePid:1234,gameWindow:5678,confirmedAt:new Date(now).toISOString()};
 const create=()=>createAutoSeeding({server:2,durationMinutes:30,presenceMode:'entry'},now,{trustedEntry:proof});
 const input=()=>({...inputs(),screen:{status:'verified_capture',scene:'server_restart',restartConfirmed:true,gameForeground:true,gamePid:1234,gameWindow:5678,frameId:randomUUID(),capturedAt:new Date(now).toISOString()}});
 const s=create(),i=input(),r=advanceAutoSeeding(s,i,now);assert.equal(r.session.status,'error');assert.equal(r.command,'stop');assert.deepEqual(r.session.disconnect,{cause:'server_restart',confirmed:true,entryId:proof.entryId,seedingId:s.id,server:2,joinId:proof.joinId,gamePid:1234,gameWindow:5678,frameId:i.screen.frameId,capturedAt:i.screen.capturedAt});assert.equal(r.session.operatorStopped,false);
 for(const alter of [i=>i.screen.restartConfirmed=false,i=>delete i.screen.restartConfirmed,i=>i.screen.scene='afk_kick',i=>i.screen.scene='server_message_unknown',i=>i.screen.frameId='old',i=>i.screen.gameWindow=999,i=>i.screen.capturedAt=new Date(now-5001).toISOString(),i=>i.account.seeding.servidor=1]){const i=input();alter(i);assert.equal(advanceAutoSeeding(create(),i,now).session.disconnect,undefined);}
 assert.equal(advanceAutoSeeding(manualSession(),input(),now).session.disconnect,undefined);
 const stopped=create();stopped.operatorStopped=true;assert.equal(advanceAutoSeeding(stopped,input(),now).session.disconnect,undefined);
});
