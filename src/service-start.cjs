'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const BASE='http://127.0.0.1:24243';
async function ensureObserver({root,fetchImpl=fetch,spawnProcess=spawn,sleep=delay,now=()=>performance.now(),timeoutMs=10000}={}){
 async function probe(){
  let r;try{r=await fetchImpl(BASE+'/api/state',{signal:AbortSignal.timeout(1500)});}catch(error){if(error.cause?.code==='ECONNREFUSED'||error.code==='ECONNREFUSED')return false;throw Error('No se puede comprobar el servicio local; no se inicia otro.');}
  if(!r.ok)throw Error('El puerto 24243 responde con otro estado. Revisa el servicio existente.');
  let state;try{state=await r.json();}catch{throw Error('El puerto 24243 no responde como la app de Wardogs.');}
  if(state.appId!=='wardogs-seeding-local-v1')throw Error('El puerto 24243 está ocupado por otro servicio o una versión anterior.');
  return true;
 }
 if(await probe())return {url:BASE,started:false};
 const data=path.join(root,'data');fs.mkdirSync(data,{recursive:true});
 const out=fs.openSync(path.join(data,'service-launch.log'),'a'),err=fs.openSync(path.join(data,'service-launch-error.log'),'a');
 try{
  await new Promise((resolve,reject)=>{
   const child=spawnProcess(process.execPath,[path.join(root,'src','server.cjs')],{cwd:root,windowsHide:true,detached:true,stdio:['ignore',out,err]});
   child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
  });
 }finally{fs.closeSync(out);fs.closeSync(err);}
 const deadline=now()+timeoutMs;
 while(now()<deadline){await sleep(200);if(await probe())return {url:BASE,started:true};}
 throw Error('El servicio no terminó de abrirse. Consulta data/service-launch-error.log.');
}
module.exports={ensureObserver};
