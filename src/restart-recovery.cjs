'use strict';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PRIVATE_FIELDS=['recovery','recoveryId','recoveryPlan','restartPermit','restartConfirmed','restartAnchors','restartHeaderBounds','restartMessageBounds','disconnect','launch','launchGame','rootEntryId','previousEntryId','restartCount'];
const sameUuid=(a,b)=>UUID.test(a||'')&&UUID.test(b||'')&&a.toLowerCase()===b.toLowerCase();
function rejectRecoveryInput(input){
 if(input&&typeof input==='object'&&PRIVATE_FIELDS.some(key=>Object.hasOwn(input,key)))throw Error('La recuperación de un reinicio solo puede proceder de una entrada propia verificada.');
}
// This is a one-time continuation of a live owner, never a persisted restart job.
function eligibleRestart({entry,session,movementSessionId,movement,now}){
 if(entry?.status!=='completed'||entry.connected!==true||entry.connectionSource!=='verified_entry_ui_chain'||entry.seeding!==true||entry.operatorStopped===true||(entry.restartCount??0)!==0||!UUID.test(entry.id||''))return null;
 if(!UUID.test(movementSessionId||'')||session?.id!==movementSessionId||session.operatorStopped===true||session.status!=='error'||session.presenceMode!=='entry'||session.purpose!=='seeding')return null;
 const proof=session.entryProof,evidence=session.disconnect;
 if(session.entryId!==entry.id||proof?.entryId!==entry.id||proof.server!==entry.server||session.server!==entry.server||!sameUuid(proof.joinId,entry.joinId))return null;
 if(evidence?.cause!=='server_restart'||evidence.confirmed!==true||evidence.entryId!==entry.id||evidence.seedingId!==session.id||evidence.server!==entry.server||!sameUuid(evidence.joinId,entry.joinId)||!UUID.test(evidence.frameId||''))return null;
 if(!Number.isInteger(proof.gamePid)||proof.gamePid<1||!Number.isSafeInteger(proof.gameWindow)||proof.gameWindow<1||entry.gamePid!==proof.gamePid||entry.gameWindow!==proof.gameWindow||evidence.gamePid!==proof.gamePid||evidence.gameWindow!==proof.gameWindow)return null;
 const captured=Date.parse(evidence.capturedAt),age=now-captured;
 if(!Number.isFinite(age)||age<0||age>5000||captured<Date.parse(entry.deployedAt)||!Number.isFinite(Date.parse(entry.deployedAt))||Date.parse(proof.confirmedAt)!==Date.parse(entry.deployedAt))return null;
 if([entry.id,session.id].includes(movement?.autoOperatorStopped))return null;
 return {...evidence};
}
function observeRestartSource(recovery,server,now){
 const samples=Array.isArray(recovery.sourceSamples)?recovery.sourceSamples:[];
 const wait=reason=>({status:'waiting',sourceSamples:[],reason});
 if(server?.number!==recovery.server||server.trusted!==true||server.online!==true||server.stale===true)return wait('Esperando que el servidor vuelva a estar en línea con datos propios recientes.');
 if(!sameUuid(server.joinId,recovery.joinId))return {status:'changed',sourceSamples:[],reason:'El ID del servidor cambió durante el reinicio. Inicia una entrada nueva.'};
 const at=Date.parse(server.sourceAt),age=now-at;
 if(!Number.isFinite(age)||age<0||age>90000||at<=Date.parse(recovery.detectedAt)||!Number.isInteger(server.players)||server.players<0||server.players>100||!Number.isInteger(server.capacity)||server.capacity<1||server.players>server.capacity)return wait('Esperando una lectura del mismo servidor posterior al reinicio.');
 const previous=samples.length?Date.parse(samples[samples.length-1]):null;
 if(previous!==null&&at<previous)return wait('Esperando que avance la fecha de la fuente del servidor.');
 const next=previous===at?samples:[...samples,new Date(at).toISOString()].slice(-2);
 return {status:next.length>=2?'ready':'waiting',sourceSamples:next,reason:next.length>=2?'Servidor recuperado en dos lecturas recientes. Preparando una única reconexión.':'Servidor en línea; esperando una segunda lectura reciente antes de reconectar.'};
}
module.exports={rejectRecoveryInput,eligibleRestart,observeRestartSource};
