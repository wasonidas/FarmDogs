'use strict';
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {atomicJson,readJson}=require('./store.cjs');
const {createAutoSeeding,advanceAutoSeeding}=require('./auto-seeding.cjs');
const {createScreenReader}=require('./screen-reader.cjs');
const {sessionPhase,sessionReasonCode}=require('./session-report.cjs');
const {normalizeMousePause}=require('./mouse-pause.cjs');
function createAutoSession({root,dataDir,now,monoNow,launcher,getInputs,event,reader=createScreenReader({root,dataDir,now})}){
 const file=path.join(dataDir,'auto-seeding-session.json'),commandFile=path.join(dataDir,'movement-command.json');
 let current=readJson(file),startedMono=null,allowedMonoMs=null,lastRead=-Infinity,closed=false;
 const emit=(kind,detail={})=>{const entryId=current?.entryId&&current.entryId===current.entryProof?.entryId?current.entryId:null;event(kind,{id:current?.id||null,entryId,phase:sessionPhase(current),reasonCode:sessionReasonCode({kind,status:current?.status,reason:current?.reason,disconnect:current?.disconnect}),...detail});};
 const active=()=>current&&!['cancelled','expired','error','interrupted'].includes(current.status);
 if(current&&active()){current={...current,status:'interrupted',operatorStopped:true,reason:current.purpose==='break'?'La app se reinició. Activa otra sesión de movimiento temporal.':'La app se reinició. Inicia otra sesión de seeding.'};atomicJson(file,current);}
 function command(kind,screen={},cancelled=false){
  if(!current)return;
  const at=now();atomicJson(commandFile,{format:'wardogs-automatic-movement-v1',id:randomUUID(),sessionId:current.id,kind,issuedAt:new Date(at).toISOString(),expiresAt:new Date(at+3000).toISOString(),endAt:current.endAt,frameId:screen.frameId||null,capturedAt:screen.capturedAt||null,scene:screen.scene||null,gamePid:screen.gamePid||0,intervalSeconds:current.intervalSeconds,holdMs:current.holdMs,directions:'AD',mousePause:normalizeMousePause(current.mousePause),mouseRevision:Number.isSafeInteger(current.mouseActivityRevision)?current.mouseActivityRevision:0,reason:current.reason,cancelled});
 }
 async function start(input,{endAt=null,trustedEntry=null}={}){
  if(closed||active())throw Error('Ya hay una sesión de movimiento activa.');
  if(!launcher.availability().automaticMovement)throw Error('Actualiza el controlador automático antes de iniciar.');
  let candidate=createAutoSeeding(input,now(),{trustedEntry});
  if(candidate.mousePause.enabled&&launcher.availability().mousePauseMovement===false)throw Error('Actualiza el controlador de movimiento para usar la pausa por ratón.');
  if(endAt!==null){const cap=Date.parse(endAt);if(!Number.isFinite(cap)||cap<=now()||cap>Date.parse(candidate.endAt))throw Error('Límite externo de sesión no válido.');candidate.endAt=new Date(cap).toISOString();}
  const guard=readJson(path.join(dataDir,'movement-run.json'));
  if(guard&&guard.dayMadrid===new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now()))){const limit=Date.parse(guard.stopAtUtc);if(!Number.isFinite(limit)||limit<=now())throw Error('Se alcanzó el límite de hoy.');if(limit<Date.parse(candidate.endAt))candidate.endAt=guard.stopAtUtc;}
  current=candidate;
  const startingId=candidate.id;
  startedMono=monoNow();allowedMonoMs=Date.parse(current.endAt)-now();atomicJson(file,current);command('watch');
  try{await launcher.openMovementBackground();}catch(error){if(current?.id===startingId)stop('No se pudo abrir el controlador.','error');throw error;}
  if(current?.id!==startingId)return {...candidate,status:'interrupted',reason:'La sesión fue sustituida.'};
  if(active())emit('auto_seeding_started',{purpose:current.purpose||'seeding',server:current.server});return view();
 }
 function stop(reason='Sesión detenida por el usuario.',status='cancelled'){
  if(current){current={...current,status,operatorStopped:true,reason};atomicJson(file,current);command('stop',{},true);emit('auto_seeding_stopped',{purpose:current.purpose||'seeding',server:current.server,status});}reader.stop();
 }
 function tickInternal(){
  if(closed||!active())return;
  if(startedMono!==null&&(monoNow()<startedMono||monoNow()-startedMono>=allowedMonoMs)){stop('Fin de la duración elegida.','expired');return;}
  const input=getInputs(current.server,current.purpose||'seeding'),screen=reader.view(),at=now();const decision=advanceAutoSeeding(current,{...input,screen},at);
  const changed=current.status!==decision.session.status;current=decision.session;
  // A current unknown scene can still prove foreground. Clarify only the
  // diagnosis; the existing decision keeps its state and movement command.
  const screenAge=at-Date.parse(screen?.capturedAt);
  if(current.status==='waiting_game'&&screen?.status==='verified_capture'&&screen.scene==='unknown'&&screen.gameForeground===true&&Number.isInteger(screen.gamePid)&&screen.gamePid>0&&Number.isFinite(screenAge)&&screenAge>=0&&screenAge<=5000&&(current.presenceMode!=='entry'||screen.gamePid===current.entryProof.gamePid&&screen.gameWindow===current.entryProof.gameWindow)){
   const prefix=current.purpose!=='break'&&current.presenceMode==='manual'?'Prueba sin lectura Steam: ':'';
   current={...current,reason:prefix+'Wardogs está en primer plano, pero aún no se reconoce el HUD del personaje desplegado.'};
  }
  if(changed){atomicJson(file,current);emit('auto_seeding_state',{purpose:current.purpose||'seeding',server:current.server,status:current.status});}
  // A verified restart revokes the old movement lease without impersonating an
  // operator F8. A real F8 during the recovery handoff must remain distinguishable.
  if(decision.command==='stop')command('stop',{},!active()&&current.disconnect?.cause!=='server_restart');
  else if(['moving','starting_movement','paused_mouse'].includes(decision.session.status))command('start',screen);
  else if(input.movement?.autoSessionId!==current.id)command('watch');
  // Loss of presence/source/controller must not blind the passive reader just
  // when a kick or restart dialog becomes visible. Reading never grants input.
  if(active()&&monoNow()-lastRead>=1500&&!reader.busy){lastRead=monoNow();void reader.refresh();}
  if(!active())reader.stop();
 }
 function tick(){try{tickInternal();}catch(error){if(current)current={...current,status:'error',operatorStopped:true,reason:(current.purpose==='break'?'Error local del movimiento: ':'Error local del seeding: ')+error.message};try{command('stop',{},true);}catch{}reader.stop();try{emit('auto_seeding_error',{purpose:current?.purpose||'seeding',message:error.message});}catch{}}}
 function view(){return current?{...current,screen:reader.view()}:null;}
 function close(){if(closed)return;try{if(active())stop('El servicio local se cerró.','interrupted');}finally{reader.stop();closed=true;}}
 return {start,stop,tick,view,close,active};
}
module.exports={createAutoSession};
