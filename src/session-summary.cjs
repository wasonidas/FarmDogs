'use strict';

// Presentation only: a summary grants no input, renewal, reconnection or prize.
// It builds a new allowlisted document rather than copying controller/account data.
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const TERMINAL=new Set(['completed','cancelled','expired','error','interrupted','disabled','stopped','prepared','open_requested','blocked','uncertain','missed']);
const ENTRY=new Set(['opening','waiting_game','navigating','joining','choosing_team','deploying','starting_seeding','recovering_source','paused_mouse']);
const AUTO=new Set(['waiting','waiting_controller','waiting_source','waiting_presence','waiting_match','waiting_game','starting_movement','moving','paused_mouse']);
const PERSISTENT=new Set(['preparing','watching','waiting_selector','selecting','waiting_source','waiting_cleanup','waiting_controller','paused_controller','paused_identity','paused_error','paused_mouse']);
const WATCH=new Set(['scheduled','watching','threshold_candidate','target_candidate','unknown_source','requires_review','rule_unknown','time_candidate']);
const LATCHED=new Set(['paused_controller','paused_identity','paused_error']);
const ACTIVITY=new Set(['watching','launching']),OPENING=new Set(['scheduled','launching']);
const TEAMS=new Set(['blue','red','green','any']);
const TEAM_NAMES={blue:'azul',red:'rojo',green:'verde',any:'disponible'};
const record=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const id=value=>typeof value==='string'&&UUID.test(value)?value.toLowerCase():null;
const server=value=>Number.isInteger(value)&&value>=1&&value<=5?value:null;
const team=value=>TEAMS.has(value)?value:null;
const instant=value=>{
 if(typeof value!=='string'&&typeof value!=='number')return null;
 const ms=typeof value==='number'?value:Date.parse(value);
 return Number.isFinite(ms)&&Math.abs(ms)<=8640000000000000?new Date(ms).toISOString():null;
};
const same=(a,b)=>id(a)!==null&&id(a)===id(b);
const lifecycle=value=>value.operatorStopped===true?'cancelled':typeof value.status==='string'?value.status:null;
const live=(value,states)=>!!id(value.id)&&!TERMINAL.has(lifecycle(value))&&states.has(lifecycle(value));
const unknownLive=(value,states)=>!!id(value.id)&&typeof value.status==='string'&&!TERMINAL.has(lifecycle(value))&&!states.has(lifecycle(value));
const targetText=value=>server(value)===null?'al servidor elegido':`al servidor #${value}`;
const modeFor=(kind,value)=>kind==='auto'?value.purpose==='break'?'break':'seeding':kind==='entry'?value.seeding===true?'seeding':'entry':kind==='activity'?value.strategy==='maximum'?'maximum':'activity':kind==='opening'?'scheduled':kind==='watch'?'observation':kind;

function timing(value,now,{kind='session',endAt=value.endAt,scheduledAt=value.scheduledAt}={}){
 const end=instant(endAt),schedule=instant(scheduledAt),started=instant(value.createdAt||value.startedAt),finished=instant(value.finishedAt||value.stoppedAt);
 return {kind:end?kind:schedule?'schedule':'none',startedAt:started,scheduledAt:schedule,endAt:end,remainingSeconds:end&&Number.isFinite(now)?Math.max(0,Math.ceil((Date.parse(end)-now)/1000)):null,finishedAt:finished};
}
function view(status,title,detail,phase,nextAction='wait',severity='info'){
 return {status,severity,title,detail,phase,nextAction};
}
function describe(candidate){
 const value=candidate.row,status=candidate.state,n=server(candidate.server),color=TEAM_NAMES[candidate.team]||'elegido';
 if(candidate.cleanup)return view('stopping','Terminando la sesión','Esperando la confirmación de parada de sus controladores.','cleanup','wait');
 if(candidate.unverified)return view('attention','Estado de sesión sin comprobar','Abre Comprobar Errores antes de iniciar otra tarea.',null,'review_errors','warning');
 if(candidate.kind==='entry'){
  const labels={
   opening:view('working','Abriendo Wardogs','Preparando la entrada automática.','game'),
   waiting_game:view('waiting','Esperando Wardogs','La entrada continuará cuando reconozca el juego.','game','return_to_game'),
   navigating:view('working','Preparando la entrada',`Buscando el acceso ${targetText(n)}.`,'server','return_to_game'),
   joining:view('working',`Entrando ${targetText(n)}`,'Esperando la conexión y la carga del servidor.','server','return_to_game'),
   choosing_team:view('working',`Seleccionando equipo ${color}`,'El selector seguirá hasta confirmar la entrada o alcanzar su límite.','team','return_to_game'),
   deploying:view('waiting','Comprobando el despliegue','Esperando una confirmación reciente de que has entrado.','deployment','return_to_game'),
   starting_seeding:view('working','Preparando el movimiento','Entregando la entrada comprobada al controlador de movimiento.','movement'),
   recovering_source:view('waiting','Esperando el reinicio del servidor','Se necesitan nuevas comprobaciones del mismo destino.','source'),
   paused_mouse:view('waiting','Revisando el contexto','Esperando una comprobación reciente para continuar.','waiting')
  };
  return labels[status]||view('attention','Entrada sin comprobar','Abre Comprobar Errores para revisar su estado.',null,'review_errors','warning');
 }
 if(candidate.kind==='auto'){
  const name=candidate.mode==='break'?'Anti-AFK':'Seeding';
  const labels={
   waiting:view('waiting',`${name} preparado`,'Esperando las comprobaciones necesarias para continuar.','waiting'),
   waiting_controller:view('waiting','Esperando el controlador','Todavía no se ha confirmado un controlador disponible.','controller','review_errors'),
   waiting_source:view('waiting','Esperando datos recientes','La sesión espera una lectura válida del servidor.','source'),
   waiting_presence:view('waiting','Esperando comprobar tu presencia','La sesión aún no confirma la presencia requerida.','presence',value.presenceMode==='account'?'refresh_account':'return_to_game'),
   waiting_match:view('waiting','Esperando el inicio de partida','La sesión mantiene el movimiento en espera.','match'),
   waiting_game:view('waiting','Esperando tu personaje','Vuelve al juego para comprobar el personaje desplegado.','deployment','return_to_game'),
   starting_movement:view('working','Preparando el movimiento','Esperando la confirmación del controlador.','movement'),
   moving:view('working',`${name} activo`,'El movimiento conserva las comprobaciones y el límite de esta sesión.','movement'),
   paused_mouse:view('waiting','Revisando el contexto','Esperando una comprobación reciente para continuar.','movement')
  };
  return labels[status]||view('attention','Movimiento sin comprobar','Abre Comprobar Errores para revisar su estado.',null,'review_errors','warning');
 }
 if(candidate.kind==='activity'){
  if(status==='launching')return view('working','Preparando el servidor elegido',`Completando la preparación ${targetText(value.selectedServer)}.`,'server');
  return view('waiting',candidate.mode==='maximum'?'Sedeo máximo preparado':'Buscando actividad','Esperando un destino elegible confirmado en dos lecturas recientes.','source');
 }
 if(candidate.kind==='opening')return status==='scheduled'?view('scheduled','Seeding programado','Esperando la hora elegida; aún no se ha solicitado abrir el juego.','waiting'):view('working','Iniciando la programación','Se está preparando la apertura solicitada.','game');
 if(candidate.kind==='persistent-team'){
  const labels={
   preparing:view('waiting','Preparando la repetición','Esperando el acuse del controlador de equipo.','controller'),
   watching:view('waiting',`Equipo ${color} preparado`,'Esperando la siguiente partida; los clics están apagados.','waiting'),
   waiting_selector:view('waiting',`Esperando el selector ${color}`,'Buscando el selector durante este intento.','team','return_to_game'),
   selecting:view('working',`Seleccionando equipo ${color}`,'Esperando que se confirme la entrada al equipo elegido.','team','return_to_game'),
   waiting_source:view('waiting','Esperando datos de la partida','No hay una señal reciente que permita preparar otro intento.','source'),
   waiting_cleanup:view('stopping','Terminando el intento','Esperando la parada del intento anterior.','cleanup'),
   waiting_controller:view('waiting','Esperando el controlador','La repetición espera una comprobación reciente del controlador.','controller','review_errors'),
   paused_controller:view('attention','Revisar el controlador','La repetición necesita revisión antes de continuar.','controller','review_errors','warning'),
   paused_identity:view('attention','Revisar el servidor','El destino de la repetición requiere una comprobación nueva.','server','review_errors','warning'),
   paused_error:view('attention','Revisar el selector','La repetición necesita revisión antes de continuar.','team','review_errors','warning'),
   paused_mouse:view('waiting','Revisando el contexto','Esperando una comprobación reciente para continuar.','team')
  };
  return labels[status]||view('attention','Repetición sin comprobar','Abre Comprobar Errores para revisar su estado.',null,'review_errors','warning');
 }
 if(candidate.kind==='team'){
  if(value.controllerFresh!==true)return view('waiting','Esperando el controlador','La selección necesita un estado reciente del controlador.','controller','review_errors');
  if(value.pausedForContext===true)return view('paused','Selección en pausa','Vuelve a Wardogs para comprobar de nuevo el selector.','team','return_to_game');
  return value.active===true||value.running===true?view('working',`Seleccionando equipo ${color}`,'El autoclic espera la confirmación de entrada.','team','return_to_game'):view('waiting',`Esperando el selector ${color}`,'La selección está preparada, todavía sin confirmar la entrada.','team','return_to_game');
 }
 if(candidate.kind==='watch')return view('waiting','Seguimiento de seeding','Observando los datos del servidor; el seguimiento no confirma un premio.','source');
 return view('attention','Controlador sin sesión verificada','Revisa el controlador antes de iniciar otro automatismo.','controller','review_errors','warning');
}
function mousePause(candidate,stateFresh,now){
 if(!stateFresh||candidate.cleanup||candidate.unverified||LATCHED.has(candidate.state)||TERMINAL.has(candidate.state))return null;
 for(const source of candidate.pauseSources||[candidate.row]){
  const pause=record(source?.userPause);
  if(pause.kind!=='mouse'||pause.active!==true||source?.operatorStopped===true)continue;
  if(source===candidate.teamChild&&source.controllerFresh!==true)continue;
  const resume=instant(pause.resumeAt),remaining=Number.isFinite(pause.remainingMs)&&pause.remainingMs>=0&&pause.remainingMs<=30000?Math.ceil(pause.remainingMs/1000):null;
  return {kind:'mouse',active:true,resumeAt:resume&&Date.parse(resume)<=now+31000?resume:null,remainingSeconds:pause.buttonsDown===true?null:remaining,buttonsDown:pause.buttonsDown===true};
 }
 return null;
}
function terminalTime(row,events){
 let at=instant(row.finishedAt||row.stoppedAt);
 if(at)return at;
 const ownId=id(row.id||row.sessionId);
 if(!ownId)return null;
 for(const event of events){if(!same(event?.id||event?.sessionId,ownId)||!/_finished$|_stopped$|_error$|_confirmed$/.test(event?.kind||''))continue;const stamp=instant(event.at);if(stamp&&(!at||Date.parse(stamp)>Date.parse(at)))at=stamp;}
 return at;
}

function buildSessionSummary(input={}, {now=Date.now()}={}){
 const state=record(input),nowIso=instant(now),at=nowIso===null?NaN:Date.parse(nowIso),observed=instant(state.now),age=observed===null?NaN:at-Date.parse(observed);
 const freshness=Number.isFinite(age)&&age>=-5000&&age<=15000?'fresh':Number.isFinite(age)?'stale':'unknown';
 const output={format:'farmdogs-session-summary-v1',generatedAt:nowIso,status:'idle',severity:'info',mode:null,phase:null,title:'Listo para empezar',detail:'Elige qué quieres hacer en FarmDogs.',server:null,team:null,timing:timing({},at,{kind:'none'}),scope:null,stop:null,nextAction:'start_new',freshness,userPause:null};
 const entry=record(state.entry),auto=record(state.autoSeeding),activity=record(state.activity),opening=record(state.opening),persistent=record(state.persistentTeam),clicker=record(state.teamClicker),movement=record(state.movement),watch=record(state.watch),origin=record(state.entryOrigin),activityOwnership=record(state.activityOwnership);
 const candidates=[];
 const make=(kind,row,mode=kind)=>({kind,row,mode,state:lifecycle(row),server:server(row.server),team:team(row.actualTeam)||team(row.team),scopeId:id(row.id),rootId:id(row.rootEntryId)||id(row.id),stopKind:kind,stopId:id(row.id),cleanup:row.cleanupPending===true,unverified:false,pauseSources:[row],teamChild:null});
 let entryGroup=null,autoGroup=null,persistentGroup=null;
 if(live(entry,ENTRY)||unknownLive(entry,ENTRY)||entry.cleanupPending===true&&id(entry.id)){
  entryGroup=make('entry',entry,entry.seeding===true?'seeding':'entry');entryGroup.unverified=unknownLive(entry,ENTRY);candidates.push(entryGroup);
 }
 const autoActive=live(auto,AUTO)||unknownLive(auto,AUTO);
 const boundAuto=autoActive&&same(entry.id,auto.entryId)&&same(auto.entryId,auto.entryProof?.entryId)&&same(entry.movementSessionId,auto.id);
 if(autoActive){
  if(entryGroup&&boundAuto){entryGroup.pauseSources.push(auto);autoGroup=entryGroup;}
  else{
   autoGroup=make('auto',auto,auto.purpose==='break'?'break':'seeding');autoGroup.unverified=unknownLive(auto,AUTO);
   if(boundAuto&&lifecycle(entry)==='completed'){
    autoGroup.stopKind='entry';autoGroup.stopId=id(entry.id);autoGroup.scopeId=id(entry.id);autoGroup.rootId=id(entry.rootEntryId)||id(entry.id);autoGroup.team=team(entry.actualTeam)||team(entry.team);
   }else if(auto.presenceMode==='entry'&&!boundAuto||auto.entryId!==undefined&&!same(auto.entryId,auto.entryProof?.entryId))autoGroup.unverified=true;
   candidates.push(autoGroup);
  }
 }
 const entryOwnerGroup=entryGroup||(boundAuto&&lifecycle(entry)==='completed'?autoGroup:null);
 const ownOrigin=entryOwnerGroup&&same(origin.entryId,entry.id);
 const activityBound=ownOrigin&&origin.kind==='activity'&&same(origin.ownerId,activity.id);
 const openingBound=ownOrigin&&origin.kind==='scheduled'&&same(origin.ownerId,opening.id);
 const fallbackActivityBound=autoGroup&&autoGroup.kind==='auto'&&same(activityOwnership.jobId,activity.id)&&same(activityOwnership.movementSessionId,auto.id);
 if(activityBound||fallbackActivityBound){const group=activityBound?entryOwnerGroup:autoGroup;group.mode=activity.strategy==='maximum'?'maximum':'seeding';if(fallbackActivityBound){group.stopKind='activity';group.stopId=id(activity.id);group.scopeId=id(activity.id);group.rootId=id(activity.id);}}
 if(live(activity,ACTIVITY)&&!activityBound&&!fallbackActivityBound){const candidate=make('activity',activity,modeFor('activity',activity));candidate.server=server(activity.selectedServer);candidates.push(candidate);}
 if(live(opening,OPENING)&&!openingBound)candidates.push(make('opening',opening,'scheduled'));
 if(persistent.enabled===true&&id(persistent.id)||persistent.cleanupPending===true&&id(persistent.id)){
  persistentGroup=make('persistent-team',persistent,'persistent-team');persistentGroup.unverified=!PERSISTENT.has(persistentGroup.state)&&!TERMINAL.has(persistentGroup.state);candidates.push(persistentGroup);
 }
 const ownEntryTeam=entryOwnerGroup&&same(entry.teamSessionId,clicker.sessionId)&&same(clicker.ownerId,entry.id);
 const ownPersistentTeam=persistentGroup&&same(persistent.sessionId,clicker.sessionId)&&same(persistent.ownerId,clicker.ownerId);
 if(ownEntryTeam||ownPersistentTeam){const group=ownEntryTeam?entryOwnerGroup:persistentGroup;group.teamChild=clicker;group.pauseSources.push(clicker);if(clicker.controllerFresh===true&&same(clicker.operatorStoppedSessionId,clicker.sessionId))group.cleanup=true;}
 else if((clicker.enabled===true||clicker.preparing===true||clicker.stopping===true)&&id(clicker.sessionId)){
  const candidate=make('team',clicker,'team');candidate.scopeId=id(clicker.sessionId);candidate.rootId=candidate.scopeId;candidate.stopId=candidate.scopeId;candidate.state=clicker.stopping===true?'stopping':'selecting';candidate.cleanup=clicker.stopping===true||clicker.controllerFresh===true&&same(clicker.operatorStoppedSessionId,clicker.sessionId);candidate.unverified=clicker.ownerId!==null&&clicker.ownerId!==undefined;candidate.pauseSources=[clicker];candidate.teamChild=clicker;candidates.push(candidate);
 }
 if(persistentGroup&&clicker.controllerFresh===true&&same(persistent.monitorSessionId,clicker.controllerSessionId)&&same(persistent.monitorSessionId,clicker.operatorStoppedSessionId))persistentGroup.cleanup=true;
 // A malformed active record must not turn into a reassuring idle state.
 for(const [kind,row,states]of [['entry',entry,ENTRY],['auto',auto,AUTO],['activity',activity,ACTIVITY],['opening',opening,OPENING]]){
  if(!id(row.id)&&states.has(lifecycle(row))){const candidate=make(kind,row);candidate.unverified=true;candidate.stopId=null;candidates.push(candidate);}
 }
 if(persistent.enabled===true&&!id(persistent.id)){const candidate=make('persistent-team',persistent);candidate.unverified=true;candidate.stopId=null;candidates.push(candidate);}
 if((clicker.enabled===true||clicker.preparing===true||clicker.stopping===true)&&!id(clicker.sessionId)){const candidate=make('team',clicker);candidate.unverified=true;candidate.stopId=null;candidates.push(candidate);}
 if(movement.available===true&&movement.armed===true&&(!autoActive||!same(movement.autoSessionId,auto.id))){const candidate=make('controller',movement,null);candidate.unverified=true;candidate.stopId=null;candidates.push(candidate);}
 // Passive observations do not conflict with an input-owning task.
 if(candidates.length===0&&live(watch,WATCH))candidates.push(make('watch',watch,'observation'));
 if(candidates.length>1){
  Object.assign(output,view('attention','Hay tareas distintas activas','Revisa sus estados antes de iniciar otra tarea.',null,'review_errors','warning'));
 }else if(candidates.length===1){
  const candidate=candidates[0];Object.assign(output,describe(candidate),{mode:candidate.mode,server:candidate.server,team:candidate.team});
  output.scope=candidate.scopeId?{kind:candidate.stopKind,id:candidate.scopeId,rootId:candidate.rootId||candidate.scopeId}:null;
  output.stop=!candidate.cleanup&&!candidate.unverified&&candidate.stopId?{kind:candidate.stopKind,id:candidate.stopId}:null;
  const end=candidate.kind==='persistent-team'?candidate.row.selectorAcquired===true?candidate.row.selectionEndsAt:candidate.row.acquisitionEndsAt:candidate.kind==='opening'&&candidate.state==='scheduled'?candidate.row.scheduledAt:candidate.kind==='team'?candidate.row.ownerEndAt:candidate.row.endAt;
  output.timing=timing(candidate.row,at,{kind:candidate.kind==='persistent-team'?'attempt':candidate.kind==='opening'&&candidate.state==='scheduled'?'schedule':'session',endAt:end});
  output.userPause=mousePause(candidate,freshness==='fresh',at);
  if(output.userPause){Object.assign(output,view('paused','Automatismo en pausa',output.userPause.buttonsDown?'Suelta los botones del ratón para iniciar la espera de reanudación.':output.userPause.remainingSeconds===0?'Esperando una comprobación nueva antes de continuar.':'Esperando el tiempo de inactividad del ratón para volver a comprobar el juego.',output.phase,'wait'));}
 }else{
  const events=Array.isArray(state.events)?state.events:[],rows=[['entry',entry],['auto',auto],['activity',activity],['opening',opening],['persistent-team',persistent],['watch',record(state.lastResult)],['watch',watch]];
  const finished=rows.map(([kind,row])=>({kind,row,status:lifecycle(row),at:terminalTime(row,events)})).filter(item=>id(item.row.id)&&TERMINAL.has(item.status)&&(!item.at||Date.parse(item.at)<=at+5000)).sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0));
  if(state.update?.status==='installing')Object.assign(output,view('working','Actualizando FarmDogs','La aplicación se volverá a abrir al completar la actualización.','update','wait'));
  else if(finished.length){
   const last=finished[0],failure=['error','blocked','uncertain'].includes(last.status),label=last.status==='expired'?'Tiempo de sesión terminado':last.status==='completed'?'Entrada completada':last.status==='prepared'||last.status==='open_requested'?'Preparación solicitada':last.status==='missed'?'La hora programada pasó':failure?'La sesión necesita revisión':last.status==='interrupted'?'Sesión interrumpida':'Sesión detenida';
   Object.assign(output,view('finished',label,failure?'Consulta Comprobar Errores y el historial para revisar el resultado.':'No hay un automatismo activo confirmado. Puedes preparar una sesión nueva.','finished',failure?'review_errors':'start_new',failure?'warning':'info'),{mode:modeFor(last.kind,last.row),server:server(last.row.server||last.row.selectedServer),team:team(last.row.actualTeam)||team(last.row.team)});
   output.scope={kind:last.kind,id:id(last.row.id),rootId:id(last.row.rootEntryId)||id(last.row.id)};output.timing=timing(last.row,at);output.timing.finishedAt=last.at;output.timing.remainingSeconds=null;
  }
 }
 if(freshness!=='fresh'){
  Object.assign(output,view('unknown','Último estado sin confirmar','Esperando una respuesta reciente del servicio local.',null,'review_errors','warning'));output.stop=null;output.userPause=null;output.timing.remainingSeconds=null;
 }
 return output;
}

module.exports={buildSessionSummary};
