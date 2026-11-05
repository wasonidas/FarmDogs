'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeMatchRounds,createMatchRoundTracker}=require('../src/match-rounds.cjs');
const START=Date.parse('2026-11-02T19:00:30.578Z');
const JOIN='0665a9c0-80b7-4f32-ad47-f36b70367f10';
const iso=value=>new Date(value).toISOString();
function fixture(){
 let utc=START;
 const server=(extra={})=>({number:1,apiId:3,joinId:JOIN,sourceAt:iso(utc),trusted:true,online:true,stale:false,...extra});
 const live=(extra={})=>({id:2556,server:1,serverId:3,map:'Ozeti',experience:'Madrid_KOTH_01',startedAt:'2026-11-02T18:52:10.563Z',endedAt:iso(utc-20000),live:true,winner:null,scores:[{name:'Lonestar',score:0},{name:'Valkyra',score:1},{name:'Manticore',score:11}],...extra});
 const done=(extra={})=>({id:2551,server:1,serverId:3,map:'Zestafona',experience:'Detroit_KOTH_01',startedAt:'2026-11-02T17:35:44.248Z',endedAt:'2026-11-02T18:51:10.675Z',live:false,winner:'Manticore',scores:[{name:'Lonestar',score:22},{name:'Valkyra',score:15},{name:'Manticore',score:99}],...extra});
 const payload=(extra={})=>({fetchedAt:utc,live:live(),lives:[live()],matches:[done()],...extra});
 const tracker=createMatchRoundTracker({now:()=>utc});
 return {server,live,done,payload,tracker,get now(){return utc;},advance(ms){utc+=ms;},observe(extra={},target={}){return tracker.observe(payload(extra),server(target));}};
}

test('rondas públicas: primer snapshot real es baseline silencioso y endedAt live sólo es heartbeat',()=>{
 const f=fixture();let result=f.observe();assert.equal(result.status,'baseline');assert.equal(result.baselineReady,true);assert.equal(result.wake,null);assert.equal(result.current.id,2556);assert.equal(result.lastCompleted.id,2551);assert.equal(result.lastCompleted.winner,'Manticore');
 for(let n=0;n<3;n++){f.advance(60000);result=f.observe();assert.equal(result.status,'ready');assert.equal(result.wake,null);assert.equal(result.current.observedAt,iso(f.now-20000));}
});

test('rondas públicas: un final nuevo con 99 despierta una vez, sin exigir cien puntos',()=>{
 const f=fixture();f.observe();f.advance(60000);
 const completed=f.done({...f.live(),live:false,winner:'Manticore',endedAt:iso(f.now-1000),scores:[{name:'Manticore',score:99}]});
 const first=f.observe({lives:[],matches:[completed]});assert.equal(first.wake.kind,'completed');assert.equal(first.wake.roundId,2556);assert.equal(first.wake.currentRoundId,2556);assert.equal(first.wake.previousRoundId,2556);assert.equal(first.current,null);assert.equal(first.lastCompleted.id,2556);
 const original=structuredClone(first.wake);assert.deepEqual(f.tracker.view().wake,original);assert.deepEqual(f.observe({lives:[],matches:[completed]}).wake,original);
 f.advance(60000);assert.deepEqual(f.observe({lives:[],matches:[completed]}).wake,original);
 f.advance(31000);assert.equal(f.tracker.view(f.server()).wake,null);
});

test('rondas públicas: cambio de ID fresco en el mismo mapa cubre un final administrativo bajo',()=>{
 const f=fixture();f.observe();f.advance(60000);
 const next=f.live({id:2557,startedAt:iso(f.now-20000),endedAt:iso(f.now-1000)});
 const result=f.observe({lives:[next]});assert.equal(result.wake.kind,'new_round');assert.equal(result.wake.currentRoundId,2557);assert.equal(result.wake.previousRoundId,2556);assert.equal(result.wake.roundStartedAt,next.startedAt);
});

test('rondas públicas: el baseline en intermedio no reproduce finales anteriores ni necesita score100',()=>{
 const f=fixture(),end=iso(f.now-1000),completed=f.done({endedAt:end});const baseline=f.observe({lives:[],matches:[completed]});assert.equal(baseline.wake,null);
 f.advance(60000);assert.equal(f.observe({lives:[],matches:[completed]}).wake,null);
 const next=f.live({id:2556,startedAt:iso(f.now-10000),endedAt:iso(f.now-1000)});assert.equal(f.observe({lives:[next],matches:[completed]}).wake,null,'mismo fetchedAt no interpreta contenido nuevo');
 f.advance(1000);assert.equal(f.observe({lives:[next],matches:[completed]}).wake.kind,'new_round');
});

test('rondas públicas: IDs de API vigentes excluyen el antiguo #5 y el singular root.live no manda',()=>{
 const f=fixture(),target=f.server({number:5,apiId:7});
 const latest=f.live({id:2553,server:5,serverId:7,startedAt:'2026-11-02T17:50:44.609Z'}),obsolete=f.live({id:2284,server:5,serverId:5,startedAt:'2026-10-26T05:06:52.808Z',endedAt:'2026-10-26T07:20:52.889Z'});
 const result=normalizeMatchRounds(f.payload({live:obsolete,lives:[obsolete,latest],matches:[]}),target,f.now);assert.equal(result.ok,true);assert.equal(result.current.id,2553);assert.equal(result.current.observedAt,latest.endedAt);
});

test('rondas públicas: una ronda de trece horas fresca sigue siendo válida',()=>{
 const f=fixture(),result=normalizeMatchRounds(f.payload({lives:[f.live({startedAt:'2026-11-02T05:06:11.259Z'})],matches:[]}),f.server(),f.now);assert.equal(result.ok,true);assert.equal(result.current.id,2556);
});

test('rondas públicas: el final se ordena por identidad y tiempo, no por posición del array',()=>{
 const f=fixture(),older=f.done({id:2550,startedAt:'2026-11-02T15:48:53.229Z',endedAt:'2026-11-02T17:36:44.182Z'});
 for(const matches of [[f.done(),older],[older,f.done()]])assert.equal(normalizeMatchRounds(f.payload({matches}),f.server(),f.now).lastCompleted.id,2551);
});

test('rondas públicas: rechaza duplicados ambiguos, IDs incoherentes y final/live contradictorios',()=>{
 const f=fixture();
 for(const extra of [
  {lives:[f.live(),f.live({startedAt:'2026-11-02T18:53:10.563Z'})]},
  {lives:[f.live(),f.live({id:2557})]},
  {lives:[f.live(),f.live({id:2555,startedAt:'2026-11-02T18:53:10.563Z'})]},
  {matches:[f.done(),f.done({endedAt:'2026-11-02T18:50:10.675Z'})]},
  {matches:[f.done({...f.live(),live:false,winner:'Manticore'})]}
 ]){const result=normalizeMatchRounds(f.payload(extra),f.server(),f.now);assert.equal(result.ok,false);assert.equal(result.current,null);}
 const duplicates=normalizeMatchRounds(f.payload({lives:[f.live(),f.live({endedAt:iso(f.now-1000)})],matches:[f.done(),f.done()]}),f.server(),f.now);assert.equal(duplicates.ok,true);assert.equal(duplicates.current.observedAt,iso(f.now-1000));
});

test('rondas públicas: elige live máximo consistente por start e ID, ignora filas antiguas',()=>{
 const f=fixture(),old=f.live({id:2555,startedAt:'2026-11-02T18:00:10.563Z'}),stale=f.live({id:9000,endedAt:iso(f.now-120001)});
 const result=normalizeMatchRounds(f.payload({lives:[f.live(),stale,old]}),f.server(),f.now);assert.equal(result.ok,true);assert.equal(result.current.id,2556);
});

test('rondas públicas: nunca deriva final de un live desaparecido o una lista vacía',()=>{
 const f=fixture();f.observe();f.advance(60000);const result=f.observe({lives:[],matches:[]});assert.equal(result.ok,true);assert.equal(result.wake,null);assert.equal(result.current,null);assert.equal(result.lastCompleted,null);
 f.advance(60000);const completed=f.done({...f.live(),endedAt:iso(f.now-1000),live:false,winner:'Lonestar'});assert.equal(f.observe({lives:[],matches:[completed]}).wake.kind,'completed');
});

test('rondas públicas: ignora un final nuevo antiguo o retrasado anterior al baseline',()=>{
 const f=fixture();f.observe({lives:[],matches:[f.done()]});f.advance(60000);
 const completed=f.done({id:2552,startedAt:'2026-11-02T18:51:11.675Z',endedAt:'2026-11-02T18:59:59.000Z'});assert.equal(f.observe({lives:[],matches:[completed]}).wake,null);
});

test('rondas públicas: nuevos finales requieren ID y tiempo estrictamente mayores',()=>{
 const f=fixture();f.observe();f.advance(60000);
 const completed=f.done({...f.live(),live:false,winner:'Manticore',endedAt:iso(f.now-1000)});assert.ok(f.observe({lives:[],matches:[completed]}).wake);
 f.advance(60000);
 for(const bad of [f.done({id:2555,endedAt:iso(f.now-1000)}),{...completed,endedAt:iso(f.now-1000)},f.done({id:2557,startedAt:iso(f.now-70000),endedAt:completed.endedAt})])assert.equal(f.observe({lives:[],matches:[bad]}).ok,false);
});

test('rondas públicas: rechaza futuro, malformación, end antes de start y winner ausente',()=>{
 const f=fixture();
 for(const patch of [{id:'2556'},{id:0},{live:false},{winner:'Manticore'},{startedAt:'ayer'},{startedAt:'2026-02-30T18:52:10.563Z'},{endedAt:iso(f.now+5001)},{startedAt:iso(f.now+5001),endedAt:iso(f.now+5001)},{endedAt:'2026-11-02T18:00:00.000Z'}])assert.equal(normalizeMatchRounds(f.payload({lives:[f.live(patch)]}),f.server(),f.now).ok,false);
 for(const patch of [{winner:null},{winner:''},{winner:'\nManticore'},{live:true},{id:NaN}])assert.equal(normalizeMatchRounds(f.payload({matches:[f.done(patch)]}),f.server(),f.now).ok,false);
});

test('rondas públicas: catálogo y source caducados o futuros no sirven de baseline ni despiertan',()=>{
 const f=fixture();
 for(const target of [{trusted:false},{online:false},{stale:true},{joinId:'wrong'},{apiId:0},{sourceAt:iso(f.now-90001)},{sourceAt:iso(f.now+5001)}])assert.equal(f.observe({},target).baselineReady,false);
 for(const fetchedAt of [f.now-90001,f.now+5001,String(f.now),NaN])assert.equal(f.observe({fetchedAt}).baselineReady,false);
 assert.equal(f.observe().status,'baseline');f.advance(90001);const stale=f.tracker.view(f.server());assert.equal(stale.ok,false);assert.equal(stale.wake,null);
});

test('rondas públicas: cambio de join ID o API exige reset explícito y nuevo baseline',()=>{
 const f=fixture();f.observe();f.advance(60000);
 const target={joinId:'11111111-2222-4333-a444-555555555555'};assert.equal(f.observe({},target).status,'unknown');assert.equal(f.tracker.view(f.server(target)).wake,null);
 f.tracker.reset();assert.equal(f.observe({},target).status,'baseline');assert.equal(f.tracker.view(f.server(target)).wake,null);
});

test('rondas públicas: fetchedAt atrasado, start reciclado y ronda anterior no generan wake',()=>{
 const f=fixture();f.observe();f.advance(60000);
 assert.equal(f.observe({fetchedAt:START-1}).ok,false);f.advance(1);assert.equal(f.observe().status,'ready');
 f.advance(60000);
 for(const patch of [{id:2555},{startedAt:'2026-11-02T18:53:00.000Z'},{id:2557,startedAt:'2026-11-02T18:51:00.000Z'}]){const result=f.observe({lives:[f.live(patch)]});assert.equal(result.ok,false);assert.equal(result.wake,null);}
});

test('rondas públicas: el wake no se renueva con polls frescos y las vistas no mutan el estado',()=>{
 const f=fixture();f.observe();f.advance(60000);const next=f.live({id:2557,startedAt:iso(f.now-20000),endedAt:iso(f.now-1000)}),result=f.observe({lives:[next]});const key=result.wake.eventKey;
 result.wake.eventKey='modified';result.current.id=99999;assert.equal(f.tracker.view().wake.eventKey,key);assert.equal(f.tracker.view().current.id,2557);
 f.advance(60000);assert.equal(f.observe({lives:[{...next,endedAt:iso(f.now-1000)}]}).wake.eventKey,key);
 f.advance(31000);assert.equal(f.observe({lives:[{...next,endedAt:iso(f.now-1000)}]}).wake,null);
});

test('rondas públicas: una transición descubierta tarde actualiza hechos sin activar un selector viejo',()=>{
 const f=fixture();f.observe();f.advance(10*60000);
 const next=f.live({id:2557,startedAt:iso(f.now-5*60000),endedAt:iso(f.now-1000)}),result=f.observe({lives:[next]});assert.equal(result.ok,true);assert.equal(result.current.id,2557);assert.equal(result.wake,null);
});

test('rondas públicas: final e ID live posterior son un único cambio, no dos ventanas del mismo ciclo',()=>{
 const f=fixture();f.observe();f.advance(60000);
 const completed=f.done({...f.live(),live:false,winner:'Manticore',endedAt:iso(f.now-1000)}),first=f.observe({lives:[],matches:[completed]});assert.equal(first.wake.kind,'completed');const key=first.wake.eventKey;
 f.advance(60000);const next=f.live({id:2557,startedAt:iso(f.now-50000),endedAt:iso(f.now-1000)}),nextResult=f.observe({lives:[next],matches:[completed]});assert.equal(nextResult.current.id,2557);assert.equal(nextResult.wake.eventKey,key);assert.equal(nextResult.wake.currentRoundId,2557);assert.equal(nextResult.wake.nextRoundId,2557);assert.equal(nextResult.wake.sourceAt,first.wake.sourceAt);
 f.advance(60000);const later=f.live({id:2558,startedAt:iso(f.now-20000),endedAt:iso(f.now-1000)});assert.equal(f.observe({lives:[later],matches:[completed]}).wake.kind,'new_round');
});

test('rondas públicas: heartbeat atrasado o nueva ronda anterior al heartbeat vivo contradicen continuidad',()=>{
 const f=fixture();f.observe();f.advance(60000);
 for(const row of [f.live({endedAt:iso(START-21000)}),f.live({id:2557,startedAt:iso(START-30000)})]){const result=f.observe({lives:[row]});assert.equal(result.ok,false);assert.equal(result.wake,null);}
});

test('rondas públicas: no copia jugadores, top, puntuaciones ni campos privados',()=>{
 const f=fixture(),input=f.payload({secret:'never',lives:[f.live({players:[{steamId:'private'}],top:[{name:'private'}]})]}),result=f.tracker.observe(input,f.server());assert.doesNotMatch(JSON.stringify(result),/private|steamId|players|scores|top|secret/);assert.deepEqual(input.lives[0].players,[{steamId:'private'}]);
});
