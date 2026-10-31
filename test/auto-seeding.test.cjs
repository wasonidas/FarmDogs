const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAutoSeeding,advanceAutoSeeding,isAdmittedSeedingContinuation}=require('../src/auto-seeding.cjs');
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

test('movimiento temporal: no depende de servidor, población, cuenta Steam ni admisión',()=>{
 const s=breakSession();assert.equal(s.purpose,'break');assert.equal(s.server,null);assert.equal(s.startPlayers,null);assert.equal(s.confirmedDeployed,true);assert.doesNotMatch(s.reason,/Steam|población|seeding|VIP/);
 const i=inputs();delete i.server;delete i.account;
 let r=advanceAutoSeeding(s,i,now);assert.equal(r.command,'start');assert.equal(r.session.status,'starting_movement');assert.equal(r.session.thresholdObservedAt,null);
 i.server={number:5,trusted:false,players:0,seedingActive:false};i.account={seedingFresh:false};i.movement={available:true,status:'running',armed:true,autoSessionId:s.id};
 r=advanceAutoSeeding(r.session,i,now);assert.equal(r.session.status,'moving');assert.equal(r.command,null);assert.doesNotMatch(r.session.reason,/Steam|prueba|seeding|VIP/);
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
