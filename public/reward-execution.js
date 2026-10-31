async function executeExpiringReward(command) {
 'use strict';
 const result=status=>({commandId:command&&command.id,status});
 const milliseconds=value=>typeof value==='number'&&Number.isSafeInteger(value)?value:typeof value==='string'?Date.parse(value):NaN;
 const week=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const parsed=Date.parse(value+'T00:00:00Z');return Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===value&&new Date(parsed).getUTCDay()===1;};
 const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
 if(!command||!uuid(command.id)||!uuid(command.readerId)||!/^\d{17}$/.test(command.accountId||'')||command.anterior!==true||!['semanal_3','semanal_6'].includes(command.hito)||!week(command.week)||!week(command.contextWeek))return result('skipped');
 const previous=new Date(Date.parse(command.contextWeek+'T00:00:00Z')-7*86400000).toISOString().slice(0,10);
 if(previous!==command.week)return result('skipped');
 const deadline=milliseconds(command.deadline),notBefore=milliseconds(command.notBefore),issued=milliseconds(command.issuedAt),expires=milliseconds(command.expiresAt),expectedDays=command.hito==='semanal_3'?1:2;
 if(command.dias!==expectedDays||![deadline,notBefore,issued,expires].every(Number.isFinite)||deadline-notBefore<5*60000||deadline-notBefore>120*60000||issued>=expires||expires-issued>20000)return result('skipped');
 const inWindow=()=>Date.now()>=notBefore&&Date.now()<deadline&&Date.now()>=issued-1000&&Date.now()<expires;
 if(!inWindow())return result('skipped');
 const key='__wardogsRewardExecutionState';
 const state=globalThis[key]||(globalThis[key]={active:Object.create(null),completed:new Set()});
 if(state.completed.has(command.id)||state.active[command.readerId])return result('skipped');
 const controller=new AbortController();
 state.active[command.readerId]={commandId:command.id,controller};
 let attempted=false;
 const overall=setTimeout(()=>controller.abort(),18000);
 async function request(url,options,timeout){
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{return await fetch(url,{...options,credentials:'include',cache:'no-store',signal:controller.signal});}
  finally{clearTimeout(timer);}
 }
 async function json(response){try{return await response.json();}catch{return null;}}
 async function identity(){const response=await request('https://api.wardogsspain.com/api/cuenta/yo',{method:'GET'},3000);const body=await json(response);return response.ok&&body&&body.conectado===true&&body.cuenta&&body.cuenta.steamId===command.accountId;}
 function previousReward(data,claimed){
  if(!data||data.activos!==true||data.semana!==command.contextWeek||!data.anterior||!Array.isArray(data.anterior.hitos))return false;
  const old=data.anterior;
  if(old.semana!==undefined&&old.semana!==command.week)return false;
  if(milliseconds(old.cobrarHasta)!==deadline)return false;
  const rows=old.hitos.filter(item=>item&&item.id===command.hito);
  return rows.length===1&&rows[0].alcanzado===true&&rows[0].cobrado===claimed&&rows[0].dias===expectedDays;
 }
 try{
  if(!await identity())return result('skipped');
  const response=await request('https://api.wardogsspain.com/api/cuenta/retos',{method:'GET'},4000),fresh=await json(response);
  if(!response.ok||!fresh)return result('error');
  if(previousReward(fresh,true))return result('already_claimed');
  if(!previousReward(fresh,false)||controller.signal.aborted||!inWindow())return result('skipped');
  // The account must still be the one that owned the observed expiring reward.
  if(!await identity()||controller.signal.aborted||!inWindow())return result('skipped');
  attempted=true;
  const posted=await request('https://api.wardogsspain.com/api/cuenta/retos/cobrar',{method:'POST',headers:{'Content-Type':'application/json','X-WDE':'1'},body:JSON.stringify({hito:command.hito,anterior:true})},5000);
  const body=await json(posted);
  if(body&&(body.error==='ya_cobrado'||body.code==='ya_cobrado'))return result('already_claimed');
  if(!posted.ok)return result(posted.status>=500?'uncertain':'error');
  if(body&&body.dias===expectedDays)return result('success');
  if(body&&previousReward(body.retos,true))return result('success');
  const confirmation=await request('https://api.wardogsspain.com/api/cuenta/retos',{method:'GET'},3000),confirmed=await json(confirmation);
  return result(confirmation.ok&&previousReward(confirmed,true)?'success':'uncertain');
 }catch{return result(attempted?'uncertain':'error');}
 finally{
  clearTimeout(overall);state.completed.add(command.id);
  const active=state.active[command.readerId];if(active&&active.commandId===command.id)delete state.active[command.readerId];
 }
}
