const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {ensureObserver}=require('../src/service-start.cjs');
test('inicio de app: reutiliza su servicio y no inicia otro sobre un puerto ocupado o incierto',async()=>{
 let spawns=0;const spawnProcess=()=>spawns++;
 assert.equal((await ensureObserver({fetchImpl:async()=>Response.json({appId:'wardogs-seeding-local-v1'}),spawnProcess})).started,false);
 await assert.rejects(ensureObserver({fetchImpl:async()=>Response.json({appId:'other'}),spawnProcess}),/ocupado/);
 await assert.rejects(ensureObserver({fetchImpl:async()=>{throw Error('timeout');},spawnProcess}),/no se inicia otro/);
 assert.equal(spawns,0);
});
test('inicio de app: arranca una sola instancia oculta e independiente y espera su identidad',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wardogs-service-start-'));
 t.after(async()=>{const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('wardogs-service-start-'));await fs.rm(resolved,{recursive:true,force:true});});
 let requests=0,spawns=0,unref=0,clock=0;
 const result=await ensureObserver({root,now:()=>clock,sleep:async ms=>clock+=ms,fetchImpl:async()=>{if(++requests<3){const error=Error('offline');error.cause={code:'ECONNREFUSED'};throw error;}return Response.json({appId:'wardogs-seeding-local-v1'});},spawnProcess:(exe,args,options)=>{
  spawns++;assert.equal(exe,process.execPath);assert.deepEqual(args,[path.join(root,'src','server.cjs')]);assert.equal(options.windowsHide,true);assert.equal(options.detached,true);
  const child=new EventEmitter();child.unref=()=>unref++;queueMicrotask(()=>child.emit('spawn'));return child;
 }});
 assert.equal(result.started,true);assert.equal(spawns,1);assert.equal(unref,1);
});
