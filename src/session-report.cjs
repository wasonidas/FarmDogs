'use strict';

// A diagnostic export is a new document, never a redacted copy of /api/state.
// No filesystem, account, image, process, free-text or credential field is copied.
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const id=value=>typeof value==='string'&&UUID.test(value)?value.toLowerCase():null;
const record=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const oneOf=(value,values,fallback=null)=>values.includes(value)?value:fallback;
const server=value=>Number.isInteger(value)&&value>=1&&value<=5?value:null;
const instant=value=>{
 if(typeof value!=='string'&&typeof value!=='number')return null;
 const ms=typeof value==='number'?value:Date.parse(value);
 return Number.isFinite(ms)&&Math.abs(ms)<=8640000000000000?new Date(ms).toISOString():null;
};
const integer=(value,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=min&&value<=max?value:null;
const STATES=['opening','waiting_game','navigating','joining','choosing_team','deploying','starting_seeding','recovering_source','completed','cancelled','expired','error','interrupted','waiting','waiting_controller','waiting_source','waiting_presence','waiting_match','moving','starting_movement','watching','preparing','waiting_selector','selecting','waiting_cleanup','paused_controller','paused_identity','paused_error','paused_mouse','disabled','stopped','running','unknown'];
const PHASES=['entry','team','deployment','movement','recovery','source','controller','presence','waiting','finished','unknown'];
const REASONS=['none','unknown','operator_stop','deadline_reached','service_closed','service_restarted','entry_completed','team_confirmed','movement_handoff','movement_active','user_mouse_activity','waiting_game','hud_unrecognized','evidence_expired','game_identity_changed','ownership_changed','entry_binding_invalid','server_identity_changed','server_restart','afk_kick','server_message_unknown','controller_unavailable','controller_error','controller_report_gap','controller_wait_expired','controller_identity_lost','controller_not_ready','controller_recovered','source_unavailable','presence_unconfirmed','match_waiting','selector_waiting','cleanup_pending','task_conflict','cleanup_failed','local_error','native_watcher_owner_mismatch','native_report_read_failure','native_report_identity_invalid','native_watch_unhealthy'];
const WATCH_CODES=['watcher_owner_mismatch','report_read_failure','report_identity_invalid','operator_stop','watch_unhealthy'];
const EVENT_KINDS=new Set(['entry_flow_started','entry_flow_state','entry_flow_finished','entry_flow_cleanup_error','entry_flow_recovery_started','entry_flow_team_prepared','entry_flow_team_confirmed','entry_flow_movement_handoff','game_entry_started','game_entry_state','game_entry_watch_diagnostic','auto_seeding_started','auto_seeding_state','auto_seeding_stopped','auto_seeding_error','persistent_team_started','persistent_team_state','persistent_team_stopped','persistent_team_error','persistent_team_entry_confirmed','persistent_team_cleanup_error','persistent_team_controller_problem','persistent_team_controller_wait','persistent_team_controller_recovered','team_clicker_prepared','team_clicker_stopped','team_clicker_error','team_clicker_entry_observed','team_clicker_entry_confirmed']);
const SCENES=['unknown','gameplay_hud','team_selector','deploying','main_menu','join_confirmation','join_wrong_server','afk_kick','server_restart','server_message_unknown'];
const TERMINAL=new Set(['completed','cancelled','expired','error','interrupted','disabled','stopped']);

function sessionPhase(value={}){
 const input=typeof value==='string'?{status:value}:record(value);
 if(PHASES.includes(input.phase))return input.phase;
 const status=input.status||input.phase;
 if(status==='recovering_source')return 'recovery';
 if(['choosing_team','waiting_selector','selecting','team_selector'].includes(status))return 'team';
 if(['deploying','gameplay_hud'].includes(status))return 'deployment';
 if(['moving','starting_movement','starting_seeding','running'].includes(status))return 'movement';
 if(['opening','navigating','joining'].includes(status))return 'entry';
 if(['waiting_controller','paused_controller'].includes(status))return 'controller';
 if(status==='waiting_source')return 'source';
 if(status==='waiting_presence')return 'presence';
 if(status==='paused_mouse')return 'waiting';
 if(['waiting_game','waiting','waiting_match','watching','preparing','waiting_cleanup'].includes(status))return 'waiting';
 return TERMINAL.has(status)?'finished':'unknown';
}

// Older records have only a human-facing reason. It may help choose a fixed
// code, but the text itself is never returned. Structured causes take priority.
function sessionReasonCode(value={}){
 const input=record(value),native=record(input.nativeDiagnostic||input.watchDiagnostic||input.diagnostic);
 if(REASONS.includes(input.reasonCode))return input.reasonCode;
 if(WATCH_CODES.includes(native.code))return native.code==='operator_stop'?'operator_stop':'native_'+native.code;
 const causes={quiet_report_gap:'controller_report_gap',quiet_wait_expired:'controller_wait_expired',quiet_identity_lost:'controller_identity_lost',controller_not_ready:'controller_not_ready',two_new_reports:'controller_recovered'};
 if(Object.hasOwn(causes,input.cause))return causes[input.cause];
 if(input.kind==='entry_flow_cleanup_error'||input.kind==='persistent_team_cleanup_error')return 'cleanup_failed';
 if(input.kind==='entry_flow_team_confirmed'||input.kind==='persistent_team_entry_confirmed'||input.kind==='team_clicker_entry_confirmed')return 'team_confirmed';
 if(input.kind==='entry_flow_movement_handoff')return 'movement_handoff';
 if(input.kind==='entry_flow_recovery_started')return 'server_restart';
 const reason=typeof input.reason==='string'?input.reason.slice(0,1000).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase():'';
 if(input.status==='expired')return 'deadline_reached';
 if(/app se reinicio|observador se reinicio|servicio.*reinici/.test(reason))return 'service_restarted';
 if(/app se cerro|servicio (local )?se cerro|observador se ha cerrado/.test(reason))return 'service_closed';
 if(input.status==='cancelled'||/detenido con f8|detenid[oa].*usuario/.test(reason))return 'operator_stop';
 if(input.disconnect?.cause==='server_restart'&&input.disconnect.confirmed===true)return 'server_restart';
 if(/otra sesion|otro propietario|cambio de propietario|sesion anterior (cambio|fue sustituida)|pertenece a otra/.test(reason))return 'ownership_changed';
 if(/ventana.*cambio|comprobacion de servidor y ventana/.test(reason))return 'game_identity_changed';
 if(/prueba de despliegue caduco|captura.*caduc|hud.*caduc/.test(reason))return 'evidence_expired';
 if(/id del servidor cambio|identidad del servidor.*camb/.test(reason))return 'server_identity_changed';
 if(/no se reconoce el hud/.test(reason))return 'hud_unrecognized';
 if(/monitor.*(f8|parada)|parada.*f8/.test(reason)&&input.status==='error')return 'native_watch_unhealthy';
 if(/(controlador|seleccion de equipo).*(no quedo|no se pudo|error)|revisa el controlador/.test(reason)&&input.status==='error')return 'controller_error';
 if(input.status==='paused_mouse')return 'user_mouse_activity';
 const byStatus={completed:'entry_completed',moving:'movement_active',starting_movement:'movement_handoff',waiting_game:'waiting_game',waiting_controller:'controller_unavailable',paused_controller:'controller_not_ready',waiting_source:'source_unavailable',waiting_presence:'presence_unconfirmed',waiting_match:'match_waiting',waiting_selector:'selector_waiting',waiting_cleanup:'cleanup_pending',paused_identity:'server_identity_changed',error:'local_error',paused_error:'local_error'};
 return Object.hasOwn(byStatus,input.status)?byStatus[input.status]:typeof input.kind==='string'&&input.kind.endsWith('_error')?'local_error':'none';
}

function freshness(at,now,maxAge){
 const stamp=instant(at);if(stamp===null||now===null)return 'unknown';
 const age=Date.parse(now)-Date.parse(stamp);return age<0?'future':age<=maxAge?'fresh':'stale';
}
function nativeDiagnostic(value){
 const input=record(value);if(!WATCH_CODES.includes(input.code))return null;
 const output={code:input.code,at:instant(input.at),reportAt:instant(input.reportAt),reportAgeMilliseconds:integer(input.reportAgeMilliseconds,-86400000,86400000),lastStatus:oneOf(input.lastStatus,['watching','cancelled','closed','other']),lastReason:oneOf(input.lastReason,['operator_stop','watch_stopped','service_closed','deadline_reached','other']),childExitCode:integer(input.childExitCode,-2147483648,2147483647),childExitSignal:oneOf(input.childExitSignal,['SIGHUP','SIGINT','SIGQUIT','SIGABRT','SIGKILL','SIGTERM','SIGBREAK']),readError:oneOf(input.readError,['ENOENT','EACCES','EPERM','EISDIR','ELOOP','EINVAL','EIO','ENOTDIR','invalid_report'])};
 for(const key of ['startup','failure','reportObserved','reportFromCurrentRead','schemaMatches','reportOwnerMatches','reportServiceMatches','watcherOwnerMatches','childExited','childKilled','stopRequested'])output[key]=typeof input[key]==='boolean'?input[key]:null;
 return output;
}
function screenEvidence(value,proof,now){
 const screen=record(value),binding=record(proof),shaped=screen.status==='verified_capture'&&id(screen.frameId)!==null&&integer(screen.gamePid,1)!==null&&integer(screen.gameWindow,1)!==null;
 const same=integer(binding.gamePid,1)!==null&&integer(binding.gameWindow,1)!==null?screen.gamePid===binding.gamePid&&screen.gameWindow===binding.gameWindow:null;
 return {capturedAt:instant(screen.capturedAt),freshness:freshness(screen.capturedAt,now,5000),scene:shaped?oneOf(screen.scene,SCENES,'unknown'):'unknown',foreground:shaped&&screen.gameForeground===true,boundToEntry:same,recentBoundCapture:shaped&&screen.gameForeground===true&&same===true&&freshness(screen.capturedAt,now,5000)==='fresh'};
}

function buildSessionReport({at,state={},events,sessionId=null}={}){
 const now=instant(at),snapshot=record(state),entry=record(snapshot.entry),motion=record(snapshot.autoSeeding),team=record(snapshot.teamClicker),persistent=record(snapshot.persistentTeam),inputEvents=Array.isArray(events)?events:Array.isArray(snapshot.events)?snapshot.events:[];
 const sessions=[],graph=new Map(),known=new Set(),rawEvents=[],rootHints=new Map(),addId=value=>{const valid=id(value);if(valid){known.add(valid);if(!graph.has(valid))graph.set(valid,new Set());}return valid;};
 const link=(a,b)=>{a=addId(a);b=addId(b);if(a&&b&&a!==b){graph.get(a).add(b);graph.get(b).add(a);}};
 const entryId=addId(entry.id),motionId=addId(motion.id),persistentId=addId(persistent.id),teamId=addId(team.sessionId);
 const rootId=id(entry.rootEntryId)||entryId,previousId=id(entry.recovery?.previousEntryId);
 const motionEntry=id(motion.entryId),proofEntry=id(motion.entryProof?.entryId),motionBound=motionEntry!==null&&motionEntry===proofEntry;
 const entryMotionMatched=entryId!==null&&motionId!==null&&id(entry.movementSessionId)===motionId&&motionBound&&motionEntry===entryId;
 const entryTeamMatched=entryId!==null&&teamId!==null&&id(entry.teamSessionId)===teamId&&id(team.ownerId)===entryId;
 const persistentTeamMatched=persistentId!==null&&teamId!==null&&id(persistent.sessionId)===teamId&&id(persistent.ownerId)!==null&&id(team.ownerId)===id(persistent.ownerId);
 if(entryId){rootHints.set(entryId,rootId);link(entryId,rootId);if(previousId&&id(entry.recovery?.rootEntryId)===rootId){link(entryId,previousId);link(previousId,id(entry.recovery?.seedingId));}}
 if(motionBound&&motionId)link(motionId,motionEntry);
 if(entryMotionMatched)link(entryId,motionId);
 if(entryTeamMatched)link(entryId,teamId);
 if(persistentTeamMatched)link(persistentId,teamId);
 if(persistentId)rootHints.set(persistentId,persistentId);
 if(motionBound&&motionId)rootHints.set(motionId,motionEntry===entryId?rootId:motionEntry);
 const summary=(value,mode,sid,parent=null,root=null)=>({sessionId:sid,rootSessionId:root||sid,parentSessionId:parent,mode,status:oneOf(value.status,STATES,'unknown'),phase:sessionPhase(value),reasonCode:sessionReasonCode(value),server:server(value.server),createdAt:instant(value.createdAt||value.startedAt),endAt:instant(value.endAt),finishedAt:instant(value.finishedAt||value.stoppedAt),operatorStopped:value.operatorStopped===true,cleanupPending:value.cleanupPending===true});
 if(entryId)sessions.push({...summary(entry,'entry',entryId,previousId,rootId),ownership:{team:entryTeamMatched?'matched':id(entry.teamSessionId)&&teamId?'mismatch':'unknown',movement:entryMotionMatched?'matched':id(entry.movementSessionId)&&motionId?'mismatch':'unknown'},evidence:{deploymentAt:instant(entry.deployedAt),deploymentFreshness:freshness(entry.deployedAt,now,5000),entryChainObserved:entry.connectionSource==='verified_entry_ui_chain'&&instant(entry.deployedAt)!==null,recentDeploymentEvidence:entry.connected===true&&entry.connectionSource==='verified_entry_ui_chain'&&integer(entry.gamePid,1)!==null&&integer(entry.gameWindow,1)!==null&&freshness(entry.deployedAt,now,5000)==='fresh'},native:nativeDiagnostic(entry.nativeDiagnostic)});
 if(motionId)sessions.push({...summary(motion,motion.purpose==='break'?'break':'seeding',motionId,motionBound?motionEntry:null,motionBound?(motionEntry===entryId?rootId:motionEntry):null),reasonCode:motionEntry!==proofEntry&&(motionEntry||proofEntry)?'entry_binding_invalid':sessionReasonCode(motion),ownership:{entry:motionBound?'matched':motionEntry||proofEntry?'mismatch':'unknown',controller:id(snapshot.movement?.autoSessionId)===motionId&&snapshot.movement?.available===true?'matched':id(snapshot.movement?.autoSessionId)&&snapshot.movement?.available===true?'mismatch':'unknown'},evidence:screenEvidence(motion.screen,motionBound?motion.entryProof:null,now)});
 if(persistentId)sessions.push({...summary(persistent,'persistent-team',persistentId),ownership:{team:persistentTeamMatched?'matched':id(persistent.sessionId)&&teamId?'mismatch':'unknown'},evidence:{lastSourceAt:instant(persistent.lastSourceAt),sourceFreshness:freshness(persistent.lastSourceAt,now,90000),historyBaselineReady:persistent.historyBaselineReady===true,attemptCount:integer(persistent.attemptCount,0,1000000)}});
 if(teamId){const parent=entryTeamMatched?entryId:persistentTeamMatched?persistentId:null,status=team.error?'error':team.running===true?'running':team.enabled===true?'waiting_selector':'disabled',reportFreshness=freshness(team.controllerReportAt,now,3500),confirmation=record(team.entryConfirmation),confirmationFreshness=freshness(confirmation.capturedAt,now,5000),confirmationBound=confirmation.status==='confirmed'&&id(confirmation.sessionId)===teamId&&id(confirmation.ownerId)===id(team.ownerId)&&id(confirmation.frameId)!==null&&integer(confirmation.gamePid,1)!==null&&integer(confirmation.gameWindow,1)!==null;sessions.push({...summary({...team,status},'team',teamId,parent,parent===entryId?rootId:parent),reasonCode:team.controllerFresh===false||reportFreshness==='stale'||reportFreshness==='future'?'controller_unavailable':sessionReasonCode({...team,status}),ownership:{owner:parent?'matched':id(team.ownerId)?'unmatched':'standalone'},evidence:{controllerFresh:team.controllerFresh===true&&reportFreshness==='fresh',reportAt:instant(team.controllerReportAt),reportFreshness,controllerAlive:typeof team.controllerAlive==='boolean'?team.controllerAlive:null,reportStatus:oneOf(team.controllerReportStatus,['read','unavailable','unexpected_format']),confirmation:confirmationBound&&confirmationFreshness==='fresh'?'recent_bound':confirmationBound&&confirmationFreshness==='stale'?'historical_bound':'unconfirmed',confirmationFreshness}});}

 let ignoredEvents=0;
 for(const raw of inputEvents.slice(-1000)){
  const value=record(raw);if(!EVENT_KINDS.has(value.kind)){ignoredEvents++;continue;}
  const eventAt=instant(value.at);if(eventAt===null||now!==null&&Date.parse(eventAt)>Date.parse(now)){ignoredEvents++;continue;}
  const sid=id(value.id)||id(value.sessionId);if(!sid){ignoredEvents++;continue;}
  addId(sid);
  const eid=id(value.entryId),root=id(value.rootEntryId),previous=id(value.previousEntryId),teamSession=id(value.teamSessionId),movementSession=id(value.movementSessionId),owner=id(value.ownerId);
  // Only explicit, mode-specific ownership edges correlate records. A shared
  // server, process, timestamp or selected team never joins unrelated sessions.
  if(value.kind.startsWith('entry_flow_')){
   if(root){link(sid,root);rootHints.set(sid,root);}
   if(value.kind==='entry_flow_recovery_started'){link(sid,previous);link(previous,movementSession);}
   if((!owner||owner===sid)&&['entry_flow_team_prepared','entry_flow_team_confirmed'].includes(value.kind))link(sid,teamSession);
   if(value.kind==='entry_flow_movement_handoff')link(sid,movementSession);
  }else if(value.kind.startsWith('auto_seeding_')&&eid)link(sid,eid);
  const native=nativeDiagnostic(value.diagnostic||value.nativeDiagnostic),teamOwnerMismatch=owner!==null&&owner!==sid&&['entry_flow_team_prepared','entry_flow_team_confirmed'].includes(value.kind);
  rawEvents.push({at:eventAt,kind:value.kind,sessionId:sid,rootSessionId:root,entryId:eid,previousEntryId:previous,teamSessionId:teamOwnerMismatch?null:teamSession,movementSessionId:movementSession,phase:sessionPhase(value),status:oneOf(value.status,STATES),reasonCode:teamOwnerMismatch?'ownership_changed':sessionReasonCode(value),server:server(value.server),...(native?{native}:{}),...(value.kind.startsWith('persistent_team_controller_')?{controller:{fresh:value.controllerFresh===true,alive:typeof value.controllerAlive==='boolean'?value.controllerAlive:null,reportRead:value.controllerReportRead===true,reportAt:instant(value.controllerReportAt),reportStatus:oneOf(value.controllerReportStatus,['read','unavailable','unexpected_format']),identitySource:oneOf(value.controllerIdentitySource,['report','cached','none'])}}:{})});
 }
 const family=sid=>{const result=new Set(),pending=[sid];while(pending.length){const next=pending.pop();if(result.has(next))continue;result.add(next);for(const linked of graph.get(next)||[])pending.push(linked);}return result;};
 const resolvedRoots=new Map();
 for(const sid of known){if(resolvedRoots.has(sid))continue;const component=family(sid),roots=new Set([...component].map(value=>rootHints.get(value)).filter(Boolean)),root=roots.size===1?[...roots][0]:null;for(const linked of component)resolvedRoots.set(linked,root);}
 const requested=id(sessionId),invalidSelection=sessionId!==null&&requested===null,selected=new Set();
 if(requested&&!invalidSelection&&known.has(requested))for(const sid of family(requested))selected.add(sid);
 else if(sessionId===null)for(const sid of known)selected.add(sid);
 const retainedSessions=sessions.filter(item=>selected.has(item.sessionId)).map(item=>({...item,rootSessionId:resolvedRoots.get(item.sessionId)||item.rootSessionId})),retainedEvents=rawEvents.filter(item=>selected.has(item.sessionId)).map(item=>({...item,rootSessionId:resolvedRoots.get(item.sessionId)||item.rootSessionId})).sort((a,b)=>a.at.localeCompare(b.at)).slice(-200);
 // Root identifiers are diagnostic correlations only. They grant no control,
 // rearm, identity proof, reward, or performance claim.
 return {format:'farmdogs-session-report-v1',generatedAt:now,selection:{sessionId:requested,status:invalidSelection?'invalid':requested&&!known.has(requested)?'not_found':requested?'selected':'all',relatedSessionIds:[...selected].sort()},sessions:retainedSessions,events:retainedEvents,coverage:{inputEventCount:inputEvents.length,exportedEventCount:retainedEvents.length,ignoredEventCount:ignoredEvents,eventLimit:200,historyComplete:false},claims:{diagnosticOnly:true,accountDataIncluded:false,screenshotsIncluded:false,freeTextIncluded:false,continuousConnectionVerified:false,rewardVerified:false,performanceMeasured:false,realRoundValidation:false,sessionResumptionAuthorized:false}};
}

module.exports={buildSessionReport,sessionReasonCode,sessionPhase};
