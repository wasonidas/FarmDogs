'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {classifyGameScreen}=require('./game-screen.cjs');
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const CACHE_FILE=/^(?:read-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.json|game-frame-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.png)$/i;
function normalizeScreen(report,now,directory,{classify=classifyGameScreen}={}){
 const unknown=reason=>({status:'unknown',scene:'unknown',gameForeground:false,reason});
 const unavailableReasons={game_not_foreground:'Pon Wardogs en primer plano para continuar.',unsupported_game_bounds:'La ventana de Wardogs queda fuera de la pantalla. Hay que ajustarla antes de continuar.',game_changed_during_capture:'Wardogs cambió durante la captura. Esperando una pantalla nueva.'};
 const s=report?.source,age=now-Date.parse(s?.capturedAt),end=Date.parse(s?.captureFinishedAt);
 if(report?.format!=='wardogs-image-text-v1'||s?.kind!=='foreground_game'||s.captureMethod!=='foreground_client_screen_copy'||!UUID.test(s.frameId||'')||!Number.isInteger(s.gamePid)||s.gamePid<1||!Number.isSafeInteger(s.window)||s.window<1||!Number.isFinite(age)||age<0||age>5000||!Number.isFinite(end)||end<Date.parse(s.capturedAt)||end-Date.parse(s.capturedAt)>2000)return unknown(unavailableReasons[report?.reason]||report?.reason||'No hay una captura reciente del juego.');
 if(typeof s.path!=='string'||path.dirname(path.resolve(s.path))!==path.resolve(directory)||path.basename(s.path)!=='game-frame-'+s.frameId+'.png')return unknown('Procedencia de captura sin confirmar.');
 const classified=classify(report);
 return {status:'verified_capture',scene:classified.phase,gameForeground:true,gamePid:s.gamePid,gameWindow:s.window,frameId:s.frameId,capturedAt:s.capturedAt,reason:classified.reason,occlusionVerified:false,selectorPending:classified.selectorPending===true,entryConfirmed:classified.entryConfirmed===true,...(classified.phase==='gameplay_hud'&&classified.matchWaiting===true?{matchWaiting:true}:{}),...(classified.phase==='server_restart'&&classified.restartConfirmed===true?{restartConfirmed:true}:{})};
}
function createScreenReader({root,dataDir,run=promisify(execFile),now=Date.now,directory=path.join(dataDir,'screen-monitor'),classify=classifyGameScreen}={}){
 let last=null,busy=false,abort=null,generation=0,lastObservedAt=null;
 const cacheDirectory=path.resolve(directory);
 let evidenceFiles=new Set(),evidenceRestored=false;
 async function retainEvidence(report,file,inventory){
  // Keep one acquired frame for diagnosis when an Alt-Tab produces a burst of
  // unavailable reports. This never feeds view() or renews capture freshness.
  const acquisition=Date.parse(report?.source?.captureFinishedAt);
  if(normalizeScreen(report,acquisition,cacheDirectory,{classify:()=>({phase:'unknown'})}).status!=='verified_capture')return false;
  const image=path.resolve(report.source.path);
  if(inventory&&!inventory.has(image))return false;
  const imageStat=await fs.lstat(image).catch(()=>null);
  if(!imageStat?.isFile()||imageStat.isSymbolicLink())return false;
  evidenceFiles=new Set([file,image]);return true;
 }
 async function prune(protectedFiles=new Set()){
  // Inventory survives restarts and includes partial/invalid helper output.
  // Never follow links or descend into other directories while pruning.
  const ownDirectory=await fs.lstat(cacheDirectory).catch(()=>null);
  if(!ownDirectory?.isDirectory()||ownDirectory.isSymbolicLink())return;
  const files=[];
  for(const entry of await fs.readdir(cacheDirectory,{withFileTypes:true})){
   if(!entry.isFile()||!CACHE_FILE.test(entry.name))continue;
   const file=path.join(cacheDirectory,entry.name),stat=await fs.lstat(file).catch(()=>null);
   if(stat?.isFile()&&!stat.isSymbolicLink())files.push({file,modified:stat.mtimeMs,size:stat.size});
  }
  if(!evidenceRestored){
   const inventory=new Set(files.map(row=>row.file));
   const reports=files.filter(row=>path.extname(row.file)==='.json'&&row.size<=262144).sort((a,b)=>b.modified-a.modified);
   for(const row of reports){
    const text=await fs.readFile(row.file,'utf8').catch(()=>null);
    if(!text||text.length>262144)continue;
    try{if(await retainEvidence(JSON.parse(text),row.file,inventory))break;}catch{}
   }
   evidenceRestored=true;
  }
  const priority=file=>protectedFiles.has(file)?2:evidenceFiles.has(file)?1:0;
  files.sort((a,b)=>priority(b.file)-priority(a.file)||b.modified-a.modified||a.file.localeCompare(b.file));
  for(const {file} of files.slice(8)){
   const stat=await fs.lstat(file).catch(()=>null);
   if(stat?.isFile()&&!stat.isSymbolicLink())await fs.unlink(file).catch(()=>{});
  }
 }
 function view(){const age=now()-(last?.status==='unknown'?lastObservedAt:Date.parse(last?.capturedAt));if(!last||!Number.isFinite(age)||age<0||age>5000)return {status:'unknown',scene:'unknown',gameForeground:false,reason:'Esperando una captura actual del juego.'};return {...last};}
 async function refresh(){
  if(busy)return;busy=true;abort=new AbortController();const currentGeneration=generation;
  const file=path.join(cacheDirectory,'read-'+randomUUID()+'.json'),protectedFiles=new Set([file]);
  try{
   await fs.mkdir(cacheDirectory,{recursive:true});
   const ownDirectory=await fs.lstat(cacheDirectory);
   if(!ownDirectory.isDirectory()||ownDirectory.isSymbolicLink())throw Error('Directorio de captura sin confirmar.');
   await prune(protectedFiles);
   if(currentGeneration!==generation)return;
   await run(path.join(root,'bin','WardogsImageText.exe'),['--foreground-game',file],{cwd:root,windowsHide:true,timeout:8000,signal:abort.signal});
   const text=await fs.readFile(file,'utf8');if(text.length>262144)throw Error('Lectura demasiado grande.');
   const report=JSON.parse(text);if(currentGeneration===generation){last=normalizeScreen(report,now(),directory,{classify});lastObservedAt=now();}
   const image=report?.source?.path;
   if(typeof image==='string'&&path.dirname(path.resolve(image))===cacheDirectory&&/^game-frame-/i.test(path.basename(image))&&CACHE_FILE.test(path.basename(image)))protectedFiles.add(path.resolve(image));
   await retainEvidence(report,file);
  }catch{if(currentGeneration===generation){last={status:'unknown',scene:'unknown',gameForeground:false,reason:'No se pudo leer una pantalla actual del juego.'};lastObservedAt=now();}}
  finally{await prune(protectedFiles).catch(()=>{});busy=false;abort=null;}
 }
 function stop(){generation++;if(abort)abort.abort();last=null;lastObservedAt=null;}
 return {refresh,view,stop,get busy(){return busy;}};
}
module.exports={createScreenReader,normalizeScreen};
