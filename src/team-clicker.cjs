'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {atomicJson,readJson}=require('./store.cjs');
const {normalizeMousePause,mousePauseView}=require('./mouse-pause.cjs');
const {createScreenReader}=require('./screen-reader.cjs');
const {classifyTeamEntry,clickerAttempt,attemptKey,currentAttemptScreen,entryProof}=require('./team-clicker-entry.cjs');
const TEAMS=['blue','red','green'];
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function validateClicker(input,{allowAny=false}={}){
 if(!input||typeof input.enabled!=='boolean')throw Error('Indica si quieres preparar el autoclic.');
 if(!TEAMS.includes(input.team)&&!(allowAny&&input.team==='any'))throw Error('Elige azul, rojo o verde.');
 if(!Number.isInteger(input.intervalMs)||input.intervalMs<20||input.intervalMs>2000)throw Error('El intervalo debe estar entre 20 y 2000 ms.');
 const startMode=input.startMode===undefined?'hotkey':input.startMode;
 if(!['automatic','hotkey'].includes(startMode))throw Error('Elige un modo de selección de equipo válido.');
 if(startMode==='hotkey'&&input.hotkey!==undefined&&input.hotkey!=='F6')throw Error('La tecla de autoclic es F6.');
 if(startMode==='automatic'&&input.hotkey!==undefined&&input.hotkey!==null&&input.hotkey!=='F6')throw Error('El modo automático no usa una tecla de inicio.');
 return {team:input.team,intervalMs:input.intervalMs,startMode,hotkey:startMode==='automatic'?null:'F6',mousePause:normalizeMousePause(input.mousePause)};
}
function createTeamClicker({root,dataDir,now=Date.now,monoNow=()=>performance.now(),event=()=>{},platform=process.platform,spawnProcess=spawn,servicePid=process.pid,isProcessAlive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}},capabilityCheck,reader}={}){
 const binary=path.join(root,'bin','WardogsTeamClicker.exe');
 const commandFile=path.join(dataDir,'team-clicker-command.json'),stateFile=path.join(dataDir,'team-clicker-state.json'),settingsFile=path.join(dataDir,'team-clicker-settings.json');
 let settings={team:'blue',intervalMs:20,startMode:'automatic',hotkey:null,mousePause:normalizeMousePause()};
 try{settings=validateClicker({...readJson(settingsFile),enabled:false});}catch{}
 let enabled=false,sessionId=null,lastUiMono=null,calibratingTeam=null,calibrationRequestedAt=null,previousCapture=null,closed=false,launching=null,preparation=null,monitorPreparation=null;
 // The full-entry coordinator owns a bounded lease instead of borrowing a
 // browser heartbeat. Ownership remains visible through native stop/completion.
 let ownerId=null,ownerEndAt=null,ownerStartedMono=null,ownerAllowedMs=null;
 let reason='Selección de equipo desactivada. Elige un color y activa la espera.';
 const entryReader=reader||createScreenReader({root,dataDir,now,directory:path.join(dataDir,'team-clicker-monitor'),classify:classifyTeamEntry});
 let entryIdentity=null,entryGeneration=0,entryReadJob=null,lastEntryRead=-Infinity,submittedEntry=null;
 let entryConfirmation={status:'idle',reason:'Sin intento pendiente.'};
 let capabilities=null,capabilityStamp=null;
 let lastControllerIdentity=null;
 function available(force=false){
  if(capabilityCheck)return capabilityCheck();
  if(platform!=='win32')return false;
  try{
   const capFile=path.join(root,'bin','team-clicker-capabilities.json'),binStat=fs.statSync(binary),capStat=fs.statSync(capFile),stamp=[binStat.size,binStat.mtimeMs,binStat.ctimeMs,capStat.size,capStat.mtimeMs,capStat.ctimeMs].join(':');
   if(!force&&stamp===capabilityStamp)return capabilities?.available===true;
   const cap=readJson(capFile),valid=cap?.format==='wardogs-team-clicker-capabilities-v1'&&cap.teamClicker===true&&cap.automaticTeamRecognition===true&&cap.automaticTeamSelection===true&&cap.messageHotkeys===true&&cap.persistentTeamAttempt===true&&cap.positiveEntryConfirmation===true&&cap.sha256===crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex');
   capabilityStamp=stamp;capabilities={available:valid,any:valid&&cap.automaticAnyTeam===true,mousePause:valid&&cap.mousePause===true};return valid;
  }catch{capabilityStamp=null;capabilities={available:false,any:false};return false;}
 }
 function native(){try{return readJson(stateFile);}catch{return null;}}
 function anyAvailable(knownAvailable){if((knownAvailable===undefined?available():knownAvailable)!==true)return false;if(capabilityCheck)return capabilityCheck('automaticAnyTeam')===true;return capabilities?.any===true;}
 function actualTeam(current,completed=false){const value=completed?current?.completedActualTeam:current?.actualTeam;return TEAMS.includes(value)?value:settings.team!=='any'?settings.team:null;}
 function fresh(value,knownAlive){const age=now()-Date.parse(value?.at);return value?.format==='wardogs-team-clicker-state-v1'&&Number.isInteger(value.pid)&&value.pid>0&&Number.isFinite(age)&&age>=-1000&&age<3500&&(knownAlive===undefined?isProcessAlive(value.pid):knownAlive);}
 function controllerObservation(){
  let current=null,status='read';
  const missing={};
  try{current=readJson(stateFile,missing);if(current===missing){current=null;status='unavailable';}}
  catch(error){status=error instanceof SyntaxError?'unexpected_format':'unavailable';}
  const shaped=current?.format==='wardogs-team-clicker-state-v1'&&Number.isInteger(current.pid)&&current.pid>0&&typeof current.at==='string'&&Number.isFinite(Date.parse(current.at))&&(current.sessionId===null||UUID.test(current.sessionId||''));
  if(status==='read'&&!shaped)status='unexpected_format';
  const alive=pid=>{try{return Number.isInteger(pid)&&pid>0&&isProcessAlive(pid)===true;}catch{return false;}};
  const reportAlive=shaped&&alive(current.pid),recent=status==='read'&&fresh(current,reportAlive);
  // Cache identity only for a confirmed live report. It is diagnostic data,
  // never returned as `current` or accepted as a fresh input permission.
  if(recent&&UUID.test(current.sessionId||''))lastControllerIdentity={pid:current.pid,sessionId:current.sessionId,at:current.at,operatorStoppedSessionId:UUID.test(current.operatorStoppedSessionId||'')?current.operatorStoppedSessionId:null};
  const identity=status==='unavailable'?lastControllerIdentity:shaped?current:null;
  return {current,recent,metadata:{controllerPid:identity?.pid||null,controllerAlive:identity===current?reportAlive:!!identity&&alive(identity.pid),controllerReportAt:identity?.at||null,controllerReportAgeMs:identity?now()-Date.parse(identity.at):null,controllerReportSessionId:identity?.sessionId||null,controllerReportRead:status==='read',controllerReportStatus:status,controllerIdentitySource:status==='unavailable'&&identity?'cached':identity?'report':'none',controllerOperatorStoppedSessionId:identity&&UUID.test(identity.operatorStoppedSessionId||'')?identity.operatorStoppedSessionId:null}};
 }
 function write(){
  const at=now(),leaseEnd=enabled&&ownerId?Math.min(at+3000,Date.parse(ownerEndAt)):at+3000;atomicJson(commandFile,{format:'wardogs-team-clicker-command-v1',id:crypto.randomUUID(),sessionId,issuedAt:new Date(at).toISOString(),expiresAt:new Date(leaseEnd).toISOString(),enabled,mousePause:normalizeMousePause(settings.mousePause),selectedTeam:settings.team,intervalMs:settings.intervalMs,startMode:settings.startMode,toggleKey:'F6',captureKey:'F9',calibrateTeam:calibratingTeam,servicePid,entryAttemptId:submittedEntry?.attemptId||null,entryGamePid:submittedEntry?.gamePid||0,entryGameWindow:submittedEntry?.gameWindow||0,entryCapturedAt:submittedEntry?.capturedAt||null,entryActualTeam:submittedEntry?.actualTeam||null});
 }
 function resetEntry(){
  entryGeneration++;entryReader.stop();entryIdentity=null;entryReadJob=null;lastEntryRead=-Infinity;submittedEntry=null;entryConfirmation={status:'idle',reason:'Sin intento pendiente.'};
 }
 function stop(message='Autoclic apagado por el usuario.'){
  preparation=null;monitorPreparation=null;enabled=false;calibratingTeam=null;lastUiMono=null;reason=message;resetEntry();write();event('team_clicker_stopped',{reason:message});
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
 async function configure(input,ownership=null){
  if(closed)throw Error('El servicio se está cerrando.');
  if(ownerId&&(!ownership||ownership.ownerId!==ownerId)&&blocking())throw Error('La entrada automática está usando la selección de equipo. Detén esa entrada primero.');
  const validated=validateClicker(input,{allowAny:!!ownership});
  if(input.enabled&&!available(true))throw Error('Falta instalar el controlador de autoclic.');
  if(input.enabled&&validated.mousePause.enabled&&!capabilityCheck&&capabilities?.mousePause!==true)throw Error('Actualiza el controlador de equipo para usar la pausa por ratón.');
  if(input.enabled&&validated.team==='any'&&!anyAvailable())throw Error('Actualiza el controlador para entrar en el primer equipo disponible.');
  monitorPreparation=null;
  if(ownership){
   const end=Date.parse(ownership.endAt);
   if(!UUID.test(ownership.ownerId||'')||!Number.isFinite(end)||end<=now()||end>now()+720*60000)throw Error('Concesión de selección automática no válida.');
   ownerId=ownership.ownerId;ownerEndAt=new Date(end).toISOString();ownerStartedMono=monoNow();ownerAllowedMs=end-now();
  }else{ownerId=null;ownerEndAt=null;ownerStartedMono=null;ownerAllowedMs=null;}
  settings=validated;if(settings.team!=='any')atomicJson(settingsFile,settings);
  if(!input.enabled){stop();return view();}
  // CreateProcess can synchronously block Node during a cold Windows launch.
  // Start with no permission; the active lease begins only after launch and
  // cancellation checks. The owner's total deadline still includes startup.
  resetEntry();sessionId=crypto.randomUUID();enabled=false;lastUiMono=null;calibratingTeam=null;
  const requested={sessionId,ownerId,startedMono:monoNow()};preparation=requested;
  reason='Preparando el controlador de equipos. Espera sin tocar el juego.';write();
  const ownPreparation=()=>!closed&&preparation===requested&&sessionId===requested.sessionId&&ownerId===requested.ownerId;
  const withinDeadline=()=>{const elapsed=monoNow()-requested.startedMono,total=ownerId?monoNow()-ownerStartedMono:0;return Number.isFinite(elapsed)&&elapsed>=0&&(!ownerId||Number.isFinite(total)&&total>=0&&total<ownerAllowedMs&&now()<Date.parse(ownerEndAt));};
  try{
   await ensureHelper();
   if(!ownPreparation())return view();
   if(!withinDeadline()){stop('Terminó el tiempo durante la preparación del controlador de equipos.');return view();}
   // The entry watcher, which exists before this helper, can capture a short
   // F8 while CreateProcess is blocking. Its guard must read that live report.
   if(ownership?.canArm&&await ownership.canArm()!==true){if(ownPreparation())stop('La entrada se detuvo antes de activar la selección de equipo.');return view();}
   if(!ownPreparation())return view();
   if(!withinDeadline()){stop('Terminó el tiempo durante la preparación del controlador de equipos.');return view();}
   const stopped=native();
   if(fresh(stopped)&&stopped.sessionId===requested.sessionId&&(stopped.operatorStoppedSessionId===requested.sessionId||stopped.automaticStoppedSessionId===requested.sessionId)){stop('Detenido durante la preparación del equipo.');return view();}
  }catch(error){if(ownPreparation())stop('No se pudo abrir el controlador de autoclic.');throw error;}
  // Native automatic sessions are terminal after disabled/stop. Never enable
  // the preparation UUID: a fresh grant is a new native session, not a rearm.
  preparation=null;sessionId=crypto.randomUUID();enabled=true;lastUiMono=monoNow();
  reason=settings.startMode==='automatic'?'Esperando el selector de facciones de Wardogs. El equipo elegido se seleccionará automáticamente.':'Preparado. En el selector de Wardogs, F6 reconoce tu equipo e inicia o para los clics.';write();
  event('team_clicker_prepared',{team:settings.team,intervalMs:settings.intervalMs,startMode:settings.startMode});
  return view();
 }
 function heartbeat(input){
  if(ownerId)throw Error('Esta selección pertenece a la entrada automática, no a una ventana.');
  if(closed||!enabled||!UUID.test(input?.sessionId||'')||input.sessionId!==sessionId)throw Error('Prepara de nuevo el autoclic para esta ventana.');
  const elapsed=monoNow()-lastUiMono;
  if(elapsed<0||elapsed>=8000){stop(settings.startMode==='automatic'?'La ventana dejó de responder. Activa de nuevo la selección automática.':'La ventana dejó de responder. Prepara F6 de nuevo.');throw Error(reason);}
  lastUiMono=monoNow();return view();
 }
 async function prepareOwned({ownerId:requestedOwner,team,endAt,intervalMs=settings.intervalMs,mousePause=settings.mousePause,canArm}={}){
  if(!UUID.test(requestedOwner||''))throw Error('Identificador de entrada no válido.');
  if(blocking())throw Error('Espera a que se detenga la selección anterior.');
  if(canArm!==undefined&&typeof canArm!=='function')throw Error('Comprobación de entrada no válida.');
  return configure({enabled:true,team,intervalMs,startMode:'automatic',mousePause},{ownerId:requestedOwner,endAt,canArm});
 }
 async function prepareStopMonitor({canContinue}={}){
  if(closed||blocking()||monitorPreparation)throw Error('Detén la selección anterior antes de preparar la vigilancia.');
  if(canContinue!==undefined&&typeof canContinue!=='function')throw Error('Comprobación de vigilancia no válida.');
  if(!available(true))throw Error('Falta instalar el controlador de autoclic.');
  // This command has no input permission. Its fresh UUID only lets the native
  // helper report F8 while the between-round coordinator is otherwise idle.
  sessionId=crypto.randomUUID();enabled=false;ownerId=null;ownerEndAt=null;resetEntry();reason='Preparando la vigilancia de F8 sin permiso de clic.';
  const requested={sessionId};monitorPreparation=requested;write();
  const own=()=>!closed&&monitorPreparation===requested&&sessionId===requested.sessionId&&!enabled&&!ownerId&&!preparation;
  try{
   await ensureHelper();
   if(!own())return view();
   const stopped=native();
   if(fresh(stopped)&&stopped.operatorStoppedSessionId===requested.sessionId){monitorPreparation=null;reason='Detenido con F8 durante la preparación de la vigilancia.';return view();}
   if(canContinue&&await canContinue()!==true)return view();
   if(!own())return view();
   const latestStop=native();
   if(fresh(latestStop)&&latestStop.operatorStoppedSessionId===requested.sessionId){monitorPreparation=null;reason='Detenido con F8 durante la preparación de la vigilancia.';return view();}
   // Process creation can block longer than the short disabled lease. Renew
   // it only after spawn, with no permission, never overwriting a new owner.
   sessionId=crypto.randomUUID();monitorPreparation=null;reason='Vigilancia de parada preparada sin clics.';write();return view();
  }finally{if(monitorPreparation===requested)monitorPreparation=null;}
 }
 function renewOwned(requestedOwner){
  if(closed||!enabled||ownerId!==requestedOwner)throw Error('La selección automática ya no pertenece a esta entrada.');
  const elapsed=monoNow()-lastUiMono,total=monoNow()-ownerStartedMono;
  if(elapsed<0||elapsed>=8000||total<0||total>=ownerAllowedMs||now()>=Date.parse(ownerEndAt)){
   stop('Terminó la concesión de la entrada automática.');throw Error(reason);
  }
  lastUiMono=monoNow();return view();
 }
 function releaseOwned(requestedOwner){
  if(ownerId!==requestedOwner)return false;
  if(enabled||preparation)stop('Selección de equipo liberada por la entrada automática.');
  return !blocking();
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
  if(submittedEntry&&(!currentAttemptScreen({status:'verified_capture',gameForeground:true,gamePid:submittedEntry.gamePid,gameWindow:submittedEntry.gameWindow,frameId:submittedEntry.frameId,capturedAt:submittedEntry.capturedAt},attempt,now())||submittedEntry.actualTeam!==actualTeam(current)))submittedEntry=null;
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
   const color=actualTeam(latest),observedProof=job.attempt.count>0?entryProof(screen,latestAttempt,now()):null;
   const proof=observedProof&&color?{...observedProof,actualTeam:color}:null;
   if(proof){
    submittedEntry=proof;entryConfirmation={status:'submitted',attemptId:proof.attemptId,scene:proof.scene,capturedAt:proof.capturedAt,reason:'Entrada visible; esperando confirmación del controlador.'};
    write();event('team_clicker_entry_observed',{team:settings.team,attemptId:proof.attemptId,frameId:proof.frameId,capturedAt:proof.capturedAt,scene:proof.scene});
   }else entryConfirmation={status:'waiting',attemptId:attempt.attemptId,scene:screen.scene,capturedAt:screen.capturedAt,reason:'El intento continúa; todavía no se ha leído DESPLEGANDO tras clicar.'};
  }).catch(()=>{if(job.generation===entryGeneration&&job.key===entryIdentity)entryConfirmation={status:'waiting',attemptId:attempt.attemptId,reason:'No se pudo comprobar la entrada; el intento sigue pendiente.'};}).finally(()=>{if(entryReadJob===job)entryReadJob=null;});
 }
 function tick(){
  if(preparation){
   const current=native();
   if(fresh(current)&&current.sessionId===sessionId&&(current.operatorStoppedSessionId===sessionId||current.automaticStoppedSessionId===sessionId)){stop('Detenido con F8 antes de preparar el equipo.');return;}
   if(ownerId&&(now()>=Date.parse(ownerEndAt)||monoNow()<ownerStartedMono||monoNow()-ownerStartedMono>=ownerAllowedMs))stop('Fin del tiempo durante la preparación del equipo.');
   return;
  }
  if(closed||!enabled)return;
  if(ownerId&&(now()>=Date.parse(ownerEndAt)||monoNow()<ownerStartedMono||monoNow()-ownerStartedMono>=ownerAllowedMs)){stop('Fin del tiempo de la entrada automática.');return;}
  const elapsed=monoNow()-lastUiMono;
  if(elapsed<0||elapsed>=8000){stop(ownerId?'La entrada automática dejó de renovar la selección de equipo.':settings.startMode==='automatic'?'La ventana dejó de responder. Activa de nuevo la selección automática.':'La ventana dejó de responder. Prepara F6 de nuevo.');return;}
  const current=native();
  if(fresh(current)&&current.operatorStoppedSessionId===sessionId){stop(settings.startMode==='automatic'?'Detenido con F8. Vuelve a activar la selección automática en la app.':'Detenido con F8. Prepara F6 para volver a usarlo.');return;}
  if(settings.startMode==='automatic'&&fresh(current)&&current.sessionId===sessionId&&current.automaticStoppedSessionId===sessionId){
   const detail=typeof current.automaticStopReason==='string'?current.automaticStopReason.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,240):'';
   stop(detail||'Selección automática detenida. Actívala de nuevo desde la app.');return;
  }
  if(fresh(current)&&current.sessionId===sessionId&&UUID.test(current.completedAttemptId||'')){
   const color=actualTeam(current,true),acceptedProof=submittedEntry?.attemptId===current.completedAttemptId&&submittedEntry.actualTeam===color?submittedEntry:null;
   const confirmed={status:'confirmed',sessionId,ownerId,attemptId:current.completedAttemptId,actualTeam:acceptedProof?.actualTeam||null,scene:acceptedProof?.scene||null,capturedAt:acceptedProof?.capturedAt||null,frameId:acceptedProof?.frameId||null,gamePid:acceptedProof?.gamePid||0,gameWindow:acceptedProof?.gameWindow||0,reason:'Entrada al equipo confirmada. Autoclic desactivado.'};
   stop(confirmed.reason);entryConfirmation=confirmed;event('team_clicker_entry_confirmed',{team:settings.team,attemptId:confirmed.attemptId});return;
  }
  const captured=current?.targets?.[calibratingTeam]?.capturedAt;
  if(calibratingTeam&&fresh(current)&&current.sessionId===sessionId&&captured&&captured!==previousCapture&&Date.parse(captured)>=calibrationRequestedAt&&Date.parse(captured)<=now()+1000){calibratingTeam=null;reason='Equipo reconocido. Pulsa F6 en el selector del juego para clicar.';}
  observeEntry(current);
  write();
 }
 function view(){
  const observation=controllerObservation(),current=observation.current,recent=observation.recent,same=recent&&current.sessionId===sessionId;
  const targets={};for(const team of TEAMS){const target=current?.targets?.[team];targets[team]=target?.configured===true?{configured:true,x:target.x,y:target.y,width:target.width,height:target.height,capturedAt:target.capturedAt}:{configured:false};}
  const waitingAutomatic=enabled&&settings.startMode==='automatic'&&(!same||(current.armed===true&&current.active!==true&&current.running!==true&&!current.error&&current.automaticStoppedSessionId!==sessionId)),isAvailable=available();
  return {available:isAvailable,mousePauseAvailable:isAvailable&&(!!capabilityCheck||capabilities?.mousePause===true),persistentSelectionAvailable:isAvailable,automaticSelectionAvailable:isAvailable,automaticAnyTeamAvailable:anyAvailable(isAvailable),controllerFresh:recent,...observation.metadata,controllerSessionId:recent?current.sessionId||null:null,operatorStoppedSessionId:recent&&UUID.test(current.operatorStoppedSessionId||'')?current.operatorStoppedSessionId:null,actualTeam:same?actualTeam(current)||entryConfirmation.actualTeam||null:null,enabled,preparing:!!preparation,sessionId,ownerId,ownerEndAt,...settings,captureKey:settings.startMode==='automatic'?null:'F9',calibratingTeam,waitingAutomatic,automaticWaiting:waitingAutomatic,armed:enabled&&same&&current.armed===true,hotkeysReady:enabled&&same&&settings.startMode==='hotkey'&&current.hotkeysReady===true,active:same&&current.active===true,waitingForSelector:same&&current.waitingForSelector===true,pausedForContext:enabled&&same&&current.armed===true&&current.pausedForContext===true,userPause:same?mousePauseView(current.userPause,now()):null,attemptId:same?current.attemptId||null:null,attemptStartedAt:same?current.attemptStartedAt||null:null,completedAttemptId:same?current.completedAttemptId||null:null,gamePid:same&&Number.isInteger(current.gamePid)?current.gamePid:0,gameWindow:same&&Number.isSafeInteger(current.gameWindow)?current.gameWindow:0,running:same&&current.running===true,stopping:!enabled&&recent&&(current.running===true||current.armed===true),reason:enabled&&same&&!calibratingTeam?current.reason||reason:reason,error:enabled&&same?current.error||null:null,count:same&&Number.isInteger(current.count)?current.count:0,entryConfirmation:{...entryConfirmation},targets};
 }
 function close(){if(closed)return;try{stop('La app se cerró.');}finally{closed=true;}}
 // Never restore an armed session after service restart, including stale disk commands.
 write();
 function blocking(){const current=native();return !!preparation||enabled||fresh(current)&&(current.running===true||current.armed===true);}
 return {configure,heartbeat,calibrate,tick,stop,view,close,blocking,prepareOwned,renewOwned,releaseOwned,prepareStopMonitor};
}
module.exports={validateClicker,createTeamClicker};
