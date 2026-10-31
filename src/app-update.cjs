'use strict';
const fs=require('node:fs');
const fsp=fs.promises;
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {atomicJson,readJson}=require('./store.cjs');
const REPOSITORY='wasonidas/FarmDogs';
const RELEASE_URL='https://api.github.com/repos/'+REPOSITORY+'/releases/latest';
const MAX_ARCHIVE=128*1024*1024;
const VERSION=/^(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})$/;
const SHA=/^[a-f0-9]{64}$/i;
function compareVersions(a,b){
 if(!VERSION.test(a||'')||!VERSION.test(b||''))throw Error('Versión estable no válida.');
 const left=a.split('.').map(Number),right=b.split('.').map(Number);
 for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]>right[i]?1:-1;
 return 0;
}
function allowedUrl(value){
 const u=new URL(value),host=u.hostname.toLowerCase();
 if(u.protocol!=='https:'||u.username||u.password||u.hash||(u.port&&u.port!=='443')||!(host==='api.github.com'||host==='github.com'||host.endsWith('.githubusercontent.com')))throw Error('Origen de actualización no admitido.');
 return u;
}
function readVersion(root){
 const manifest=readJson(path.join(root,'manifest.json'));
 const version=manifest?.application==='FarmDogs'&&manifest?.format==='wardogs-portable-v1'?manifest.version:readJson(path.join(root,'package.json'))?.version;
 if(!VERSION.test(version||''))throw Error('No se puede comprobar la versión instalada de FarmDogs.');
 return version;
}
function parseRelease(release,currentVersion){
 if(!release||release.draft!==false||release.prerelease!==false||!/^v/.test(release.tag_name||''))throw Error('GitHub no devolvió una versión estable publicada.');
 const version=release.tag_name.slice(1);compareVersions(version,currentVersion);
 const releaseUrl='https://github.com/'+REPOSITORY+'/releases/tag/v'+version;
 if(release.html_url!==releaseUrl||!Array.isArray(release.assets))throw Error('La publicación no corresponde al repositorio de FarmDogs.');
 if(compareVersions(version,currentVersion)<=0)return {version,newer:false,releaseUrl};
 const matches=name=>release.assets.filter(asset=>asset?.name===name),archives=matches('FarmDogs-portable.zip'),sums=matches('SHA256SUMS.txt');
 if(archives.length!==1||sums.length!==1)throw Error('La publicación todavía no tiene ZIP y suma únicos.');
 const archive=archives[0],checksum=sums[0],base='https://github.com/'+REPOSITORY+'/releases/download/v'+version+'/';
 if(archive.browser_download_url!==base+'FarmDogs-portable.zip'||checksum.browser_download_url!==base+'SHA256SUMS.txt'||!Number.isInteger(archive.size)||archive.size<1||archive.size>MAX_ARCHIVE||!Number.isInteger(checksum.size)||checksum.size<1||checksum.size>4096)throw Error('Los adjuntos de la actualización no son válidos.');
 if(archive.digest!==undefined&&archive.digest!==null&&!/^sha256:[a-f0-9]{64}$/i.test(archive.digest))throw Error('La suma del adjunto no es SHA-256.');
 return {version,newer:true,releaseUrl,archiveUrl:archive.browser_download_url,checksumUrl:checksum.browser_download_url,archiveBytes:archive.size,digest:archive.digest?.slice(7).toLowerCase()||null};
}
function within(root,file){const relative=path.relative(path.resolve(root),path.resolve(file));return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);}
function createAppUpdate({root,dataDir,now=Date.now,event=()=>{},fetchImpl=fetch,getBusy=()=>false,prepareShutdown=async()=>({}),launchWorker,verifyPackage,updateRoot=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'FarmDogs','updates')}={}){
 root=path.resolve(root);dataDir=path.resolve(dataDir||path.join(root,'data'));updateRoot=path.resolve(updateRoot);
 const settingsFile=path.join(dataDir,'app-update-settings.json'),binary=path.join(root,'bin','FarmDogsUpdater.exe');
 const saved=readJson(settingsFile,{enabled:true});
 let enabled=saved?.enabled!==false,currentVersion=null,currentError=null;
 try{currentVersion=readVersion(root);}catch(error){currentError=error.message;}
 let state={status:currentError?'error':'idle',reason:currentError||'Actualizaciones automáticas activadas; se instalarán cuando FarmDogs esté inactivo.',currentVersion,latestVersion:null,checkedAt:null,downloadedBytes:0};
 let operation=null,closed=false,nextCheck=now(),staged=null,abort=null,failedVersion=null;
 const emit=(kind,detail)=>{try{event(kind,detail);}catch{}};
 const set=(status,reason,extra={})=>{const changed=state.status!==status;state={...state,status,reason,...extra};if(changed)emit('app_update_state',{status,version:state.latestVersion});};
 const view=()=>({...state,enabled,repository:'https://github.com/'+REPOSITORY,available:!!staged&&state.status!=='installing',busy:!!operation,stagedVersion:staged?.release.version||null});
 function busy(){try{const value=getBusy();return typeof value==='boolean'?{busy:value,reason:'Hay un automatismo o una programación activa.'}:{busy:value?.busy!==false,reason:value?.reason||'No se pudo confirmar que FarmDogs esté inactivo.'};}catch{return {busy:true,reason:'No se pudo comprobar si FarmDogs está inactivo.'};}}
 function setEnabled(value){if(typeof value!=='boolean')throw Error('Indica si quieres actualizaciones automáticas.');enabled=value;atomicJson(settingsFile,{enabled});if(!operation&&!staged)set(enabled?'idle':'disabled',enabled?'Se buscarán e instalarán nuevas versiones cuando FarmDogs esté inactivo.':'Actualizaciones automáticas desactivadas. Puedes buscar e instalar manualmente.');nextCheck=now();return view();}
 async function request(url,signal){
  let target=allowedUrl(url);
  for(let redirects=0;redirects<=5;redirects++){
   const response=await fetchImpl(target.href,{redirect:'manual',headers:{Accept:target.hostname==='api.github.com'?'application/vnd.github+json':'application/octet-stream','User-Agent':'FarmDogs-Updater'},signal});
   if([301,302,303,307,308].includes(response.status)){
    const location=response.headers.get('location');if(!location)throw Error('Redirección de descarga incompleta.');
    await response.body?.cancel?.();target=allowedUrl(new URL(location,target).href);continue;
   }
   if(!response.ok)throw Error('GitHub responde HTTP '+response.status+'.');return response;
  }
  throw Error('Demasiadas redirecciones en la actualización.');
 }
 async function receive(url,max,signal,file=null,expectedBytes=null){
  const response=await request(url,signal),length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>max))throw Error('La descarga supera el tamaño permitido.');
  const hash=crypto.createHash('sha256'),chunks=[];let total=0,handle=null;
  try{
   if(file)handle=await fsp.open(file,'wx');
   if(!response.body)throw Error('La descarga está vacía.');
   for await(const chunk of response.body){
    if(closed||signal.aborted)throw Error('Actualización interrumpida.');const bytes=Buffer.from(chunk);total+=bytes.length;
    if(total>max)throw Error('La descarga supera el tamaño permitido.');hash.update(bytes);
    if(handle){await handle.writeFile(bytes);state={...state,downloadedBytes:total};}else chunks.push(bytes);
   }
   if(expectedBytes!==null&&total!==expectedBytes)throw Error('El tamaño de la descarga no coincide con GitHub.');
   return {bytes:total,sha256:hash.digest('hex'),text:file?null:Buffer.concat(chunks).toString('utf8')};
  }finally{await handle?.close();}
 }
 async function makeStage(){
  if(within(root,updateRoot)||updateRoot===root)throw Error('La actualización necesita una carpeta fuera de FarmDogs.');
  await fsp.mkdir(updateRoot,{recursive:true});
  let check=updateRoot;
  while(check!==path.dirname(check)){
   const stat=await fsp.lstat(check);if(stat.isSymbolicLink())throw Error('La carpeta de actualizaciones no admite enlaces.');check=path.dirname(check);
  }
  // The native libuv realpath used by promises can expose a packaged app's
  // LocalCache alias on Windows. Keep the checked Win32 path also used by .NET.
  const actual=fs.realpathSync(updateRoot),actualRoot=fs.realpathSync(root);
  if(within(actualRoot,actual)||actual===actualRoot)throw Error('La carpeta de actualizaciones está dentro de FarmDogs.');
  const id=crypto.randomUUID(),stage=path.join(actual,id);await fsp.mkdir(stage);return {id,stage};
 }
 const nativeVerify=verifyPackage||(async plan=>{
  if(!fs.existsSync(binary))throw Error('Falta el instalador de actualizaciones. Descarga el ZIP portable nuevo.');
  const planFile=path.join(plan.stage,'plan.json');atomicJson(planFile,plan);
  await promisify(execFile)(binary,['--verify',planFile],{cwd:root,windowsHide:true,timeout:60000,signal:abort.signal});
  const result=readJson(plan.verificationFile);
  if(result?.verified!==true||result.version!==plan.version||!within(plan.stage,result.packageDirectory||''))throw Error('El paquete no superó la comprobación de su manifiesto.');
  return result;
 });
 async function checkInternal(automaticCheck){
  if(closed)throw Error('El actualizador está cerrado.');
  if(!currentVersion)throw Error(currentError||'Versión instalada desconocida.');
  abort=new AbortController();const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(180000)]);
  set('checking','Buscando una versión estable de FarmDogs.');let rejectedPackage=false;
  try{
   const metadata=await receive(RELEASE_URL,1024*1024,signal);const release=parseRelease(JSON.parse(metadata.text),currentVersion);
   state={...state,latestVersion:release.version,releaseUrl:release.releaseUrl,checkedAt:new Date(now()).toISOString()};nextCheck=now()+3600000;
   if(!release.newer){staged=null;set('up_to_date','Tienes la última versión estable.');return view();}
   if(automaticCheck&&failedVersion===release.version){set('error','La versión '+release.version+' no se pudo verificar. Se esperará otra publicación o una búsqueda manual.');return view();}
   if(staged?.release.version===release.version){set('available','Actualización verificada. Se instalará cuando FarmDogs esté inactivo.');return view();}
   staged=null;
   set('downloading','Descargando FarmDogs '+release.version+'.',{downloadedBytes:0,totalBytes:release.archiveBytes});
   const sum=await receive(release.checksumUrl,4096,signal),match=sum.text.trim().match(/^([a-f0-9]{64})\s+\*?FarmDogs-portable\.zip$/i);
   if(!match||release.digest&&match[1].toLowerCase()!==release.digest){rejectedPackage=true;throw Error('Las sumas publicadas no coinciden.');}
   const location=await makeStage(),archive=path.join(location.stage,'FarmDogs-portable.zip');
   const downloaded=await receive(release.archiveUrl,MAX_ARCHIVE,signal,archive,release.archiveBytes);
   if(downloaded.sha256!==match[1].toLowerCase()){rejectedPackage=true;throw Error('El ZIP descargado no coincide con SHA-256.');}
   const plan={format:'farmdogs-update-plan-v1',id:location.id,root,stage:location.stage,archive,sha256:downloaded.sha256,version:release.version,verificationFile:path.join(location.stage,'verified.json'),resultFile:path.join(location.stage,'result.json'),processes:[]};
   set('verifying','Comprobando rutas, manifiesto y archivos del ZIP.');let verified;try{verified=await nativeVerify(plan);}catch(error){rejectedPackage=true;throw error;}
   if(closed)throw Error('Actualización interrumpida.');
   if(verified?.verified!==true||verified.version!==release.version||!within(plan.stage,verified.packageDirectory||'')||!Number.isInteger(verified.files)||verified.files<1||verified.files>512){rejectedPackage=true;throw Error('El manifiesto de la actualización no es válido.');}
   staged={release,plan,verified};failedVersion=null;set('available','FarmDogs '+release.version+' está verificado y listo para instalar.');return view();
  }catch(error){if(rejectedPackage)failedVersion=state.latestVersion;nextCheck=now()+3600000;set('error',String(error.message||error).slice(0,400));emit('app_update_error',{message:state.reason});throw error;}
  finally{abort=null;}
 }
 async function check({automatic=false}={}){if(state.status==='installing')throw Error('La actualización ya se está instalando.');if(operation)return operation;const pending=checkInternal(automatic);operation=pending;try{return await pending;}finally{if(operation===pending)operation=null;}}
 const startWorker=launchWorker||(async(worker,planFile)=>new Promise((resolve,reject)=>{const child=spawn(worker,['--install',planFile],{cwd:path.dirname(worker),windowsHide:true,detached:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve({pid:child.pid});});}));
 async function installInternal(automaticInstall){
  if(closed||!staged)throw Error('Busca y verifica primero una actualización.');
  if(automaticInstall&&!enabled)throw Error('Actualizaciones automáticas desactivadas.');
  const occupancy=busy();if(occupancy.busy)throw Error(occupancy.reason);
  const candidate=staged;set('installing','Preparando actualización. FarmDogs se cerrará y volverá a abrirse.');
  let workerStarted=false;
  try{
   if(compareVersions(candidate.release.version,readVersion(root))<=0)throw Error('La versión preparada ya no es más reciente.');
   const shutdown=await prepareShutdown({phase:'prepare',plan:structuredClone(candidate.plan)});
   if(closed)throw Error('Actualización interrumpida.');if(busy().busy)throw Error('Se ha iniciado un automatismo; la actualización queda pendiente.');
   if(automaticInstall&&!enabled)throw Error('Actualizaciones automáticas desactivadas.');
   const worker=path.join(candidate.plan.stage,'worker-'+crypto.randomUUID()+'.exe');await fsp.copyFile(binary,worker,fs.constants.COPYFILE_EXCL);
   const workerSha256=crypto.createHash('sha256').update(await fsp.readFile(worker)).digest('hex');
   const processes=Array.isArray(shutdown?.processes)?shutdown.processes:[{pid:process.pid,executablePath:process.execPath}];
   const plan={...candidate.plan,workerSha256,processes},planFile=path.join(plan.stage,'install-plan.json');atomicJson(planFile,plan);
   await startWorker(worker,planFile);
   workerStarted=true;staged=null;
   if(typeof shutdown?.commit==='function')await shutdown.commit();else await prepareShutdown({phase:'commit',plan:structuredClone(plan)});
   emit('app_update_install_started',{version:plan.version});return view();
  }catch(error){set(workerStarted?'installing':'available',workerStarted?'El instalador está esperando el cierre de FarmDogs: '+String(error.message||error).slice(0,300):'No se pudo iniciar la actualización: '+String(error.message||error).slice(0,350));throw error;}
 }
 async function install({automatic=false}={}){if(operation)throw Error('El actualizador está ocupado.');const pending=installInternal(automatic);operation=pending;try{return await pending;}finally{if(operation===pending)operation=null;}}
 async function tick(){
  if(closed||!enabled||operation||state.status==='installing'||busy().busy)return;
  try{if(staged){await install({automatic:true});return;}if(now()>=nextCheck)await check({automatic:true});}catch{}
 }
 function close(){closed=true;abort?.abort();}
 return {view,check,tick,setEnabled,install,close};
}
module.exports={createAppUpdate,compareVersions,parseRelease,allowedUrl};
