'use strict';
const {randomUUID}=require('node:crypto');
const {performance}=require('node:perf_hooks');

const SOURCE='https://api.wardogsspain.com/api/cuenta/retos';
const MAX_AGE_MS=100000,LEASE_MS=20000;
const GUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const ACCOUNT=/^\d{17}$/;
const MILESTONES={semanal_3:1,semanal_6:2};
const RESULTS=new Set(['success','already_claimed','skipped','error','uncertain']);
const STORED_STATUSES=new Set(['reserved',...RESULTS]);
const clone=value=>structuredClone(value);
const iso=value=>new Date(value).toISOString();

function instant(value){
 if(typeof value==='number')return Number.isSafeInteger(value)&&value>=Date.UTC(2000,0,1)&&value<Date.UTC(2101,0,1)?value:null;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
 const calendar=Date.parse(value.slice(0,10)+'T00:00:00.000Z');
 if(!Number.isFinite(calendar)||iso(calendar).slice(0,10)!==value.slice(0,10)||Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||Number(value.slice(17,19))>59)return null;
 const at=Date.parse(value);return Number.isFinite(at)?at:null;
}
function validWeek(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const at=Date.parse(value+'T00:00:00.000Z');
 return Number.isFinite(at)&&iso(at).slice(0,10)===value&&new Date(at).getUTCDay()===1;
}
const precedingWeek=value=>iso(Date.parse(value+'T00:00:00.000Z')-7*86400000).slice(0,10);
function milestones(value){
 if(!Array.isArray(value))return [];
 const counts=new Map();for(const item of value)if(item&&Object.hasOwn(MILESTONES,item.id))counts.set(item.id,(counts.get(item.id)||0)+1);
 return value.filter(item=>item&&counts.get(item.id)===1&&item.dias===MILESTONES[item.id]&&typeof item.alcanzado==='boolean'&&typeof item.cobrado==='boolean').map(item=>({hito:item.id,dias:item.dias,alcanzado:item.alcanzado,cobrado:item.cobrado}));
}

function createRewardProtection({load=()=>null,save=()=>{},now=Date.now,monoNow=()=>performance.now(),event=()=>{}}={}){
 let state={version:1,settings:{enabled:false,leadMinutes:15,ownerAccountId:null},attempts:[]};
 let owner=null,observation=null,lastAccepted=null,storageError=false,generation=0;
 const highWater=new Map(),leases=new Map();
 const emit=(kind,detail)=>{try{event(kind,detail);}catch{}};
 function persist(candidate){
  const result=save(clone(candidate));
  if(result&&typeof result.then==='function')throw Error('El guardado de premios debe ser síncrono.');
  state=candidate;
 }
 try{
  const loaded=load();
  if(loaded!==null&&loaded!==undefined){
   if(loaded.version===1&&loaded.settings?.enabled===false&&Array.isArray(loaded.attempts)&&!loaded.attempts.length&&!Object.hasOwn(loaded.settings,'ownerAccountId'))loaded.settings.ownerAccountId=null;
   if(loaded.version!==1||typeof loaded.settings?.enabled!=='boolean'||!Number.isInteger(loaded.settings.leadMinutes)||loaded.settings.leadMinutes<5||loaded.settings.leadMinutes>120||!Array.isArray(loaded.attempts)||loaded.attempts.length>10000)throw Error('Estado de premios no válido.');
   if(loaded.settings.ownerAccountId!==null&&(typeof loaded.settings.ownerAccountId!=='string'||!ACCOUNT.test(loaded.settings.ownerAccountId))||loaded.settings.enabled&&!loaded.settings.ownerAccountId)throw Error('Cuenta de premios no válida.');
   const keys=new Set(),ids=new Set();
   for(const item of loaded.attempts){
    const key=item?.accountId+':'+item?.week+':'+item?.hito;
    if(!item||typeof item.accountId!=='string'||!ACCOUNT.test(item.accountId)||!GUID.test(item.id)||!GUID.test(item.readerId)||!validWeek(item.week)||!validWeek(item.contextWeek)||precedingWeek(item.contextWeek)!==item.week||!Object.hasOwn(MILESTONES,item.hito)||item.dias!==MILESTONES[item.hito]||!STORED_STATUSES.has(item.status)||instant(item.deadline)===null||instant(item.issuedAt)===null||instant(item.expiresAt)===null||keys.has(key)||ids.has(item.id))throw Error('Diario de premios no válido.');
    keys.add(key);ids.add(item.id);
   }
   state=clone(loaded);
   if(state.attempts.some(item=>item.status==='reserved'))persist({...state,attempts:state.attempts.map(item=>item.status==='reserved'?{...item,status:'uncertain',finishedAt:iso(now())}:item)});
  }
 }catch{
  storageError=true;state={...state,settings:{...state.settings,enabled:false}};
 }

 function configure(input={}){
  const enabled=input.enabled===undefined?state.settings.enabled:input.enabled;
  const leadMinutes=input.leadMinutes===undefined?state.settings.leadMinutes:input.leadMinutes;
  if(typeof enabled!=='boolean'||!Number.isInteger(leadMinutes)||leadMinutes<5||leadMinutes>120)throw Error('El cobro necesita un estado booleano y un margen de 5 a 120 minutos.');
  if(input.ownerAccountId!==undefined&&(typeof input.ownerAccountId!=='string'||!ACCOUNT.test(input.ownerAccountId)))throw Error('La cuenta de Steam de los premios no es válida.');
  if(storageError&&enabled)throw Error('No se puede activar el cobro: revisa el guardado del diario.');
  if(storageError){state={...state,settings:{...state.settings,enabled:false,leadMinutes}};generation++;leases.clear();return view();}
  let ownerAccountId=state.settings.ownerAccountId;
  if(input.ownerAccountId!==undefined){
   if(state.settings.enabled&&ownerAccountId&&input.ownerAccountId!==ownerAccountId)throw Error('Desactiva primero la protección para vincular otra cuenta de Steam.');
   ownerAccountId=input.ownerAccountId;
  }
  if(enabled&&!ownerAccountId&&observation&&freshness().fresh)ownerAccountId=observation.accountId;
  if(enabled&&!ownerAccountId)throw Error('Para activar el cobro hace falta una lectura reciente de tu cuenta de Steam.');
  const candidate={...state,settings:{enabled,leadMinutes,ownerAccountId}};
  if(enabled!==state.settings.enabled||leadMinutes!==state.settings.leadMinutes||ownerAccountId!==state.settings.ownerAccountId){generation++;leases.clear();}
  if(!enabled){
   state=candidate;
   try{persist(candidate);}catch(error){storageError=true;throw error;}
  }else persist(candidate);
  emit('reward_protection_configured',{enabled,leadMinutes});return view();
 }
 function disconnect(readerId){
  if(readerId!==owner)return false;
  owner=null;observation=null;generation++;leases.clear();
  const attempts=state.attempts.map(item=>item.readerId===readerId&&item.status==='reserved'?{...item,status:'uncertain',finishedAt:iso(now())}:item);
  if(attempts.some((item,i)=>item!==state.attempts[i])){
   try{persist({...state,attempts});}catch{storageError=true;state={...state,attempts,settings:{...state.settings,enabled:false}};}
  }
  emit('reward_protection_disconnected',{});return true;
 }
 function invalidate(readerId){if(readerId===owner)observation=null;return false;}
 function observe(input={}){
  const {readerId,accountId,source,data}=input,at=instant(input.observedAt),wall=now(),mono=monoNow();
  if(typeof readerId!=='string'||!GUID.test(readerId))return false;
  const takeover=!!owner&&readerId!==owner;
  if(takeover&&sampleFreshness(lastAccepted?.readerId===owner?lastAccepted:null).fresh)return false;
  if(typeof accountId!=='string'||!ACCOUNT.test(accountId))return invalidate(readerId);
  if(source!==SOURCE||at===null||!Number.isFinite(wall)||!Number.isFinite(mono)||at>wall||wall-at>MAX_AGE_MS||at<=(highWater.get(readerId)??-Infinity))return invalidate(readerId);
  if(takeover&&lastAccepted&&at<=lastAccepted.observedMs)return false;
  if(!data||typeof data!=='object'||Array.isArray(data)||typeof data.activos!=='boolean'||!validWeek(data.semana))return invalidate(readerId);
  const contextWeek=data.semana,previousWeek=precedingWeek(contextWeek),previous=data.anterior;
  let prior=null;
  if(previous&&typeof previous==='object'&&!Array.isArray(previous)&&(!Object.hasOwn(previous,'semana')||previous.semana===previousWeek)){
   const deadline=instant(previous.cobrarHasta);
   if(deadline!==null)prior={week:previousWeek,deadline:iso(deadline),milestones:milestones(previous.hitos)};
  }
  const permanent=data.permanente===true||data.vip?.permanente===true;
  const sample={readerId,accountId,source,observedAt:iso(at),observedMs:at,receivedMono:mono,initialAge:wall-at,contextWeek,active:data.activos&&!permanent,current:milestones(data.hitos),rollover:instant(data.hasta)===null?null:iso(instant(data.hasta)),previous:prior};
  if(takeover)disconnect(owner);
  const claimed=new Set(sample.current.filter(item=>item.cobrado).map(item=>contextWeek+':'+item.hito));
  if(prior)for(const item of prior.milestones)if(item.cobrado)claimed.add(prior.week+':'+item.hito);
  const attempts=state.attempts.map(item=>item.accountId===accountId&&claimed.has(item.week+':'+item.hito)&&!['success','already_claimed'].includes(item.status)?{...item,status:'success',finishedAt:iso(wall),reconciledAt:iso(wall)}:item);
  if(attempts.some((item,i)=>item!==state.attempts[i])){
   try{persist({...state,attempts});}catch{storageError=true;return invalidate(readerId);}
   for(const item of attempts)if(item.reconciledAt===iso(wall)){leases.delete(item.id);emit('reward_claim_reconciled',{id:item.id,week:item.week,hito:item.hito});}
  }
  highWater.set(readerId,at);owner=readerId;observation=sample;lastAccepted=sample;return true;
 }
 function sampleFreshness(sample){
  if(!sample)return {fresh:false,ageMs:null};
  const wallAge=now()-sample.observedMs,elapsed=monoNow()-sample.receivedMono;
  const ageMs=Math.max(wallAge,sample.initialAge+elapsed);
  return {fresh:Number.isFinite(ageMs)&&Number.isFinite(elapsed)&&elapsed>=0&&wallAge>=0&&ageMs<=MAX_AGE_MS,ageMs:Number.isFinite(ageMs)?Math.max(0,ageMs):null};
 }
 function freshness(){return observation?.readerId===owner?sampleFreshness(observation):{fresh:false,ageMs:null};}
 function eligible(readerId){
  return !storageError&&state.settings.enabled&&readerId===owner&&observation?.accountId===state.settings.ownerAccountId&&observation?.active&&freshness().fresh;
 }
 function next({readerId}={}){
  if(!eligible(readerId))return null;
  for(const [id,lease] of leases)if(lease.generation===generation&&monoNow()>=lease.issuedMono&&monoNow()<lease.expiresMono&&state.attempts.some(item=>item.id===id&&item.status==='reserved'))return null;
  const prior=observation.previous,wall=now(),mono=monoNow();
  if(!prior)return null;
  const deadline=instant(prior.deadline),notBefore=deadline-state.settings.leadMinutes*60000;
  if(wall<notBefore||wall>=deadline)return null;
  const item=prior.milestones.find(item=>item.alcanzado&&!item.cobrado&&!state.attempts.some(attempt=>attempt.accountId===observation.accountId&&attempt.week===prior.week&&attempt.hito===item.hito));
  if(!item)return null;
  const expires=Math.min(wall+LEASE_MS,deadline);
  const command={id:randomUUID(),readerId,accountId:observation.accountId,week:prior.week,contextWeek:observation.contextWeek,hito:item.hito,dias:item.dias,anterior:true,deadline:prior.deadline,notBefore:iso(notBefore),issuedAt:iso(wall),expiresAt:iso(expires)};
  persist({...state,attempts:[...state.attempts,{...command,status:'reserved'}]});
  leases.set(command.id,{issuedMono:mono,expiresMono:mono+(expires-wall),generation});
  emit('reward_claim_reserved',{id:command.id,week:command.week,hito:command.hito,deadline:command.deadline});
  return Object.freeze({...command});
 }
 function authorize({readerId,commandId}={}){
  if(!eligible(readerId))return null;
  const item=state.attempts.find(item=>item.id===commandId),lease=leases.get(commandId),wall=now(),mono=monoNow();
  if(!item||item.readerId!==readerId||item.accountId!==observation.accountId||item.accountId!==state.settings.ownerAccountId||item.status!=='reserved'||item.authorizedAt||!lease||lease.generation!==generation||mono<lease.issuedMono||mono>=lease.expiresMono||wall<instant(item.issuedAt)||wall>=instant(item.expiresAt))return null;
  const previous=observation.previous;
  if(!previous||previous.week!==item.week||previous.deadline!==item.deadline||observation.contextWeek!==item.contextWeek||wall<instant(item.deadline)-state.settings.leadMinutes*60000||wall>=instant(item.deadline)||!previous.milestones.some(m=>m.hito===item.hito&&m.dias===item.dias&&m.alcanzado&&!m.cobrado))return null;
  const authorized={...item,authorizedAt:iso(wall)};
  persist({...state,attempts:state.attempts.map(entry=>entry.id===item.id?authorized:entry)});
  const {status,...command}=authorized;return Object.freeze(command);
 }
 function result({readerId,commandId,status}={}){
  if(!GUID.test(readerId)||!GUID.test(commandId)||!RESULTS.has(status))return false;
  const index=state.attempts.findIndex(item=>item.id===commandId&&item.readerId===readerId);
  if(index<0)return false;
  const previous=state.attempts[index];
  if(['success','already_claimed'].includes(status)&&instant(previous.authorizedAt)===null)return false;
  if(['success','already_claimed'].includes(previous.status))return true;
  if(previous.status!=='reserved'&&status!=='success'&&status!=='already_claimed')return false;
  const attempts=state.attempts.map((item,i)=>i===index?{...item,status,finishedAt:iso(now())}:item);
  persist({...state,attempts});leases.delete(commandId);
  emit('reward_claim_result',{id:commandId,week:previous.week,hito:previous.hito,status});return true;
 }
 function view(){
  const sample=lastAccepted,fresh=freshness(),pending=[];
  if(sample){
   for(const item of sample.current)if(item.alcanzado&&!item.cobrado)pending.push({week:sample.contextWeek,hito:item.hito,dias:item.dias,anterior:false,deadline:null,notBefore:null,projectedRollover:sample.rollover,status:'awaiting_rollover'});
   if(sample.previous)for(const item of sample.previous.milestones)if(item.alcanzado&&!item.cobrado){
    const deadline=instant(sample.previous.deadline),notBefore=deadline-state.settings.leadMinutes*60000;
    const attempted=state.attempts.find(attempt=>attempt.accountId===sample.accountId&&attempt.week===sample.previous.week&&attempt.hito===item.hito);
    pending.push({week:sample.previous.week,hito:item.hito,dias:item.dias,anterior:true,deadline:sample.previous.deadline,notBefore:iso(notBefore),projectedRollover:null,status:attempted?.status||(now()>=deadline?'expired':now()<notBefore?'waiting':'due')});
   }
  }
  const {ownerAccountId,...settings}=state.settings;
  return {settings:clone(settings),enabled:state.settings.enabled,leadMinutes:state.settings.leadMinutes,ownerConfigured:!!ownerAccountId,storageError,pending,attempts:state.attempts.map(({readerId,accountId,...item})=>clone(item)),source:{url:SOURCE,readerId:owner,observedAt:sample?.observedAt||null,connected:!!owner,fresh:fresh.fresh,ageMs:fresh.ageMs,active:!!observation?.active,accountMatch:!!observation&&observation.accountId===ownerAccountId}};
 }
 return {configure,observe,disconnect,next,authorize,result,view};
}
module.exports={createRewardProtection};
