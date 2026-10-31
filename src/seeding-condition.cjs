'use strict';
// Describe the current authenticated condition, never an awarded VIP day.
function seedingCondition(data,now){
 const unknown=reason=>({status:'unknown',mode:null,reason,rewardVerified:false});
 const deadlineOf=value=>typeof value==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):NaN;
 if(!data||typeof data!=='object')return unknown('Condición final sin confirmar.');
 if(data.estado==='nada')return {status:'outside',mode:null,reason:'Sin una condición de seeding en curso.',rewardVerified:false};
 if(!Number.isInteger(data.servidor)||data.servidor<1||data.servidor>5)return unknown('Servidor de la cuenta sin confirmar.');
 const common={server:data.servidor,rewardVerified:false,inside:typeof data.dentro==='boolean'?data.dentro:null};
 const candidateStatus=reached=>common.inside===false?'away':common.inside===null?'presence_unknown':reached?'condition_candidate':'waiting';
 if(data.estado==='sedeando')return {...common,status:'seeding',mode:null,reason:'La cuenta registra sedeo. La condición final se confirma al iniciarse la espera.'};
 if(data.estado!=='aguantando')return {...unknown('Estado pendiente de interpretar.'),...common};
 if(data.final===true){
  const deadline=deadlineOf(data.cobraAt);
  return {...common,status:'pending_days',mode:'pending_days',deadline:Number.isFinite(deadline)?data.cobraAt:null,reason:'Cobro de días que estaban en espera; comprobar después el historial.'};
 }
 if(data.porJugadores===true){
  const target=data.cobroN;
  if(!Number.isInteger(target)||target<1||target>100)return {...unknown('La cuenta indica población, pero falta un objetivo válido.'),...common};
  const players=Number.isInteger(data.jugadores)&&data.jugadores>=0&&data.jugadores<=100?data.jugadores:null;
  return {...common,status:candidateStatus(players!==null&&players>=target),mode:'population',target,players,reason:common.inside===false?`La cuenta te detecta fuera del #${data.servidor}; vuelve dentro del margen indicado por la web. Objetivo: ${target} jugadores.`:`Permanecer en el #${data.servidor} hasta ${target} jugadores. El premio se confirma en el historial.`};
 }
 if(data.porJugadores===false){
  const deadline=deadlineOf(data.cobraAt);
  if(!Number.isFinite(deadline))return {...unknown('La cuenta indica tiempo, pero falta la fecha de cobro.'),...common};
  return {...common,status:candidateStatus(now>=deadline),mode:'timed',deadline:data.cobraAt,remainingMs:Math.max(0,deadline-now),reason:common.inside===false?`La cuenta te detecta fuera del #${data.servidor}; vuelve dentro del margen indicado por la web.`:'Permanecer hasta la fecha de cobro indicada por la cuenta. El premio se confirma en el historial.'};
 }
 return {...unknown('Condición final sin confirmar. Consúltala en Mi cuenta antes de dar el llenado por completado.'),...common};
}
module.exports={seedingCondition};
