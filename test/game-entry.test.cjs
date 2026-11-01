'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomUUID,createHash}=require('node:crypto');
const {EventEmitter}=require('node:events');
const {execFileSync}=require('node:child_process');
const {createGameEntry}=require('../src/game-entry.cjs');
const {connectionTarget}=require('../src/local-launch.cjs');
const joinId='0665a9c0-80b7-4f32-ad47-f36b70367f10';
const line=(text,x,y,width=160,height=20)=>({text,words:[{text,x,y,width,height}]});
function lines(screen){
 switch(screen){
  case 'splash':return[line('PULSA UN BOTON PARA EMPEZAR',400,570,480)];
  case 'main':return[line('JUGAR',40,20),line('DESPLEGAR',60,505),line('NAVEGADOR DEL SERVIDOR',60,540,230)];
  case 'categories':return[line('DESPLEGAR',40,20),line('OFICIAL',120,500),line('COMUNIDAD',600,500)];
  case 'browser':return[line('COMUNIDAD',40,20),line('UNIRSE POR ID',60,600,200)];
  case 'form':case 'prefilled':return[line('BUSCAR SERVIDOR',400,230,250),line('INTRODUCE LA IDENTIFICACION DEL SERVIDOR',400,280,420),line('CANCELAR',400,420,100),line('BUSQUEDA',720,420,100),...(screen==='prefilled'?[line(joinId,400,330,450)]:[])];
  case 'confirmation':case 'wrong_confirmation':return[line('¿UNIRSE AL SERVIDOR DEL JUEGO?',400,230,450,25),line('# 0'+(screen==='confirmation'?1:2)+' [ESP] Wardogsspain.com',400,280,400),line('UNIRSE A LA PARTIDA',700,430,250),line('CANCELAR',400,430,100)];
  case 'team':return[line('SELECCIONAR FACCION',450,250,300),line('ABANDONAR PARTIDA',40,680,250)];
  case 'deploying':return[line('ENTRANDO',450,250,300),line('ABANDONAR PARTIDA',40,680,250)];
  case 'hud':return[line('FISTS',1190,630,65,15),line('100',1200,680,40),line('263 W',600,20,70)];
  case 'queue':return[line('EN COLA',400,260,250),line('CANCELAR',400,420,100)];
  case 'browser_queue':{const fixture=require('./fixtures/ocr-browser-queue.json');return fixture.lines.map(row=>({...row,words:row.words.map(word=>({...word,x:word.x*1280/fixture.width,y:word.y*720/fixture.height,width:word.width*1280/fixture.width,height:word.height*720/fixture.height}))}));}
  case 'restart':case 'afk':{const fixture=require('./fixtures/'+(screen==='restart'?'ocr-restart-modal.json':'ocr-afk-modal.json'));return fixture.lines.map(row=>({...row,words:row.words.map(word=>({...word,x:word.x*1280/fixture.width,y:word.y*720/fixture.height,width:word.width*1280/fixture.width,height:word.height*720/fixture.height}))}));}
  default:return[];
 }
}
function defer(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
async function fixture(t){
 const root=await fsp.mkdtemp(path.join(os.tmpdir(),'farmdogs-entry-driver-')),dataDir=path.join(root,'data');
 await fsp.mkdir(path.join(root,'bin'));await fsp.mkdir(dataDir);
 const helper=path.join(root,'bin','WardogsEntry.exe'),helperBytes=Buffer.from('inert native fixture');
 await fsp.writeFile(helper,helperBytes);await fsp.writeFile(path.join(root,'bin','WardogsImageText.exe'),'inert reader fixture');
 const cap={format:'farmdogs-entry-capabilities-v1',automaticEntry:true,oneShot:true,stopWatcher:true,initialFocus:true,mainDeployGate:true,splashKeyStart:true,absolutePointer:true,restartRecovery:true,maxActionMilliseconds:3000,sha256:createHash('sha256').update(helperBytes).digest('hex')};
 await fsp.writeFile(path.join(root,'bin','entry-capabilities.json'),JSON.stringify(cap));
 let utc=Date.parse('2026-10-31T15:00:00Z'),mono=100,screen='main',mutate=null,nativeHook=null,readerHook=null,focusHook=null,targetHook=null,fixedFrame=null,pid=123,window=456;
 const calls=[],children=[],events=[],targetReads=[];let latestRaw=null;
 const watchFile=()=>path.join(dataDir,'entry-watch-'+input.id+'.json');
 function heartbeat(changes={}){const report={format:'farmdogs-entry-watch-v1',sessionId:input.id,servicePid:process.pid,status:'watching',at:new Date(utc).toISOString(),...changes};fs.writeFileSync(watchFile(),JSON.stringify(report));}
 const run=async(file,args,options)=>{
  assert.equal(options.windowsHide,true);
  if(path.basename(file)==='WardogsImageText.exe'){
   const id=fixedFrame||randomUUID(),image=path.join(dataDir,'entry-screen-monitor','game-frame-'+id+'.png');
   latestRaw={format:'wardogs-image-text-v1',width:1280,height:720,source:{kind:'foreground_game',captureMethod:'foreground_client_screen_copy',frameId:id,gamePid:pid,window,path:image,sha256:createHash('sha256').update('mock pixels').digest('hex'),capturedAt:new Date(utc-100).toISOString(),captureFinishedAt:new Date(utc-80).toISOString()},lines:lines(screen)};
   if(screen==='main')latestRaw.controls={mainDeploy:{enabled:true}};
   if(mutate)mutate(latestRaw);calls.push({reader:true,screen});if(readerHook)await readerHook(latestRaw);await fsp.writeFile(image,'mock pixels');await fsp.writeFile(args[1],JSON.stringify(latestRaw));return{};
  }
  assert.equal(path.basename(file),'WardogsEntry.exe');assert.equal(options.timeout,4000);
  if(args[0]==='--focus-game'){
   calls.push({focus:true,args});let report={format:'farmdogs-entry-focus-v1',sessionId:input.id,at:new Date(utc).toISOString(),found:false,focused:false,gamePid:null,gameWindow:null,reason:'game_window_not_found'};
   if(focusHook)report=await focusHook(report)??report;await fsp.writeFile(args[1],JSON.stringify(report));return{};
  }
  assert.equal(args[0],'--execute');
  const command=JSON.parse(await fsp.readFile(args[1],'utf8')),key=command.kind==='replace_join_id'?'type_join_id':({splash:'splash_continue',main:'main_deploy',categories:'community',browser:'join_by_id',form:'lookup',prefilled:'lookup',confirmation:'confirm_join',restart:'restart_continue'}[screen]||'unknown');
  calls.push({key,command,args,options});
  let result={format:'farmdogs-entry-result-v1',id:command.id,sessionId:command.sessionId,success:true,status:'completed',reason:null,at:new Date(utc).toISOString()};
  if(nativeHook)result=await nativeHook({command,key,result})??result;
  await fsp.writeFile(args[2],JSON.stringify(result));return{};
 };
 const spawn=(file,args,options)=>{
  assert.equal(path.basename(file),'WardogsEntry.exe');assert.equal(args[0],'--watch');assert.equal(options.windowsHide,true);assert.equal(args[3],String(process.pid));
  const child=new EventEmitter();child.pid=987654+children.length;child.killed=false;child.unref=()=>{};child.kill=()=>{child.killed=true;child.emit('exit',0,null);return true;};children.push(child);heartbeat();queueMicrotask(()=>child.emit('spawn'));return child;
 };
 const getTarget=(server,id)=>{targetReads.push({server,joinId:id});const fresh={server,joinId:id,sourceAt:new Date(utc).toISOString(),trusted:true,online:true,stale:false,name:'#01 [ESP] Wardogsspain.com'};return targetHook?targetHook(fresh):fresh;};
 const driver=createGameEntry({root,dataDir,getTarget,run,spawn,now:()=>utc,monoNow:()=>mono,event:(name,value)=>events.push({name,...value})});
 const input={id:randomUUID(),server:1,joinId,endAt:new Date(utc+15*60000).toISOString()};
 t.after(async()=>{await driver.close();for(const child of children)child.kill();const relative=path.relative(os.tmpdir(),root);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fsp.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:20});});
 const api={root,dataDir,driver,input,calls,children,events,targetReads,cap,helper,
  setScreen(value){screen=value;},mutate(value){mutate=value;},native(value){nativeHook=value;},read(value){readerHook=value;},focus(value){focusHook=value;},target(value){targetHook=value;},frame(value){fixedFrame=value;},binding(p,w){pid=p;window=w;},heartbeat,
  advance(ms,{beat=true}={}){utc+=ms;mono+=ms;if(beat&&fs.existsSync(watchFile()))heartbeat();},wall(ms){utc+=ms;},
  async step(value,ms=1000){screen=value;api.advance(ms);await driver.tick();return driver.view();},
  get utc(){return utc;},get raw(){return latestRaw;},actions(){return calls.filter(x=>x.key);},watchFile
 };return api;
}
async function searched(f){await f.driver.start(f.input);await f.step('form');await f.step('form');assert.deepEqual(f.actions().map(x=>x.key),['type_join_id','lookup']);}
async function confirmed(f){await searched(f);await f.step('confirmation');assert.equal(f.driver.view().chainConfirmed,true);}
function recoveryInput(f){return {...f.input,initialFocus:'none',recovery:{id:randomUUID(),rootEntryId:randomUUID(),previousEntryId:randomUUID(),seedingId:randomUUID(),gamePid:123,gameWindow:456,detectedAt:new Date(f.utc-100).toISOString(),frameId:randomUUID(),endAt:f.input.endAt}};}

test('recuperación: permiso interno válido prepara plan propio y confirma reinicio una sola vez sin foco',async t=>{
 const f=await fixture(t),input=recoveryInput(f);await f.driver.start(input);assert.equal(f.driver.recoveryAvailable(),true);
 const plan=JSON.parse(await fsp.readFile(path.join(f.dataDir,'entry-recovery-'+f.input.id+'.json'),'utf8'));assert.equal(plan.recoveryId,input.recovery.id);assert.equal(plan.entryId,f.input.id);assert.equal(plan.root,f.root);assert.equal(plan.servicePid,process.pid);assert.equal(plan.endAt,f.input.endAt);
 await f.step('restart');const command=f.actions()[0].command;assert.equal(command.control,'restart_continue');assert.equal(command.kind,'click');assert.equal(command.recoveryId,input.recovery.id);assert.ok(command.restartMessageBounds);assert.ok(command.restartHeaderBounds);assert.equal(f.driver.view().chainConfirmed,false);
 await f.step('restart');assert.equal(f.driver.view().phase,'error');assert.equal(f.actions().length,1);assert.equal(f.calls.some(c=>c.focus),false);
});

test('recuperación: después de ACK exige una cadena nueva completa, sin heredar prueba ni enfocar',async t=>{
 const f=await fixture(t);await f.driver.start(recoveryInput(f));await f.step('restart');for(const screen of ['main','categories','browser','form','form','confirmation','team','deploying','hud'])await f.step(screen);assert.equal(f.driver.view().phase,'gameplay_hud');assert.equal(f.driver.view().chainConfirmed,true);assert.deepEqual(f.actions().map(c=>c.key),['restart_continue','main_deploy','community','join_by_id','type_join_id','lookup','confirm_join']);assert.equal(f.calls.some(c=>c.focus),false);
});

test('recuperación: modal sustituido por menú, selector o HUD aborta; unknown espera sin inputs',async t=>{
 for(const screen of ['main','splash','categories','browser','team','hud']){const f=await fixture(t);await f.driver.start(recoveryInput(f));await f.step(screen);assert.equal(f.driver.view().phase,'error',screen);assert.equal(f.actions().length,0,screen);}
 const waiting=await fixture(t);await waiting.driver.start(recoveryInput(waiting));await waiting.step('unknown');assert.equal(waiting.driver.view().phase,'waiting_game');assert.equal(waiting.actions().length,0);await waiting.step('restart');assert.equal(waiting.actions().length,1);
});

test('recuperación: sin capacidad, permiso, PID/HWND, fuente nueva o plazo válido no confirma el modal',async t=>{
 const old=await fixture(t);await fsp.writeFile(path.join(old.root,'bin','entry-capabilities.json'),JSON.stringify({...old.cap,restartRecovery:false}));assert.equal(old.driver.available(),true);assert.equal(old.driver.recoveryAvailable(),false);await assert.rejects(old.driver.start(recoveryInput(old)),/no permite recuperar/);
 const missing=await fixture(t);await assert.rejects(missing.driver.start({...missing.input,initialFocus:'none'}),/foco/);
 for(const alter of [input=>input.recovery.detectedAt='invalid',input=>input.recovery.endAt=new Date(Date.parse(input.endAt)+1000).toISOString(),input=>input.recovery.previousEntryId=input.id]){const f=await fixture(t),input=recoveryInput(f);alter(input);await assert.rejects(f.driver.start(input),/Permiso interno/);assert.equal(f.actions().length,0);}
 for(const mode of ['window','source','afk','deadline']){const f=await fixture(t),input=recoveryInput(f);await f.driver.start(input);if(mode==='window')f.binding(123,457);if(mode==='source')f.target(target=>({...target,sourceAt:input.recovery.detectedAt}));if(mode==='deadline')f.advance(15*60000);await f.step(mode==='afk'?'afk':'restart');assert.equal(f.actions().length,0);assert.equal(f.driver.view().phase,'error');}
});

test('recuperación: resultado incierto, F8 y stop concurrente nunca repiten ni rearman el ACK',async t=>{
 const uncertain=await fixture(t);uncertain.native(({result})=>({...result,success:false,status:'rejected',reason:'stale_restart_modal'}));await uncertain.driver.start(recoveryInput(uncertain));await uncertain.step('restart');await uncertain.step('restart');assert.equal(uncertain.driver.view().phase,'error');assert.equal(uncertain.actions().length,1);
 const stopped=await fixture(t);await stopped.driver.start(recoveryInput(stopped));stopped.read(()=>stopped.heartbeat({status:'cancelled',reason:'operator_stop'}));await stopped.step('restart');assert.equal(stopped.driver.view().phase,'cancelled');assert.equal(stopped.actions().length,0);
 const cancelled=await fixture(t),pending=defer();cancelled.native(async({result})=>{await pending.promise;return result;});await cancelled.driver.start(recoveryInput(cancelled));const action=cancelled.step('restart');while(!cancelled.actions().length)await new Promise(r=>setImmediate(r));const stop=cancelled.driver.stop({ownerId:cancelled.input.id});pending.resolve();await Promise.all([action,stop]);await cancelled.step('restart');assert.equal(cancelled.actions().length,1);assert.equal(cancelled.driver.view().stopped,true);assert.equal(cancelled.driver.view().chainConfirmed,false);
});

test('contrato recuperación JS→C#: valida el JSON original y el plan nativo sin ejecutar entradas',async t=>{
 if(process.platform!=='win32'){t.skip('El contrato C# se compila en Windows.');return;}
 const f=await fixture(t),probe=path.join(f.root,'bin','GameEntryContractProbe.exe'),compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 execFileSync(compiler,['/nologo','/nowarn:0649','/codepage:65001','/langversion:5','/platform:x64','/target:exe','/main:GameEntryContractProbe','/r:System.Drawing.dll','/r:System.Web.Extensions.dll','/out:'+probe,...['GameWindow.cs','EntryControlVisual.cs','GameEntry.cs','GameEntryContractProbe.cs'].map(name=>path.resolve('native',name))],{windowsHide:true,timeout:30000});
 const input=recoveryInput(f);await f.driver.start(input);const planFile=path.join(f.dataDir,'entry-recovery-'+f.input.id+'.json'),originalPlan=await fsp.readFile(planFile);f.advance(14*60000);assert.equal(await f.driver.checkReady(f.input.id),true);assert.equal(f.actions().length,0);await f.step('restart');const action=f.actions()[0],original=await fsp.readFile(action.args[1]);assert.ok(Date.parse(action.command.issuedAt)-Date.parse(input.recovery.detectedAt)>13*60000);assert.deepEqual(await fsp.readFile(planFile),originalPlan,'La espera no debe renovar el motivo ni el presupuesto del permiso.');assert.equal(action.command.endAt,input.endAt);
 const args=[action.args[1],f.dataDir,action.command.issuedAt],options={cwd:f.root,windowsHide:true,encoding:'utf8',timeout:30000};assert.equal(JSON.parse(execFileSync(probe,args,options)).valid,true);assert.deepEqual(await fsp.readFile(action.args[1]),original);
 const file=path.join(f.dataDir,'entry-recovery-'+f.input.id+'.json'),plan=JSON.parse(await fsp.readFile(file,'utf8'));plan.gameWindow=457;await fsp.writeFile(file,JSON.stringify(plan));assert.throws(()=>execFileSync(probe,args,options),error=>/invalid_recovery_plan/.test(error.stdout));
});

test('entrada nativa: exige inyectar el catálogo público que confirma el destino',()=>{
 assert.throws(()=>createGameEntry({root:os.tmpdir(),dataDir:os.tmpdir()}),/lector del destino público reciente/);
});

test('entrada nativa: capacidades verificadas y start solo prepara el watcher sin capturar ni pulsar',async t=>{
 const f=await fixture(t);assert.equal(f.driver.available(),true);await f.driver.start(f.input);assert.equal(f.children.length,1);assert.equal(f.calls.length,0);assert.equal(f.driver.view().phase,'waiting_game');
 await fsp.appendFile(f.helper,'changed');assert.equal(f.driver.available(),false);
});

test('guarda previa al equipo: consulta F8 vivo sin OCR ni acciones y exige el propietario actual',async t=>{
 const f=await fixture(t);await confirmed(f);await f.step('team');const before=f.calls.length;
 assert.equal(await f.driver.checkReady(randomUUID()),false);assert.equal(await f.driver.checkReady(f.input.id),true);assert.equal(f.calls.length,before);
 f.heartbeat({status:'cancelled',reason:'operator_stop'});assert.equal(f.driver.view().phase,'team_selector');assert.equal(await f.driver.checkReady(f.input.id),false);assert.equal(f.driver.view().phase,'cancelled');assert.equal(f.driver.view().operatorStopped,true);assert.equal(f.calls.length,before);
});

test('guarda previa al equipo: watcher obsoleto o fin total bloquean permiso sin leer la pantalla',async t=>{
 for(const mode of ['stale','expired']){const f=await fixture(t);await f.driver.start(f.input);const before=f.calls.length;f.advance(mode==='stale'?3001:15*60000,{beat:mode!=='stale'});assert.equal(await f.driver.checkReady(f.input.id),false);assert.equal(f.driver.view().phase,'error');assert.equal(f.calls.length,before);}
 const stopped=await fixture(t);await stopped.driver.start(stopped.input);const pending=stopped.driver.checkReady(stopped.input.id);await stopped.driver.stop({ownerId:stopped.input.id});assert.equal(await pending,false);assert.equal(stopped.calls.length,0);
});
test('entrada nativa: un desacuerdo de protocolo se informa al primer rechazo sin repetir entradas',async t=>{
 const f=await fixture(t);f.native(({result})=>({...result,success:false,status:'rejected',reason:'invalid_control'}));await f.driver.start(f.input);await f.step('main');assert.equal(f.driver.view().phase,'error');assert.match(f.driver.view().reason,/no reconoce este paso/);assert.equal(f.driver.view().lastAction.reason,'invalid_control');await f.step('main');assert.equal(f.actions().length,1);
});
test('entrada nativa: un helper anterior sin inicio por tecla o gate de carga no anuncia entrada completa',async t=>{
 const f=await fixture(t),file=path.join(f.root,'bin','entry-capabilities.json');
 for(const feature of ['mainDeployGate','splashKeyStart','absolutePointer']){const old={...f.cap};delete old[feature];await fsp.writeFile(file,JSON.stringify(old));assert.equal(f.driver.available(),false);}
});
test('entrada nativa: inicio usa una pulsación acotada y espera respuesta antes de repetir',async t=>{
 const f=await fixture(t);await f.driver.start(f.input);await f.step('splash');
 assert.equal(f.actions().length,1);assert.equal(f.actions()[0].command.kind,'press_start');assert.equal(f.actions()[0].command.control,'splash_continue');
 await f.step('splash',2000);assert.equal(f.actions().length,1);
 await f.step('splash',6000);assert.equal(f.actions().length,2);
 await f.step('main');assert.equal(f.actions().at(-1).key,'main_deploy');assert.equal(f.actions().at(-1).command.kind,'click');
});

test('entrada nativa: modo desktop omite activación del backend y conserva espera, watcher y F8',async t=>{
 const f=await fixture(t);await f.driver.start({...f.input,initialFocus:'desktop'});f.mutate(raw=>{raw.source.kind='unavailable';});await f.step('unknown');await f.step('unknown');assert.equal(f.calls.some(c=>c.focus),false);assert.equal(f.driver.view().phase,'waiting_game');assert.equal(f.children.length,1);f.heartbeat({status:'cancelled',reason:'operator_stop'});await f.driver.tick();assert.equal(f.driver.view().phase,'cancelled');assert.equal(f.calls.some(c=>c.focus),false);
});
test('entrada nativa: cadena propia por ID, servidor y ventana antes de equipo/HUD',async t=>{
 const f=await fixture(t);await f.driver.start(f.input);
 for(const screen of ['main','categories','browser','form','form','confirmation'])await f.step(screen);
 assert.deepEqual(f.actions().map(x=>x.key),['main_deploy','community','join_by_id','type_join_id','lookup','confirm_join']);
 assert.ok(f.actions().every(x=>x.command.control===x.key));
 const typed=f.actions().find(x=>x.key==='type_join_id').command;assert.equal(typed.joinId,joinId);assert.ok(typed.anchorBounds);assert.ok(typed.bounds.y>typed.anchorBounds.y+typed.anchorBounds.height);assert.ok(typed.framePath.includes('entry-screen-monitor'));assert.equal(typed.sessionId,f.input.id);
 for(const screen of ['queue','confirmation','team','deploying','hud'])await f.step(screen);
 const state=f.driver.view();assert.equal(state.phase,'gameplay_hud');assert.equal(state.chainConfirmed,true);assert.equal(state.gamePid,123);assert.equal(state.gameWindow,456);assert.equal(f.actions().length,6);
 await f.driver.stop({ownerId:f.input.id,reason:'handoff'});assert.equal(f.driver.view().phase,'gameplay_hud');assert.equal(f.driver.view().chainConfirmed,true);assert.equal(f.driver.view().stopped,true);assert.equal(f.driver.blocking(),false);assert.equal(fs.existsSync(f.watchFile()+'.stop'),true);
});

test('entrada nativa: la cola inferior real conserva la conexión propia hasta el selector sin repetir Lookup ni Unirse',async t=>{
 const f=await fixture(t);await confirmed(f);const count=f.actions().length;
 await f.step('browser_queue');assert.equal(f.driver.view().phase,'joining');assert.equal(f.driver.view().chainConfirmed,true);assert.match(f.driver.view().reason,/posición 8 de 10/);
 await f.step('browser_queue',30000);assert.equal(f.actions().length,count);assert.equal(f.driver.view().phase,'joining');
 await f.step('team');assert.equal(f.driver.view().phase,'team_selector');assert.equal(f.driver.view().chainConfirmed,true);assert.equal(f.actions().length,count);
 const expired=await fixture(t);await confirmed(expired);await expired.step('browser_queue');const before=expired.actions().length;expired.advance(15*60000);await expired.driver.tick();assert.equal(expired.driver.view().phase,'error');assert.match(expired.driver.view().reason,/Terminó el tiempo/);assert.equal(expired.actions().length,before);
});

test('contrato entrada JS→C#: el validador productivo acepta cada JSON original generado durante el recorrido completo',async t=>{
 if(process.platform!=='win32'){t.skip('El contrato C# se compila en Windows.');return;}
 const f=await fixture(t),compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe'),probe=path.join(f.root,'bin','GameEntryContractProbe.exe');
 execFileSync(compiler,['/nologo','/nowarn:0649','/codepage:65001','/langversion:5','/platform:x64','/target:exe','/main:GameEntryContractProbe','/r:System.Drawing.dll','/r:System.Web.Extensions.dll','/out:'+probe,...['GameWindow.cs','EntryControlVisual.cs','GameEntry.cs','GameEntryContractProbe.cs'].map(name=>path.resolve('native',name))],{windowsHide:true,timeout:30000});
 await f.driver.start(f.input);for(const screen of ['splash','main','categories','browser','form','form','confirmation'])await f.step(screen);
 assert.equal(f.actions().length,7,'El productor debe recorrer inicio, menú, comunidad, entrada por ID, escritura, búsqueda y confirmación.');
 for(const action of f.actions()){
  const file=action.args[1],original=await fsp.readFile(file);let output;
  try{output=execFileSync(probe,[file,f.dataDir,action.command.issuedAt],{cwd:f.root,windowsHide:true,encoding:'utf8',timeout:10000});}
  catch(error){assert.fail(`El JSON productivo para ${action.key}/${action.command.kind} fue rechazado por C#: ${String(error.stdout||error.message).trim()}`);}
  const validated=JSON.parse(output);assert.equal(validated.valid,true);assert.equal(validated.id,action.command.id);assert.equal(validated.control,action.command.control);assert.equal(validated.kind,action.command.kind);assert.deepEqual(await fsp.readFile(file),original,'El probe no debe reconstruir ni cambiar el comando original.');
 }
 assert.equal(f.driver.view().chainConfirmed,true);
});
test('entrada nativa: ID prellenado no autoriza Lookup sin escritura nativa propia',async t=>{
 const f=await fixture(t);await f.driver.start(f.input);await f.step('prefilled');assert.deepEqual(f.actions().map(x=>x.key),['type_join_id']);await f.step('prefilled');assert.deepEqual(f.actions().map(x=>x.key),['type_join_id','lookup']);
});
test('entrada nativa: selector o HUD ajenos no prueban servidor',async t=>{
 for(const screen of ['team','hud','deploying','queue','browser_queue','confirmation']){
  const f=await fixture(t);await f.driver.start(f.input);const state=await f.step(screen);assert.equal(state.phase,'error',screen);assert.equal(state.chainConfirmed,false);assert.equal(f.actions().length,0,screen);
 }
});
test('entrada nativa: confirmación de otro servidor se rechaza sin pulsar Unirse',async t=>{
 const f=await fixture(t);await searched(f);await f.step('wrong_confirmation');assert.equal(f.driver.view().phase,'error');assert.deepEqual(f.actions().map(x=>x.key),['type_join_id','lookup']);
});

test('entrada nativa: UUID rotado entre escritura y búsqueda detiene antes de Lookup',async t=>{
 const f=await fixture(t);await f.driver.start(f.input);await f.step('form');assert.equal(f.targetReads.length,0);
 f.target(fresh=>({...fresh,joinId:randomUUID()}));await f.step('form');
 assert.equal(f.driver.view().phase,'error');assert.match(f.driver.view().reason,/ID de entrada.*cambiado/);assert.equal(f.driver.view().chainConfirmed,false);assert.deepEqual(f.actions().map(x=>x.key),['type_join_id']);assert.equal(f.targetReads.length,1);
 await f.step('form');await f.step('confirmation');assert.equal(f.actions().length,1);
});

test('entrada nativa: UUID rotado tras Lookup impide confirmar un modal todavía correcto',async t=>{
 const f=await fixture(t);await searched(f);assert.equal(f.targetReads.length,1);f.target(fresh=>({...fresh,joinId:randomUUID()}));await f.step('confirmation');
 assert.equal(f.driver.view().phase,'error');assert.match(f.driver.view().reason,/ID de entrada.*cambiado/);assert.equal(f.driver.view().chainConfirmed,false);assert.deepEqual(f.actions().map(x=>x.key),['type_join_id','lookup']);assert.equal(f.targetReads.length,2);
});

test('entrada nativa: fuente antigua, offline o sin confirmar bloquea cada clic crítico',async t=>{
 for(const stage of ['lookup','confirm_join'])for(const invalid of [fresh=>({...fresh,sourceAt:new Date(Date.parse(fresh.sourceAt)-90001).toISOString()}),fresh=>({...fresh,stale:true}),fresh=>({...fresh,online:false}),fresh=>({...fresh,trusted:false}),fresh=>({...fresh,sourceAt:'invalid'})]){
  const f=await fixture(t);if(stage==='confirm_join')await searched(f);else{await f.driver.start(f.input);await f.step('form');}
  const before=f.actions().length;f.target(invalid);await f.step(stage==='lookup'?'form':'confirmation');
  assert.equal(f.driver.view().phase,'error',stage);assert.match(f.driver.view().reason,/fuente.*antigua, sin conexión o sin confirmar/);assert.equal(f.driver.view().chainConfirmed,false);assert.equal(f.actions().length,before);
 }
});

test('entrada nativa: rechazo del catálogo productivo se propaga sin enviar Lookup',async t=>{
 const f=await fixture(t);await f.driver.start(f.input);await f.step('form');
 f.target(()=>connectionTarget([{number:1,name:'#01 [ESP] Wardogsspain.com',joinId,trusted:false,sourceAt:new Date(f.utc).toISOString()}],1,joinId));await f.step('form');
 assert.equal(f.driver.view().phase,'error');assert.match(f.driver.view().reason,/No se puede verificar el destino.*lectura reciente/);assert.deepEqual(f.actions().map(x=>x.key),['type_join_id']);
});

test('entrada nativa: un número distinto en el catálogo se rechaza antes de buscar',async t=>{
 const f=await fixture(t);await f.driver.start(f.input);await f.step('form');f.target(fresh=>({...fresh,server:2}));await f.step('form');
 assert.equal(f.driver.view().phase,'error');assert.match(f.driver.view().reason,/ya no confirma el servidor elegido/);assert.deepEqual(f.actions().map(x=>x.key),['type_join_id']);
});

test('entrada nativa: cambios del nombre o modo conservando número e ID permiten completar la búsqueda propia',async t=>{
 const f=await fixture(t);let suffix='INFANTRY';
 f.target(fresh=>connectionTarget([{number:1,name:'#01 [ESP] Wardogsspain.com | '+suffix,joinId:joinId.toUpperCase(),trusted:true,sourceAt:fresh.sourceAt}],1,joinId.toUpperCase()));
 await f.driver.start(f.input);await f.step('form');await f.step('form');suffix='RANKEDS | 50/50';
 f.mutate(raw=>{const name=raw.lines.find(row=>row.text.startsWith('# 01'));if(name){name.text+=' | '+suffix;name.words[0].text=name.text;}});await f.step('confirmation');
 assert.equal(f.driver.view().chainConfirmed,true);assert.deepEqual(f.actions().map(x=>x.key),['type_join_id','lookup','confirm_join']);assert.deepEqual(f.targetReads,[{server:1,joinId},{server:1,joinId}]);
});

test('entrada nativa: nombre enteramente cambiado requiere cadena propia, catálogo fresco y número correcto',async t=>{
 const rename=f=>f.mutate(raw=>{const name=raw.lines.find(row=>row.text.startsWith('#'));if(name){name.text='#01 Nombre completamente cambiado';name.words[0].text=name.text;}});
 const f=await fixture(t);await searched(f);rename(f);await f.step('confirmation');assert.equal(f.driver.view().chainConfirmed,true);assert.deepEqual(f.actions().map(x=>x.key),['type_join_id','lookup','confirm_join']);assert.equal(f.targetReads.length,2);
 const without=await fixture(t);await without.driver.start(without.input);rename(without);await without.step('confirmation');assert.equal(without.driver.view().chainConfirmed,false);assert.equal(without.actions().length,0);assert.equal(without.targetReads.length,0);
 const stale=await fixture(t);await searched(stale);rename(stale);stale.target(fresh=>({...fresh,stale:true}));await stale.step('confirmation');assert.equal(stale.driver.view().phase,'error');assert.equal(stale.driver.view().chainConfirmed,false);assert.equal(stale.actions().length,2);
 const wrong=await fixture(t);await searched(wrong);wrong.mutate(raw=>{const name=raw.lines.find(row=>row.text.startsWith('#'));if(name){name.text='#02 Otro nombre';name.words[0].text=name.text;}});await wrong.step('confirmation');assert.equal(wrong.driver.view().phase,'error');assert.equal(wrong.actions().length,2);assert.equal(wrong.driver.view().chainConfirmed,false);
});
test('entrada nativa: captura antigua, futura, ajena o sin digest nunca autoriza acciones',async t=>{
 for(const mutate of [r=>r.source.capturedAt=new Date(Date.parse(r.source.capturedAt)-6000).toISOString(),r=>r.source.capturedAt=new Date(Date.parse(r.source.capturedAt)+2000).toISOString(),r=>r.source.captureFinishedAt=new Date(Date.parse(r.source.captureFinishedAt)+1000).toISOString(),r=>r.source.path=path.join(os.tmpdir(),path.basename(r.source.path)),r=>r.source.sha256='bad',r=>r.source.window=0]){
  const f=await fixture(t);await f.driver.start(f.input);f.mutate(mutate);await f.step('main');assert.equal(f.actions().length,0);assert.equal(f.driver.view().chainConfirmed,false);assert.equal(f.driver.view().capturedAt,null);
 }
});
test('entrada nativa: cambio de proceso/ventana invalida toda la cadena',async t=>{
 for(const binding of [[999,456],[123,999]]){
  const f=await fixture(t);await searched(f);f.binding(...binding);await f.step('confirmation');assert.equal(f.driver.view().phase,'error');assert.equal(f.driver.view().chainConfirmed,false);assert.equal(f.actions().length,2);
 }
});
test('entrada nativa: no repite búsqueda ni confirmación mientras espera respuesta',async t=>{
 const f=await fixture(t);await searched(f);await f.step('form');await f.step('form');assert.equal(f.actions().length,2);assert.equal(f.driver.view().phase,'joining');await f.step('confirmation');await f.step('confirmation');assert.equal(f.actions().length,3);assert.equal(f.driver.view().phase,'joining');
});
test('entrada nativa: resultados inciertos de Lookup/Unirse no se reintentan',async t=>{
 for(const uncertain of ['lookup','confirm_join']){
  const f=await fixture(t);await f.driver.start(f.input);f.native(({key,result})=>{if(key===uncertain)throw Error('Process timeout');return result;});
  await f.step('form');await f.step('form');if(uncertain==='confirm_join')await f.step('confirmation');
  assert.equal(f.driver.view().phase,'error');const count=f.actions().length;await f.step('form');await f.step('confirmation');assert.equal(f.actions().length,count);
 }
});
test('entrada nativa: respuesta de otro UUID no confirma la escritura ni el servidor',async t=>{
 const f=await fixture(t);await f.driver.start(f.input);f.native(({result})=>({...result,id:randomUUID()}));await f.step('form');assert.equal(f.driver.view().phase,'error');assert.equal(f.driver.view().chainConfirmed,false);assert.equal(f.actions().length,1);
});
test('entrada nativa: liberación de entrada incierta es terminal incluso en navegación',async t=>{
 const f=await fixture(t);await f.driver.start(f.input);f.native(({result})=>({...result,success:false,status:'error',reason:'input_release_failed'}));await f.step('main');assert.equal(f.driver.view().phase,'error');await f.step('main');assert.equal(f.actions().length,1);
});
test('entrada nativa: reintento de navegación exige frame nuevo, 800ms y máximo tres intentos',async t=>{
 const f=await fixture(t);await f.driver.start(f.input);const frame=randomUUID();f.frame(frame);await f.step('main');await f.step('main');assert.equal(f.actions().length,1);
 f.frame(null);await f.step('main',100);assert.equal(f.actions().length,2);await f.step('main',100);assert.equal(f.actions().length,2);await f.step('main',900);assert.equal(f.actions().length,3);await f.step('main',1000);assert.equal(f.driver.view().phase,'error');assert.equal(f.actions().length,3);
});
test('entrada nativa: F8 del watcher cancela también sin menú reconocido y en cola',async t=>{
 for(const inQueue of [false,true]){
  const f=await fixture(t);if(inQueue){await confirmed(f);await f.step('browser_queue');}else await f.driver.start(f.input);
  f.heartbeat({status:'cancelled',reason:'operator_stop'});const count=f.actions().length;await f.driver.tick();assert.equal(f.driver.view().phase,'cancelled');assert.equal(f.driver.view().operatorStopped,true);assert.equal(f.driver.view().stopped,true);await f.step('main');assert.equal(f.actions().length,count);
 }
});
test('entrada nativa: F8 durante OCR bloquea el traspaso al selector y al movimiento',async t=>{
 for(const screen of ['team','hud']){
  const f=await fixture(t);await confirmed(f);f.read(()=>f.heartbeat({status:'cancelled',reason:'operator_stop'}));await f.step(screen);assert.equal(f.driver.view().phase,'cancelled');assert.equal(f.driver.view().chainConfirmed,false);assert.equal(f.driver.view().operatorStopped,true);
 }
});
test('entrada nativa: watcher muerto, antiguo o ajeno impide incluso leer el juego',async t=>{
 for(const mode of ['dead','stale','owner']){
  const f=await fixture(t);await f.driver.start(f.input);
  if(mode==='dead')f.children[0].emit('exit',1,null);else if(mode==='stale')f.advance(3001,{beat:false});else f.heartbeat({sessionId:randomUUID()});
  await f.driver.tick();assert.equal(f.driver.view().phase,'error');assert.equal(f.calls.length,0);
 }
});
test('entrada nativa: Detener durante una acción espera el resultado y no acepta éxito tardío',async t=>{
 const f=await fixture(t);await f.driver.start(f.input);const pending=defer(),entered=defer();f.native(async({result})=>{entered.resolve();await pending.promise;return result;});
 const ticking=f.step('form');await entered.promise;assert.equal(f.driver.blocking(f.input.id),true);assert.equal(f.driver.blocking(randomUUID()),false);
 const stopping=f.driver.stop({ownerId:f.input.id,reason:'Usuario'});assert.equal(f.driver.view().stopped,true);await assert.rejects(f.driver.start({...f.input,id:randomUUID()}),/activa|deteni/);
 pending.resolve();await Promise.all([ticking,stopping]);assert.equal(f.driver.blocking(),false);assert.equal(f.driver.view().chainConfirmed,false);assert.equal(f.driver.view().lastAction,undefined);await f.step('form');assert.equal(f.actions().length,1);
});
test('entrada nativa: parada de otro propietario no afecta la sesión y límite monotónico vence aunque UTC retroceda',async t=>{
 const f=await fixture(t);await f.driver.start(f.input);await f.driver.stop({ownerId:randomUUID()});assert.equal(f.driver.view().stopped,false);
 f.advance(15*60000+1);f.wall(-20*60000);await f.driver.tick();assert.equal(f.driver.view().phase,'error');assert.equal(f.calls.length,0);
});
test('entrada nativa: volver al menú tras confirmar invalida presencia, sin reconexión',async t=>{
 const f=await fixture(t);await confirmed(f);await f.step('main');assert.equal(f.driver.view().phase,'error');assert.equal(f.driver.view().chainConfirmed,false);assert.equal(f.actions().length,3);
});
test('entrada nativa: lector reutilizado conserva solo ocho archivos propios',async t=>{
 const f=await fixture(t);await f.driver.start(f.input);const folder=path.join(f.dataDir,'entry-screen-monitor');await fsp.mkdir(folder);await fsp.writeFile(path.join(folder,'unrelated.txt'),'keep');
 for(let i=0;i<10;i++)await f.step('unknown');const files=await fsp.readdir(folder);assert.equal(files.filter(x=>/^(read-|game-frame-)/.test(x)).length,8);assert.equal(await fsp.readFile(path.join(folder,'unrelated.txt'),'utf8'),'keep');assert.equal(f.actions().length,0);
});
test('entrada nativa: retención de acciones incluye claimed y conserva archivos ajenos',async t=>{
 const f=await fixture(t);await f.driver.start(f.input);await fsp.writeFile(path.join(f.dataDir,'other.txt'),'keep');
 for(let i=0;i<20;i++){
  const id=randomUUID();for(const name of ['entry-action-'+id+'.json','entry-action-'+id+'.json.claimed','entry-result-'+id+'.json']){const file=path.join(f.dataDir,name);await fsp.writeFile(file,'{}');await fsp.utimes(file,new Date(1000+i),new Date(1000+i));}
 }
 await f.step('main');const files=await fsp.readdir(f.dataDir);assert.ok(files.filter(x=>/^entry-(?:action|result)-/.test(x)).length<=48);assert.ok(files.includes(path.basename(f.watchFile())));assert.equal(await fsp.readFile(path.join(f.dataDir,'other.txt'),'utf8'),'keep');
});
test('entrada nativa: foco inicial único seguido de OCR; AltTab posterior no activa otra vez el juego',async t=>{
 const f=await fixture(t);await f.driver.start(f.input);f.mutate(r=>r.format='unavailable');f.focus(r=>({...r,found:true,focused:true,gamePid:123,gameWindow:456,reason:null}));await f.step('unknown');assert.equal(f.calls.filter(c=>c.focus).length,1);assert.equal(f.driver.view().focusAttempted,true);assert.equal(f.actions().length,0);
 f.mutate(null);await f.step('main');assert.equal(f.actions().length,1);f.mutate(r=>r.format='unavailable');await f.step('unknown',3000);assert.equal(f.calls.filter(c=>c.focus).length,1);
});
test('entrada nativa: no busca foco tras la primera captura válida aunque no hiciera falta activarlo',async t=>{
 const f=await fixture(t);await f.driver.start(f.input);await f.step('main');f.mutate(r=>r.format='unavailable');await f.step('unknown',3000);assert.equal(f.calls.filter(c=>c.focus).length,0);
});
test('entrada nativa: observa aparición cada dos segundos y no fuerza un rechazo del foco de Windows',async t=>{
 const f=await fixture(t);await f.driver.start(f.input);f.mutate(r=>r.format='unavailable');await f.step('unknown');await f.step('unknown',500);assert.equal(f.calls.filter(c=>c.focus).length,1);
 f.focus(r=>({...r,found:true,focused:false,gamePid:123,gameWindow:456,reason:'foreground_refused'}));await f.step('unknown',1500);assert.equal(f.calls.filter(c=>c.focus).length,2);assert.match(f.driver.view().reason,/Windows/);await f.step('unknown',3000);assert.equal(f.calls.filter(c=>c.focus).length,2);
});
test('entrada nativa: foco incierto no se reintenta y F8 durante su resultado cancela',async t=>{
 const f=await fixture(t);await f.driver.start(f.input);f.mutate(r=>r.format='unavailable');f.focus(()=>{throw Error('Unknown focus result');});await f.step('unknown');await f.step('unknown',3000);assert.equal(f.calls.filter(c=>c.focus).length,1);assert.equal(f.driver.view().focusAttempted,true);
 const second=await fixture(t);await second.driver.start(second.input);second.mutate(r=>r.format='unavailable');second.focus(r=>{second.heartbeat({status:'cancelled',reason:'operator_stop'});return{...r,found:true,focused:true,gamePid:123,gameWindow:456};});await second.step('unknown');assert.equal(second.driver.view().phase,'cancelled');assert.equal(second.actions().length,0);
});
