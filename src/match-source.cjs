'use strict';
const {performance}=require('node:perf_hooks');
const {createMatchRoundTracker}=require('./match-rounds.cjs');
const MATCHES_URL='https://api.wardogsspain.com/api/portal/public/wardogs-matches';
const MAX_BYTES=1024*1024;
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

// Public results are an optional wake-up signal. No account, game process,
// screenshots, coordinates or native input capabilities belong in this reader.
function createMatchSource({now=Date.now,monoNow=()=>performance.now(),fetchImpl=fetch,getTarget=()=>null,event=()=>{}}={}){
 const tracker=createMatchRoundTracker({now});
 let closed=false,key=null,generation=0,target=null,flight=null,nextMono=0,nextAt=null,lastAttemptAt=null,lastSuccessAt=null,error=null,failures=0;
 const stamp=()=>new Date(now()).toISOString();
 const emit=(kind,detail)=>{try{event(kind,detail);}catch{}};
 function synchronize(){
  let next;try{next=getTarget();}catch{next=null;}
  const row=next?.server;
  const identity=next?.enabled===true&&typeof next.id==='string'&&next.id.length<=100&&Number.isInteger(row?.number)&&row.number>=1&&row.number<=5&&Number.isSafeInteger(row.apiId)&&row.apiId>0&&UUID.test(row.joinId||'')?[next.id,row.number,row.apiId,row.joinId.toLowerCase()].join(':'):null;
  if(identity!==key){
   generation++;flight?.controller.abort();flight=null;tracker.reset();key=identity;nextMono=0;nextAt=null;lastAttemptAt=null;lastSuccessAt=null;error=null;failures=0;
  }
  target=identity?next:null;
  return target;
 }
 function catalogFresh(row){const age=now()-Date.parse(row?.sourceAt);return row?.trusted===true&&row.online===true&&row.stale!==true&&Number.isFinite(age)&&age>=-5000&&age<=90000;}
 function view(){
  if(closed)return {ok:false,status:'disabled',reason:'Lectura de rondas cerrada.',wake:null};
  synchronize();
  if(!target)return {ok:false,status:'disabled',reason:'El historial sólo se consulta al repetir equipo entre partidas.',wake:null,refreshSeconds:60};
  return {...tracker.view(target.server),refreshSeconds:60,fetch:{inFlight:!!flight,lastAttemptAt,lastSuccessAt,nextAttemptAt:nextAt,error}};
 }
 async function readPayload(response){
  const parse=text=>{try{return JSON.parse(text);}catch{throw Error('El historial público no contiene JSON válido.');}};
  const length=Number(response.headers?.get?.('content-length'));
  if(Number.isFinite(length)&&length>MAX_BYTES){try{await response.body?.cancel();}catch{}throw Error('El historial público excede el tamaño admitido.');}
  if(!response.body?.getReader){const text=await response.text();if(Buffer.byteLength(text)>MAX_BYTES)throw Error('El historial público excede el tamaño admitido.');return parse(text);}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw Error('El historial público excede el tamaño admitido.');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
  return parse(Buffer.concat(chunks,size).toString('utf8'));
 }
 async function tick(){
  if(closed)return;
  synchronize();
  if(!target||flight||!catalogFresh(target.server)||monoNow()<nextMono)return;
  const epoch=generation,requestKey=key,controller=new AbortController(),job={controller};flight=job;lastAttemptAt=stamp();
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]);
  try{
   const response=await fetchImpl(MATCHES_URL,{signal,headers:{Accept:'application/json'}});
   if(!response.ok){const failure=Error('El historial responde HTTP '+response.status);failure.retryAfter=response.headers?.get?.('retry-after');try{await response.body?.cancel();}catch{}throw failure;}
   const payload=await readPayload(response);
   if(closed)return;synchronize();if(generation!==epoch||key!==requestKey)return;
   const observed=tracker.observe(payload,target.server);
   if(!observed.ok)throw Error('El historial no contiene una lectura válida y reciente para este servidor.');
   if(error)emit('match_source_recovered',{server:target.server.number});
   error=null;failures=0;lastSuccessAt=stamp();nextMono=monoNow()+60000;nextAt=new Date(now()+60000).toISOString();
  }catch(cause){
   if(closed)return;synchronize();if(generation!==epoch||key!==requestKey||controller.signal.aborted)return;
   failures++;error=String(cause?.message||'No se pudo leer el historial público.').replace(/[\u0000-\u001f]/g,' ').slice(0,240);
   const raw=cause?.retryAfter;let requested=raw?Number(raw)*1000:0;if(raw&&!Number.isFinite(requested))requested=Date.parse(raw)-now();
   const delay=Math.min(3600000,Math.max(60000*Math.pow(2,Math.min(failures-1,4)),Number.isFinite(requested)?Math.max(0,requested):0));
   nextMono=monoNow()+delay;nextAt=new Date(now()+delay).toISOString();
   emit('match_source_error',{server:target.server.number,message:error,retryAt:nextAt});
  }finally{if(flight===job)flight=null;}
 }
 function close(){if(closed)return;closed=true;generation++;flight?.controller.abort();flight=null;target=null;key=null;tracker.reset();}
 return {tick,view,close};
}
module.exports={createMatchSource,MATCHES_URL};
