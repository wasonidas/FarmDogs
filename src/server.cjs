const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID,randomBytes}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {madridToUtc,validateProfile,defaultProfiles,normalizeServers,serverView,recommend,advanceObservation,rewardDifference}=require('./domain.cjs');
const {atomicJson,readJson,appendEvent}=require('./store.cjs');
const {normalizeAccountImport,browserBaselineFile}=require('./account-import.cjs');
const {movementView}=require('./movement-status.cjs');
const {connectionTarget,createLocalLauncher}=require('./local-launch.cjs');
const {seedingCondition}=require('./seeding-condition.cjs');
const {createScheduledOpening}=require('./scheduled-opening.cjs');
const {sessionDiagnostics}=require('./session-diagnostics.cjs');
const {createAutoSession}=require('./auto-session.cjs');
const {isAdmittedSeedingContinuation}=require('./auto-seeding.cjs');
const {createActivityMode}=require('./activity-mode.cjs');
const {createRewardProtection}=require('./reward-protection.cjs');
const {createTeamClicker}=require('./team-clicker.cjs');
const {createEntryFlow}=require('./entry-flow.cjs');
const {createAppUpdate}=require('./app-update.cjs');
const {currentClanAssociation}=require('./clan-association.cjs');
const {createClanPresence}=require('./clan-presence.cjs');
function createObserver(options={}){
const ROOT=path.resolve(__dirname,'..');
const DATA=path.resolve(options.dataDir||process.env.WARDOGS_DATA_DIR||path.join(ROOT,'data'));
let PORT=options.port??Number(process.env.WARDOGS_PORT||24243);
const fetcher=options.fetchImpl||fetch;
const utcNow=options.utcNow||Date.now;
const monoNow=options.monoNow||(()=>performance.now());
const isoNow=()=>new Date(utcNow()).toISOString();
const launcher=options.launcher||createLocalLauncher({root:ROOT});
let lastLaunch=null,entryOrigin=null,activityMovementId=null,updateShutdownRequested=false,updateShutdownId=null,updateShutdownRequestedAt=null,updateShutdownTimer=null;
const PUBLIC_URL='https://api.wardogsspain.com/api/portal/public/wardogs-servers';
const token=randomBytes(24).toString('hex');
const configFile=path.join(DATA,'settings.json'),runtimeFile=path.join(DATA,'runtime.json');
let config=readJson(configFile,{profiles:defaultProfiles(),selectedServer:2,durationMinutes:120});
config.profiles=config.profiles.map(validateProfile);
let runtime=readJson(runtimeFile,{watch:null,lastResult:null});
if(runtime.watch){
 runtime.lastResult=['scheduled','watching','threshold_candidate','target_candidate','unknown_source','requires_review','rule_unknown','time_candidate'].includes(runtime.watch.status)?{...runtime.watch,status:'interrupted',reason:'El observador se reinició. Inicia una nueva observación.'}:runtime.watch;runtime.watch=null;
}
let servers=[],lastSuccessAt=null,lastAttemptAt=null,sourceError=null,fetchInFlight=false,nextFetchAt=0,failures=0,watchMonoStart=null,lastPersistElapsed=0,closePromise=null;
const events=[];
function event(kind,detail={}){const item={at:isoNow(),kind,...detail};events.unshift(item);events.splice(100);appendEvent(path.join(DATA,'events.jsonl'),item);}
function persist(){atomicJson(runtimeFile,runtime);}
const clanPresence=createClanPresence({now:utcNow,fetchImpl:fetcher,event,getAssociation:()=>accountView().clanAssociation||{status:'disconnected'},getServers:publicViews});
const rewardProtection=createRewardProtection({load:()=>readJson(path.join(DATA,'reward-protection.json')),save:value=>atomicJson(path.join(DATA,'reward-protection.json'),value),now:utcNow,monoNow,event});
const teamClicker=createTeamClicker({root:ROOT,dataDir:DATA,now:utcNow,monoNow,event,...options.teamClickerOptions});
const entryDriver=options.entryDriver||(launcher.availability().automaticEntry===true?require('./game-entry.cjs').createGameEntry({root:ROOT,dataDir:DATA,now:utcNow,monoNow,event,getTarget:(number,id)=>connectionTarget(publicViews(),number,id)}):{available:()=>false,view:()=>null,blocking:()=>false,stop:()=>{}});
const entryAvailable=()=>entryDriver.available()&&(!!options.entryDriver||launcher.availability().automaticEntry===true);
const opening=createScheduledOpening({load:()=>readJson(path.join(DATA,'opening-plan.json')),save:job=>atomicJson(path.join(DATA,'opening-plan.json'),job),now:utcNow,event,
 resolveTarget:(number,id)=>{
  const target=connectionTarget(publicViews(),number,id);
  if(runtime.watch&&['scheduled',...activeStates].includes(runtime.watch.status)&&runtime.watch.server!==number)throw Error('Detén el seguimiento antes de preparar otro servidor.');
  if(movement().armed===true)throw Error('Detén el movimiento antes de preparar una apertura.');
  return {...target,entryCandidate:publicViews().find(s=>s.number===number)?.entryCandidate===true,automaticEntry:entryAvailable()};
 },
 openGame:async(target,job,isCurrent)=>{
  if(entryAvailable()){
   if(job.seeding&&publicViews().find(s=>s.number===target.server)?.seedingActive!==true)throw Error('El servidor indica seeding desactivado.');
   await beginEntry(target,{...(job.seeding||{durationMinutes:Math.min(config.durationMinutes,720)}),team:job.team},!!job.seeding,null,isCurrent,{kind:'schedule',ownerId:job.id});return;
  }
  teamClicker.stop('La programación ha preparado una sesión de seeding.');
  let preparedId=null;
  if(job.seeding){
   if(publicViews().find(s=>s.number===target.server)?.seedingActive!==true)throw Error('El servidor indica seeding desactivado.');
   const prepared=await automatic.start({...job.seeding,server:target.server,purpose:'seeding'});
   preparedId=prepared.id;
   if(!isCurrent()){if(automatic.view()?.id===prepared.id)automatic.stop('Programación interrumpida antes de abrir el juego.');return;}
   if(automatic.view()?.id!==prepared.id||!automatic.active())return;
  }
  try{await launcher.openGame();lastLaunch={...target,kind:'game',requestedAt:isoNow(),status:'launch_requested'};}
  catch(error){if(job.seeding&&automatic.view()?.id===preparedId)automatic.stop('No se pudo solicitar la apertura programada.','error');throw error;}
 }
});
const automatic=createAutoSession({root:ROOT,dataDir:DATA,now:utcNow,monoNow,launcher,event,getInputs:(number,purpose)=>purpose==='break'?{movement:movement()}:{server:publicViews().find(s=>s.number===number),account:accountView(),movement:movement()},...(options.screenReader?{reader:options.screenReader}:{})});
const entry=createEntryFlow({now:utcNow,monoNow,driver:entryDriver,launcher,teamClicker,automatic,event,getTarget:(number,id)=>connectionTarget(publicViews(),number,id),getInputs:()=>({movement:movement()})});
async function beginEntry(target,settings={},seeding=true,endAt=null,isCurrent=()=>true,origin={kind:'manual'}){
 if(!entryAvailable())throw Error('Compila o instala el controlador de entrada automática antes de usar esta función.');
 if(!isCurrent())return null;
 const choice=teamClicker.view(),defaultTeam=seeding&&choice.automaticAnyTeamAvailable===true?'any':choice.team;
 const pending=entry.start({server:target.server,joinId:target.joinId,team:settings.team||defaultTeam,seeding,durationMinutes:settings.durationMinutes??config.durationMinutes,startPlayers:settings.startPlayers??20,intervalSeconds:settings.intervalSeconds??60,holdMs:settings.holdMs??500,initialFocus:settings.initialFocus??'driver'},{endAt});
 entryOrigin={...origin,entryId:entry.view()?.id};
 const prepared=await pending;
 if(!isCurrent()){if(entry.view()?.id===prepared.id)entry.stop('La programación se canceló antes de completar la entrada.');return prepared;}
 lastLaunch={...target,kind:'automatic_entry',requestedAt:isoNow(),status:'entry_requested',entryId:prepared.id};
 return prepared;
}
const activity=createActivityMode({load:()=>readJson(path.join(DATA,'activity-mode.json')),save:value=>atomicJson(path.join(DATA,'activity-mode.json'),value),now:utcNow,monoNow,getServers:publicViews,event,automaticEntry:entryAvailable,
 limitEndAt:endAt=>{const guard=readJson(path.join(DATA,'movement-run.json'));if(guard&&guard.dayMadrid===new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(utcNow()))){const limit=Date.parse(guard.stopAtUtc);if(!Number.isFinite(limit)||limit<=utcNow())throw Error('Se alcanzó el límite de hoy.');if(limit<Date.parse(endAt))return guard.stopAtUtc;}return endAt;},
 prepare:async(target,budget,isCurrent)=>{
  const fresh=connectionTarget(publicViews(),target.server,target.joinId);
  if(automatic.active()||movement().armed===true||movement().busy===true)throw Error('Hay otra sesión de movimiento activa.');
  if(['scheduled','launching'].includes(opening.view()?.status))throw Error('Hay una apertura programada activa.');
  if(runtime.watch&&['scheduled',...activeStates].includes(runtime.watch.status))throw Error('Hay un seguimiento activo.');
  if(!isCurrent())return;
  if(entryAvailable()){
   config={...config,selectedServer:fresh.server};atomicJson(configFile,config);
   await beginEntry(fresh,{durationMinutes:budget.remainingMinutes,...budget.settings},true,budget.sessionEndAt,isCurrent,{kind:'activity',ownerId:activity.view()?.id});return;
  }
  const prepared=await automatic.start({server:fresh.server,durationMinutes:budget.remainingMinutes,...budget.settings,purpose:'seeding'},{endAt:budget.sessionEndAt});
  activityMovementId=prepared.id;
  if(!isCurrent()){if(automatic.view()?.id===prepared.id)automatic.stop('Vigilancia detenida antes de abrir el juego.');return;}
  const motion=movement();
  if(automatic.view()?.id!==prepared.id||!automatic.active()||[prepared.id,activity.view()?.id].includes(motion.autoOperatorStopped)){
   activity.stop('Preparación cancelada antes de abrir el juego.');
   if(automatic.view()?.id===prepared.id)automatic.stop();return;
  }
  config={...config,selectedServer:fresh.server};atomicJson(configFile,config);
  try{await launcher.openGame();lastLaunch={...fresh,kind:'game',requestedAt:isoNow(),status:'launch_requested'};}
  catch(error){if(automatic.view()?.id===prepared.id)automatic.stop('No se pudo abrir Wardogs por actividad.','error');throw error;}
 }
});
function updateBusy(){
 const manifest=readJson(path.join(ROOT,'manifest.json'));
 if(manifest?.application!=='FarmDogs'||manifest?.format!=='wardogs-portable-v1'||fs.existsSync(path.join(ROOT,'.git')))return {busy:true,reason:'Esta es la copia de desarrollo. Las actualizaciones se instalan en el portable.'};
 const motion=movement(),reward=rewardProtection.view();
 if(entry.active()||entry.view()?.cleanupPending||teamClicker.blocking()||automatic.active()||motion.armed===true||motion.busy===true||activity.active()||['scheduled','launching'].includes(opening.view()?.status)||runtime.watch&&['scheduled',...activeStates].includes(runtime.watch.status))return {busy:true,reason:'La actualización esperará a que terminen los automatismos y programaciones.'};
 if(reward.attempts?.some(attempt=>attempt.status==='reserved'))return {busy:true,reason:'La protección de premios está terminando una operación.'};
 return {busy:false,reason:'FarmDogs está inactivo.'};
}
async function prepareUpdateShutdown({phase,plan}){
 if(phase==='prepare')return {processes:[{pid:process.pid,executablePath:process.execPath}]};
 if(phase!=='commit')throw Error('Fase de actualización no válida.');
 const at=utcNow();atomicJson(path.join(DATA,'app-shutdown.json'),{format:'farmdogs-app-shutdown-v1',id:plan.id,root:ROOT,servicePid:process.pid,issuedAt:new Date(at).toISOString(),expiresAt:new Date(at+5000).toISOString()});
 updateShutdownRequested=true;updateShutdownId=plan.id;updateShutdownRequestedAt=new Date(at).toISOString();
 updateShutdownTimer=setTimeout(()=>{void close().finally(()=>{if(require.main===module)process.exit(0);});},500);
}
const updater=options.appUpdate||createAppUpdate({root:ROOT,dataDir:DATA,now:utcNow,event,getBusy:updateBusy,prepareShutdown:options.prepareUpdateShutdown||prepareUpdateShutdown,...options.updateOptions});
function activityCommand(kind,job){
 if(!job)return;const at=utcNow();atomicJson(path.join(DATA,'movement-command.json'),{format:'wardogs-automatic-movement-v1',id:randomUUID(),sessionId:job.id,kind,issuedAt:new Date(at).toISOString(),expiresAt:new Date(at+3000).toISOString(),endAt:job.endAt,intervalSeconds:job.seeding.intervalSeconds,holdMs:job.seeding.holdMs,directions:'AD',cancelled:kind==='stop',reason:job.reason});
}
function stopActivity(reason){const job=activity.view();if(activity.active()){activity.stop(reason);try{activityCommand('stop',job);}catch(error){try{event('activity_stop_write_error',{message:error.message});}catch{}}}}
async function tickActivity(){
 if(!activity.active())return;const job=activity.view(),motion=movement();
 if(motion.available&&motion.autoOperatorStopped===job.id){stopActivity('Detenido con F8.');if(automatic.active())automatic.stop();return;}
 if(job.status==='watching'&&motion.autoSessionId!==job.id)activityCommand('watch',job);
 await activity.tick();
 if(!activity.active()&&activity.view()?.status!=='prepared')activityCommand('stop',activity.view());
}
function publicViews(){const now=utcNow();return config.profiles.map(profile=>{const s=servers.find(s=>s.number===profile.server);return serverView(s||{number:profile.server,apiId:null,name:`Servidor #${profile.server}`,players:null,capacity:null,trusted:false,reason:'Servidor ausente de la última lectura',sourceAt:lastSuccessAt,seedingActive:false},profile,now,sourceError);});}
function accountView(){
 if(options.accountProvider)return options.accountProvider();
 const file=path.join(DATA,'account-snapshot.json');
 let account;try{account=readJson(file);}catch{return {available:false,reason:'Registro de cuenta no legible'};}
 if(!account)return {available:false,reason:'Sin conexión de cuenta verificada'};
 const vip=account.vip,seeding=account.seeding;
 const vipAge=vip?utcNow()-Date.parse(vip.observedAt):Infinity,seedingAge=seeding?utcNow()-Date.parse(seeding.observedAt):Infinity;
 const running=account.status==='observing'||account.status==='browser_snapshot';
 const vipFresh=running&&vipAge>=-60000&&vipAge<100000&&!!vip?.data?.prioridad&&Array.isArray(vip?.data?.historial)&&!account.errors?.some(e=>e.kind==='vip');
 const countedAge=seeding?.data?.contando===true?utcNow()-Date.parse(seeding.data.contadoAt):0;
 const seedingFresh=running&&seedingAge>=-60000&&seedingAge<100000&&typeof seeding?.data?.estado==='string'&&Number.isFinite(countedAge)&&countedAge>=-60000&&countedAge<=120000&&!account.errors?.some(e=>e.kind==='sedeo');
 let difference={status:'unknown',newSeeding:[],expiryDeltaMs:null};
 try{const name=account.status==='browser_snapshot'?browserBaselineFile(vip?.observedAt):'account-baseline.json';const baseline=readJson(path.join(DATA,name));if(baseline&&vipFresh)difference=rewardDifference(baseline,vip.data,config.selectedServer,baseline.observedAt);}catch{}
 return {available:vipFresh||seedingFresh,vipFresh,seedingFresh,vipAt:vip?.observedAt,seedingAt:seeding?.observedAt,vip:vip?.data?.prioridad||null,history:Array.isArray(vip?.data?.historial)?vip.data.historial:[],seeding:seeding?.data||null,clanAssociation:currentClanAssociation(account.clanAssociation,{running,now:utcNow()}),condition:seedingFresh?seedingCondition(seeding.data,utcNow()):{status:'unknown',mode:null,reason:'Hace falta una lectura reciente de la cuenta.',rewardVerified:false},difference,differenceServer:config.selectedServer,errors:(account.errors||[]).map(e=>({kind:e.kind,error:e.error})),status:account.status};
}
async function refreshServers(){
 if(fetchInFlight||utcNow()<nextFetchAt)return;
 fetchInFlight=true;lastAttemptAt=isoNow();
 try{
  const response=await fetcher(PUBLIC_URL,{signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});
  if(!response.ok){const error=Error('La fuente responde HTTP '+response.status);error.retryAfter=response.headers.get('retry-after');throw error;}
  servers=normalizeServers(await response.json(),utcNow());
  if(sourceError)event('source_recovered');sourceError=null;failures=0;lastSuccessAt=isoNow();nextFetchAt=utcNow()+30000;
  appendEvent(path.join(DATA,'population.jsonl'),{at:lastSuccessAt,servers});
 }catch(error){
  failures++;sourceError=error.message;
  const raw=error.retryAfter;let requested=raw?Number(raw)*1000:0;if(raw&&!Number.isFinite(requested))requested=Date.parse(raw)-utcNow();
  const backoff=Math.max(30000*Math.pow(2,Math.min(failures-1,4)),Number.isFinite(requested)?Math.max(0,requested):0);
  nextFetchAt=utcNow()+Math.min(3600000,backoff);event('source_error',{message:sourceError,retryAt:new Date(nextFetchAt).toISOString()});
 }finally{fetchInFlight=false;tickWatch();}
}
const activeStates=new Set(['watching','threshold_candidate','target_candidate','unknown_source','requires_review','rule_unknown','time_candidate']);
function finishWatch(status,reason){if(!runtime.watch)return;runtime.watch={...runtime.watch,status,reason,finishedAt:isoNow()};runtime.lastResult=runtime.watch;event('observation_finished',{id:runtime.watch.id,status,reason});persist();}
function tickWatch(){
 const w=runtime.watch;if(!w)return;
 if(w.status==='scheduled'){
  const overdue=utcNow()-Date.parse(w.scheduledAt);
  if(overdue<0)return;
  if(overdue>60000){finishWatch('missed','La hora pasó con el observador sin atender; no se inicia automáticamente.');return;}
  watchMonoStart=monoNow();runtime.watch={...w,status:'watching',startedAt:isoNow()};lastPersistElapsed=0;event('observation_started',{id:w.id,server:w.server});persist();return;
 }
 if(!activeStates.has(w.status))return;
 const elapsed=monoNow()-watchMonoStart;
 const view=publicViews().find(s=>s.number===w.server);
 const next=advanceObservation(w,view,elapsed);runtime.watch=next;
 if(next.status!==w.status){event('observation_state',{id:w.id,status:next.status,reason:next.reason});persist();}
 if(next.status==='expired'){finishWatch('expired',next.reason);}
 else if(elapsed-lastPersistElapsed>=30000){persist();lastPersistElapsed=elapsed;}
}
function movement(){try{return movementView(readJson(path.join(DATA,'movement-state.json')),utcNow());}catch{return {available:false,status:'unknown',armed:null,reason:'Registro del controlador no legible.'};}}
function state(){
 const account=accountView(),motion=movement(),views=publicViews(),autoSeeding=automatic.view();
 const seedingContinuity=Object.fromEntries(views.map(server=>[server.number,isAdmittedSeedingContinuation(server,account)]));
 const diagnostics=Object.fromEntries([1,2,3,4,5].map(selectedServer=>[selectedServer,sessionDiagnostics({config:{selectedServer},account,movement:motion,screen:autoSeeding?.screen},{now:utcNow()})]));
 const occupancy=updateBusy(),update={...updater.view(),installBlocked:occupancy.busy,installBlockedReason:occupancy.reason,shutdownRequested:updateShutdownRequested,shutdownId:updateShutdownId,shutdownRequestedAt:updateShutdownRequestedAt};
 return {appId:'wardogs-seeding-local-v1',installationRoot:ROOT,version:require('../package.json').version,capabilities:{standaloneMovement:true,automaticEntry:entryAvailable(),appUpdates:true},now:isoNow(),timeZone:'Europe/Madrid',token,config,source:{lastSuccessAt,lastAttemptAt,nextFetchAt:new Date(nextFetchAt||utcNow()).toISOString(),error:sourceError,refreshSeconds:30},servers:views,clanPresence:clanPresence.view(),recommendation:recommend(views),seedingContinuity,watch:runtime.watch,lastResult:runtime.lastResult,events,account,movement:motion,localTools:launcher.availability(),lastLaunch,opening:opening.view(),autoSeeding,entry:entry.view(),activity:activity.view(),rewards:rewardProtection.view(),teamClicker:teamClicker.view(),diagnostics,update};
}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>65536)throw Error('Solicitud demasiado grande.');}return JSON.parse(text||'{}');}
function requireSeedingPurpose(input){
 if(input?.purpose!==undefined&&input.purpose!=='seeding')throw Error('Usa Movimiento temporal para una ausencia; esta función prepara seeding.');
 if(input?.presenceMode==='entry'||input?.trustedEntry!==undefined||input?.entryProof!==undefined||input?.entryId!==undefined)throw Error('La comprobación de entrada solo puede proceder del flujo automático, no de esta solicitud.');
}
const server=http.createServer(async(req,res)=>{
 try{
  if(req.headers.host!==`127.0.0.1:${PORT}`&&req.headers.host!==`localhost:${PORT}`){send(res,403,{error:'Host no admitido'});return;}
  const origin=req.headers.origin;if(origin&&![`http://127.0.0.1:${PORT}`,`http://localhost:${PORT}`].includes(origin)){send(res,403,{error:'Origen no admitido'});return;}
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  const route=new URL(req.url,'http://127.0.0.1').pathname;
  if(req.method==='GET'&&route==='/api/state'){send(res,200,state());return;}
  if(req.method==='POST'){
   if(req.headers['x-session-token']!==token){send(res,403,{error:'Recarga la página antes de cambiar el seguimiento.'});return;}
   const input=await body(req);
   if(updater.view().status==='installing'&&!route.endsWith('/stop')&&!['/api/opening/cancel','/api/account/disconnect','/api/rewards/disconnect','/api/rewards/result'].includes(route))throw Error('FarmDogs está instalando una actualización. Espera a que vuelva a abrirse.');
   if(route==='/api/update/config'){updater.setEnabled(input.enabled);send(res,200,state());return;}
   if(route==='/api/update/check'){await updater.check();send(res,200,state());return;}
   if(route==='/api/update/install'){const occupancy=updateBusy();if(occupancy.busy)throw Error(occupancy.reason);await updater.install();send(res,200,state());return;}
   if(route==='/api/entry/start'){
    requireSeedingPurpose(input);
    if(entry.active()||automatic.active()||movement().armed===true||movement().busy===true||teamClicker.blocking())throw Error('Detén la sesión anterior antes de entrar automáticamente.');
    if(activity.active()||['scheduled','launching'].includes(opening.view()?.status)||runtime.watch&&['scheduled',...activeStates].includes(runtime.watch.status))throw Error('Detén las programaciones y seguimientos antes de iniciar otra entrada.');
    if(input.seeding!==undefined&&typeof input.seeding!=='boolean')throw Error('Indica si quieres iniciar seeding después de entrar.');
    const target=connectionTarget(publicViews(),input.server,input.expectedJoinId);
    const seeding=input.seeding!==false;
    if(seeding&&publicViews().find(s=>s.number===target.server)?.seedingActive!==true)throw Error('El servidor no admite nuevas sesiones de seeding. Puedes elegir solo entrar.');
    await beginEntry(target,input,seeding);
    config={...config,selectedServer:target.server};atomicJson(configFile,config);send(res,200,state());return;
   }
   if(route==='/api/entry/stop'){
    if(input.expectedSessionId!==undefined&&input.expectedSessionId!==entry.view()?.id)throw Error('La entrada cambió; no se detuvo otra sesión.');
    entry.stop('Entrada detenida por el usuario.');send(res,200,state());return;
   }
   if(route==='/api/team-clicker/config'){
    if(entry.active())throw Error('Detén la entrada automática antes de cambiar la selección de equipo.');
    if(input.enabled&&(automatic.active()||movement().armed===true||movement().busy===true||activity.active()||['scheduled','launching'].includes(opening.view()?.status)))throw Error('Detén el seeding y sus programaciones antes de preparar el autoclic. Después de elegir equipo podrás iniciar seeding.');
    await teamClicker.configure(input);send(res,200,state());return;
   }
   if(route==='/api/team-clicker/heartbeat'){teamClicker.heartbeat(input);send(res,200,{ok:true});return;}
   if(route==='/api/team-clicker/calibrate'){teamClicker.calibrate(input);send(res,200,state());return;}
   if(route==='/api/team-clicker/stop'){
    if(input.expectedSessionId!==undefined&&input.expectedSessionId!==teamClicker.view().sessionId)throw Error('La sesión de autoclic cambió; no se detuvo la nueva sesión.');
    if(entry.active())entry.stop('Selección detenida por el usuario.');else teamClicker.stop();send(res,200,state());return;
   }
   if(route==='/api/rewards/config'){rewardProtection.configure(input);send(res,200,state());return;}
   if(route==='/api/rewards/observe'){if(!rewardProtection.observe(input))throw Error('Lectura de retos no admitida o desactualizada.');send(res,200,state());return;}
   if(route==='/api/rewards/disconnect'){rewardProtection.disconnect(input.readerId);send(res,200,state());return;}
   if(route==='/api/rewards/next'){send(res,200,{command:rewardProtection.next(input)});return;}
   if(route==='/api/rewards/authorize'){send(res,200,{command:rewardProtection.authorize(input)});return;}
   if(route==='/api/rewards/result'){if(!rewardProtection.result(input))throw Error('Resultado de cobro no admitido.');send(res,200,state());return;}
   if(route==='/api/activity/start'){
    requireSeedingPurpose(input);requireSeedingPurpose(input.seeding);
    if(entry.active())throw Error('Detén la entrada automática antes de vigilar actividad.');
    if(teamClicker.blocking())throw Error('Apaga el autoclic de equipo antes de iniciar seeding y espera a que se detenga.');
    if(!launcher.availability().automaticMovement||!launcher.availability().game)throw Error('El modo por actividad necesita el controlador y Steam en Windows.');
    if(automatic.active()||movement().armed===true||movement().busy===true)throw Error('Detén la sesión anterior antes de vigilar actividad.');
    if(['scheduled','launching'].includes(opening.view()?.status)||runtime.watch&&['scheduled',...activeStates].includes(runtime.watch.status))throw Error('Detén las otras programaciones o seguimientos.');
    const watching=activity.start(input);
    try{activityCommand('watch',watching);await launcher.openMovementBackground();}catch(error){if(activity.view()?.id===watching.id)try{stopActivity('No se pudo preparar el controlador para F8.');}catch{}throw error;}
    send(res,200,state());return;
   }
   if(route==='/api/activity/stop'){
    const ownedEntry=entryOrigin?.kind==='activity'&&entryOrigin.entryId===entry.view()?.id&&entryOrigin.ownerId===activity.view()?.id;
    stopActivity();if(ownedEntry)entry.stop('Vigilancia detenida por el usuario.');
    if(automatic.view()?.id===activityMovementId)automatic.stop();send(res,200,state());return;
   }
   if(route==='/api/movement/start'){
    if(entry.active())throw Error('Detén la entrada automática antes de activar movimiento temporal.');
    if(input.purpose!==undefined&&input.purpose!=='break')throw Error('Esta función prepara movimiento temporal para una ausencia.');
    if(teamClicker.blocking())throw Error('Cancela la selección de equipo y espera a que se detenga antes de activar movimiento.');
    if(automatic.active()||movement().armed===true||movement().busy===true)throw Error('Detén el movimiento o seeding anterior antes de iniciar otra sesión.');
    if(activity.active()||['scheduled','launching'].includes(opening.view()?.status)||runtime.watch&&['scheduled',...activeStates].includes(runtime.watch.status))throw Error('Detén las programaciones y seguimientos antes de activar movimiento temporal.');
    await automatic.start({purpose:'break',durationMinutes:input.durationMinutes,intervalSeconds:input.intervalSeconds,holdMs:input.holdMs,confirmedDeployed:input.confirmedDeployed});
    send(res,200,state());return;
   }
   if(route==='/api/movement/stop'){
    const session=automatic.view();
    if(input.expectedSessionId!==undefined&&input.expectedSessionId!==session?.id)throw Error('La sesión de movimiento cambió; no se detuvo otra sesión.');
    if(session?.purpose==='break'&&automatic.active())automatic.stop('Movimiento temporal detenido por el usuario.');
    send(res,200,state());return;
   }
   if(route==='/api/seeding/start'){
    requireSeedingPurpose(input);
    if(entry.active())throw Error('Ya hay una entrada automática activa.');
    if(teamClicker.blocking())throw Error('Apaga el autoclic de equipo antes de iniciar seeding y espera a que se detenga.');
    if(activity.active())throw Error('Detén la vigilancia por actividad antes de elegir una sesión manual.');
    const target=connectionTarget(publicViews(),input.server,input.expectedJoinId);
    const manualPresence=input.presenceMode==='manual',selectedPublic=publicViews().find(s=>s.number===input.server),continuing=!manualPresence&&isAdmittedSeedingContinuation(selectedPublic,accountView());
    if(!manualPresence&&selectedPublic?.seedingActive!==true&&!continuing)throw Error('El servidor no admite nuevos seeders y la cuenta no confirma un ciclo en curso.');
    if(movement().armed===true||movement().busy===true)throw Error('Detén el movimiento anterior antes de iniciar seeding.');
    if(['scheduled','launching'].includes(opening.view()?.status))throw Error('Cancela la apertura programada antes de iniciar seeding.');
    if(runtime.watch&&['scheduled',...activeStates].includes(runtime.watch.status)&&runtime.watch.server!==target.server)throw Error('Detén el seguimiento anterior antes de cambiar de servidor.');
    if(!manualPresence&&!continuing&&entryAvailable()){
     await beginEntry(target,input,true);config={...config,selectedServer:target.server};atomicJson(configFile,config);send(res,200,state());return;
    }
    const prepared=await automatic.start(input);
    if(automatic.view()?.id!==prepared.id||!automatic.active()){send(res,200,state());return;}
    if(!manualPresence&&!continuing){try{await launcher.openGame();}catch(error){if(automatic.view()?.id===prepared.id)automatic.stop('No se pudo solicitar abrir Wardogs.','error');throw error;}}
    config={...config,selectedServer:target.server};atomicJson(configFile,config);
    if(!manualPresence&&!continuing)lastLaunch={...target,kind:'game',requestedAt:isoNow(),status:'launch_requested'};send(res,200,state());return;
   }
   if(route==='/api/seeding/stop'){entry.stop('Sesión detenida por el usuario.');teamClicker.stop();stopActivity();if(opening.view()?.status==='scheduled')opening.cancel();else if(opening.view()?.status==='launching')opening.interrupt();automatic.stop();send(res,200,state());return;}
   if(route==='/api/opening/schedule'){
    requireSeedingPurpose(input);requireSeedingPurpose(input.seeding);
    if(entry.active())throw Error('Detén la entrada automática antes de programar otra sesión.');
    if(teamClicker.blocking())throw Error('Apaga el autoclic de equipo antes de programar seeding.');
    if(activity.active())throw Error('Detén la vigilancia por actividad antes de programar otra apertura.');
    if(automatic.active())throw Error('Detén la sesión de seeding antes de programar otra apertura.');
    if(!launcher.availability().game)throw Error('La apertura programada requiere Windows.');
    if(input.seeding&&!launcher.availability().automaticMovement)throw Error('Actualiza el controlador automático antes de programar seeding.');
    opening.schedule(input);
    if(config.selectedServer!==input.server){config={...config,selectedServer:input.server};atomicJson(configFile,config);event('config_saved');}
    send(res,200,state());return;
   }
   if(route==='/api/opening/cancel'){opening.cancel();send(res,200,state());return;}
   if(route==='/api/open/game'){
    if(entry.active())throw Error('Ya hay una entrada automática activa.');
    if(activity.active())throw Error('Detén la vigilancia por actividad antes de abrir manualmente.');
    if(['scheduled','launching'].includes(opening.view()?.status))throw Error('Cancela la apertura programada antes de abrir manualmente.');
    const target=connectionTarget(publicViews(),input.server,input.expectedJoinId);
    if(automatic.active()&&automatic.view().server!==target.server)throw Error('Detén la sesión de movimiento antes de elegir otro servidor.');
    const watching=runtime.watch&&(activeStates.has(runtime.watch.status)||runtime.watch.status==='scheduled');
    if(watching&&runtime.watch.server!==target.server)throw Error('Detén el seguimiento antes de preparar la entrada a otro servidor.');
    if(config.selectedServer!==target.server){config={...config,selectedServer:target.server};atomicJson(configFile,config);event('config_saved');}
    if(entryAvailable()){
     if(automatic.active()||movement().armed===true||movement().busy===true||teamClicker.blocking())throw Error('Detén los automatismos anteriores antes de entrar a otro servidor.');
     await beginEntry(target,{team:input.team,durationMinutes:Math.min(config.durationMinutes,720)},false);send(res,200,state());return;
    }
    await launcher.openGame();
    lastLaunch={...target,kind:'game',requestedAt:isoNow(),status:'launch_requested'};
    event('game_open_requested',{server:target.server});send(res,200,state());return;
   }
   if(route==='/api/open/movement'){
    if(entry.active())entry.stop('Entrada detenida para revisar las herramientas.');
    if(teamClicker.blocking())throw Error('Apaga el autoclic de equipo antes de abrir las pruebas de movimiento.');
    stopActivity('Vigilancia detenida para revisar las herramientas.');
    if(automatic.active())automatic.stop('Sesión detenida para revisar las herramientas de prueba.');
    await launcher.openMovement();lastLaunch={kind:'movement',requestedAt:isoNow(),status:'open_requested'};
    event('movement_open_requested');send(res,200,state());return;
   }
   if(route==='/api/account/import'){
    const account=normalizeAccountImport(input,utcNow());
    const baseline=path.join(DATA,browserBaselineFile(account.vip.observedAt));
    if(!fs.existsSync(baseline))atomicJson(baseline,{...account.vip.data,observedAt:account.vip.observedAt,source:account.vip.source});
    appendEvent(path.join(DATA,'account-browser-observations.jsonl'),account);
    atomicJson(path.join(DATA,'account-snapshot.json'),account);
    void clanPresence.tick().catch(error=>event('clan_presence_error',{message:error.message}));
    event('account_imported',{server:account.seeding.data.servidor??null});send(res,200,state());return;
   }
   if(route==='/api/account/disconnect'){
    if(typeof input.readerId!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.readerId))throw Error('Identificador del lector no válido.');
    const file=path.join(DATA,'account-snapshot.json'),snapshot=readJson(file);
    if(snapshot?.readerId===input.readerId){atomicJson(file,{...snapshot,status:'closed',closedAt:isoNow()});event('account_reader_disconnected');}
    send(res,200,state());return;
   }
   if(route==='/api/config'){
    if(entry.active())throw Error('Detén la entrada automática antes de cambiar los ajustes.');
    if(activity.active())throw Error('Detén la vigilancia por actividad antes de cambiar los ajustes.');
    if(automatic.active())throw Error('Detén el seeding antes de cambiar los ajustes.');
    if(runtime.watch&&(activeStates.has(runtime.watch.status)||runtime.watch.status==='scheduled'))throw Error('Detén la observación antes de editar su configuración.');
    if(!Number.isInteger(input.selectedServer)||input.selectedServer<1||input.selectedServer>5)throw Error('Elige un servidor del 1 al 5.');
    if(!Number.isInteger(input.durationMinutes)||input.durationMinutes<1||input.durationMinutes>1440)throw Error('La duración debe ser de 1 a 1440 minutos.');
    if(!Array.isArray(input.profiles)||input.profiles.length!==5)throw Error('Faltan perfiles de servidores.');
    const profiles=input.profiles.map(validateProfile);if(new Set(profiles.map(p=>p.server)).size!==5)throw Error('Hay perfiles duplicados.');
    config={selectedServer:input.selectedServer,durationMinutes:input.durationMinutes,profiles};atomicJson(configFile,config);event('config_saved');send(res,200,state());return;
   }
   if(route==='/api/watch/start'){
    if(entry.active())throw Error('Detén la entrada automática antes de iniciar un seguimiento.');
    if(automatic.active())throw Error('Detén la sesión de movimiento antes de iniciar un seguimiento.');
    if(activity.active())throw Error('Detén la vigilancia por actividad antes de iniciar otro seguimiento.');
    if(runtime.watch&&(activeStates.has(runtime.watch.status)||runtime.watch.status==='scheduled'))throw Error('Ya hay una observación activa o programada.');
    const profile=config.profiles.find(p=>p.server===config.selectedServer);
    let scheduledAt=null;if(input.madridStart){scheduledAt=madridToUtc(input.madridStart);if(Date.parse(scheduledAt)<=utcNow())throw Error('La hora de inicio debe estar en el futuro.');if(Date.parse(scheduledAt)>utcNow()+366*86400000)throw Error('Programa como máximo un año por adelantado.');}
    runtime.watch={id:randomUUID(),server:config.selectedServer,profile:structuredClone(profile),durationMinutes:config.durationMinutes,status:scheduledAt?'scheduled':'watching',scheduledAt,startedAt:scheduledAt?null:isoNow(),elapsedMs:0,holdStartedElapsedMs:null,rewardVerified:false,reason:scheduledAt?'Esperando la hora elegida':'Observando población; presencia individual por comprobar'};
    watchMonoStart=scheduledAt?null:monoNow();lastPersistElapsed=0;persist();event(scheduledAt?'observation_scheduled':'observation_started',{id:runtime.watch.id,server:runtime.watch.server});tickWatch();send(res,200,state());return;
   }
   if(route==='/api/watch/stop'){finishWatch('cancelled','Detenido por el usuario');send(res,200,state());return;}
   if(route==='/api/service/stop'){send(res,200,state());setImmediate(()=>close().catch(error=>console.error(error.message)));return;}
   send(res,404,{error:'Ruta desconocida'});return;
  }
  const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/mini':'mini.html','/mini.js':'mini.js','/mini.css':'mini.css','/attention.js':'attention.js','/attention.css':'attention.css','/account-import':'account-import.html','/account-import.js':'account-import.js','/farmdogs-ai-mark.png':'farmdogs-ai-mark.png','/rajdhani-bold.ttf':'rajdhani-bold.ttf','/OFL-Rajdhani.txt':'OFL-Rajdhani.txt'};
  if(req.method!=='GET'||!files[route]){send(res,404,{error:'No encontrado'});return;}
  const file=files[route],extension=path.extname(file),types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};res.writeHead(200,{'Content-Type':types[extension],'Cache-Control':'no-store'});fs.createReadStream(path.join(ROOT,'public',file)).pipe(res);
 }catch(error){send(res,400,{error:error.message});}
});
let resolveReady,rejectReady;
const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
server.on('error',error=>{clearInterval(refreshTimer);clearInterval(watchTimer);clearInterval(clickerTimer);rejectReady(error);});
function tickClicker(){try{teamClicker.tick();}catch(error){try{teamClicker.stop('Error del controlador de autoclic.');}catch{}event('team_clicker_error',{message:error.message});}}
async function tickEntry(){try{await entry.tick();}catch(error){try{entry.stop('Error local de la entrada automática.','error');}catch{}event('entry_error',{message:error.message});}}
const clickerTimer=setInterval(tickClicker,100);
const refreshTimer=setInterval(refreshServers,1000),watchTimer=setInterval(()=>{tickWatch();void tickEntry();automatic.tick();void clanPresence.tick().catch(error=>event('clan_presence_error',{message:error.message}));tickActivity().catch(error=>event('activity_error',{message:error.message}));opening.tick().catch(error=>event('opening_error',{message:error.message}));if(options.autoUpdate!==false)void updater.tick();},1000);
server.listen(PORT,'127.0.0.1',async()=>{PORT=server.address().port;atomicJson(configFile,config);persist();atomicJson(path.join(DATA,'service.json'),{pid:process.pid,port:PORT,url:`http://127.0.0.1:${PORT}`,startedAt:isoNow()});await refreshServers();resolveReady(`http://127.0.0.1:${PORT}`);});
function close(){if(closePromise)return closePromise;clanPresence.close();updater.close();entry.close();teamClicker.close();stopActivity('El servicio se cerró.');activity.close();automatic.close();opening.interrupt();if(runtime.watch&&(activeStates.has(runtime.watch.status)||runtime.watch.status==='scheduled'))finishWatch('interrupted','El observador se ha cerrado.');clearInterval(refreshTimer);clearInterval(watchTimer);clearInterval(clickerTimer);clearTimeout(updateShutdownTimer);closePromise=new Promise(resolve=>server.close(resolve));return closePromise;}
return {ready,close,tick:async()=>{tickClicker();tickWatch();await tickEntry();automatic.tick();await clanPresence.tick();await tickActivity();await opening.tick();if(options.autoUpdate!==false)await updater.tick();},refresh:refreshServers,state};
}
module.exports={createObserver};
if(require.main===module){const service=createObserver();service.ready.then(url=>console.log(`Observador disponible en ${url}`)).catch(error=>{console.error(error.message);process.exitCode=1;});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>service.close().then(()=>process.exit(0)));}
