const {test}=require('node:test');
const assert=require('node:assert/strict');
const {analyzeAfkTrial}=require('../src/afk-timing.cjs');
const sample=(capturedAt,state,extra={})=>({capturedAt,state,evidence:'fixture.png',...extra});
const kick=(at,extra={})=>sample(at,'kicked',{reason:'inactivity',message:'Desconectado por inactividad',...extra});
const input={beforeAt:'2026-10-29T10:00:00.000Z',afterAt:'2026-10-29T10:00:00.100Z'};

test('17 min 51 s entre capturas no se convierten en una duración AFK sin última interacción fiable',()=>{
 const result=analyzeAfkTrial({activityUncertain:true,observations:[sample('2026-10-29T09:04:23.236Z','connected'),kick('2026-10-29T09:22:14.584Z')]});
 assert.equal(result.outcome,'kicked_for_inactivity');assert.equal(result.detectionWindow.gapMs,1071348);
 assert.equal(result.elapsedSinceLastIdentifiedInput,null);assert.equal(result.afkTimerSettingKnown,false);
 const withoutConnection=analyzeAfkTrial({lastIdentifiedInput:input,observations:[kick('2026-10-29T10:02:40Z')]});
 assert.equal(withoutConnection.detectionWindow.after,null);assert.equal(withoutConnection.elapsedSinceLastIdentifiedInput,null);
});
test('una última interacción acotada y capturas cada 20 s producen límites, no un temporizador exacto',()=>{
 const result=analyzeAfkTrial({lastIdentifiedInput:input,observations:[sample('2026-10-29T10:00:01Z','connected'),sample('2026-10-29T10:02:20Z','connected'),kick('2026-10-29T10:02:40Z')]});
 assert.equal(result.detectionWindow.gapMs,20000);
 assert.deepEqual(result.elapsedSinceLastIdentifiedInput,{moreThanMs:139900,atMostMs:160000});
 assert.equal(result.afkTimerSettingKnown,false);
 const uncertain=analyzeAfkTrial({lastIdentifiedInput:input,activityUncertain:true,observations:[sample('2026-10-29T10:02:20Z','connected'),kick('2026-10-29T10:02:40Z')]});
 assert.equal(uncertain.elapsedSinceLastIdentifiedInput,null);
});
test('una desconexión de red no acredita una expulsión por inactividad',()=>{
 const result=analyzeAfkTrial({lastIdentifiedInput:input,observations:[sample('2026-10-29T10:00:01Z','connected'),kick('2026-10-29T10:02:40Z',{reason:'network'})]});
 assert.equal(result.outcome,'other_disconnect');assert.equal(result.detectionWindow,null);assert.equal(result.elapsedSinceLastIdentifiedInput,null);
});
test('la latencia del capturador ensancha los límites y nunca se cuenta como conexión observada',()=>{
 const connected={state:'connected',evidence:'fixture.png',captureStartedAt:'2026-10-29T10:02:20Z',captureFinishedAt:'2026-10-29T10:02:24Z'};
 const kicked={state:'kicked',reason:'inactivity',message:'Inactividad',evidence:'fixture.png',captureStartedAt:'2026-10-29T10:02:40Z',captureFinishedAt:'2026-10-29T10:02:46Z'};
 const ongoing=analyzeAfkTrial({lastIdentifiedInput:input,observations:[connected]});
 assert.equal(ongoing.elapsedSinceLastIdentifiedInput.atLeastMs,139900);
 const result=analyzeAfkTrial({lastIdentifiedInput:input,observations:[connected,kicked]});
 assert.equal(result.boundsUseCaptureWindows,true);assert.equal(result.detectionWindow.gapMs,26000);
 assert.deepEqual(result.elapsedSinceLastIdentifiedInput,{moreThanMs:139900,atMostMs:166000});
});
test('un cambio de fase interrumpe el ensayo y rechaza muestras posteriores o relojes invertidos',()=>{
 const observations=[sample('2026-10-29T10:00:01Z','connected'),sample('2026-10-29T10:01:00Z','transition')];
 assert.equal(analyzeAfkTrial({observations}).outcome,'interrupted_by_transition');
 assert.throws(()=>analyzeAfkTrial({observations:[...observations,kick('2026-10-29T10:02:40Z')]}),/separado/);
 assert.throws(()=>analyzeAfkTrial({observations:[observations[1],observations[0]]}),/ordenadas/);
 assert.throws(()=>analyzeAfkTrial({lastIdentifiedInput:{beforeAt:input.afterAt,afterAt:input.beforeAt},observations:[observations[0]]}),/invertidos/);
});
