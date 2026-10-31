'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');

const ID='11111111-1111-4111-8111-111111111111';
const STEAM_ID='76561198000000000';
const URLS={vip:'https://api.wardogsspain.com/api/cuenta/vip',sedeo:'https://api.wardogsspain.com/api/cuenta/sedeo',identity:'https://api.wardogsspain.com/api/cuenta/yo'};

async function runScript(script,identity,{status=200,failedEndpoint=null,invalidJsonEndpoint=null,timeoutEndpoint=null}={}){
 const calls=[],messages=[],timers=new Map();let timerId=0;
 const body={vip:{prioridad:{activo:true}},sedeo:{estado:'esperando'},identity};
 const context=vm.createContext({
  AbortController,
  setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},
  clearTimeout(id){timers.delete(id);},
  window:{chrome:{webview:{postMessage(message){
   // WebView's bridge sends JSON, so undefined fields are omitted rather than
   // becoming evidence that a field was present in the account response.
   messages.push(JSON.parse(JSON.stringify(message)));
  }}}},
  fetch:async(source,options)=>{
   const endpoint=Object.keys(URLS).find(key=>URLS[key]===source);
   assert.ok(endpoint,'The production script may call only the three fixed account endpoints.');
   calls.push({endpoint,source,options});
   if(endpoint===failedEndpoint)throw Error('private transport detail must not cross the bridge');
   if(endpoint===timeoutEndpoint)return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
   return new Response(endpoint===invalidJsonEndpoint?'not json':JSON.stringify(body[endpoint]),{status:endpoint==='identity'?status:200,headers:{'Content-Type':'application/json'}});
  }
 });
 vm.runInContext(script,context,{filename:'AccountReadScript.Build.js',timeout:1000});
 if(timeoutEndpoint)for(const timer of [...timers.values()])timer.fn();
 for(let turn=0;messages.length<3&&turn<20;turn++)await new Promise(setImmediate);
 assert.equal(messages.length,3,'Each endpoint must report its own result.');
 assert.equal(timers.size,0,'Every request clears its timeout.');
 assert.equal(calls.length,3);
 return {calls,messages,part:endpoint=>messages.find(message=>message.endpoint===endpoint)};
}

test('script de cuenta emitido por C# real: privacidad y contrato de los tres endpoints',{skip:process.platform!=='win32'},async t=>{
 const root=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'farmdogs-account-script-'));
 t.after(()=>{
  const resolved=path.resolve(temporary),parent=path.resolve(os.tmpdir());
  assert.equal(path.dirname(resolved),parent);
  assert.ok(path.basename(resolved).startsWith('farmdogs-account-script-'));
  assert.ok(!fs.lstatSync(resolved).isSymbolicLink());
  fs.rmSync(resolved,{recursive:true,force:true});
 });
 const compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 const probe=path.join(temporary,'NativeAccountScriptProbe.exe');
 execFileSync(compiler,['/nologo','/codepage:65001','/platform:x64','/target:exe','/main:NativeAccountScriptProbe','/r:System.Net.Http.dll','/r:System.Web.Extensions.dll','/out:'+probe,...['DesktopProtocol.cs','AccountReadScript.cs','NativeAccountScriptProbe.cs'].map(name=>path.join(root,'native',name))],{windowsHide:true,timeout:30000});
 const script=execFileSync(probe,[ID],{windowsHide:true,encoding:'utf8',timeout:30000}).replace(/^\uFEFF/,'');

 await t.test('solo proyecta conectado/steamId/equipo permitido y conserva las fuentes, UUID y HTTP',async()=>{
  const f=await runScript(script,{conectado:true,privateRoot:'ROOT_SECRET',token:'ROOT_TOKEN',cuenta:{steamId:STEAM_ID,nombre:'PRIVATE_PLAYER',gestor:true,token:'ACCOUNT_TOKEN',equipo:{slug:'clan-ejemplo',tag:'ABC',nombre:'Clan ejemplo',name:'not selected',gestor:'PRIVATE_MANAGER',token:'TEAM_TOKEN',privateNested:{secret:'NESTED_SECRET'}}}});
  assert.deepEqual(f.part('identity').data,{conectado:true,cuenta:{steamId:STEAM_ID,equipo:{slug:'clan-ejemplo',tag:'ABC',nombre:'Clan ejemplo'}}});
  for(const call of f.calls){assert.equal(call.options.credentials,'include');assert.equal(call.options.cache,'no-store');assert.ok(call.options.signal instanceof AbortSignal);}
  for(const message of f.messages){assert.equal(message.kind,'account_part');assert.equal(message.id,ID);assert.equal(message.source,URLS[message.endpoint]);assert.equal(message.httpStatus,200);}
  assert.deepEqual(f.part('vip').data,{prioridad:{activo:true}});
  assert.deepEqual(f.part('sedeo').data,{estado:'esperando'});
  assert.doesNotMatch(JSON.stringify(f.part('identity')),/SECRET|TOKEN|PRIVATE|gestor|privateNested/);
 });

 await t.test('equipo null es explícito; equipo ausente permanece ausente para estado desconocido',async()=>{
  const explicit=await runScript(script,{conectado:true,cuenta:{steamId:STEAM_ID,equipo:null}});
  const missing=await runScript(script,{conectado:true,cuenta:{steamId:STEAM_ID}});
  assert.equal(Object.hasOwn(explicit.part('identity').data.cuenta,'equipo'),true);
  assert.equal(explicit.part('identity').data.cuenta.equipo,null);
  assert.equal(Object.hasOwn(missing.part('identity').data.cuenta,'equipo'),false);
  assert.deepEqual(missing.part('identity').data,{conectado:true,cuenta:{steamId:STEAM_ID}});
 });

 await t.test('name del clan sirve de nombre sin transmitir otros atributos',async()=>{
  const f=await runScript(script,{conectado:true,cuenta:{steamId:STEAM_ID,equipo:{slug:'ejemplo',tag:'XYZ',name:'Nombre alternativo',gestor:true,token:'PRIVATE_TOKEN'}}});
  assert.deepEqual(f.part('identity').data.cuenta.equipo,{slug:'ejemplo',tag:'XYZ',nombre:'Nombre alternativo'});
 });

 await t.test('401 conserva el código y minimiza identidad desconectada',async()=>{
  const f=await runScript(script,{conectado:false,cuenta:null,token:'PRIVATE_TOKEN',error:'PRIVATE_ERROR'},{status:401});
  assert.deepEqual(f.part('identity'),{kind:'account_part',id:ID,endpoint:'identity',source:URLS.identity,httpStatus:401,data:{conectado:false,cuenta:null}});
  assert.equal(f.part('vip').httpStatus,200);
 });

 await t.test('fallo de fetch informa solo el endpoint y UUID sin propagar el error privado',async()=>{
  const f=await runScript(script,{conectado:true,cuenta:{steamId:STEAM_ID}},{failedEndpoint:'identity'});
  assert.deepEqual(f.part('identity'),{kind:'account_error',id:ID,endpoint:'identity'});
  assert.equal(f.part('vip').kind,'account_part');assert.equal(f.part('sedeo').kind,'account_part');
 });

 await t.test('JSON inválido de una fuente no se presenta como lectura válida',async()=>{
  const f=await runScript(script,{conectado:true,cuenta:{steamId:STEAM_ID}},{invalidJsonEndpoint:'sedeo'});
  assert.deepEqual(f.part('sedeo'),{kind:'account_error',id:ID,endpoint:'sedeo'});
  assert.equal(f.part('identity').kind,'account_part');
 });

 await t.test('el timeout cancela la petición pendiente sin red real',async()=>{
  const f=await runScript(script,{conectado:true,cuenta:{steamId:STEAM_ID}},{timeoutEndpoint:'identity'});
  assert.deepEqual(f.part('identity'),{kind:'account_error',id:ID,endpoint:'identity'});
  assert.equal(f.calls.find(call=>call.endpoint==='identity').options.signal.aborted,true);
 });
});
