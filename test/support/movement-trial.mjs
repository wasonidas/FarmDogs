'use strict';

// Regression-only state machine. All observations and actions are injected by
// the tests; importing this module starts no timers and sends no native input.
export function createMovementTrial({driver, window, serverNumber, intervalMs=60000, durationMs=1500000, now=Date.now, record=()=>{}}) {
 if (!Number.isInteger(window?.id) || window.id<=0 || !/[\\/]WardogsClient-Win64-Shipping\.exe$/i.test(window.app??'')) throw Error('Expected a returned Wardogs game window');
 if (!Number.isInteger(serverNumber) || serverNumber<1 || serverNumber>5) throw Error('Expected a Wardogs Spain server number');
 if (!Number.isFinite(intervalMs) || intervalMs<10000 || intervalMs>300000 || !Number.isFinite(durationMs) || durationMs<intervalMs || durationMs>1800000) throw Error('Trial must be bounded to at most 30 minutes');
 if (typeof driver?.press_key!=='function' || typeof driver?.get_window_state!=='function') throw Error('Expected the documented Sky driver');
 let status='prepared', startedAt=null, deadline=null, nextDueAt=null, count=0, busy=false;
 const usedStates=new WeakSet(),usedFrames=new WeakSet();
 const snapshot=()=>({status,serverNumber,intervalMs,durationMs,startedAt,deadline,nextDueAt,count});
 const log=(event,extra={})=>record({event,at:new Date(now()).toISOString(),...snapshot(),...extra});
 function stop(reason='user_stop') { status='stopped'; log('stopped',{reason}); return snapshot(); }
 function start({activeMatchVerified=false,safeZoneVerified=false,movementVerified=false,userReady=false}={}) {
  if(status!=='prepared') throw Error('A trial can start only once');
  if(!userReady || !activeMatchVerified || !safeZoneVerified || !movementVerified) throw Error('Wait for user readiness and visual movement/scene verification');
  startedAt=now();deadline=startedAt+durationMs;nextDueAt=startedAt;status='running';
  try { log('started'); } catch(error) { status='stopped'; throw error; }
  return snapshot();
 }
 async function pulse({state,capturedAt,review}={}) {
  if(status!=='running') return {kind:'inactive',...snapshot()};
  if(now()>=deadline) return {kind:'finished',...stop('duration_complete')};
  if(busy) return {kind:'busy',...snapshot()};
  if(now()<nextDueAt) return {kind:'waiting',...snapshot()};
  const frame=state?.screenshots?.[0],frameId=frame?.id;
  const validWindow=state?.window?.id===window.id && state?.window?.app===window.app;
  const fresh=Number.isFinite(capturedAt) && now()>=capturedAt && now()-capturedAt<=15000;
  if(!validWindow || !fresh || !frameId || usedStates.has(state) || usedFrames.has(frame) || review?.activeMatch!==true || review?.safeZone!==true || review?.chatClosed!==true) {
   return {kind:'stopped',...stop('fresh_scene_verification_required')};
  }
  // A screenshot ID may repeat between acquisitions; the observation itself
  // cannot be reused to authorize a second pulse.
  busy=true;usedStates.add(state);usedFrames.add(frame);
  const key=count%2===0?'a':'d';
  let inputAttempted=false,inputCompleted=false;
  try {
   log('input_requested',{key,frameId});
   inputAttempted=true;
   await driver.press_key({window:state.window,key});
   inputCompleted=true;count++;
   const captureBefore=now();
   const nextState=await driver.get_window_state({window:state.window});
   const captureAfter=now();
   nextDueAt=captureAfter+intervalMs;
   log('input_completed',{key,captureBefore,captureAfter});
   return {kind:'pulse',key,state:nextState,capturedAt:captureAfter,...snapshot()};
  } catch(error) {
   status='stopped';
   try { log('failed',{error:error.message,inputAttempted,inputCompleted,inputOutcomeUnknown:inputAttempted&&!inputCompleted}); } catch {}
   throw error;
  } finally { busy=false; }
 }
 return {start,pulse,stop,snapshot};
}
