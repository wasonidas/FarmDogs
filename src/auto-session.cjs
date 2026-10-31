'use strict';
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {atomicJson,readJson}=require('./store.cjs');
const {createAutoSeeding,advanceAutoSeeding}=require('./auto-seeding.cjs');
const {createScreenReader}=require('./screen-reader.cjs');
function createAutoSession({root,dataDir,now,monoNow,launcher,getInputs,event,reader=createScreenReader({root,dataDir,now})}){
 const file=path.join(dataDir,'auto-seeding-session.json'),commandFile=path.join(dataDir,'movement-command.json');
 let current=readJson(file),startedMono=null,allowedMonoMs=null,lastRead=-Infinity,closed=false;
 const active=()=>current&&!['cancelled','expired','error','interrupted'].includes(current.status);
 if(current&&active()){current={...current,status:'interrupted',operatorStopped:true,reason:current.purpose==='break'?'La app se reinició. Activa otra sesión de movimiento temporal.':'La app se reinició. Inicia otra sesión de seeding.'};atomicJson(file,current);}
 function command(kind,screen={},cancelled=false){
  if(!current)return;
  const at=now();atomicJson(commandFile,{format:'wardogs-automatic-movement-v1',id:randomUUID(),sessionId:current.id,kind,issuedAt:new Date(at).toISOString(),expiresAt:new Date(at+3000).toISOString(),endAt:current.endAt,frameId:screen.frameId||null,capturedAt:screen.capturedAt||null,scene:screen.scene||null,gamePid:screen.gamePid||0,intervalSeconds:current.intervalSeconds,holdMs:current.holdMs,directions:'AD',reason:current.reason,cancelled});
 }
 async function start(input,{endAt=null}={}){
  if(closed||active())throw Error('Ya hay una sesión de movimiento activa.');
  if(!launcher.availability().automaticMovement)throw Error('Actualiza el controlador automático antes de iniciar.');
  let candidate=createAutoSeeding(input,now());
  if(endAt!==null){const cap=Date.parse(endAt);if(!Number.isFinite(cap)||cap<=now()||cap>Date.parse(candidate.endAt))throw Error('Límite externo de sesión no válido.');candidate.endAt=new Date(cap).toISOString();}
  const guard=readJson(path.join(dataDir,'movement-run.json'));
  if(guard&&guard.dayMadrid===new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now()))){const limit=Date.parse(guard.stopAtUtc);if(!Number.isFinite(limit)||limit<=now())throw Error('Se alcanzó el límite de hoy.');if(limit<Date.parse(candidate.endAt))candidate.endAt=guard.stopAtUtc;}
  current=candidate;
  const startingId=candidate.id;
  startedMono=monoNow();allowedMonoMs=Date.parse(current.endAt)-now();atomicJson(file,current);command('watch');
  try{await launcher.openMovementBackground();}catch(error){if(current?.id===startingId)stop('No se pudo abrir el controlador.','error');throw error;}
  if(current?.id!==startingId)return {...candidate,status:'interrupted',reason:'La sesión fue sustituida.'};
  if(active())event('auto_seeding_started',{purpose:current.purpose||'seeding',server:current.server});return view();
 }
 function stop(reason='Sesión detenida por el usuario.',status='cancelled'){
  if(current){current={...current,status,operatorStopped:true,reason};atomicJson(file,current);command('stop',{},true);event('auto_seeding_stopped',{purpose:current.purpose||'seeding',server:current.server,status});}reader.stop();
 }
 function tickInternal(){
  if(closed||!active())return;
  if(startedMono!==null&&(monoNow()<startedMono||monoNow()-startedMono>=allowedMonoMs)){stop('Fin de la duración elegida.','expired');return;}
  const input=getInputs(current.server,current.purpose||'seeding'),screen=reader.view();const decision=advanceAutoSeeding(current,{...input,screen},now());
  const changed=current.status!==decision.session.status;current=decision.session;
  if(changed){atomicJson(file,current);event('auto_seeding_state',{purpose:current.purpose||'seeding',server:current.server,status:current.status});}
  if(decision.command==='stop')command('stop',{},!active());
  else if(['moving','starting_movement'].includes(decision.session.status))command('start',screen);
  else if(input.movement?.autoSessionId!==current.id)command('watch');
  // Loss of presence/source/controller must not blind the passive reader just
  // when a kick or restart dialog becomes visible. Reading never grants input.
  if(active()&&monoNow()-lastRead>=1500&&!reader.busy){lastRead=monoNow();void reader.refresh();}
  if(!active())reader.stop();
 }
 function tick(){try{tickInternal();}catch(error){if(current)current={...current,status:'error',operatorStopped:true,reason:(current.purpose==='break'?'Error local del movimiento: ':'Error local del seeding: ')+error.message};try{command('stop',{},true);}catch{}reader.stop();try{event('auto_seeding_error',{purpose:current?.purpose||'seeding',message:error.message});}catch{}}}
 function view(){return current?{...current,screen:reader.view()}:null;}
 function close(){if(closed)return;try{if(active())stop('El servicio local se cerró.','interrupted');}finally{reader.stop();closed=true;}}
 return {start,stop,tick,view,close,active};
}
module.exports={createAutoSession};
