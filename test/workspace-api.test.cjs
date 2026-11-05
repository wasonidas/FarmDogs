'use strict';
// Real HTTP, isolated storage and injected controllers. No game, helper, native
// input, account login or external network request belongs in these fixtures.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createObserver}=require('../src/server.cjs');
const {defaultProfiles}=require('../src/domain.cjs');
const PUBLIC_URL='https://api.wardogsspain.com/api/portal/public/wardogs-servers';
const NOW=Date.parse('2026-11-04T19:00:00.000Z'),JOIN='0665a9c0-80b7-4f32-ad47-f36b70367f10';
const SESSION='11111111-1111-4111-8111-111111111111',CHILD='22222222-2222-4222-8222-222222222222',OTHER='33333333-3333-4333-8333-333333333333';
const CANARY='DO_NOT_RETURN_WORKSPACE_ACCOUNT_COOKIE_TOKEN_OCR_PRIVATE';
const settings=extra=>({mode:'play',server:2,team:'green',durationMinutes:60,...extra});

async function fixture(t,{seed={}}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'farmdogs-workspace-api-'));
 for(const [name,value]of Object.entries(seed)){
  assert.equal(path.basename(name),name);await fs.writeFile(path.join(dir,name),JSON.stringify(value));
 }
 const calls={game:0,movement:0,native:0,screen:0,publicFetch:0,configure:0,stop:0};let service,url;
 let persistent={enabled:false,status:'disabled',cleanupPending:false};
 const forbidden=name=>async()=>{calls[name]++;throw Error('Forbidden operation in isolated workspace fixture: '+name);};
 const screenReader={busy:false,view:()=>({status:'unavailable',scene:'unknown'}),refresh:async()=>{calls.screen++;return{status:'unavailable',scene:'unknown'};},stop(){}};
 const persistentTeam={view:()=>structuredClone(persistent),blocking:()=>persistent.enabled===true||persistent.cleanupPending===true,configure:async()=>{calls.configure++;throw Error('No configuration is needed for workspace API tests.');},stop(){calls.stop++;persistent={...persistent,enabled:false,status:'disabled',cleanupPending:false,stoppedAt:new Date(NOW).toISOString()};return persistentTeam.view();},async tick(){},close(){persistent={...persistent,enabled:false,status:'disabled'};}};
 const options={port:0,dataDir:dir,utcNow:()=>NOW,monoNow:()=>0,autoUpdate:false,persistentTeam,screenReader,
  accountProvider:()=>({available:false,status:'closed',seedingFresh:false,vipFresh:false,privateCanary:CANARY,accountId:CANARY,vip:{name:CANARY},clanAssociation:{status:'disconnected'}}),
  matchSource:{view:()=>({status:'disabled',wake:null}),async tick(){},close(){}},
  entryDriver:{available:()=>false,view:()=>null,blocking:()=>false,stop(){},async tick(){}},
  teamClickerOptions:{capabilityCheck:()=>true,reader:screenReader,spawnProcess:()=>{calls.native++;throw Error('Native helpers are forbidden in this fixture.');}},
  launcher:{availability:()=>({game:false,movement:false,automaticMovement:false,automaticEntry:false}),openGame:forbidden('game'),openMovement:forbidden('movement'),openMovementBackground:forbidden('movement')},
  fetchImpl:async requested=>{assert.equal(requested,PUBLIC_URL,'Only the injected public catalog may be requested.');calls.publicFetch++;return Response.json({configured:true,fetchedAt:NOW,servers:[{id:2,num:2,name:'WARDOGS SPAIN #2',joinId:JOIN,map:'Ozeti',experience:'Madrid_KOTH_01',players:6,maxPlayers:100,configured:true,online:true,sedeoActivo:true,sedeo:{tope:20,esperaMin:30,cobroN:50}}]});}
 };
 async function open(){service=createObserver(options);url=await service.ready;}
 t.after(async()=>{if(service)await service.close();const absolute=path.resolve(dir),relative=path.relative(path.resolve(os.tmpdir()),absolute);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(absolute).startsWith('farmdogs-workspace-api-'),'Only this new temp directory may be removed.');await fs.rm(absolute,{recursive:true,force:true});});
 await open();
 const state=async()=>{const response=await fetch(url+'/api/state');assert.equal(response.status,200);return response.json();};
 async function request(route,{method='GET',body,headers={},auth=true}={}){
  const current=auth?await state():null;
  return fetch(url+route,{method,headers:{...(auth?{'X-Session-Token':current.token}:{}),...(method==='POST'?{'Content-Type':'application/json',Origin:url}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 }
 const post=(route,body={},extra={})=>request(route,{method:'POST',body,...extra});
 const assertNoLaunches=()=>{assert.equal(calls.game,0);assert.equal(calls.movement,0);assert.equal(calls.native,0);assert.equal(calls.screen,0);assert.equal(calls.configure,0);};
 return{dir,calls,state,request,post,persistentTeam,assertNoLaunches,setPersistent(id=SESSION,extra={}){persistent={id,enabled:true,status:'watching',server:2,team:'green',createdAt:new Date(NOW).toISOString(),cleanupPending:false,...extra};return id;},get service(){return service;},async restart(){await service.close();await open();}};
}

test('workspace API: state includes the compact summary and inert preferences without exposing private account in the summary',async t=>{
 const f=await fixture(t),state=await f.state();assert.equal(state.summary.format,'farmdogs-session-summary-v1');assert.equal(state.summary.status,'idle');assert.equal(state.summary.stop,null);assert.equal(state.summary.freshness,'fresh');assert.deepEqual(state.preferences.mousePause,{enabled:true,resumeAfterSeconds:3});assert.equal(typeof state.preferences.menuSound,'boolean');assert.equal(Number.isInteger(state.preferences.menuVolume),true);assert.equal(typeof state.preferences.motion,'boolean');assert.equal(state.presetsRevision,0);
 const serialized=JSON.stringify(state.summary);assert.equal(serialized.includes(CANARY),false);assert.equal(serialized.includes(state.token),false);assert.equal('account'in state.summary,false);assert.equal('gamePid'in state.summary,false);f.assertNoLaunches();
});

test('workspace API: saving, loading and reloading presets never starts a runtime session',async t=>{
 const f=await fixture(t),initial=await f.request('/api/presets');assert.equal(initial.status,200);const before=await initial.json();assert.equal(before.format,'farmdogs-user-presets-v1');assert.equal(before.revision,0);assert.deepEqual(before.presets,[]);
 const saved=await f.post('/api/presets/save',{name:'Jugar con el clan',settings:settings({antiAfk:true,mousePause:{enabled:true,resumeAfterSeconds:7}}),expectedRevision:0});assert.equal(saved.status,200);const document=await saved.json();assert.equal(document.revision,1);assert.equal(document.presets.length,1);const preset=document.presets[0];assert.equal(preset.settings.team,'green');assert.equal(preset.settings.mousePause.resumeAfterSeconds,7);assert.match(preset.id,/^[a-f0-9-]{36}$/);
 assert.equal((await f.state()).summary.status,'idle');assert.equal((await f.state()).presetsRevision,1);assert.equal((await f.state()).persistentTeam.enabled,false);assert.equal((await f.state()).entry,null);assert.equal((await f.state()).autoSeeding,null);f.assertNoLaunches();
 await f.restart();const reloaded=await f.request('/api/presets');assert.equal(reloaded.status,200);assert.deepEqual((await reloaded.json()).presets,[preset]);assert.equal((await f.state()).summary.status,'idle');assert.equal((await f.state()).preferences.mousePause.resumeAfterSeconds,3,'Loading a preset never applies it to the current settings.');f.assertNoLaunches();
});

test('workspace API: preset CAS prevents stale edits and deletes, with no hidden launch fields accepted',async t=>{
 const f=await fixture(t),created=await f.post('/api/presets/save',{name:'Clan',settings:settings(),expectedRevision:0});assert.equal(created.status,200);const initial=await created.json(),id=initial.presets[0].id;
 for(const [route,input]of [['/api/presets/save',{id,name:'Changed',settings:settings(),expectedRevision:0}],['/api/presets/delete',{id,expectedRevision:0}],['/api/presets/save',{name:'Injected',settings:settings({confirmedDeployed:true}),expectedRevision:1}]])assert.equal((await f.post(route,input)).status,400);
 const unchanged=await(await f.request('/api/presets')).json();assert.equal(unchanged.revision,1);assert.deepEqual(unchanged.presets,initial.presets);
 const removed=await f.post('/api/presets/delete',{id,expectedRevision:1});assert.equal(removed.status,200);const final=await removed.json();assert.equal(final.revision,2);assert.deepEqual(final.presets,[]);assert.equal((await f.state()).presetsRevision,2);f.assertNoLaunches();
});

test('workspace API: preference changes persist without replacing server rules, profile values or starting tasks',async t=>{
 const f=await fixture(t,{seed:{'settings.json':{profiles:defaultProfiles(),selectedServer:4,durationMinutes:180,customFixtureMarker:'preserve-existing-settings'}}}),initial=await f.state();
 const response=await f.post('/api/preferences',{mousePause:{enabled:true,resumeAfterSeconds:7},menuSound:false,menuVolume:15,motion:false});assert.equal(response.status,200);const saved=await response.json();assert.deepEqual(saved.preferences,{mousePause:{enabled:true,resumeAfterSeconds:7},menuSound:false,menuVolume:15,motion:false});assert.deepEqual(saved.config.profiles,initial.config.profiles);assert.equal(saved.config.selectedServer,4);assert.equal(saved.config.durationMinutes,180);assert.equal(saved.config.customFixtureMarker,'preserve-existing-settings');assert.equal(saved.summary.status,'idle');
 for(const invalid of [{mousePause:{resumeAfterSeconds:0}},{mousePause:{resumeAfterSeconds:31}},{menuVolume:101},{menuVolume:0.5},{motion:'yes'},{launch:true}])assert.equal((await f.post('/api/preferences',invalid)).status,400);
 assert.deepEqual((await f.state()).preferences,saved.preferences);await f.restart();const reloaded=await f.state();assert.deepEqual(reloaded.preferences,saved.preferences);assert.equal(reloaded.config.customFixtureMarker,'preserve-existing-settings');f.assertNoLaunches();
});

test('workspace API: private history is allowlisted, filterable and bounded without turning old events into new proof',async t=>{
 const common={reason:CANARY,message:CANARY,raw:{token:CANARY,ocr:CANARY},gamePid:987654321,account:{token:CANARY}};
 const seed={format:'farmdogs-session-history-v1',sequence:4,events:[
  {sequence:1,at:'2026-11-04T18:50:00.000Z',kind:'entry_flow_started',sessionId:SESSION,rootSessionId:SESSION,status:'waiting_game',...common},
  {sequence:2,at:'2026-11-04T18:59:00.000Z',kind:'auto_seeding_state',sessionId:CHILD,rootSessionId:SESSION,entryId:SESSION,status:'moving',server:2,purpose:'seeding',...common},
  {sequence:3,at:'2026-11-04T18:59:30.000Z',kind:'auto_seeding_stopped',sessionId:CHILD,rootSessionId:SESSION,entryId:SESSION,status:'stopped',server:2,purpose:'seeding',...common},
  {sequence:4,at:'2026-11-04T18:59:40.000Z',kind:'not_an_allowed_history_event',sessionId:OTHER,status:'error',...common}
 ]};
 const f=await fixture(t,{seed:{'session-history.json':seed}}),response=await f.request('/api/history');assert.equal(response.status,200);const history=await response.json();assert.equal(history.format,'farmdogs-session-history-v1');assert.equal(history.events.length,3);assert.equal(history.claims.rewardVerified,false);assert.equal(history.claims.accountDataIncluded,false);assert.equal(history.claims.freeTextIncluded,false);assert.equal(history.claims.screenshotsIncluded,false);assert.equal(history.coverage.historyComplete,false);
 const text=JSON.stringify(history);assert.equal(text.includes(CANARY),false);assert.equal(text.includes('987654321'),false);assert.equal(text.includes('not_an_allowed_history_event'),false);assert.equal(text.includes((await f.state()).token),false);
 const filtered=await(await f.request('/api/history?since='+encodeURIComponent('2026-11-04T18:58:00.000Z')+'&limit=1')).json();assert.equal(filtered.events.length,1);assert.equal(filtered.coverage.matchingEvents,2);assert.ok(filtered.events.every(row=>Date.parse(row.at)>=Date.parse('2026-11-04T18:58:00.000Z')));assert.equal(filtered.events[0].sessionId,CHILD);
 for(const query of ['?since=invalid','?limit=0','?limit=501','?limit=1.5','?sessionId=bad'])assert.equal((await f.request('/api/history'+query)).status,400);
 assert.equal((await f.state()).summary.status,'idle');f.assertNoLaunches();
});

test('workspace API: saved presets and private history require both session token and a permitted Origin',async t=>{
 const f=await fixture(t);
 for(const route of ['/api/presets','/api/history']){
  assert.equal((await f.request(route,{auth:false})).status,403);assert.equal((await f.request(route,{headers:{'X-Session-Token':'wrong'}})).status,403);assert.equal((await f.request(route,{headers:{Origin:'https://other.example'}})).status,403);
 }
 for(const [route,input]of [['/api/presets/save',{name:'Clan',settings:settings(),expectedRevision:0}],['/api/preferences',{motion:false}],['/api/checks',{}],['/api/session/stop',{kind:'persistent-team',id:SESSION}]]){
  assert.equal((await f.post(route,input,{auth:false})).status,403);assert.equal((await f.post(route,input,{headers:{Origin:'https://other.example'}})).status,403);
 }
 assert.equal((await f.state()).presetsRevision,0);f.assertNoLaunches();
});

test('workspace API: Comprobar Errores is read-only, uses cached facts and never launches helpers or requests the network',async t=>{
 const f=await fixture(t),before=await f.state(),fetches=f.calls.publicFetch,response=await f.post('/api/checks',{});assert.equal(response.status,200);const report=await response.json();assert.equal(report.format,'farmdogs-error-checks-v1');assert.equal(report.claims.readOnly,true);assert.equal(report.claims.gameStarted,false);assert.equal(report.claims.inputsSent,false);assert.equal(report.claims.repairsApplied,false);assert.equal(report.claims.accountDataIncluded,false);assert.equal(f.calls.publicFetch,fetches);
 const text=JSON.stringify(report);assert.equal(text.includes(CANARY),false);assert.equal(text.includes(before.token),false);assert.ok(report.checks.some(row=>row.code==='service_snapshot'));assert.ok(report.checks.some(row=>row.code==='public_source'));assert.equal(report.checks.find(row=>row.code==='steam_account').status,'skipped');assert.ok(report.checks.some(row=>row.code==='ocr'&&row.status==='unknown'),'An uninspected OCR runtime must not be called healthy.');
 const after=await f.state();assert.equal(after.summary.status,before.summary.status);assert.deepEqual(after.preferences,before.preferences);assert.equal(after.entry,before.entry);assert.equal(after.autoSeeding,before.autoSeeding);assert.equal(after.presetsRevision,before.presetsRevision);f.assertNoLaunches();
});

test('workspace API: a stopped session ID cannot cancel its replacement, and the exact current ID stops only that task',async t=>{
 const f=await fixture(t);f.setPersistent(SESSION);const shown=await f.state();assert.deepEqual(shown.summary.stop,{kind:'persistent-team',id:SESSION});f.setPersistent(OTHER);
 const old=await f.post('/api/session/stop',shown.summary.stop);assert.equal(old.status,400);assert.equal(f.calls.stop,0);assert.equal(f.persistentTeam.view().id,OTHER);assert.equal(f.persistentTeam.view().enabled,true);assert.deepEqual((await f.state()).summary.stop,{kind:'persistent-team',id:OTHER});
 for(const invalid of [{kind:'all',id:OTHER},{kind:'entry',id:OTHER},{kind:'persistent-team',id:randomUUID()},{kind:'persistent-team',id:OTHER,all:true},{kind:'persistent-team',id:'bad'}])assert.equal((await f.post('/api/session/stop',invalid)).status,400);
 assert.equal(f.calls.stop,0);assert.equal(f.persistentTeam.view().enabled,true);
 const correct=await f.post('/api/session/stop',{kind:'persistent-team',id:OTHER});assert.equal(correct.status,200);assert.equal(f.calls.stop,1);assert.equal(f.persistentTeam.view().enabled,false);assert.equal((await correct.json()).summary.stop,null);f.assertNoLaunches();
});

test('workspace API: checking or editing presentation settings cannot interrupt an independent active task',async t=>{
 const f=await fixture(t);f.setPersistent(SESSION);const checked=await f.post('/api/checks',{});assert.equal(checked.status,200);const report=await checked.json();assert.equal(report.checks.find(row=>row.code==='portable_integrity').status,'skipped');assert.equal(f.calls.stop,0);assert.equal(f.persistentTeam.view().id,SESSION);assert.equal(f.persistentTeam.view().enabled,true);
 const changed=await f.post('/api/preferences',{menuSound:false,motion:false});assert.equal(changed.status,200);assert.equal(f.calls.stop,0);assert.deepEqual((await changed.json()).summary.stop,{kind:'persistent-team',id:SESSION});f.assertNoLaunches();
});
