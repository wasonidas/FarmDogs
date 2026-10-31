'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createObserver}=require('../src/server.cjs');
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'farmdogs-update-api-')),calls=[];
 let update={status:'idle',enabled:true,currentVersion:'0.4.0',latestVersion:null,available:false,busy:false,reason:'Preparado.'};
 const appUpdate={view:()=>({...update}),setEnabled(value){if(typeof value!=='boolean')throw Error('Ajuste no válido.');calls.push('config');update={...update,enabled:value};},async check(){calls.push('check');update={...update,status:'up_to_date',latestVersion:'0.4.0',reason:'Última versión.'};},async install(){calls.push('install');},async tick(){calls.push('tick');},close(){calls.push('close');}};
 const service=createObserver({port:0,dataDir:dir,autoUpdate:false,appUpdate,utcNow:()=>Date.parse('2026-10-31T17:00:00Z'),fetchImpl:async()=>Response.json({configured:true,servers:[]}),launcher:{availability:()=>({game:true,movement:false,automaticMovement:false}),openGame:async()=>{throw Error('No debe abrirse.');}}});
 const url=await service.ready;t.after(async()=>{await service.close();const relative=path.relative(os.tmpdir(),dir);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(dir).startsWith('farmdogs-update-api-'));await fs.rm(dir,{recursive:true,force:true});});
 const state=async()=>fetch(url+'/api/state').then(r=>r.json());
 const post=async(route,input={},headers={})=>{const s=await state();return fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':s.token,...headers},body:JSON.stringify(input)});};
 return {service,state,post,calls,installing(){update={...update,status:'installing'};}};
}
test('API actualización: identidad local, consentimiento persistente y comprobación manual sin cerrar la app',async t=>{
 const f=await fixture(t);let s=await f.state();assert.equal(s.version,require('../package.json').version);assert.equal(s.installationRoot,path.resolve(__dirname,'..'));assert.equal(s.update.enabled,true);
 assert.equal((await f.post('/api/update/config',{enabled:false},{'X-Session-Token':'bad'})).status,403);
 assert.equal((await f.post('/api/update/check',{}, {Origin:'https://untrusted.example'})).status,403);assert.deepEqual(f.calls,[]);
 assert.equal((await f.post('/api/update/config',{enabled:'false'})).status,400);assert.equal((await f.post('/api/update/config',{enabled:false})).status,200);assert.equal((await f.state()).update.enabled,false);
 assert.equal((await f.post('/api/update/check')).status,200);s=await f.state();assert.equal(s.update.status,'up_to_date');assert.equal(s.update.shutdownRequested,false);assert.deepEqual(f.calls,['config','check']);
 await f.service.tick();assert.deepEqual(f.calls,['config','check']);
});
test('API actualización: protege la copia de desarrollo y bloquea nuevos automatismos durante instalación',async t=>{
 const f=await fixture(t);const before=await f.state();assert.equal(before.update.installBlocked,true);assert.match(before.update.installBlockedReason,/copia de desarrollo/);
 assert.equal((await f.post('/api/update/install')).status,400);assert.deepEqual(f.calls,[]);
 f.installing();for(const [route,input]of [['/api/entry/start',{}],['/api/seeding/start',{}],['/api/movement/start',{}],['/api/team-clicker/config',{}],['/api/update/config',{enabled:false}]]){
  const result=await f.post(route,input);assert.equal(result.status,400);assert.match((await result.json()).error,/instalando una actualización/);
 }
 assert.equal((await f.post('/api/seeding/stop')).status,200);assert.equal((await f.post('/api/entry/stop')).status,200);assert.equal((await f.state()).update.shutdownRequested,false);
});
