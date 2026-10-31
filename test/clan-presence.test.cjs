'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createClanPresence}=require('../src/clan-presence.cjs');
const accountId='76561198000000001',otherAccount='76561198000000002';
const initial=Date.parse('2026-10-31T19:30:00Z');
const payload=(rows=[],slug='clan-alpha')=>({equipo:{slug,tag:'ALPHA',nombre:'Clan Alpha'},ahora:rows});
const defer=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t){
 let at=initial,association={status:'member',accountId,slug:'clan-alpha',tag:'ALPHA',name:'Clan Alpha',observedAt:new Date(at).toISOString()},catalog=null;
 const calls=[],events=[];let fetcher=async()=>Response.json(payload());
 const module=createClanPresence({now:()=>at,getAssociation:()=>association,getServers:()=>catalog||[1,2,3,4,5].map(number=>({number,trusted:true,online:true,stale:false,sourceAt:new Date(at).toISOString()})),fetchImpl:async(url,options)=>{calls.push({url,options});return fetcher(url,options);},event:(name,value)=>events.push({name,...value})});
 t.after(()=>module.close());
 return {module,calls,events,fetch:fn=>fetcher=fn,association:value=>association=value,catalog:value=>catalog=value,advance:ms=>at+=ms,refreshAssociation:()=>association={...association,observedAt:new Date(at).toISOString()},get at(){return at;},get currentAssociation(){return {...association};}};
}

test('clan: consulta pública fija, agrupa las cinco tarjetas y conserva facciones desconocidas',async t=>{
 const f=fixture(t);f.fetch(async()=>Response.json(payload([{nombre:'Fake member',servidor:1,faccion:'Lonestar'},{servidor:'01',faccion:' VALKYRA '},{servidor:3,faccion:'Manticore'},{servidor:3,faccion:'White'},{servidor:3,faccion:'new faction'},{servidor:9,faccion:'Lonestar'},{servidor:'invalid'},{servidor:true},null])));
 assert.equal(f.module.view().status,'loading');const view=await f.module.tick();
 assert.equal(view.status,'ready');assert.deepEqual(Object.keys(view.servers),['1','2','3','4','5']);
 assert.deepEqual(view.servers[1],{status:'present',reportedCount:2,teams:{blue:1,red:1,green:0,unassigned:0}});
 assert.deepEqual(view.servers[3],{status:'present',reportedCount:3,teams:{blue:0,red:0,green:1,unassigned:2}});assert.equal(view.servers[2].status,'empty');assert.equal(view.servers[2].reportedCount,0);
 assert.equal(view.selfExcluded,false);assert.equal(view.observedAt,new Date(initial).toISOString());assert.equal(view.expiresAt,new Date(initial+90000).toISOString());assert.equal(view.refreshSeconds,30);
 assert.equal(f.calls[0].url,'https://api.wardogsspain.com/api/portal/public/clanes/equipo/clan-alpha');assert.equal(f.calls[0].options.credentials,'omit');assert.equal(f.calls[0].options.redirect,'error');
 assert.equal(JSON.stringify(view).includes('Fake member'),false);assert.equal(JSON.stringify(view).includes(accountId),false);assert.equal(Object.hasOwn(view,'fetchedGameTime'),false);
});

test('clan: ausencia comprobada, desconexión y asociación desconocida no se confunden',async t=>{
 const f=fixture(t);
 for(const [association,status] of [[{status:'disconnected',accountId:null},'login_required'],[{status:'unknown',accountId:null},'unavailable'],[{status:'no_clan',accountId,observedAt:new Date(initial).toISOString()},'no_clan']]){
  f.association(association);const view=await f.module.tick();assert.equal(view.status,status);assert.equal(view.clan,null);assert.ok(Object.values(view.servers).every(row=>row.status==='unknown'&&row.reportedCount===null));
 }
 assert.equal(f.calls.length,0);
 f.advance(100000);assert.equal(f.module.view().status,'stale');
});

test('clan: no inventa membresía desde datos incompletos, SteamID numérico o slug arbitrario',async t=>{
 const f=fixture(t),valid=f.currentAssociation;
 for(const change of [{accountId:null},{accountId:Number(accountId)},{accountId:'unknown'},{slug:''},{slug:'../other'},{slug:'https://elsewhere.example'},{slug:'clan-alpha?other=1'},{slug:'%2fother'},{slug:'clan_alpha'},{slug:'a'.repeat(121)},{observedAt:null},{observedAt:new Date(initial+5001).toISOString()}]){
  f.association({...valid,...change});assert.equal((await f.module.tick()).status,'unavailable');
 }
 assert.equal(f.calls.length,0);
});

test('clan: respuestas vacías no son desconocidas y errores nunca conservan verde',async t=>{
 const f=fixture(t);f.fetch(async()=>Response.json(payload([{servidor:1,faccion:'Lonestar'}])));assert.equal((await f.module.tick()).servers[1].status,'present');
 f.advance(30000);f.fetch(async()=>new Response('{}',{status:503}));const failed=await f.module.tick();assert.equal(failed.status,'unavailable');assert.equal(failed.servers[1].status,'unknown');assert.equal(failed.servers[1].reportedCount,null);
 for(let i=0;i<20;i++)await f.module.tick();assert.equal(f.calls.length,2);assert.equal(f.events.filter(event=>event.name==='clan_presence_error').length,1);
 f.advance(30000);f.fetch(async()=>Response.json(payload()));assert.equal((await f.module.tick()).servers[1].status,'empty');
});

test('clan: refresca cada treinta segundos y los plazos público y privado son independientes',async t=>{
 const f=fixture(t);f.fetch(async()=>Response.json(payload([{servidor:1}])));await f.module.tick();
 f.advance(29999);await f.module.tick();assert.equal(f.calls.length,1);f.advance(1);await f.module.tick();assert.equal(f.calls.length,2);
 f.advance(60000);assert.equal(f.module.view().status,'ready');f.advance(10000);assert.equal(f.module.view().status,'stale');assert.match(f.module.view().reason,/cuenta/);
 f.refreshAssociation();assert.equal(f.module.view().status,'ready');f.advance(20000);assert.equal(f.module.view().status,'stale');assert.match(f.module.view().reason,/presencia/);assert.equal(f.module.view().servers[1].status,'stale');
});

test('clan: sólo muestra verde con catálogo público reciente, único y confirmado online',async t=>{
 const f=fixture(t);f.fetch(async()=>Response.json(payload([{servidor:1},{servidor:2},{servidor:3},{servidor:4},{servidor:5}])));await f.module.tick();
 const row=number=>({number,trusted:true,online:true,sourceAt:new Date(f.at).toISOString()});
 f.catalog([{...row(1),trusted:false},{...row(2),online:false},{...row(3),stale:true},{...row(4),sourceAt:new Date(f.at-90001).toISOString()},row(5),row(5)]);
 assert.ok(Object.values(f.module.view().servers).every(value=>value.status==='unknown'&&value.reportedCount===null));
});

test('clan: rechaza identidad pública distinta, JSON/shape incorrectos y listas excesivas',async t=>{
 const f=fixture(t);
 for(const response of [()=>Response.json(payload([],'other-clan')),()=>Response.json({}),()=>Response.json({equipo:{slug:'clan-alpha'},ahora:{}}),()=>Response.json(payload(Array.from({length:1001},()=>({servidor:1})))),()=>new Response('not JSON')]){
  f.fetch(async()=>response());const view=await f.module.tick();assert.equal(view.status,'unavailable');assert.ok(Object.values(view.servers).every(row=>row.status==='unknown'));f.advance(30000);f.refreshAssociation();
 }
});

test('clan: límite de un megabyte se aplica a cabecera y cuerpo transmitido',async t=>{
 const f=fixture(t);f.fetch(async()=>new Response('{}',{headers:{'content-length':String(1024*1024+1)}}));assert.equal((await f.module.tick()).status,'unavailable');assert.equal(f.events.at(-1).code,'response_too_large');
 f.advance(30000);let cancelled=false;f.fetch(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(600000));controller.enqueue(new Uint8Array(600000));},cancel(){cancelled=true;}})));
 assert.equal((await f.module.tick()).status,'unavailable');assert.equal(f.events.at(-1).code,'response_too_large');await settle();assert.equal(cancelled,true);
});

test('clan: tick no duplica la solicitud mientras la anterior sigue pendiente',async t=>{
 const f=fixture(t),pending=defer();f.fetch(()=>pending.promise);const first=f.module.tick(),second=f.module.tick();assert.equal(first,second);await settle();assert.equal(f.calls.length,1);
 pending.resolve(Response.json(payload([{servidor:2}])));await first;assert.equal(f.module.view().servers[2].status,'present');
});

test('clan: cambiar cuenta, clan o desconectar aborta y descarta respuestas tardías',async t=>{
 for(const change of [{status:'disconnected',accountId:null},{accountId:otherAccount},{slug:'clan-bravo'}]){
  const f=fixture(t),pending=defer();f.fetch(()=>pending.promise);const reading=f.module.tick();await settle();assert.equal(f.calls[0].options.signal.aborted,false);
  f.association({...f.currentAssociation,...change});const changed=f.module.view();assert.notEqual(changed.status,'ready');assert.equal(f.calls[0].options.signal.aborted,true);await reading;
  pending.resolve(Response.json(payload([{servidor:1}])));await settle();assert.equal(f.module.view().servers[1].status,'unknown');assert.equal(f.module.view().observedAt,null);
  if(change.status!=='disconnected'){f.fetch(async()=>Response.json(payload([{servidor:3}],change.slug||'clan-alpha')));await f.module.tick();assert.equal(f.module.view().servers[3].status,'present');}
 }
});

test('clan: una desconexión anterior al inicio de red no lanza ni una petición',async t=>{
 const f=fixture(t);const reading=f.module.tick();f.association({status:'disconnected',accountId:null});assert.equal(f.module.view().status,'login_required');await reading;assert.equal(f.calls.length,0);
});

test('clan: una asociación caducada durante la petición no publica una respuesta verde',async t=>{
 const f=fixture(t),pending=defer();f.fetch(()=>pending.promise);const reading=f.module.tick();await settle();f.advance(100000);assert.equal(f.module.view().status,'stale');assert.equal(f.calls[0].options.signal.aborted,true);await reading;
 pending.resolve(Response.json(payload([{servidor:1}])));await settle();assert.equal(f.module.view().observedAt,null);
});

test('clan: timeout de ocho segundos termina aunque fetch ignore la señal y limita reintentos',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t);f.fetch(()=>new Promise(()=>{}));const reading=f.module.tick();await settle();t.mock.timers.tick(8000);await reading;
 assert.equal(f.module.view().status,'unavailable');assert.equal(f.events.at(-1).code,'timeout');assert.equal(f.calls[0].options.signal.aborted,true);await f.module.tick();assert.equal(f.calls.length,1);
});

test('clan: hora de consulta corresponde al éxito y retroceso de reloj nunca crea verde',async t=>{
 const f=fixture(t),pending=defer();f.fetch(()=>pending.promise);const reading=f.module.tick();await settle();f.advance(500);pending.resolve(Response.json(payload([{servidor:1}])));await reading;assert.equal(f.module.view().observedAt,new Date(initial+500).toISOString());
 f.advance(-1000);assert.equal(f.module.view().status,'stale');assert.equal(f.module.view().servers[1].status,'stale');
});

test('clan: nombres/metadata no invalidan identidad y una vista devuelta no modifica la caché',async t=>{
 const f=fixture(t);f.fetch(async()=>Response.json(payload([{servidor:1,faccion:'Manticore'}])));await f.module.tick();
 f.association({...f.currentAssociation,name:'Nombre nuevo',tag:'NEW'});const view=await f.module.tick();assert.equal(f.calls.length,1);assert.equal(view.clan.name,'Nombre nuevo');view.servers[1].teams.green=99;assert.equal(f.module.view().servers[1].teams.green,1);
});

test('clan: cierre aborta sin publicaciones tardías ni nuevas solicitudes',async t=>{
 const f=fixture(t),pending=defer();f.fetch(()=>pending.promise);const reading=f.module.tick();await settle();f.module.close();assert.equal(f.calls[0].options.signal.aborted,true);await reading;pending.resolve(Response.json(payload([{servidor:1}])));await settle();await f.module.tick();
 assert.equal(f.module.view().status,'unavailable');assert.equal(f.module.view().clan,null);assert.equal(f.module.view().observedAt,null);assert.equal(f.calls.length,1);assert.equal(f.events.some(event=>event.name==='clan_presence_updated'),false);
});
