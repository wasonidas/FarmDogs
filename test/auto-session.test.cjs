const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createAutoSession}=require('../src/auto-session.cjs');
const {randomUUID}=require('node:crypto');
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wardogs-auto-test-'));let now=Date.parse('2026-10-30T10:00:00Z'),mono=0,starts=0;
 let inputs={movement:{available:true,armed:false,status:'stopped'},server:{number:2,trusted:true,seedingActive:true,players:19},account:{seedingFresh:true,seeding:{servidor:2,estado:'aguantando',dentro:true}}};
 const options={root:dir,dataDir:dir,now:()=>now,monoNow:()=>mono,launcher:{availability:()=>({automaticMovement:true}),openMovementBackground:async()=>starts++},getInputs:()=>inputs,event:()=>{},reader:{view:()=>({status:'unknown'}),refresh:async()=>{},stop:()=>{}}};
 const manager=createAutoSession(options);
 t.after(async()=>{manager.close();const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(dir));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(dir).startsWith('wardogs-auto-test-'));await fs.rm(dir,{recursive:true,force:true});});
 return {manager,options,dir,setInputs(value){inputs=value;},get inputs(){return inputs;},get now(){return now;},advance(ms,{wall=true}={}){mono+=ms;if(wall)now+=ms;},get starts(){return starts;}};
}
test('sesión: el límite diario acorta la duración y un reloj detenido no prolonga el máximo',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.dir,'movement-run.json'),JSON.stringify({dayMadrid:'2026-10-30',stopAtUtc:'2026-10-30T10:15:00Z'}));
 await f.manager.start({server:2,durationMinutes:60});assert.equal(f.manager.view().endAt,'2026-10-30T10:15:00Z');assert.equal(f.starts,1);
 f.advance(900001,{wall:false});f.manager.tick();assert.equal(f.manager.view().status,'expired');assert.equal(JSON.parse(await fs.readFile(path.join(f.dir,'movement-command.json'))).cancelled,true);
});
test('sesión: reiniciar no reanuda una intención persistida y cerrar preserva una parada explícita',async t=>{
 const f=await fixture(t);await f.manager.start({server:2,durationMinutes:60});const restarted=createAutoSession(f.options);assert.equal(restarted.view().status,'interrupted');restarted.tick();assert.equal(f.starts,1);restarted.close();
 f.manager.stop();f.manager.close();assert.equal(f.manager.view().status,'cancelled');
});
test('sesión: un límite ya pasado no deja una sesión fantasma ni abre el controlador',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.dir,'movement-run.json'),JSON.stringify({dayMadrid:'2026-10-30',stopAtUtc:'2026-10-30T09:59:00Z'}));
 await assert.rejects(f.manager.start({server:2,durationMinutes:60}),/límite/);assert.equal(f.manager.active(),null);assert.equal(f.manager.view(),null);assert.equal(f.starts,0);
});
test('sesión: un fallo al renovar la orden cancela la sesión y permite que venza la concesión nativa',async t=>{
 const f=await fixture(t);await f.manager.start({server:2,durationMinutes:60});const command=path.join(f.dir,'movement-command.json');await fs.unlink(command);await fs.mkdir(command);
 assert.doesNotThrow(()=>f.manager.tick());assert.equal(f.manager.view().status,'error');assert.equal(f.manager.view().operatorStopped,true);assert.equal(f.manager.active(),false);
});
test('sesión: la preparación antigua devuelve su ID sin cancelar una sesión nueva',async t=>{
 const f=await fixture(t);let resolveOld,calls=0;f.options.launcher.openMovementBackground=()=>++calls===1?new Promise(resolve=>resolveOld=resolve):Promise.resolve();
 const old=f.manager.start({server:2,durationMinutes:60});const id=f.manager.view().id;f.manager.stop();const next=await f.manager.start({server:3,durationMinutes:30});resolveOld();const result=await old;
 assert.equal(result.id,id);assert.equal(result.status,'interrupted');assert.equal(f.manager.view().id,next.id);assert.equal(f.manager.active(),true);
});
test('sesión: la duración heredada incluye el tiempo de vigilancia sin redondearlo al minuto siguiente',async t=>{
 const f=await fixture(t);await f.manager.start({server:2,durationMinutes:1},{endAt:'2026-10-30T10:00:35Z'});assert.equal(f.manager.view().endAt,'2026-10-30T10:00:35.000Z');f.advance(35000,{wall:false});f.manager.tick();assert.equal(f.manager.view().status,'expired');
});

test('sesión: la lectura pasiva continúa al perder presencia, fuente o controlador sin autorizar movimiento',async t=>{
 const f=await fixture(t);let reads=0;
 f.options.reader.refresh=async()=>{reads++;};
 const created=await f.manager.start({server:2,durationMinutes:5});
 f.manager.tick();assert.equal(f.manager.view().status,'waiting_match');assert.equal(reads,1);
 const moving={available:true,status:'running',armed:true,autoSessionId:created.id};
 f.setInputs({...f.inputs,movement:moving,server:{number:2,trusted:true,seedingActive:true,players:25},account:{seedingFresh:true,seeding:{servidor:2,estado:'aguantando',dentro:false}}});
 f.advance(1500);f.manager.tick();assert.equal(f.manager.view().status,'waiting_presence');assert.equal(reads,2);
 let command=JSON.parse(await fs.readFile(path.join(f.dir,'movement-command.json'),'utf8'));assert.equal(command.kind,'stop');
 f.setInputs({...f.inputs,server:{number:2,trusted:false,players:25}});
 f.advance(1500);f.manager.tick();assert.equal(f.manager.view().status,'waiting_source');assert.equal(reads,3);
 command=JSON.parse(await fs.readFile(path.join(f.dir,'movement-command.json'),'utf8'));assert.equal(command.kind,'stop');
 f.setInputs({...f.inputs,movement:{available:false,status:'unknown'}});
 f.advance(1500);f.manager.tick();assert.equal(f.manager.view().status,'waiting_controller');assert.equal(reads,4);
 command=JSON.parse(await fs.readFile(path.join(f.dir,'movement-command.json'),'utf8'));assert.equal(command.kind,'stop');
});

test('sesión: observar un diálogo tras perder presencia no reanuda y sigue respetando espera y cancelación',async t=>{
 const f=await fixture(t);let reads=0,screen={status:'unknown'};
 f.options.reader.view=()=>screen;
 f.options.reader.refresh=async()=>{reads++;screen={status:'verified_capture',scene:'afk_kick',gameForeground:true,gamePid:1234,gameWindow:5678,frameId:'55555555-5555-4555-8555-555555555555',capturedAt:new Date(f.now).toISOString()};};
 await f.manager.start({server:2,durationMinutes:5});
 f.setInputs({...f.inputs,server:{number:2,trusted:true,seedingActive:true,players:25},account:{seedingFresh:true,seeding:{servidor:2,estado:'aguantando',dentro:false}}});
 f.manager.tick();assert.equal(reads,1);assert.equal(f.manager.view().screen.scene,'afk_kick');assert.equal(f.manager.view().status,'waiting_presence');
 f.advance(1499);f.manager.tick();assert.equal(reads,1);
 f.options.reader.busy=true;f.advance(1);f.manager.tick();assert.equal(reads,1);
 f.options.reader.busy=false;f.manager.tick();assert.equal(reads,2);assert.equal(f.manager.view().startedMovementAt,null);
 f.manager.stop();f.advance(1500);f.manager.tick();assert.equal(reads,2);assert.equal(f.manager.view().status,'cancelled');
 const command=JSON.parse(await fs.readFile(path.join(f.dir,'movement-command.json'),'utf8'));assert.equal(command.kind,'stop');assert.equal(command.cancelled,true);
});

test('sesión temporal: pide solo movimiento, conserva propósito y agota el tiempo aunque UTC no avance',async t=>{
 const f=await fixture(t),requests=[],events=[];
 f.options.getInputs=(server,purpose)=>{requests.push({server,purpose});return {movement:{available:true,armed:false,status:'stopped'}};};f.options.event=(kind,detail)=>events.push({kind,...detail});
 f.options.reader.view=()=>({status:'verified_capture',scene:'gameplay_hud',gameForeground:true,gamePid:1234,gameWindow:5678,frameId:'55555555-5555-4555-8555-555555555555',capturedAt:new Date(f.now).toISOString()});
 const manager=createAutoSession(f.options);t.after(()=>manager.close());
 const started=await manager.start({purpose:'break',durationMinutes:1,confirmedDeployed:true});assert.equal(started.server,null);manager.tick();
 assert.deepEqual(requests,[{server:null,purpose:'break'}]);assert.equal(manager.view().status,'starting_movement');assert.equal(events[0].purpose,'break');assert.equal(events[0].server,null);
 f.advance(60000,{wall:false});manager.tick();assert.equal(manager.view().status,'expired');assert.equal(JSON.parse(await fs.readFile(path.join(f.dir,'movement-command.json'))).cancelled,true);
});

test('sesión temporal: reiniciar conserva una interrupción y no reactiva el controlador',async t=>{
 const f=await fixture(t);await f.manager.start({purpose:'break',durationMinutes:5,confirmedDeployed:true});const restarted=createAutoSession(f.options);t.after(()=>restarted.close());
 assert.equal(restarted.view().purpose,'break');assert.equal(restarted.view().status,'interrupted');assert.match(restarted.view().reason,/movimiento temporal/);restarted.tick();assert.equal(f.starts,1);
});

test('sesión: un reinicio positivo guarda prueba y revoca movimiento sin simular F8; Detener sigue terminal',async t=>{
 const f=await fixture(t),entryId=randomUUID(),joinId=randomUUID();
 const proof={entryId,server:2,joinId,gamePid:1234,gameWindow:5678,confirmedAt:new Date(f.now).toISOString()};
 f.options.reader.view=()=>({status:'verified_capture',scene:'server_restart',restartConfirmed:true,gameForeground:true,gamePid:1234,gameWindow:5678,frameId:randomUUID(),capturedAt:new Date(f.now).toISOString()});
 const manager=createAutoSession(f.options);t.after(()=>manager.close());await manager.start({server:2,durationMinutes:30,presenceMode:'entry'},{trustedEntry:proof});manager.tick();
 assert.equal(manager.view().status,'error');assert.equal(manager.view().disconnect.cause,'server_restart');assert.equal(manager.view().operatorStopped,false);
 let command=JSON.parse(await fs.readFile(path.join(f.dir,'movement-command.json'),'utf8'));assert.equal(command.kind,'stop');assert.equal(command.cancelled,false);
 const saved=JSON.parse(await fs.readFile(path.join(f.dir,'auto-seeding-session.json'),'utf8'));assert.equal(saved.disconnect.entryId,entryId);
 manager.stop();command=JSON.parse(await fs.readFile(path.join(f.dir,'movement-command.json'),'utf8'));assert.equal(command.cancelled,true);assert.equal(manager.view().operatorStopped,true);
});

test('sesión: un HUD desconocido reciente explica el bloqueo sin pedir foco ni conceder movimiento',async t=>{
 const f=await fixture(t);
 f.options.reader.view=()=>({status:'verified_capture',scene:'unknown',gameForeground:true,gamePid:1234,gameWindow:5678,frameId:randomUUID(),capturedAt:new Date(f.now).toISOString()});
 const started=await f.manager.start({purpose:'break',durationMinutes:5,confirmedDeployed:true});f.manager.tick();
 let current=f.manager.view(),command=JSON.parse(await fs.readFile(path.join(f.dir,'movement-command.json'),'utf8'));
 assert.equal(current.status,'waiting_game');assert.match(current.reason,/está en primer plano.*no se reconoce el HUD/);assert.equal(current.startedMovementAt,null);
 assert.equal(current.endAt,started.endAt);assert.equal(command.kind,'watch');assert.equal(command.sessionId,started.id);assert.equal(command.endAt,started.endAt);assert.equal(Date.parse(command.expiresAt)-Date.parse(command.issuedAt),3000);
 const saved=JSON.parse(await fs.readFile(path.join(f.dir,'auto-seeding-session.json'),'utf8'));assert.equal(saved.reason,current.reason);
 f.setInputs({...f.inputs,movement:{available:true,armed:true,status:'running',autoSessionId:started.id}});f.advance(500);f.manager.tick();
 current=f.manager.view();command=JSON.parse(await fs.readFile(path.join(f.dir,'movement-command.json'),'utf8'));
 assert.equal(current.status,'waiting_game');assert.match(current.reason,/no se reconoce el HUD/);assert.equal(command.kind,'stop');assert.equal(command.cancelled,false);assert.equal(command.endAt,started.endAt);assert.equal(current.operatorStopped,false);assert.equal(f.manager.active(),true);
});

test('sesión: el diagnóstico HUD no sustituye capturas caducadas, falta de foco ni la espera de presencia',async t=>{
 const f=await fixture(t);let screen;
 f.options.reader.view=()=>screen;
 f.setInputs({...f.inputs,server:{...f.inputs.server,players:25}});await f.manager.start({server:2,durationMinutes:5});
 const base={status:'verified_capture',scene:'unknown',gameForeground:true,gamePid:1234,gameWindow:5678,frameId:randomUUID(),capturedAt:new Date(f.now).toISOString()};
 for(const change of [{status:'unknown'},{gameForeground:false},{capturedAt:new Date(f.now-5001).toISOString()},{capturedAt:new Date(f.now+1).toISOString()}]){
  screen={...base,...change};f.manager.tick();assert.equal(f.manager.view().status,'waiting_game');assert.equal(f.manager.view().reason,'Esperando el juego desplegado en primer plano.');
 }
 screen={...base,capturedAt:new Date(f.now-5000).toISOString()};f.manager.tick();assert.match(f.manager.view().reason,/no se reconoce el HUD/);
 f.setInputs({...f.inputs,account:{seedingFresh:true,seeding:{servidor:2,estado:'aguantando',dentro:false}}});screen=base;f.manager.tick();
 assert.equal(f.manager.view().status,'waiting_presence');assert.doesNotMatch(f.manager.view().reason,/HUD/);
});

test('sesión: el diagnóstico HUD preserva el aviso sin Steam y no oculta otra ventana de una entrada',async t=>{
 const f=await fixture(t);let screen={status:'verified_capture',scene:'unknown',gameForeground:true,gamePid:1234,gameWindow:5678,frameId:randomUUID(),capturedAt:new Date(f.now).toISOString()};
 f.options.reader.view=()=>screen;f.setInputs({...f.inputs,server:{...f.inputs.server,players:25}});
 await f.manager.start({server:2,durationMinutes:5,presenceMode:'manual',confirmedServer:2});f.manager.tick();
 assert.match(f.manager.view().reason,/^Prueba sin lectura Steam: Wardogs está en primer plano.*HUD/);f.manager.stop();
 const proof={entryId:randomUUID(),server:2,joinId:randomUUID(),gamePid:1234,gameWindow:5678,confirmedAt:new Date(f.now).toISOString()};
 await f.manager.start({server:2,durationMinutes:5,presenceMode:'entry'},{trustedEntry:proof});screen={...screen,gameWindow:8765};f.manager.tick();
 assert.equal(f.manager.view().status,'waiting_game');assert.equal(f.manager.view().reason,'Esperando el juego desplegado en primer plano.');
 screen={...screen,gameWindow:5678};f.manager.tick();assert.match(f.manager.view().reason,/no se reconoce el HUD/);
});
