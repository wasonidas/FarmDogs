'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createObserver}=require('../src/server.cjs');
const {VIP_SOURCE,SEED_SOURCE}=require('../src/account-import.cjs');
const {IDENTITY_SOURCE}=require('../src/clan-association.cjs');
const PUBLIC_URL='https://api.wardogsspain.com/api/portal/public/wardogs-servers';
const PUBLIC_PREFIX='https://api.wardogsspain.com/api/portal/public/clanes/equipo/';
const readerId='11111111-2222-4333-8444-555555555555',otherReader='22222222-3333-4444-8555-666666666666';
const accountId='76561198000000001',team={slug:'arc-troopers',tag:'SYN',nombre:'Synthetic Clan'};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function snapshot(at,{equipo=team,identity=true,reader=readerId}={}){
 const observedAt=new Date(at).toISOString(),cuenta={steamId:accountId,...(equipo==='absent'?{}:{equipo}),privateExtra:'must-not-forward'};
 return {format:'wardogs-account-snapshot-v1',readerId:reader,observedAt,
  vip:{observedAt,source:VIP_SOURCE,data:{prioridad:{comprobado:true,tiene:false},historial:[]}},
  seeding:{observedAt,source:SEED_SOURCE,data:{ahora:observedAt,estado:'nada'}},
  ...(identity?{identity:{observedAt,source:IDENTITY_SOURCE,data:{conectado:true,cuenta}}}:{})};
}
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'farmdogs-clan-api-'));let at=Date.parse('2026-10-31T20:00:00Z'),mono=0,serverOffline=false,clanOffline=false,clanFetcher=null;
 const requests=[],helpers=[];
 const service=createObserver({port:0,dataDir:dir,utcNow:()=>at,monoNow:()=>mono,autoUpdate:false,
  launcher:{availability:()=>({game:false,movement:false,automaticMovement:false,automaticEntry:false}),openGame:async()=>{helpers.push('game');throw Error('No real launches allowed');},openMovementBackground:async()=>{helpers.push('movement');throw Error('No real launches allowed');}},
  teamClickerOptions:{capabilityCheck:()=>false,spawnProcess:()=>{helpers.push('team');throw Error('No real helpers allowed');}},
  fetchImpl:async(url,options)=>{
   requests.push({url,options});
   if(url===PUBLIC_URL){if(serverOffline)throw Error('Synthetic public outage');return Response.json({configured:true,fetchedAt:at,servers:[1,2,3,4,5].map(number=>({id:number+10,num:number,name:'Synthetic server '+number,players:10,maxPlayers:100,online:true,configured:true,sedeoActivo:true}))});}
   assert.equal(url,PUBLIC_PREFIX+'arc-troopers','Only the official public clan route is permitted');
   assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
   if(clanFetcher)return clanFetcher(url,options);if(clanOffline)return new Response('{}',{status:503});
   return Response.json({equipo:{id:29,...team},ahora:[{nombre:'Synthetic One',servidor:1,faccion:'Manticore'},{nombre:'Synthetic Two',servidor:1,faccion:'Valkyra'},{nombre:'Synthetic Three',servidor:'3',faccion:'Lonestar'},{nombre:'Synthetic Four',servidor:3,faccion:'White'}]});
  }});
 const url=await service.ready;
 t.after(async()=>{await service.close();const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(dir));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(dir).startsWith('farmdogs-clan-api-'));await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:20});});
 const state=async()=>{const response=await fetch(url+'/api/state');assert.equal(response.status,200);return response.json();};
 const post=async(route,input)=>{const current=await state();return fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':current.token},body:JSON.stringify(input)});};
 return {service,state,post,requests,helpers,get at(){return at;},advance(ms){at+=ms;mono+=ms;},serverOffline:value=>serverOffline=value,clanOffline:value=>clanOffline=value,clanFetch:fn=>clanFetcher=fn,clanCalls:()=>requests.filter(row=>row.url.startsWith(PUBLIC_PREFIX))};
}

test('API clan: sin asociación Steam nunca consulta clan ni inventa un servidor con compañeros',async t=>{
 const f=await fixture(t);for(let i=0;i<3;i++)await f.service.tick();const state=await f.state();
 assert.equal(state.clanPresence.status,'login_required');assert.equal(state.clanPresence.clan,null);assert.deepEqual(Object.keys(state.clanPresence.servers),['1','2','3','4','5']);assert.ok(Object.values(state.clanPresence.servers).every(row=>row.status==='unknown'&&row.reportedCount===null));assert.equal(f.clanCalls().length,0);assert.deepEqual(f.helpers,[]);
});

test('API clan: snapshot real normalizado de cuenta identifica clan y publica conteos/facciones sin helpers',async t=>{
 const f=await fixture(t);const response=await f.post('/api/account/import',snapshot(f.at));assert.equal(response.status,200);await f.service.tick();const state=await f.state();
 assert.equal(state.account.clanAssociation.status,'member');assert.equal(state.account.clanAssociation.accountId,accountId);assert.equal(state.clanPresence.status,'ready');assert.equal(state.clanPresence.clan.slug,'arc-troopers');
 assert.deepEqual(state.clanPresence.servers[1],{status:'present',reportedCount:2,teams:{blue:0,red:1,green:1,unassigned:0}});assert.deepEqual(state.clanPresence.servers[3],{status:'present',reportedCount:2,teams:{blue:1,red:0,green:0,unassigned:1}});assert.equal(state.clanPresence.servers[2].status,'empty');assert.equal(state.clanPresence.selfExcluded,false);
 assert.equal(state.clanPresence.observedAt,new Date(f.at).toISOString());assert.equal(f.clanCalls().length,1);assert.equal(JSON.stringify(state.clanPresence).includes('Synthetic One'),false);assert.equal(JSON.stringify(state.account.clanAssociation).includes('must-not-forward'),false);assert.deepEqual(f.helpers,[]);
});

test('API clan: desconectar otro lector no borra la cuenta; el lector vigente quita verde inmediatamente',async t=>{
 const f=await fixture(t);await f.post('/api/account/import',snapshot(f.at));await f.service.tick();assert.equal((await f.state()).clanPresence.servers[1].status,'present');
 assert.equal((await f.post('/api/account/disconnect',{readerId:otherReader})).status,200);assert.equal((await f.state()).clanPresence.status,'ready');
 const response=await f.post('/api/account/disconnect',{readerId});assert.equal(response.status,200);const disconnected=await response.json();assert.equal(disconnected.clanPresence.status,'login_required');assert.equal(disconnected.account.clanAssociation.status,'disconnected');assert.equal(disconnected.clanPresence.servers[1].status,'unknown');assert.equal(disconnected.clanPresence.observedAt,null);await f.service.tick();assert.equal(f.clanCalls().length,1);
});

test('API clan: identidad privada a cien segundos vuelve a desconocido sin reutilizar caché verde',async t=>{
 const f=await fixture(t);await f.post('/api/account/import',snapshot(f.at));await f.service.tick();f.advance(100000);const expired=await f.state();
 assert.equal(expired.account.clanAssociation.status,'unknown');assert.equal(expired.clanPresence.status,'unavailable');assert.equal(expired.clanPresence.clan,null);assert.equal(expired.clanPresence.servers[1].status,'unknown');await f.service.tick();assert.equal(f.clanCalls().length,1);
});

test('API clan: catálogo offline y endpoint de clan caído se muestran desconocidos sin falso verde',async t=>{
 const f=await fixture(t);await f.post('/api/account/import',snapshot(f.at));await f.service.tick();f.advance(30000);f.serverOffline(true);await f.service.refresh();
 const publicOutage=await f.state();assert.ok(publicOutage.source.error);assert.ok(Object.values(publicOutage.clanPresence.servers).every(row=>row.status==='unknown'&&row.reportedCount===null));
 f.advance(30000);f.serverOffline(false);f.clanOffline(true);await f.service.refresh();await f.service.tick();const clanOutage=await f.state();assert.equal(clanOutage.clanPresence.status,'unavailable');assert.ok(Object.values(clanOutage.clanPresence.servers).every(row=>row.status==='unknown'));assert.deepEqual(f.helpers,[]);
});

test('API clan: equipo null confirma ausencia; campo ausente, objeto vacío o identidad heredada no la inventan',async t=>{
 const f=await fixture(t);
 for(const [options,status] of [[{equipo:null},'no_clan'],[{equipo:'absent'},'unavailable'],[{equipo:{}},'unavailable'],[{identity:false},'unavailable']]){
  const response=await f.post('/api/account/import',snapshot(f.at,options));assert.equal(response.status,200);await f.service.tick();const state=await f.state();assert.equal(state.clanPresence.status,status);assert.equal(state.clanPresence.clan,null);
 }
 assert.equal(f.clanCalls().length,0);
});

test('API clan: identidad con fuente distinta se rechaza antes de guardar o consultar roster',async t=>{
 const f=await fixture(t),input=snapshot(f.at);input.identity.source='https://untrusted.example/yo';const response=await f.post('/api/account/import',input);assert.equal(response.status,400);assert.match((await response.json()).error,/fuente de identidad/);assert.equal((await f.state()).clanPresence.status,'login_required');assert.equal(f.clanCalls().length,0);
});

test('API clan: desconectar durante una respuesta pendiente la aborta y descarta sin servicio.tick previo',async t=>{
 const f=await fixture(t);let resolve;f.clanFetch(()=>new Promise(done=>resolve=done));assert.equal((await f.post('/api/account/import',snapshot(f.at))).status,200);await settle();assert.equal(f.clanCalls().length,1);
 const signal=f.clanCalls()[0].options.signal;assert.equal(signal.aborted,false);const response=await f.post('/api/account/disconnect',{readerId});assert.equal(response.status,200);assert.equal((await response.json()).clanPresence.status,'login_required');assert.equal(signal.aborted,true);
 resolve(Response.json({equipo:team,ahora:[{servidor:1,faccion:'Lonestar'}]}));await f.service.tick();const state=await f.state();assert.equal(state.clanPresence.status,'login_required');assert.equal(state.clanPresence.observedAt,null);assert.equal(state.clanPresence.servers[1].reportedCount,null);
});
