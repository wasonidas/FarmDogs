'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {EventEmitter}=require('node:events');
const {createTeamClicker,validateClicker}=require('../src/team-clicker.cjs');

function fixture(t,{reader}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wardogs-clicker-test-'));
 let utc=Date.parse('2026-10-31T08:00:00Z'),mono=0,launches=0,alive=true;
 const controller=createTeamClicker({root:dir,dataDir:dir,now:()=>utc,monoNow:()=>mono,isProcessAlive:()=>alive,capabilityCheck:()=>true,reader,spawnProcess:()=>{
  launches++;const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;
 }});
 const command=()=>JSON.parse(fs.readFileSync(path.join(dir,'team-clicker-command.json')));
 const native=fields=>fs.writeFileSync(path.join(dir,'team-clicker-state.json'),JSON.stringify({format:'wardogs-team-clicker-state-v1',at:new Date(utc).toISOString(),pid:1234,sessionId:controller.view().sessionId,armed:true,running:false,targets:{},...fields}));
 t.after(()=>{controller.close();const rel=path.relative(os.tmpdir(),dir);assert.ok(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));fs.rmSync(dir,{recursive:true,force:true});});
 return {controller,command,native,dir,get utc(){return utc;},get launches(){return launches;},advance(ms,{wall=true}={}){mono+=ms;if(wall)utc+=ms;},dead(){alive=false;}};
}
const config={enabled:true,team:'blue',intervalMs:20,hotkey:'F6'};

test('autoclic: valida color, intervalo y tecla sin aceptar coordenadas inventadas',()=>{
 for(const value of [{...config,team:'orange'},{...config,intervalMs:1},{...config,intervalMs:2001},{...config,intervalMs:20.5},{...config,hotkey:'F8'},{...config,enabled:'yes'},{...config,startMode:'invented'}])assert.throws(()=>validateClicker(value));
 assert.deepEqual(validateClicker({...config,x:42,y:12}),{team:'blue',intervalMs:20,startMode:'hotkey',hotkey:'F6'});
 assert.deepEqual(validateClicker({enabled:true,team:'red',intervalMs:20,startMode:'automatic'}),{team:'red',intervalMs:20,startMode:'automatic',hotkey:null});
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
 try{assert.equal(controller.view().available,false);await assert.rejects(controller.configure(config),/controlador/);fs.writeFileSync(capFile,JSON.stringify({...cap,persistentTeamAttempt:true,positiveEntryConfirmation:true}));assert.equal(controller.view().available,false);assert.equal(controller.view().automaticSelectionAvailable,false);fs.writeFileSync(capFile,JSON.stringify({...cap,persistentTeamAttempt:true,positiveEntryConfirmation:true,automaticTeamSelection:true}));assert.equal(controller.view().available,true);assert.equal(controller.view().automaticSelectionAvailable,true);}finally{controller.close();}
});
