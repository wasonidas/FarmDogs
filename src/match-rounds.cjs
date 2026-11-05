'use strict';

// This adapter reads public facts only. A wake is a hint to look for the native
// team selector, never proof that it exists or permission to send any input.
const MAX_SOURCE_AGE_MS=90000;
const MAX_ROW_AGE_MS=120000;
const MAX_FUTURE_MS=5000;
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/;
const copy=value=>structuredClone(value);
const integer=value=>Number.isSafeInteger(value)&&value>0;
function iso(value){
 if(typeof value!=='string'||!ISO.test(value))return NaN;
 const stamp=Date.parse(value);
 return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,19)===value.slice(0,19)?stamp:NaN;
}
const time=value=>new Date(value).toISOString();
const text=value=>typeof value==='string'&&value.length>0&&value.length<=100&&!/[\u0000-\u001f]/.test(value)?value:null;
const fresh=(stamp,now,limit=MAX_SOURCE_AGE_MS)=>Number.isFinite(stamp)&&Number.isFinite(now)&&now-stamp>=-MAX_FUTURE_MS&&now-stamp<=limit;

function serverIdentity(server,now){
 const source=iso(server?.sourceAt);
 if(!server||!Number.isInteger(server.number)||server.number<1||server.number>5||!integer(server.apiId)||!UUID.test(server.joinId||'')||server.trusted!==true||server.online!==true||server.stale===true||!fresh(source,now))return null;
 return {server:server.number,apiId:server.apiId,joinId:server.joinId.toLowerCase()};
}
const identityKey=target=>target?`${target.server}:${target.apiId}:${target.joinId}`:null;

function normalizeMatchRounds(payload,server,now=Date.now()){
 const target=serverIdentity(server,now);
 const unknown=reason=>({ok:false,status:'unknown',reason,target,server:target?.server??null,apiId:target?.apiId??null,joinId:target?.joinId??null,sourceAt:null,observedAt:Number.isFinite(now)?time(now):null,current:null,lastCompleted:null});
 if(!target)return unknown('Esperando la identidad pública reciente del servidor.');
 if(!payload||!Array.isArray(payload.lives)||!Array.isArray(payload.matches)||!Number.isSafeInteger(payload.fetchedAt)||!fresh(payload.fetchedAt,now))return unknown('Esperando un historial público reciente de partidas.');
 const source=payload.fetchedAt;
 let malformed=false;
 function row(raw,live){
  if(!raw||raw.server!==target.server||raw.serverId!==target.apiId)return null;
  const start=iso(raw.startedAt),end=iso(raw.endedAt);
  if(!integer(raw.id)||raw.live!==live||!Number.isFinite(start)||!Number.isFinite(end)||start>end||end>source+MAX_FUTURE_MS||end>now+MAX_FUTURE_MS||start>source+MAX_FUTURE_MS||live&&raw.winner!==null||!live&&(!text(raw.winner)||raw.winner.trim()!==raw.winner)){
   malformed=true;return null;
  }
  // An active row's endedAt advances while the round is still live. It is the
  // row heartbeat, not its finish time. Long, still-fresh seeding rounds exist.
  if(live&&!fresh(end,now,MAX_ROW_AGE_MS))return null;
  return {id:raw.id,startedAt:time(start),...(live?{observedAt:time(end)}:{endedAt:time(end),winner:raw.winner}),map:text(raw.map),experience:text(raw.experience),startMs:start,endMs:end};
 }
 const lives=payload.lives.map(value=>row(value,true)).filter(Boolean);
 const completed=payload.matches.map(value=>row(value,false)).filter(Boolean);
 if(malformed)return unknown('El historial del servidor contiene una ronda no válida.');
 function canonical(rows,live){
  const byId=new Map();
  for(const item of rows){
   const old=byId.get(item.id);
   if(old&&(old.startMs!==item.startMs||old.map!==item.map||old.experience!==item.experience||!live&&(old.endMs!==item.endMs||old.winner!==item.winner)))return {conflict:true};
   if(!old||item.endMs>old.endMs)byId.set(item.id,item);
  }
  const ordered=[...byId.values()].sort((a,b)=>a.startMs-b.startMs||a.id-b.id);
  for(let n=1;n<ordered.length;n++)if(ordered[n].startMs<=ordered[n-1].startMs||ordered[n].id<=ordered[n-1].id||!live&&ordered[n].endMs<=ordered[n-1].endMs)return {conflict:true};
  return {value:ordered.at(-1)||null};
 }
 const currentResult=canonical(lives,true),completedResult=canonical(completed,false);
 if(currentResult.conflict||completedResult.conflict)return unknown('La identidad o el orden de las rondas públicas no es consistente.');
 const current=currentResult.value,lastCompleted=completedResult.value;
 if(current&&lastCompleted&&(current.id<=lastCompleted.id||current.startMs<lastCompleted.endMs))return unknown('El historial mezcla una ronda activa con una ronda final incompatible.');
 const strip=item=>item?Object.fromEntries(Object.entries(item).filter(([key])=>key!=='startMs'&&key!=='endMs')):null;
 return {ok:true,status:'ready',reason:'Historial público reciente.',target,...target,sourceAt:time(source),observedAt:time(now),current:strip(current),lastCompleted:strip(lastCompleted)};
}

function createMatchRoundTracker({now=Date.now}={}){
 let bound=null,server=null,result=null,baselineAt=null,lastSource=-Infinity;
 let current=null,lastCompleted=null,highId=0,highStart=-Infinity,highCompletedId=0,highCompletedEnd=-Infinity,wake=null,awaitingLiveAfterFinal=null;
 function unknown(reason){
  const at=now();return {ok:false,status:'unknown',reason,target:bound?copy(bound):null,...(bound||{server:null,apiId:null,joinId:null}),sourceAt:result?.sourceAt||null,observedAt:Number.isFinite(at)?time(at):null,baselineReady:baselineAt!==null,current:current?copy(current):null,lastCompleted:lastCompleted?copy(lastCompleted):null,wake:null};
 }
 function view(nextServer=server){
  const at=now(),target=serverIdentity(nextServer,at);
  if(!target)return unknown('Esperando la identidad pública reciente del servidor.');
  if(bound&&identityKey(target)!==identityKey(bound))return unknown('La identidad del servidor ha cambiado. Reinicia la observación.');
  if(!result)return unknown('Esperando la primera lectura del historial público.');
  if(!result.ok)return {...copy(result),baselineReady:baselineAt!==null,wake:null};
  if(!fresh(Date.parse(result.sourceAt),at))return unknown('El historial público de partidas ha caducado.');
  const validWake=wake&&fresh(Date.parse(wake.sourceAt),at)?copy(wake):null;
  return {...copy(result),baselineReady:baselineAt!==null,wake:validWake};
 }
 function observe(payload,nextServer){
  server=nextServer?copy(nextServer):null;
  const at=now(),sample=normalizeMatchRounds(payload,server,at);
  if(!sample.ok){result=sample;return view();}
  if(bound&&identityKey(sample.target)!==identityKey(bound)){result={...sample,ok:false,status:'unknown',reason:'La identidad del servidor ha cambiado. Reinicia la observación.'};return view();}
  const source=Date.parse(sample.sourceAt);
  if(source<lastSource){result={...sample,ok:false,status:'unknown',reason:'Se ha recibido un historial anterior al último aceptado.'};return view();}
  if(source===lastSource)return view();
  const nextCurrent=sample.current,nextCompleted=sample.lastCompleted;
  const start=nextCurrent?Date.parse(nextCurrent.startedAt):-Infinity;
  const completedStart=nextCompleted?Date.parse(nextCompleted.startedAt):-Infinity;
  const completedEnd=nextCompleted?Date.parse(nextCompleted.endedAt):-Infinity;
  // IDs belong to the selected internal server. Neither a smaller ID, a
  // reused ID with a new start nor a backward finish can create another wake.
  if(current&&nextCurrent&&(nextCurrent.id<current.id||nextCurrent.id===current.id&&(nextCurrent.startedAt!==current.startedAt||Date.parse(nextCurrent.observedAt)<Date.parse(current.observedAt))||nextCurrent.id>current.id&&(start<=Date.parse(current.startedAt)||start<Date.parse(current.observedAt)))||lastCompleted&&nextCompleted&&(nextCompleted.id<lastCompleted.id||nextCompleted.id===lastCompleted.id&&(nextCompleted.startedAt!==lastCompleted.startedAt||nextCompleted.endedAt!==lastCompleted.endedAt)||nextCompleted.id>lastCompleted.id&&completedEnd<=Date.parse(lastCompleted.endedAt))){
   result={...sample,ok:false,status:'unknown',reason:'Las rondas del servidor han retrocedido o cambiado de identidad.'};return view();
  }
  if(baselineAt===null){
   bound=copy(sample.target);baselineAt=source;current=nextCurrent;lastCompleted=nextCompleted;
   highId=Math.max(nextCurrent?.id||0,nextCompleted?.id||0);highStart=Math.max(start,completedStart);
   highCompletedId=nextCompleted?.id||0;highCompletedEnd=completedEnd;lastSource=source;
   result={...sample,status:'baseline',reason:'Primera lectura guardada; no activa un selector histórico.'};return view();
  }
  let trigger=null;
  const knownLiveFinal=current&&nextCompleted?.id===current.id&&nextCompleted.startedAt===current.startedAt&&completedEnd>=Date.parse(current.observedAt);
  const newerFinal=nextCompleted&&nextCompleted.id>highId&&completedStart>highStart&&(!current||completedStart>=Date.parse(current.observedAt));
  if(nextCompleted&&nextCompleted.id>highCompletedId&&completedEnd>highCompletedEnd&&completedEnd>baselineAt&&fresh(completedEnd,at,MAX_ROW_AGE_MS)&&(knownLiveFinal||newerFinal))trigger={kind:'completed',round:nextCompleted};
  // A new live ID also covers administrative endings below 95 points and a
  // missed final row. It must have begun after observation was established.
  const alreadyWokenAtFinal=nextCurrent&&awaitingLiveAfterFinal&&nextCurrent.id>awaitingLiveAfterFinal.id&&start>=awaitingLiveAfterFinal.endedMs;
  if(!trigger&&!alreadyWokenAtFinal&&nextCurrent&&nextCurrent.id>highId&&start>highStart&&start>baselineAt&&fresh(start,at,MAX_ROW_AGE_MS))trigger={kind:'new_round',round:nextCurrent};
  if(trigger){
   const round=trigger.round,eventKey=`${bound.apiId}:${round.id}:${trigger.kind}`;
   wake={kind:trigger.kind,eventKey,eventId:eventKey,roundId:round.id,currentRoundId:nextCurrent?.id||round.id,previousRoundId:current?.id||lastCompleted?.id||null,nextRoundId:nextCurrent?.id||null,roundStartedAt:round.startedAt,startedAt:round.startedAt,endedAt:trigger.kind==='completed'?round.endedAt:null,sourceAt:sample.sourceAt,observedAt:sample.observedAt};
   awaitingLiveAfterFinal=trigger.kind==='completed'&&!nextCurrent?{id:round.id,endedMs:Date.parse(round.endedAt)}:null;
  }
  if(alreadyWokenAtFinal){
   // The final and the following live ID describe the same boundary. Enrich
   // the existing hint for the consumer, keeping its key and original TTL.
   if(wake?.kind==='completed'&&wake.roundId===awaitingLiveAfterFinal.id)wake={...wake,currentRoundId:nextCurrent.id,nextRoundId:nextCurrent.id};
   awaitingLiveAfterFinal=null;
  }
  // Retain a live round across a short gap so that its matching final can be
  // recognized; no vanished row or missed fetch alone means round completion.
  if(nextCurrent)current=nextCurrent;
  if(nextCompleted)lastCompleted=nextCompleted;
  highId=Math.max(highId,nextCurrent?.id||0,nextCompleted?.id||0);highStart=Math.max(highStart,start,completedStart);
  highCompletedId=Math.max(highCompletedId,nextCompleted?.id||0);highCompletedEnd=Math.max(highCompletedEnd,completedEnd);lastSource=source;
  result={...sample,status:'ready'};return view();
 }
 function reset(){bound=null;server=null;result=null;baselineAt=null;lastSource=-Infinity;current=null;lastCompleted=null;highId=0;highStart=-Infinity;highCompletedId=0;highCompletedEnd=-Infinity;wake=null;awaitingLiveAfterFinal=null;return unknown('Esperando la primera lectura del historial público.');}
 return {observe,view,reset};
}

module.exports={normalizeMatchRounds,createMatchRoundTracker,MAX_SOURCE_AGE_MS,MAX_ROW_AGE_MS,MAX_FUTURE_MS};
