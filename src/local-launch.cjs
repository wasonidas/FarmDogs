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

function createLocalLauncher({root,platform=process.platform,run=promisify(execFile),spawnProcess=spawn,exists=fs.existsSync}={}){
 const controller=path.join(root,'bin','WardogsMovement.exe');
 function availability(){let automaticMovement=false,automaticEntry=false;try{const cap=JSON.parse(fs.readFileSync(path.join(root,'bin','movement-capabilities.json'),'utf8'));automaticMovement=cap.automaticMovement===true&&cap.sha256===crypto.createHash('sha256').update(fs.readFileSync(controller)).digest('hex')&&exists(path.join(root,'bin','WardogsImageText.exe'));}catch{}try{const cap=JSON.parse(fs.readFileSync(path.join(root,'bin','entry-capabilities.json'),'utf8'));automaticEntry=cap.automaticEntry===true&&cap.stopWatcher===true&&cap.sha256===crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'bin','WardogsEntry.exe'))).digest('hex')&&exists(path.join(root,'bin','WardogsImageText.exe'));}catch{}return {game:platform==='win32',movement:platform==='win32'&&exists(controller),automaticMovement:platform==='win32'&&automaticMovement,automaticEntry:platform==='win32'&&automaticEntry};}
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
