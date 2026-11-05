'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createIntegrationService,normalizeIntegrationSettings}=require('../src/integration-service.cjs');

const OWNER='11111111-1111-4111-8111-111111111111',OTHER_OWNER='22222222-2222-4222-8222-222222222222',JOIN='33333333-3333-4333-8333-333333333333',OTHER_ID='44444444-4444-4444-8444-444444444444';
const UTC=Date.parse('2026-11-04T15:00:00.000Z');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function fixture(){
 let utc=UTC,mono=1000,startHook=null,stopHook=null;
 const state={token:'fixture_private_api_secret',account:{fixture:'private-account'},capabilities:{automaticEntry:true,persistentTeam:true},servers:[{number:1,joinId:JOIN,trusted:true,online:true,stale:false,players:12,map:'Public map',sourceAt:new Date(utc).toISOString(),seedingActive:true}],entry:null,autoSeeding:null,persistentTeam:null};
 const calls={start:[],stop:[],report:[]},events=[];
 const service=createIntegrationService({now:()=>utc,monoNow:()=>mono,getState:()=>state,event:(kind,data)=>events.push({kind,...data}),
  async startSession(settings,owner){
   calls.start.push({settings:structuredClone(settings),owner:structuredClone(owner)});if(startHook)await startHook(settings,owner);
   const row={id:randomUUID(),status:settings.mode==='persistent-team'?'watching':settings.mode==='break'?'waiting_presence':'waiting_game',server:settings.server,team:settings.team,operatorStopped:false};
   if(settings.mode==='persistent-team')state.persistentTeam=row;else if(settings.mode==='break')state.autoSeeding=row;else state.entry=row;
   return structuredClone(row);
  },
  async stopSession(owned,cause){
   calls.stop.push({owned:structuredClone(owned),cause});if(stopHook){const result=await stopHook(owned,cause);if(result!==undefined)return result;}
   const row=owned.mode==='persistent-team'?state.persistentTeam:owned.mode==='break'?state.autoSeeding:state.entry;
   const recovered=row?.rootEntryId===owned.id&&state.entryOrigin?.kind==='integration'&&state.entryOrigin.ownerId===owned.ownerId;
   if(row?.id!==owned.id&&!recovered)throw Object.assign(Error('Fixture ownership changed'),{code:'OWNER_CHANGED'});
   if(row.movementSessionId===state.autoSeeding?.id&&state.autoSeeding?.entryId===row.id&&state.autoSeeding?.entryProof?.entryId===row.id)state.autoSeeding={...state.autoSeeding,status:'cancelled',operatorStopped:true};
   row.status='cancelled';row.operatorStopped=true;
  },
  getReport(sessionId){calls.report.push(sessionId);return{format:'farmdogs-session-report-v1',selection:{sessionId},claims:{diagnosticOnly:true,performanceMeasured:false}};}
 });
 const request=(action,extra={},ownerId=OWNER)=>({protocolVersion:1,instanceId:service.instanceId,requestId:randomUUID(),ownerId,action,...extra});
 const settings=extra=>({mode:'play',server:1,expectedJoinId:JOIN,team:'blue',durationMinutes:30,...extra});
 return{service,state,calls,events,request,settings,get utc(){return utc;},get mono(){return mono;},advance({wall=0,monotonic=0}={}){utc+=wall;mono+=monotonic;},fresh(){state.servers[0].sourceAt=new Date(utc).toISOString();},setStartHook(value){startHook=value;},setStopHook(value){stopHook=value;},async preview(extra={},owner=OWNER){return service.command(request('preview',{settings:settings(extra)},owner));},async start(extra={},owner=OWNER){const plan=await this.preview(extra,owner);return service.command(request('start',{reviewId:plan.review.id},owner));}};
}
function contract(value){assert.equal(value.protocolVersion,1);assert.equal(value.service,'farmdogs');assert.equal(typeof value.instanceId,'string');assert.equal(value.pairingRequired,false);assert.ok(Array.isArray(value.capabilities));assert.ok(Array.isArray(value.servers));}

test('integration auth is separate and public/authorized status never exports private application state',()=>{
 const f=fixture(),descriptor=f.service.descriptor({root:'C:\\Fixture\\FarmDogs',pid:1234,baseUrl:'http://127.0.0.1:24243'});
 assert.equal(f.service.authorize(`Bearer ${descriptor.token}`),true);
 for(const value of [undefined,'','Bearer short',descriptor.token,`bearer ${descriptor.token}`,`Bearer ${'0'.repeat(64)}`,`Bearer ${f.state.token}`])assert.equal(f.service.authorize(value),false);
 const publicDto=f.service.status(false);assert.deepEqual(Object.keys(publicDto).sort(),['capabilities','instanceId','pairingRequired','protocolVersion','service'].sort());assert.equal(publicDto.pairingRequired,true);assert.deepEqual(publicDto.capabilities,[]);
 const privateDto=f.service.status(true);contract(privateDto);const serialized=JSON.stringify(privateDto);for(const secret of [descriptor.token,f.state.token,'private-account'])assert.equal(serialized.includes(secret),false);
 assert.equal(privateDto.session,null);assert.equal(privateDto.servers[0].number,1);assert.equal(privateDto.servers[0].joinId,JOIN);assert.equal(f.calls.start.length,0);
});

test('strict Wardogs modes, five server numbers, known teams and typed options reject unsupported values',()=>{
 const f=fixture();f.state.servers.push({...f.state.servers[0],number:6});
 for(const patch of [{mode:'cs2'},{server:0},{server:6},{server:'1'},{team:'T'},{team:'ct'},{team:'orange'},{durationMinutes:0},{durationMinutes:721},{durationMinutes:1.5},{antiAfk:'yes'},{nativeCommand:'anything'}])assert.throws(()=>normalizeIntegrationSettings(f.settings(patch),f.state,f.utc));
 for(const team of ['blue','red','green','any'])assert.equal(normalizeIntegrationSettings(f.settings({team}),f.state,f.utc).team,team);
 assert.throws(()=>normalizeIntegrationSettings(f.settings({mode:'persistent-team',team:'any'}),f.state,f.utc),{code:'INVALID_TEAM'});
 assert.equal(normalizeIntegrationSettings(f.settings({mode:'persistent-team',team:undefined}),f.state,f.utc).team,'green');
 assert.throws(()=>normalizeIntegrationSettings(f.settings({mode:'seeding',antiAfk:true}),f.state,f.utc));
 assert.throws(()=>normalizeIntegrationSettings(f.settings({mode:'play',startNow:true}),f.state,f.utc));
 assert.throws(()=>normalizeIntegrationSettings({mode:'break',durationMinutes:5},f.state,f.utc),{code:'DEPLOYMENT_REQUIRED'});
 assert.deepEqual(normalizeIntegrationSettings({mode:'break',durationMinutes:5,confirmedDeployed:true},f.state,f.utc),{mode:'break',durationMinutes:5,intervalSeconds:60,holdMs:500,confirmedDeployed:true});
});

test('target identity, fresh public source, seeding window and actual capabilities are revalidated',()=>{
 for(const mutate of [f=>{f.state.servers[0].trusted=false;},f=>{f.state.servers[0].online=false;},f=>{f.state.servers[0].stale=true;},f=>{f.advance({wall:90001});},f=>{f.state.servers[0].sourceAt=new Date(f.utc+5001).toISOString();},f=>{f.state.servers[0].joinId=OTHER_ID;},f=>{f.state.capabilities.automaticEntry=false;}]){
  const f=fixture();mutate(f);assert.throws(()=>normalizeIntegrationSettings(f.settings(),f.state,f.utc));
 }
 const f=fixture();f.state.servers[0].seedingActive=false;assert.throws(()=>normalizeIntegrationSettings(f.settings({mode:'seeding'}),f.state,f.utc),{code:'SEEDING_CLOSED'});
 f.state.capabilities.persistentTeam=false;assert.throws(()=>normalizeIntegrationSettings(f.settings({mode:'persistent-team'}),f.state,f.utc),{code:'CAPABILITY_MISSING'});
});

test('preview is inert, owned, one-use and bounded to thirty seconds',async()=>{
 const f=fixture(),plan=await f.preview();contract(plan);assert.equal(Date.parse(plan.review.expiresAt)-f.utc,30000);assert.equal(f.calls.start.length,0);
 await assert.rejects(f.service.command(f.request('start',{reviewId:plan.review.id},OTHER_OWNER)),{code:'REVIEW_REQUIRED'});
 f.advance({wall:30000});await assert.rejects(f.service.command(f.request('start',{reviewId:plan.review.id})),{code:'REVIEW_REQUIRED'});assert.equal(f.calls.start.length,0);
 const g=fixture(),next=await g.preview(),started=await g.service.command(g.request('start',{reviewId:next.review.id}));contract(started);assert.equal(started.session.ownerId,OWNER);
 await assert.rejects(g.service.command(g.request('start',{reviewId:next.review.id})),{code:'REVIEW_REQUIRED'});assert.equal(g.calls.start.length,1);
});

test('a target changed after preview cannot launch the stale selection',async()=>{
 const f=fixture(),plan=await f.preview();f.state.servers[0].joinId=OTHER_ID;
 await assert.rejects(f.service.command(f.request('start',{reviewId:plan.review.id})),{code:'TARGET_CHANGED'});assert.equal(f.calls.start.length,0);
});

test('request IDs are idempotent during and after execution and reject changed payloads',async()=>{
 const f=fixture(),plan=await f.preview(),gate=deferred();f.setStartHook(()=>gate.promise);const input=f.request('start',{reviewId:plan.review.id}),a=f.service.command(input),b=f.service.command({...input});assert.equal(a,b);
 await tick();assert.equal(f.calls.start.length,1);assert.throws(()=>f.service.command({...input,reviewId:OTHER_ID}),{code:'REQUEST_REUSED'});
 gate.resolve();const started=await a;assert.equal(await b,started);assert.equal(await f.service.command({...input}),started);assert.equal(f.calls.start.length,1);
});

test('two simultaneous reviewed starts serialize and cannot replace the first active owner',async()=>{
 const f=fixture(),first=await f.preview({},OWNER),second=await f.preview({},OTHER_OWNER),gate=deferred();f.setStartHook(()=>gate.promise);
 const a=f.service.command(f.request('start',{reviewId:first.review.id},OWNER));await tick();const b=f.service.command(f.request('start',{reviewId:second.review.id},OTHER_OWNER));
 const rejected=assert.rejects(b,{code:'SESSION_ACTIVE'});gate.resolve();const started=await a;await rejected;assert.equal(f.calls.start.length,1);assert.equal(f.service.status(true).session.ownerId,OWNER);assert.equal(f.service.status(true).session.id,started.session.id);
});

test('queued work executes an immutable request snapshot rather than later caller mutation',async()=>{
 const f=fixture(),input=f.request('preview',{settings:f.settings()}),pending=f.service.command(input);input.settings.mode='break';input.settings.confirmedDeployed=true;
 const plan=await pending;assert.equal(plan.review.settings.mode,'play');assert.equal(f.calls.start.length,0);
});

test('STOP requires the exact owner and session and confirms an inactive bridge session',async()=>{
 const f=fixture(),started=await f.start(),sessionId=started.session.id;
 for(const input of [f.request('stop',{expectedSessionId:sessionId},OTHER_OWNER),f.request('stop',{expectedSessionId:OTHER_ID}),f.request('stop')])await assert.rejects(f.service.command(input),{code:'SESSION_OWNERSHIP'});
 assert.equal(f.calls.stop.length,0);const stopped=await f.service.command(f.request('stop',{expectedSessionId:sessionId}));contract(stopped);assert.equal(stopped.stopped,true);assert.equal(stopped.session,null);assert.equal(f.calls.stop.length,1);assert.equal(f.calls.stop[0].owned.id,sessionId);
});

test('replacement by a manual session prevents both STOP and lease expiry from touching it',async()=>{
 const f=fixture(),started=await f.start(),oldId=started.session.id;f.state.entry={id:OTHER_ID,status:'waiting_game'};f.state.autoSeeding={id:randomUUID(),status:'moving',entryId:OTHER_ID};
 await assert.rejects(f.service.command(f.request('stop',{expectedSessionId:oldId})),{code:'SESSION_OWNERSHIP'});assert.equal(f.calls.stop.length,0);f.advance({wall:20000,monotonic:20000});await f.service.tick();assert.equal(f.calls.stop.length,0);assert.equal(f.state.entry.id,OTHER_ID);assert.equal(f.state.autoSeeding.status,'moving');
});

test('lease expiry uses fifteen monotonic seconds despite forward or backward wall clock changes',async()=>{
 for(const wall of [3600000,-3600000]){
  const f=fixture(),started=await f.start();f.advance({wall,monotonic:14999});await f.service.tick();assert.equal(f.calls.stop.length,0);
  f.advance({monotonic:1});await f.service.tick();assert.equal(f.calls.stop.length,1);assert.equal(f.calls.stop[0].cause,'integration_link_lost');assert.equal(f.calls.stop[0].owned.id,started.session.id);await f.service.tick();assert.equal(f.calls.stop.length,1);
 }
});

test('only the exact owner can renew a lease, and public status/report reads do not renew it',async()=>{
 const f=fixture(),started=await f.start(),sessionId=started.session.id;f.advance({wall:10000,monotonic:10000});
 await assert.rejects(f.service.command(f.request('lease',{expectedSessionId:sessionId},OTHER_OWNER)),{code:'SESSION_OWNERSHIP'});
 const renewed=await f.service.command(f.request('lease',{expectedSessionId:sessionId}));contract(renewed);assert.equal(renewed.session.id,sessionId);
 f.advance({wall:14999,monotonic:14999});f.service.status(false);f.service.status(true);f.service.report(OWNER);await f.service.tick();assert.equal(f.calls.stop.length,0);
 f.advance({wall:1,monotonic:1});await f.service.tick();assert.equal(f.calls.stop.length,1);
});

test('cleanup-pending STOP keeps ownership, rejects lease renewal and retries after one monotonic second',async()=>{
 const f=fixture(),started=await f.start(),sessionId=started.session.id;let attempts=0;f.setStopHook(()=>++attempts===1?{cleanupPending:true}:undefined);
 await assert.rejects(f.service.command(f.request('stop',{expectedSessionId:sessionId})),{code:'STOP_PENDING'});assert.equal(f.service.status(true).session.id,sessionId);assert.equal(f.service.status(true).session.status,'stopping');
 await assert.rejects(f.service.command(f.request('lease',{expectedSessionId:sessionId})),{code:'STOP_PENDING'});f.advance({monotonic:999});await f.service.tick();assert.equal(f.calls.stop.length,1);
 f.advance({monotonic:1});await f.service.tick();assert.equal(f.calls.stop.length,2);assert.equal(f.calls.stop[1].owned.id,sessionId);assert.equal(f.service.status(true).session,null);
});

test('lease renewals never extend the explicitly reviewed monotonic session budget',async()=>{
 const f=fixture(),started=await f.start({durationMinutes:1}),sessionId=started.session.id;
 for(const milliseconds of [10000,10000,10000,10000,10000,9000]){f.advance({wall:milliseconds,monotonic:milliseconds});await f.service.command(f.request('lease',{expectedSessionId:sessionId}));}
 f.advance({wall:1000,monotonic:1000});await f.service.tick();assert.equal(f.calls.stop.length,1);assert.equal(f.calls.stop[0].owned.id,sessionId);assert.equal(f.service.status(true).session,null);
});

test('a late heartbeat cannot revive an expired lease before the periodic tick observes it',async()=>{
 const f=fixture(),started=await f.start(),sessionId=started.session.id;f.advance({wall:15001,monotonic:15001});
 await assert.rejects(f.service.command(f.request('lease',{expectedSessionId:sessionId})));await f.service.tick();assert.equal(f.calls.stop.length,1);assert.equal(f.service.status(true).session,null);assert.equal(f.calls.start.length,1);
});

test('F8 terminal state cannot be renewed, restarted by a tick or stopped twice',async()=>{
 const f=fixture(),started=await f.start(),sessionId=started.session.id;f.state.entry={...f.state.entry,status:'cancelled',operatorStopped:true};
 await assert.rejects(f.service.command(f.request('lease',{expectedSessionId:sessionId})));
 f.advance({wall:30000,monotonic:30000});await f.service.tick();assert.equal(f.calls.start.length,1);assert.equal(f.calls.stop.length,0);
});

test('completed entry hands off to its own movement while retaining the bridge root session ID',async()=>{
 const f=fixture(),started=await f.start({mode:'seeding'}),rootId=started.session.id,movementId=randomUUID();
 f.state.entry={...f.state.entry,status:'completed',movementSessionId:movementId};f.state.autoSeeding={id:movementId,status:'moving',entryId:rootId,entryProof:{entryId:rootId},operatorStopped:false};
 const current=f.service.status(true);assert.equal(current.session.id,rootId);assert.equal(current.session.status,'moving');assert.equal(current.session.ownerId,OWNER);
 const renewed=await f.service.command(f.request('lease',{expectedSessionId:rootId}));assert.equal(renewed.session.id,rootId);
 await f.service.command(f.request('stop',{expectedSessionId:rootId}));assert.equal(f.calls.stop[0].owned.id,rootId);assert.equal(f.state.autoSeeding.status,'cancelled');
});

test('an unrelated movement session is not adopted through a completed entry',async()=>{
 const f=fixture(),started=await f.start({mode:'seeding'}),movementId=randomUUID();
 f.state.entry={...f.state.entry,status:'completed',movementSessionId:movementId};f.state.autoSeeding={id:movementId,status:'moving',entryId:OTHER_ID,entryProof:{entryId:OTHER_ID},operatorStopped:false};
 const current=f.service.status(true);assert.ok(current.session===null||current.session.status!=='moving');f.advance({wall:16000,monotonic:16000});await f.service.tick();assert.equal(f.state.autoSeeding.status,'moving');assert.equal(f.calls.stop.length,0);assert.equal(f.calls.start.length,1);assert.equal(started.session.ownerId,OWNER);
});

test('reports are owner-scoped and diagnostic history remains available after the owned stop',async()=>{
 const f=fixture(),started=await f.start();assert.throws(()=>f.service.report(OTHER_OWNER),{code:'SESSION_OWNERSHIP'});const before=f.service.report(OWNER);assert.equal(before.selection.sessionId,started.session.id);
 await f.service.command(f.request('stop',{expectedSessionId:started.session.id}));const after=f.service.report(OWNER);assert.equal(after.selection.sessionId,started.session.id);assert.equal(after.claims.performanceMeasured,false);
});

test('closing during a pending start cancels only the resulting owned session and grants no orphan lease',async()=>{
 const f=fixture(),plan=await f.preview(),gate=deferred();f.setStartHook(()=>gate.promise);const pending=f.service.command(f.request('start',{reviewId:plan.review.id}));await tick();f.service.close();const rejected=assert.rejects(pending);gate.resolve();await rejected;
 assert.equal(f.service.status(true).pairingRequired,true);assert.equal(f.calls.stop.length,1);assert.equal(f.calls.stop[0].owned.id,f.state.entry.id);assert.equal(f.state.entry.status,'cancelled');f.advance({wall:60000,monotonic:60000});await f.service.tick();assert.equal(f.calls.start.length,1);assert.equal(f.calls.stop.length,1);
});

test('closed service rejects queued or subsequent commands and public status requests no reconnect work',async()=>{
 const f=fixture();f.service.close();assert.equal(f.service.status(true).pairingRequired,true);assert.throws(()=>f.service.command(f.request('preview',{settings:f.settings()})),{code:'CLOSED'});await f.service.tick();assert.equal(f.calls.start.length,0);assert.equal(f.calls.stop.length,0);
});

test('completed play remains deployed under its own lease and exposes only the minimal main-process game proof',async()=>{
 const f=fixture(),started=await f.start(),rootId=started.session.id;f.state.entry={...f.state.entry,status:'completed',gamePid:1234,gameWindow:5678,entryConfirmedAt:new Date(f.utc).toISOString(),account:'fixture_private_account',path:'C:\\Private\\Wardogs.exe'};
 const current=f.service.status(true);assert.equal(current.session.id,rootId);assert.equal(current.session.status,'deployed');assert.equal(current.session.phase,'deployed');
 const renewed=await f.service.command(f.request('lease',{expectedSessionId:rootId}));assert.equal(renewed.session.status,'deployed');const proof=f.service.game(OWNER,rootId);assert.deepEqual(proof.game,{pid:1234,entryId:rootId,rootSessionId:rootId,confirmedAt:new Date(f.utc).toISOString()});assert.deepEqual(Object.keys(proof.game).sort(),['confirmedAt','entryId','pid','rootSessionId']);assert.equal(JSON.stringify(proof).includes('fixture_private_account'),false);assert.equal(f.calls.stop.length,0);
 assert.throws(()=>f.service.game(OTHER_OWNER,rootId),{code:'SESSION_OWNERSHIP'});assert.throws(()=>f.service.game(OWNER,OTHER_ID),{code:'SESSION_OWNERSHIP'});
});

test('a game proof requires a confirmed entry PID and an active own session, including after F8',async()=>{
 const f=fixture(),started=await f.start(),rootId=started.session.id;
 assert.throws(()=>f.service.game(OWNER,rootId),{code:'GAME_UNVERIFIED'});f.state.entry={...f.state.entry,gamePid:1234,entryConfirmedAt:new Date(f.utc).toISOString(),status:'cancelled',operatorStopped:true};
 assert.throws(()=>f.service.game(OWNER,rootId));assert.equal(f.calls.start.length,1);assert.equal(f.calls.stop.length,0);
});

test('recovery preserves the bridge root while game proof and movement bind to the verified child entry',async()=>{
 const f=fixture(),started=await f.start({mode:'seeding'}),rootId=started.session.id,childId=randomUUID(),movementId=randomUUID();
 f.state.entry={id:childId,rootEntryId:rootId,status:'completed',movementSessionId:movementId,gamePid:1234,entryConfirmedAt:new Date(f.utc).toISOString()};f.state.entryOrigin={kind:'integration',ownerId:OWNER,entryId:childId};f.state.autoSeeding={id:movementId,entryId:childId,entryProof:{entryId:childId},status:'moving'};
 const current=f.service.status(true);assert.equal(current.session.id,rootId);assert.equal(current.session.status,'moving');const proof=f.service.game(OWNER,rootId);assert.equal(proof.game.entryId,childId);assert.equal(proof.game.rootSessionId,rootId);
 await f.service.command(f.request('lease',{expectedSessionId:rootId}));await f.service.command(f.request('stop',{expectedSessionId:rootId}));assert.equal(f.calls.stop[0].owned.id,rootId);assert.equal(f.state.entry.id,childId);assert.equal(f.state.autoSeeding.status,'cancelled');assert.equal(f.service.report(OWNER,rootId).selection.sessionId,rootId);
});

test('a recovered entry with a foreign origin is never adopted for status, game proof or STOP',async()=>{
 const f=fixture(),started=await f.start({mode:'seeding'}),rootId=started.session.id,childId=randomUUID();
 f.state.entry={id:childId,rootEntryId:rootId,status:'completed',gamePid:1234,entryConfirmedAt:new Date(f.utc).toISOString()};f.state.entryOrigin={kind:'integration',ownerId:OTHER_OWNER,entryId:childId};assert.equal(f.service.status(true).session,null);
 assert.throws(()=>f.service.game(OWNER,rootId),{code:'SESSION_OWNERSHIP'});await assert.rejects(f.service.command(f.request('stop',{expectedSessionId:rootId})),{code:'SESSION_OWNERSHIP'});assert.equal(f.calls.stop.length,0);
});
