'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createObserver}=require('../src/server.cjs');

async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'farmdogs-static-assets-'));
 const service=createObserver({port:0,dataDir:directory,autoUpdate:false,accountProvider:()=>({available:false}),fetchImpl:async url=>{
  assert.equal(url,'https://api.wardogsspain.com/api/portal/public/wardogs-servers');return Response.json({configured:false,servers:[]});
 }});
 t.after(async()=>{await service.close();const relative=path.relative(os.tmpdir(),directory);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(directory).startsWith('farmdogs-static-assets-'));await fs.rm(directory,{recursive:true,force:true});});
 return service.ready;
}

test('assets launcher: marca PNG, fuente TTF y licencia OFL se sirven íntegros con MIME y nosniff',async t=>{
 const url=await fixture(t);
 for(const [name,type]of [['farmdogs-ai-mark.png','image/png'],['rajdhani-bold.ttf','font/ttf'],['OFL-Rajdhani.txt','text/plain; charset=utf-8']]){
  const response=await fetch(url+'/'+name);assert.equal(response.status,200,name);assert.equal(response.headers.get('content-type'),type);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  const bytes=Buffer.from(await response.arrayBuffer());assert.deepEqual(bytes,await fs.readFile(path.join(__dirname,'..','public',name)),name);
  if(name.endsWith('.png'))assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  if(name.endsWith('.ttf'))assert.equal(bytes.subarray(0,4).toString('hex'),'00010000');
  if(name.endsWith('.txt'))assert.match(bytes.toString('utf8'),/SIL OPEN FONT LICENSE Version 1\.1/);
 }
});

test('assets launcher: nombres parecidos y rutas no incluidas no exponen archivos del workspace',async t=>{
 const url=await fixture(t);
 for(const route of ['/farmdogs-ai-mark.png.js','/rajdhani-bold.woff2','/OFL-Rajdhani.txt.bak','/public/rajdhani-bold.ttf','/data/private.json','/package.json']){
  const response=await fetch(url+route);assert.equal(response.status,404,route);assert.match(response.headers.get('content-type'),/^application\/json/);assert.equal((await response.json()).error,'No encontrado');
 }
});
