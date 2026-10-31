'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {IDENTITY_SOURCE,normalizeClanAssociation,currentClanAssociation}=require('../src/clan-association.cjs');
const now=Date.parse('2026-10-31T18:00:00Z'),at=new Date(now).toISOString();
const sample=equipo=>({source:IDENTITY_SOURCE,observedAt:at,data:{conectado:true,cuenta:{steamId:'76561198000000001',equipo,extraPrivateField:'not-forwarded'}}});
test('clan: asociación autenticada conserva solo identidad y clan, sin datos ajenos',()=>{
 const result=normalizeClanAssociation(sample({slug:'arc-troopers',tag:'ARC',nombre:'ARC Troopers',gestor:true,secret:'not-forwarded'}),now);
 assert.deepEqual(result,{status:'member',accountId:'76561198000000001',observedAt:at,slug:'arc-troopers',tag:'ARC',name:'ARC Troopers'});
 assert.equal(JSON.stringify(result).includes('not-forwarded'),false);
});
test('clan: ausencia exige equipo:null; un campo ausente, slug ajeno o cuenta inválida queda desconocido',()=>{
 assert.equal(normalizeClanAssociation(sample(null),now).status,'no_clan');
 for(const team of [undefined,{},'ARC',{slug:'../otra-cuenta'},{slug:'https://otro.example'}])assert.equal(normalizeClanAssociation(sample(team),now).status,'unknown');
 const bad=sample({slug:'arc-troopers'});bad.data.cuenta.steamId='nada';assert.equal(normalizeClanAssociation(bad,now).status,'unknown');
 assert.equal(normalizeClanAssociation(undefined,now).status,'unknown');
});
test('clan: rechaza origen o tiempo falsos y desconecta una identidad cerrada',()=>{
 assert.throws(()=>normalizeClanAssociation({...sample(null),source:'https://otro.example/yo'},now),/fuente/);
 assert.throws(()=>normalizeClanAssociation(sample(null),now+100000),/reciente/);
 assert.throws(()=>normalizeClanAssociation(sample(null),now-5001),/reciente/);
 const member=normalizeClanAssociation(sample({slug:'arc-troopers'}),now);
 assert.equal(currentClanAssociation(member,{running:true,now:now+99999}).status,'member');
 assert.equal(currentClanAssociation(member,{running:true,now:now+100000}).status,'unknown');
 assert.equal(currentClanAssociation(member,{running:false,now}).status,'disconnected');
});
