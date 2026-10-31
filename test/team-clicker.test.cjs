'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {EventEmitter}=require('node:events');
const {execFileSync}=require('node:child_process');
const {createTeamClicker,validateClicker}=require('../src/team-clicker.cjs');

function fixture(t,{reader,anyCapability=true}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wardogs-clicker-test-'));
 let utc=Date.parse('2026-10-31T08:00:00Z'),mono=0,launches=0,alive=true,spawnHook=null;
 const controller=createTeamClicker({root:dir,dataDir:dir,now:()=>utc,monoNow:()=>mono,isProcessAlive:()=>alive,capabilityCheck:feature=>feature==='automaticAnyTeam'?anyCapability:true,reader,spawnProcess:()=>{
  launches++;const child=new EventEmitter();child.unref=()=>{};if(spawnHook)spawnHook(child);else queueMicrotask(()=>child.emit('spawn'));return child;
 }});
 const command=()=>JSON.parse(fs.readFileSync(path.join(dir,'team-clicker-command.json')));
 const native=fields=>fs.writeFileSync(path.join(dir,'team-clicker-state.json'),JSON.stringify({format:'wardogs-team-clicker-state-v1',at:new Date(utc).toISOString(),pid:1234,sessionId:controller.view().sessionId,armed:true,running:false,targets:{},...fields}));
 t.after(()=>{controller.close();const rel=path.relative(os.tmpdir(),dir);assert.ok(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));fs.rmSync(dir,{recursive:true,force:true});});
 return {controller,command,native,dir,get utc(){return utc;},get launches(){return launches;},advance(ms,{wall=true}={}){mono+=ms;if(wall)utc+=ms;},dead(){alive=false;},spawnHook(value){spawnHook=value;}};
}
const config={enabled:true,team:'blue',intervalMs:20,hotkey:'F6'};

test('arranque frío de 16 s: no concede clics antes del helper y el lease activo sigue siendo 8 s',async t=>{
 const f=fixture(t),ownerId='11111111-1111-4111-8111-111111111111',endAt=new Date(f.utc+60000).toISOString();let guarded=0,preparationId;
 f.spawnHook(child=>{preparationId=f.command().sessionId;assert.equal(f.command().enabled,false);assert.equal(f.controller.view().preparing,true);assert.equal(f.controller.blocking(),true);f.advance(16000);queueMicrotask(()=>child.emit('spawn'));});
 const ready=await f.controller.prepareOwned({ownerId,team:'any',endAt,canArm:async()=>{guarded++;assert.equal(f.command().enabled,false);return true;}});
 assert.equal(guarded,1);assert.equal(ready.enabled,true);assert.equal(ready.preparing,false);assert.notEqual(ready.sessionId,preparationId);assert.equal(ready.ownerEndAt,endAt);assert.equal(Date.parse(f.command().issuedAt),f.utc);assert.equal(Date.parse(f.command().expiresAt),f.utc+3000);
 f.controller.tick();assert.equal(f.command().enabled,true);f.advance(7999);f.controller.tick();assert.equal(f.command().enabled,true);f.advance(1);f.controller.tick();assert.equal(f.command().enabled,false);assert.match(f.controller.view().reason,/renovar/);
});

test('contrato JS→C#: los JSON originales de preparación y grant arman una sesión nueva sin rearmar la desactivada',{skip:process.platform!=='win32'},async t=>{
 const f=fixture(t),commands=[];
 f.spawnHook(child=>{commands.push(f.command());f.advance(16000);queueMicrotask(()=>child.emit('spawn'));});
 await f.controller.prepareOwned({ownerId:'11111111-1111-4111-8111-111111111111',team:'any',endAt:new Date(f.utc+60000).toISOString(),canArm:async()=>true});commands.push(f.command());
 const compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe'),probe=path.join(f.dir,'StartupContractProbe.exe'),sequence=path.join(f.dir,'startup-sequence.json');
 execFileSync(compiler,['/nologo','/langversion:5','/platform:x64','/target:exe','/main:TeamClickerStartupContractProbe','/r:System.Web.Extensions.dll','/out:'+probe,path.join(__dirname,'..','native','TeamClickerCore.cs'),path.join(__dirname,'..','native','TeamClickerStartupContractProbe.cs')],{encoding:'utf8',windowsHide:true,timeout:30000});
 // Cold Windows executable startup can exceed 5s before this input-free probe
 // begins. Keep its test timeout separate from the production input leases.
 const validate=values=>{fs.writeFileSync(sequence,JSON.stringify(values));return JSON.parse(execFileSync(probe,[sequence],{encoding:'utf8',windowsHide:true,timeout:30000}));};
 const result=validate(commands);assert.equal(result.nativeInputsAllowed,false);assert.equal(result.steps.length,2);assert.equal(result.steps[0].armed,false);assert.equal(result.steps[1].armed,true);assert.equal(result.steps[1].automaticStoppedSessionId,null);assert.equal(result.steps[1].sessionId,commands[1].sessionId);
 // This mutation reproduces the former JS/C# mismatch rather than duplicating
 // the C# rule in a mock: production Apply must reject same-session rearming.
 const mismatch=validate([commands[0],{...commands[1],sessionId:commands[0].sessionId}]);assert.equal(mismatch.steps[1].armed,false);assert.equal(mismatch.steps[1].automaticStoppedSessionId,commands[0].sessionId);
});

test('arranque frío conserva el fin total y no rearma si vence antes o durante la guarda',async t=>{
 for(const phase of ['spawn','guard','monotonic']){
  const f=fixture(t),ownerId='11111111-1111-4111-8111-111111111111',endAt=new Date(f.utc+10000).toISOString();
  f.spawnHook(child=>{if(phase!=='guard')f.advance(16000,{wall:phase!=='monotonic'});queueMicrotask(()=>child.emit('spawn'));});
  const result=await f.controller.prepareOwned({ownerId,team:'blue',endAt,canArm:async()=>{f.advance(16000);return true;}});
  assert.equal(result.enabled,false);assert.equal(result.preparing,false);assert.equal(f.command().enabled,false);assert.equal(f.controller.blocking(),false);assert.match(result.reason,/Terminó el tiempo/);
 }
});

test('preparación: F8 nativo, liberación y cierre cancelan un spawn pendiente sin permiso posterior',async t=>{
 for(const action of ['F8','release','close']){
  const f=fixture(t),ownerId='11111111-1111-4111-8111-111111111111';let child;
  f.spawnHook(value=>{child=value;});const pending=f.controller.prepareOwned({ownerId,team:'blue',endAt:new Date(f.utc+60000).toISOString()});
  assert.equal(f.controller.view().preparing,true);assert.equal(f.command().enabled,false);await assert.rejects(f.controller.prepareOwned({ownerId,team:'red',endAt:new Date(f.utc+60000).toISOString()}),/detenga/);
  if(action==='F8'){f.native({armed:false,operatorStoppedSessionId:f.controller.view().sessionId});f.controller.tick();}else if(action==='release')f.controller.releaseOwned(ownerId);else f.controller.close();
  child.emit('spawn');await pending;assert.equal(f.command().enabled,false);assert.equal(f.controller.view().preparing,false);assert.equal(f.controller.view().enabled,false);
 }
});

test('preparación: una guarda F8 fallida o una parada mientras espera nunca habilitan clics',async t=>{
 const denied=fixture(t);await denied.controller.prepareOwned({ownerId:'11111111-1111-4111-8111-111111111111',team:'blue',endAt:new Date(denied.utc+60000).toISOString(),canArm:async()=>false});assert.equal(denied.command().enabled,false);
 const late=fixture(t);await late.controller.prepareOwned({ownerId:'11111111-1111-4111-8111-111111111111',team:'blue',endAt:new Date(late.utc+60000).toISOString(),canArm:async()=>{late.native({armed:false,operatorStoppedSessionId:late.controller.view().sessionId});return true;}});assert.equal(late.command().enabled,false);assert.equal(late.controller.view().preparing,false);
 const f=fixture(t);let resolve,entered=false;const wait=new Promise(done=>{resolve=done;});
 const pending=f.controller.prepareOwned({ownerId:'11111111-1111-4111-8111-111111111111',team:'blue',endAt:new Date(f.utc+60000).toISOString(),canArm:async()=>{entered=true;return wait;}});
 await new Promise(done=>setImmediate(done));assert.equal(entered,true);assert.equal(f.command().enabled,false);f.controller.stop();resolve(true);await pending;assert.equal(f.command().enabled,false);
});

test('preparación: un arranque antiguo no modifica la sesión que lo ha sustituido',async t=>{
 const f=fixture(t);let child;f.spawnHook(value=>{child=value;});
 const old=f.controller.configure({...config,team:'red'});const oldId=f.controller.view().sessionId;f.controller.stop();const latest=f.controller.configure({...config,team:'green'}),latestPreparationId=f.controller.view().sessionId;
 assert.notEqual(oldId,latestPreparationId);assert.equal(f.launches,1);child.emit('spawn');const [oldResult,latestResult]=await Promise.all([old,latest]);
 assert.notEqual(f.command().sessionId,oldId);assert.notEqual(f.command().sessionId,latestPreparationId);assert.equal(f.command().sessionId,latestResult.sessionId);assert.equal(oldResult.enabled,false);assert.equal(f.command().selectedTeam,'green');assert.equal(f.command().enabled,true);assert.equal(f.controller.view().preparing,false);
});

test('autoclic propietario: no admite heartbeat ni apropiación de una ventana y espera el acuse de parada',async t=>{
 const f=fixture(t),ownerId='11111111-1111-4111-8111-111111111111';
 const prepared=await f.controller.prepareOwned({ownerId,team:'green',endAt:new Date(f.utc+60000).toISOString()});
 assert.equal(prepared.ownerId,ownerId);assert.equal(prepared.startMode,'automatic');assert.throws(()=>f.controller.heartbeat({sessionId:prepared.sessionId}),/entrada automática/);
 await assert.rejects(f.controller.configure(config),/entrada automática/);assert.equal(f.controller.releaseOwned('22222222-2222-4222-8222-222222222222'),false);assert.equal(f.controller.view().enabled,true);
 f.native({armed:true,running:false});assert.equal(f.controller.releaseOwned(ownerId),false);assert.equal(f.command().enabled,false);assert.equal(f.controller.view().ownerId,ownerId);
 f.native({armed:false,running:false});assert.equal(f.controller.releaseOwned(ownerId),true);assert.equal(f.controller.view().ownerId,ownerId);
});

test('autoclic propietario: renovar sin UI conserva el límite de reloj monotónico y la concesión corta',async t=>{
 const f=fixture(t),ownerId='11111111-1111-4111-8111-111111111111',endAt=new Date(f.utc+20000).toISOString();
 await f.controller.prepareOwned({ownerId,team:'red',endAt});f.advance(7000);f.controller.renewOwned(ownerId);f.controller.tick();
 f.advance(7000);f.controller.renewOwned(ownerId);f.controller.tick();assert.equal(f.controller.view().enabled,true);assert.ok(Date.parse(f.command().expiresAt)<=Date.parse(endAt));
 f.advance(6000,{wall:false});f.controller.tick();assert.equal(f.controller.view().enabled,false);assert.throws(()=>f.controller.renewOwned(ownerId));
});

test('autoclic propietario: F8 y DESPLEGANDO conservan el propietario pero nunca permiten renovar',async t=>{
 const f=fixture(t),ownerId='11111111-1111-4111-8111-111111111111';
 const first=await f.controller.prepareOwned({ownerId,team:'blue',endAt:new Date(f.utc+60000).toISOString()});
 f.native({armed:false,operatorStoppedSessionId:first.sessionId});f.controller.tick();assert.equal(f.controller.view().enabled,false);assert.equal(f.controller.view().ownerId,ownerId);assert.throws(()=>f.controller.renewOwned(ownerId));
 const second=await f.controller.prepareOwned({ownerId,team:'blue',endAt:new Date(f.utc+60000).toISOString()});
 f.native({armed:false,completedAttemptId:'33333333-3333-4333-8333-333333333333'});f.controller.tick();const done=f.controller.view();
 assert.equal(done.sessionId,second.sessionId);assert.equal(done.ownerId,ownerId);assert.equal(done.entryConfirmation.status,'confirmed');assert.equal(done.enabled,false);assert.throws(()=>f.controller.renewOwned(ownerId));
});

test('autoclic: valida color, intervalo y tecla sin aceptar coordenadas inventadas',()=>{
 for(const value of [{...config,team:'orange'},{...config,intervalMs:1},{...config,intervalMs:2001},{...config,intervalMs:20.5},{...config,hotkey:'F8'},{...config,enabled:'yes'},{...config,startMode:'invented'}])assert.throws(()=>validateClicker(value));
 assert.deepEqual(validateClicker({...config,x:42,y:12}),{team:'blue',intervalMs:20,startMode:'hotkey',hotkey:'F6'});
 assert.deepEqual(validateClicker({enabled:true,team:'red',intervalMs:20,startMode:'automatic'}),{team:'red',intervalMs:20,startMode:'automatic',hotkey:null});
});

test('autoclic aleatorio: solo la entrada propietaria y un helper capaz pueden prepararlo, sin cambiar la preferencia del clan',async t=>{
 const f=fixture(t),ownerId='11111111-1111-4111-8111-111111111111';await f.controller.configure({...config,enabled:false,team:'red'});
 await assert.rejects(f.controller.configure({...config,team:'any',startMode:'automatic'}),/azul, rojo o verde/);assert.throws(()=>validateClicker({...config,team:'any'}));
 const prepared=await f.controller.prepareOwned({ownerId,team:'any',endAt:new Date(f.utc+60000).toISOString()});assert.equal(prepared.team,'any');assert.equal(prepared.automaticAnyTeamAvailable,true);assert.equal(f.command().selectedTeam,'any');assert.equal(prepared.actualTeam,null);assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'team-clicker-settings.json'))).team,'red');
 const missing=fixture(t,{anyCapability:false});assert.equal(missing.controller.view().automaticAnyTeamAvailable,false);await assert.rejects(missing.controller.prepareOwned({ownerId,team:'any',endAt:new Date(missing.utc+60000).toISOString()}),/Actualiza/);assert.equal(missing.command().enabled,false);assert.equal(missing.launches,0);
});

test('autoclic automático: prepara espera sin tecla, rechaza calibración y reinicia apagado',async t=>{
 const f=fixture(t);assert.equal(f.controller.view().startMode,'automatic');
 const prepared=await f.controller.configure({enabled:true,team:'red',intervalMs:20,startMode:'automatic'});
 assert.equal(prepared.automaticSelectionAvailable,true);assert.equal(prepared.startMode,'automatic');assert.equal(prepared.waitingAutomatic,true);assert.equal(prepared.running,false);assert.equal(prepared.hotkey,null);assert.equal(prepared.captureKey,null);assert.doesNotMatch(prepared.reason,/F6|F9/);
 assert.equal(f.command().startMode,'automatic');assert.equal(f.command().selectedTeam,'red');assert.equal(f.command().calibrateTeam,null);assert.throws(()=>f.controller.calibrate({team:'red'}),/no requiere calibración/);
 f.native({automaticWaiting:true});assert.equal(f.controller.view().waitingAutomatic,true);
 f.native({active:true,running:true});assert.equal(f.controller.view().waitingAutomatic,false);
 f.controller.close();const restarted=createTeamClicker({root:f.dir,dataDir:f.dir,capabilityCheck:()=>true});
 try{assert.equal(restarted.view().startMode,'automatic');assert.equal(restarted.view().enabled,false);assert.equal(restarted.view().waitingAutomatic,false);assert.equal(f.command().enabled,false);}finally{restarted.close();}
});

test('autoclic automático: cancelación nativa es terminal y no la reanuda un heartbeat',async t=>{
 const f=fixture(t),input={enabled:true,team:'green',intervalMs:20,startMode:'automatic'},prepared=await f.controller.configure(input);
 f.native({armed:false,active:false,running:false,automaticStoppedSessionId:prepared.sessionId,automaticStopReason:'Autoclic detenido: Wardogs ha perdido el foco.'});f.controller.tick();
 assert.equal(f.controller.view().enabled,false);assert.equal(f.command().enabled,false);assert.match(f.controller.view().reason,/perdido el foco/);assert.doesNotMatch(f.controller.view().reason,/F6|F9/);assert.throws(()=>f.controller.heartbeat({sessionId:prepared.sessionId}));
 f.controller.tick();assert.equal(f.command().enabled,false);
 const next=await f.controller.configure(input);assert.notEqual(next.sessionId,prepared.sessionId);assert.equal(next.enabled,true);f.controller.tick();assert.equal(f.controller.view().enabled,true);
});

test('autoclic automático: un acuse de parada ajeno o antiguo no cancela una espera nueva',async t=>{
 const f=fixture(t),prepared=await f.controller.configure({enabled:true,team:'blue',intervalMs:20,startMode:'automatic'});
 f.native({sessionId:'11111111-1111-4111-8111-111111111111',automaticStoppedSessionId:prepared.sessionId});f.controller.tick();assert.equal(f.command().enabled,true);
 f.native({automaticStoppedSessionId:prepared.sessionId,at:new Date(f.utc-4000).toISOString()});f.controller.tick();assert.equal(f.command().enabled,true);
});
test('autoclic: preparar solo concede F6, nunca una orden de clicar; reinicio siempre apagado',async t=>{
 const f=fixture(t);assert.equal(f.command().enabled,false);assert.equal(f.launches,0);
 const armed=await f.controller.configure(config);assert.equal(f.launches,1);assert.equal(armed.running,false);assert.equal(f.command().enabled,true);assert.equal(f.command().calibrateTeam,null);assert.equal(f.command().toggleKey,'F6');assert.equal(f.command().captureKey,'F9');
 f.controller.close();assert.equal(f.command().enabled,false);
 const restarted=createTeamClicker({root:f.dir,dataDir:f.dir,capabilityCheck:()=>true});assert.equal(restarted.view().enabled,false);assert.equal(f.command().enabled,false);restarted.close();
});
test('autoclic: solo la ventana con concesión vigente mantiene el permiso; GET no lo renueva',async t=>{
 const f=fixture(t);const armed=await f.controller.configure(config);
 assert.throws(()=>f.controller.heartbeat({sessionId:'otro'}));
 f.advance(7000);f.controller.view();f.controller.heartbeat({sessionId:armed.sessionId});f.controller.tick();assert.equal(f.command().enabled,true);
 f.advance(8000,{wall:false});f.controller.view();f.controller.tick();assert.equal(f.command().enabled,false);assert.match(f.controller.view().reason,/ventana/);
 assert.throws(()=>f.controller.heartbeat({sessionId:armed.sessionId}));
});
test('autoclic: F8 invalida la sesión y un heartbeat no la rearma',async t=>{
 const f=fixture(t);const armed=await f.controller.configure(config);f.native({operatorStoppedSessionId:armed.sessionId});f.controller.tick();
 assert.equal(f.controller.view().enabled,false);assert.equal(f.command().enabled,false);assert.throws(()=>f.controller.heartbeat({sessionId:armed.sessionId}));
 const next=await f.controller.configure(config);assert.notEqual(next.sessionId,armed.sessionId);
});
test('autoclic: no presenta una sesión nativa anterior, muerta o antigua como clicando',async t=>{
 const f=fixture(t);await f.controller.configure(config);f.native({sessionId:'11111111-1111-4111-8111-111111111111',running:true});assert.equal(f.controller.view().running,false);
 f.native({running:true});assert.equal(f.controller.view().running,true);f.advance(3501);assert.equal(f.controller.view().running,false);
 f.native({running:true});f.dead();assert.equal(f.controller.view().running,false);
});
test('autoclic: calibración ligada al color y cerrada solo tras una captura nueva',async t=>{
 const f=fixture(t);assert.throws(()=>f.controller.calibrate({team:'blue'}));await f.controller.configure(config);
 f.native({targets:{blue:{configured:true,x:100,y:200,width:1920,height:1080,capturedAt:'2026-10-30T08:00:00Z'}}});
 assert.throws(()=>f.controller.calibrate({team:'red'}));f.controller.calibrate({team:'blue'});f.controller.tick();assert.equal(f.command().calibrateTeam,'blue');
 f.native({targets:{blue:{configured:true,x:110,y:220,width:1920,height:1080,capturedAt:'2026-10-31T08:00:00Z'}}});f.controller.tick();assert.equal(f.command().calibrateTeam,null);assert.equal(f.controller.view().targets.blue.x,110);
});
test('autoclic: una parada durante el arranque asíncrono no se pierde',async t=>{
 const f=fixture(t);const promise=f.controller.configure(config);f.controller.stop();await promise;assert.equal(f.command().enabled,false);assert.equal(f.controller.view().enabled,false);assert.equal(f.controller.view().running,false);
});
test('autoclic: recuperar puntos antiguos al arrancar no acredita la calibración actual',async t=>{
 const f=fixture(t);await f.controller.configure(config);f.controller.calibrate({team:'blue'});
 f.native({targets:{blue:{configured:true,capturedAt:'2026-10-30T08:00:00Z'}}});f.controller.tick();assert.equal(f.command().calibrateTeam,'blue');
 f.native({sessionId:'11111111-1111-4111-8111-111111111111',targets:{blue:{configured:true,capturedAt:'2026-10-31T08:00:00Z'}}});f.controller.tick();assert.equal(f.command().calibrateTeam,'blue');
});
test('autoclic: la exclusión espera el acuse nativo de parada',async t=>{
 const f=fixture(t);await f.controller.configure(config);f.native({running:true});f.controller.stop();assert.equal(f.controller.view().stopping,true);assert.equal(f.controller.blocking(),true);
 f.native({running:false,armed:true});assert.equal(f.controller.view().stopping,true);assert.equal(f.controller.blocking(),true);
 f.native({running:false,armed:false});assert.equal(f.controller.blocking(),false);
});

test('autoclic: desactivar una tecla preparada sin clics espera también su desarme nativo',async t=>{
 const f=fixture(t);await f.controller.configure(config);f.native({running:false,armed:true,count:0});f.controller.stop();
 assert.equal(f.controller.view().enabled,false);assert.equal(f.controller.view().running,false);assert.equal(f.controller.view().count,0);
 assert.equal(f.controller.view().stopping,true);assert.equal(f.controller.blocking(),true);
 f.native({running:false,armed:false,count:0});assert.equal(f.controller.view().stopping,false);assert.equal(f.controller.blocking(),false);
});

test('autoclic: el desarme de una sesión anterior reciente bloquea sin atribuirle actividad actual',async t=>{
 const f=fixture(t);await f.controller.configure(config);f.controller.stop();
 f.native({sessionId:'11111111-1111-4111-8111-111111111111',armed:true,running:false});
 assert.equal(f.controller.view().armed,false);assert.equal(f.controller.view().running,false);
 assert.equal(f.controller.view().stopping,true);assert.equal(f.controller.blocking(),true);
 f.advance(3501);assert.equal(f.controller.view().stopping,false);assert.equal(f.controller.blocking(),false);
 f.native({armed:true,running:false});f.dead();assert.equal(f.controller.view().stopping,false);assert.equal(f.controller.blocking(),false);
});
test('autoclic: el registro de teclas solo se confirma para el controlador reciente de esta sesión',async t=>{
 const f=fixture(t);await f.controller.configure(config);assert.equal(f.controller.view().hotkeysReady,false);
 f.native({hotkeysReady:true});assert.equal(f.controller.view().hotkeysReady,true);
 f.native({sessionId:'11111111-1111-4111-8111-111111111111',hotkeysReady:true});assert.equal(f.controller.view().hotkeysReady,false);
 f.native({hotkeysReady:true});f.advance(3501);assert.equal(f.controller.view().hotkeysReady,false);
});

function deferredReader(){
 let last={status:'unknown',reason:'Sin lectura.'};const requests=[];
 return {requests,busy:false,stop(){last={status:'unknown',reason:'Lectura cancelada.'};},view(){return last;},refresh(){return new Promise(resolve=>requests.push(screen=>{last=screen;resolve();}));}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function activeAttempt(f,fields={}){return {active:true,armed:true,running:true,attemptId:'22222222-2222-4222-8222-222222222222',attemptStartedAt:new Date(f.utc-100).toISOString(),gamePid:9876,gameWindow:5678,count:1,...fields};}
function deployment(f,fields={}){return {status:'verified_capture',scene:'deploying',entryConfirmed:true,gameForeground:true,gamePid:9876,gameWindow:5678,frameId:'33333333-3333-4333-8333-333333333333',capturedAt:new Date(f.utc).toISOString(),...fields};}

test('autoclic aleatorio: la prueba y el acuse conservan el color real del mismo intento',async t=>{
 const reader=deferredReader(),f=fixture(t,{reader});await f.controller.prepareOwned({ownerId:'11111111-1111-4111-8111-111111111111',team:'any',endAt:new Date(f.utc+60000).toISOString()});
 const a=activeAttempt(f,{actualTeam:'green'});f.native(a);f.controller.tick();await settle();reader.requests[0](deployment(f));await settle();assert.equal(f.command().entryActualTeam,'green');assert.equal(f.command().entryAttemptId,a.attemptId);
 f.native({...a,actualTeam:null,completedActualTeam:'green',completedAttemptId:a.attemptId,active:false,armed:false,running:false});f.controller.tick();const done=f.controller.view();assert.equal(done.enabled,false);assert.equal(done.entryConfirmation.status,'confirmed');assert.equal(done.entryConfirmation.actualTeam,'green');assert.equal(done.entryConfirmation.gamePid,9876);assert.equal(done.actualTeam,'green');
});

test('autoclic aleatorio: DESPLEGANDO sin color real no genera una prueba atribuida',async t=>{
 const reader=deferredReader(),f=fixture(t,{reader});await f.controller.prepareOwned({ownerId:'11111111-1111-4111-8111-111111111111',team:'any',endAt:new Date(f.utc+60000).toISOString()});f.native(activeAttempt(f));f.controller.tick();await settle();reader.requests[0](deployment(f));await settle();assert.equal(f.command().entryActualTeam,null);assert.equal(f.command().entryAttemptId,null);assert.equal(f.controller.view().actualTeam,null);assert.equal(f.controller.view().enabled,true);
});

test('autoclic aleatorio: un cambio de color invalida la prueba pendiente y no acredita un acuse de otro color',async t=>{
 const reader=deferredReader(),f=fixture(t,{reader});await f.controller.prepareOwned({ownerId:'11111111-1111-4111-8111-111111111111',team:'any',endAt:new Date(f.utc+60000).toISOString()});
 const a=activeAttempt(f,{actualTeam:'blue'});f.native(a);f.controller.tick();await settle();reader.requests[0](deployment(f));await settle();assert.equal(f.command().entryActualTeam,'blue');
 f.advance(200);f.native({...a,actualTeam:'red'});f.controller.renewOwned(f.controller.view().ownerId);f.controller.tick();assert.equal(f.command().entryActualTeam,null);assert.equal(f.command().entryAttemptId,null);await settle();reader.requests.at(-1)(deployment(f));await settle();assert.equal(f.command().entryActualTeam,'red');
 f.native({...a,actualTeam:null,completedActualTeam:'blue',completedAttemptId:a.attemptId,active:false,armed:false,running:false});f.controller.tick();assert.equal(f.controller.view().entryConfirmation.actualTeam,null);assert.equal(f.controller.view().entryConfirmation.gamePid,0);
});

test('autoclic: OCR en paralelo no ordena parada por contrato, HUD, ausencia o fallo de lectura',async t=>{
 const reader=deferredReader(),f=fixture(t,{reader});const configured=await f.controller.configure(config);const a=activeAttempt(f);f.native(a);
 for(const scene of ['joining_faction','gameplay_hud','unknown']){
  f.controller.tick();await settle();reader.requests.at(-1)(deployment(f,{scene,entryConfirmed:scene!=='unknown'}));await settle();
  assert.equal(f.command().enabled,true);assert.equal(f.command().entryAttemptId,null);assert.equal(f.controller.view().active,true);
  f.advance(1500);f.controller.heartbeat({sessionId:configured.sessionId});f.native(a);
 }
});

test('autoclic: el OCR vuelve a leer sin hueco de 1,5 s y nunca solapa capturas',async t=>{
 const reader=deferredReader(),f=fixture(t,{reader});await f.controller.configure(config);const a=activeAttempt(f);f.native(a);f.controller.tick();await settle();assert.equal(reader.requests.length,1);
 f.advance(200);f.native(a);f.controller.tick();await settle();assert.equal(reader.requests.length,1);
 reader.requests[0](deployment(f,{scene:'unknown',entryConfirmed:false}));await settle();f.controller.tick();await settle();assert.equal(reader.requests.length,2);
 f.controller.tick();await settle();assert.equal(reader.requests.length,2);
});

for(const startMode of ['hotkey','automatic'])test(`autoclic ${startMode}: DESPLEGANDO se envía al mismo intento y solo el acuse nativo lo desactiva`,async t=>{
 const reader=deferredReader(),f=fixture(t,{reader});const configured=await f.controller.configure({...config,startMode});const a=activeAttempt(f,{count:0});f.native(a);f.controller.tick();await settle();assert.equal(reader.requests.length,0);
 f.native({...a,count:3});f.controller.tick();await settle();assert.equal(reader.requests.length,1);reader.requests[0](deployment(f));await settle();
 assert.equal(f.command().enabled,true);assert.equal(f.command().entryAttemptId,a.attemptId);assert.equal(f.command().entryGamePid,9876);assert.equal(f.command().entryGameWindow,5678);assert.equal(f.command().entryCapturedAt,new Date(f.utc).toISOString());assert.equal(f.controller.view().entryConfirmation.status,'submitted');
 f.native({...a,active:false,running:false,armed:false,count:3,completedAttemptId:a.attemptId});f.controller.tick();
 assert.equal(f.command().enabled,false);assert.equal(f.controller.view().entryConfirmation.status,'confirmed');assert.throws(()=>f.controller.heartbeat({sessionId:configured.sessionId}));
 assert.equal(f.controller.view().entryConfirmation.gamePid,9876);assert.equal(f.controller.view().entryConfirmation.gameWindow,5678);assert.equal(f.controller.view().entryConfirmation.sessionId,configured.sessionId);
 f.controller.tick();assert.equal(f.command().enabled,false);assert.equal(f.controller.view().waitingAutomatic,false);
});

test('autoclic: una lectura tardía no confirma otro intento F6 de la misma sesión',async t=>{
 const reader=deferredReader(),f=fixture(t,{reader});await f.controller.configure(config);const a=activeAttempt(f);f.native(a);f.controller.tick();await settle();
 f.advance(1);const b=activeAttempt(f,{attemptId:'44444444-4444-4444-8444-444444444444',attemptStartedAt:new Date(f.utc).toISOString()});f.native(b);f.controller.tick();await settle();assert.equal(reader.requests.length,2);
 reader.requests[0](deployment(f));await settle();assert.equal(f.command().entryAttemptId,null);assert.equal(f.command().enabled,true);
 reader.requests[1](deployment(f,{frameId:'55555555-5555-4555-8555-555555555555'}));await settle();assert.equal(f.command().entryAttemptId,b.attemptId);
});

test('autoclic: parar o preparar otra sesión descarta el OCR pendiente y los acuses anteriores',async t=>{
 const reader=deferredReader(),f=fixture(t,{reader});const first=await f.controller.configure(config);const a=activeAttempt(f);f.native(a);f.controller.tick();await settle();f.controller.stop();
 reader.requests[0](deployment(f));await settle();assert.equal(f.command().enabled,false);assert.equal(f.command().entryAttemptId,null);
 const second=await f.controller.configure(config);assert.notEqual(second.sessionId,first.sessionId);
 f.native({...a,sessionId:first.sessionId,completedAttemptId:a.attemptId,active:false,armed:false,running:false});f.controller.tick();assert.equal(f.command().enabled,true);assert.equal(f.command().entryAttemptId,null);
});

test('autoclic: una captura de otra ventana o anterior al intento no se entrega al nativo',async t=>{
 const reader=deferredReader(),f=fixture(t,{reader});const configured=await f.controller.configure(config);const a=activeAttempt(f);f.native(a);
 for(const fields of [{gameWindow:9999},{capturedAt:new Date(f.utc-6000).toISOString()}]){
  f.controller.tick();await settle();reader.requests.at(-1)(deployment(f,fields));await settle();assert.equal(f.command().entryAttemptId,null);assert.equal(f.command().enabled,true);
  f.advance(1500);f.controller.heartbeat({sessionId:configured.sessionId});f.native(a);
 }
});

test('autoclic: cancelar antes de empezar la lectura no abre el capturador pendiente',async t=>{
 const reader=deferredReader(),f=fixture(t,{reader});await f.controller.configure(config);f.native(activeAttempt(f));f.controller.tick();f.controller.stop();await settle();assert.equal(reader.requests.length,0);assert.equal(f.command().entryAttemptId,null);
});

test('autoclic: rechaza un helper sin persistencia y confirmación positiva aunque su hash coincida',async t=>{
 const f=fixture(t);f.controller.close();fs.mkdirSync(path.join(f.dir,'bin'));
 const bytes=Buffer.from('fake helper, never executed');fs.writeFileSync(path.join(f.dir,'bin','WardogsTeamClicker.exe'),bytes);
 const cap={format:'wardogs-team-clicker-capabilities-v1',teamClicker:true,automaticTeamRecognition:true,messageHotkeys:true,sha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex')};
 const capFile=path.join(f.dir,'bin','team-clicker-capabilities.json');fs.writeFileSync(capFile,JSON.stringify(cap));
 const controller=createTeamClicker({root:f.dir,dataDir:f.dir,platform:'win32'});
 try{assert.equal(controller.view().available,false);await assert.rejects(controller.configure(config),/controlador/);fs.writeFileSync(capFile,JSON.stringify({...cap,persistentTeamAttempt:true,positiveEntryConfirmation:true}));assert.equal(controller.view().available,false);assert.equal(controller.view().automaticSelectionAvailable,false);fs.writeFileSync(capFile,JSON.stringify({...cap,persistentTeamAttempt:true,positiveEntryConfirmation:true,automaticTeamSelection:true}));assert.equal(controller.view().available,true);assert.equal(controller.view().automaticSelectionAvailable,true);assert.equal(controller.view().automaticAnyTeamAvailable,false);fs.writeFileSync(capFile,JSON.stringify({...cap,persistentTeamAttempt:true,positiveEntryConfirmation:true,automaticTeamSelection:true,automaticAnyTeam:true}));assert.equal(controller.view().automaticAnyTeamAvailable,true);fs.appendFileSync(path.join(f.dir,"bin","WardogsTeamClicker.exe"),"tampered");assert.equal(controller.view().automaticAnyTeamAvailable,false);}finally{controller.close();}
});
