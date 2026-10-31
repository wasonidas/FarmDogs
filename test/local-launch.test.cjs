const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {connectionTarget,createLocalLauncher,STEAM_URI}=require('../src/local-launch.cjs');
const id='0665a9c0-80b7-4f32-ad47-f36b70367f10';
const row={number:1,name:'[ESP] wardogsspain.com | #1',trusted:true,joinId:id,sourceAt:'2026-10-30T06:00:00Z'};

test('entrada: rechaza una identidad antigua, ajena, desconocida o que ha cambiado',()=>{
 for(const bad of [{...row,trusted:false},{...row,name:'Otra comunidad'},{...row,joinId:'not-a-uuid'}])assert.throws(()=>connectionTarget([bad],1,id));
 assert.throws(()=>connectionTarget([row],6,id));
 assert.throws(()=>connectionTarget([row],1,'otro'),/cambiado/);
 const target=connectionTarget([row],1,id);assert.equal(target.status,'prepared_not_connected');assert.equal(target.joinId,id);assert.equal(target.connected,undefined);
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
