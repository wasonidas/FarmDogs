const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const {connectionTarget,createLocalLauncher,STEAM_URI}=require('../src/local-launch.cjs');
const {normalizeServers}=require('../src/domain.cjs');
const id='0665a9c0-80b7-4f32-ad47-f36b70367f10';
const row={number:1,name:'[ESP] wardogsspain.com | #1',trusted:true,joinId:id,sourceAt:'2026-10-30T06:00:00Z'};

function capabilityFixture({readError=null}={}){
 const root=path.resolve(os.tmpdir(),'farmdogs-capability-fixture'),file=relative=>path.join(root,relative),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const movement=Buffer.from('new-movement-fixture'),entry=Buffer.from('new-entry-fixture');
 const files=new Map([[file('bin/WardogsMovement.exe'),movement],[file('bin/WardogsEntry.exe'),entry],[file('bin/WardogsImageText.exe'),Buffer.from('reader-fixture')],[file('bin/movement-capabilities.json'),Buffer.from(JSON.stringify({automaticMovement:true,sha256:hash(movement)}))],[file('bin/entry-capabilities.json'),Buffer.from(JSON.stringify({automaticEntry:true,stopWatcher:true,sha256:hash(entry)}))]]);
 const launcher=createLocalLauncher({root,platform:'win32',exists:target=>files.has(target),readFile(target,encoding){if(readError?.(target))throw Object.assign(Error('PRIVATE_ERROR_PATH_OR_TEXT'),{code:'EACCES'});if(!files.has(target))throw Object.assign(Error('Missing fixture'),{code:'ENOENT'});const value=files.get(target);return encoding?value.toString(encoding):value;},run(){throw Error('Availability must not run anything.');},spawnProcess(){throw Error('Availability must not spawn anything.');}});
 return {root,file,files,launcher,movement,entry,hash};
}

test('capacidades: una instalación verificada conserva los booleanos y explica cada capacidad sin arrancar procesos',()=>{
 const fixture=capabilityFixture(),view=fixture.launcher.availability();
 for(const name of ['game','movement','automaticMovement','automaticEntry']){assert.equal(view[name],true);assert.equal(view.diagnostics[name].code,'ready');assert.equal(typeof view.diagnostics[name].reason,'string');assert.ok(view.diagnostics[name].reason.length>0);}
 const diagnostics=JSON.stringify(view.diagnostics);assert.equal(diagnostics.includes(fixture.root),false);assert.equal(diagnostics.includes(fixture.hash(fixture.movement)),false);
});

test('capacidades: binario anterior y verificación nueva bloquean movimiento con motivo preciso y recuperan tras reparar los bytes',()=>{
 const fixture=capabilityFixture();fixture.files.set(fixture.file('bin/WardogsMovement.exe'),Buffer.from('old-running-movement-fixture'));
 const invalid=fixture.launcher.availability();assert.equal(invalid.game,true);assert.equal(invalid.movement,true);assert.equal(invalid.automaticMovement,false);assert.equal(invalid.automaticEntry,true);assert.equal(invalid.diagnostics.automaticMovement.code,'hash_mismatch');assert.match(invalid.diagnostics.automaticMovement.reason,/no coincide/);
 fixture.files.set(fixture.file('bin/WardogsMovement.exe'),fixture.movement);assert.equal(fixture.launcher.availability().automaticMovement,true);assert.equal(fixture.launcher.availability().diagnostics.automaticMovement.code,'ready');
});

test('capacidades: distingue ausencia de binario, archivo de verificación y lector sin debilitar la capacidad independiente',()=>{
 for(const [missing,code]of [['bin/WardogsMovement.exe','binary_missing'],['bin/movement-capabilities.json','capabilities_missing'],['bin/WardogsImageText.exe','reader_missing']]){
  const fixture=capabilityFixture();fixture.files.delete(fixture.file(missing));const view=fixture.launcher.availability();assert.equal(view.automaticMovement,false);assert.equal(view.diagnostics.automaticMovement.code,code,missing);assert.equal(view.movement,missing!=='bin/WardogsMovement.exe');assert.equal(view.automaticEntry,code!=='reader_missing');if(code==='reader_missing')assert.equal(view.diagnostics.automaticEntry.code,code);
 }
});

test('capacidades: JSON inválido, BOM, flags no booleanos y SHA inválidos no se presentan como una actualización en curso',()=>{
 for(const contents of ['not json','\ufeff{"automaticMovement":true}']){
  const fixture=capabilityFixture();fixture.files.set(fixture.file('bin/movement-capabilities.json'),Buffer.from(contents));const view=fixture.launcher.availability();assert.equal(view.automaticMovement,false);assert.equal(view.diagnostics.automaticMovement.code,'capabilities_invalid_json');assert.doesNotMatch(view.diagnostics.automaticMovement.reason,/Actualizando/);
 }
 for(const invalid of [null,[],{},'unexpected',{automaticMovement:'true'},{automaticMovement:true,sha256:'not-a-hash'}]){
  const fixture=capabilityFixture();fixture.files.set(fixture.file('bin/movement-capabilities.json'),Buffer.from(JSON.stringify(invalid)));const view=fixture.launcher.availability();assert.equal(view.automaticMovement,false);assert.equal(view.diagnostics.automaticMovement.code,'capabilities_invalid');assert.equal(view.automaticEntry,true);
 }
 const fixture=capabilityFixture();fixture.files.set(fixture.file('bin/movement-capabilities.json'),Buffer.from(JSON.stringify({automaticMovement:true,sha256:fixture.hash(fixture.movement).toUpperCase()})));assert.equal(fixture.launcher.availability().automaticMovement,false,'la comparación SHA existente no se relaja');
});

test('capacidades: un archivo ilegible tiene motivo estable sin filtrar la excepción ni confundirlo con ausencia',()=>{
 for(const [basename,code]of [['movement-capabilities.json','capabilities_unreadable'],['WardogsMovement.exe','binary_unreadable']]){
  const fixture=capabilityFixture({readError:target=>path.basename(target)===basename}),view=fixture.launcher.availability();assert.equal(view.automaticMovement,false);assert.equal(view.movement,true);assert.equal(view.automaticEntry,true);assert.equal(view.diagnostics.automaticMovement.code,code);assert.doesNotMatch(JSON.stringify(view.diagnostics),/PRIVATE_ERROR_PATH_OR_TEXT/);
 }
});

test('capacidades: entrada automática requiere su propio watcher y SHA y no cambia el movimiento válido',()=>{
 for(const change of ['flag','hash','missing']){
  const fixture=capabilityFixture();if(change==='missing')fixture.files.delete(fixture.file('bin/WardogsEntry.exe'));else fixture.files.set(fixture.file('bin/entry-capabilities.json'),Buffer.from(JSON.stringify({automaticEntry:true,stopWatcher:change!=='flag',sha256:change==='hash'?'0'.repeat(64):fixture.hash(fixture.entry)})));
  const view=fixture.launcher.availability();assert.equal(view.automaticMovement,true);assert.equal(view.automaticEntry,false);assert.equal(view.diagnostics.automaticEntry.code,{flag:'capabilities_invalid',hash:'hash_mismatch',missing:'binary_missing'}[change]);
 }
});

test('capacidades: fuera de Windows devuelve motivos estables sin tocar archivos ni procesos',()=>{
 const forbidden=()=>{throw Error('No filesystem or process access expected.');};
 const view=createLocalLauncher({root:'unused',platform:'linux',exists:forbidden,readFile:forbidden,run:forbidden,spawnProcess:forbidden}).availability();
 for(const name of ['game','movement','automaticMovement','automaticEntry']){assert.equal(view[name],false);assert.equal(view.diagnostics[name].code,'unsupported_platform');}
});

test('entrada: rechaza una identidad antigua, ajena, desconocida o que ha cambiado',()=>{
 for(const bad of [{...row,trusted:false},{...row,trusted:'true'},{...row,joinId:'not-a-uuid'}])assert.throws(()=>connectionTarget([bad],1,id));
 assert.throws(()=>connectionTarget([row],6,id));
 assert.throws(()=>connectionTarget([row],1,'otro'),/cambiado/);
 const target=connectionTarget([row],1,id);assert.equal(target.status,'prepared_not_connected');assert.equal(target.joinId,id);assert.equal(target.connected,undefined);
});

test('entrada: un nombre enteramente distinto no altera la identidad oficial confiable',()=>{
 for(const name of ['Otro título | Nuevo modo','',undefined]){
  const target=connectionTarget([{...row,name}],1,id);assert.equal(target.server,1);assert.equal(target.joinId,id);
  assert.throws(()=>connectionTarget([{...row,name,trusted:false}],1,id),/lectura reciente/);
 }
});

test('entrada: el proveedor calcula confianza y rechaza flags forjados sin configuración o frescura',()=>{
 const now=Date.parse('2026-10-31T18:40:00Z');
 const payload=()=>({configured:true,fetchedAt:now,servers:[{id:3,num:1,name:'Título nuevo sin el nombre anterior',joinId:id,players:5,maxPlayers:100,online:true,configured:true,trusted:true}]});
 const normalized=normalizeServers(payload(),now);assert.equal(normalized[0].trusted,true);assert.equal(connectionTarget(normalized,1,id).joinId,id);
 for(const invalidate of [p=>p.configured=false,p=>p.servers[0].configured=false,p=>p.servers[0].online=false,p=>p.servers[0].stale=true,p=>p.fetchedAt=now-90001]){
  const value=payload();invalidate(value);const rejected=normalizeServers(value,now);assert.equal(rejected[0].trusted,false);assert.throws(()=>connectionTarget(rejected,1,id),/lectura reciente/);
 }
});

test('apertura: el proceso del controlador sigue vivo y completa su trabajo tras salir el panel',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wardogs-launch-test-'));
 const marker=path.join(dir,'finished');
 t.after(async()=>{const relative=path.relative(os.tmpdir(),dir);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:20});});
 const childCode=`setTimeout(()=>{require('node:fs').writeFileSync(${JSON.stringify(marker)},'completed-after-parent-exit');},400);`;
 const parentCode=`const {spawn}=require('node:child_process');const {createLocalLauncher}=require(${JSON.stringify(require.resolve('../src/local-launch.cjs'))});createLocalLauncher({root:${JSON.stringify(dir)},platform:'win32',exists:()=>true,spawnProcess:(file,args,options)=>spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{...options,windowsHide:true})}).openMovement().catch(()=>process.exitCode=1);`;
 const parent=spawn(process.execPath,['-e',parentCode],{windowsHide:true,stdio:'ignore'});
 await new Promise((resolve,reject)=>{parent.once('error',reject);parent.once('exit',code=>code===0?resolve():reject(Error('Launcher parent failed: '+code)));});
 const deadline=Date.now()+3000;let result=null;
 while(Date.now()<deadline){try{result=await fs.readFile(marker,'utf8');break;}catch(error){if(error.code!=='ENOENT')throw error;}await new Promise(resolve=>setTimeout(resolve,25));}
 assert.equal(result,'completed-after-parent-exit');
});

test('apertura: Steam recibe una URI fija sin parametros de servidor o comandos externos',async()=>{
 const calls=[];const launcher=createLocalLauncher({root:process.cwd(),platform:'win32',run:async(...args)=>calls.push(args),exists:()=>true});
 await launcher.openGame();assert.equal(STEAM_URI,'steam://run/1867240');assert.equal(calls.length,1);
 assert.equal(calls[0][0],'powershell.exe');assert.equal(calls[0][1].at(-1),"Start-Process -FilePath 'steam://run/1867240'");
 assert.equal(calls[0][2].windowsHide,true);
});

test('apertura: solo inicia el controlador construido y propaga un fallo de lanzamiento',async()=>{
 const calls=[];let fail=false;
 const launcher=createLocalLauncher({root:process.cwd(),platform:'win32',exists:()=>true,spawnProcess:(...args)=>{calls.push(args);const p=new EventEmitter();p.unref=()=>{};queueMicrotask(()=>p.emit(fail?'error':'spawn',fail?Error('launch failed'):undefined));return p;}});
 await launcher.openMovement();assert.match(calls[0][0],/[\\/]bin[\\/]WardogsMovement\.exe$/);assert.deepEqual(calls[0][1],[]);
 fail=true;await assert.rejects(launcher.openMovement(),/launch failed/);
 const missing=createLocalLauncher({root:process.cwd(),platform:'win32',exists:()=>false});await assert.rejects(missing.openMovement(),/Compila/);
 const unsupported=createLocalLauncher({root:process.cwd(),platform:'linux'});assert.equal(unsupported.availability().game,false);await assert.rejects(unsupported.openGame(),/Windows/);
});
