'use strict';
const PUBLIC_PREFIX='https://api.wardogsspain.com/api/portal/public/clanes/equipo/';
const REFRESH_MS=30000,PRESENCE_TTL_MS=90000,ASSOCIATION_TTL_MS=100000,TIMEOUT_MS=8000,MAX_BYTES=1024*1024;
const STEAM_ID=/^\d{17}$/;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEAM_NAMES={lonestar:'blue',valkyra:'red',manticore:'green'};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const label=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,120)||null:null;
const timestamp=value=>typeof value==='string'?Date.parse(value):NaN;
const emptyTeams=()=>({blue:0,red:0,green:0,unassigned:0});
class SourceError extends Error {constructor(code,status=null){super(code);this.code=code;this.status=status;}}

function associationView(value,at){
 if(!object(value)||value.status==='disconnected')return {kind:'disconnected',key:'disconnected',fresh:false};
 if(!['member','no_clan'].includes(value.status)||typeof value.accountId!=='string'||!STEAM_ID.test(value.accountId))return {kind:'unknown',key:'unknown',fresh:false};
 const observed=timestamp(value.observedAt),age=at-observed;
 if(!Number.isFinite(observed)||age< -5000)return {kind:'unknown',key:'unknown',fresh:false};
 if(value.status==='no_clan')return {kind:'no_clan',key:JSON.stringify(['no_clan',value.accountId]),fresh:age<ASSOCIATION_TTL_MS,observedAt:value.observedAt};
 if(typeof value.slug!=='string'||value.slug.length>120||!SLUG.test(value.slug))return {kind:'unknown',key:'unknown',fresh:false};
 return {kind:'member',key:JSON.stringify(['member',value.accountId,value.slug]),fresh:age<ASSOCIATION_TTL_MS,slug:value.slug,tag:label(value.tag),name:label(value.name),observedAt:value.observedAt};
}

function parsePresence(payload,slug){
 if(!object(payload)||!object(payload.equipo)||payload.equipo.slug!==slug||!Array.isArray(payload.ahora)||payload.ahora.length>1000)throw new SourceError('invalid_response');
 const counts=Object.fromEntries([1,2,3,4,5].map(number=>[number,{reportedCount:0,teams:emptyTeams()}]));
 for(const row of payload.ahora){
  if(!object(row)||!['string','number'].includes(typeof row.servidor)||typeof row.servidor==='string'&&!row.servidor.trim())continue;
  const number=Number(row.servidor);if(!Number.isInteger(number)||number<1||number>5)continue;
  const faction=typeof row.faccion==='string'?row.faccion.trim().toLowerCase():'';
  const team=Object.hasOwn(TEAM_NAMES,faction)?TEAM_NAMES[faction]:'unassigned';
  counts[number].reportedCount++;counts[number].teams[team]++;
 }
 // Names/SteamIDs of individual players are neither needed nor retained.
 return {clan:{slug,tag:label(payload.equipo.tag),name:label(payload.equipo.nombre)},counts};
}

async function readBounded(response,abortWait,controller){
 const length=response.headers?.get?.('content-length');
 if(length&&/^\d+$/.test(length)&&Number(length)>MAX_BYTES)throw new SourceError('response_too_large');
 if(!response.body||typeof response.body.getReader!=='function')throw new SourceError('invalid_response');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{
  while(true){
   const part=await Promise.race([reader.read(),abortWait]);if(part.done)break;
   if(!(part.value instanceof Uint8Array))throw new SourceError('invalid_response');
   size+=part.value.byteLength;if(size>MAX_BYTES)throw new SourceError('response_too_large');chunks.push(Buffer.from(part.value));
  }
  try{return JSON.parse(Buffer.concat(chunks,size).toString('utf8'));}catch{throw new SourceError('invalid_response');}
 }finally{
  try{if(controller.signal.aborted||size>MAX_BYTES)void reader.cancel().catch(()=>{});}catch{}
  try{reader.releaseLock();}catch{}
 }
}

function createClanPresence({getAssociation,getServers,now=Date.now,fetchImpl=fetch,event=()=>{}}={}){
 if(typeof getAssociation!=='function'||typeof getServers!=='function'||typeof fetchImpl!=='function')throw Error('Faltan las fuentes de asociación o servidores del clan.');
 let closed=false,association=null,identity=null,generation=0,cache=null,lastError=null,inFlight=null,nextFetchAt=0;
 const emit=(name,detail)=>{try{event(name,detail);}catch{}};
 function abortJob(reason){if(inFlight&&!inFlight.controller.signal.aborted){inFlight.cancelReason=reason;inFlight.controller.abort();}}
 function syncAssociation(){
  let value;try{value=getAssociation();}catch{value={status:'unknown'};}
  const next=associationView(value,now());
  if(next.key!==identity){generation++;abortJob('association_changed');identity=next.key;cache=null;lastError=null;nextFetchAt=0;}
  association=next;if(!next.fresh)abortJob('association_unavailable');return next;
 }
 function currentJob(job){return !closed&&job.generation===generation&&job.key===identity&&association?.kind==='member'&&association.fresh;}
 function publicServers(at){
  let rows;try{rows=getServers();}catch{rows=[];}
  const result=new Set();if(!Array.isArray(rows))return result;
  for(const number of [1,2,3,4,5]){
   const matches=rows.filter(row=>object(row)&&row.number===number);if(matches.length!==1)continue;
   const row=matches[0],age=at-timestamp(row.sourceAt);
   if(row.trusted===true&&row.online===true&&row.stale!==true&&Number.isFinite(age)&&age>=-60000&&age<=90000)result.add(number);
  }
  return result;
 }
 function view(){
  const at=now(),current=closed?null:syncAssociation();let status,reason;
  if(closed){status='unavailable';reason='La consulta de clan está cerrada.';}
  else if(current.kind==='disconnected'){status='login_required';reason='Conecta Steam para consultar tu clan registrado.';}
  else if(current.kind==='unknown'){status='unavailable';reason='No se ha podido comprobar tu asociación con un clan.';}
  else if(!current.fresh){status='stale';reason='La lectura de tu cuenta está caducada. Vuelve a consultar Steam.';}
  else if(current.kind==='no_clan'){status='no_clan';reason='La cuenta no tiene un clan registrado en Wardogs Spain.';}
  else if(cache&&(!Number.isFinite(at-cache.at)||at-cache.at<0||at-cache.at>=PRESENCE_TTL_MS)){status='stale';reason='La presencia del clan está caducada.';}
  else if(lastError){status='unavailable';reason='No se ha podido actualizar la presencia del clan.';}
  else if(!cache){status='loading';reason='Consultando dónde juega tu clan.';}
  else{status='ready';reason='Miembros reportados por Wardogs Spain; la fuente se actualiza aproximadamente cada minuto.';}
  const clan=current?.kind==='member'?{slug:current.slug,tag:current.tag||cache?.clan.tag||null,name:current.name||cache?.clan.name||null}:null;
  const known=publicServers(at),servers={};
  for(const number of [1,2,3,4,5]){
   if(status==='ready'&&known.has(number)){const row=cache.counts[number];servers[number]={status:row.reportedCount>0?'present':'empty',reportedCount:row.reportedCount,teams:{...row.teams}};}
   else servers[number]={status:status==='stale'?'stale':'unknown',reportedCount:null,teams:emptyTeams()};
  }
  return {status,reason,clan,membershipObservedAt:current?.observedAt||null,observedAt:cache?new Date(cache.at).toISOString():null,expiresAt:cache?new Date(cache.at+PRESENCE_TTL_MS).toISOString():null,refreshSeconds:REFRESH_MS/1000,selfExcluded:false,servers};
 }
 async function request(job){
  syncAssociation();if(!currentJob(job)||job.controller.signal.aborted)return;
  let onAbort,timer;
  const abortWait=new Promise((resolve,reject)=>{onAbort=()=>reject(new SourceError(job.cancelReason==='timeout'?'timeout':'aborted'));job.controller.signal.addEventListener('abort',onAbort,{once:true});});
  timer=setTimeout(()=>{job.cancelReason='timeout';job.controller.abort();},TIMEOUT_MS);
  try{
   const response=await Promise.race([Promise.resolve().then(()=>fetchImpl(PUBLIC_PREFIX+encodeURIComponent(job.slug),{signal:job.controller.signal,headers:{Accept:'application/json'},credentials:'omit',redirect:'error',cache:'no-store'})),abortWait]);
   if(!response||response.ok!==true)throw new SourceError('http_error',Number.isInteger(response?.status)?response.status:null);
   const payload=await readBounded(response,abortWait,job.controller),data=parsePresence(payload,job.slug);
   syncAssociation();if(!currentJob(job)||job.controller.signal.aborted)return;
   const at=now();if(!Number.isFinite(at)||at<job.startedAt)throw new SourceError('clock_uncertain');
   cache={...data,at};lastError=null;emit('clan_presence_updated',{slug:job.slug,reportedCount:Object.values(data.counts).reduce((total,row)=>total+row.reportedCount,0)});
  }catch(error){
   syncAssociation();if(!currentJob(job)||job.controller.signal.aborted&&job.cancelReason!=='timeout')return;
   lastError=error instanceof SourceError?error.code:'request_failed';emit('clan_presence_error',{slug:job.slug,code:lastError,status:error instanceof SourceError?error.status:null});
  }finally{clearTimeout(timer);job.controller.signal.removeEventListener('abort',onAbort);if(!job.controller.signal.aborted)job.controller.abort();}
 }
 function tick(){
  if(closed)return Promise.resolve(view());const current=syncAssociation();
  if(inFlight)return inFlight.promise;
  const at=now();if(current.kind!=='member'||!current.fresh||!Number.isFinite(at)||at<nextFetchAt)return Promise.resolve(view());
  const job={key:identity,generation,slug:current.slug,startedAt:at,controller:new AbortController(),cancelReason:null,promise:null};nextFetchAt=at+REFRESH_MS;inFlight=job;
  job.promise=Promise.resolve().then(()=>request(job)).finally(()=>{if(inFlight===job)inFlight=null;}).then(()=>view());return job.promise;
 }
 function close(){if(closed)return;closed=true;generation++;abortJob('closed');cache=null;lastError=null;}
 return {tick,view,close};
}
module.exports={createClanPresence};
