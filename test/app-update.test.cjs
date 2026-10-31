'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fsp=fs.promises;
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {createAppUpdate,compareVersions,parseRelease,allowedUrl}=require('../src/app-update.cjs');
const API='https://api.github.com/repos/wasonidas/FarmDogs/releases/latest';
const BASE='https://github.com/wasonidas/FarmDogs/releases/download/v0.4.0/';
const ZIP=Buffer.from('Harmless archive fixture. Native ZIP validation is tested separately; this is never executed.');
const SHA=crypto.createHash('sha256').update(ZIP).digest('hex');
const SUM=SHA+'  FarmDogs-portable.zip\n';
function release(version='0.4.0'){
 const base='https://github.com/wasonidas/FarmDogs/releases/download/v'+version+'/';
 return {tag_name:'v'+version,html_url:'https://github.com/wasonidas/FarmDogs/releases/tag/v'+version,draft:false,prerelease:false,assets:[{name:'FarmDogs-portable.zip',size:ZIP.length,browser_download_url:base+'FarmDogs-portable.zip',digest:'sha256:'+SHA},{name:'SHA256SUMS.txt',size:Buffer.byteLength(SUM),browser_download_url:base+'SHA256SUMS.txt'}]};
}
async function fixture(t,{stageInside=false}={}){
 const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'farmdogs-update-node-')),root=path.join(directory,'app'),data=path.join(root,'data'),updates=path.join(stageInside?root:directory,'updates');
 await fsp.mkdir(path.join(root,'bin'),{recursive:true});await fsp.writeFile(path.join(root,'package.json'),JSON.stringify({version:'0.3.0'}));await fsp.writeFile(path.join(root,'bin','FarmDogsUpdater.exe'),'trusted local updater fixture, never run');
 let utc=Date.parse('2026-10-31T16:00:00Z'),busy=false,metadata=release(),verifyCalls=0;
 const requests=[],actions=[],hooks={};
 const fetchImpl=async(url,options)=>{
  requests.push({url:String(url),options});if(hooks.fetch)return hooks.fetch(String(url),options);
  if(String(url)===API)return Response.json(metadata);
  if(String(url)===BASE+'SHA256SUMS.txt')return new Response(SUM);
  if(String(url)===BASE+'FarmDogs-portable.zip')return new Response(ZIP);
  throw Error('Unexpected URL in isolated update test: '+url);
 };
 const updater=createAppUpdate({root,dataDir:data,updateRoot:updates,now:()=>utc,fetchImpl,getBusy:()=>busy,
  verifyPackage:async plan=>{verifyCalls++;actions.push('verify');if(hooks.verify)return hooks.verify(plan);const packageDirectory=path.join(plan.stage,'package','FarmDogs');await fsp.mkdir(packageDirectory,{recursive:true});return {verified:true,version:plan.version,packageDirectory,files:49};},
  prepareShutdown:async value=>{actions.push(value.phase);if(hooks.shutdown)return hooks.shutdown(value);return {processes:[{pid:12345,executablePath:path.join(root,'bin','runtime','node.exe')}]};},
  launchWorker:async(worker,planFile)=>{actions.push('launch');if(hooks.launch)return hooks.launch(worker,planFile);return {pid:54321};}
 });
 t.after(async()=>{updater.close();const relative=path.relative(path.resolve(os.tmpdir()),directory);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(directory).startsWith('farmdogs-update-node-'));await fsp.rm(directory,{recursive:true,force:true});});
 return {updater,root,data,updates,requests,actions,hooks,setBusy:value=>busy=value,setRelease:value=>metadata=value,advance:ms=>utc+=ms,get verifications(){return verifyCalls;},async staged(){const children=await fsp.readdir(updates);return children.map(name=>path.join(updates,name));}};
}

test('actualizador: compara semver numérica y rechaza versiones o destinos ajenos',()=>{
 assert.equal(compareVersions('0.10.0','0.4.99'),1);assert.equal(compareVersions('1.0.0','1.0.0'),0);assert.equal(compareVersions('0.3.0','0.4.0'),-1);
 for(const value of ['01.4.0','0.4.0-beta','v0.4.0','1.2','999999999.0.0'])assert.throws(()=>compareVersions(value,'0.3.0'));
 for(const url of ['http://github.com/a','https://github.com.evil.test/a','https://user:pass@github.com/a','https://evil.test/a','https://api.github.com:444/a','file:///tmp/a'])assert.throws(()=>allowedUrl(url));
 assert.equal(allowedUrl('https://release-assets.githubusercontent.com/github-production-release-asset/a?token=temporary').protocol,'https:');
 for(const alter of [r=>r.draft=true,r=>r.prerelease=true,r=>r.html_url='https://github.com/else/FarmDogs/releases/tag/v0.4.0',r=>r.assets=[],r=>r.assets.push(r.assets[0]),r=>r.assets[0].size=129*1024*1024,r=>r.assets[0].browser_download_url='https://evil.test/a',r=>r.assets[0].digest='md5:old']){const r=release();alter(r);assert.throws(()=>parseRelease(r,'0.3.0'));}
});

test('actualizador: predeterminado automático, versión igual o anterior no descarga ni instala',async t=>{
 const f=await fixture(t);assert.equal(f.updater.view().enabled,true);
 f.setRelease(release('0.3.0'));await f.updater.tick();assert.equal(f.updater.view().status,'up_to_date');assert.equal(f.requests.length,1);assert.deepEqual(f.actions,[]);
 f.setRelease(release('0.2.99'));await f.updater.check();assert.equal(f.updater.view().status,'up_to_date');assert.deepEqual(f.actions,[]);
 f.updater.setEnabled(false);assert.equal(JSON.parse(await fsp.readFile(path.join(f.data,'app-update-settings.json'))).enabled,false);f.advance(3600000);await f.updater.tick();assert.equal(f.requests.length,2);
});

test('actualizador: descarga fuera de app y verifica SHA antes del manifiesto, sin ejecutar el ZIP',async t=>{
 const f=await fixture(t);await f.updater.check();const state=f.updater.view();assert.equal(state.status,'available');assert.equal(state.latestVersion,'0.4.0');assert.equal(f.verifications,1);assert.deepEqual(f.actions,['verify']);
 const [stage]=await f.staged();assert.equal(path.dirname(stage),f.updates);assert.equal(path.relative(f.root,stage).startsWith('..'),true);assert.deepEqual(await fsp.readFile(path.join(stage,'FarmDogs-portable.zip')),ZIP);
 assert.ok(f.requests.every(request=>request.options.redirect==='manual'));assert.ok(f.requests.every(request=>!request.options.headers.Authorization));
 assert.equal(await fsp.stat(path.join(f.root,'bin','FarmDogsUpdater.exe')).then(s=>s.isFile()),true);assert.equal(fs.existsSync(path.join(f.data,'webview-profile')),false);
});

test('actualizador: staging dentro de la aplicación se rechaza antes de escribir el ZIP',async t=>{
 const f=await fixture(t,{stageInside:true});await assert.rejects(f.updater.check(),/fuera de FarmDogs/);assert.equal(fs.existsSync(f.updates),false);assert.equal(f.verifications,0);
});

test('actualizador: conserva la ruta Win32 comprobada aunque realpath nativo asíncrono exponga un alias de paquete',async t=>{
 const f=await fixture(t);let nativeCalls=0;
 t.mock.method(fsp,'realpath',async value=>{nativeCalls++;return path.join(path.dirname(f.updates),'PackagedApp-LocalCache',path.basename(value));});
 await f.updater.check();assert.equal(f.updater.view().status,'available');assert.equal(f.verifications,1);
 const [stage]=await f.staged();assert.equal(path.dirname(stage),fs.realpathSync(f.updates));assert.equal(nativeCalls,0);
 assert.equal(fs.existsSync(path.join(path.dirname(f.updates),'PackagedApp-LocalCache')),false);
});

test('actualizador: se difiere mientras haya automatismo y se instala una sola vez al quedar libre',async t=>{
 const f=await fixture(t);f.setBusy(true);await f.updater.tick();assert.equal(f.requests.length,0);
 await f.updater.check();await assert.rejects(f.updater.install(),/automatismo/);assert.equal(f.actions.includes('launch'),false);
 f.setBusy(false);await f.updater.tick();assert.equal(f.updater.view().status,'installing');assert.deepEqual(f.actions,['verify','prepare','launch','commit']);
 const [stage]=await f.staged(),plan=JSON.parse(await fsp.readFile(path.join(stage,'install-plan.json')));
 assert.equal(plan.processes[0].pid,12345);assert.equal(plan.sha256,SHA);assert.equal(plan.version,'0.4.0');assert.ok(/^[a-f0-9]{64}$/.test(plan.workerSha256));
 await f.updater.tick();await assert.rejects(f.updater.install());await assert.rejects(f.updater.check(),/instalando/);assert.equal(f.actions.filter(a=>a==='launch').length,1);
});

test('actualizador: cambio a ocupado durante preparación impide lanzar el worker',async t=>{
 const f=await fixture(t);await f.updater.check();f.hooks.shutdown=async value=>{if(value.phase==='prepare')f.setBusy({busy:true,reason:'Selección de equipo activa'});return {};};
 await assert.rejects(f.updater.install(),/automatismo/);assert.equal(f.actions.includes('launch'),false);assert.equal(f.updater.view().status,'available');
});

test('actualizador: fallos de SHA, tamaño o manifiesto nunca ejecutan el instalador',async t=>{
 for(const scenario of ['digest','checksum','size','manifest'])await t.test(scenario,async child=>{
  const f=await fixture(child);if(scenario==='digest'){const r=release();r.assets[0].digest='sha256:'+ '0'.repeat(64);f.setRelease(r);}
  if(scenario==='checksum')f.hooks.fetch=async url=>url===API?Response.json(release()):url.endsWith('SHA256SUMS.txt')?new Response('0'.repeat(64)+'  FarmDogs-portable.zip'):new Response(ZIP);
  if(scenario==='size'){const r=release();r.assets[0].size++;f.setRelease(r);}
  if(scenario==='manifest')f.hooks.verify=async()=>({verified:false,version:'0.4.0',files:49,packageDirectory:'/untrusted'});
  await assert.rejects(f.updater.check());assert.equal(f.updater.view().status,'error');assert.equal(f.actions.includes('launch'),false);if(scenario!=='manifest')assert.equal(f.verifications,0);
 });
});

test('actualizador: bloquea redirecciones HTTP/ajenas y permite CDN HTTPS de GitHub',async t=>{
 for(const location of ['http://github.com/file','https://evil.test/file','https://github.com.evil.test/file'])await t.test(location,async child=>{
  const f=await fixture(child);f.hooks.fetch=async url=>url===API?Response.json(release()):url.endsWith('SHA256SUMS.txt')?new Response(SUM):new Response(null,{status:302,headers:{Location:location}});
  await assert.rejects(f.updater.check(),/Origen/);assert.equal(f.verifications,0);assert.equal(f.requests.some(r=>r.url===location),false);
 });
 const f=await fixture(t);f.hooks.fetch=async url=>url===API?Response.json(release()):url.endsWith('SHA256SUMS.txt')?new Response(SUM):url.startsWith(BASE)?new Response(null,{status:302,headers:{Location:'https://release-assets.githubusercontent.com/fixture/archive'}}):new Response(ZIP);await f.updater.check();assert.equal(f.updater.view().status,'available');assert.equal(f.verifications,1);
});

test('actualizador: fallo de launch permite reintento, fallo de cierre posterior no duplica worker',async t=>{
 const f=await fixture(t);await f.updater.check();let fail=true;f.hooks.launch=async()=>{if(fail)throw Error('Launch fixture failure');};
 await assert.rejects(f.updater.install(),/failure/);assert.equal(f.updater.view().status,'available');fail=false;await f.updater.install();assert.equal(f.updater.view().status,'installing');assert.equal(f.actions.filter(v=>v==='commit').length,1);
 const second=await fixture(t);await second.updater.check();second.hooks.shutdown=async value=>{if(value.phase==='commit')throw Error('Close fixture failure');return {};};await assert.rejects(second.updater.install(),/failure/);await second.updater.tick();assert.equal(second.actions.filter(v=>v==='launch').length,1);assert.equal(second.updater.view().status,'installing');
});

test('actualizador: no repite descarga automática corrupta de la misma versión, búsqueda manual sí puede recuperar',async t=>{
 const f=await fixture(t);f.hooks.verify=async()=>{throw Error('Manifest fixture failure');};await f.updater.tick();assert.equal(f.verifications,1);f.advance(3600000);await f.updater.tick();assert.equal(f.verifications,1);assert.equal(f.updater.view().status,'error');
 f.hooks.verify=null;await f.updater.check();assert.equal(f.verifications,2);assert.equal(f.updater.view().status,'available');
});

test('actualizador: un fallo temporal de descarga no bloquea esa versión en futuras búsquedas automáticas',async t=>{
 const f=await fixture(t);let unavailable=true;
 f.hooks.fetch=async url=>url===API?Response.json(release()):url===BASE+'SHA256SUMS.txt'?new Response(SUM):url===BASE+'FarmDogs-portable.zip'?unavailable?new Response('Temporal',{status:503}):new Response(ZIP):Promise.reject(Error('URL inesperada'));
 await f.updater.tick();assert.equal(f.updater.view().status,'error');assert.equal(f.verifications,0);
 unavailable=false;f.advance(3600001);await f.updater.tick();assert.equal(f.updater.view().status,'available');assert.equal(f.verifications,1);
 assert.equal(f.requests.filter(request=>request.url===BASE+'FarmDogs-portable.zip').length,2);
});

test('actualizador: desactivar evita instalación automática, cierre no autoriza otra operación',async t=>{
 const f=await fixture(t);await f.updater.check();f.updater.setEnabled(false);await f.updater.tick();assert.equal(f.actions.includes('launch'),false);f.updater.close();await assert.rejects(f.updater.install(),/verifica|cerrado/);await f.updater.tick();assert.equal(f.actions.includes('launch'),false);
});

test('actualizador: desactivar mientras prepara una instalación automática evita abrir el worker',async t=>{
 const f=await fixture(t);await f.updater.check();f.hooks.shutdown=async value=>{if(value.phase==='prepare')f.updater.setEnabled(false);return {};};await f.updater.tick();
 assert.equal(f.updater.view().enabled,false);assert.equal(f.updater.view().status,'available');assert.equal(f.actions.includes('launch'),false);
});

test('actualizador nativo: ZIP y transacción se prueban en temporales, sin red ni relanzamiento',t=>{
 if(process.platform!=='win32'){t.skip('El componente nativo se compila en Windows.');return;}
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'farmdogs-updater-compile-')),compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 try{
  const binary=path.join(directory,'AppUpdaterTests.exe');
  execFileSync(compiler,['/nologo','/nowarn:0649','/codepage:65001','/platform:x64','/target:exe','/main:AppUpdaterTests','/r:System.Web.Extensions.dll','/r:System.IO.Compression.dll','/r:System.IO.Compression.FileSystem.dll','/out:'+binary,path.resolve('native/AppUpdater.cs'),path.resolve('native/AppUpdaterTests.cs')],{windowsHide:true,timeout:30000});
  const output=execFileSync(binary,[],{windowsHide:true,encoding:'utf8',timeout:30000});assert.match(output,/93 comprobaciones/);
 }finally{const relative=path.relative(path.resolve(os.tmpdir()),directory);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(directory).startsWith('farmdogs-updater-compile-'));fs.rmSync(directory,{recursive:true,force:true});}
});
