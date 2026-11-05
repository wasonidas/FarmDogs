const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createActivityMode}=require('../src/activity-mode.cjs');
const initial=Date.parse('2026-10-30T10:00:00Z');
const id='9c430e28-f454-4751-bad1-07d5199f8287';
const input={durationMinutes:60};
function row(number,players,at=initial){return {number,name:`[ESP] wardogsspain.com | #${number}`,joinId:id,sourceAt:new Date(at).toISOString(),trusted:true,online:true,seedingActive:true,players,capacity:100,publicRule:{tope:20}};}
function fixture(){
 let utc=initial,mono=0,disk=null,rows=[row(2,4)],prepares=[],prepare=async()=>{},failSave=false,failEvent=false,limit=value=>value;
 const build=()=>createActivityMode({load:()=>structuredClone(disk),save:value=>{if(failSave)throw Error('Disco bloqueado');disk=structuredClone(value);},now:()=>utc,monoNow:()=>mono,getServers:()=>rows,event:()=>{if(failEvent)throw Error('Registro bloqueado');},limitEndAt:value=>limit(value),prepare:async(target,session,isCurrent)=>{prepares.push({target,session,isCurrent,diskAtCall:structuredClone(disk)});await prepare(target,session,isCurrent);}});
 const mode=build();return {mode,build,get currentRows(){return rows;},rows:v=>rows=v,advance(ms,{wall=true}={}){mono+=ms;if(wall)utc+=ms;},wallShift:ms=>utc+=ms,sample(){rows=rows.map(server=>({...server,sourceAt:new Date(utc).toISOString()}));},prepare:fn=>prepare=fn,failSave:()=>failSave=true,failEvent:()=>failEvent=true,limit:fn=>limit=fn,get prepares(){return prepares;},get disk(){return disk;}};
}

test('actividad: no acepta propósitos temporales ni desconocidos y conserva seeding heredado',()=>{
 for(const value of [{purpose:'break'},{purpose:'unknown'},{seeding:{purpose:'break',confirmedDeployed:true}},{seeding:{purpose:'unknown'}}]){
  const f=fixture();assert.throws(()=>f.mode.start({...input,...value}),/solo prepara seeding/);assert.equal(f.mode.view(),null);assert.equal(f.disk,null);assert.equal(f.prepares.length,0);
 }
 const f=fixture();f.mode.start({...input,seeding:{purpose:'seeding'}});assert.equal(f.mode.view().status,'watching');assert.equal(f.mode.view().seeding.startPlayers,20);
});

test('actividad: exige dos muestras distintas y congela el destino antes de preparar una sola vez',async()=>{
 const f=fixture();f.mode.start(input);await f.mode.tick();assert.equal(f.prepares.length,0);assert.equal(f.mode.view().samples[0].consecutiveSamples,1);
 f.advance(30000);f.sample();await Promise.all([f.mode.tick(),f.mode.tick(),f.mode.tick()]);
 assert.equal(f.prepares.length,1);assert.equal(f.prepares[0].diskAtCall.status,'launching');assert.equal(f.mode.view().status,'prepared');assert.equal(f.mode.view().selectedServer,2);
 assert.equal(f.prepares[0].session.sessionEndAt,'2026-10-30T11:00:00.000Z');assert.equal(f.prepares[0].session.remainingMinutes,60);assert.deepEqual(f.prepares[0].session.settings,{startPlayers:20,intervalSeconds:60,holdMs:500,mousePause:{enabled:true,resumeAfterSeconds:3}});
 f.rows([row(1,18,initial+30000)]);await f.mode.tick();assert.equal(f.prepares.length,1);
});

test('actividad: entrega el equipo aleatorio o fijo elegido a la entrada sin reemplazarlo por la preferencia del clan',async()=>{
 for(const team of ['any','blue','red','green']){const f=fixture();f.mode.start({...input,team});assert.equal(f.mode.view().team,team);await f.mode.tick();f.advance(30000);f.sample();await f.mode.tick();assert.equal(f.prepares[0].session.settings.team,team);}
 const f=fixture();assert.throws(()=>f.mode.start({...input,team:'orange'}));assert.equal(f.mode.view(),null);
});

test('actividad: valida, persiste y propaga el foco inicial junto al presupuesto sin modificar ajustes ni destino',async()=>{
 for(const focus of [undefined,'driver','desktop']){
  const f=fixture();const started=f.mode.start({...input,...(focus===undefined?{}:{initialFocus:focus})});assert.equal(started.initialFocus,focus||'driver');assert.equal(f.disk.initialFocus,focus||'driver');
  await f.mode.tick();f.advance(30000);f.sample();await f.mode.tick();assert.equal(f.prepares[0].session.initialFocus,focus||'driver');assert.equal(f.prepares[0].session.sessionEndAt,started.endAt);assert.equal(f.prepares[0].target.server,2);assert.equal(f.prepares[0].target.joinId,id);assert.deepEqual(f.prepares[0].session.settings,{startPlayers:20,intervalSeconds:60,holdMs:500,mousePause:{enabled:true,resumeAfterSeconds:3}});assert.equal(f.build().view().initialFocus,focus||'driver');
 }
 for(const invalid of [null,'','Desktop','other',true,0,{}]){const f=fixture();assert.throws(()=>f.mode.start({...input,initialFocus:invalid}),/foco inicial/);assert.equal(f.mode.view(),null);assert.equal(f.disk,null);assert.equal(f.prepares.length,0);}
});

test('actividad: un callback de preparación cancelado no cambia el foco ni el estado del siguiente trabajo',async()=>{
 const f=fixture();let release;f.prepare(()=>new Promise(resolve=>release=resolve));const before=f.mode.start({...input,initialFocus:'desktop'});await f.mode.tick();f.advance(30000);f.sample();const pending=f.mode.tick();assert.equal(f.mode.view().status,'launching');f.mode.stop();const next=f.mode.start({...input,initialFocus:'driver'});assert.notEqual(next.id,before.id);assert.equal(f.prepares[0].isCurrent(),false);release();await pending;assert.deepEqual(f.mode.view(),next);
});
test('actividad: repetir el mismo timestamp no confirma actividad ni arregla una muestra contradictoria',async()=>{
 const f=fixture();f.mode.start(input);await f.mode.tick();await f.mode.tick();assert.equal(f.prepares.length,0);
 f.rows([row(2,5)]);await f.mode.tick();assert.equal(f.mode.view().samples[0].consecutiveSamples,0);
 f.advance(30000);f.sample();await f.mode.tick();assert.equal(f.prepares.length,0);
 f.advance(30000);f.sample();await f.mode.tick();assert.equal(f.prepares.length,1);
});

test('actividad: cambiar el título no reinicia ni crea las dos muestras del mismo ID',async()=>{
 const f=fixture();f.mode.start(input);await f.mode.tick();
 f.rows([{...row(2,4),name:'Título completamente nuevo | Modo distinto'}]);await f.mode.tick();
 assert.equal(f.prepares.length,0);assert.equal(f.mode.view().samples[0].consecutiveSamples,1);
 f.advance(30000);f.rows([{...row(2,4,initial+30000),name:'Otro título y otro modo'}]);await f.mode.tick();
 assert.equal(f.prepares.length,1);assert.equal(f.mode.view().samples[0].consecutiveSamples,2);assert.equal(f.prepares[0].target.joinId,id);
});

test('actividad: cambiar UUID, umbral o capacidad sí requiere dos muestras de la nueva identidad',async()=>{
 for(const change of [r=>r.joinId='9c430e28-f454-4751-bad1-07d5199f8288',r=>r.publicRule={tope:25},r=>r.capacity=90]){
  const f=fixture();f.mode.start(input);await f.mode.tick();f.advance(30000);
  const changed=row(2,4,initial+30000);change(changed);f.rows([changed]);await f.mode.tick();
  assert.equal(f.prepares.length,0);assert.equal(f.mode.view().samples[0].consecutiveSamples,1);
  f.advance(30000);f.sample();await f.mode.tick();assert.equal(f.prepares.length,1);assert.equal(f.mode.view().samples[0].consecutiveSamples,2);
 }
});
test('actividad: no acepta fuente antigua, servidor ajeno/inactivo/lleno, umbral alcanzado ni identidad ausente',async()=>{
 const bad=[r=>r.trusted=false,r=>r.online=false,r=>r.seedingActive=false,r=>r.players=0,r=>r.players=20,r=>{r.players=5;r.capacity=5;},r=>r.joinId='bad',r=>{r.name='otra comunidad';r.trusted=false;},r=>r.sourceAt=new Date(initial-90001).toISOString(),r=>r.publicRule.tope=4,r=>delete r.capacity];
 for(const alter of bad){const f=fixture(),r=row(2,4);alter(r);f.rows([r]);f.mode.start(input);await f.mode.tick();f.advance(30000);const next=row(2,4,initial+30000);alter(next);f.rows([next]);await f.mode.tick();assert.equal(f.prepares.length,0);assert.equal(f.mode.view().samples.length,0);}
 const duplicate=fixture();duplicate.rows([row(2,4),row(2,8)]);duplicate.mode.start(input);await duplicate.mode.tick();assert.equal(duplicate.mode.view().samples.length,0);
});
test('actividad: caída, pérdida de fuente, desaparición o cambio de ID requieren otra pareja de muestras',async()=>{
 for(const change of ['fall','source','missing','identity']){
  const f=fixture();f.mode.start(input);await f.mode.tick();f.advance(30000);
  if(change==='fall')f.rows([row(2,3,initial+30000)]);
  if(change==='source')f.rows([{...row(2,4,initial+30000),trusted:false}]);
  if(change==='missing')f.rows([]);
  if(change==='identity')f.rows([{...row(2,4,initial+30000),joinId:'9c430e28-f454-4751-bad1-07d5199f8288'}]);
  await f.mode.tick();assert.equal(f.prepares.length,0);
  f.advance(30000);const keep=f.currentRows.length?{...f.currentRows[0],trusted:true}:row(2,4);f.rows([{...keep,sourceAt:new Date(initial+60000).toISOString()}]);await f.mode.tick();
  assert.equal(f.prepares.length,change==='fall'||change==='identity'?1:0);
 }
});
test('actividad: prioriza población confirmada, crecimiento en empate y selección de servidores',async()=>{
 const f=fixture();f.rows([row(1,3),row(2,6),row(3,9)]);f.mode.start({...input,serverNumbers:[1,2]});await f.mode.tick();f.advance(30000);f.rows([row(1,8,initial+30000),row(2,8,initial+30000),row(3,18,initial+30000)]);await f.mode.tick();assert.equal(f.mode.view().selectedServer,1);
 const bounded=fixture();bounded.rows([row(1,2),row(2,8)]);bounded.mode.start({...input,minPlayers:3,maxEntryPlayers:7});await bounded.mode.tick();assert.equal(bounded.mode.view().samples.length,0);
});
test('actividad: detener durante la preparación revoca la continuación y no se rearma',async()=>{
 const f=fixture();let release;f.prepare(async(target,session,isCurrent)=>{assert.equal(isCurrent(),true);await new Promise(resolve=>release=resolve);assert.equal(isCurrent(),false);});
 f.mode.start(input);await f.mode.tick();f.advance(30000);f.sample();const pending=f.mode.tick();assert.equal(f.mode.view().status,'launching');f.mode.stop();release();await pending;
 assert.equal(f.mode.view().status,'cancelled');await f.mode.tick();assert.equal(f.prepares.length,1);
});
test('actividad: cerrar o reiniciar interrumpe y nunca retoma vigilancia ni apertura',async()=>{
 const f=fixture();f.mode.start(input);const restarted=f.build();assert.equal(restarted.view().status,'interrupted');await restarted.tick();assert.equal(f.prepares.length,0);restarted.close();
 const preparing=fixture();let release;preparing.prepare(()=>new Promise(resolve=>release=resolve));preparing.mode.start(input);await preparing.mode.tick();preparing.advance(30000);preparing.sample();const pending=preparing.mode.tick();assert.equal(preparing.build().view().status,'interrupted');preparing.mode.close();release();await pending;assert.equal(preparing.mode.view().status,'interrupted');assert.equal(preparing.prepares[0].isCurrent(),false);
});
test('actividad: el límite total incluye espera y se aplica por reloj monótono aunque UTC no avance',async()=>{
 const f=fixture();f.mode.start({durationMinutes:1});await f.mode.tick();f.advance(60000,{wall:false});await f.mode.tick();assert.equal(f.mode.view().status,'expired');assert.equal(f.prepares.length,0);
 const cap=fixture();cap.limit(()=>new Date(initial+20000).toISOString());cap.mode.start(input);cap.advance(20000,{wall:false});await cap.mode.tick();assert.equal(cap.mode.view().status,'expired');
});
test('actividad: el plazo puede vencer durante la preparación sin confirmar un resultado posterior',async()=>{
 const f=fixture();let release;f.prepare(()=>new Promise(resolve=>release=resolve));f.mode.start({durationMinutes:1});await f.mode.tick();f.advance(30000);f.sample();const pending=f.mode.tick();f.advance(30000);assert.equal(f.prepares[0].isCurrent(),false);await f.mode.tick();release();await pending;assert.equal(f.mode.view().status,'expired');
});
test('actividad: la sesión entregada conserva el tiempo restante exacto tras un retroceso de UTC',async()=>{
 const f=fixture();f.mode.start(input);await f.mode.tick();f.advance(30000,{wall:false});f.wallShift(-600000);f.rows([row(2,4,initial+30000)]);await f.mode.tick();
 // The future cloud timestamp is outside clock tolerance, so wait for a consistent clock sample.
 assert.equal(f.prepares.length,0);f.rows([row(2,4,initial-600000)]);await f.mode.tick();f.advance(30000);f.sample();await f.mode.tick();
 assert.equal(f.prepares.length,1);assert.equal(f.prepares[0].session.remainingMinutes,59);assert.equal(f.prepares[0].session.sessionEndAt,'2026-10-30T10:49:30.000Z');
});
test('actividad: un registro de eventos bloqueado no convierte una orden guardada en un fallo oculto',async()=>{
 const f=fixture();f.failEvent();assert.doesNotThrow(()=>f.mode.start(input));await f.mode.tick();f.advance(30000);f.sample();await f.mode.tick();assert.equal(f.mode.view().status,'prepared');assert.equal(f.prepares.length,1);
});
test('actividad: validación y guardados fallidos no dejan intenciones ocultas ni lanzan el juego',async()=>{
 for(const invalid of [{durationMinutes:0},{...input,minPlayers:0},{...input,maxEntryPlayers:100},{...input,minPlayers:8,maxEntryPlayers:7},{...input,serverNumbers:[2,2]},{...input,seeding:{holdMs:1}}]){const f=fixture();assert.throws(()=>f.mode.start(invalid));assert.equal(f.mode.view(),null);}
 for(const badLimit of [()=>null,()=>new Date(initial-1).toISOString(),()=>new Date(initial+7200000).toISOString()]){const f=fixture();f.limit(badLimit);assert.throws(()=>f.mode.start(input));assert.equal(f.mode.view(),null);}
 const f=fixture();f.failSave();assert.throws(()=>f.mode.start(input));assert.equal(f.mode.view(),null);assert.equal(f.prepares.length,0);
 const launching=fixture();launching.mode.start(input);await launching.mode.tick();launching.advance(30000);launching.sample();launching.failSave();await launching.mode.tick();assert.equal(launching.prepares.length,0);assert.equal(launching.mode.view().status,'error');
});
test('actividad: resultado de preparación fallido queda visible y no se reintenta',async()=>{
 const f=fixture();f.prepare(async()=>{throw Error('No se puede solicitar Steam');});f.mode.start(input);await f.mode.tick();f.advance(30000);f.sample();await f.mode.tick();assert.equal(f.mode.view().status,'error');assert.match(f.mode.view().reason,/Steam/);await f.mode.tick();assert.equal(f.prepares.length,1);
});
test('actividad: una parada sigue siendo efectiva aunque falle su guardado',async()=>{
 const f=fixture();let release;f.prepare(()=>new Promise(resolve=>release=resolve));f.mode.start(input);await f.mode.tick();f.advance(30000);f.sample();const pending=f.mode.tick();f.failSave();
 assert.doesNotThrow(()=>f.mode.stop());assert.equal(f.mode.active(),false);assert.equal(f.prepares[0].isCurrent(),false);release();await pending;assert.equal(f.mode.view().status,'cancelled');assert.match(f.mode.view().persistenceError,/Disco/);
});

test('sedeo máximo: acepta un servidor vacío sólo tras dos lecturas frescas y mantiene su identidad',async()=>{
 const f=fixture();f.rows([row(2,0)]);const started=f.mode.start({...input,strategy:'maximum',team:'any'});
 assert.equal(started.strategy,'maximum');assert.equal(f.disk.strategy,'maximum');assert.equal(started.minPlayers,0);assert.equal(started.maxEntryPlayers,99);assert.equal(started.seeding.startPlayers,20);
 await f.mode.tick();await f.mode.tick();assert.equal(f.prepares.length,0);assert.equal(f.mode.view().samples[0].consecutiveSamples,1);
 f.advance(30000);f.sample();await f.mode.tick();assert.equal(f.prepares.length,1);assert.equal(f.prepares[0].target.server,2);assert.equal(f.prepares[0].target.joinId,id);
 assert.equal(f.prepares[0].session.settings.startPlayers,20);assert.equal(f.prepares[0].session.settings.team,'any');assert.equal(f.prepares[0].session.sessionEndAt,started.endAt);assert.match(f.mode.view().reason,/movimiento espera 20 jugadores/);
});

test('sedeo máximo: ignora el mínimo de entrada anterior de 16 pero conserva el umbral de partida y los ajustes',async()=>{
 for(const startPlayers of [20,30]){
  const f=fixture();f.rows([row(4,1)]);const started=f.mode.start({durationMinutes:720,strategy:'maximum',minPlayers:16,maxEntryPlayers:19,seeding:{startPlayers,intervalSeconds:45,holdMs:750}});
  assert.equal(started.minPlayers,0);assert.equal(started.maxEntryPlayers,99);assert.equal(started.endAt,'2026-10-30T22:00:00.000Z');assert.deepEqual(started.seeding,{startPlayers,intervalSeconds:45,holdMs:750,mousePause:{enabled:true,resumeAfterSeconds:3}});
  await f.mode.tick();f.advance(30000);f.sample();await f.mode.tick();assert.equal(f.prepares[0].target.server,4);assert.deepEqual(f.prepares[0].session.settings,{startPlayers,intervalSeconds:45,holdMs:750,mousePause:{enabled:true,resumeAfterSeconds:3}});
 }
});

test('sedeo máximo: prioriza llenar antes que un vacío y reproduce la oportunidad nocturna sin exigir 16 jugadores',async()=>{
 const f=fixture();f.rows([{...row(1,96),seedingActive:false},row(2,0),row(3,0),row(4,1),{...row(5,0),seedingActive:false}]);
 f.mode.start({...input,strategy:'maximum',minPlayers:16,maxEntryPlayers:19});await f.mode.tick();f.advance(30000);f.sample();await f.mode.tick();assert.equal(f.prepares.length,1);assert.equal(f.prepares[0].target.server,4);
 const filling=fixture();filling.rows([row(1,0),row(2,19),row(3,5)]);filling.mode.start({...input,strategy:'maximum'});await filling.mode.tick();filling.advance(30000);filling.sample();await filling.mode.tick();assert.equal(filling.prepares[0].target.server,2);
 const empty=fixture();empty.rows([{...row(1,0),seedingActive:false},row(2,0),row(3,0)]);empty.mode.start({...input,strategy:'maximum'});await empty.mode.tick();empty.advance(30000);empty.sample();await empty.mode.tick();assert.equal(empty.prepares[0].target.server,2);
});

test('sedeo máximo: vacío no permite entrar con fuente inválida, inactivo, lleno, umbral alcanzado o ID ausente',async()=>{
 const bad=[r=>r.trusted=false,r=>r.online=false,r=>r.stale=true,r=>r.seedingActive=false,r=>r.players=-1,r=>r.players=20,r=>{r.players=1;r.capacity=1;},r=>r.joinId='bad',r=>r.sourceAt=new Date(initial-90001).toISOString(),r=>r.capacity=0];
 for(const alter of bad){const f=fixture();const set=at=>{const r=row(2,0,at);alter(r);f.rows([r]);};set(initial);f.mode.start({...input,strategy:'maximum'});await f.mode.tick();f.advance(30000);set(initial+30000);await f.mode.tick();assert.equal(f.prepares.length,0);assert.equal(f.mode.view().samples.length,0);}
 const threshold=fixture();threshold.rows([{...row(2,9),publicRule:{tope:9}}]);threshold.mode.start({...input,strategy:'maximum'});await threshold.mode.tick();threshold.advance(30000);threshold.sample();await threshold.mode.tick();assert.equal(threshold.prepares.length,0);
});

test('sedeo máximo: no abandona el servidor preparado aunque aparezca otro candidato mejor',async()=>{
 const f=fixture();f.rows([row(2,0)]);f.mode.start({...input,strategy:'maximum'});await f.mode.tick();f.advance(30000);f.sample();await f.mode.tick();assert.equal(f.mode.view().status,'prepared');
 f.advance(30000);f.rows([row(1,19,initial+60000),row(2,1,initial+60000)]);await f.mode.tick();assert.equal(f.prepares.length,1);assert.equal(f.mode.view().selectedServer,2);
});

test('sedeo máximo: su plazo total vence y no se convierte en vigilancia infinita con la ventana abierta',async()=>{
 const f=fixture();f.rows([]);f.mode.start({durationMinutes:1,strategy:'maximum'});await f.mode.tick();assert.match(f.mode.view().reason,/también vacío/);
 f.advance(60000,{wall:false});await f.mode.tick();assert.equal(f.mode.view().status,'expired');assert.match(f.mode.view().reason,/Sedeo máximo/);f.rows([row(2,0)]);await f.mode.tick();assert.equal(f.prepares.length,0);
});

test('sedeo máximo: cancelar durante la preparación revoca su continuación sin tocar un nuevo trabajo',async()=>{
 const f=fixture();let release;f.prepare(()=>new Promise(resolve=>release=resolve));f.rows([row(2,0)]);const previous=f.mode.start({...input,strategy:'maximum'});await f.mode.tick();f.advance(30000);f.sample();const pending=f.mode.tick();assert.equal(f.mode.view().status,'launching');
 f.mode.stop('Detenido con F8.');assert.equal(f.prepares[0].isCurrent(),false);const next=f.mode.start({...input,strategy:'activity'});assert.notEqual(next.id,previous.id);release();await pending;assert.deepEqual(f.mode.view(),next);assert.equal(f.prepares.length,1);
});

test('sedeo máximo: reiniciar interrumpe, y el modo de actividad antiguo sigue rechazando vacíos y mínimo cero',async()=>{
 const maximum=fixture();maximum.rows([row(2,0)]);maximum.mode.start({...input,strategy:'maximum'});const restarted=maximum.build();assert.equal(restarted.view().status,'interrupted');assert.equal(restarted.view().strategy,'maximum');await restarted.tick();assert.equal(maximum.prepares.length,0);
 for(const strategy of [undefined,'activity']){const f=fixture();f.rows([row(2,0)]);f.mode.start({...input,...(strategy?{strategy}:{})});assert.equal(f.mode.view().strategy,'activity');assert.equal(f.mode.view().minPlayers,1);await f.mode.tick();f.advance(30000);f.sample();await f.mode.tick();assert.equal(f.prepares.length,0);assert.throws(()=>fixture().mode.start({...input,...(strategy?{strategy}:{}),minPlayers:0}));}
});

test('sedeo máximo: rechaza estrategia y duración inválidas antes de guardar o preparar',()=>{
 for(const strategy of ['Maximum','max','',null,0,true,{}]){const f=fixture();assert.throws(()=>f.mode.start({...input,strategy}),/actividad o sedeo máximo/);assert.equal(f.mode.view(),null);assert.equal(f.disk,null);assert.equal(f.prepares.length,0);}
 for(const durationMinutes of [0,721,null,1.5]){const f=fixture();assert.throws(()=>f.mode.start({durationMinutes,strategy:'maximum'}),/Duración/);assert.equal(f.mode.view(),null);assert.equal(f.disk,null);}
 const badMovement=fixture();assert.throws(()=>badMovement.mode.start({...input,strategy:'maximum',seeding:{holdMs:1}}));assert.equal(badMovement.mode.view(),null);
 for(const startPlayers of [1,19]){const f=fixture();assert.throws(()=>f.mode.start({...input,strategy:'maximum',seeding:{startPlayers}}),/al menos 20 jugadores/);assert.equal(f.mode.view(),null);assert.equal(f.disk,null);assert.equal(f.prepares.length,0);}
});
