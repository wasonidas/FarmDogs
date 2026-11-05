const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createScheduledOpening}=require('../src/scheduled-opening.cjs');
function fixture(){
 let now=Date.parse('2026-10-30T08:00:00Z'),disk=null,eligible=true,changed=false,failSave=false,launches=0,launch=async()=>{};
 const build=()=>createScheduledOpening({load:()=>structuredClone(disk),save:value=>{if(failSave)throw Error('Disco no disponible');disk=structuredClone(value);},now:()=>now,event:()=>{},resolveTarget:(server,id)=>{if(changed||server!==2||id!=='expected-id')throw Error('Destino cambiado');return {server,joinId:id,entryCandidate:eligible};},openGame:(...args)=>{launches++;return launch(...args);}});
 return {build,advance:ms=>now+=ms,eligible:v=>eligible=v,changed:()=>changed=true,failSave:()=>failSave=true,launch:f=>launch=f,get launches(){return launches;},get disk(){return structuredClone(disk);}};
}
const input={server:2,expectedJoinId:'expected-id',madridStart:'2026-10-30T09:01',onlyEligible:true};

test('programación: solo prepara seeding y no acepta movimiento temporal por el constructor compartido',()=>{
 for(const value of [{purpose:'break'},{purpose:'unknown'},{seeding:{durationMinutes:5,purpose:'break',confirmedDeployed:true}},{seeding:{durationMinutes:5,purpose:'unknown'}}]){
  const f=fixture(),s=f.build();assert.throws(()=>s.schedule({...input,...value}),/solo prepara seeding/);assert.equal(s.view(),null);assert.equal(f.launches,0);
 }
 const f=fixture(),s=f.build();s.schedule({...input,seeding:{durationMinutes:5,purpose:'seeding'}});assert.equal(s.view().status,'scheduled');assert.equal(s.view().seeding.startPlayers,20);
});
test('apertura: solicita una sola vez y no afirma conexión, incluso con ticks concurrentes',async()=>{
 const f=fixture(),s=f.build();s.schedule(input);await s.tick();assert.equal(f.launches,0);
 f.advance(60000);await Promise.all([s.tick(),s.tick(),s.tick()]);assert.equal(f.launches,1);assert.equal(s.view().status,'open_requested');assert.equal(s.view().connected,false);
 await f.build().tick();assert.equal(f.launches,1);
});
test('apertura: cancelar, reiniciar o perder la hora no abre el juego después',async()=>{
 for(const mode of ['cancel','restart','late']){const f=fixture();let s=f.build();s.schedule(input);if(mode==='cancel')s.cancel();if(mode==='restart')s=f.build();f.advance(mode==='late'?120001:60000);await s.tick();assert.equal(f.launches,0);assert.equal(s.view().status,{cancel:'cancelled',restart:'interrupted',late:'missed'}[mode]);}
});
test('apertura: vuelve a comprobar el destino y la oportunidad al ejecutarse',async()=>{
 for(const mode of ['changed','ineligible']){const f=fixture(),s=f.build();s.schedule(input);if(mode==='changed')f.changed();else f.eligible(false);f.advance(60000);await s.tick();assert.equal(f.launches,0);assert.equal(s.view().status,'blocked');}
 const f=fixture(),s=f.build();s.schedule({...input,onlyEligible:false});f.eligible(false);f.advance(60000);await s.tick();assert.equal(f.launches,1);
});
test('apertura: no duplica una solicitud ambigua ni la reanuda tras cerrar durante el lanzamiento',async()=>{
 const f=fixture(),s=f.build();f.launch(async()=>{throw Error('Resultado desconocido');});s.schedule(input);f.advance(60000);await s.tick();assert.equal(s.view().status,'uncertain');await s.tick();assert.equal(f.launches,1);
 const other=fixture(),p=other.build();let finish;other.launch(()=>new Promise(resolve=>finish=resolve));p.schedule(input);other.advance(60000);const pending=p.tick();assert.throws(()=>p.cancel());p.interrupt();finish();await pending;assert.equal(p.view().status,'uncertain');await other.build().tick();assert.equal(other.launches,1);
});
test('apertura: un guardado fallido o una fecha inválida no deja una orden oculta',async()=>{
 const f=fixture(),s=f.build();assert.throws(()=>s.schedule({...input,madridStart:'2027-03-28T02:30'}));assert.equal(s.view(),null);f.failSave();assert.throws(()=>s.schedule(input));assert.equal(s.view(),null);f.advance(60000);await s.tick();assert.equal(f.launches,0);
});
test('programación: conserva los ajustes de seeding y valida antes de guardar',()=>{
 const f=fixture(),s=f.build();assert.throws(()=>s.schedule({...input,seeding:{durationMinutes:0}}));assert.equal(s.view(),null);
 const settings={durationMinutes:75,startPlayers:20,intervalSeconds:45,holdMs:600,server:5};s.schedule({...input,seeding:settings});settings.durationMinutes=1;
 assert.equal(s.view().server,2);assert.deepEqual(s.view().seeding,{durationMinutes:75,startPlayers:20,intervalSeconds:45,holdMs:600,mousePause:{enabled:true,resumeAfterSeconds:3}});
});

test('programación: conserva aleatorio o color fijo para la futura entrada',()=>{
 for(const team of ['any','blue','red','green']){const f=fixture(),s=f.build();s.schedule({...input,team,seeding:{durationMinutes:30}});assert.equal(s.view().team,team);assert.equal(s.view().seeding.durationMinutes,30);}
 const f=fixture(),s=f.build();assert.throws(()=>s.schedule({...input,team:'orange'}));assert.equal(s.view(),null);
});

test('programación: valida y persiste el foco inicial y entrega ese modo al dispararse sin cambiar destino ni presupuesto',async()=>{
 for(const focus of [undefined,'driver','desktop']){
  const f=fixture(),s=f.build();let passed;f.launch((target,job)=>{passed={target,job};});
  s.schedule({...input,...(focus===undefined?{}:{initialFocus:focus}),seeding:{durationMinutes:25,intervalSeconds:45,holdMs:600}});const before=s.view();assert.equal(before.initialFocus,focus||'driver');assert.equal(f.disk.initialFocus,focus||'driver');
  f.advance(60000);await s.tick();assert.equal(passed.job.initialFocus,focus||'driver');assert.equal(passed.job.id,before.id);assert.equal(passed.job.scheduledAt,before.scheduledAt);assert.equal(passed.target.server,2);assert.equal(passed.target.joinId,'expected-id');assert.deepEqual(passed.job.seeding,before.seeding);assert.equal(f.launches,1);
  assert.equal(f.build().view().initialFocus,focus||'driver');
 }
 for(const invalid of [null,'','Desktop','other',true,0,{}]){const f=fixture(),s=f.build();assert.throws(()=>s.schedule({...input,initialFocus:invalid}),/foco inicial/);assert.equal(s.view(),null);assert.equal(f.disk,null);assert.equal(f.launches,0);}
});

test('programación: un ID ajeno no cancela; cancelar por ID revoca un callback pendiente sin modificar el siguiente trabajo',async()=>{
 const f=fixture(),s=f.build();let release,isCurrent;f.launch(async(target,job,current)=>{isCurrent=current;await new Promise(resolve=>release=resolve);assert.equal(current(),false);});
 const original=s.schedule({...input,initialFocus:'desktop'});assert.throws(()=>s.cancel({expectedJobId:'other'}),/cambió/);assert.deepEqual(s.view(),original);
 f.advance(60000);const pending=s.tick();assert.equal(s.view().status,'launching');assert.equal(isCurrent(),true);assert.throws(()=>s.cancel({expectedJobId:'other'}),/cambió/);assert.equal(isCurrent(),true);
 s.cancel({expectedJobId:original.id});assert.equal(s.view().status,'cancelled');assert.equal(isCurrent(),false);
 const next=s.schedule({...input,madridStart:'2026-10-30T09:02',initialFocus:'driver'});assert.notEqual(next.id,original.id);assert.throws(()=>s.cancel({expectedJobId:original.id}),/cambió/);release();await pending;assert.deepEqual(s.view(),next);assert.equal(f.launches,1);
});

test('programación: una cancelación dirigida puede cerrar el trabajo ya solicitado y mantiene el comportamiento legacy',async()=>{
 const f=fixture(),s=f.build(),job=s.schedule(input);f.advance(60000);await s.tick();assert.equal(s.view().status,'open_requested');
 s.cancel();assert.equal(s.view().status,'open_requested');s.cancel({expectedJobId:job.id});assert.equal(s.view().status,'cancelled');assert.equal(f.launches,1);
});
