'use strict';
const {randomUUID}=require('node:crypto');

const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const TERMINAL=new Set(['completed','cancelled','expired','error','interrupted']);
const REAL_TEAMS=new Set(['blue','red','green']);
const TEAMS=new Set(['any',...REAL_TEAMS]);
const DRIVER_PHASES={waiting_game:'waiting_game',opening:'waiting_game',navigating:'navigating',joining:'joining',team_selector:'choosing_team',deploying:'deploying',gameplay_hud:'deploying'};
const text=value=>String(value?.message||value||'Error desconocido.').replace(/[\u0000-\u001f]/g,' ').slice(0,400);

// One owner coordinates the native entry driver, team clicker, then movement.
// A completed join request is not a connection proof: a fresh HUD and the exact
// same verified entry chain are required before the movement handoff.
function createEntryFlow({now=Date.now,monoNow=()=>performance.now(),driver,launcher,teamClicker,automatic,event=()=>{},getTarget,getInputs=()=>({})}={}){
 let current=null,startedMono=null,budgetMs=null,startPending=false,tickPending=null,closed=false;
 let driverRequested=false,driverReleased=false,teamPrepared=false,teamReleased=false,teamCompleted=false;
 let movementSessionId=null,teamSessionId=null,boundGame=null,deploymentProof=null;
 const active=()=>!!current&&!TERMINAL.has(current.status);
 const emit=(kind,detail)=>{try{event(kind,detail);}catch{}};
 const view=()=>current?structuredClone({...current,movementSessionId,teamSessionId,cleanupPending:!active()&&(startPending||!!tickPending||driverBlocking(current.id)||teamBlocking(current.id))}):null;
 const same=id=>!closed&&current?.id===id&&active();
 function update(status,reason,extra={}){
  const changed=current.status!==status;current={...current,status,reason,...extra};
  if(changed)emit('entry_flow_state',{id:current.id,server:current.server,status});
 }
 function nativeDriver(){try{return driver?.view?.()||null;}catch{return null;}}
 function nativeTeam(){try{return teamClicker?.view?.()||null;}catch{return null;}}
 function driverBlocking(id){
  try{if(typeof driver?.blocking==='function')return driver.blocking(id)===true;}catch{return true;}
  const d=nativeDriver();return (!d?.sessionId||d.sessionId===id)&&(d?.blocking===true||d?.stopping===true||d?.armed===true||d?.running===true);
 }
 function teamBlocking(id){
  const t=nativeTeam();if(t?.ownerId!==id)return false;
  try{if(typeof teamClicker?.blocking==='function')return teamClicker.blocking()===true;}catch{return true;}
  return t.enabled===true||t.armed===true||t.running===true||t.stopping===true||t.blocking===true;
 }
 function recordCleanupError(id,error){if(current?.id===id){current={...current,cleanupErrors:[...(current.cleanupErrors||[]),text(error)]};emit('entry_flow_cleanup_error',{id,message:text(error)});}}
 function cleanupCall(id,action){try{const result=action();if(result&&typeof result.then==='function')void result.catch(error=>recordCleanupError(id,error));}catch(error){recordCleanupError(id,error);}}
 function releaseDriver(id,reason){
  const d=nativeDriver();
  if(driverRequested&&(!d?.sessionId||d.sessionId===id))cleanupCall(id,()=>driver.stop({ownerId:id,reason}));
  driverReleased=true;
 }
 function releaseTeam(id){
  if(teamPrepared&&nativeTeam()?.ownerId===id)cleanupCall(id,()=>teamClicker.releaseOwned(id));
  teamReleased=true;
 }
 function ownMovement(id){const m=automatic?.view?.();return m&&(m.id===movementSessionId||m.entryId===id||m.entryProof?.entryId===id)?m:null;}
 function cleanup(id,reason){
  releaseDriver(id,reason);releaseTeam(id);
  if(ownMovement(id))cleanupCall(id,()=>automatic.stop(reason));
 }
 function finish(status,reason){
  if(!current)return null;
  const id=current.id;update(status,reason,{finishedAt:new Date(now()).toISOString()});
  if(status!=='completed')cleanup(id,reason);
  emit('entry_flow_finished',{id,server:current.server,status});return view();
 }
 function stop(reason='Entrada automática detenida por el usuario.'){
  if(!current)return null;
  // Even after a successful handoff, Stop can cancel its own movement session.
  // It can never cancel a new manually started session or another owner.
  current={...current,operatorStopped:true};return finish('cancelled',reason);
 }
 function remaining(){
  const mono=monoNow();
  if(!Number.isFinite(mono)||!Number.isFinite(startedMono)||mono<startedMono)return 0;
  return Math.min(Date.parse(current.endAt)-now(),budgetMs-(mono-startedMono));
 }
 function validTarget(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Ajustes de entrada no válidos.');
  if(!Number.isInteger(input.server)||input.server<1||input.server>5||!UUID.test(input.joinId||''))throw Error('Elige un servidor y su ID de entrada reciente.');
  if(!TEAMS.has(input.team))throw Error('Elige Aleatorio, azul, rojo o verde.');
  if(input.team==='any'&&nativeTeam()?.automaticAnyTeamAvailable!==true)throw Error('Actualiza el controlador para entrar en un equipo aleatorio.');
  if(typeof input.seeding!=='boolean')throw Error('Indica si quieres iniciar seeding después de entrar.');
  if(input.initialFocus!==undefined&&!['driver','desktop'].includes(input.initialFocus))throw Error('Modo de foco inicial no válido.');
  if(!Number.isInteger(input.durationMinutes)||input.durationMinutes<1||input.durationMinutes>720)throw Error('Duración de 1 a 720 minutos.');
  const intervalSeconds=input.intervalSeconds??60,holdMs=input.holdMs??500,startPlayers=input.startPlayers??20;
  if(!Number.isInteger(intervalSeconds)||intervalSeconds<5||intervalSeconds>300||!Number.isInteger(holdMs)||holdMs<100||holdMs>2000||!Number.isInteger(startPlayers)||startPlayers<1||startPlayers>100)throw Error('Ajustes de movimiento fuera de rango.');
  if(Object.hasOwn(input,'trustedEntry')||Object.hasOwn(input,'entryProof'))throw Error('La entrada se confirma mediante el controlador, no mediante el formulario.');
  const target=getTarget(input.server,input.joinId);
  if(target?.server!==input.server||String(target.joinId).toLowerCase()!==input.joinId.toLowerCase())throw Error('El destino de entrada cambió. Actualiza los servidores.');
  return {server:input.server,joinId:target.joinId,team:input.team,seeding:input.seeding,durationMinutes:input.durationMinutes,intervalSeconds,holdMs,startPlayers,initialFocus:input.initialFocus??'driver'};
 }
 async function start(input,{endAt=null}={}){
  if(closed)throw Error('La entrada automática está cerrada.');
  if(active()||startPending||tickPending)throw Error('Ya hay una entrada automática en curso o deteniéndose.');
  const settings=validTarget(input),at=now(),mono=monoNow();
  if(!Number.isFinite(at)||!Number.isFinite(mono))throw Error('El reloj de la sesión no es válido.');
  let end=at+settings.durationMinutes*60000;
  if(endAt!==null){const cap=Date.parse(endAt);if(!Number.isFinite(cap)||cap<=at||cap>end)throw Error('Límite externo de entrada no válido.');end=cap;}
  const motion=getInputs(settings)?.movement;
  if(automatic?.active?.()||motion?.armed===true||motion?.busy===true||teamClicker?.blocking?.()===true||driverBlocking())throw Error('Detén el otro automatismo antes de preparar una entrada.');
  current={id:randomUUID(),...settings,createdAt:new Date(at).toISOString(),endAt:new Date(end).toISOString(),status:'opening',reason:'Abriendo Wardogs y preparando la entrada automática.',connected:false,operatorStopped:false};
  startedMono=mono;budgetMs=end-at;driverRequested=false;driverReleased=false;teamPrepared=false;teamReleased=false;teamCompleted=false;movementSessionId=null;teamSessionId=null;boundGame=null;deploymentProof=null;
  const candidate=structuredClone(current),id=current.id;startPending=true;emit('entry_flow_started',{id,server:current.server,seeding:current.seeding});
  try{
   driverRequested=true;await driver.start({id,server:current.server,joinId:current.joinId,endAt:current.endAt,initialFocus:current.initialFocus});
   if(!same(id)){cleanup(id,'Entrada cancelada antes de abrir Wardogs.');return current?.id===id?view():{...candidate,status:'interrupted'};}
   if(remaining()<=0){finish('expired','Terminó el tiempo de entrada automática.');return view();}
   current={...current,launchRequestedAt:new Date(now()).toISOString()};await launcher.openGame();
   if(!same(id)){cleanup(id,'Entrada cancelada durante la apertura de Wardogs.');return current?.id===id?view():{...candidate,status:'interrupted'};}
   if(remaining()<=0)finish('expired','Terminó el tiempo durante la apertura de Wardogs.');
   else update('waiting_game','Esperando Wardogs para completar la entrada.');
   return view();
  }catch(error){if(same(id)){const stopped=error?.code==='ENTRY_CANCELLED'||nativeDriver()?.phase==='cancelled';if(stopped)current={...current,operatorStopped:true};finish(stopped?'cancelled':'error',stopped?'Detenido con F8 antes de abrir Wardogs.':'No se pudo completar la apertura; no se repetirá automáticamente: '+text(error));}else cleanup(id,'Entrada interrumpida durante la apertura.');throw error;}
  finally{startPending=false;}
 }
 function proof(d,id){
  const age=now()-Date.parse(d?.capturedAt),stateAge=now()-Date.parse(d?.at||d?.capturedAt);
  return d?.sessionId===id&&d.chainConfirmed===true&&d.server===current.server&&String(d.joinId).toLowerCase()===current.joinId.toLowerCase()&&Number.isInteger(d.gamePid)&&d.gamePid>0&&Number.isSafeInteger(d.gameWindow)&&d.gameWindow>0&&UUID.test(d.frameId||'')&&Number.isFinite(age)&&age>=0&&age<=5000&&Number.isFinite(stateAge)&&stateAge>=0&&stateAge<=5000;
 }
 async function tickInternal(id){
  if(!same(id)||startPending)return;
  if(remaining()<=0){finish('expired','Fin de la duración elegida para entrar y seedear.');return;}
  const motion=getInputs(view())?.movement;
  if(motion?.autoOperatorStopped===id||movementSessionId&&motion?.autoOperatorStopped===movementSessionId){current={...current,operatorStopped:true};finish('cancelled','Detenido con F8.');return;}
  if(!driverReleased&&typeof driver.tick==='function'){
   const reading=driver.tick();
   // The team controller has its own fresh visual checks and short lease.
   // Slow OCR must not block lease renewal or consumption of DESPLEGANDO.
   if(teamPrepared&&!teamCompleted)void Promise.resolve(reading).catch(error=>{if(same(id))finish('error','No se pudo comprobar el juego: '+text(error));});
   else await reading;
  }
  if(!same(id))return;
  if(remaining()<=0){finish('expired','Terminó el tiempo mientras se comprobaba la entrada.');return;}
  const d=nativeDriver();
  if(d?.sessionId&&d.sessionId!==id){finish('error','El controlador de entrada pertenece a otra sesión.');return;}
  if(!driverReleased&&(d?.phase==='cancelled'||d?.operatorStopped===true)){current={...current,operatorStopped:true};finish('cancelled',d.reason||'Entrada cancelada por el controlador.');return;}
  if(!driverReleased&&(d?.phase==='error'||d?.error||d?.chainInvalidated===true||['afk_kick','server_restart','join_wrong_server'].includes(d?.phase))){finish('error',d.reason||d.error||'La entrada no pudo verificarse; no se reconecta automáticamente.');return;}
  const qualified=proof(d,id);
  if(boundGame&&qualified&&(d.gamePid!==boundGame.gamePid||d.gameWindow!==boundGame.gameWindow)){finish('error','La ventana del juego cambió durante la entrada.');return;}
  if(!teamPrepared){
   if(d?.phase!=='team_selector'||!qualified){update(DRIVER_PHASES[d?.phase]&&DRIVER_PHASES[d.phase]!=='choosing_team'?DRIVER_PHASES[d.phase]:'waiting_game',d?.reason||'Esperando una pantalla actual de la entrada.');return;}
   boundGame={gamePid:d.gamePid,gameWindow:d.gameWindow};current={...current,...boundGame,entryConfirmedAt:d.capturedAt};teamPrepared=true;
   update('choosing_team','Preparando el controlador de equipos. Espera sin tocar el juego.');
   const prepared=await teamClicker.prepareOwned({ownerId:id,team:current.team,endAt:current.endAt,canArm:async()=>{
    if(!same(id)||remaining()<=0||typeof driver.checkReady!=='function'||await driver.checkReady(id)!==true)return false;
    const live=nativeDriver();
    return same(id)&&remaining()>0&&live?.sessionId===id&&live.chainConfirmed===true&&live.chainInvalidated!==true&&live.operatorStopped!==true&&live.phase!=='cancelled'&&live.phase!=='error'&&!live.error&&live.server===current.server&&String(live.joinId).toLowerCase()===current.joinId.toLowerCase()&&live.gamePid===boundGame.gamePid&&live.gameWindow===boundGame.gameWindow;
   }});
   if(!same(id)){cleanup(id,'Entrada cancelada al preparar el equipo.');return;}
   if(remaining()<=0){finish('expired','Terminó el tiempo al preparar el equipo.');return;}
   const checked=nativeDriver();
   if(checked?.operatorStopped===true||checked?.phase==='cancelled'){current={...current,operatorStopped:true};finish('cancelled',checked.reason||'Detenido con F8 antes de preparar el equipo.');return;}
   if(checked?.phase==='error'||checked?.chainInvalidated===true){finish('error',checked.reason||'La entrada dejó de ser válida durante la preparación del equipo.');return;}
   const t=nativeTeam();
   if((t||prepared)?.ownerId!==id){finish('error','No se pudo asignar la selección de equipo a esta entrada.');return;}
   teamSessionId=t?.sessionId||prepared?.sessionId||null;return;
  }
  if(!teamCompleted){
   const t=nativeTeam();
   if(t?.ownerId!==id||teamSessionId&&t?.sessionId!==teamSessionId){finish('error','La selección de equipo cambió de propietario.');return;}
   const confirmation=t.entryConfirmation,completedId=confirmation?.attemptId||t.completedAttemptId;
   const captured=Date.parse(confirmation?.capturedAt),confirmationAge=now()-captured;
   const actualTeam=confirmation?.actualTeam;
   const validTeam=current.team==='any'?REAL_TEAMS.has(actualTeam):actualTeam===undefined||actualTeam===current.team;
   const completed=validTeam&&confirmation?.status==='confirmed'&&UUID.test(completedId||'')&&(!t.completedAttemptId||t.completedAttemptId===completedId)&&confirmation.gamePid===boundGame.gamePid&&confirmation.gameWindow===boundGame.gameWindow&&UUID.test(confirmation.frameId||'')&&Number.isFinite(confirmationAge)&&confirmationAge>=0&&confirmationAge<=5000&&captured>=Date.parse(current.entryConfirmedAt);
   if(completed){teamCompleted=true;current={...current,actualTeam:actualTeam||current.team,teamChosenAt:new Date(now()).toISOString(),teamAttemptId:t.entryConfirmation?.attemptId||t.completedAttemptId};releaseTeam(id);update('deploying','Equipo elegido. Esperando el personaje desplegado.');}
   else if(t.enabled!==true||t.error){finish(t?.operatorStopped===true?'cancelled':'error',t.error||t.reason||'La espera de equipo se detuvo. Activa una entrada nueva.');return;}
   else{update('choosing_team',t.reason||'Intentando entrar continuamente en el equipo elegido.');return;}
  }
  if(!driverReleased){
   if(d?.phase!=='gameplay_hud'||!qualified){update('deploying',d?.reason||'Esperando una captura actual del personaje desplegado.');return;}
   deploymentProof={...d};current={...current,deployedAt:d.capturedAt,connected:true,connectionSource:'verified_entry_ui_chain'};
  }
  if(!proof(deploymentProof,id)){finish('error','La prueba de despliegue caducó antes de terminar el traspaso de control.');return;}
  if(!driverReleased)releaseDriver(id,'Entrada completada. Entregando el control al seeding.');
  if(!teamReleased)releaseTeam(id);
  if(driverBlocking(id)||teamBlocking(id)){update('deploying','Esperando que terminen los controles de entrada y equipo.');return;}
  if(!current.seeding){finish('completed','Entrada al servidor y al equipo completada.');return;}
  const remainingMs=remaining();if(remainingMs<=0){finish('expired','Terminó el tiempo antes de iniciar seeding.');return;}
  const trustedEntry={entryId:id,server:current.server,joinId:current.joinId,...boundGame,confirmedAt:deploymentProof.capturedAt};
  update('starting_seeding','Entrada completada. Preparando el movimiento de seeding.');
  const session=await automatic.start({purpose:'seeding',presenceMode:'entry',server:current.server,durationMinutes:Math.max(1,Math.ceil(remainingMs/60000)),startPlayers:current.startPlayers,intervalSeconds:current.intervalSeconds,holdMs:current.holdMs},{endAt:current.endAt,trustedEntry});
  const prepared=automatic.view(),owned=prepared?.entryId===id||prepared?.entryProof?.entryId===id;
  if(owned&&prepared.id===session?.id)movementSessionId=session.id;
  if(!same(id)){cleanup(id,'Entrada cancelada antes de entregar el movimiento.');return;}
  if(remaining()<=0){finish('expired','Terminó el tiempo al preparar el movimiento de seeding.');return;}
  if(!UUID.test(movementSessionId||'')||prepared?.id!==movementSessionId||!owned||!automatic.active()){finish('error','El seeding no quedó preparado para esta entrada.');return;}
  finish('completed','Entrada completada y seeding preparado. El movimiento esperará sus condiciones.');
 }
 async function tick(){
  if(closed||!active()||startPending)return;
  const id=current.id;
  // This part runs on every timer call, even while an earlier OCR is pending.
  if(remaining()<=0){finish('expired','Fin de la duración elegida para entrar y seedear.');return;}
  if(teamPrepared&&!teamReleased&&!teamCompleted){
   const d=nativeDriver(),t=nativeTeam();
   if(d?.operatorStopped===true||d?.phase==='cancelled'){current={...current,operatorStopped:true};finish('cancelled',d.reason||'Detenido con F8.');return;}
   if(d?.phase==='error'||d?.chainInvalidated===true){finish('error',d.reason||'La entrada dejó de ser válida.');return;}
   if(t?.ownerId===id&&(!teamSessionId||t.sessionId===teamSessionId)&&t.enabled===true){try{teamClicker.renewOwned(id);}catch(error){finish('error',text(error));return;}}
  }
  if(tickPending)return tickPending;
  const pending=Promise.resolve().then(()=>tickInternal(id)).catch(error=>{if(same(id))finish('error','Error durante la entrada automática: '+text(error));else cleanup(id,'Entrada interrumpida.');});
  tickPending=pending;try{await pending;}finally{if(tickPending===pending)tickPending=null;}
 }
 function close(){if(closed)return;try{if(current&&(active()||ownMovement(current.id)))finish('interrupted','La app se cerró. La entrada no se reanudará sola.');}finally{closed=true;}}
 return {start,stop,tick,view,active,close};
}
module.exports={createEntryFlow};
