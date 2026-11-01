const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createObserver}=require('../src/server.cjs');
const {VIP_SOURCE,SEED_SOURCE}=require('../src/account-import.cjs');
const REWARD_SOURCE='https://api.wardogsspain.com/api/cuenta/retos';

function browserAccount(at,history=[]){return {format:'wardogs-account-snapshot-v1',observedAt:at,vip:{observedAt:at,source:VIP_SOURCE,data:{prioridad:{comprobado:true,tiene:true,caduca:'2026-10-30T08:00:00Z'},historial:history}},seeding:{observedAt:at,source:SEED_SOURCE,data:{ahora:at,estado:'nada'}}};}
function rewardSample(previous=false){return {readerId:'95a86767-b254-4b0f-89b2-82f680199fd1',accountId:'76561198000000001',observedAt:'2026-10-29T08:00:00Z',source:REWARD_SOURCE,data:{activos:true,semana:'2026-10-26',hasta:'2026-11-01T23:00:00Z',hitos:[{id:'semanal_3',dias:1,alcanzado:true,cobrado:false}],anterior:previous?{cobrarHasta:'2026-10-29T08:05:00Z',hitos:[{id:'semanal_3',dias:1,alcanzado:true,cobrado:false}]}:null}};}

async function fixture(t,{rows,mode='ok',clock=Date.parse('2026-10-29T08:00:00Z'),privateAccount=false,launcher,screenReader}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wardogs-observer-test-'));
 let utc=clock,mono=0,calls=0,behavior=mode;
 const options={port:0,dataDir:dir,utcNow:()=>utc,monoNow:()=>mono,...(launcher?{launcher}:{}),...(screenReader?{screenReader}:{}),...(privateAccount?{}:{accountProvider:()=>({available:false})}),fetchImpl:async url=>{
  assert.equal(url,'https://api.wardogsspain.com/api/portal/public/wardogs-servers');calls++;
  if(behavior==='offline')throw Error('Conexión de prueba interrumpida');
  if(behavior==='limited')return new Response('{}',{status:429,headers:{'Retry-After':'120'}});
  return Response.json({configured:true,fetchedAt:utc,servers:rows||[{id:1,num:2,name:'#2 de prueba',players:6,maxPlayers:100,online:true,configured:true,sedeoActivo:true,sedeo:{tope:20,esperaMin:30,cobroN:50}}]});
 }};
 let service=createObserver(options);let url=await service.ready;
 t.after(async()=>{await service.close();const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(dir));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(dir).startsWith('wardogs-observer-test-'));await fs.rm(dir,{recursive:true,force:true});});
 const state=async()=>{const response=await fetch(url+'/api/state');assert.equal(response.status,200);return response.json();};
 const post=async(route,input={},headers={})=>{const s=await state();return fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':s.token,...headers},body:JSON.stringify(input)});};
 return {dir,state,post,get service(){return service;},get calls(){return calls;},advance(ms,{wall=true,monotonic=true}={}){if(wall)utc+=ms;if(monotonic)mono+=ms;},behavior(v){behavior=v;},async restart({crash=false}={}){const prior=crash?await fs.readFile(path.join(dir,'runtime.json')):null;await service.close();if(prior)await fs.writeFile(path.join(dir,'runtime.json'),prior);service=createObserver(options);url=await service.ready;return service;}};
}

test('API: conserva cinco servidores y marca desconocido el ausente, sin inventar cero',async t=>{
 const f=await fixture(t);const s=await f.state();
 assert.equal(s.servers.length,5);assert.equal(s.servers.find(x=>x.number===2).players,6);
 const absent=s.servers.find(x=>x.number===1);assert.equal(absent.players,null);assert.equal(absent.trusted,false);assert.equal(absent.entryCandidate,false);
 assert.equal(s.account.available,false);
});

test('API: rechaza cambios sin token o desde otro origen y conserva la configuración',async t=>{
 const f=await fixture(t);const before=(await f.state()).config;
 assert.equal((await f.post('/api/config',before,{'X-Session-Token':'incorrecto'})).status,403);
 assert.equal((await f.post('/api/config',before,{Origin:'https://otro.example'})).status,403);
 assert.deepEqual((await f.state()).config,before);
});

test('API: guarda configuración válida; no acepta reglas duplicadas ni editar una sesión activa',async t=>{
 const f=await fixture(t);const config=(await f.state()).config;config.durationMinutes=1;
 assert.equal((await f.post('/api/config',config)).status,200);
 const invalid=structuredClone(config);invalid.profiles[4]=invalid.profiles[0];
 assert.equal((await f.post('/api/config',invalid)).status,400);
 assert.equal((await f.post('/api/watch/start')).status,200);
 assert.equal((await f.post('/api/watch/start')).status,400);
 assert.equal((await f.post('/api/config',config)).status,400);
 assert.equal((await f.post('/api/watch/stop')).status,200);
 assert.equal((await f.state()).watch.status,'cancelled');
});

test('API: cumple el máximo con reloj monótono incluso tras un salto del reloj de pared y un fallo de fuente',async t=>{
 const f=await fixture(t);const config=(await f.state()).config;config.durationMinutes=1;await f.post('/api/config',config);await f.post('/api/watch/start');
 f.advance(3600000,{monotonic:false});f.behavior('offline');await f.service.refresh();
 assert.notEqual((await f.state()).watch.status,'expired');
 f.advance(60001,{wall:false});f.service.tick();
 const s=await f.state();assert.equal(s.watch.status,'expired');assert.equal(s.watch.rewardVerified,false);assert.equal(s.lastResult.status,'expired');
});

test('API: guarda el progreso en disco y un reinicio no reanuda presencia ni confirma un premio',async t=>{
 const f=await fixture(t);await f.post('/api/watch/start');f.advance(35000);f.service.tick();
 const disk=JSON.parse(await fs.readFile(path.join(f.dir,'runtime.json'),'utf8'));assert.equal(disk.watch.elapsedMs,35000);
 await f.restart({crash:true});const s=await f.state();assert.equal(s.watch,null);assert.equal(s.lastResult.status,'interrupted');assert.equal(s.lastResult.rewardVerified,false);
});

test('API: programa en Madrid, arranca una sola vez y respeta la duración máxima',async t=>{
 const f=await fixture(t);const config=(await f.state()).config;config.durationMinutes=1;await f.post('/api/config',config);
 assert.equal((await f.post('/api/watch/start',{madridStart:'2026-10-29T08:59'})).status,400);
 assert.equal((await f.post('/api/watch/start',{madridStart:'2026-10-29T09:05'})).status,200);
 assert.equal((await f.state()).watch.status,'scheduled');f.advance(300001);f.service.tick();
 const started=(await f.state()).watch;assert.equal(started.status,'watching');assert.equal(started.startedAt,'2026-10-29T08:05:00.001Z');
 f.advance(1000);f.service.tick();assert.equal((await f.state()).watch.startedAt,started.startedAt);
 f.advance(60000);f.service.tick();assert.equal((await f.state()).watch.status,'expired');
});

test('API: una hora perdida no inicia tarde, y una programación interrumpida requiere nueva orden',async t=>{
 const f=await fixture(t);await f.post('/api/watch/start',{madridStart:'2026-10-29T09:05'});f.advance(361001);f.service.tick();
 assert.equal((await f.state()).watch.status,'missed');
 await f.post('/api/watch/start',{madridStart:'2026-10-29T09:10'});await f.restart();
 assert.equal((await f.state()).watch,null);assert.equal((await f.state()).lastResult.status,'interrupted');
});

test('API: respeta Retry-After y recupera la fuente conservando como desconocido el último dato durante el corte',async t=>{
 const f=await fixture(t);f.advance(30000);f.behavior('limited');await f.service.refresh();
 const failed=await f.state();assert.match(failed.source.error,/429/);assert.equal(failed.servers.find(s=>s.number===2).players,6);assert.equal(failed.servers.find(s=>s.number===2).trusted,false);
 const calls=f.calls;f.advance(119000);await f.service.refresh();assert.equal(f.calls,calls);
 f.advance(1001);f.behavior('ok');await f.service.refresh();const recovered=await f.state();assert.equal(recovered.source.error,null);assert.equal(recovered.servers.find(s=>s.number===2).trusted,true);
});

test('API: un contador privado atrasado no se presenta como tiempo contando, y detener su lector invalida la lectura',async t=>{
 const f=await fixture(t,{privateAccount:true});const at='2026-10-29T08:00:00Z';
 const snapshot={status:'observing',errors:[],vip:{observedAt:at,data:{prioridad:{comprobado:true,tiene:true,caduca:'2026-10-30T08:00:00Z'},historial:[]}},seeding:{observedAt:at,data:{estado:'sedeando',servidor:2,contando:true,contadoAt:'2026-10-29T07:55:00Z'}}};
 const file=path.join(f.dir,'account-snapshot.json');await fs.writeFile(file,JSON.stringify(snapshot));
 let account=(await f.state()).account;assert.equal(account.vipFresh,true);assert.equal(account.seedingFresh,false);
 snapshot.seeding.data.contadoAt=at;await fs.writeFile(file,JSON.stringify(snapshot));assert.equal((await f.state()).account.seedingFresh,true);
 snapshot.status='expired';await fs.writeFile(file,JSON.stringify(snapshot));account=(await f.state()).account;assert.equal(account.vipFresh,false);assert.equal(account.seedingFresh,false);assert.equal(account.vip.caduca,'2026-10-30T08:00:00Z');
});

test('API: una instantánea de cuenta incompleta no impide observar los servidores públicos',async t=>{
 const f=await fixture(t,{privateAccount:true});await fs.writeFile(path.join(f.dir,'account-snapshot.json'),JSON.stringify({status:'observing',vip:{observedAt:'2026-10-29T08:00:00Z'},seeding:{observedAt:'2026-10-29T08:00:00Z'}}));
 const s=await f.state();assert.equal(s.account.available,false);assert.equal(s.servers.find(s=>s.number===2).trusted,true);
});

test('API: cerrar el servicio interrumpe el seguimiento y deja de aceptar nuevas peticiones',async t=>{
 const f=await fixture(t);await f.post('/api/watch/start');const response=await f.post('/api/service/stop');assert.equal(response.status,200);await response.json();await f.service.close();
 const disk=JSON.parse(await fs.readFile(path.join(f.dir,'runtime.json'),'utf8'));assert.equal(disk.watch.status,'interrupted');assert.equal(disk.watch.rewardVerified,false);await assert.rejects(f.state);
 const request=JSON.parse(await fs.readFile(path.join(f.dir,'app-shutdown.json'),'utf8')),service=JSON.parse(await fs.readFile(path.join(f.dir,'service.json'),'utf8'));
 assert.equal(request.format,'farmdogs-app-shutdown-v1');assert.equal(request.servicePid,service.pid);assert.equal(request.servicePid,process.pid);assert.equal(request.root,path.resolve(__dirname,'..'));assert.equal(Date.parse(request.expiresAt)-Date.parse(request.issuedAt),5000);assert.ok(Date.parse(service.startedAt)<=Date.parse(request.issuedAt));
});

test('cierre: incluso sin sesión de movimiento pide salida nativa propia, una sola vez y sin simular actualización',async t=>{
 const f=await fixture(t),before=await f.state();assert.equal(before.autoSeeding,null);assert.equal(before.update.shutdownRequested,false);
 await assert.rejects(fs.readFile(path.join(f.dir,'app-shutdown.json')),{code:'ENOENT'});
 await f.service.close();const request=JSON.parse(await fs.readFile(path.join(f.dir,'app-shutdown.json'),'utf8'));
 assert.match(request.id,/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);assert.equal(request.root,before.installationRoot);assert.equal(request.servicePid,process.pid);assert.equal(request.issuedAt,before.now);assert.equal(Date.parse(request.expiresAt)-Date.parse(request.issuedAt),5000);
 f.advance(7000);await f.service.close();assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.dir,'app-shutdown.json'),'utf8')),request);assert.equal(f.service.state().update.shutdownRequested,false);
});

test('cierre: un fallo al escribir la señal no deja el servidor ni el seguimiento activos',async t=>{
 const errors=[];t.mock.method(console,'error',message=>errors.push(message));const f=await fixture(t);await f.post('/api/watch/start');await fs.mkdir(path.join(f.dir,'app-shutdown.json'));
 await f.service.close();const disk=JSON.parse(await fs.readFile(path.join(f.dir,'runtime.json'),'utf8'));assert.equal(disk.watch.status,'interrupted');await assert.rejects(f.state);assert.equal(errors.length,1);assert.match(errors[0],/No se pudo solicitar el cierre del controlador/);
});

test('API: importar cuenta requiere token y origen local y no escribe datos rechazados',async t=>{
 const f=await fixture(t,{privateAccount:true});const input=browserAccount('2026-10-29T08:00:00Z');
 assert.equal((await f.post('/api/account/import',input,{'X-Session-Token':'incorrecto'})).status,403);
 assert.equal((await f.post('/api/account/import',input,{Origin:'https://otro.example'})).status,403);
 await assert.rejects(fs.stat(path.join(f.dir,'account-snapshot.json')));
});

test('API: importar conserva la primera referencia y detecta un registro nuevo sin renovar su fecha',async t=>{
 const f=await fixture(t,{privateAccount:true});let input=browserAccount('2026-10-29T08:00:00Z');
 assert.equal((await f.post('/api/account/import',input)).status,200);
 let account=(await f.state()).account;assert.equal(account.vipFresh,true);assert.equal(account.seedingFresh,true);assert.equal(account.difference.status,'no_new_seeding_record');
 f.advance(60000);input=browserAccount('2026-10-29T08:01:00Z',[{origen:'sedeo',servidor:2,dias:1,at:'2026-10-29T08:00:30Z'}]);
 assert.equal((await f.post('/api/account/import',input)).status,200);
 account=(await f.state()).account;assert.equal(account.difference.status,'new_seeding_record');assert.equal(account.difference.newSeeding.length,1);
 const baseline=JSON.parse(await fs.readFile(path.join(f.dir,'browser-account-baseline-2026-10-29.json'),'utf8'));assert.equal(baseline.observedAt,'2026-10-29T08:00:00Z');assert.equal(baseline.historial.length,0);
 f.advance(100001);account=(await f.state()).account;assert.equal(account.vipFresh,false);assert.equal(account.seedingFresh,false);assert.equal(account.difference.status,'unknown');
});

test('API: abrir herramientas requiere autorizacion local y nunca confirma una conexion al servidor',async t=>{
 const calls=[];const id='0665a9c0-80b7-4f32-ad47-f36b70367f10';
 const launcher={availability:()=>({game:true,movement:true}),openGame:async()=>calls.push('game'),openMovement:async()=>calls.push('movement')};
 const f=await fixture(t,{launcher,rows:[{id:1,num:2,name:'[ESP] wardogsspain.com | #2',joinId:id,players:6,maxPlayers:100,online:true,configured:true,sedeoActivo:true}]});
 const input={server:2,expectedJoinId:id};
 const config=(await f.state()).config;config.selectedServer=1;await f.post('/api/config',config);
 assert.equal((await f.post('/api/open/game',input,{'X-Session-Token':'incorrecto'})).status,403);
 assert.equal((await f.post('/api/open/movement',{}, {Origin:'https://otro.example'})).status,403);
 assert.equal((await f.post('/api/open/game',{...input,expectedJoinId:'ha-cambiado'})).status,400);assert.equal(calls.length,0);
 assert.equal((await f.post('/api/open/game',input)).status,200);
 const s=await f.state();assert.equal(s.lastLaunch.status,'launch_requested');assert.equal(s.lastLaunch.server,2);assert.equal(s.config.selectedServer,2);assert.equal(s.account.available,false);assert.equal(s.watch,null);
 assert.equal((await f.post('/api/open/movement')).status,200);assert.deepEqual(calls,['game','movement']);
 f.advance(90001);assert.equal((await f.post('/api/open/game',input)).status,400);assert.equal(calls.length,2);
});

test('API: preparar otro servidor no cambia un seguimiento activo ni lanza el juego',async t=>{
 const calls=[];const ids=['0665a9c0-80b7-4f32-ad47-f36b70367f10','9c430e28-f454-4751-bad1-07d5199f8287'];
 const launcher={availability:()=>({game:true,movement:true}),openGame:async()=>calls.push('game')};
 const rows=ids.map((joinId,i)=>({id:i+1,num:i+1,name:`[ESP] wardogsspain.com | #${i+1}`,joinId,players:6,maxPlayers:100,online:true,configured:true,sedeoActivo:true}));
 const f=await fixture(t,{launcher,rows});await f.post('/api/watch/start');
 assert.equal((await f.post('/api/open/game',{server:1,expectedJoinId:ids[0]})).status,400);
 const s=await f.state();assert.equal(s.config.selectedServer,2);assert.equal(s.watch.server,2);assert.equal(s.lastLaunch,null);assert.equal(calls.length,0);
});

test('API: la condición privada vigente distingue tiempo y población y caduca con la lectura',async t=>{
 const f=await fixture(t,{privateAccount:true});const at='2026-10-29T08:00:00Z';const input=browserAccount(at);
 input.seeding.data={ahora:at,estado:'aguantando',servidor:2,dentro:true,porJugadores:false,cobroN:50,cobraAt:'2026-10-29T08:30:00Z'};
 await f.post('/api/account/import',input);let a=(await f.state()).account;assert.equal(a.condition.mode,'timed');assert.equal(a.condition.rewardVerified,false);
 input.seeding.data.porJugadores=true;input.seeding.data.jugadores=50;input.seeding.data.cobraAt=null;
 await f.post('/api/account/import',input);a=(await f.state()).account;assert.equal(a.condition.mode,'population');assert.equal(a.condition.status,'condition_candidate');assert.equal(a.condition.rewardVerified,false);
 f.advance(100001);a=(await f.state()).account;assert.equal(a.seedingFresh,false);assert.equal(a.condition.status,'unknown');assert.equal(a.condition.mode,null);
});

test('API: programa una apertura autorizada, bloquea duplicados y conserva cancelación y reinicio',async t=>{
 const id='9c430e28-f454-4751-bad1-07d5199f8287',calls=[];
 const launcher={availability:()=>({game:true,movement:true}),openGame:async()=>calls.push('game')};
 const f=await fixture(t,{launcher,rows:[{id:1,num:2,name:'[ESP] wardogsspain.com | #2',joinId:id,players:6,maxPlayers:100,online:true,configured:true,sedeoActivo:true}]});
 const input={server:2,expectedJoinId:id,madridStart:'2026-10-29T09:01',onlyEligible:false};
 assert.equal((await f.post('/api/opening/schedule',input,{'X-Session-Token':'invalid'})).status,403);
 assert.equal((await f.post('/api/opening/schedule',input)).status,200);
 assert.equal((await f.post('/api/opening/schedule',input)).status,400);
 assert.equal((await f.post('/api/open/game',{server:2,expectedJoinId:id})).status,400);
 f.advance(60000);await f.service.tick();assert.deepEqual(calls,['game']);assert.equal((await f.state()).opening.status,'open_requested');
 await f.post('/api/opening/schedule',{...input,madridStart:'2026-10-29T09:02'});await f.post('/api/opening/cancel');f.advance(60000);await f.service.tick();assert.equal(calls.length,1);
 await f.service.refresh();assert.equal((await f.post('/api/opening/schedule',{...input,madridStart:'2026-10-29T09:03'})).status,200);await f.restart();f.advance(60000);await f.service.tick();assert.equal(calls.length,1);assert.equal((await f.state()).opening.status,'interrupted');
});

test('API: el diagnóstico distingue selección local, presencia observada y lectura caducada',async t=>{
 const f=await fixture(t,{privateAccount:true});const input=browserAccount('2026-10-29T08:00:00Z');
 input.seeding.data={ahora:'2026-10-29T08:00:00Z',estado:'aguantando',servidor:1,dentro:true,porJugadores:true,cobroN:50};
 assert.equal((await f.post('/api/account/import',input)).status,200);const s=await f.state();
 assert.equal(s.diagnostics[1].status,'presence_observed');assert.equal(s.diagnostics[2].status,'server_mismatch');assert.equal(s.diagnostics[2].observedServer,1);
 f.advance(100001);const old=await f.state();assert.equal(old.diagnostics[1].status,'account_unknown');assert.equal(old.diagnostics[2].observedServer,null);
});

test('API: desconectar solo invalida la lectura del mismo lector y conserva el último VIP conocido',async t=>{
 const f=await fixture(t,{privateAccount:true});const input=browserAccount('2026-10-29T08:00:00Z');input.readerId='9b4950a8-25fd-4dfa-b9cd-b50fb6300089';
 await f.post('/api/account/import',input);assert.equal((await f.state()).account.vipFresh,true);
 assert.equal((await f.post('/api/account/disconnect',{readerId:input.readerId},{'X-Session-Token':'bad'})).status,403);
 await f.post('/api/account/disconnect',{readerId:'eb571e91-b0d0-42da-b5b5-02fe6f631d67'});assert.equal((await f.state()).account.vipFresh,true);
 await f.post('/api/account/disconnect',{readerId:input.readerId});let a=(await f.state()).account;assert.equal(a.vipFresh,false);assert.equal(a.seedingFresh,false);assert.equal(a.vip.caduca,input.vip.data.prioridad.caduca);
 delete input.readerId;await f.post('/api/account/import',input);await f.post('/api/account/disconnect',{readerId:'9b4950a8-25fd-4dfa-b9cd-b50fb6300089'});assert.equal((await f.state()).account.vipFresh,true);
});

test('API: sesión de seeding activa movimiento al pasar de 19 a 20, sin hotkeys, y la parada no se rearma',async t=>{
 const joinId='9c430e28-f454-4751-bad1-07d5199f8287',calls=[];
 const rows=[{id:1,num:2,name:'[ESP] wardogsspain.com | #2',joinId,players:19,maxPlayers:100,online:true,configured:true,sedeoActivo:true}];
 const launcher={availability:()=>({game:true,movement:true,automaticMovement:true}),openMovementBackground:async()=>calls.push('background_controller'),openGame:async()=>calls.push('game')};
 let captureAt='2026-10-29T08:00:00Z';const screenReader={busy:false,refresh:async()=>{},stop:()=>{},view:()=>({status:'verified_capture',scene:'gameplay_hud',gameForeground:true,gamePid:1234,gameWindow:5678,frameId:'55555555-5555-4555-8555-555555555555',capturedAt:captureAt})};
 const f=await fixture(t,{rows,launcher,screenReader,privateAccount:true});const account=browserAccount(captureAt);account.seeding.data={ahora:captureAt,servidor:2,estado:'aguantando',dentro:true};await f.post('/api/account/import',account);
 const native=async(armed,id=null)=>fs.writeFile(path.join(f.dir,'movement-state.json'),JSON.stringify({at:captureAt,pid:700,armed,busy:false,count:0,autoSessionId:id,endUtc:'2026-10-29T09:00:00Z',error:null}));
 await native(false);const input={server:2,expectedJoinId:joinId,durationMinutes:60};
 assert.equal((await f.post('/api/seeding/start',input,{'X-Session-Token':'bad'})).status,403);
 assert.equal((await f.post('/api/seeding/start',input)).status,200);assert.deepEqual(calls,['background_controller','game']);
 await f.service.tick();assert.equal((await f.state()).autoSeeding.status,'waiting_match');assert.notEqual(JSON.parse(await fs.readFile(path.join(f.dir,'movement-command.json'))).kind,'start');
 rows[0].players=20;f.advance(30000);captureAt='2026-10-29T08:00:30Z';await native(false);await f.service.refresh();await f.service.tick();
 let s=await f.state();assert.equal(s.autoSeeding.status,'starting_movement');let command=JSON.parse(await fs.readFile(path.join(f.dir,'movement-command.json')));assert.equal(command.kind,'start');assert.equal(command.scene,'gameplay_hud');assert.equal(command.gamePid,1234);
 await native(true,s.autoSeeding.id);await f.service.tick();assert.equal((await f.state()).autoSeeding.status,'moving');
 await f.post('/api/seeding/stop');await f.service.tick();s=await f.state();assert.equal(s.autoSeeding.status,'cancelled');command=JSON.parse(await fs.readFile(path.join(f.dir,'movement-command.json')));assert.equal(command.kind,'stop');assert.equal(command.cancelled,true);
});

test('API: la programación prepara una única sesión y cuenta su duración desde el disparo',async t=>{
 const calls=[],joinId='9c430e28-f454-4751-bad1-07d5199f8287';
 const rows=[{id:1,num:2,name:'[ESP] wardogsspain.com | #2',joinId,players:10,maxPlayers:100,online:true,configured:true,sedeoActivo:true}];
 const launcher={availability:()=>({game:true,movement:true,automaticMovement:true}),openMovementBackground:async()=>calls.push('controller'),openGame:async()=>calls.push('game')};
 const f=await fixture(t,{rows,launcher});
 assert.equal((await f.post('/api/opening/schedule',{server:2,expectedJoinId:joinId,madridStart:'2026-10-29T09:01',onlyEligible:false,seeding:{durationMinutes:45,intervalSeconds:30,holdMs:500}})).status,200);
 assert.equal((await f.state()).autoSeeding,null);assert.deepEqual(calls,[]);
 f.advance(60000);await Promise.all([f.service.tick(),f.service.tick()]);
 const s=await f.state();assert.deepEqual(calls,['controller','game']);assert.equal(s.opening.status,'open_requested');assert.equal(s.autoSeeding.createdAt,'2026-10-29T08:01:00.000Z');assert.equal(s.autoSeeding.endAt,'2026-10-29T08:46:00.000Z');assert.equal(s.autoSeeding.intervalSeconds,30);assert.equal(s.autoSeeding.startPlayers,20);
});
test('API: Detener cancela también una programación futura sin abrir juego ni controlador',async t=>{
 const joinId='9c430e28-f454-4751-bad1-07d5199f8287',calls=[];
 const rows=[{id:1,num:2,name:'[ESP] wardogsspain.com | #2',joinId,players:10,maxPlayers:100,online:true,configured:true,sedeoActivo:true}];
 const launcher={availability:()=>({game:true,automaticMovement:true}),openMovementBackground:async()=>calls.push('controller'),openGame:async()=>calls.push('game')};
 const f=await fixture(t,{rows,launcher});await f.post('/api/opening/schedule',{server:2,expectedJoinId:joinId,madridStart:'2026-10-29T09:01',onlyEligible:false,seeding:{durationMinutes:45}});
 await f.post('/api/seeding/stop');f.advance(60000);await f.service.tick();assert.equal((await f.state()).opening.status,'cancelled');assert.deepEqual(calls,[]);
});
test('API: una parada durante la preparación del controlador impide solicitar Steam después',async t=>{
 const joinId='9c430e28-f454-4751-bad1-07d5199f8287';let finish,entered;
 const ready=new Promise(resolve=>entered=resolve),calls=[];
 const rows=[{id:1,num:2,name:'[ESP] wardogsspain.com | #2',joinId,players:10,maxPlayers:100,online:true,configured:true,sedeoActivo:true}];
 const launcher={availability:()=>({game:true,automaticMovement:true}),openMovementBackground:()=>{calls.push('controller');entered();return new Promise(resolve=>finish=resolve);},openGame:async()=>calls.push('game')};
 const f=await fixture(t,{rows,launcher});await f.post('/api/opening/schedule',{server:2,expectedJoinId:joinId,madridStart:'2026-10-29T09:01',onlyEligible:false,seeding:{durationMinutes:45}});
 f.advance(60000);const pending=f.service.tick();await ready;await f.post('/api/seeding/stop');finish();await pending;
 const s=await f.state();assert.deepEqual(calls,['controller']);assert.equal(s.opening.status,'uncertain');assert.equal(s.autoSeeding.status,'cancelled');
});

test('API: actividad pública elige una sola vez tras dos muestras y comparte el límite con el movimiento',async t=>{
 const calls=[],joinId='9c430e28-f454-4751-bad1-07d5199f8287';
 const rows=[{id:1,num:2,name:'[ESP] wardogsspain.com | #2',joinId,players:3,maxPlayers:100,online:true,configured:true,sedeoActivo:true,sedeo:{tope:20}}];
 const launcher={availability:()=>({game:true,movement:true,automaticMovement:true}),openMovementBackground:async()=>calls.push('controller'),openGame:async()=>calls.push('game')};
 const f=await fixture(t,{rows,launcher});const input={durationMinutes:1,minPlayers:1,maxEntryPlayers:19,seeding:{intervalSeconds:30,holdMs:500}};
 assert.equal((await f.post('/api/activity/start',input,{'X-Session-Token':'bad'})).status,403);assert.equal((await f.post('/api/activity/start',input)).status,200);
 await f.service.tick();await f.service.tick();assert.deepEqual(calls,['controller']);assert.equal((await f.state()).autoSeeding,null);
 rows[0].players=4;f.advance(30000);await f.service.refresh();await Promise.all([f.service.tick(),f.service.tick()]);
 let s=await f.state();assert.deepEqual(calls,['controller','controller','game']);assert.equal(s.activity.status,'prepared');assert.equal(s.config.selectedServer,2);assert.equal(s.autoSeeding.endAt,'2026-10-29T08:01:00.000Z');assert.equal(s.autoSeeding.intervalSeconds,30);
 await f.service.tick();assert.equal(calls.filter(c=>c==='game').length,1);await f.post('/api/seeding/stop');assert.equal((await f.state()).autoSeeding.status,'cancelled');
});
test('API: F8 durante la vigilancia cancela antes de preparar una sesión',async t=>{
 const calls=[],joinId='9c430e28-f454-4751-bad1-07d5199f8287';const rows=[{id:1,num:2,name:'[ESP] wardogsspain.com | #2',joinId,players:3,maxPlayers:100,online:true,configured:true,sedeoActivo:true}];
 const launcher={availability:()=>({game:true,automaticMovement:true}),openMovementBackground:async()=>calls.push('controller'),openGame:async()=>calls.push('game')};
 const f=await fixture(t,{rows,launcher});await f.post('/api/activity/start',{durationMinutes:10});const id=(await f.state()).activity.id;
 await fs.writeFile(path.join(f.dir,'movement-state.json'),JSON.stringify({at:'2026-10-29T08:00:00Z',pid:700,armed:false,busy:false,count:0,autoSessionId:id,autoOperatorStopped:id}));
 await f.service.tick();assert.equal((await f.state()).activity.status,'cancelled');assert.deepEqual(calls,['controller']);assert.equal(JSON.parse(await fs.readFile(path.join(f.dir,'movement-command.json'))).kind,'stop');
});
test('API: detener actividad durante la preparación no abre Steam ni se rearma',async t=>{
 const joinId='9c430e28-f454-4751-bad1-07d5199f8287',calls=[];let finish,entered,nativeCalls=0;const ready=new Promise(resolve=>entered=resolve);
 const rows=[{id:1,num:2,name:'[ESP] wardogsspain.com | #2',joinId,players:3,maxPlayers:100,online:true,configured:true,sedeoActivo:true}];
 const launcher={availability:()=>({game:true,automaticMovement:true}),openMovementBackground:()=>{calls.push('controller');if(++nativeCalls===1)return Promise.resolve();entered();return new Promise(resolve=>finish=resolve);},openGame:async()=>calls.push('game')};
 const f=await fixture(t,{rows,launcher});await f.post('/api/activity/start',{durationMinutes:10});await f.service.tick();f.advance(30000);await f.service.refresh();const pending=f.service.tick();await ready;await f.post('/api/seeding/stop');finish();await pending;
 const s=await f.state();assert.deepEqual(calls,['controller','controller']);assert.equal(s.activity.status,'cancelled');assert.equal(s.autoSeeding.status,'cancelled');await f.service.tick();assert.equal(calls.filter(c=>c==='game').length,0);
});

test('API premios: usa las mismas barreras de sesión y deja pendiente la semana actual',async t=>{
 const f=await fixture(t),sample=rewardSample();
 assert.equal((await f.post('/api/rewards/observe',sample,{'X-Session-Token':'bad'})).status,403);
 assert.equal((await f.post('/api/rewards/observe',sample,{Origin:'https://otro.example'})).status,403);
 assert.equal((await f.post('/api/rewards/config',{enabled:true})).status,400);
 assert.equal((await f.post('/api/rewards/observe',sample)).status,200);
 assert.equal((await f.post('/api/rewards/config',{enabled:true,leadMinutes:15})).status,200);
 const s=await f.state();assert.equal(s.rewards.pending[0].deadline,null);assert.equal(s.rewards.pending[0].status,'awaiting_rollover');assert.equal(JSON.stringify(s.rewards).includes(sample.accountId),false);
 assert.equal((await(await f.post('/api/rewards/next',{readerId:sample.readerId})).json()).command,null);
});
test('API premios: reserva y autoriza una sola vez; la lectura desconectada no puede cobrar',async t=>{
 const f=await fixture(t),sample=rewardSample(true);
 await f.post('/api/rewards/observe',sample);await f.post('/api/rewards/config',{enabled:true,leadMinutes:15});
 const {command}=await(await f.post('/api/rewards/next',{readerId:sample.readerId})).json();assert.equal(command.hito,'semanal_3');assert.equal(command.anterior,true);assert.equal(command.accountId,sample.accountId);
 assert.equal((await f.post('/api/rewards/result',{readerId:sample.readerId,commandId:command.id,status:'success'})).status,400);
 const authorized=await(await f.post('/api/rewards/authorize',{readerId:sample.readerId,commandId:command.id})).json();assert.equal(authorized.command.id,command.id);
 assert.equal((await(await f.post('/api/rewards/authorize',{readerId:sample.readerId,commandId:command.id})).json()).command,null);
 await f.post('/api/rewards/disconnect',{readerId:sample.readerId});assert.equal((await f.state()).rewards.source.fresh,false);
 assert.equal((await(await f.post('/api/rewards/next',{readerId:sample.readerId})).json()).command,null);
 assert.equal((await f.post('/api/rewards/result',{readerId:sample.readerId,commandId:command.id,status:'success'})).status,200);
 assert.equal((await f.state()).rewards.attempts[0].status,'success');
 await f.restart();assert.equal((await f.state()).rewards.enabled,true);assert.equal((await f.state()).rewards.source.fresh,false);
});

test('API: prueba sin Steam exige confirmar el mismo servidor, espera HUD y no solicita abrir el juego',async t=>{
 const calls=[],joinId='9c430e28-f454-4751-bad1-07d5199f8287';
 const rows=[{id:1,num:2,name:'[ESP] wardogsspain.com | #2',joinId,players:100,maxPlayers:100,online:true,configured:true,sedeoActivo:false}];
 const launcher={availability:()=>({game:true,automaticMovement:true}),openMovementBackground:async()=>calls.push('controller'),openGame:async()=>calls.push('game')};
 let screen={status:'unknown'};
 const screenReader={view:()=>screen,refresh:async()=>{},stop:()=>{},busy:false};
 const f=await fixture(t,{rows,launcher,screenReader}),input={server:2,expectedJoinId:joinId,durationMinutes:10,presenceMode:'manual'};
 assert.equal((await f.post('/api/seeding/start',input)).status,400);assert.deepEqual(calls,[]);
 assert.equal((await f.post('/api/seeding/start',{...input,confirmedServer:1})).status,400);assert.deepEqual(calls,[]);
 assert.equal((await f.post('/api/seeding/start',{...input,confirmedServer:2})).status,200);assert.deepEqual(calls,['controller']);
 const state=await f.state();assert.equal(state.autoSeeding.presenceMode,'manual');assert.equal(state.autoSeeding.manualConfirmedAt,'2026-10-29T08:00:00.000Z');assert.equal(state.lastLaunch,null);assert.equal(state.account.available,false);
 await fs.writeFile(path.join(f.dir,'movement-state.json'),JSON.stringify({at:'2026-10-29T08:00:00Z',pid:700,armed:false,busy:false,count:0,status:'stopped'}));
 await f.service.tick();assert.equal((await f.state()).autoSeeding.status,'waiting_game');assert.notEqual(JSON.parse(await fs.readFile(path.join(f.dir,'movement-command.json'))).kind,'start');
 screen={status:'verified_capture',scene:'gameplay_hud',capturedAt:'2026-10-29T08:00:00Z',gameForeground:true,gamePid:700,frameId:'qa-frame'};
 await f.service.tick();assert.equal((await f.state()).autoSeeding.status,'starting_movement');assert.equal(JSON.parse(await fs.readFile(path.join(f.dir,'movement-command.json'))).kind,'start');assert.deepEqual(calls,['controller']);
 await f.post('/api/seeding/stop');assert.equal((await f.state()).autoSeeding.status,'cancelled');
});
