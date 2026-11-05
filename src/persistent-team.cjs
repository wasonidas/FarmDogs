'use strict';
const {randomUUID}=require('node:crypto');
const {normalizeMousePause}=require('./mouse-pause.cjs');
const {sessionReasonCode}=require('./session-report.cjs');
const TEAMS=new Set(['blue','red','green']);
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/;
const utc=value=>typeof value==='string'&&ISO.test(value)?Date.parse(value):NaN;
const roundId=value=>Number.isSafeInteger(value)&&value>0;
const LATCHED=new Set(['paused_controller','paused_identity','paused_error']);
const clean=value=>String(value?.message||value||'Error local.').replace(/[\u0000-\u001f]/g,' ').slice(0,260);

function validatePersistentTeam(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||input.enabled!==true)throw Error('Indica si quieres activar el equipo entre partidas.');
 if(!Number.isInteger(input.server)||input.server<1||input.server>5||!UUID.test(input.expectedJoinId||''))throw Error('Elige un servidor y su ID reciente.');
 if(!TEAMS.has(input.team))throw Error('Elige azul, rojo o verde.');
 const value={server:input.server,expectedJoinId:input.expectedJoinId.toLowerCase(),team:input.team,intervalMs:input.intervalMs??20,threshold:input.threshold??95,attemptMinutes:input.attemptMinutes??5,selectionTimeoutMinutes:input.selectionTimeoutMinutes??120,startNow:input.startNow??true,mousePause:normalizeMousePause(input.mousePause)};
 if(!Number.isInteger(value.intervalMs)||value.intervalMs<20||value.intervalMs>2000)throw Error('El intervalo debe estar entre 20 y 2000 ms.');
 if(!Number.isInteger(value.threshold)||value.threshold<50||value.threshold>99)throw Error('El preaviso debe estar entre 50 y 99 puntos.');
 if(!Number.isInteger(value.attemptMinutes)||value.attemptMinutes<1||value.attemptMinutes>15)throw Error('La ventana para reconocer el selector debe estar entre 1 y 15 minutos.');
 if(!Number.isInteger(value.selectionTimeoutMinutes)||value.selectionTimeoutMinutes<1||value.selectionTimeoutMinutes>720||value.selectionTimeoutMinutes<value.attemptMinutes)throw Error('La espera de equipo debe estar entre la ventana de reconocimiento y 720 minutos.');
 if(typeof value.startNow!=='boolean')throw Error('Indica si quieres buscar el selector ahora.');
 return value;
}

// Public scores only wake an independently verified native selector. They never
// provide a point, an input permission, a deployment proof or an automatic join.
function createPersistentTeam({now=Date.now,monoNow=()=>performance.now(),teamClicker,getInputs=()=>({}),event=()=>{}}={}){
 if(!teamClicker||typeof teamClicker.prepareOwned!=='function')throw Error('Falta el selector de equipos.');
 let current=null,attempt=null,cleanupOwner=null,pending=null,closed=false,generation=0;
 let sample=null,seenSourceAt=-Infinity,consumedHigh=-1,lowRun=0,transitionConsumed=null,settleUntil=0;
 let nativeStopBaseline=null,inputStopBaseline=null,monitorSessionId=null,monitorPid=null,monitorReadyAt=null,everFresh=false,waitingForAck=false,quietRecovery=null;
 let historyInitialized=false,historySourceAt=-Infinity,lastSelectionAt=-Infinity,historyCurrent=null;
 const historyPending=new Map(),historyHandled=new Set(),selectedRounds=new Set();
 const emit=(kind,detail)=>{try{event(kind,detail);}catch{}};
 function input(){try{return getInputs(current?.server)||{};}catch(error){return {conflictReason:clean(error)};}}
 function native(){try{return teamClicker.view()||{};}catch{return {};}}
 function update(status,reason,extra={}){if(!current)return;const reasonCode=sessionReasonCode({status,reason,...extra}),changed=current.status!==status||current.reasonCode!==reasonCode;current={...current,status,reason,userPause:null,...extra,reasonCode};if(changed)emit('persistent_team_state',{id:current.id,server:current.server,status,reasonCode,hasAttempt:!!attempt,attemptCount:current.attemptCount});}
 function same(id,epoch){return !closed&&current?.enabled===true&&current.id===id&&generation===epoch;}
 function source(data,{identityOnly=false}={}){
  const row=data?.server,at=now(),stamp=Date.parse(row?.sourceAt),age=at-stamp;
  if(!row||row.number!==current.server||row.trusted!==true||row.online!==true||row.stale===true||!Number.isFinite(age)||age< -5000||age>90000)return {ok:false,reason:'Esperando datos públicos recientes del servidor.'};
  if(typeof row.joinId!=='string'||row.joinId.toLowerCase()!==current.expectedJoinId||!Number.isSafeInteger(row.apiId)||row.apiId<1||current.apiId!==null&&row.apiId!==current.apiId)return {ok:false,identityChanged:true,reason:'La identidad del servidor ha cambiado. Revisa el destino y activa de nuevo.'};
  if(identityOnly)return {ok:true,row,stamp};
  if(row.scoresTrusted!==true||!Array.isArray(row.factions)||row.factions.length!==3)return {ok:false,reason:'La web no ofrece un marcador válido y reciente.'};
  const names=new Set(),scores=[];
  for(const item of row.factions){if(!item||typeof item.name!=='string'||names.has(item.name.toLowerCase())||!Number.isSafeInteger(item.score)||item.score<0||item.score>1000000)return {ok:false,reason:'El marcador público no es válido.'};names.add(item.name.toLowerCase());scores.push(item.score);}
  return {ok:true,row,stamp,max:Math.max(...scores),map:typeof row.map==='string'?row.map:null,experience:typeof row.experience==='string'?row.experience:null};
 }
 function release(owner){if(!owner)return;try{teamClicker.releaseOwned(owner);}catch(error){emit('persistent_team_cleanup_error',{ownerId:owner,message:clean(error)});}}
 function ownBlocking(owner){const view=native();if(view.ownerId!==owner)return false;try{return teamClicker.blocking()===true;}catch{return true;}}
 function cleanAttempt(){if(current)current={...current,userPause:null};if(attempt){cleanupOwner=attempt.ownerId;release(cleanupOwner);attempt=null;}if(cleanupOwner&&!ownBlocking(cleanupOwner))cleanupOwner=null;}
 function stop(reason='Equipo entre partidas desactivado.'){generation++;pending=null;quietRecovery=null;cleanAttempt();if(current){current={...current,enabled:false,status:'disabled',reason:clean(reason),stoppedAt:new Date(now()).toISOString()};emit('persistent_team_stopped',{id:current.id,server:current.server,reason:current.reason});}return view();}
 function pause(status,reason,extra={}){quietRecovery=null;cleanAttempt();update(status,reason,extra);}
 function stoppedByOperator(data,report){
  const ownLatchedStop=monitorPid!==null&&report.controllerPid===monitorPid&&report.controllerReportSessionId===monitorSessionId&&report.controllerOperatorStoppedSessionId===monitorSessionId;
  return !!(ownLatchedStop||report.controllerFresh===true&&report.operatorStoppedSessionId&&report.operatorStoppedSessionId!==nativeStopBaseline||data.operatorStopId&&data.operatorStopId!==inputStopBaseline);
 }
 function controllerReady(report){
  if(report.controllerReportStatus==='unexpected_format'||everFresh&&report.controllerAlive===false||report.controllerFresh===true&&(report.controllerReportRead===false||report.controllerAlive===false))return false;
  if(monitorPid!==null&&report.controllerPid!==monitorPid)return false;
  if(report.controllerFresh===true&&(!monitorSessionId||report.controllerSessionId===monitorSessionId)){everFresh=true;waitingForAck=false;if(Number.isInteger(report.controllerPid)&&report.controllerPid>0)monitorPid=report.controllerPid;return true;}
  // A cold process gets no input until the native command is validated. After
  // its first fresh report, loss is terminal for this preference activation.
  const awaiting=monitorReadyAt!==null&&monoNow()-monitorReadyAt>=0&&monoNow()-monitorReadyAt<8000;
  return awaiting&&(!everFresh||waitingForAck&&report.controllerFresh===true);
 }
 function controllerDiagnostic(report,cause){return {id:current?.id,server:current?.server,cause,phase:current?.status,hasAttempt:!!attempt,expectedPid:monitorPid,expectedSessionId:monitorSessionId,controllerPid:report.controllerPid??null,controllerAlive:report.controllerAlive===true,controllerSessionId:report.controllerSessionId||null,controllerReportSessionId:report.controllerReportSessionId||null,controllerReportAt:report.controllerReportAt||null,controllerReportAgeMs:Number.isFinite(report.controllerReportAgeMs)?report.controllerReportAgeMs:null,controllerFresh:report.controllerFresh===true,controllerReportRead:report.controllerReportRead===true,controllerReportStatus:report.controllerReportStatus||null,controllerIdentitySource:report.controllerIdentitySource||null,controllerOperatorStoppedSessionId:report.controllerOperatorStoppedSessionId||null,monoMs:monoNow(),recoveryElapsedMs:quietRecovery?monoNow()-quietRecovery.startedMono:null};}
 function matchingQuietIdentity(report){return monitorPid!==null&&report.controllerPid===monitorPid&&report.controllerReportSessionId===monitorSessionId&&report.controllerAlive===true&&report.controllerReportStatus!=='unexpected_format';}
 function failController(report,cause){emit('persistent_team_controller_problem',controllerDiagnostic(report,cause));pause('paused_controller','No hay confirmación reciente del mismo controlador. Desactiva y vuelve a activar para reintentar.');return false;}
 function checkController(report){
  if(quietRecovery){
   if(!matchingQuietIdentity(report))return failController(report,'quiet_identity_lost');
   const elapsed=monoNow()-quietRecovery.startedMono,wallElapsed=now()-quietRecovery.startedUtc;
   if(!Number.isFinite(elapsed)||elapsed<0||wallElapsed<0||elapsed>=15000||wallElapsed>=15000)return failController(report,'quiet_wait_expired');
   const at=Date.parse(report.controllerReportAt);
   if(report.controllerFresh===true&&report.controllerReportRead===true&&report.controllerSessionId===monitorSessionId&&Number.isFinite(at)){
    if(at>quietRecovery.lastFreshAt){quietRecovery.freshReports++;quietRecovery.lastFreshAt=at;}
    if(quietRecovery.freshReports>=2){emit('persistent_team_controller_recovered',controllerDiagnostic(report,'two_new_reports'));quietRecovery=null;return controllerReady(report);}
   }else quietRecovery.freshReports=0;
   update('waiting_controller','Esperando dos lecturas nuevas del controlador, sin clics ni capturas.');return false;
  }
  if(controllerReady(report))return true;
  if(!attempt&&!pending&&everFresh&&!waitingForAck&&matchingQuietIdentity(report)){
   quietRecovery={startedMono:monoNow(),startedUtc:now(),startedAt:new Date(now()).toISOString(),freshReports:0,lastFreshAt:Date.parse(report.controllerReportAt)||-Infinity};
   emit('persistent_team_controller_wait',controllerDiagnostic(report,'quiet_report_gap'));update('waiting_controller','El controlador se ha retrasado. Se espera hasta 15 segundos sin activar el selector.');return false;
  }
  return failController(report,'controller_not_ready');
 }
 function consume(observation){
  if(observation.stamp<=seenSourceAt)return null;
  seenSourceAt=observation.stamp;current.lastSourceAt=new Date(observation.stamp).toISOString();
  const before=sample;sample={stamp:observation.stamp,max:observation.max,map:observation.map,experience:observation.experience};
  if(observation.max<current.threshold){lowRun++;if(lowRun>=2)consumedHigh=-1;}else lowRun=0;
  const changedMap=before&&before.map&&observation.map&&before.map!==observation.map;
  const reset=before&&before.max>=current.threshold&&observation.max<=20;
  const transition=changedMap||reset;
  // A real reset/map transition may follow an entry into the dying round.
  // Never suppress it with the short high-score settling period: the public
  // feed can lag, but missing the next selector would defeat this mode.
  if(transition){const key=[before.stamp,observation.stamp,observation.map,observation.experience].join(':');if(key!==transitionConsumed){transitionConsumed=key;return {kind:changedMap?'map_changed':'score_reset',key};}}
  if(observation.max>=current.threshold&&observation.max>consumedHigh&&now()>=settleUntil)return {kind:'high_score',key:String(observation.max),score:observation.max};
  return null;
 }
 function matchFact(data){
  const fact=data?.matchRound,at=now(),stamp=utc(fact?.sourceAt),observed=utc(fact?.observedAt),fresh=(value,limit=90000)=>Number.isFinite(value)&&at-value>=-5000&&at-value<=limit;
  if(!fact||fact.ok!==true||!['ready','baseline'].includes(fact.status)||fact.baselineReady!==true||fact.server!==current.server||fact.apiId!==current.apiId||typeof fact.joinId!=='string'||fact.joinId.toLowerCase()!==current.expectedJoinId||!fresh(stamp)||!fresh(observed)||stamp<historySourceAt)return null;
  const live=fact.current,done=fact.lastCompleted;
  if(live&&(!roundId(live.id)||!Number.isFinite(utc(live.startedAt))||!fresh(utc(live.observedAt),120000)||utc(live.startedAt)>utc(live.observedAt)))return null;
  if(done&&(!roundId(done.id)||!Number.isFinite(utc(done.startedAt))||!Number.isFinite(utc(done.endedAt))||utc(done.startedAt)>utc(done.endedAt)||utc(done.endedAt)>stamp+5000))return null;
  let wake=null;
  if(fact.wake){
   const value=fact.wake,kind=value.kind,key=`${current.apiId}:${value.roundId}:${kind}`,eventSource=utc(value.sourceAt),eventObserved=utc(value.observedAt),began=utc(value.startedAt),ended=utc(value.endedAt);
   const validKind=kind==='completed'||kind==='new_round',transitionAt=kind==='completed'?ended:began;
   const rowMatches=kind==='completed'?done?.id===value.roundId&&utc(done.startedAt)===began&&utc(done.endedAt)===ended:live?.id===value.roundId&&utc(live.startedAt)===began;
   if(validKind&&roundId(value.roundId)&&value.eventId===key&&fresh(eventSource)&&fresh(eventObserved)&&eventSource<=stamp&&fresh(transitionAt,120000)&&Number.isFinite(began)&&began<=transitionAt&&rowMatches&&(value.nextRoundId===null||value.nextRoundId===undefined||roundId(value.nextRoundId))&&(value.previousRoundId===null||value.previousRoundId===undefined||roundId(value.previousRoundId))){
    wake={key,kind,roundId:value.roundId,sourceAt:value.sourceAt,observedAt:value.observedAt,startedAt:value.startedAt,endedAt:kind==='completed'?value.endedAt:null,transitionAt,nextRoundId:roundId(value.nextRoundId)?value.nextRoundId:null,previousRoundId:roundId(value.previousRoundId)?value.previousRoundId:null};
   }
  }
  return {stamp,sourceAt:fact.sourceAt,current:live?{id:live.id,startedAt:live.startedAt}:null,lastCompleted:done?{id:done.id,startedAt:done.startedAt,endedAt:done.endedAt}:null,wake};
 }
 function handledHistory(key){historyHandled.add(key);while(historyHandled.size>64)historyHandled.delete(historyHandled.values().next().value);historyPending.delete(key);}
 function obsoleteHistory(wake){
  if(wake.transitionAt<=utc(current.startedAt)||wake.transitionAt<=lastSelectionAt)return true;
  if(wake.kind==='new_round'&&selectedRounds.has(wake.roundId))return true;
  return wake.kind==='completed'&&wake.nextRoundId!==null&&selectedRounds.has(wake.nextRoundId);
 }
 function collectHistory(fact){
  if(!fact)return;
  historySourceAt=fact.stamp;historyCurrent=fact.current;current.lastHistorySourceAt=fact.sourceAt;
  if(!historyInitialized){historyInitialized=true;if(fact.wake)handledHistory(fact.wake.key);return;}
  const wake=fact.wake;
  if(!wake)return;
  // The adapter can enrich completed R with its following live ID without
  // changing the event key or extending the original event TTL.
  if(attempt?.historyWake?.key===wake.key)attempt.historyWake={...wake};
  if(historyHandled.has(wake.key))return;
  if(obsoleteHistory(wake)){handledHistory(wake.key);return;}
  historyPending.set(wake.key,wake);while(historyPending.size>8)handledHistory(historyPending.keys().next().value);
 }
 function nextHistory(fact){
  if(!fact)return null;
  let choice=null;
  for(const wake of historyPending.values()){
   const age=now()-utc(wake.sourceAt),seenAge=now()-utc(wake.observedAt);
   if(age< -5000||age>90000||seenAge< -5000||seenAge>90000||obsoleteHistory(wake)){handledHistory(wake.key);continue;}
   if(!choice||wake.transitionAt>choice.transitionAt)choice=wake;
  }
  return choice?{kind:choice.kind==='completed'?'round_completed':'round_changed',key:choice.key,historyWake:choice}:null;
 }
 function selectedHistory(owned,confirmation,fact){
  const captured=utc(confirmation.capturedAt),selected=Number.isFinite(captured)&&captured>=owned.startedUtc-1000&&captured<=now()+1000?captured:now();
  lastSelectionAt=Math.max(lastSelectionAt,selected);current.selectionConfirmedAt=new Date(selected).toISOString();
  const remember=id=>{if(roundId(id))selectedRounds.add(id);while(selectedRounds.size>32)selectedRounds.delete(selectedRounds.values().next().value);};
  if(fact?.current&&utc(fact.current.startedAt)<=selected)remember(fact.current.id);
  if(owned.historyWake?.kind==='new_round')remember(owned.historyWake.roundId);
  if(owned.historyWake?.nextRoundId)remember(owned.historyWake.nextRoundId);
  // Keep later transitions queued. In particular a delayed JS confirmation
  // must use its actual capture time, not erase an ending that followed it.
  for(const wake of historyPending.values())if(obsoleteHistory(wake))handledHistory(wake.key);
 }
 async function begin(trigger){
  if(!current?.enabled||pending||attempt||cleanupOwner||LATCHED.has(current.status))return;
  const id=current.id,epoch=generation,ownerId=randomUUID(),began=now(),mono=monoNow();
  if(trigger.kind==='high_score')consumedHigh=Math.max(consumedHigh,trigger.score);
  if(trigger.historyWake)handledHistory(trigger.historyWake.key);
  const owned={ownerId,sessionId:null,startedUtc:began,startedMono:mono,acquireMs:current.attemptMinutes*60000,selectionMs:current.selectionTimeoutMinutes*60000,acquired:false,historyWake:trigger.historyWake?{...trigger.historyWake}:null,acquisitionEndsAt:new Date(began+current.attemptMinutes*60000).toISOString(),selectionEndsAt:new Date(began+current.selectionTimeoutMinutes*60000).toISOString()};
  attempt=owned;current.attemptCount++;current.lastTrigger=trigger.kind;current.lastTriggerAt=new Date(began).toISOString();update('preparing','Preparando un intento nuevo de equipo.');
  const job={id,epoch,ownerId};pending=job;
  const canArm=()=>{if(!same(id,epoch)||attempt!==owned)return false;const data=input(),report=native(),identity=source(data,{identityOnly:true});return !data.conflictReason&&identity.ok&&!stoppedByOperator(data,report)&&(!everFresh||report.controllerFresh===true&&(monitorPid===null||report.controllerPid===monitorPid));};
  try{
   const ready=await teamClicker.prepareOwned({ownerId,team:current.team,intervalMs:current.intervalMs,mousePause:current.mousePause,endAt:owned.selectionEndsAt,canArm});
   if(!same(id,epoch)||attempt!==owned){release(ownerId);return;}
   if(ready?.enabled!==true||ready.ownerId!==ownerId||!UUID.test(ready.sessionId||'')){pause('paused_error','El selector no confirmó la preparación. Desactiva y vuelve a activar para reintentar.');return;}
   owned.sessionId=ready.sessionId;monitorSessionId=ready.sessionId;monitorReadyAt=monoNow();waitingForAck=true;update('waiting_selector','Esperando el selector. El verde apagado no detendrá los clics al reconocerlo.');
  }catch(error){if(same(id,epoch))pause('paused_error','No se pudo preparar el selector: '+clean(error));}
  finally{if(pending===job)pending=null;}
 }
 async function configure(request){
  if(request?.enabled===false)return stop();
  if(closed)throw Error('El servicio se está cerrando.');
  const settings=validatePersistentTeam(request);
  if(current?.enabled||cleanupOwner||pending||teamClicker.blocking())throw Error('Desactiva la selección anterior y espera a que se detenga.');
  current={id:randomUUID(),enabled:true,...settings,apiId:null,status:'preparing',reason:'Preparando el equipo entre partidas.',startedAt:new Date(now()).toISOString(),attemptCount:0,lastSourceAt:null,lastTrigger:null};generation++;
  sample=null;seenSourceAt=-Infinity;consumedHigh=-1;lowRun=0;transitionConsumed=null;settleUntil=0;everFresh=false;waitingForAck=false;quietRecovery=null;monitorReadyAt=null;monitorSessionId=null;monitorPid=null;historyInitialized=false;historySourceAt=-Infinity;historyCurrent=null;lastSelectionAt=-Infinity;historyPending.clear();historyHandled.clear();selectedRounds.clear();
  const data=input(),report=native();nativeStopBaseline=report.operatorStoppedSessionId||null;inputStopBaseline=data.operatorStopId||null;
  const identity=source(data,{identityOnly:true});
  if(data.conflictReason||!identity.ok){const reason=data.conflictReason||identity.reason;stop(reason);throw Error(reason);}
  current.apiId=identity.row.apiId;
  collectHistory(matchFact(data));
  // The first fresh public marker is a baseline, not evidence that a round
  // finished. Manual activation may independently request today's selector.
  const initial=source(data);if(initial.ok){consume(initial);if(initial.max>=current.threshold)consumedHigh=initial.max;}
  try{
   if(settings.startNow)await begin({kind:'manual_start',key:'initial'});
   else{
    if(typeof teamClicker.prepareStopMonitor!=='function')throw Error('Actualiza el controlador para vigilar F8 entre partidas.');
    const id=current.id,epoch=generation,job={id,epoch,kind:'stop-monitor'};pending=job;
    try{
     await teamClicker.prepareStopMonitor({canContinue:()=>{if(!same(id,epoch))return false;const data=input(),report=native();return !data.conflictReason&&source(data,{identityOnly:true}).ok&&!stoppedByOperator(data,report);}});
     if(!same(id,epoch))return view();
     const data=input(),report=native(),identity=source(data,{identityOnly:true});
     if(stoppedByOperator(data,report)){stop('Detenido con F8 durante la preparación.');return view();}
     if(data.conflictReason||!identity.ok){pause(identity.identityChanged?'paused_identity':'paused_error',data.conflictReason||identity.reason);return view();}
     monitorSessionId=report.sessionId;monitorReadyAt=monoNow();waitingForAck=true;update('watching','Preparado entre partidas. Sin capturas mientras el marcador siga lejos del final.');
    }finally{if(pending===job)pending=null;}
   }
  }catch(error){stop(clean(error));throw error;}
  emit('persistent_team_started',{id:current.id,server:current.server,team:current.team});return view();
 }
 async function tick(){
  if(closed)return;
  if(cleanupOwner){release(cleanupOwner);if(!ownBlocking(cleanupOwner))cleanupOwner=null;}
  if(!current?.enabled||pending)return;
  try{
   const data=input(),report=native();
   if(stoppedByOperator(data,report)){stop('Detenido con F8. El equipo entre partidas queda desactivado.');return;}
   if(LATCHED.has(current.status))return;
   if(data.conflictReason){pause('paused_error',clean(data.conflictReason),{reasonCode:'task_conflict'});return;}
   if(!checkController(report))return;
   const identity=source(data,{identityOnly:true});
   if(!identity.ok){if(identity.identityChanged){pause('paused_identity',identity.reason);return;}if(attempt)cleanAttempt();update('waiting_source',identity.reason);return;}
   const fact=matchFact(data);collectHistory(fact);
   const observation=source(data),scoreTrigger=observation.ok?consume(observation):null;
   if(!observation.ok&&!fact){if(attempt)cleanAttempt();update('waiting_source',observation.reason);return;}
   if(attempt){
    const owned=attempt,elapsed=monoNow()-owned.startedMono;
    if(!Number.isFinite(elapsed)||elapsed<0||elapsed>=owned.selectionMs||now()>=Date.parse(owned.selectionEndsAt)){cleanAttempt();update('watching','Terminó el plazo de este intento. Se espera una transición pública nueva.');return;}
    if(report.ownerId!==owned.ownerId||report.sessionId!==owned.sessionId){pause('paused_error','La selección de equipo cambió de propietario. Activa de nuevo el modo cuando termine.');return;}
    const confirmation=report.entryConfirmation;
    if(confirmation?.status==='confirmed'&&confirmation.ownerId===owned.ownerId&&confirmation.sessionId===owned.sessionId&&confirmation.actualTeam===current.team){
     selectedHistory(owned,confirmation,fact);
     cleanAttempt();settleUntil=now()+90000;if(sample?.max>=current.threshold)consumedHigh=Math.max(consumedHigh,sample.max);update('watching','Equipo seleccionado. Los clics están apagados; el modo sigue preparado para la próxima partida.',{lastConfirmedAt:new Date(now()).toISOString()});emit('persistent_team_entry_confirmed',{id:current.id,server:current.server,team:current.team});return;
    }
    if(report.userPause?.active===true){teamClicker.renewOwned(owned.ownerId);update('selecting','Pausado mientras usas el ratón.',{userPause:report.userPause});return;}
    if(report.enabled!==true){pause('paused_error',report.reason||'El intento se detuvo. Desactiva y vuelve a activar para reintentar.');return;}
    if(report.active===true||report.running===true||Number.isInteger(report.count)&&report.count>0)owned.acquired=true;
    if(!owned.acquired&&(elapsed>=owned.acquireMs||now()>=Date.parse(owned.acquisitionEndsAt))){cleanAttempt();update('watching','No apareció un selector dentro de la ventana. Se espera otra señal pública, sin capturas.');return;}
    teamClicker.renewOwned(owned.ownerId);update(owned.acquired?'selecting':'waiting_selector',owned.acquired?'Intentando entrar al equipo elegido hasta confirmar DESPLEGANDO.':'Esperando el selector durante esta ventana.',{userPause:null});return;
   }
   if(cleanupOwner){update('waiting_cleanup','Esperando el acuse de parada del selector anterior.');return;}
   const trigger=nextHistory(fact)||scoreTrigger;
   if(trigger){await begin(trigger);return;}
   update('watching','Preparado entre partidas. Sin capturas mientras se espera una señal pública nueva.');
  }catch(error){pause('paused_error','Error del equipo entre partidas: '+clean(error));}
 }
 function view(){return current?{...current,userPause:attempt?current.userPause:null,ownerId:attempt?.ownerId||cleanupOwner||null,sessionId:attempt?.sessionId||null,acquisitionEndsAt:attempt?.acquisitionEndsAt||null,selectionEndsAt:attempt?.selectionEndsAt||null,selectorAcquired:attempt?.acquired===true,cleanupPending:!!cleanupOwner||!!pending,historyBaselineReady:historyInitialized,historyPendingCount:historyPending.size,historyCurrentRoundId:historyCurrent?.id||null,monitorSessionId,monitorPid,controllerRecovery:quietRecovery?{startedAt:quietRecovery.startedAt,deadlineAt:new Date(quietRecovery.startedUtc+15000).toISOString(),freshReports:quietRecovery.freshReports}:null}: {enabled:false,status:'disabled',reason:'Equipo entre partidas desactivado.',team:'green',threshold:95,attemptMinutes:5,selectionTimeoutMinutes:120,attemptCount:0,cleanupPending:false};}
 function blocking(){return current?.enabled===true||!!cleanupOwner||!!pending;}
 function close(){if(closed)return;stop('La app se cerró. Activa de nuevo el equipo entre partidas al volver.');closed=true;}
 return {configure,stop,tick,view,blocking,close};
}
module.exports={createPersistentTeam,validatePersistentTeam};
