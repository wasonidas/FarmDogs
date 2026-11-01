'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {execFile,spawn:defaultSpawn}=require('node:child_process');
const {promisify}=require('node:util');
const {createScreenReader}=require('./screen-reader.cjs');
const {classifyGameScreen}=require('./game-screen.cjs');
const {classifyEntryScreen}=require('./entry-screen.cjs');
const {atomicJson}=require('./store.cjs');
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/i;
const TERMINAL=new Set(['error','cancelled']);
const CRITICAL=new Set(['lookup','confirm_join','restart_continue']);
const NAVIGATION=new Set(['splash_continue','main_deploy','community','join_by_id','type_join_id']);
const FORM=new Set(['join_id_input','join_id_ready']);
const SAFE_PREINPUT_REJECTIONS=new Set(['operator_input','game_not_foreground','cursor_obstructed','cursor_position_unconfirmed','game_window_changed','stale_target','main_deploy_disabled']);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const safeText=value=>String(value?.message||value||'Error local.').replace(/[\u0000-\u001f]/g,' ').slice(0,250);

function createGameEntry({root,dataDir,getTarget,now=Date.now,monoNow=()=>performance.now(),event=()=>{},run=promisify(execFile),spawn=defaultSpawn}={}){
 if(typeof getTarget!=='function')throw Error('Hace falta un lector del destino público reciente para la entrada automática.');
 const executable=path.join(root,'bin','WardogsEntry.exe'),directory=path.join(dataDir,'entry-screen-monitor');
 let current=null,generation=0,closed=false,startPending=false,tickPending=null,pendingAction=null,rawCapture=null;
 let watcher=null,binding=null,startedMono=null,budgetMs=0,lastActionMono=-Infinity,lastCaptureAt=-Infinity,lastActionAt=-Infinity;
 let typedJoinId=null,lastSection=null,chain={},attempts=new Map(),actionFrames=new Set(),focusAttempted=false,lastFocusMono=-Infinity,recoveryPlan=null,restartPermit=false;
 const emit=(name,details)=>{try{event(name,details);}catch{}};
 const reader=createScreenReader({root,dataDir,directory,now,run,classify:report=>{rawCapture=report;return classifyGameScreen(report);}});
 const same=token=>!closed&&current&&!current.stopped&&!TERMINAL.has(current.phase)&&generation===token;
 const active=()=>!!current&&!current.stopped&&!TERMINAL.has(current.phase);
 function available(){
  try{
   const cap=JSON.parse(fs.readFileSync(path.join(root,'bin','entry-capabilities.json'),'utf8'));
   return cap.format==='farmdogs-entry-capabilities-v1'&&cap.automaticEntry===true&&cap.oneShot===true&&cap.stopWatcher===true&&cap.initialFocus===true&&cap.mainDeployGate===true&&cap.splashKeyStart===true&&cap.absolutePointer===true&&cap.maxActionMilliseconds===3000&&
    fs.lstatSync(executable).isFile()&&!fs.lstatSync(executable).isSymbolicLink()&&fs.lstatSync(path.join(root,'bin','WardogsImageText.exe')).isFile()&&
    cap.sha256===createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
  }catch{return false;}
 }
 function recoveryAvailable(){try{return available()&&JSON.parse(fs.readFileSync(path.join(root,'bin','entry-capabilities.json'),'utf8')).restartRecovery===true;}catch{return false;}}
 const blocking=ownerId=>!!pendingAction&&(!ownerId||pendingAction.ownerId===ownerId);
 function view(){return current?structuredClone({...current,blocking:blocking(current.sessionId)}):null;}
 function state(phase,reason,extra={}){
  if(!current)return;const changed=current.phase!==phase;current={...current,...extra,phase,reason,at:new Date(now()).toISOString()};
  if(changed)emit('game_entry_state',{sessionId:current.sessionId,server:current.server,phase,reason});
 }
 function cancel(reason='Detenido con F8.'){
  typedJoinId=null;chain={};state('cancelled',reason,{operatorStopped:true,chainConfirmed:false,chainInvalidated:true});
 }
 function fail(reason){typedJoinId=null;chain={};state('error',reason,{chainConfirmed:false,chainInvalidated:true});}
 async function readReport(file,maxBytes=65536){
  const stat=await fsp.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxBytes)throw Error('Archivo de controlador no válido.');
  return JSON.parse((await fsp.readFile(file,'utf8')).replace(/^\uFEFF/,''));
 }
 async function pruneActions(){
  // Only completed action artifacts in this exact directory are eligible. The
  // passive watcher's files, other app data and links are never pruned here.
  const own=await fsp.lstat(dataDir);if(!own.isDirectory()||own.isSymbolicLink())return;
  const groups=new Map(),pattern=/^(?:entry-action-([0-9a-f-]{36})\.json(?:\.claimed|\.tmp)?|entry-result-([0-9a-f-]{36})\.json)$/i;
  for(const entry of await fsp.readdir(dataDir,{withFileTypes:true})){
   if(!entry.isFile())continue;const match=entry.name.match(pattern),id=match?.[1]||match?.[2];if(!UUID.test(id||''))continue;
   const file=path.join(dataDir,entry.name),stat=await fsp.lstat(file).catch(()=>null);if(!stat?.isFile()||stat.isSymbolicLink())continue;
   const group=groups.get(id)||{files:[],modified:-Infinity};group.files.push(file);group.modified=Math.max(group.modified,stat.mtimeMs);groups.set(id,group);
  }
  const ordered=[...groups.values()].sort((a,b)=>b.modified-a.modified);
  for(const group of ordered.slice(15))for(const file of group.files){const stat=await fsp.lstat(file).catch(()=>null);if(stat?.isFile()&&!stat.isSymbolicLink())await fsp.unlink(file).catch(()=>{});}
 }
 function watchReportSummary(report,ownerId){
  if(!report||typeof report!=='object')return {reportAt:null,lastStatus:'other',lastReason:null,schemaMatches:false,reportOwnerMatches:false,reportServiceMatches:false};
  const at=typeof report.at==='string'?Date.parse(report.at):NaN;
  return {reportAt:Number.isFinite(at)?new Date(at).toISOString():null,lastStatus:['watching','cancelled','closed'].includes(report.status)?report.status:'other',lastReason:report.reason==null?null:['operator_stop','watch_stopped','service_closed','deadline_reached'].includes(report.reason)?report.reason:'other',schemaMatches:report.format==='farmdogs-entry-watch-v1',reportOwnerMatches:report.sessionId===ownerId,reportServiceMatches:report.servicePid===process.pid};
 }
 function rememberWatchDiagnostic(code,{ownerId,owned,startup=false,report=undefined,readError=null}={}){
  // Freeze the first unhealthy observation before cooperative cleanup rewrites
  // the report to closed/watch_stopped. Only allowlisted scalars leave here.
  if(!current||current.sessionId!==ownerId||current.stopped||current.watchDiagnostic)return;
  const fromCurrentRead=report!==undefined,summary=fromCurrentRead?watchReportSummary(report,ownerId):owned?.lastReportSummary||null,age=summary?.reportAt?now()-Date.parse(summary.reportAt):NaN;
  const diagnostic={format:'farmdogs-entry-watch-diagnostic-v1',code,startup:startup===true,failure:code!=='operator_stop',at:new Date(now()).toISOString(),reportObserved:!!summary,reportFromCurrentRead:fromCurrentRead,reportAgeMilliseconds:Number.isFinite(age)?Math.round(age):null,reportAt:summary?.reportAt||null,lastStatus:summary?.lastStatus||null,lastReason:summary?.lastReason||null,schemaMatches:summary?.schemaMatches??null,reportOwnerMatches:summary?.reportOwnerMatches??null,reportServiceMatches:summary?.reportServiceMatches??null,watcherOwnerMatches:owned?.ownerId===ownerId,childExited:owned?.exited===true,childExitCode:Number.isInteger(owned?.exitCode)?owned.exitCode:null,childExitSignal:['SIGHUP','SIGINT','SIGQUIT','SIGABRT','SIGKILL','SIGTERM','SIGBREAK'].includes(owned?.exitSignal)?owned.exitSignal:null,childKilled:owned?.child?.killed===true,stopRequested:owned?.stopRequested===true,readError:['ENOENT','EACCES','EPERM','EISDIR','ELOOP','EINVAL','EIO','ENOTDIR','invalid_report'].includes(readError)?readError:null};
  current={...current,watchDiagnostic:diagnostic};
  emit('game_entry_watch_diagnostic',{sessionId:ownerId,server:current.server,diagnostic:structuredClone(diagnostic)});
 }
 async function watchHealth({startup=false}={}){
  const ownerId=current?.sessionId,owned=watcher;
  if(!watcher||watcher.ownerId!==current?.sessionId){rememberWatchDiagnostic('watcher_owner_mismatch',{ownerId,owned,startup});throw Error('El monitor de parada no pertenece a esta sesión.');}
  let report;
  try{report=await readReport(watcher.file,16384);}
  catch(error){if(!startup||error.code!=='ENOENT')rememberWatchDiagnostic('report_read_failure',{ownerId,owned,startup,readError:error.code||'invalid_report'});throw error;}
  owned.lastReportSummary=watchReportSummary(report,ownerId);
  if(report?.format!=='farmdogs-entry-watch-v1'||report.sessionId!==current.sessionId||report.servicePid!==process.pid){rememberWatchDiagnostic('report_identity_invalid',{ownerId,owned,startup,report});throw Error('La identidad del monitor de parada no es válida.');}
  if(report.status==='cancelled'&&report.reason==='operator_stop'){rememberWatchDiagnostic('operator_stop',{ownerId,owned,startup,report});cancel();const error=Error('Detenido con F8.');error.code='ENTRY_CANCELLED';throw error;}
  const age=now()-Date.parse(report.at);
  if(!Number.isFinite(age)||age<0||age>3000||report.status!=='watching'||watcher.exited||watcher.child?.killed===true){rememberWatchDiagnostic('watch_unhealthy',{ownerId,owned,startup,report});throw Error(startup?'No se pudo preparar la parada F8.':'Se perdió el monitor de parada F8; no se enviarán más entradas.');}
  return true;
 }
 async function stop({ownerId,reason='Entrada detenida.'}={}){
  if(!current||ownerId!==current.sessionId)return view();
  const owned=watcher?.ownerId===ownerId?watcher:null;
  if(!current.stopped){generation++;current={...current,stopped:true,stopReason:safeText(reason)};reader.stop();rawCapture=null;}
  if(owned&&!owned.stopRequested){
   owned.stopRequested=true;
   try{await fsp.writeFile(owned.file+'.stop','stop',{flag:'wx'});}catch(error){if(error.code!=='EEXIST')try{owned.child?.kill();}catch{}}
   const timer=setTimeout(()=>{if(!owned.exited)try{owned.child?.kill();}catch{}},1000);timer.unref?.();owned.cleanupTimer=timer;
  }
  const action=pendingAction?.ownerId===ownerId?pendingAction.promise:null;
  if(action){let timer;try{await Promise.race([action.catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,4000);})]);}finally{clearTimeout(timer);}}
  return view();
 }
 async function start({id,server,joinId,endAt,initialFocus:focusMode='driver',recovery=null}={}){
  if(closed||startPending||active()||blocking())throw Error('Ya hay una entrada automática activa o deteniéndose.');
  if(!UUID.test(id||'')||!Number.isInteger(server)||server<1||server>5||!UUID.test(joinId||''))throw Error('Destino de entrada no válido.');
  if(!['driver','desktop','none'].includes(focusMode)||focusMode==='none'&&!recovery||recovery&&focusMode!=='none')throw Error('Modo de foco inicial no válido.');
  const at=now(),end=Date.parse(endAt),mono=monoNow();
  if(!Number.isFinite(at)||!Number.isFinite(mono)||!Number.isFinite(end)||end<=at||end-at>720*60000)throw Error('Duración de entrada no válida.');
  if(!available())throw Error('Compila o actualiza el controlador de entrada automática.');
  let plan=null;
  if(recovery){
   if(!recoveryAvailable())throw Error('El controlador no permite recuperar reinicios de servidor.');
   const detected=Date.parse(recovery.detectedAt);
   if(!['id','rootEntryId','previousEntryId','seedingId','frameId'].every(key=>UUID.test(recovery[key]||''))||recovery.previousEntryId===id||!Number.isInteger(recovery.gamePid)||recovery.gamePid<1||!Number.isSafeInteger(recovery.gameWindow)||recovery.gameWindow<1||!Number.isFinite(detected)||detected>at||at-detected>5000||Date.parse(recovery.endAt)!==end)throw Error('Permiso interno de recuperación no válido.');
   plan={format:'farmdogs-entry-recovery-v1',recoveryId:recovery.id,entryId:id,root:path.resolve(root),dataDirectory:path.resolve(dataDir),servicePid:process.pid,rootEntryId:recovery.rootEntryId,previousEntryId:recovery.previousEntryId,seedingId:recovery.seedingId,gamePid:recovery.gamePid,gameWindow:recovery.gameWindow,detectedAt:new Date(detected).toISOString(),frameId:recovery.frameId,endAt:new Date(end).toISOString(),createdAt:new Date(at).toISOString()};
  }
  if(current&&!current.stopped)await stop({ownerId:current.sessionId,reason:'Preparando una sesión nueva.'});
  await fsp.mkdir(dataDir,{recursive:true});const ownDirectory=await fsp.lstat(dataDir);
  if(!ownDirectory.isDirectory()||ownDirectory.isSymbolicLink())throw Error('Directorio local de entrada no válido.');
  generation++;const token=generation;startedMono=mono;budgetMs=end-at;binding=null;typedJoinId=null;lastSection=null;chain={};attempts=new Map();actionFrames=new Set();lastActionMono=-Infinity;lastActionAt=-Infinity;lastCaptureAt=-Infinity;rawCapture=null;focusAttempted=false;lastFocusMono=-Infinity;reader.stop();
  recoveryPlan=plan;restartPermit=!!plan;
  if(plan){const planFile=path.join(dataDir,'entry-recovery-'+id+'.json');if(fs.existsSync(planFile))throw Error('El permiso de recuperación ya existe. Inicia una entrada nueva.');atomicJson(planFile,plan);binding={gamePid:plan.gamePid,gameWindow:plan.gameWindow,width:null,height:null};focusAttempted=true;}
  current={sessionId:id,server,joinId,endAt:new Date(end).toISOString(),phase:'waiting_game',at:new Date(at).toISOString(),capturedAt:null,frameId:null,gamePid:null,gameWindow:null,chainConfirmed:false,operatorStopped:false,stopped:false,focusAttempted:!!plan,initialFocusMode:focusMode,...(plan?{recoveryId:plan.recoveryId}:{}),reason:'Preparando F8 y esperando Wardogs en primer plano.'};
  const file=path.join(dataDir,'entry-watch-'+id+'.json');startPending=true;
  try{
   watcher={ownerId:id,file,child:null,exited:false,stopRequested:false};const owned=watcher;
   await new Promise((resolve,reject)=>{
    const child=spawn(executable,['--watch',file,current.endAt,String(process.pid)],{cwd:root,windowsHide:true,stdio:'ignore'});owned.child=child;
    child.once('error',error=>{owned.exited=true;reject(error);});
    child.once('exit',(code,signal)=>{owned.exited=true;owned.exitCode=code;owned.exitSignal=signal;clearTimeout(owned.cleanupTimer);});
    child.once('spawn',()=>{child.unref?.();resolve();});
   });
   const until=performance.now()+3000;
   while(same(token)){
    try{await watchHealth({startup:true});emit('game_entry_started',{sessionId:id,server});return view();}
    catch(error){if(error.code==='ENTRY_CANCELLED'||watcher.exited||error.code!=='ENOENT')throw error;if(performance.now()>=until)throw Error('El monitor F8 no respondió a tiempo.');await sleep(25);}
   }
   const error=Error('Entrada cancelada antes de abrir Wardogs.');error.code='ENTRY_CANCELLED';throw error;
  }catch(error){if(current?.sessionId===id&&!current.stopped&&!TERMINAL.has(current.phase)){if(error.code==='ENTRY_CANCELLED')cancel(safeText(error));else fail('No se pudo preparar la entrada: '+safeText(error));}await stop({ownerId:id,reason:safeText(error)});throw error;}
  finally{startPending=false;}
 }
 function frameBound(screen,raw){
  const source=raw?.source,age=now()-Date.parse(screen?.capturedAt);
  return screen?.status==='verified_capture'&&screen.gameForeground===true&&source?.frameId===screen.frameId&&source.gamePid===screen.gamePid&&source.window===screen.gameWindow&&Date.parse(source.captureFinishedAt)<=now()&&SHA.test(source.sha256||'')&&Number.isFinite(age)&&age>=0&&age<=5000&&Number.isInteger(raw?.width)&&Number.isInteger(raw?.height)&&raw.width>=320&&raw.width<=2600&&raw.height>=200&&raw.height<=2600;
 }
 function targetBinding(screen){
  if(!binding)binding={gamePid:screen.gamePid,gameWindow:screen.gameWindow,width:rawCapture.width,height:rawCapture.height};
  if(binding.gamePid!==screen.gamePid||binding.gameWindow!==screen.gameWindow){fail('Wardogs cambió de proceso o ventana. Inicia una entrada nueva.');return false;}
  if(binding.width!==rawCapture.width||binding.height!==rawCapture.height){typedJoinId=null;binding={...binding,width:rawCapture.width,height:rawCapture.height};}
  return true;
 }
 async function initialFocus(token){
  if(!same(token)||current.initialFocusMode!=='driver'||focusAttempted||monoNow()-lastFocusMono<2000)return;
  await watchHealth();if(!same(token))return;
  const ownerId=current.sessionId,issued=now(),file=path.join(dataDir,'entry-focus-'+ownerId+'.json');lastFocusMono=monoNow();
  const promise=(async()=>{
   try{
    await run(executable,['--focus-game',file,current.endAt,String(process.pid)],{cwd:root,windowsHide:true,timeout:4000,maxBuffer:65536});
    if(!same(token))return;
    const report=await readReport(file,16384),age=now()-Date.parse(report.at);
    if(report.format!=='farmdogs-entry-focus-v1'||report.sessionId!==ownerId||typeof report.found!=='boolean'||typeof report.focused!=='boolean'||report.focused&&!report.found||!Number.isFinite(age)||age<0||age>3000||Date.parse(report.at)<issued||report.found&&(!Number.isInteger(report.gamePid)||report.gamePid<1||!Number.isSafeInteger(report.gameWindow)||report.gameWindow<1))throw Error('No se pudo verificar el foco inicial.');
    await watchHealth();if(!same(token))return;
    if(report.reason==='operator_stop'){cancel();return;}
    if(report.found){
     focusAttempted=true;current={...current,focusAttempted:true,initialFocus:{found:true,focused:report.focused,reason:report.reason,at:report.at}};
     state('waiting_game',report.focused?'Wardogs está delante. Esperando reconocer la pantalla.':'Windows no permitió activar Wardogs. Pon el juego en primer plano para continuar.');
    }
   }catch(error){
    if(!same(token))return;
    if(error.code==='ENTRY_CANCELLED'){cancel(safeText(error));return;}
    // An uncertain result may already have activated the game. Never repeat it.
    focusAttempted=true;current={...current,focusAttempted:true,initialFocus:{found:null,focused:false,reason:'focus_result_unconfirmed',at:new Date(now()).toISOString()}};
    state('waiting_game','No se confirmó el foco inicial. Pon Wardogs en primer plano para continuar.');
   }
  })();
  const owned={ownerId,promise};pendingAction=owned;try{await promise;}finally{if(pendingAction===owned)pendingAction=null;}
 }
 function actionAllowed(action,screen){
  if(!action||!NAVIGATION.has(action.key)&&!CRITICAL.has(action.key)||!['click','replace_join_id','press_start'].includes(action.kind))throw Error('Paso de entrada sin confirmar.');
  if(action.key==='restart_continue'&&(!recoveryPlan||!restartPermit||attempts.has(action.key)||action.kind!=='click'))throw Error('El permiso único para confirmar el reinicio ya no está disponible.');
  if((action.kind==='replace_join_id')!==(action.key==='type_join_id'))throw Error('Tipo de acción no válido.');
  if((action.kind==='press_start')!==(action.key==='splash_continue'))throw Error('Tipo de inicio no válido.');
  const responseWait=action.key==='splash_continue'&&attempts.has(action.key)?8000:800;
  if(actionFrames.has(screen.frameId)||monoNow()-lastActionMono<responseWait)return false;
  if(CRITICAL.has(action.key)&&chain[action.key])return false;
  if((attempts.get(action.key)||0)>=3)throw Error('El paso no respondió tras tres intentos. Inicia una entrada nueva.');
  if(action.key==='lookup'&&(!chain.typed||typedJoinId!==current.joinId))throw Error('No se ha escrito el ID desde esta sesión.');
  if(action.key==='confirm_join'&&(!chain.typed||!chain.lookup))throw Error('La confirmación no pertenece a una búsqueda de esta sesión.');
  if(chain.confirm_join)return false;
  return true;
 }
 function verifyCriticalTarget(action){
  if(!CRITICAL.has(action.key)&&!recoveryPlan)return;
  let target;
  // The injected reader uses the existing trusted public catalogue. No name or
  // mode suffix authorizes a connection, and no new network request is made here.
  try{target=getTarget(current.server,current.joinId);}
  catch(error){throw Error('No se puede verificar el destino del servidor antes de '+(action.key==='lookup'?'buscarlo':'unirse')+': '+safeText(error));}
  if(target?.server!==current.server)throw Error('El catálogo ya no confirma el servidor elegido. Actualiza los servidores e inicia una entrada nueva.');
  if(!UUID.test(target.joinId||'')||target.joinId.toLowerCase()!==current.joinId.toLowerCase())throw Error('El ID de entrada del servidor ha cambiado. Actualiza los servidores e inicia una entrada nueva.');
  const age=now()-Date.parse(target.sourceAt);
  if(target.trusted===false||target.online===false||target.stale===true||!Number.isFinite(age)||age< -60000||age>90000)throw Error('La fuente del servidor está antigua, sin conexión o sin confirmar. Actualiza los servidores e inicia una entrada nueva.');
  if(recoveryPlan&&Date.parse(target.sourceAt)<=Date.parse(recoveryPlan.detectedAt))throw Error('Esperando una fuente oficial posterior al reinicio.');
  if(recoveryPlan&&(target.trusted!==true||target.online!==true||age<0))throw Error('El destino de recuperación no tiene una fuente oficial reciente.');
 }
 async function execute(action,screen,raw,token){
  if(!same(token)||!actionAllowed(action,screen))return;
  await watchHealth();if(!same(token))return;
  await pruneActions().catch(error=>emit('game_entry_cache_warning',{message:safeText(error)}));if(!same(token))return;
  verifyCriticalTarget(action);
  const issued=now(),id=randomUUID(),command={format:'farmdogs-entry-action-v1',id,sessionId:current.sessionId,issuedAt:new Date(issued).toISOString(),expiresAt:new Date(Math.min(issued+3000,Date.parse(current.endAt))).toISOString(),endAt:current.endAt,gamePid:screen.gamePid,gameWindow:screen.gameWindow,width:raw.width,height:raw.height,frameId:screen.frameId,frameCapturedAt:screen.capturedAt,framePath:raw.source.path,frameSha256:raw.source.sha256,kind:action.kind,control:action.key,bounds:action.bounds,...(action.anchorBounds?{anchorBounds:action.anchorBounds}:{}),...(action.kind==='replace_join_id'?{joinId:current.joinId}:{}),...(action.key==='restart_continue'?{recoveryId:recoveryPlan.recoveryId,restartHeaderBounds:action.restartHeaderBounds,restartMessageBounds:action.restartMessageBounds}:{})};
  const commandFile=path.join(dataDir,'entry-action-'+id+'.json'),resultFile=path.join(dataDir,'entry-result-'+id+'.json'),ownerId=current.sessionId;
  atomicJson(commandFile,command);if(!same(token))return;
  actionFrames.add(screen.frameId);attempts.set(action.key,(attempts.get(action.key)||0)+1);lastActionMono=monoNow();
  if(recoveryPlan)restartPermit=false;
  const promise=(async()=>{
   try{
    await run(executable,['--execute',commandFile,resultFile],{cwd:root,windowsHide:true,timeout:4000,maxBuffer:65536});
    const result=await readReport(resultFile),age=now()-Date.parse(result.at);
    if(result.format!=='farmdogs-entry-result-v1'||result.id!==id||result.sessionId!==ownerId||!Number.isFinite(age)||age<0||age>5000||Date.parse(result.at)<issued||Date.parse(result.at)>Date.parse(command.expiresAt))throw Error('El resultado de entrada no se puede verificar.');
    if(!same(token))return;
    current={...current,lastAction:{id,key:action.key,status:result.status,reason:result.reason||null,inputAttempted:typeof result.inputAttempted==='boolean'?result.inputAttempted:null,at:result.at}};
    if(result.status==='cancelled'&&result.reason==='operator_stop'){cancel();return;}
    if(result.success!==true||result.status!=='completed'){
     if(result.reason==='input_privilege_mismatch'){current={...current,inputPermission:'requires_elevation'};const error=Error('Wardogs está abierto con permisos superiores. Cierra FarmDogs por completo y vuelve a abrirla como administrador, o abre ambos con permisos normales.');error.code='ENTRY_INPUT_PRIVILEGES';throw error;}
     if(['invalid_control','invalid_action'].includes(result.reason)){const error=Error('El controlador no reconoce este paso. Reabre FarmDogs con la versión más reciente.');error.code='ENTRY_PROTOCOL_MISMATCH';throw error;}
     if(result.reason==='input_release_failed'){const error=Error('El estado de las teclas es incierto. Entrada detenida.');error.code='ENTRY_UNSAFE_INPUT';throw error;}
     // Only a verified, explicit pre-input rejection can retain a critical
     // lookup/join permit. A restart ACK may already be claimed before input.
     if(action.key!=='restart_continue'&&result.success===false&&result.status==='rejected'&&result.inputAttempted===false&&SAFE_PREINPUT_REJECTIONS.has(result.reason)){
      const attemptsSoFar=attempts.get(action.key)||0;if(attemptsSoFar<=1)attempts.delete(action.key);else attempts.set(action.key,attemptsSoFar-1);
      // Wardogs can mask the ID. After intervening input/focus, a prior write
      // cannot attest that the user left the field unchanged: write it again.
      if(action.key==='lookup'){typedJoinId=null;delete chain.typed;}
      state(CRITICAL.has(action.key)?'joining':'navigating','El paso se interrumpió antes de pulsar. Esperando una captura nueva para continuar.');return;
     }
     if(CRITICAL.has(action.key))throw Error('No se confirmó '+action.key+'; no se repetirá la conexión.');
     state('navigating','El paso no se completó; se comprobará una pantalla nueva.');return;
    }
    lastActionAt=Date.parse(result.at);emit('game_entry_action',{sessionId:ownerId,key:action.key,frameId:screen.frameId});
    if(action.key==='type_join_id'){typedJoinId=current.joinId;chain.typed={at:result.at,frameId:screen.frameId};}
    else if(action.key==='restart_continue'){chain.restart_ack={at:result.at,frameId:screen.frameId};state('navigating','Reinicio confirmado una vez. Esperando un menú nuevo para reconstruir la conexión.');}
    else if(action.key==='lookup'){chain.lookup={at:result.at,frameId:screen.frameId};state('joining','Esperando la confirmación del servidor.');}
    else if(action.key==='confirm_join'){chain.confirm_join={at:result.at,frameId:screen.frameId};current={...current,chainConfirmed:true};state('joining','Servidor confirmado. Esperando la entrada y el selector de equipo.');}
   }catch(error){if(same(token)){if(error.code==='ENTRY_PROTOCOL_MISMATCH'||error.code==='ENTRY_INPUT_PRIVILEGES')fail(safeText(error));else if(error.code==='ENTRY_UNSAFE_INPUT'||CRITICAL.has(action.key)||action.key==='type_join_id')fail('Resultado de entrada incierto; no se enviarán más acciones: '+safeText(error));else state('navigating','No se confirmó el paso; se comprobará otra captura antes de intentarlo.');}}
  })();
  const owned={ownerId,promise};pendingAction=owned;
  try{await promise;}finally{if(pendingAction===owned)pendingAction=null;}
 }
 async function tickInternal(token){
  if(!same(token)||startPending)return;
  const mono=monoNow();if(!Number.isFinite(mono)||mono<startedMono||mono-startedMono>=budgetMs||now()>=Date.parse(current.endAt)){fail('Terminó el tiempo de la entrada automática.');return;}
  await watchHealth();if(!same(token))return;
  rawCapture=null;await reader.refresh();if(!same(token))return;
  // OCR can take seconds. F8 pressed during recognition must also prevent the
  // selector/HUD handoff, even when this tick has no native click to execute.
  await watchHealth();if(!same(token))return;
  const screen=reader.view(),raw=rawCapture;
  if(!frameBound(screen,raw)){state(chain.confirm_join||chain.lookup?'joining':'waiting_game',screen.reason||'Esperando Wardogs en primer plano.',{capturedAt:null,frameId:null});await initialFocus(token);return;}
  // A first verified foreground frame also settles initial focus. Losing it
  // later means the user changed windows; do not activate the game again.
  if(!focusAttempted){focusAttempted=true;current={...current,focusAttempted:true};}
  if(!targetBinding(screen))return;
  const captured=Date.parse(screen.capturedAt);
  if(captured<lastActionAt||captured<lastCaptureAt){state('waiting_game','Esperando una captura posterior al último paso.',{capturedAt:null,frameId:null});return;}
  lastCaptureAt=captured;
  if(recoveryPlan&&captured<Date.parse(recoveryPlan.createdAt)){state('waiting_game','Esperando una captura nueva posterior al permiso de recuperación.');return;}
  const ownLookup=chain.typed&&chain.lookup?{server:current.server,joinId:current.joinId}:null;
  const classified=classifyEntryScreen(raw,{server:current.server,joinId:current.joinId,typedJoinId,ownLookup,recovery:restartPermit});
  current={...current,capturedAt:screen.capturedAt,frameId:screen.frameId,gamePid:screen.gamePid,gameWindow:screen.gameWindow};
  if(classified.phase==='error'){fail(classified.reason||'La pantalla indica un problema de conexión.');return;}
  if(recoveryPlan&&!chain.restart_ack&&classified.phase!=='restart_modal'){
   if(classified.phase==='unknown')state('waiting_game','Esperando el modal exacto de reinicio antes de cualquier acción de recuperación.');
   else fail('El modal de reinicio fue sustituido antes de confirmarlo. La recuperación se ha detenido.');
   return;
  }
  if(classified.phase!=='unknown'){
   const section=FORM.has(classified.phase)?'id_form':classified.phase;
   if(lastSection&&section!==lastSection)typedJoinId=null;
   lastSection=section;
  }
  if(['team_selector','deploying','gameplay_hud','queue'].includes(classified.phase)){
   if(!chain.confirm_join){fail('La pantalla no pertenece a una entrada completada por esta sesión. Inicia desde el menú.');return;}
   state(classified.phase==='queue'?'joining':classified.phase,classified.reason,{chainConfirmed:true});return;
  }
  if(chain.confirm_join){
   if(classified.phase==='join_confirmation'){state('joining','Esperando que el servidor termine de conectar.');return;}
   if(classified.phase!=='unknown'){fail('El juego volvió a un menú después de confirmar el servidor. No se reconecta solo.');return;}
   state('joining','Esperando carga o selector del equipo.');return;
  }
  if(chain.lookup&&classified.phase!=='join_confirmation'){
   if(['unknown','join_id_input','join_id_ready'].includes(classified.phase)){state('joining','Esperando la respuesta de la búsqueda, sin repetirla.');return;}
   fail('La búsqueda volvió a otro menú. No se repetirá automáticamente.');return;
  }
  if(classified.phase==='join_confirmation'&&classified.server!==current.server){fail('La confirmación muestra otro servidor.');return;}
  if(classified.action){state(classified.action.key==='lookup'||classified.action.key==='confirm_join'?'joining':'navigating',classified.reason);await execute(classified.action,screen,raw,token);}
  else state(chain.lookup?'joining':'waiting_game',classified.reason||'Esperando reconocer el siguiente paso.');
 }
 async function tick(){
  if(!active()||closed||startPending)return;
  if(tickPending)return tickPending;
  const token=generation,owner=current.sessionId;
  const pending=Promise.resolve().then(()=>tickInternal(token)).catch(error=>{if(same(token)){if(error.code==='ENTRY_CANCELLED')cancel(safeText(error));else fail(safeText(error));}}).finally(async()=>{if(current?.sessionId===owner&&TERMINAL.has(current.phase))await stop({ownerId:owner,reason:current.reason});});
  tickPending=pending;try{await pending;}finally{if(tickPending===pending)tickPending=null;}
 }
 async function checkReady(ownerId){
  const token=generation;
  if(!same(token)||current.sessionId!==ownerId||startPending)return false;
  const withinDeadline=()=>{const elapsed=monoNow()-startedMono;return Number.isFinite(elapsed)&&elapsed>=0&&elapsed<budgetMs&&now()<Date.parse(current.endAt);};
  if(!withinDeadline()){fail('Terminó el tiempo de la entrada automática.');return false;}
  try{await watchHealth();}catch(error){if(same(token)){if(error.code==='ENTRY_CANCELLED')cancel(safeText(error));else fail(safeText(error));}return false;}
  if(!same(token)||current.sessionId!==ownerId)return false;
  if(!withinDeadline()){fail('Terminó el tiempo de la entrada automática.');return false;}
  return true;
 }
 async function close(){if(closed)return;const ownerId=current?.sessionId;closed=true;await stop({ownerId,reason:'El servicio local se cerró.'});}
 return {available,recoveryAvailable,start,tick,checkReady,view,stop,blocking,active,close};
}
module.exports={createGameEntry};
