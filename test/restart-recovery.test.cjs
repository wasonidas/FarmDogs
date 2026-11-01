'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {eligibleRestart,observeRestartSource,rejectRecoveryInput}=require('../src/restart-recovery.cjs');
const now=Date.parse('2026-11-01T06:01:00Z'),joinId=randomUUID();
function eligible(){
 const id=randomUUID(),movementSessionId=randomUUID(),frameId=randomUUID();
 const entry={id,status:'completed',connected:true,connectionSource:'verified_entry_ui_chain',seeding:true,restartCount:0,server:1,joinId,gamePid:123,gameWindow:456,deployedAt:new Date(now-60000).toISOString()};
 const proof={entryId:id,server:1,joinId,gamePid:123,gameWindow:456,confirmedAt:entry.deployedAt};
 const evidence={cause:'server_restart',confirmed:true,entryId:id,seedingId:movementSessionId,server:1,joinId,gamePid:123,gameWindow:456,frameId,capturedAt:new Date(now).toISOString()};
 return {entry,movementSessionId,movement:{},session:{id:movementSessionId,status:'error',purpose:'seeding',presenceMode:'entry',entryId:id,server:1,entryProof:proof,disconnect:evidence},now};
}
test('reinicio: exige raíz completada, movimiento propio y diagnóstico positivo fresco de la misma ventana',()=>{
 const value=eligible();assert.equal(eligibleRestart(value).frameId,value.session.disconnect.frameId);
 for(const alter of [v=>v.entry.status='cancelled',v=>v.entry.connectionSource='manual',v=>v.entry.operatorStopped=true,v=>v.entry.seeding=false,v=>v.entry.connected=false,v=>v.entry.restartCount=1,v=>v.session.operatorStopped=true,v=>v.session.presenceMode='manual',v=>v.session.presenceMode='account',v=>v.session.purpose='break',v=>v.session.id=randomUUID(),v=>v.session.entryId=randomUUID(),v=>v.session.entryProof.joinId=randomUUID(),v=>v.session.entryProof.confirmedAt=new Date(now-50000).toISOString(),v=>v.session.disconnect.confirmed=false,v=>v.session.disconnect.cause='afk_kick',v=>v.session.disconnect.gamePid=789,v=>v.session.disconnect.gameWindow=789,v=>v.session.disconnect.frameId='old',v=>v.session.disconnect.capturedAt=new Date(now-5001).toISOString(),v=>v.session.disconnect.capturedAt=new Date(now+1).toISOString(),v=>v.movement.autoOperatorStopped=v.session.id,v=>v.movement.autoOperatorStopped=v.entry.id]){
  const value=eligible();alter(value);assert.equal(eligibleRestart(value),null,alter.toString());
 }
});
test('reinicio: dos muestras del mismo UUID posteriores al diagnóstico; duplicar fetchedAt no suma',()=>{
 const recovery={server:1,joinId,detectedAt:new Date(now).toISOString(),sourceSamples:[]};
 const row={number:1,joinId,trusted:true,online:true,stale:false,players:0,capacity:100,sourceAt:new Date(now+30000).toISOString()};
 let r=observeRestartSource(recovery,row,now+30000);assert.equal(r.status,'waiting');assert.equal(r.sourceSamples.length,1);
 r=observeRestartSource({...recovery,sourceSamples:r.sourceSamples},row,now+31000);assert.equal(r.sourceSamples.length,1);
 r=observeRestartSource({...recovery,sourceSamples:r.sourceSamples},{...row,sourceAt:new Date(now+60000).toISOString()},now+60000);assert.equal(r.status,'ready');assert.equal(r.sourceSamples.length,2);
});
test('reinicio: fila stale aunque fetch fresco, fuente vieja/futura u otro servidor no autorizan ni conservan muestras',()=>{
 const recovery={server:1,joinId,detectedAt:new Date(now).toISOString(),sourceSamples:[new Date(now+1000).toISOString()]};
 const row={number:1,joinId,trusted:true,online:true,stale:false,players:0,capacity:100,sourceAt:new Date(now+30000).toISOString()};
 for(const change of [{stale:true},{trusted:false},{online:false},{number:2},{sourceAt:new Date(now).toISOString()},{sourceAt:new Date(now+31000).toISOString()},{sourceAt:new Date(now-90001).toISOString()},{players:-1},{players:101},{capacity:0}]){
  const r=observeRestartSource(recovery,{...row,...change},now+30000);assert.equal(r.status,'waiting');assert.deepEqual(r.sourceSamples,[]);
 }
 assert.equal(observeRestartSource(recovery,{...row,joinId:randomUUID()},now+30000).status,'changed');
});
test('reinicio: los campos de autoridad interna no se admiten desde formularios',()=>{
 for(const input of [{recovery:{}},{restartConfirmed:true},{disconnect:{}},{launch:false},{launchGame:false},{rootEntryId:randomUUID()}])assert.throws(()=>rejectRecoveryInput(input),/solo puede/);
 rejectRecoveryInput({team:'any',durationMinutes:30});
});
