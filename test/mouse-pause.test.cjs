'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizeMousePause,mousePauseView}=require('../src/mouse-pause.cjs');
const {createAutoSeeding,advanceAutoSeeding}=require('../src/auto-seeding.cjs');
test('mouse pause defaults are explicit and unknown fields cannot enable side effects',()=>{
 assert.deepEqual(normalizeMousePause(),{enabled:true,resumeAfterSeconds:3});assert.deepEqual(normalizeMousePause({enabled:false,resumeAfterSeconds:30}),{enabled:false,resumeAfterSeconds:30});
 for(const value of [null,true,{enabled:'yes'},{resumeAfterSeconds:0},{resumeAfterSeconds:31},{resumeAfterSeconds:1.5},{resumeAfterSeconds:'3'},{hotkey:'F1'}])assert.throws(()=>normalizeMousePause(value));
});
test('mouse pause view projects only typed fields and derives countdown from a bounded future time',()=>{
 const at=Date.parse('2026-11-04T12:00:00Z'),raw={kind:'mouse',active:true,buttonsDown:false,remainingMs:3000,resumeAt:new Date(at+2500).toISOString(),token:'must-not-leak'};
 assert.deepEqual(mousePauseView(raw,at),{kind:'mouse',active:true,resumeAt:raw.resumeAt,remainingMs:2500,buttonsDown:false});assert.equal(mousePauseView({...raw,remainingMs:30001},at),null);assert.equal(mousePauseView({...raw,kind:'keyboard'},at),null);
 assert.deepEqual(mousePauseView({...raw,active:false},at),{kind:'mouse',active:false,resumeAt:null,remainingMs:0,buttonsDown:false});
});
function fixture(){const at=Date.parse('2026-11-04T12:00:00Z'),session=createAutoSeeding({server:1,durationMinutes:10,presenceMode:'manual',confirmedServer:1},at);return{at,session,input:{server:{number:1,trusted:true,players:20,seedingActive:true},account:null,screen:{status:'verified_capture',scene:'gameplay_hud',gameForeground:true,gamePid:123,capturedAt:new Date(at).toISOString()},movement:{available:true,armed:true,autoSessionId:session.id,userPause:{kind:'mouse',active:true,buttonsDown:false,remainingMs:3000,resumeAt:new Date(at+3000).toISOString()}}}};}
test('verified own mouse pause keeps movement lease renewal but cannot bypass warmup, ownership or F8',()=>{
 const f=fixture(),result=advanceAutoSeeding(f.session,f.input,f.at);assert.equal(result.session.status,'paused_mouse');assert.equal(result.command,'start');assert.equal(result.session.userPause.active,true);
 assert.equal(advanceAutoSeeding(f.session,{...f.input,screen:{...f.input.screen,matchWaiting:true}},f.at).session.status,'waiting_match');
 assert.equal(advanceAutoSeeding(f.session,{...f.input,movement:{...f.input.movement,autoSessionId:'foreign'}},f.at).session.status,'error');
 const stopped=advanceAutoSeeding(f.session,{...f.input,movement:{...f.input.movement,autoOperatorStopped:f.session.id}},f.at);assert.equal(stopped.session.status,'cancelled');assert.equal(stopped.command,'stop');
});
test('expired mouse pause still requires HUD captured after its new owned activity revision',()=>{
 const f=fixture();f.input.movement.at=new Date(f.at).toISOString();f.input.movement.userPause={kind:'mouse',active:false,remainingMs:0,buttonsDown:false,resumeAt:null,revision:2};
 const first=advanceAutoSeeding(f.session,f.input,f.at);assert.equal(first.session.status,'waiting_game');assert.equal(first.session.mouseActivityRevision,2);assert.equal(first.command,'stop');
 const fresh={...f.input,screen:{...f.input.screen,capturedAt:new Date(f.at+100).toISOString()}};const resumed=advanceAutoSeeding(first.session,fresh,f.at+100);assert.equal(resumed.session.status,'moving');assert.equal(resumed.session.mouseActivityRevision,2);
 const regressed=advanceAutoSeeding(resumed.session,{...fresh,movement:{...fresh.movement,userPause:{...fresh.movement.userPause,revision:1}}},f.at+100);assert.equal(regressed.session.status,'error');assert.equal(regressed.command,'stop');
});
test('unavailable, foreign and disabled mouse reports cannot project another controllers pause',()=>{
 const f=fixture();for(const movement of [{...f.input.movement,available:false},{...f.input.movement,autoSessionId:'foreign'}])assert.equal(advanceAutoSeeding(f.session,{...f.input,movement},f.at).session.userPause,null);
 assert.equal(advanceAutoSeeding({...f.session,mousePause:{enabled:false,resumeAfterSeconds:3}},f.input,f.at).session.userPause,null);
});
