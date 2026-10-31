const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRewardProtection}=require('../src/reward-protection.cjs');

const SOURCE='https://api.wardogsspain.com/api/cuenta/retos';
const ACCOUNT='76561198000000001';
const OTHER_ACCOUNT='76561198000000002';
const READER='9c430e28-f454-4751-bad1-07d5199f8287';
const OTHER='9c430e28-f454-4751-bad1-07d5199f8288';
const START=Date.parse('2026-11-03T22:50:00.000Z');
const DEADLINE='2026-11-03T23:00:00.000Z';
const milestone=(id='semanal_3',extra={})=>({id,n:id==='semanal_3'?3:6,dias:id==='semanal_3'?1:2,alcanzado:true,cobrado:false,...extra});
function data(extra={}){return {activos:true,semana:'2026-11-02',hasta:'2026-11-08T23:00:00.000Z',hitos:[milestone()],anterior:{semana:'2026-10-26',cobrarHasta:DEADLINE,hitos:[milestone()]},...extra};}
function fixture(){
 let wall=START,mono=0,disk=null,fail=false;
 const events=[];
 const build=()=>createRewardProtection({load:()=>structuredClone(disk),save:value=>{if(fail)throw Error('Disco no disponible');disk=structuredClone(value);},now:()=>wall,monoNow:()=>mono,event:(...args)=>events.push(args)});
 const policy=build();
 return {policy,build,events,get disk(){return disk;},get wall(){return wall;},get mono(){return mono;},setDisk(value){disk=value;},failSave(value=true){fail=value;},advance(ms,{clock=true}={}){mono+=ms;if(clock)wall+=ms;},shiftWall(ms){wall+=ms;},shiftMono(ms){mono+=ms;},observe(payload=data(),extra={}){return policy.observe({readerId:READER,accountId:ACCOUNT,observedAt:new Date(wall).toISOString(),source:SOURCE,data:payload,...extra});},next(){return policy.next({readerId:READER});},authorize(command){return policy.authorize({readerId:READER,commandId:command.id});}};
}

test('premios: empieza desactivado y no deduce caducidad del reinicio semanal',()=>{
 const f=fixture();assert.equal(f.policy.view().enabled,false);assert.equal(f.observe(),true);assert.equal(f.next(),null);
 f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.advance(1);f.observe(data({anterior:null,hasta:new Date(f.wall+60000).toISOString()}));
 assert.equal(f.next(),null);const pending=f.policy.view().pending[0];assert.equal(pending.deadline,null);assert.equal(pending.status,'awaiting_rollover');
 assert.equal(pending.projectedRollover,new Date(f.wall+60000).toISOString());
});

test('premios: emite una orden inmutable de la semana previa y guarda antes de entregarla',()=>{
 const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.observe();const command=f.next();
 assert.ok(Object.isFrozen(command));assert.equal(command.contextWeek,'2026-11-02');assert.equal(command.week,'2026-10-26');assert.equal(command.anterior,true);assert.equal(command.hito,'semanal_3');assert.equal(command.dias,1);
 assert.equal(command.deadline,DEADLINE);assert.equal(command.notBefore,'2026-11-03T22:45:00.000Z');assert.equal(Date.parse(command.expiresAt)-f.wall,20000);
 assert.equal(f.disk.attempts[0].id,command.id);assert.equal(f.disk.attempts[0].status,'reserved');assert.equal(f.next(),null);
 assert.equal(f.authorize(command).id,command.id);assert.equal(f.policy.next({readerId:OTHER}),null);
});

test('premios: el margen usa cobrarHasta y acepta el instante inicial pero nunca el límite vencido',()=>{
 for(const delta of [-300001,-300000,600000,600001]){
  const f=fixture();f.shiftWall(delta);f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.observe();assert.equal(!!f.next(),delta===-300000);
 }
 const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT,leadMinutes:5});f.observe();assert.equal(f.next(),null);f.advance(300000);f.observe();assert.ok(f.next());
});

test('premios: el segundo hito conserva los dos días y solo se entrega tras resolver el primero',async()=>{
 const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.observe(data({anterior:{cobrarHasta:DEADLINE,hitos:[milestone(),milestone('semanal_6')]}}));
 const commands=await Promise.all([Promise.resolve().then(()=>f.next()),Promise.resolve().then(()=>f.next()),Promise.resolve().then(()=>f.next())]);
 assert.equal(commands.filter(Boolean).length,1);const first=commands.find(Boolean);
 f.authorize(first);
 assert.equal(f.policy.result({readerId:READER,commandId:first.id,status:'success'}),true);
 const second=f.next();assert.equal(second.hito,'semanal_6');assert.equal(second.dias,2);assert.equal(f.disk.attempts.length,2);
});

test('premios: un reinicio bloquea duplicados aunque se renueve el lector y el estado sea incierto',()=>{
 const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.observe();const command=f.next(),restarted=f.build();
 assert.equal(restarted.view().attempts[0].status,'uncertain');assert.equal(restarted.authorize({readerId:READER,commandId:command.id}),null);
 assert.equal(restarted.observe({readerId:OTHER,accountId:ACCOUNT,observedAt:new Date(f.wall).toISOString(),source:SOURCE,data:data()}),true);
 assert.equal(restarted.next({readerId:OTHER}),null);assert.equal(restarted.view().enabled,true);
});

test('premios: autoriza una sola vez y persiste el permiso antes de devolverlo',()=>{
 const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.observe();const command=f.next();
 const authorized=f.authorize(command);assert.equal(authorized.authorizedAt,new Date(f.wall).toISOString());assert.equal(f.disk.attempts[0].authorizedAt,authorized.authorizedAt);assert.equal(f.authorize(command),null);
 const failed=fixture();failed.policy.configure({enabled:true,ownerAccountId:ACCOUNT});failed.observe();const c=failed.next();failed.failSave();assert.throws(()=>failed.authorize(c),/Disco/);assert.equal(failed.policy.view().attempts[0].authorizedAt,undefined);failed.failSave(false);assert.ok(failed.authorize(c));assert.equal(failed.authorize(c),null);
});

test('premios: no revalida muestras viejas, repetidas, futuras ni de otro lector o fuente',()=>{
 for(const patch of [{observedAt:new Date(START-100001).toISOString()},{observedAt:new Date(START+1).toISOString()},{observedAt:'2026-11-03T22:50:00'},{source:'https://wardogsspain.com/api/cuenta/retos'},{readerId:'invalid'}]){
  const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});assert.equal(f.observe(data(),patch),false);assert.equal(f.next(),null);
 }
 const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.observe();assert.equal(f.observe(data(),{readerId:OTHER}),false);assert.equal(f.policy.view().source.readerId,READER);
 assert.equal(f.observe(),false);assert.equal(f.next(),null);f.advance(1);assert.equal(f.observe(),true);f.advance(1);assert.equal(f.observe(data(),{observedAt:new Date(START).toISOString()}),false);assert.equal(f.next(),null);
});

test('premios: la antigüedad depende también del reloj monótono y no se rejuvenece con UTC',()=>{
 const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.observe();f.advance(100001,{clock:false});assert.equal(f.next(),null);assert.equal(f.policy.view().source.fresh,false);
 const rollback=fixture();rollback.policy.configure({enabled:true,ownerAccountId:ACCOUNT});rollback.observe();rollback.advance(50000);rollback.shiftWall(-60000);assert.equal(rollback.next(),null);
 const mono=fixture();mono.policy.configure({enabled:true,ownerAccountId:ACCOUNT});mono.observe();mono.shiftMono(-1);assert.equal(mono.next(),null);
});

test('premios: caduca la concesión a los veinte segundos y la reserva impide repetir el POST',()=>{
 const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.observe();const command=f.next();f.advance(20000,{clock:false});assert.equal(f.authorize(command),null);assert.equal(f.next(),null);
 const wall=fixture();wall.policy.configure({enabled:true,ownerAccountId:ACCOUNT});wall.observe();const other=wall.next();wall.shiftWall(20000);assert.equal(wall.authorize(other),null);
 const rollback=fixture();rollback.policy.configure({enabled:true,ownerAccountId:ACCOUNT});rollback.observe();const c=rollback.next();rollback.shiftWall(-1);assert.equal(rollback.authorize(c),null);
});

test('premios: desconectar o desactivar revoca las órdenes incluso si se vuelve a activar',()=>{
 const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.observe();const command=f.next();assert.equal(f.policy.disconnect(OTHER),false);assert.ok(f.authorize(command));
 assert.equal(f.policy.disconnect(READER),true);assert.equal(f.authorize(command),null);assert.equal(f.policy.view().attempts[0].status,'uncertain');assert.equal(f.policy.view().source.connected,false);
 f.advance(1);assert.equal(f.observe(),true);assert.equal(f.next(),null);
 const disabled=fixture();disabled.policy.configure({enabled:true,ownerAccountId:ACCOUNT});disabled.observe();const c=disabled.next();disabled.policy.configure({enabled:false});assert.equal(disabled.authorize(c),null);disabled.policy.configure({enabled:true,ownerAccountId:ACCOUNT});assert.equal(disabled.authorize(c),null);assert.equal(disabled.next(),null);
});

test('premios: no autoriza si una nueva observación cambia el contexto, el plazo o la elegibilidad',()=>{
 const variants=[data({activos:false}),data({vip:{permanente:true}}),data({anterior:null}),data({anterior:{cobrarHasta:'2026-11-03T23:01:00.000Z',hitos:[milestone()]}}),data({anterior:{cobrarHasta:DEADLINE,hitos:[milestone('semanal_3',{alcanzado:false})]}}),data({semana:'2026-11-09',anterior:{cobrarHasta:DEADLINE,hitos:[milestone()]}})];
 for(const payload of variants){const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.observe();const command=f.next();f.advance(1);f.observe(payload);assert.equal(f.authorize(command),null);}
});

test('premios: requiere semana lunes real, límite ISO explícito y hitos oficiales sin duplicados',()=>{
 const cases=[data({semana:'2026-02-30'}),data({semana:'2026-11-03'}),data({semana:'2026-11-02T00:00:00Z'}),data({anterior:{semana:'2026-10-19',cobrarHasta:DEADLINE,hitos:[milestone()]}}),data({anterior:{cobrarHasta:'2026-11-03T23:00:00',hitos:[milestone()]}}),data({anterior:{cobrarHasta:DEADLINE,hitos:[milestone('semanal_3',{dias:2})]}}),data({anterior:{cobrarHasta:DEADLINE,hitos:[milestone(),milestone()]}}),data({anterior:{cobrarHasta:DEADLINE,hitos:[milestone('semanal_3',{alcanzado:1})]}}),data({anterior:{cobrarHasta:DEADLINE,hitos:[milestone('otra')]}})];
 for(const payload of cases){const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.observe(payload);assert.equal(f.next(),null);}
});

test('premios: un fallo al persistir no entrega ni conserva una reserva fantasma',()=>{
 const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.observe();f.failSave();assert.throws(()=>f.next(),/Disco/);assert.equal(f.policy.view().attempts.length,0);assert.equal(f.disk.attempts.length,0);
 f.failSave(false);assert.ok(f.next());assert.equal(f.disk.attempts.length,1);
 const enabled=fixture();enabled.failSave();assert.throws(()=>enabled.policy.configure({enabled:true,ownerAccountId:ACCOUNT}),/Disco/);assert.equal(enabled.policy.view().enabled,false);
});

test('premios: un fallo al guardar la desactivación deja la protección detenida en memoria',()=>{
 const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.observe();const command=f.next();f.failSave();assert.throws(()=>f.policy.configure({enabled:false}));assert.equal(f.policy.view().enabled,false);assert.equal(f.policy.view().storageError,true);assert.equal(f.authorize(command),null);assert.equal(f.next(),null);
});

test('premios: resultados inciertos o fallidos nunca generan reintentos de ese hito',()=>{
 for(const status of ['success','already_claimed','uncertain','error','skipped']){
  const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.observe();const command=f.next();assert.equal(f.policy.result({readerId:OTHER,commandId:command.id,status}),false);assert.equal(f.policy.result({readerId:READER,commandId:command.id,status:'inventado'}),false);
  if(status==='success'||status==='already_claimed')f.authorize(command);
  assert.equal(f.policy.result({readerId:READER,commandId:command.id,status}),true);f.advance(1);f.observe();assert.equal(f.next(),null);assert.equal(f.policy.view().attempts[0].status,status);
 }
});

test('premios: reconcilia un POST incierto únicamente con nueva evidencia de cobrado',()=>{
 const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.observe();const command=f.next();f.policy.result({readerId:READER,commandId:command.id,status:'uncertain'});f.advance(1);
 assert.equal(f.observe(data({anterior:{cobrarHasta:DEADLINE,hitos:[milestone('semanal_3',{cobrado:true})]}})),true);
 assert.equal(f.policy.view().attempts[0].status,'success');assert.ok(f.policy.view().attempts[0].reconciledAt);assert.equal(f.next(),null);
 const stale=fixture();stale.policy.configure({enabled:true,ownerAccountId:ACCOUNT});stale.observe();const c=stale.next();stale.policy.result({readerId:READER,commandId:c.id,status:'uncertain'});
 assert.equal(stale.observe(data({anterior:{cobrarHasta:DEADLINE,hitos:[milestone('semanal_3',{cobrado:true})]}})),false);assert.equal(stale.policy.view().attempts[0].status,'uncertain');
});

test('premios: guarda los resultados antes de liberar la reserva y no registra mensajes arbitrarios',()=>{
 const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.observe();const command=f.next();f.authorize(command);f.failSave();assert.throws(()=>f.policy.result({readerId:READER,commandId:command.id,status:'success',message:'secret'}));assert.equal(f.policy.view().attempts[0].status,'reserved');assert.equal(f.next(),null);
 f.failSave(false);f.policy.result({readerId:READER,commandId:command.id,status:'success',message:'secret'});assert.equal(JSON.stringify(f.disk).includes('secret'),false);assert.equal(JSON.stringify(f.events).includes('secret'),false);
});

test('premios: valida ajustes, expone clones y no persiste datos privados de progreso',()=>{
 const f=fixture();for(const input of [{enabled:'yes'},{leadMinutes:4},{leadMinutes:121},{leadMinutes:5.5}])assert.throws(()=>f.policy.configure(input));
 f.policy.configure({enabled:true,ownerAccountId:ACCOUNT,leadMinutes:120});assert.equal(f.policy.view().leadMinutes,120);f.observe(data({steamId:'secret',nombre:'private'}));const view=f.policy.view();view.settings.enabled=false;view.pending[0].dias=99;
 assert.equal(f.policy.view().enabled,true);assert.equal(f.policy.view().pending[0].dias,1);assert.equal(JSON.stringify(f.disk).includes('secret'),false);assert.equal(JSON.stringify(f.policy.view()).includes('private'),false);
});

test('premios: un diario ilegible o inválido impide habilitar cobros y no se descarta silenciosamente',()=>{
 const broken=createRewardProtection({load(){throw Error('bad json');}});assert.equal(broken.view().storageError,true);assert.throws(()=>broken.configure({enabled:true,ownerAccountId:ACCOUNT}));
 const f=fixture();f.setDisk({version:1,settings:{enabled:true,leadMinutes:15},attempts:[{}]});const corrupt=f.build();assert.equal(corrupt.view().storageError,true);assert.equal(corrupt.view().enabled,false);assert.throws(()=>corrupt.configure({enabled:true,ownerAccountId:ACCOUNT}));corrupt.configure({enabled:false});assert.deepEqual(f.disk.attempts,[{}]);
});

test('premios: activar exige propietario explícito válido o una cuenta observada recientemente',()=>{
 const f=fixture();assert.throws(()=>f.policy.configure({enabled:true}),/lectura reciente/);assert.equal(f.policy.view().ownerConfigured,false);
 assert.equal(f.observe(),true);f.policy.configure({enabled:true});assert.equal(f.policy.view().ownerConfigured,true);assert.equal(f.next().accountId,ACCOUNT);
 const stale=fixture();stale.observe();stale.advance(100001);assert.throws(()=>stale.policy.configure({enabled:true}),/lectura reciente/);
 const invalid=fixture();for(const ownerAccountId of ['123',12345678901234567,null,'7656119800000000x'])assert.throws(()=>invalid.policy.configure({enabled:true,ownerAccountId}));
 const explicit=fixture();explicit.policy.configure({enabled:true,ownerAccountId:ACCOUNT});assert.equal(explicit.policy.view().ownerConfigured,true);assert.equal(explicit.next(),null);
});

test('premios: un cambio de cuenta nunca transfiere la autorización ni permite cobrar con la nueva sesión',()=>{
 const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.observe();const command=f.next();assert.equal(command.accountId,ACCOUNT);
 f.advance(1);assert.equal(f.observe(data(),{accountId:OTHER_ACCOUNT}),true);assert.equal(f.policy.view().source.accountMatch,false);assert.equal(f.next(),null);assert.equal(f.authorize(command),null);
 assert.throws(()=>f.policy.configure({enabled:true,ownerAccountId:OTHER_ACCOUNT}),/Desactiva primero/);
 f.policy.configure({enabled:true});assert.equal(f.policy.view().source.accountMatch,false);assert.equal(f.next(),null);
 f.policy.configure({enabled:false});f.policy.configure({enabled:true,ownerAccountId:OTHER_ACCOUNT});assert.equal(f.policy.view().source.accountMatch,true);const second=f.next();assert.equal(second.accountId,OTHER_ACCOUNT);assert.equal(f.disk.attempts.length,2);
 const restarted=f.build();assert.equal(restarted.view().ownerConfigured,true);restarted.observe({readerId:OTHER,accountId:ACCOUNT,observedAt:new Date(f.wall).toISOString(),source:SOURCE,data:data()});assert.equal(restarted.view().source.accountMatch,false);assert.equal(restarted.next({readerId:OTHER}),null);
});

test('premios: el progreso de otra cuenta no reconcilia un cobro pendiente y la vista oculta SteamID64',()=>{
 const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.observe();const command=f.next();f.policy.result({readerId:READER,commandId:command.id,status:'uncertain'});
 f.advance(1);f.observe(data({anterior:{cobrarHasta:DEADLINE,hitos:[milestone('semanal_3',{cobrado:true})]}}),{accountId:OTHER_ACCOUNT});assert.equal(f.policy.view().attempts[0].status,'uncertain');
 const json=JSON.stringify(f.policy.view());assert.equal(json.includes(ACCOUNT),false);assert.equal(json.includes(OTHER_ACCOUNT),false);assert.equal(JSON.stringify(f.disk).includes(ACCOUNT),true);
 f.advance(1);f.observe(data({anterior:{cobrarHasta:DEADLINE,hitos:[milestone('semanal_3',{cobrado:true})]}}));assert.equal(f.policy.view().attempts[0].status,'success');
 const invalid=fixture();invalid.policy.configure({enabled:true,ownerAccountId:ACCOUNT});assert.equal(invalid.observe(data(),{accountId:undefined}),false);assert.equal(invalid.next(),null);
});

test('premios: acepta epoch milisegundos seguros y normaliza las fechas al guardar',()=>{
 const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});
 assert.equal(f.observe(data({hasta:Date.parse('2026-11-08T23:00:00.000Z'),anterior:{cobrarHasta:Date.parse(DEADLINE),hitos:[milestone()]}}),{observedAt:START}),true);
 const command=f.next();assert.equal(command.deadline,DEADLINE);assert.equal(f.disk.attempts[0].deadline,DEADLINE);assert.equal(f.policy.view().pending[0].projectedRollover,'2026-11-08T23:00:00.000Z');
 for(const invalid of [Math.floor(Date.parse(DEADLINE)/1000),NaN,Infinity,Date.parse(DEADLINE)+0.5,Date.UTC(1999,11,31),Date.UTC(2101,0,1),'2026-11-03','2026-11-03T23:00:00','2026-02-30T23:00:00Z']){
  const bad=fixture();bad.policy.configure({enabled:true,ownerAccountId:ACCOUNT});bad.observe(data({anterior:{cobrarHasta:invalid,hitos:[milestone()]}}));assert.equal(bad.next(),null);
 }
});

test('premios: un resultado positivo exige autorización previa incluso al completar tras desconectar',()=>{
 for(const status of ['success','already_claimed']){
  const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.observe();const command=f.next();
  assert.equal(f.policy.result({readerId:READER,commandId:command.id,status}),false);assert.equal(f.policy.view().attempts[0].status,'reserved');
  f.authorize(command);f.policy.disconnect(READER);assert.equal(f.policy.view().attempts[0].status,'uncertain');
  assert.equal(f.policy.result({readerId:READER,commandId:command.id,status}),true);assert.equal(f.policy.view().attempts[0].status,status);
 }
 const observed=fixture();observed.policy.configure({enabled:true,ownerAccountId:ACCOUNT});observed.observe();const command=observed.next();observed.advance(1);observed.observe(data({anterior:{cobrarHasta:DEADLINE,hitos:[milestone('semanal_3',{cobrado:true})]}}));
 assert.equal(observed.policy.view().attempts[0].status,'success');assert.equal(observed.policy.view().attempts[0].authorizedAt,undefined);assert.equal(observed.policy.result({readerId:READER,commandId:command.id,status:'success'}),false);
});

test('premios: un lector nuevo no desplaza a uno reciente ni mediante muestras inválidas',()=>{
 const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.observe();const command=f.next();
 f.advance(100000);assert.equal(f.observe(data(),{readerId:OTHER}),false);assert.equal(f.policy.view().source.readerId,READER);assert.equal(f.policy.view().attempts[0].status,'reserved');
 f.advance(1);
 for(const patch of [{source:'https://evil.invalid/api/cuenta/retos'},{accountId:'bad'},{observedAt:new Date(f.wall+1).toISOString()},{observedAt:new Date(START).toISOString()},{data:{activos:true,semana:'bad'}}]){
  assert.equal(f.observe(data(),{readerId:OTHER,...patch}),false);assert.equal(f.policy.view().source.readerId,READER);assert.equal(f.policy.view().attempts[0].status,'reserved');
 }
 assert.equal(f.policy.authorize({readerId:OTHER,commandId:command.id}),null);
});

test('premios: un lector nuevo válido recupera uno obsoleto sin repetir cobros ni transferir cuenta',()=>{
 for(const authorized of [false,true]){
  const f=fixture();f.policy.configure({enabled:true,ownerAccountId:ACCOUNT});f.observe();const command=f.next();if(authorized)f.authorize(command);
  f.advance(100001);assert.equal(f.observe(data(),{readerId:OTHER}),true);assert.equal(f.policy.view().source.readerId,OTHER);assert.equal(f.policy.view().source.fresh,true);assert.equal(f.disk.attempts[0].status,'uncertain');assert.equal(f.policy.next({readerId:OTHER}),null);assert.equal(f.disk.attempts.length,1);
  assert.equal(f.policy.result({readerId:READER,commandId:command.id,status:'success'}),authorized);assert.equal(f.policy.view().attempts[0].status,authorized?'success':'uncertain');
  f.advance(100001);assert.equal(f.observe(data(),{observedAt:new Date(START).toISOString()}),false);assert.equal(f.policy.view().source.readerId,OTHER);
 }
 const otherAccount=fixture();otherAccount.policy.configure({enabled:true,ownerAccountId:ACCOUNT});otherAccount.observe();otherAccount.advance(100001);assert.equal(otherAccount.observe(data(),{readerId:OTHER,accountId:OTHER_ACCOUNT}),true);assert.equal(otherAccount.policy.view().source.accountMatch,false);assert.equal(otherAccount.policy.next({readerId:OTHER}),null);
 const mono=fixture();mono.policy.configure({enabled:true,ownerAccountId:ACCOUNT});mono.observe();mono.advance(100001,{clock:false});assert.equal(mono.observe(data(),{readerId:OTHER}),false);assert.equal(mono.policy.view().source.readerId,READER);mono.shiftWall(1);assert.equal(mono.observe(data(),{readerId:OTHER}),true);assert.equal(mono.policy.view().source.readerId,OTHER);
});
