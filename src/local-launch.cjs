'use strict';
const path=require('node:path');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {execFile,spawn}=require('node:child_process');
const {promisify}=require('node:util');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STEAM_URI='steam://run/1867240';

function connectionTarget(servers,number,expectedJoinId){
 if(!Number.isInteger(number)||number<1||number>5)throw Error('Elige un servidor del 1 al 5.');
 const server=servers.find(s=>s.number===number);
 // Callers pass the app's official public catalogue, never HTTP-supplied rows.
 // A mode/title rename does not change the authoritative number/UUID pair.
 if(server?.trusted!==true||!UUID.test(server.joinId||''))throw Error('Hace falta una lectura reciente del servidor y su ID de entrada.');
 if(expectedJoinId!==server.joinId)throw Error('El ID del servidor ha cambiado. Actualiza la lectura antes de abrir el juego.');
 return {server:number,joinId:server.joinId,sourceAt:server.sourceAt,status:'prepared_not_connected'};
}

function createLocalLauncher({root,platform=process.platform,run=promisify(execFile),spawnProcess=spawn,exists=fs.existsSync,readFile=fs.readFileSync}={}){
 const controller=path.join(root,'bin','WardogsMovement.exe');
 function automaticDiagnostic(binary,capability,flags,label){
  const unavailable=(code,reason)=>({available:false,diagnostic:{code,reason}});
  if(!exists(binary))return unavailable('binary_missing',`Falta el ${label}. Vuelve a extraer el portable completo.`);
  let contents;
  try{contents=readFile(path.join(root,'bin',capability),'utf8');}
  catch(error){return unavailable(error.code==='ENOENT'?'capabilities_missing':'capabilities_unreadable',error.code==='ENOENT'?`Falta la verificación del ${label}. Vuelve a extraer el portable completo.`:`No se puede leer la verificación del ${label}. Revisa los archivos del portable.`);}
  let cap;try{cap=JSON.parse(contents);}catch{return unavailable('capabilities_invalid_json',`La verificación del ${label} no es JSON válido. Vuelve a extraer el portable completo.`);}
  if(!cap||typeof cap!=='object'||Array.isArray(cap)||flags.some(flag=>cap[flag]!==true)||typeof cap.sha256!=='string'||!/^[a-f0-9]{64}$/.test(cap.sha256))return unavailable('capabilities_invalid',`La verificación del ${label} está incompleta o no es válida. Vuelve a extraer el portable completo.`);
  let hash;try{hash=crypto.createHash('sha256').update(readFile(binary)).digest('hex');}catch{return unavailable('binary_unreadable',`No se puede leer el ${label} para comprobarlo. Revisa los archivos del portable.`);}
  if(cap.sha256!==hash)return unavailable('hash_mismatch',`El ${label} no coincide con su archivo de verificación. Vuelve a extraer el portable completo.`);
  if(!exists(path.join(root,'bin','WardogsImageText.exe')))return unavailable('reader_missing','Falta el lector de pantalla de Wardogs. Vuelve a extraer el portable completo.');
  return {available:true,diagnostic:{code:'ready',reason:`El ${label} está verificado.`}};
 }
 function availability(){
  if(platform!=='win32'){const unavailable={code:'unsupported_platform',reason:'Esta función necesita Windows.'};return {game:false,movement:false,automaticMovement:false,automaticEntry:false,diagnostics:{game:{...unavailable},movement:{...unavailable},automaticMovement:{...unavailable},automaticEntry:{...unavailable}}};}
  const movement=exists(controller),automaticMovement=automaticDiagnostic(controller,'movement-capabilities.json',['automaticMovement'],'controlador de movimiento'),automaticEntry=automaticDiagnostic(path.join(root,'bin','WardogsEntry.exe'),'entry-capabilities.json',['automaticEntry','stopWatcher'],'controlador de entrada automática');
  return {game:true,movement,automaticMovement:automaticMovement.available,automaticEntry:automaticEntry.available,diagnostics:{game:{code:'ready',reason:'Windows permite solicitar la apertura de Steam.'},movement:movement?{code:'ready',reason:'El archivo del controlador de movimiento está presente.'}:{code:'binary_missing',reason:'Falta el controlador de movimiento. Vuelve a extraer el portable completo.'},automaticMovement:automaticMovement.diagnostic,automaticEntry:automaticEntry.diagnostic}};
 }
 async function openGame(){
  if(platform!=='win32')throw Error('La apertura del juego requiere Windows.');
  // Fixed application URI; no server ID or browser-supplied command reaches a shell.
  await run('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',"Start-Process -FilePath '"+STEAM_URI+"'"],{cwd:root,windowsHide:true,timeout:15000});
 }
 async function openMovement(background=false){
  if(!availability().movement)throw Error('Compila primero el control de movimiento con npm run build:movement.');
  await new Promise((resolve,reject)=>{
   const child=spawnProcess(controller,background?['--background']:[],{cwd:root,windowsHide:background,stdio:'ignore',detached:true});
   child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
  });
 }
 return {availability,openGame,openMovement:()=>openMovement(false),openMovementBackground:()=>openMovement(true)};
}
module.exports={connectionTarget,createLocalLauncher,STEAM_URI};
