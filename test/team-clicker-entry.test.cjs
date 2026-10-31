'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {classifyTeamEntry,clickerAttempt,currentAttemptScreen,entryProof}=require('../src/team-clicker-entry.cjs');
const accepted=require('./fixtures/ocr-team-entry.json');
const selector=require('./fixtures/ocr-team-selector.json');
const hud=require('./fixtures/ocr-gameplay-hud.json');
const deployingButton=require('./fixtures/ocr-team-deploying-button.json');
const deployingChat=require('./fixtures/ocr-team-deploying-chat.json');
const now=Date.parse('2026-10-31T10:00:00Z');
const sessionId='11111111-1111-4111-8111-111111111111',attemptId='22222222-2222-4222-8222-222222222222',frameId='33333333-3333-4333-8333-333333333333';
function marker(label='DESPLEGANDO'){
 return {format:'wardogs-image-text-v1',width:2560,height:1440,lines:[{text:label,words:[{text:label,x:990,y:655,width:440,height:36}]}]};
}
function attempt(fields={}){return clickerAttempt({sessionId,active:true,attemptId,attemptStartedAt:new Date(now-1000).toISOString(),gamePid:100,gameWindow:200,count:3,...fields},sessionId);}
function screen(fields={}){return {status:'verified_capture',scene:'deploying',entryConfirmed:true,gameForeground:true,gamePid:100,gameWindow:200,frameId,capturedAt:new Date(now-500).toISOString(),...fields};}

test('entrada de equipo: solo el marcador aislado DESPLEGANDO/DEPLOYING es positivo',()=>{
 for(const label of ['DESPLEGANDO','// DESPLEGANDO...','DEPLOYING','// DEPLOYING…']){
  const result=classifyTeamEntry(marker(label));assert.equal(result.phase,'deploying');assert.equal(result.entryConfirmed,true);assert.equal(result.inputAllowed,false);
 }
 // Real, sanitized OCR from the blue test is intentionally negative: accepting
 // a contract or entering a faction is not the user's deployment stop marker.
 for(const report of [accepted,selector,hud])assert.equal(classifyTeamEntry(report).entryConfirmed,false);
});

test('entrada de equipo: admite el botón inferior derecho sin aceptar DESPLEGAR ni chat',()=>{
 assert.equal(classifyTeamEntry(deployingButton).entryConfirmed,true);
 const english=structuredClone(deployingButton);english.lines[0].text='DEPLOYING';english.lines[0].words[0].text='DEPLOYING';assert.equal(classifyTeamEntry(english).entryConfirmed,true);
 for(const report of [deployingChat,marker('DESPLEGAR')])assert.equal(classifyTeamEntry(report).entryConfirmed,false);
 const prefixed=structuredClone(deployingButton);prefixed.lines[0].words.unshift({text:'Jugador:',x:1990,y:1320,width:140,height:32});assert.equal(classifyTeamEntry(prefixed).entryConfirmed,false);
 const lowerLeft=structuredClone(deployingButton);lowerLeft.lines[0].words[0].x=80;assert.equal(classifyTeamEntry(lowerLeft).entryConfirmed,false);
});

test('entrada de equipo: chat, frases, bordes y etiquetas separadas no acreditan despliegue',()=>{
 for(const label of ['Jugador: DESPLEGANDO','NO DESPLEGANDO','DESPLEGANDO EN 3','CONTRATO ACEPTADO','ENTRANDO A LA FACCIÓN'])assert.equal(classifyTeamEntry(marker(label)).entryConfirmed,false);
 for(const change of [w=>w.x=20,w=>w.y=20,w=>w.y=1350,w=>w.height=8,w=>w.x=NaN]){const report=marker();change(report.lines[0].words[0]);assert.equal(classifyTeamEntry(report).entryConfirmed,false);}
 const split=marker();split.lines.push(structuredClone(split.lines[0]));split.lines[1].words[0].y+=100;assert.equal(classifyTeamEntry(split).entryConfirmed,false);
 const duplicate=marker();duplicate.lines.push(structuredClone(duplicate.lines[0]));duplicate.lines[1].words[0].x+=1;assert.equal(classifyTeamEntry(duplicate).entryConfirmed,true);
});

test('entrada de equipo: solo una captura del mismo intento posterior al inicio puede detener',()=>{
 const a=attempt(),s=screen();assert.equal(currentAttemptScreen(s,a,now),true);assert.equal(entryProof(s,a,now).attemptId,attemptId);
 for(const fields of [{gamePid:101},{gameWindow:201},{capturedAt:new Date(now-6000).toISOString()},{capturedAt:new Date(now+1).toISOString()},{capturedAt:new Date(now-1500).toISOString()},{status:'unknown'},{gameForeground:false},{frameId:'bad'}])assert.equal(entryProof(screen(fields),a,now),null);
 for(const scene of ['gameplay_hud','joining_faction','team_selector','unknown'])assert.equal(entryProof(screen({scene}),a,now),null);
 assert.equal(entryProof(s,attempt({count:0}),now),null);
 assert.equal(clickerAttempt({...a,active:true,sessionId:'44444444-4444-4444-8444-444444444444'},sessionId),null);
});
