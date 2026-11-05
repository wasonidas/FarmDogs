'use strict';
const {randomUUID,randomBytes,timingSafeEqual}=require('node:crypto');
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const TEAMS=new Set(['blue','red','green','any']);
const MODES=new Set(['play','seeding','persistent-team','break']);
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const exact=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('INVALID_REQUEST','Solicitud de integración no válida.');};
const id=value=>typeof value==='string'&&UUID.test(value);
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const statuses=new Set(['scheduled','preparing','watching','waiting_game','navigating','joining','choosing_team','deploying','deployed','starting_seeding','waiting_presence','waiting_start','waiting_match','waiting_source','waiting_controller','waiting_selector','waiting_cleanup','selecting','moving','starting_movement','recovering','recovering_source','completed','cancelled','expired','error','interrupted','disabled','paused_controller','paused_identity','paused_error']);
function normalizeIntegrationSettings(input,state,now){
 exact(input,['mode','server','expectedJoinId','team','durationMinutes','antiAfk','intervalSeconds','holdMs','confirmedDeployed','startNow']);
 if(!MODES.has(input.mode))fail('INVALID_MODE','Elige jugar, seeding, repetir equipo o una pausa.');
 const mode=input.mode,durationMinutes=input.durationMinutes??120;
 if(!Number.isInteger(durationMinutes)||durationMinutes<1||durationMinutes>720)fail('INVALID_DURATION','La duración debe estar entre 1 y 720 minutos.');
 const settings={mode,durationMinutes};
 if(mode!=='break'){
  if(!Number.isInteger(input.server)||input.server<1||input.server>5)fail('INVALID_SERVER','Elige uno de los cinco servidores.');
  const row=state.servers?.find(row=>row.number===input.server),age=now-Date.parse(row?.sourceAt);
  if(!row||row.trusted!==true||row.online!==true||row.stale===true||!Number.isFinite(age)||age< -5000||age>90000||!id(input.expectedJoinId)||input.expectedJoinId.toLowerCase()!==row.joinId?.toLowerCase())fail('TARGET_CHANGED','Revisa el servidor y su ID reciente antes de continuar.');
  const team=input.team??(mode==='persistent-team'?'green':'any');
  if(!TEAMS.has(team)||mode==='persistent-team'&&team==='any')fail('INVALID_TEAM','Elige azul, rojo o verde; aleatorio solo para entrar.');
  if(mode==='seeding'&&row.seedingActive!==true)fail('SEEDING_CLOSED','El servidor no admite nuevas sesiones de seeding.');
  if(mode==='persistent-team'&&state.capabilities?.persistentTeam!==true)fail('CAPABILITY_MISSING','Actualiza el controlador para repetir equipo.');
  if(mode!=='persistent-team'&&state.capabilities?.automaticEntry!==true)fail('CAPABILITY_MISSING','El controlador de entrada no está disponible.');
  Object.assign(settings,{server:row.number,expectedJoinId:row.joinId.toLowerCase(),team});
 }
 if(mode==='persistent-team'){
  if(input.startNow!==undefined&&typeof input.startNow!=='boolean')fail('INVALID_REQUEST','Indica si quieres buscar el selector ahora.');
  settings.startNow=input.startNow??false;
 }else if(input.startNow!==undefined)fail('INVALID_REQUEST','La búsqueda inmediata solo se usa al repetir equipo.');
 if(input.antiAfk!==undefined){if(mode!=='play'||typeof input.antiAfk!=='boolean')fail('INVALID_REQUEST','Anti-AFK opcional solo se configura al entrar para jugar.');settings.antiAfk=input.antiAfk;}
 if(mode==='seeding'||mode==='break'){
  const intervalSeconds=input.intervalSeconds??60,holdMs=input.holdMs??500;
  if(!Number.isInteger(intervalSeconds)||intervalSeconds<5||intervalSeconds>300||!Number.isInteger(holdMs)||holdMs<100||holdMs>1500)fail('INVALID_MOVEMENT','Revisa el intervalo y la duración del movimiento.');
  Object.assign(settings,{intervalSeconds,holdMs});
 }
 if(mode==='break'){if(input.confirmedDeployed!==true)fail('DEPLOYMENT_REQUIRED','Confirma que ya estás desplegado con las manos vacías.');settings.confirmedDeployed=true;}
 return settings;
}
function createIntegrationService({now=Date.now,monoNow=()=>performance.now(),getState,startSession,stopSession,getReport=()=>null,event=()=>{}}={}){
 if(![getState,startSession,stopSession].every(fn=>typeof fn==='function'))throw Error('Faltan dependencias de integración.');
 const instanceId=randomUUID(),token=randomBytes(32).toString('hex');
 const reviews=new Map(),requests=new Map(),lastOwned=new Map();let owned=null,closed=false,sequence=0,tail=Promise.resolve(),leaseUntil=null,leaseMono=null,stopPending=false,nextStopMono=0;
 const serial=fn=>{const job=tail.then(fn);tail=job.catch(()=>{});return job;};
 const renew=()=>{leaseUntil=now()+15000;leaseMono=monoNow()+15000;};
 const retire=()=>{if(owned){lastOwned.set(owned.ownerId,{...owned});while(lastOwned.size>16)lastOwned.delete(lastOwned.keys().next().value);}owned=null;leaseUntil=null;leaseMono=null;stopPending=false;};
 const auth=header=>{if(typeof header!=='string'||!/^Bearer [a-f0-9]{64}$/.test(header))return false;const value=header.slice(7);return timingSafeEqual(Buffer.from(value),Buffer.from(token));};
 const envelope=()=>({protocolVersion:1,service:'farmdogs',instanceId});
 const emit=(kind,detail)=>{try{event(kind,detail);}catch{}};
 function ownSession(){
  if(!owned)return null;const state=getState();let row=owned.mode==='persistent-team'?state.persistentTeam:owned.mode==='break'?state.autoSeeding:state.entry;
  const recovered=row&&row.rootEntryId===owned.id&&state.entryOrigin?.kind==='integration'&&state.entryOrigin.ownerId===owned.ownerId;
  if(!row||row.id!==owned.id&&!recovered)return null;
  if(row.status==='completed'){
   if(row.teamSessionId&&state.teamClicker?.operatorStoppedSessionId===row.teamSessionId)row={...row,status:'cancelled'};
   else if(row.movementSessionId&&state.autoSeeding?.id===row.movementSessionId&&state.autoSeeding.entryId===row.id&&state.autoSeeding.entryProof?.entryId===row.id)row=state.autoSeeding;
   else if(owned.mode==='play'&&!row.movementSessionId)row={...row,status:'deployed'};
  }
  return {id:owned.id,ownerId:owned.ownerId,mode:owned.mode,phase:stopPending?'stopping':statuses.has(row.status)?row.status:'unknown',status:stopPending?'stopping':statuses.has(row.status)?row.status:'unknown',server:owned.server??null,team:owned.team??null,leaseExpiresAt:leaseUntil?new Date(leaseUntil).toISOString():null};
 }
 function status(authorized=false){
  if(!authorized||closed)return {...envelope(),pairingRequired:true,capabilities:[]};
  const state=getState();
  return {...envelope(),pairingRequired:false,capabilities:['preview','start','stop','lease','session-report'],servers:(state.servers||[]).filter(row=>Number.isInteger(row.number)&&row.number>=1&&row.number<=5).map(row=>({number:row.number,joinId:id(row.joinId)?row.joinId:null,players:Number.isInteger(row.players)?row.players:null,map:typeof row.map==='string'?row.map.slice(0,80):null,online:row.online===true,trusted:row.trusted===true,sourceAt:iso(row.sourceAt),seedingActive:row.seedingActive===true})),session:ownSession(),seq:sequence};
 }
 function validate(input){
  exact(input,['protocolVersion','requestId','instanceId','ownerId','action','settings','reviewId','expectedSessionId']);
  if(closed)fail('CLOSED','La integración está cerrada.');
  if(input.protocolVersion!==1||input.instanceId!==instanceId||!id(input.ownerId)||!id(input.requestId))fail('PAIRING_REQUIRED','Conecta de nuevo esta instancia de FarmDogs.');
  if(!['preview','start','stop','lease'].includes(input.action))fail('INVALID_ACTION','Acción no admitida.');
 }
 function command(input){
  validate(input);input=structuredClone(input);const key=input.ownerId+':'+input.requestId,encoded=JSON.stringify(input);
  if(requests.has(key)){const prior=requests.get(key);if(prior.input!==encoded)fail('REQUEST_REUSED','La solicitud ya se usó con otro contenido.');return prior.promise;}
  const work=async()=>{
   if(input.action==='preview'){
    const settings=normalizeIntegrationSettings(input.settings,getState(),now()),review={id:randomUUID(),expiresAt:new Date(now()+30000).toISOString(),settings};
    for(const [id,review]of reviews)if(Date.parse(review.expiresAt)<=now())reviews.delete(id);
    if(reviews.size>=16)reviews.delete(reviews.keys().next().value);
    reviews.set(review.id,{...review,ownerId:input.ownerId,expiresMono:monoNow()+30000});return {...status(true),requestId:input.requestId,review};
   }
   if(input.action==='start'){
    const review=reviews.get(input.reviewId);if(!review||review.ownerId!==input.ownerId||Date.parse(review.expiresAt)<=now()||review.expiresMono<=monoNow())fail('REVIEW_REQUIRED','Revisa de nuevo esta sesión antes de iniciarla.');
    reviews.delete(input.reviewId);const settings=normalizeIntegrationSettings(review.settings,getState(),now());
    if(owned&&ownSession()&&!['completed','cancelled','expired','error','interrupted','disabled'].includes(ownSession().status))fail('SESSION_ACTIVE','Detén primero la sesión de integración anterior.');
    if(stopPending)fail('STOP_PENDING','Espera a que se confirme la parada anterior.');
    const beganMono=monoNow(),launched=await startSession(settings,{ownerId:input.ownerId,reviewId:review.id});
    if(!launched||!id(launched.id))fail('START_UNVERIFIED','El controlador no confirmó una sesión propia.');
    const receipt={id:launched.id,ownerId:input.ownerId,mode:settings.mode,server:settings.server,team:settings.team,endsMono:beganMono+settings.durationMinutes*60000};
    if(closed){try{await stopSession(receipt,'integration_link_lost');}catch{}fail('CLOSED','La integración se cerró durante el inicio.');}
    owned=receipt;renew();sequence++;emit('integration_session_started',{id:owned.id,mode:owned.mode,server:owned.server});
    return {...status(true),requestId:input.requestId};
   }
   if(!owned||owned.ownerId!==input.ownerId||input.expectedSessionId!==owned.id||!ownSession())fail('SESSION_OWNERSHIP','La parada no corresponde a tu sesión actual.');
   if(input.action==='lease'){if(stopPending)fail('STOP_PENDING','Espera a que termine la parada.');if(monoNow()>=leaseMono||monoNow()>=owned.endsMono)fail('LEASE_EXPIRED','El enlace venció; espera la parada antes de volver a conectar.');if(['completed','cancelled','expired','error','interrupted','disabled'].includes(ownSession().status)){retire();fail('SESSION_ENDED','La sesión terminó; revisa otra antes de iniciarla.');}renew();return {...status(true),requestId:input.requestId};}
   const stopping={...owned};stopPending=true;
   try{const result=await stopSession(stopping);if(result?.cleanupPending)fail('STOP_PENDING','La parada sigue pendiente de confirmación.');retire();sequence++;emit('integration_session_stopped',{id:stopping.id,mode:stopping.mode});return {...status(true),requestId:input.requestId,stopped:true};}catch(error){nextStopMono=monoNow()+1000;throw error;}
  };
  for(const [oldKey,old]of requests)if(requests.size>=64&&old.settled)requests.delete(oldKey);
  if(requests.size>=64)fail('BUSY','Espera a que termine la operación de integración.');
  const record={input:encoded,promise:null,settled:false};record.promise=serial(()=>{if(closed)fail('CLOSED','La integración está cerrada.');return work();}).finally(()=>{record.settled=true;});requests.set(key,record);
  return record.promise;
 }
 function descriptor({root,pid,baseUrl}){return {format:'farmdogs-integration-connection-v1',protocolVersion:1,instanceId,baseUrl,root,pid,token,startedAt:new Date(now()).toISOString()};}
 function report(ownerId,sessionId=null){const receipt=owned?.ownerId===ownerId?owned:lastOwned.get(ownerId);if(!receipt||sessionId!==null&&sessionId!==receipt.id)fail('SESSION_OWNERSHIP','No hay una sesión propia para exportar.');return getReport(receipt.id);}
 function game(ownerId,sessionId){
  const active=ownSession();if(!owned||owned.ownerId!==ownerId||owned.id!==sessionId||!['play','seeding'].includes(owned.mode)||!active||['completed','cancelled','expired','error','interrupted','disabled','unknown'].includes(active.status))fail('SESSION_OWNERSHIP','No hay una entrada propia para verificar el proceso.');
  const state=getState(),entry=state.entry,recovered=entry?.rootEntryId===owned.id&&state.entryOrigin?.kind==='integration'&&state.entryOrigin.ownerId===owned.ownerId;
  if(!entry||entry.id!==owned.id&&!recovered||!id(entry.id)||!Number.isInteger(entry.gamePid)||entry.gamePid<=4||!iso(entry.entryConfirmedAt))fail('GAME_UNVERIFIED','Todavía no hay una entrada verificada al juego.');
  return {...status(true),game:{pid:entry.gamePid,entryId:entry.id,rootSessionId:owned.id,confirmedAt:iso(entry.entryConfirmedAt)}};
 }
 async function tick(){
  if(closed||!owned||!stopPending&&(leaseMono===null||monoNow()<leaseMono&&monoNow()<owned.endsMono)||stopPending&&monoNow()<nextStopMono)return;
  return serial(async()=>{if(closed||!owned)return;const own=ownSession();if(!own){retire();return;}if(!stopPending&&['completed','cancelled','expired','error','interrupted','disabled'].includes(own.status)){retire();return;}if(!stopPending&&monoNow()<leaseMono&&monoNow()<owned.endsMono)return;
   const stopping={...owned};stopPending=true;try{const result=await stopSession(stopping,'integration_link_lost');if(result?.cleanupPending)fail('STOP_PENDING','La parada sigue pendiente.');retire();sequence++;emit('integration_link_expired',{id:stopping.id,mode:stopping.mode});}catch(error){nextStopMono=monoNow()+1000;emit('integration_stop_pending',{id:stopping.id,mode:stopping.mode});throw error;}
  });
 }
 function hostDisconnected(){return serial(async()=>{if(closed)return {stopped:true};if(owned&&ownSession()){const stopping={...owned};stopPending=true;const result=await stopSession(stopping,'integration_link_lost');if(result?.cleanupPending)return {stopped:false};}retire();return {stopped:true};});}
 function close(){closed=true;reviews.clear();requests.clear();}
 return {instanceId,authorize:auth,status,command,descriptor,report,game,tick,hostDisconnected,close};
}
module.exports={createIntegrationService,normalizeIntegrationSettings};
