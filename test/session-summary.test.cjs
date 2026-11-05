'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildSessionSummary}=require('../src/session-summary.cjs');
const NOW='2026-11-04T18:00:00.000Z',BEFORE='2026-11-04T17:59:00.000Z',END='2026-11-04T18:10:00.000Z';
const ENTRY='11111111-1111-4111-8111-111111111111',AUTO='22222222-2222-4222-8222-222222222222',TEAM='33333333-3333-4333-8333-333333333333',JOB='44444444-4444-4444-8444-444444444444',OTHER='55555555-5555-4555-8555-555555555555',PREF='66666666-6666-4666-8666-666666666666',MONITOR='77777777-7777-4777-8777-777777777777';
const state=extra=>({now:NOW,...extra});
const summarize=(value,options={})=>buildSessionSummary(state(value),{now:NOW,...options});
const entry=extra=>({id:ENTRY,rootEntryId:ENTRY,status:'choosing_team',server:2,team:'green',seeding:true,createdAt:BEFORE,endAt:END,...extra});
const auto=extra=>({id:AUTO,status:'moving',server:2,purpose:'seeding',presenceMode:'manual',createdAt:BEFORE,endAt:END,...extra});
const activity=extra=>({id:JOB,status:'watching',strategy:'activity',createdAt:BEFORE,endAt:END,...extra});
const persistent=extra=>({id:PREF,status:'watching',enabled:true,server:2,team:'green',startedAt:BEFORE,...extra});
const clicker=extra=>({sessionId:TEAM,ownerId:null,enabled:true,controllerFresh:true,controllerSessionId:TEAM,team:'green',waitingForSelector:true,active:false,running:false,...extra});
const userPause=extra=>({kind:'mouse',active:true,resumeAt:'2026-11-04T18:00:03.000Z',remainingMs:3000,buttonsDown:false,...extra});
const boundAuto=extra=>auto({entryId:ENTRY,entryProof:{entryId:ENTRY},...extra});

test('fresh empty state is idle, with no session, deadline or stop action',()=>{
 const summary=summarize({});assert.equal(summary.status,'idle');assert.equal(summary.freshness,'fresh');assert.equal(summary.nextAction,'start_new');assert.equal(summary.stop,null);assert.equal(summary.scope,null);assert.equal(summary.userPause,null);assert.equal(summary.timing.remainingSeconds,null);
});

test('entry stages use fixed text, a bounded destination and their exact stop identifier',()=>{
 const stages={opening:'working',waiting_game:'waiting',navigating:'working',joining:'working',choosing_team:'working',deploying:'waiting',starting_seeding:'working',recovering_source:'waiting'};
 for(const [status,expected]of Object.entries(stages)){
  const summary=summarize({entry:entry({status})});assert.equal(summary.status,expected,status);assert.equal(summary.mode,'seeding');assert.equal(summary.server,2);assert.equal(summary.team,'green');assert.deepEqual(summary.stop,{kind:'entry',id:ENTRY});assert.equal(summary.timing.remainingSeconds,600);
 }
});

test('an owned entry selector is one task, but the same server cannot bind a foreign selector',()=>{
 const own={entry:entry({teamSessionId:TEAM}),teamClicker:clicker({ownerId:ENTRY})};
 const summary=summarize(own);assert.notEqual(summary.status,'attention');assert.deepEqual(summary.stop,{kind:'entry',id:ENTRY});
 for(const patch of [{ownerId:OTHER},{sessionId:OTHER}]){const conflict=summarize({...own,teamClicker:clicker({ownerId:ENTRY,...patch})});assert.equal(conflict.status,'attention');assert.equal(conflict.stop,null);assert.equal(conflict.scope,null);}
});

test('an active handoff and its exact movement child remain one entry-owned task',()=>{
 const summary=summarize({entry:entry({status:'starting_seeding',movementSessionId:AUTO}),autoSeeding:boundAuto()});
 assert.equal(summary.title,'Preparando el movimiento');assert.deepEqual(summary.stop,{kind:'entry',id:ENTRY});
});

test('a completed entry hands presentation to its verified child and uses the child duration',()=>{
 const summary=summarize({entry:entry({status:'completed',movementSessionId:AUTO,endAt:'2026-11-04T18:02:00.000Z'}),autoSeeding:boundAuto({purpose:'break',server:null,endAt:'2026-11-04T18:15:00.000Z'})});
 assert.equal(summary.status,'working');assert.equal(summary.mode,'break');assert.equal(summary.title,'Anti-AFK activo');assert.equal(summary.team,'green');assert.deepEqual(summary.stop,{kind:'entry',id:ENTRY});assert.equal(summary.timing.remainingSeconds,900);assert.equal(summary.timing.endAt,'2026-11-04T18:15:00.000Z');
});

test('mismatched entry proof cannot borrow entry ownership or claim a valid movement state',()=>{
 const summary=summarize({entry:entry({status:'completed',movementSessionId:AUTO}),autoSeeding:boundAuto({entryProof:{entryId:OTHER}})});
 assert.equal(summary.status,'attention');assert.equal(summary.stop,null);assert.equal(summary.userPause,null);
});

test('a new independent movement session is not adopted by an old completed entry',()=>{
 const summary=summarize({entry:entry({status:'completed',movementSessionId:OTHER}),autoSeeding:auto()});
 assert.equal(summary.status,'working');assert.deepEqual(summary.stop,{kind:'auto',id:AUTO});assert.equal(summary.scope.rootId,AUTO);assert.equal(summary.team,null);
});

test('population and account data cannot upgrade a waiting match to active play or a VIP reward',()=>{
 const summary=summarize({autoSeeding:auto({status:'waiting_match'}),servers:[{number:2,players:100,trusted:true}],account:{vipFresh:true,seedingFresh:true,vip:{tiene:true},seeding:{estado:'aguantando',servidor:2,dentro:true}}});
 assert.equal(summary.status,'waiting');assert.equal(summary.phase,'match');assert.equal(summary.title,'Esperando el inicio de partida');assert.equal(/premio|VIP|jugando/i.test(summary.title+' '+summary.detail),false);assert.equal('rewardVerified'in summary,false);
});

test('lack of Steam reading does not block a valid manually confirmed movement session',()=>{
 const summary=summarize({autoSeeding:auto(),account:{available:false,seedingFresh:false}});assert.equal(summary.status,'working');assert.equal(summary.nextAction,'wait');assert.deepEqual(summary.stop,{kind:'auto',id:AUTO});
});

test('activity and maximum modes show their real shared budget without inventing a destination',()=>{
 for(const [strategy,mode]of [['activity','activity'],['maximum','maximum']]){
  const summary=summarize({activity:activity({strategy})});assert.equal(summary.mode,mode);assert.equal(summary.status,'waiting');assert.equal(summary.phase,'source');assert.equal(summary.server,null);assert.equal(summary.timing.remainingSeconds,600);assert.deepEqual(summary.stop,{kind:'activity',id:JOB});
 }
});

test('only the exact activity origin can collapse an entry with a launching activity job',()=>{
 const base={entry:entry(),activity:activity({status:'launching',strategy:'maximum',selectedServer:2}),entryOrigin:{kind:'activity',ownerId:JOB,entryId:ENTRY}};
 const summary=summarize(base);assert.equal(summary.mode,'maximum');assert.notEqual(summary.status,'attention');assert.deepEqual(summary.stop,{kind:'entry',id:ENTRY});
 const changed=summarize({...base,entryOrigin:{...base.entryOrigin,ownerId:OTHER}});assert.equal(changed.status,'attention');assert.equal(changed.stop,null);
});

test('fallback activity needs both job and movement IDs; a legacy remembered ID cannot bind it',()=>{
 const base={activity:activity({status:'launching',strategy:'maximum'}),autoSeeding:auto(),activityOwnership:{jobId:JOB,movementSessionId:AUTO}};
 const summary=summarize(base);assert.equal(summary.mode,'maximum');assert.deepEqual(summary.stop,{kind:'activity',id:JOB});
 const wrong=summarize({...base,activityOwnership:{jobId:OTHER,movementSessionId:AUTO}});assert.equal(wrong.status,'attention');assert.equal(wrong.stop,null);
 const remembered=summarize({...base,activityOwnership:null,activityMovementId:AUTO});assert.equal(remembered.status,'attention');assert.equal(remembered.stop,null);
});

test('a scheduled opening counts down to its schedule and stays separate from an unrelated job',()=>{
 const opening={id:JOB,status:'scheduled',server:2,team:'blue',createdAt:BEFORE,scheduledAt:END};
 const summary=summarize({opening});assert.equal(summary.status,'scheduled');assert.equal(summary.timing.kind,'schedule');assert.equal(summary.timing.remainingSeconds,600);assert.deepEqual(summary.stop,{kind:'opening',id:JOB});
 const conflict=summarize({opening,autoSeeding:auto()});assert.equal(conflict.status,'attention');assert.equal(conflict.stop,null);
});

test('a launching schedule can be folded into only its current exact entry',()=>{
 const opening={id:JOB,status:'launching',server:2};
 const summary=summarize({opening,entry:entry(),entryOrigin:{kind:'scheduled',ownerId:JOB,entryId:ENTRY}});assert.notEqual(summary.status,'attention');assert.deepEqual(summary.stop,{kind:'entry',id:ENTRY});
 const wrong=summarize({opening,entry:entry(),entryOrigin:{kind:'scheduled',ownerId:JOB,entryId:OTHER}});assert.equal(wrong.status,'attention');
});

test('persistent waiting has no invented total deadline and the attempt has its own labelled deadline',()=>{
 const idle=summarize({persistentTeam:persistent()});assert.equal(idle.status,'waiting');assert.equal(idle.timing.kind,'none');assert.equal(idle.timing.endAt,null);assert.match(idle.detail,/clics están apagados/);assert.deepEqual(idle.stop,{kind:'persistent-team',id:PREF});
 const attempt=summarize({persistentTeam:persistent({status:'selecting',selectorAcquired:true,selectionEndsAt:END,acquisitionEndsAt:'2026-11-04T18:01:00.000Z'})});assert.equal(attempt.status,'working');assert.equal(attempt.timing.kind,'attempt');assert.equal(attempt.timing.endAt,END);assert.equal(attempt.timing.remainingSeconds,600);
});

test('a persistent selector is grouped by attempt owner and selector IDs, never just by team',()=>{
 const base={persistentTeam:persistent({status:'selecting',ownerId:JOB,sessionId:TEAM}),teamClicker:clicker({ownerId:JOB,running:true})};
 const summary=summarize(base);assert.equal(summary.status,'working');assert.deepEqual(summary.stop,{kind:'persistent-team',id:PREF});
 const conflict=summarize({...base,teamClicker:clicker({ownerId:OTHER,running:true})});assert.equal(conflict.status,'attention');assert.equal(conflict.stop,null);
});

test('latched persistent faults stay review-required even with an obsolete mouse pause object',()=>{
 for(const status of ['paused_controller','paused_identity','paused_error']){const summary=summarize({persistentTeam:persistent({status,userPause:userPause()})});assert.equal(summary.status,'attention');assert.equal(summary.nextAction,'review_errors');assert.equal(summary.userPause,null);assert.deepEqual(summary.stop,{kind:'persistent-team',id:PREF});}
});

test('an observed stop for the persistent monitor takes precedence over mouse-idle resumption',()=>{
 const summary=summarize({persistentTeam:persistent({monitorSessionId:MONITOR,userPause:userPause()}),teamClicker:clicker({enabled:false,sessionId:null,controllerSessionId:MONITOR,operatorStoppedSessionId:MONITOR})});
 assert.equal(summary.status,'stopping');assert.equal(summary.userPause,null);assert.equal(summary.stop,null);
});

test('an independent selector with no fresh report waits instead of claiming clicks or a mouse pause',()=>{
 const summary=summarize({teamClicker:clicker({controllerFresh:false,running:true,userPause:userPause()})});assert.equal(summary.status,'waiting');assert.equal(summary.phase,'controller');assert.equal(summary.userPause,null);assert.deepEqual(summary.stop,{kind:'team',id:TEAM});
});

test('explicit fresh mouse pause is presented without changing the session limit or stop scope',()=>{
 const summary=summarize({autoSeeding:auto({status:'paused_mouse',userPause:userPause()})});assert.equal(summary.status,'paused');assert.deepEqual(summary.userPause,{kind:'mouse',active:true,resumeAt:'2026-11-04T18:00:03.000Z',remainingSeconds:3,buttonsDown:false});assert.equal(summary.timing.endAt,END);assert.deepEqual(summary.stop,{kind:'auto',id:AUTO});assert.equal(summary.nextAction,'wait');
});

test('mouse buttons held do not show a running reactivation countdown; zero waits for new evidence',()=>{
 const held=summarize({autoSeeding:auto({status:'paused_mouse',userPause:userPause({buttonsDown:true,resumeAt:null})})});assert.equal(held.userPause.remainingSeconds,null);assert.match(held.detail,/Suelta los botones/);
 const zero=summarize({autoSeeding:auto({status:'paused_mouse',userPause:userPause({remainingMs:0,resumeAt:NOW})})});assert.equal(zero.status,'paused');assert.equal(zero.userPause.remainingSeconds,0);assert.match(zero.detail,/comprobación nueva/);assert.equal(zero.nextAction,'wait');
});

test('an owned persistent child may expose its fresh pause but not an old or foreign child',()=>{
 const p=persistent({status:'selecting',ownerId:JOB,sessionId:TEAM}),t=clicker({ownerId:JOB,userPause:userPause()});
 assert.equal(summarize({persistentTeam:p,teamClicker:t}).status,'paused');
 assert.equal(summarize({persistentTeam:p,teamClicker:{...t,controllerFresh:false}}).userPause,null);
 assert.equal(summarize({persistentTeam:p,teamClicker:{...t,ownerId:OTHER}}).userPause,null);
});

test('paused_mouse text alone or a disabled DTO never creates a mouse countdown',()=>{
 for(const pause of [undefined,{...userPause(),active:false},{...userPause(),kind:'keyboard'}]){const summary=summarize({autoSeeding:auto({status:'paused_mouse',userPause:pause,reason:'El ratón está moviéndose'})});assert.equal(summary.userPause,null);assert.equal(summary.status,'waiting');assert.doesNotMatch(summary.detail,/ratón/);}
});

test('F8/operator stopped state stays terminal even if a stale mouse object says active',()=>{
 const summary=summarize({autoSeeding:auto({operatorStopped:true,userPause:userPause(),finishedAt:NOW})});assert.equal(summary.status,'finished');assert.equal(summary.userPause,null);assert.equal(summary.stop,null);assert.equal(summary.title,'Sesión detenida');
});

test('a fresh F8 for the exact independent selector is stopping; another owner cannot cancel its pause',()=>{
 const stopped=summarize({teamClicker:clicker({operatorStoppedSessionId:TEAM,userPause:userPause()})});assert.equal(stopped.status,'stopping');assert.equal(stopped.stop,null);assert.equal(stopped.userPause,null);
 const other=summarize({teamClicker:clicker({operatorStoppedSessionId:OTHER,userPause:userPause()})});assert.equal(other.status,'paused');assert.deepEqual(other.stop,{kind:'team',id:TEAM});
});

test('entry presence mode cannot appear verified without its exact current entry binding',()=>{
 const summary=summarize({autoSeeding:auto({presenceMode:'entry',entryProof:{entryId:ENTRY}})});assert.equal(summary.status,'attention');assert.equal(summary.stop,null);
});

test('cleanup takes priority and cannot offer a stop for another newly starting controller',()=>{
 const summary=summarize({entry:entry({status:'cancelled',cleanupPending:true,userPause:userPause()})});assert.equal(summary.status,'stopping');assert.equal(summary.phase,'cleanup');assert.equal(summary.stop,null);assert.equal(summary.userPause,null);
});

test('a passive web watch does not conflict with a valid active input session',()=>{
 const summary=summarize({autoSeeding:auto(),watch:{id:JOB,status:'watching',server:2}});assert.equal(summary.status,'working');assert.equal(summary.mode,'seeding');assert.deepEqual(summary.stop,{kind:'auto',id:AUTO});
 const alone=summarize({watch:{id:JOB,status:'watching',server:2,endAt:END}});assert.equal(alone.mode,'observation');assert.deepEqual(alone.stop,{kind:'watch',id:JOB});assert.match(alone.detail,/no confirma un premio/);
});

test('a stale, future or invalid service snapshot removes actions and countdowns while retaining context',()=>{
 for(const stamp of ['2026-11-04T17:59:44.999Z','2026-11-04T18:00:05.001Z','invalid']){const summary=buildSessionSummary({now:stamp,autoSeeding:auto({status:'paused_mouse',userPause:userPause()})},{now:NOW});assert.equal(summary.status,'unknown');assert.equal(summary.stop,null);assert.equal(summary.userPause,null);assert.equal(summary.timing.remainingSeconds,null);assert.equal(summary.server,2);}
 const invalid=summarize({autoSeeding:auto()},{now:'invalid'});assert.equal(invalid.generatedAt,null);assert.equal(invalid.status,'unknown');assert.equal(invalid.stop,null);
});

test('stale public data cannot claim the game disconnected or a manual session stopped',()=>{
 const summary=summarize({autoSeeding:auto({status:'waiting_source'}),source:{error:'timeout'},servers:[{number:2,stale:true,trusted:false,online:false}],account:{seedingFresh:false,seeding:{dentro:false}}});assert.equal(summary.status,'waiting');assert.equal(summary.phase,'source');assert.doesNotMatch(summary.title+' '+summary.detail,/desconectad|expulsad|VIP/i);assert.deepEqual(summary.stop,{kind:'auto',id:AUTO});
});

test('old terminal faults do not replace a current active session; terminal choice uses actual finish evidence',()=>{
 const active=summarize({entry:entry({status:'error',finishedAt:NOW}),autoSeeding:auto()});assert.equal(active.status,'working');assert.deepEqual(active.stop,{kind:'auto',id:AUTO});
 const finished=summarize({entry:entry({status:'error',finishedAt:BEFORE}),activity:activity({status:'expired',finishedAt:NOW})});assert.equal(finished.status,'finished');assert.equal(finished.title,'Tiempo de sesión terminado');assert.equal(finished.timing.finishedAt,NOW);assert.equal(finished.scope.id,JOB);
 const event=summarize({autoSeeding:auto({status:'cancelled'}),events:[{kind:'auto_seeding_stopped',id:AUTO,at:NOW,token:'private-event'}]});assert.equal(event.timing.finishedAt,NOW);
});

test('malformed active records cannot look idle or expose an actionable identifier',()=>{
 for(const extra of [{entry:entry({id:'bad'})},{autoSeeding:auto({id:'bad'})},{persistentTeam:persistent({id:'bad'})},{teamClicker:clicker({sessionId:'bad'})}]){const summary=summarize(extra);assert.equal(summary.status,'attention');assert.equal(summary.stop,null);assert.equal(summary.scope,null);}
});

test('an armed controller without a matching active coordinator requires review and cannot stop an unknown owner',()=>{
 const summary=summarize({movement:{available:true,armed:true,autoSessionId:OTHER,reason:'private-native'}});assert.equal(summary.status,'attention');assert.equal(summary.mode,null);assert.equal(summary.stop,null);assert.equal(summary.nextAction,'review_errors');
});

test('summary is a privacy allowlist and never mutates input, including nested records',()=>{
 const privateText='secret-token-private-steam-cookie-player-ocr';
 const input=state({token:privateText,installationRoot:'C:\\Users\\private',account:{steamId:privateText,vip:{name:privateText}},entry:entry({status:'completed',finishedAt:NOW,reason:privateText,gamePid:92837465,gameWindow:92837466,raw:{text:privateText}}),events:[{id:ENTRY,kind:'entry_flow_finished',at:NOW,reason:privateText}],source:{error:privateText}});
 const before=structuredClone(input),summary=buildSessionSummary(input,{now:NOW}),serialized=JSON.stringify(summary);assert.deepEqual(input,before);assert.equal(serialized.includes(privateText),false);assert.equal(serialized.includes('92837465'),false);assert.equal(serialized.includes('C:\\Users'),false);
 for(const key of ['token','account','reason','gamePid','gameWindow','entryProof','frameId','raw','installationRoot'])assert.equal(new RegExp('"'+key+'"\\s*:').test(serialized),false,key);
});

test('an idle installation can describe its update without inventing a cancellable session',()=>{
 const summary=summarize({update:{status:'installing'}});assert.equal(summary.status,'working');assert.equal(summary.phase,'update');assert.equal(summary.scope,null);assert.equal(summary.stop,null);
 const withHistory=summarize({update:{status:'installing'},entry:entry({status:'error',finishedAt:BEFORE})});assert.equal(withHistory.phase,'update');assert.equal(withHistory.status,'working');assert.equal(withHistory.scope,null);
});
