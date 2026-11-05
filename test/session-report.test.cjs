'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildSessionReport,sessionReasonCode,sessionPhase}=require('../src/session-report.cjs');

const NOW='2026-11-04T12:00:00.000Z',BEFORE='2026-11-04T11:59:59.000Z';
const ENTRY='11111111-1111-4111-8111-111111111111',TEAM='22222222-2222-4222-8222-222222222222',MOTION='33333333-3333-4333-8333-333333333333',RECOVERY='44444444-4444-4444-8444-444444444444',ALIEN='55555555-5555-4555-8555-555555555555',FRAME='66666666-6666-4666-8666-666666666666',JOIN='77777777-7777-4777-8777-777777777777';
const capture=(extra={})=>({status:'verified_capture',scene:'gameplay_hud',gamePid:123,gameWindow:456,frameId:FRAME,capturedAt:BEFORE,gameForeground:true,...extra});
const event=(kind,detail={})=>({at:BEFORE,kind,...detail});
function fixture(){return {entry:{id:ENTRY,rootEntryId:ENTRY,server:2,status:'completed',phase:'movement',reason:'Entrada completada',createdAt:BEFORE,deployedAt:BEFORE,connected:true,connectionSource:'verified_entry_ui_chain',gamePid:123,gameWindow:456,teamSessionId:TEAM,movementSessionId:MOTION},autoSeeding:{id:MOTION,purpose:'seeding',server:2,status:'moving',createdAt:BEFORE,entryId:ENTRY,entryProof:{entryId:ENTRY,server:2,joinId:JOIN,gamePid:123,gameWindow:456,confirmedAt:BEFORE},screen:capture()},teamClicker:{sessionId:TEAM,ownerId:ENTRY,controllerFresh:true,controllerAlive:true,controllerReportAt:BEFORE,controllerReportStatus:'read',enabled:false},movement:{available:true,autoSessionId:MOTION,at:BEFORE}};}

test('session report: allowlist excludes account, paths, native identity, images and all free text',()=>{
 const state=fixture(),secrets=['Bearer-DO-NOT-EXPORT','steamLoginSecure=CANARY','76561198012345678','PRIVATE_PLAYER_NAME','C:\\private\\account-profile','OCR_PRIVATE_TEXT',JOIN,FRAME];
 const hostile=Object.fromEntries(['token','cookie','steamId','name','path','ocr','joinId','frameId'].map((key,n)=>[key,secrets[n]]));
 state.account={...hostile,vip:{days:500},identity:{...hostile}};state.token=secrets[0];state.installationRoot=secrets[4];state.events=[event('entry_flow_state',{id:ENTRY,rootEntryId:ENTRY,status:'completed',...hostile,reason:secrets.join(' '),message:secrets.join(' '),diagnostic:{code:'report_read_failure',path:secrets[4],readError:secrets[0],at:BEFORE}})];
 Object.assign(state.entry,hostile,{id:ENTRY,rootEntryId:ENTRY,reason:secrets.join(' '),cleanupErrors:secrets,gamePid:987654321,gameWindow:987654322});Object.assign(state.autoSeeding,hostile,{id:MOTION,reason:secrets.join(' ')});
 state.autoSeeding.screen={...capture(),...hostile,raw:{...hostile},text:secrets.join(' ')};
 const original=structuredClone(state),report=buildSessionReport({at:NOW,state}),json=JSON.stringify(report);
 for(const secret of secrets)assert.equal(json.includes(secret),false,secret);
 for(const key of ['account','token','cookie','steamId','name','path','ocr','joinId','frameId','gamePid','gameWindow','reason','message','installationRoot','cleanupErrors'])assert.equal(new RegExp('"'+key+'"\\s*:').test(json),false,key);
 assert.equal(json.includes('987654321'),false);assert.equal(json.includes('987654322'),false);
 assert.deepEqual(state,original);assert.deepEqual(report.claims,{diagnosticOnly:true,accountDataIncluded:false,screenshotsIncluded:false,freeTextIncluded:false,continuousConnectionVerified:false,rewardVerified:false,performanceMeasured:false,realRoundValidation:false,sessionResumptionAuthorized:false});
});

test('session report: explicit ownership correlates entry, team, movement and recovery in either direction',()=>{
 const state=fixture();state.entry={...state.entry,id:RECOVERY,rootEntryId:ENTRY,status:'recovering_source',phase:'recovery',connected:false,teamSessionId:null,movementSessionId:null,recovery:{rootEntryId:ENTRY,previousEntryId:ENTRY,seedingId:MOTION}};
 const events=[event('entry_flow_started',{id:ENTRY,rootEntryId:ENTRY}),event('entry_flow_team_prepared',{id:ENTRY,rootEntryId:ENTRY,ownerId:ENTRY,teamSessionId:TEAM}),event('entry_flow_team_confirmed',{id:ENTRY,rootEntryId:ENTRY,ownerId:ENTRY,teamSessionId:TEAM}),event('entry_flow_movement_handoff',{id:ENTRY,rootEntryId:ENTRY,movementSessionId:MOTION}),event('auto_seeding_state',{id:MOTION,entryId:ENTRY,status:'moving'}),event('entry_flow_recovery_started',{id:RECOVERY,rootEntryId:ENTRY,previousEntryId:ENTRY,movementSessionId:MOTION,status:'recovering_source'}),event('entry_flow_started',{id:ALIEN,rootEntryId:ALIEN,server:2})];
 for(const sessionId of [ENTRY,TEAM,MOTION,RECOVERY]){
  const report=buildSessionReport({at:NOW,state,events,sessionId});assert.equal(report.selection.status,'selected');assert.deepEqual(report.selection.relatedSessionIds,[ENTRY,TEAM,MOTION,RECOVERY].sort());assert.equal(report.events.length,6);assert.ok(report.events.every(value=>value.rootSessionId===ENTRY));assert.ok(report.sessions.every(value=>value.sessionId!==ALIEN));
 }
 const recovery=buildSessionReport({at:NOW,state,events,sessionId:RECOVERY}).sessions.find(value=>value.sessionId===RECOVERY);assert.equal(recovery.parentSessionId,ENTRY);assert.equal(recovery.phase,'recovery');
});

test('session report: selected server, PID, time or alien ownership never correlates another session',()=>{
 const state=fixture();state.autoSeeding.entryId=ALIEN;state.autoSeeding.entryProof.entryId=ALIEN;state.teamClicker.ownerId=ALIEN;
 const events=[event('team_clicker_prepared',{team:'green',server:2}),event('entry_flow_team_prepared',{id:ENTRY,rootEntryId:ENTRY,ownerId:ALIEN,teamSessionId:TEAM}),event('auto_seeding_state',{id:MOTION,entryId:ALIEN,status:'moving',server:2})];
 const report=buildSessionReport({at:NOW,state,events,sessionId:ENTRY});assert.deepEqual(report.selection.relatedSessionIds,[ENTRY]);assert.equal(report.sessions.length,1);assert.equal(report.sessions[0].ownership.team,'mismatch');assert.equal(report.sessions[0].ownership.movement,'mismatch');assert.equal(report.events.some(value=>value.sessionId===MOTION||value.sessionId===TEAM),false);
});

test('session report: mismatched entry proof is exported as a fault without borrowing its owner',()=>{
 const state=fixture();state.autoSeeding.entryProof.entryId=ALIEN;
 const report=buildSessionReport({at:NOW,state,sessionId:MOTION});assert.deepEqual(report.selection.relatedSessionIds,[MOTION]);assert.equal(report.sessions[0].parentSessionId,null);assert.equal(report.sessions[0].reasonCode,'entry_binding_invalid');assert.equal(report.sessions[0].ownership.entry,'mismatch');assert.equal(report.sessions[0].evidence.boundToEntry,null);assert.equal(report.sessions[0].evidence.recentBoundCapture,false);
});

test('session report: stale, future and other-window captures never become recent deployment evidence',()=>{
 for(const capturedAt of ['2026-11-04T11:59:54.999Z','2026-11-04T12:00:00.001Z','bad-date']){
  const state=fixture();state.entry.deployedAt=capturedAt;state.autoSeeding.screen.capturedAt=capturedAt;state.teamClicker.controllerReportAt=capturedAt;
  const report=buildSessionReport({at:NOW,state}),entry=report.sessions.find(value=>value.mode==='entry'),motion=report.sessions.find(value=>value.mode==='seeding'),team=report.sessions.find(value=>value.mode==='team');
  assert.equal(entry.evidence.recentDeploymentEvidence,false);assert.equal(motion.evidence.recentBoundCapture,false);assert.equal(team.evidence.controllerFresh,false);
 }
 const state=fixture();state.autoSeeding.screen.gameWindow=999;
 const motion=buildSessionReport({at:NOW,state}).sessions.find(value=>value.mode==='seeding');assert.equal(motion.evidence.boundToEntry,false);assert.equal(motion.evidence.recentBoundCapture,false);
 const valid=buildSessionReport({at:NOW,state:fixture()});assert.equal(valid.sessions.find(value=>value.mode==='entry').evidence.recentDeploymentEvidence,true);assert.equal(valid.sessions.find(value=>value.mode==='seeding').evidence.recentBoundCapture,true);
});

test('session report: native failures retain fixed causes and safe scalar evidence',()=>{
 for(const code of ['watcher_owner_mismatch','report_read_failure','report_identity_invalid','operator_stop','watch_unhealthy']){
  const diagnostic={code,at:BEFORE,reportAt:BEFORE,reportAgeMilliseconds:3001,failure:code!=='operator_stop',startup:true,reportOwnerMatches:false,reportServiceMatches:false,childExited:true,childExitCode:9,childExitSignal:'SIGTERM',readError:'ENOENT',reportObserved:true,reportFromCurrentRead:true,schemaMatches:true,watcherOwnerMatches:false,childKilled:false,stopRequested:false,lastStatus:'closed',lastReason:'watch_stopped',pid:76561198012345678,path:'PRIVATE_PATH',message:'PRIVATE_MESSAGE'};
  const report=buildSessionReport({at:NOW,events:[event('game_entry_watch_diagnostic',{sessionId:ENTRY,server:2,diagnostic})],sessionId:ENTRY}),entry=report.events[0];
  assert.equal(entry.reasonCode,code==='operator_stop'?'operator_stop':'native_'+code);assert.equal(entry.native.code,code);assert.equal(entry.native.childExitCode,9);assert.equal(entry.native.readError,'ENOENT');assert.equal(entry.native.reportOwnerMatches,false);assert.equal('pid' in entry.native,false);assert.equal(JSON.stringify(report).includes('PRIVATE_'),false);
 }
});

test('session report: quiet native report loss, timeout, identity loss and recovery have distinct codes',()=>{
 const cases=[['quiet_report_gap','controller_report_gap'],['quiet_wait_expired','controller_wait_expired'],['quiet_identity_lost','controller_identity_lost'],['controller_not_ready','controller_not_ready'],['two_new_reports','controller_recovered']];
 for(const [cause,expected] of cases){const report=buildSessionReport({at:NOW,events:[event('persistent_team_controller_problem',{id:ENTRY,cause,controllerFresh:false,controllerAlive:false,controllerReportStatus:'unavailable',controllerIdentitySource:'cached',controllerPid:101,expectedPid:101})]});assert.equal(report.events[0].reasonCode,expected);assert.equal(report.events[0].controller.identitySource,'cached');assert.equal('controllerPid' in report.events[0],false);}
});

test('session report: bounded historical events are ordered and future or uncorrelated records are omitted',()=>{
 const events=[];for(let n=0;n<230;n++)events.push({at:new Date(Date.parse(NOW)-n*1000).toISOString(),kind:'entry_flow_state',id:ENTRY,rootEntryId:ENTRY,status:'joining'});
 events.push({at:'2026-11-04T12:00:00.001Z',kind:'entry_flow_state',id:ENTRY},event('unknown_private_kind',{id:ENTRY}),event('team_clicker_stopped',{reason:'PRIVATE_TEXT'}));
 const report=buildSessionReport({at:NOW,events,sessionId:ENTRY});assert.equal(report.events.length,200);assert.equal(report.coverage.historyComplete,false);assert.equal(report.coverage.ignoredEventCount,3);assert.equal(report.events[0].at,new Date(Date.parse(NOW)-199000).toISOString());assert.equal(report.events.at(-1).at,NOW);assert.equal(JSON.stringify(report).includes('PRIVATE_TEXT'),false);
});

test('session report: invalid selection and unknown enum values cannot echo arbitrary content',()=>{
 const report=buildSessionReport({at:'INVALID_PRIVATE_TIME',state:{entry:{id:ENTRY,status:'PRIVATE_STATUS',phase:'PRIVATE_PHASE',reasonCode:'PRIVATE_REASON',reason:'PRIVATE_REASON',nativeDiagnostic:{code:'PRIVATE_CODE'}},account:{name:'PRIVATE_ACCOUNT'}},sessionId:'PRIVATE_SESSION'});
 assert.equal(report.generatedAt,null);assert.equal(report.selection.status,'invalid');assert.equal(report.selection.sessionId,null);assert.deepEqual(report.sessions,[]);assert.deepEqual(report.events,[]);assert.equal(JSON.stringify(report).includes('PRIVATE_'),false);
 const missing=buildSessionReport({at:NOW,state:fixture(),sessionId:ALIEN});assert.equal(missing.selection.status,'not_found');assert.deepEqual(missing.sessions,[]);
 const hostile=buildSessionReport({at:NOW,state:{entry:{id:ENTRY,status:'__proto__',phase:'__proto__',reasonCode:'__proto__'}}});assert.equal(hostile.sessions[0].status,'unknown');assert.equal(hostile.sessions[0].phase,'unknown');assert.equal(hostile.sessions[0].reasonCode,'none');
});

test('session report: timestamp is explicit and diagnostic helpers return only supported codes',()=>{
 assert.equal(buildSessionReport({}).generatedAt,null);assert.deepEqual(buildSessionReport({at:NOW}),buildSessionReport({at:Date.parse(NOW)}));
 for(const [reason,code] of [['Detenido con F8.','operator_stop'],['La app se reinició.','service_restarted'],['El servicio local se cerró.','service_closed'],['La ventana del juego cambió durante la entrada.','game_identity_changed'],['La selección de equipo cambió de propietario.','ownership_changed'],['La prueba de despliegue caducó antes de terminar.','evidence_expired']])assert.equal(sessionReasonCode({reason,status:'error'}),code);
 assert.equal(sessionReasonCode({status:'expired',reason:'PRIVATE_TEXT'}),'deadline_reached');assert.equal(sessionPhase({status:'choosing_team'}),'team');assert.equal(sessionPhase({status:'error',phase:'team'}),'team');assert.equal(sessionPhase({phase:'team_selector'}),'team');
 assert.equal(sessionReasonCode({kind:42,status:'unknown'}),'none');
});

test('session report: entry emitter preserves stage and structured native cause without adding free text',async()=>{
 const {createEntryFlow}=require('../src/entry-flow.cjs');let native=null;const events=[];
 const flow=createEntryFlow({now:()=>Date.parse(NOW),monoNow:()=>1,driver:{start:async value=>{native={sessionId:value.id,phase:'waiting_game'};},view:()=>native,tick:async()=>{},stop:()=>{},blocking:()=>false},launcher:{openGame:async()=>{}},teamClicker:{view:()=>({}),blocking:()=>false},automatic:{active:()=>false,view:()=>null},getTarget:(server,joinId)=>({server,joinId}),event:(kind,detail)=>events.push({at:NOW,kind,...detail})});
 const entry=await flow.start({server:2,joinId:JOIN,team:'green',durationMinutes:5,seeding:false});
 native={...native,phase:'error',reason:'PRIVATE_NATIVE_TEXT',watchDiagnostic:{code:'report_identity_invalid',at:NOW,reportOwnerMatches:false}};await flow.tick();
 const finished=events.find(value=>value.kind==='entry_flow_finished');assert.equal(finished.id,entry.id);assert.equal(finished.rootEntryId,entry.id);assert.equal(finished.phase,'waiting');assert.equal(finished.reasonCode,'native_report_identity_invalid');assert.equal('reason' in finished,false);assert.equal('message' in finished,false);
 const report=buildSessionReport({at:NOW,state:{entry:flow.view()},events,sessionId:entry.id});assert.equal(report.sessions[0].native.code,'report_identity_invalid');assert.equal(JSON.stringify(report).includes('PRIVATE_NATIVE_TEXT'),false);flow.close();
});

test('session report: auto-session emits its exact ID and entry owner with injected offline helpers',async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createAutoSession}=require('../src/auto-session.cjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'farmdogs-report-test-')),events=[];let mono=0;
 const manager=createAutoSession({root:dir,dataDir:dir,now:()=>Date.parse(NOW),monoNow:()=>mono,launcher:{availability:()=>({automaticMovement:true}),openMovementBackground:async()=>{}},getInputs:()=>({movement:{available:true,armed:false,status:'stopped'},server:{number:2,trusted:true,players:20,seedingActive:true}}),event:(kind,detail)=>events.push({at:NOW,kind,...detail}),reader:{view:()=>capture({capturedAt:NOW}),refresh:async()=>{},stop:()=>{}}});
 t.after(async()=>{manager.close();const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(dir));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(dir).startsWith('farmdogs-report-test-'));await fs.rm(dir,{recursive:true,force:true});});
 const started=await manager.start({server:2,durationMinutes:5,presenceMode:'entry'},{trustedEntry:{entryId:ENTRY,server:2,joinId:JOIN,gamePid:123,gameWindow:456,confirmedAt:NOW}});mono=1;manager.tick();manager.stop();
 assert.ok(events.some(value=>value.kind==='auto_seeding_started'));assert.ok(events.some(value=>value.kind==='auto_seeding_state'));assert.ok(events.some(value=>value.kind==='auto_seeding_stopped'));
 for(const value of events){assert.equal(value.id,started.id);assert.equal(value.entryId,ENTRY);assert.equal(typeof value.phase,'string');assert.equal(typeof value.reasonCode,'string');}
 const report=buildSessionReport({at:NOW,state:{autoSeeding:manager.view()},events,sessionId:ENTRY});assert.ok(report.selection.relatedSessionIds.includes(started.id));assert.ok(report.events.every(value=>value.entryId===ENTRY));
});
