'use strict';
const {randomUUID}=require('node:crypto');
const {connectionTarget}=require('./local-launch.cjs');
const {createAutoSeeding}=require('./auto-seeding.cjs');
const live=new Set(['watching','launching']);

function createActivityMode({load,save,now,monoNow,getServers,prepare,event=()=>{},limitEndAt=value=>value,automaticEntry=()=>false}){
 let job=load()||null,startedMono=null,budgetMs=null,closed=false;if(job&&job.initialFocus===undefined)job={...job,initialFocus:'driver'};if(job&&job.strategy===undefined)job={...job,strategy:'activity'};
 const observations=new Map();
 const emit=(kind,detail)=>{try{event(kind,detail);}catch{}};
 const active=()=>!!job&&live.has(job.status);
 const view=()=>job?structuredClone(job):null;
 const update=value=>{save(value);job=value;};
 if(active())update({...job,status:'interrupted',finishedAt:new Date(now()).toISOString(),reason:'La app se reinició. Activa de nuevo la vigilancia por actividad.'});
 function start(input={}){
  if(closed)throw Error('La vigilancia de actividad está cerrada.');
  if(active())throw Error('Ya hay una vigilancia por actividad activa.');
  if(input?.purpose!==undefined&&input.purpose!=='seeding'||input?.seeding?.purpose!==undefined&&input.seeding.purpose!=='seeding')throw Error('La vigilancia por actividad solo prepara seeding, no movimiento temporal.');
  const initialFocus=input.initialFocus===undefined?'driver':input.initialFocus;
  if(!['driver','desktop'].includes(initialFocus))throw Error('Modo de foco inicial no válido.');
  const strategy=input.strategy===undefined?'activity':input.strategy;
  if(!['activity','maximum'].includes(strategy))throw Error('Elige actividad o sedeo máximo.');
  const maximum=strategy==='maximum';
  const {durationMinutes,serverNumbers=[1,2,3,4,5]}=input;
  // Maximum seeding deliberately ignores the old activity range. A stored
  // minimum of 16 must not keep an overnight run waiting for a filling server.
  const minPlayers=maximum?0:(input.minPlayers===undefined?1:input.minPlayers),maxEntryPlayers=maximum?99:(input.maxEntryPlayers===undefined?19:input.maxEntryPlayers);
  if(!Number.isInteger(durationMinutes)||durationMinutes<1||durationMinutes>720)throw Error('Duración de 1 a 720 minutos.');
  if(!Number.isInteger(minPlayers)||!Number.isInteger(maxEntryPlayers)||minPlayers<(maximum?0:1)||maxEntryPlayers>99||minPlayers>maxEntryPlayers)throw Error('Rango de jugadores de 1 a 99, con mínimo menor o igual al máximo.');
  if(!Array.isArray(serverNumbers)||!serverNumbers.length||serverNumbers.length>5||new Set(serverNumbers).size!==serverNumbers.length||serverNumbers.some(number=>!Number.isInteger(number)||number<1||number>5))throw Error('Elige servidores distintos del 1 al 5.');
  if(input.seeding!==undefined&&(!input.seeding||typeof input.seeding!=='object'||Array.isArray(input.seeding)))throw Error('Ajustes de movimiento no válidos.');
  if(input.team!==undefined&&!['any','blue','red','green'].includes(input.team))throw Error('Elige equipo aleatorio, azul, rojo o verde.');
  const at=now(),mono=monoNow(),raw=createAutoSeeding({...input.seeding,...(maximum?{startPlayers:1}:{}),server:1,durationMinutes},at);
  const endAt=limitEndAt(raw.endAt),end=Date.parse(endAt);
  if(!Number.isFinite(at)||!Number.isFinite(mono)||!Number.isFinite(end)||end<=at||end>Date.parse(raw.endAt))throw Error('El límite de la vigilancia no es válido o ya ha pasado.');
  const seeding=Object.fromEntries(['startPlayers','intervalSeconds','holdMs'].map(key=>[key,raw[key]]));
  const candidate={id:randomUUID(),strategy,status:'watching',reason:maximum?'Sedeo máximo: buscando un servidor que admita sedeo, también vacío; se necesitan dos lecturas recientes.':'Vigilando actividad pública; se necesitan dos lecturas recientes del mismo servidor.',createdAt:new Date(at).toISOString(),endAt:new Date(end).toISOString(),durationMinutes,minPlayers,maxEntryPlayers,serverNumbers:[...serverNumbers].sort((a,b)=>a-b),seeding,...(input.team?{team:input.team}:{}),initialFocus,automaticEntry:automaticEntry()===true,selectedServer:null,selectedJoinId:null,samples:[],finishedAt:null};
  update(candidate);startedMono=mono;budgetMs=end-at;observations.clear();emit('activity_started',{id:job.id});return view();
 }
 function finish(status,reason){
  if(!job)return null;
  job={...job,status,reason,finishedAt:new Date(now()).toISOString()};observations.clear();
  try{save(job);}catch(error){job={...job,persistenceError:String(error.message||error).slice(0,500),reason:reason+' No se pudo guardar el estado; no se reanudará durante esta ejecución.'};emit('activity_storage_error',{id:job.id,message:job.persistenceError});}
  emit('activity_finished',{id:job.id,status,server:job.selectedServer});return view();
 }
 function stop(reason='Vigilancia por actividad detenida por el usuario.'){return finish('cancelled',reason);}
 function withinBudget(){return startedMono!==null&&Number.isFinite(monoNow())&&monoNow()>=startedMono&&monoNow()-startedMono<budgetMs&&now()<Date.parse(job.endAt);}
 function candidates(){
  const rows=getServers(),result=[];const source=Array.isArray(rows)?rows:[];
  for(const number of job.serverNumbers){
   const matches=source.filter(server=>server?.number===number);const server=matches.length===1?matches[0]:null;
   const timestamp=Date.parse(server?.sourceAt),age=now()-timestamp;
   const tope=Number.isInteger(server?.publicRule?.tope)&&server.publicRule.tope>=1&&server.publicRule.tope<=100?server.publicRule.tope:20;
   let target=null;
   if(server?.trusted===true&&server.online===true&&server.stale!==true&&server.seedingActive===true&&Number.isFinite(age)&&age>=-60000&&age<=90000&&Number.isInteger(server.players)&&Number.isInteger(server.capacity)&&server.capacity>0&&server.players<server.capacity&&server.players>=job.minPlayers&&server.players<=job.maxEntryPlayers&&server.players<tope){
    try{target=connectionTarget(source,number,server.joinId);}catch{}
   }
   if(!target){observations.delete(number);continue;}
   const identity=JSON.stringify([server.joinId,tope,server.capacity]);
   const previous=observations.get(number);let consecutiveSamples=1,growth=null;
   if(previous&&previous.identity===identity){
    if(timestamp===previous.timestamp&&server.players===previous.players){consecutiveSamples=previous.consecutiveSamples;growth=previous.growth;}
    else if(timestamp>previous.timestamp){growth=server.players-previous.players;consecutiveSamples=growth<0?1:Math.min(2,previous.consecutiveSamples+1);}
    else{consecutiveSamples=0;}
   }
   observations.set(number,{identity,timestamp,players:server.players,consecutiveSamples,growth});
   result.push({number,players:server.players,consecutiveSamples,growth,target});
  }
  return result.sort((a,b)=>b.players-a.players||Math.max(0,b.growth||0)-Math.max(0,a.growth||0)||a.number-b.number);
 }
 async function tick(){
  if(closed||!active())return;
  if(!withinBudget()){finish('expired',job.strategy==='maximum'?'Sedeo máximo: terminó la duración elegida.':'Fin del tiempo elegido para vigilar y seedear.');return;}
  if(job.status==='launching')return;
  const id=job.id;
  try{
   const current=candidates(),selected=current.find(candidate=>candidate.consecutiveSamples>=2);
   const samples=current.map(({target,...sample})=>sample);
   if(!selected){
    const reason=job.strategy==='maximum'?(samples.length?'Sedeo máximo: esperando otra lectura reciente del servidor candidato.':'Sedeo máximo: esperando un servidor que admita sedeo, también vacío.'):(samples.length?'Actividad candidata; esperando otra lectura reciente del mismo servidor.':'Esperando un servidor con actividad por debajo del umbral de entrada.');
    if(job.reason!==reason||JSON.stringify(job.samples)!==JSON.stringify(samples))update({...job,reason,samples});return;
   }
   if(job.automaticEntry&&automaticEntry()!==true)throw Error('El controlador de entrada automática dejó de estar disponible.');
   update({...job,status:'launching',reason:job.automaticEntry?`Completando la entrada automática al #${selected.number}.`:`Preparando seeding en el #${selected.number}; entrada y despliegue asistidos.`,selectedServer:selected.number,selectedJoinId:selected.target.joinId,samples,requestedAt:new Date(now()).toISOString()});
   const remainingMs=Math.min(Date.parse(job.endAt)-now(),budgetMs-(monoNow()-startedMono));
   if(remainingMs<=0){finish('expired',job.strategy==='maximum'?'Sedeo máximo: terminó la duración elegida.':'Fin del tiempo elegido para vigilar y seedear.');return;}
   const isCurrent=()=>!closed&&job?.id===id&&job.status==='launching'&&withinBudget();
   // Translate the remaining monotonic budget into a new UTC cap after clock rollback.
   const sessionEndAt=new Date(Math.min(Date.parse(job.endAt),now()+remainingMs)).toISOString();
   await prepare(selected.target,{remainingMinutes:Math.max(1,Math.ceil(remainingMs/60000)),sessionEndAt,initialFocus:job.initialFocus,settings:{...structuredClone(job.seeding),...(job.team?{team:job.team}:{})}},isCurrent);
   if(job?.id!==id||job.status!=='launching')return;
   if(!withinBudget()){finish('expired','Terminó el tiempo mientras se preparaba la entrada.');return;}
   finish('prepared',job.strategy==='maximum'?(job.automaticEntry?`Sedeo máximo: entrada preparada en el #${selected.number}; movimiento desde el despliegue verificado, aunque estés solo. Se conserva ese servidor hasta el fin elegido.`:`Sedeo máximo preparado en el #${selected.number}. Completa la entrada y el despliegue; se conserva ese servidor hasta el fin elegido.`):(job.automaticEntry?`Entrada automática preparada en el #${selected.number}. Consulta su progreso; no se cambiará de servidor.`:`Sesión preparada en el #${selected.number}. Completa la entrada y el despliegue; no se cambia de servidor automáticamente.`));
  }catch(error){
   if(job?.id!==id||!live.has(job.status))return;
   const next={...job,status:'error',reason:'No se pudo preparar la sesión: '+String(error.message||error).slice(0,500),finishedAt:new Date(now()).toISOString()};
   try{update(next);}catch{job=next;}
   observations.clear();emit('activity_error',{id,message:next.reason});
  }
 }
 function close(){if(closed)return;try{if(active())finish('interrupted','La app se cerró. La vigilancia no se reanudará sola.');}finally{closed=true;observations.clear();}}
 return {start,stop,tick,view,active,close};
}
module.exports={createActivityMode};
