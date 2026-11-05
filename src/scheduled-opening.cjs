'use strict';
const {randomUUID}=require('node:crypto');
const {madridToUtc}=require('./domain.cjs');
const {createAutoSeeding}=require('./auto-seeding.cjs');
const {normalizeMousePause}=require('./mouse-pause.cjs');
// A persisted intent precedes the external launch. A restart never repeats it.
function createScheduledOpening({load,save,now,resolveTarget,openGame,event}){
 let job=load()||null;if(job&&job.initialFocus===undefined)job={...job,initialFocus:'driver'};
 const update=next=>{save(next);job=next;};
 if(job&&['scheduled','launching'].includes(job.status)){
  update({...job,status:job.status==='launching'?'uncertain':'interrupted',finishedAt:new Date(now()).toISOString(),reason:'El servicio se reinició. Revisa el juego y programa otra apertura.'});
 }
 const view=()=>job?structuredClone(job):null;
 function schedule(input){
  if(job&&['scheduled','launching'].includes(job.status))throw Error('Ya hay una apertura programada. Cancélala antes de cambiarla.');
  if(input?.purpose!==undefined&&input.purpose!=='seeding'||input?.seeding?.purpose!==undefined&&input.seeding.purpose!=='seeding')throw Error('La programación solo prepara seeding, no movimiento temporal.');
  const initialFocus=input.initialFocus===undefined?'driver':input.initialFocus;
  if(!['driver','desktop'].includes(initialFocus))throw Error('Modo de foco inicial no válido.');
  if(typeof input.onlyEligible!=='boolean')throw Error('Indica si solo quieres abrir ante una oportunidad de seeding.');
  const scheduledAt=madridToUtc(input.madridStart),delay=Date.parse(scheduledAt)-now();
  if(delay<=0||delay>366*86400000)throw Error('Elige una hora futura dentro del próximo año.');
  const target=resolveTarget(input.server,input.expectedJoinId);
  if(input.team!==undefined&&!['any','blue','red','green'].includes(input.team))throw Error('Elige equipo aleatorio, azul, rojo o verde.');
  let seeding=null;
  if(input.seeding!==undefined&&input.seeding!==null){
   if(typeof input.seeding!=='object'||Array.isArray(input.seeding))throw Error('Ajustes de seeding no válidos.');
   const validated=createAutoSeeding({...input.seeding,mousePause:input.mousePause??input.seeding?.mousePause,server:target.server},now());
   seeding=Object.fromEntries(['durationMinutes','startPlayers','intervalSeconds','holdMs','mousePause'].map(key=>[key,validated[key]]));
  }
  const automaticEntry=target.automaticEntry===true;
  update({id:randomUUID(),server:target.server,joinId:target.joinId,...(input.team?{team:input.team}:{}),initialFocus,mousePause:normalizeMousePause(input.mousePause??input.seeding?.mousePause),automaticEntry,scheduledAt,onlyEligible:input.onlyEligible,seeding,status:'scheduled',createdAt:new Date(now()).toISOString(),reason:automaticEntry?'Esperando la hora para completar la entrada automática'+(seeding?' y preparar seeding.':'.'):seeding?'Esperando la hora para preparar seeding. La entrada sigue asistida.':'Esperando la hora de apertura. La entrada al servidor es asistida.',connected:false});
  event('opening_scheduled',{id:job.id,server:job.server});return view();
 }
 function cancel(input={}){
  const targeted=input.expectedJobId!==undefined;
  if(targeted&&input.expectedJobId!==job?.id)throw Error('La programación cambió; no se canceló otro trabajo.');
  if(job?.status==='launching'&&!targeted)throw Error('La apertura ya se está solicitando; comprueba el juego.');
  if(job?.status==='scheduled'||targeted&&['launching','open_requested'].includes(job?.status)){update({...job,status:'cancelled',finishedAt:new Date(now()).toISOString(),reason:'Apertura cancelada.'});event('opening_cancelled',{id:job.id,server:job.server});}
  return view();
 }
 function interrupt(){
  if(job&&['scheduled','launching'].includes(job.status)){update({...job,status:job.status==='launching'?'uncertain':'interrupted',finishedAt:new Date(now()).toISOString(),reason:'Servicio detenido. La apertura no se reanudará automáticamente.'});}
 }
 async function tick(){
  if(job?.status!=='scheduled')return;
  const late=now()-Date.parse(job.scheduledAt);if(late<0)return;
  if(late>60000){update({...job,status:'missed',finishedAt:new Date(now()).toISOString(),reason:'La hora pasó sin atender. No se abre el juego tarde.'});event('opening_missed',{id:job.id,server:job.server});return;}
  const id=job.id;
  try{
   const target=resolveTarget(job.server,job.joinId);
   if(job.automaticEntry===true&&target.automaticEntry!==true)throw Error('El controlador de entrada automática dejó de estar disponible.');
   if(job.onlyEligible&&!target.entryCandidate)throw Error('No hay una oportunidad de seeding confirmada con el perfil vigente.');
   update({...job,status:'launching',requestedAt:new Date(now()).toISOString(),reason:'Solicitando apertura de Wardogs.'});
   await openGame(target,view(),()=>job?.id===id&&job.status==='launching');
   if(job.id!==id||job.status!=='launching')return;
   update({...job,status:'open_requested',finishedAt:new Date(now()).toISOString(),reason:job.automaticEntry?'Entrada automática solicitada. Consulta sus pasos en la tarjeta de progreso.':job.seeding?'Sesión de seeding preparada y apertura solicitada. Completa la entrada y el despliegue.':'Apertura solicitada. Completa la entrada por ID y el despliegue en el juego.'});event('scheduled_open_requested',{id:job.id,server:job.server});
  }catch(error){
   if(job.id!==id||!['scheduled','launching'].includes(job.status))return;
   update({...job,status:job.status==='launching'?'uncertain':'blocked',finishedAt:new Date(now()).toISOString(),reason:error.message});event('opening_failed',{id:job.id,server:job.server,message:error.message});
  }
 }
 return {view,schedule,cancel,interrupt,tick};
}
module.exports={createScheduledOpening};
