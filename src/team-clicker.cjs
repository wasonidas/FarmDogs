'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {atomicJson,readJson}=require('./store.cjs');
const {createScreenReader}=require('./screen-reader.cjs');
const {classifyTeamEntry,clickerAttempt,attemptKey,currentAttemptScreen,entryProof}=require('./team-clicker-entry.cjs');
const TEAMS=['blue','red','green'];
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function validateClicker(input){
 if(!input||typeof input.enabled!=='boolean')throw Error('Indica si quieres preparar el autoclic.');
 if(!TEAMS.includes(input.team))throw Error('Elige azul, rojo o verde.');
 if(!Number.isInteger(input.intervalMs)||input.intervalMs<20||input.intervalMs>2000)throw Error('El intervalo debe estar entre 20 y 2000 ms.');
 const startMode=input.startMode===undefined?'hotkey':input.startMode;
 if(!['automatic','hotkey'].includes(startMode))throw Error('Elige un modo de selección de equipo válido.');
 if(startMode==='hotkey'&&input.hotkey!==undefined&&input.hotkey!=='F6')throw Error('La tecla de autoclic es F6.');
 if(startMode==='automatic'&&input.hotkey!==undefined&&input.hotkey!==null&&input.hotkey!=='F6')throw Error('El modo automático no usa una tecla de inicio.');
 return {team:input.team,intervalMs:input.intervalMs,startMode,hotkey:startMode==='automatic'?null:'F6'};
}
function createTeamClicker({root,dataDir,now=Date.now,monoNow=()=>performance.now(),event=()=>{},platform=process.platform,spawnProcess=spawn,servicePid=process.pid,isProcessAlive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}},capabilityCheck,reader}={}){
 const binary=path.join(root,'bin','WardogsTeamClicker.exe');
 const commandFile=path.join(dataDir,'team-clicker-command.json'),stateFile=path.join(dataDir,'team-clicker-state.json'),settingsFile=path.join(dataDir,'team-clicker-settings.json');
 let settings={team:'blue',intervalMs:20,startMode:'automatic',hotkey:null};
 try{settings=validateClicker({...readJson(settingsFile),enabled:false});}catch{}
 let enabled=false,sessionId=null,lastUiMono=null,calibratingTeam=null,calibrationRequestedAt=null,previousCapture=null,closed=false,launching=null;
 let reason='Selección de equipo desactivada. Elige un color y activa la espera.';
 const entryReader=reader||createScreenReader({root,dataDir,now,directory:path.join(dataDir,'team-clicker-monitor'),classify:classifyTeamEntry});
 let entryIdentity=null,entryGeneration=0,entryReadJob=null,lastEntryRead=-Infinity,submittedEntry=null;
 let entryConfirmation={status:'idle',reason:'Sin intento pendiente.'};
 function available(){
  if(capabilityCheck)return capabilityCheck();
  if(platform!=='win32')return false;
  try{const cap=readJson(path.join(root,'bin','team-clicker-capabilities.json'));return cap?.format==='wardogs-team-clicker-capabilities-v1'&&cap.teamClicker===true&&cap.automaticTeamRecognition===true&&cap.automaticTeamSelection===true&&cap.messageHotkeys===true&&cap.persistentTeamAttempt===true&&cap.positiveEntryConfirmation===true&&cap.sha256===crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex');}catch{return false;}
 }
 function native(){try{return readJson(stateFile);}catch{return null;}}
 function fresh(value){const age=now()-Date.parse(value?.at);return value?.format==='wardogs-team-clicker-state-v1'&&Number.isInteger(value.pid)&&value.pid>0&&Number.isFinite(age)&&age>=-1000&&age<3500&&isProcessAlive(value.pid);}
 function write(){
  const at=now();atomicJson(commandFile,{format:'wardogs-team-clicker-command-v1',id:crypto.randomUUID(),sessionId,issuedAt:new Date(at).toISOString(),expiresAt:new Date(at+3000).toISOString(),enabled,selectedTeam:settings.team,intervalMs:settings.intervalMs,startMode:settings.startMode,toggleKey:'F6',captureKey:'F9',calibrateTeam:calibratingTeam,servicePid,entryAttemptId:submittedEntry?.attemptId||null,entryGamePid:submittedEntry?.gamePid||0,entryGameWindow:submittedEntry?.gameWindow||0,entryCapturedAt:submittedEntry?.capturedAt||null});
 }
 function resetEntry(){
  entryGeneration++;entryReader.stop();entryIdentity=null;entryReadJob=null;lastEntryRead=-Infinity;submittedEntry=null;entryConfirmation={status:'idle',reason:'Sin intento pendiente.'};
 }
 function stop(message='Autoclic apagado por el usuario.'){
  enabled=false;calibratingTeam=null;lastUiMono=null;reason=message;resetEntry();write();event('team_clicker_stopped',{reason:message});
 }
 async function ensureHelper(){
  if(launching)return launching;
  const prior=native();if(fresh(prior))return;
  launching=new Promise((resolve,reject)=>{
   const child=spawnProcess(binary,[],{cwd:root,windowsHide:true,detached:true,stdio:'ignore'});
   child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
  });
  try{await launching;}finally{launching=null;}
 }
 async function configure(input){
  if(closed)throw Error('El servicio se está cerrando.');
  const validated=validateClicker(input);
  if(input.enabled&&!available())throw Error('Falta instalar el controlador de autoclic.');
  settings=validated;atomicJson(settingsFile,settings);
  if(!input.enabled){stop();return view();}
  // Enabling grants permission to wait; the native helper still requires a
  // verified selector before clicking. Legacy hotkey mode waits for F6 too.
  resetEntry();sessionId=crypto.randomUUID();enabled=true;lastUiMono=monoNow();calibratingTeam=null;
  reason=settings.startMode==='automatic'?'Esperando el selector de facciones de Wardogs. El equipo elegido se seleccionará automáticamente.':'Preparado. En el selector de Wardogs, F6 reconoce tu equipo e inicia o para los clics.';write();
  const requested=sessionId;
  try{await ensureHelper();}catch(error){if(sessionId===requested)stop('No se pudo abrir el controlador de autoclic.');throw error;}
  if(enabled&&sessionId===requested)event('team_clicker_prepared',{team:settings.team,intervalMs:settings.intervalMs,startMode:settings.startMode});
  return view();
 }
 function heartbeat(input){
  if(closed||!enabled||!UUID.test(input?.sessionId||'')||input.sessionId!==sessionId)throw Error('Prepara de nuevo el autoclic para esta ventana.');
  const elapsed=monoNow()-lastUiMono;
  if(elapsed<0||elapsed>=8000){stop(settings.startMode==='automatic'?'La ventana dejó de responder. Activa de nuevo la selección automática.':'La ventana dejó de responder. Prepara F6 de nuevo.');throw Error(reason);}
  lastUiMono=monoNow();return view();
 }
 function calibrate(input){
  if(settings.startMode==='automatic')throw Error('La selección automática reconoce el equipo al aparecer el selector; no requiere calibración.');
  if(!enabled||input?.team!==settings.team)throw Error('Prepara F6 y elige el color que quieres configurar.');
  const current=native();previousCapture=current?.targets?.[settings.team]?.capturedAt||null;
  calibratingTeam=settings.team;calibrationRequestedAt=now();reason='Abre el selector de equipos de Wardogs y pulsa F9 para reconocer sin clicar.';write();
  event('team_clicker_calibration_requested',{team:settings.team});return view();
 }
 function observeEntry(current){
  const attempt=fresh(current)?clickerAttempt(current,sessionId):null,key=attemptKey(attempt);
  if(!key){if(entryIdentity!==null)resetEntry();return;}
  if(key!==entryIdentity){resetEntry();entryIdentity=key;entryConfirmation={status:'waiting',attemptId:attempt.attemptId,reason:'Esperando una pantalla actual del intento.'};}
  if(attempt.count<1)return;
  if(submittedEntry&&(!currentAttemptScreen({status:'verified_capture',gameForeground:true,gamePid:submittedEntry.gamePid,gameWindow:submittedEntry.gameWindow,frameId:submittedEntry.frameId,capturedAt:submittedEntry.capturedAt},attempt,now())))submittedEntry=null;
  if(submittedEntry||entryReadJob||entryReader.busy||monoNow()-lastEntryRead<150)return;
  lastEntryRead=monoNow();const job={generation:entryGeneration,key,attempt};entryReadJob=job;
  entryConfirmation={status:'reading',attemptId:attempt.attemptId,reason:'Buscando DESPLEGANDO sin interrumpir los clics.'};
  void Promise.resolve().then(()=>{
   if(closed||!enabled||job.generation!==entryGeneration||job.key!==entryIdentity)return;
   return entryReader.refresh();
  }).then(()=>{
   if(closed||!enabled||job.generation!==entryGeneration||job.key!==entryIdentity)return;
   const latest=native(),latestAttempt=fresh(latest)?clickerAttempt(latest,sessionId):null;
   if(attemptKey(latestAttempt)!==job.key)return;
   const screen=entryReader.view();
   if(!currentAttemptScreen(screen,latestAttempt,now())){entryConfirmation={status:'waiting',attemptId:attempt.attemptId,reason:screen?.reason||'No hay una captura actual del mismo intento.'};return;}
   // A capture begun before the first click cannot confirm deployment caused
   // by this attempt. Missing colors or buttons never produce a stop command.
   const proof=job.attempt.count>0?entryProof(screen,latestAttempt,now()):null;
   if(proof){
    submittedEntry=proof;entryConfirmation={status:'submitted',attemptId:proof.attemptId,scene:proof.scene,capturedAt:proof.capturedAt,reason:'Entrada visible; esperando confirmación del controlador.'};
    write();event('team_clicker_entry_observed',{team:settings.team,attemptId:proof.attemptId,frameId:proof.frameId,capturedAt:proof.capturedAt,scene:proof.scene});
   }else entryConfirmation={status:'waiting',attemptId:attempt.attemptId,scene:screen.scene,capturedAt:screen.capturedAt,reason:'El intento continúa; todavía no se ha leído DESPLEGANDO tras clicar.'};
  }).catch(()=>{if(job.generation===entryGeneration&&job.key===entryIdentity)entryConfirmation={status:'waiting',attemptId:attempt.attemptId,reason:'No se pudo comprobar la entrada; el intento sigue pendiente.'};}).finally(()=>{if(entryReadJob===job)entryReadJob=null;});
 }
 function tick(){
  if(closed||!enabled)return;
  const elapsed=monoNow()-lastUiMono;
  if(elapsed<0||elapsed>=8000){stop(settings.startMode==='automatic'?'La ventana dejó de responder. Activa de nuevo la selección automática.':'La ventana dejó de responder. Prepara F6 de nuevo.');return;}
  const current=native();
  if(fresh(current)&&current.operatorStoppedSessionId===sessionId){stop(settings.startMode==='automatic'?'Detenido con F8. Vuelve a activar la selección automática en la app.':'Detenido con F8. Prepara F6 para volver a usarlo.');return;}
  if(settings.startMode==='automatic'&&fresh(current)&&current.sessionId===sessionId&&current.automaticStoppedSessionId===sessionId){
   const detail=typeof current.automaticStopReason==='string'?current.automaticStopReason.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,240):'';
   stop(detail||'Selección automática detenida. Actívala de nuevo desde la app.');return;
  }
  if(fresh(current)&&current.sessionId===sessionId&&UUID.test(current.completedAttemptId||'')){
   const confirmed={status:'confirmed',attemptId:current.completedAttemptId,scene:submittedEntry?.scene||null,capturedAt:submittedEntry?.capturedAt||null,reason:'Entrada al equipo confirmada. Autoclic desactivado.'};
   stop(confirmed.reason);entryConfirmation=confirmed;event('team_clicker_entry_confirmed',{team:settings.team,attemptId:confirmed.attemptId});return;
  }
  const captured=current?.targets?.[calibratingTeam]?.capturedAt;
  if(calibratingTeam&&fresh(current)&&current.sessionId===sessionId&&captured&&captured!==previousCapture&&Date.parse(captured)>=calibrationRequestedAt&&Date.parse(captured)<=now()+1000){calibratingTeam=null;reason='Equipo reconocido. Pulsa F6 en el selector del juego para clicar.';}
  observeEntry(current);
  write();
 }
 function view(){
  const current=native(),recent=fresh(current),same=recent&&current.sessionId===sessionId;
  const targets={};for(const team of TEAMS){const target=current?.targets?.[team];targets[team]=target?.configured===true?{configured:true,x:target.x,y:target.y,width:target.width,height:target.height,capturedAt:target.capturedAt}:{configured:false};}
  const waitingAutomatic=enabled&&settings.startMode==='automatic'&&(!same||(current.armed===true&&current.active!==true&&current.running!==true&&!current.error&&current.automaticStoppedSessionId!==sessionId)),isAvailable=available();
  return {available:isAvailable,automaticSelectionAvailable:isAvailable,enabled,sessionId,...settings,captureKey:settings.startMode==='automatic'?null:'F9',calibratingTeam,waitingAutomatic,automaticWaiting:waitingAutomatic,armed:enabled&&same&&current.armed===true,hotkeysReady:enabled&&same&&settings.startMode==='hotkey'&&current.hotkeysReady===true,active:same&&current.active===true,waitingForSelector:same&&current.waitingForSelector===true,attemptId:same?current.attemptId||null:null,attemptStartedAt:same?current.attemptStartedAt||null:null,completedAttemptId:same?current.completedAttemptId||null:null,gamePid:same&&Number.isInteger(current.gamePid)?current.gamePid:0,gameWindow:same&&Number.isSafeInteger(current.gameWindow)?current.gameWindow:0,running:same&&current.running===true,stopping:!enabled&&recent&&(current.running===true||current.armed===true),reason:enabled&&same&&!calibratingTeam?current.reason||reason:reason,error:enabled&&same?current.error||null:null,count:same&&Number.isInteger(current.count)?current.count:0,entryConfirmation:{...entryConfirmation},targets};
 }
 function close(){if(closed)return;try{stop('La app se cerró.');}finally{closed=true;}}
 // Never restore an armed session after service restart, including stale disk commands.
 write();
 function blocking(){const current=native();return enabled||fresh(current)&&(current.running===true||current.armed===true);}
 return {configure,heartbeat,calibrate,tick,stop,view,close,blocking};
}
module.exports={validateClicker,createTeamClicker};
