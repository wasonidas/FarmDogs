const test=require('node:test');
const assert=require('node:assert/strict');
const {createMovementTrial}=require('./support/movement-trial.mjs');

function fixture(options={}) {
 let clock=1000000;
 const window={id:123,app:'process:C:\\Games\\WardogsClient-Win64-Shipping.exe'};
 const calls=[],events=[];
 const frame=()=>({window,screenshots:[{id:'screenshot-0'}]});
 const driver={press_key:async action=>calls.push(action),get_window_state:async()=>frame()};
 const trial=createMovementTrial({driver,window,serverNumber:1,now:()=>clock,record:event=>events.push(event),...options});
 const verified=()=>({state:frame(),capturedAt:clock,review:{activeMatch:true,safeZone:true,chatClosed:true}});
 const start=()=>trial.start({userReady:true,activeMatchVerified:true,safeZoneVerified:true,movementVerified:true});
 return {trial,driver,calls,events,frame,verified,start,setTime:t=>clock=t,getTime:()=>clock};
}

test('preparation and missing user readiness send no input',async()=>{
 const f=fixture();assert.equal((await f.trial.pulse()).kind,'inactive');
 assert.throws(()=>f.trial.start({activeMatchVerified:true,safeZoneVerified:true,movementVerified:true}),/readiness/);
 assert.equal(f.calls.length,0);
});

test('pulses alternate, respect actual intervals, and do not catch up in a burst',async()=>{
 const f=fixture();f.start();
 assert.equal((await f.trial.pulse(f.verified())).key,'a');
 f.setTime(f.getTime()+59999);assert.equal((await f.trial.pulse(f.verified())).kind,'waiting');
 f.setTime(f.getTime()+1);assert.equal((await f.trial.pulse(f.verified())).key,'d');
 f.setTime(f.getTime()+180000);assert.equal((await f.trial.pulse(f.verified())).key,'a');
 assert.equal((await f.trial.pulse(f.verified())).kind,'waiting');assert.equal(f.calls.length,3);
});

test('deadline and stop prevent later input and restart',async()=>{
 const f=fixture();f.start();f.setTime(f.getTime()+1500000);
 assert.equal((await f.trial.pulse()).kind,'finished');assert.equal(f.calls.length,0);
 assert.throws(f.start,/only once/);
 const g=fixture();g.start();g.trial.stop();assert.equal((await g.trial.pulse(g.verified())).kind,'inactive');assert.equal(g.calls.length,0);
});

test('wrong target, stale frame, chat, and unverified scene stop before input',async()=>{
 for(const alter of [x=>x.state.window={...x.state.window,id:999},x=>x.capturedAt-=15001,x=>x.review.chatClosed=false,x=>x.review.activeMatch=false,x=>x.review.safeZone=false]) {
  const f=fixture();f.start();const x=f.verified();alter(x);
  assert.equal((await f.trial.pulse(x)).kind,'stopped');assert.equal(f.calls.length,0);
 }
});

test('reused screenshot cannot authorize another pulse',async()=>{
 const f=fixture();f.start();const x=f.verified();await f.trial.pulse(x);f.setTime(f.getTime()+60000);x.capturedAt=f.getTime();
 assert.equal((await f.trial.pulse(x)).kind,'stopped');assert.equal(f.calls.length,1);
});

test('new acquisitions may reuse a local screenshot ID, but copying an old frame does not refresh it',async()=>{
 const f=fixture();f.start();const first=f.verified();
 await f.trial.pulse(first);f.setTime(f.getTime()+60000);
 const next=f.verified();assert.equal(next.state.screenshots[0].id,first.state.screenshots[0].id);
 assert.equal((await f.trial.pulse(next)).kind,'pulse');
 f.setTime(f.getTime()+60000);
 assert.equal((await f.trial.pulse({...next,state:{...next.state},capturedAt:f.getTime()})).kind,'stopped');
 assert.equal(f.calls.length,2);
});

test('ambiguous input failure stops and is never retried',async()=>{
 const f=fixture();f.driver.press_key=async()=>{throw Error('uncertain input');};f.start();
 await assert.rejects(f.trial.pulse(f.verified()),/uncertain input/);
 assert.equal(f.trial.snapshot().status,'stopped');assert.equal(f.events.at(-1).inputOutcomeUnknown,true);
 assert.equal((await f.trial.pulse(f.verified())).kind,'inactive');
});

test('capture failure after input retains the completed input and stops',async()=>{
 const f=fixture();f.driver.get_window_state=async()=>{throw Error('capture failed');};f.start();
 await assert.rejects(f.trial.pulse(f.verified()),/capture failed/);
 assert.equal(f.trial.snapshot().count,1);assert.equal(f.events.at(-1).inputCompleted,true);assert.equal(f.trial.snapshot().status,'stopped');
});

test('reject unrelated processes and unbounded duration',()=>{
 assert.throws(()=>fixture({window:{id:123,app:'process:C:\\Games\\Other.exe'}}),/Wardogs game/);
 assert.throws(()=>fixture({durationMs:1800001}),/bounded/);
});
