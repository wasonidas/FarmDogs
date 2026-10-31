'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAutoSeeding,advanceAutoSeeding}=require('../src/auto-seeding.cjs');
const now=Date.parse('2026-10-31T15:00:00Z');
const proof={entryId:'11111111-1111-4111-8111-111111111111',server:2,joinId:'22222222-2222-4222-8222-222222222222',gamePid:1234,gameWindow:5678,confirmedAt:new Date(now).toISOString()};
const request={purpose:'seeding',server:2,durationMinutes:10,presenceMode:'entry'};
const inputs=()=>({server:{number:2,trusted:true,players:20,seedingActive:true},account:{available:false},movement:{available:true,armed:false,status:'stopped'},screen:{status:'verified_capture',scene:'gameplay_hud',gameForeground:true,gamePid:1234,gameWindow:5678,capturedAt:new Date(now).toISOString()}});
const session=()=>createAutoSeeding(request,now,{trustedEntry:proof});

test('presencia por entrada: el cuerpo no puede crear una atestación ni reutilizar pruebas inválidas',()=>{
 assert.throws(()=>createAutoSeeding({...request,trustedEntry:proof,entryProof:proof,entryId:proof.entryId},now),/cadena de entrada/);
 for(const change of [{entryId:'bad'},{server:1},{joinId:'bad'},{gamePid:0},{gameWindow:0},{confirmedAt:new Date(now-5001).toISOString()},{confirmedAt:new Date(now+1).toISOString()}])assert.throws(()=>createAutoSeeding(request,now,{trustedEntry:{...proof,...change}}),/cadena de entrada/);
 const created=session();assert.equal(created.entryId,proof.entryId);assert.deepEqual(created.entryProof,proof);assert.equal(created.confirmedServer,null);assert.equal(created.manualConfirmedAt,null);
});

test('presencia por entrada: Steam web es opcional, pero HUD, PID y ventana siguen vinculados',()=>{
 const s=session(),i=inputs();assert.equal(advanceAutoSeeding(s,i,now).command,'start');
 for(const change of [{gamePid:1235},{gameWindow:5679},{gameForeground:false},{scene:'unknown'},{capturedAt:new Date(now-5001).toISOString()}]){
  const r=advanceAutoSeeding(s,{...i,screen:{...i.screen,...change}},now);assert.notEqual(r.command,'start');assert.equal(r.session.status,'waiting_game');
 }
 i.server.players=19;assert.equal(advanceAutoSeeding(s,i,now).session.status,'waiting_match');
 i.server.players=20;i.server.seedingActive=false;assert.equal(advanceAutoSeeding(s,i,now).command,'start');
});

test('presencia por entrada: una desconexión visible invalida la cadena aunque falten fuente y controlador',()=>{
 for(const scene of ['main_menu','join_confirmation','join_wrong_server','afk_kick','server_restart','server_message_unknown']){
  const i=inputs();i.server=null;i.movement={available:false};i.screen.scene=scene;const r=advanceAutoSeeding(session(),i,now);
  assert.equal(r.session.status,'error');assert.equal(r.command,'stop');assert.equal(advanceAutoSeeding(r.session,inputs(),now).session.status,'error');
 }
});

test('presencia por entrada: una cuenta reciente contradictoria pausa y F8 cancela sin rearmar',()=>{
 const s=session(),i=inputs();i.account={seedingFresh:true,seeding:{servidor:1,estado:'sedeando',contando:true,dentro:true}};
 const r=advanceAutoSeeding(s,i,now);assert.equal(r.session.status,'waiting_presence');assert.equal(r.command,'stop');
 i.account={available:false};i.movement.autoOperatorStopped=s.id;const stopped=advanceAutoSeeding(r.session,i,now);assert.equal(stopped.session.status,'cancelled');
 assert.notEqual(advanceAutoSeeding(stopped.session,inputs(),now).command,'start');
});
