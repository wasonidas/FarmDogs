const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeServers}=require('../src/domain.cjs');
const {classifySpainServers}=require('./support/spain-candidates.cjs');
const now=Date.parse('2026-10-29T10:00:00Z');
const fixture=players=>({configured:true,fetchedAt:now,servers:[1,2,3,4,5].map(n=>({num:n,id:[3,1,2,8,7][n-1],name:`#0${n} [ESP] Wardogsspain.com`,players:n===2?players:0,maxPlayers:100,online:true,configured:true,joinId:`0000000${n}-0000-0000-0000-000000000000`}))});
const classify=payload=>classifySpainServers(normalizeServers(payload,now));

test('19 mantiene la espera; 20 y 21 ofrecen un candidato de prueba sin confirmar fase ni elegibilidad VIP',()=>{
 assert.equal(classify(fixture(19)).status,'awaiting_population');
 for(const population of [20,21]){const result=classify(fixture(population));assert.equal(result.status,'candidate_needs_game_confirmation');assert.equal(result.candidates[0].number,2);assert.equal(result.candidates[0].apiId,1);assert.equal(result.matchPhaseVerified,false);}
});
test('una lectura desactualizada o un servidor ausente produce fuente sin confirmar, sin afirmar poca población',()=>{
 const stale=fixture(30);stale.servers[1].stale=true;
 const result=classify(stale);assert.equal(result.status,'source_unconfirmed');assert.deepEqual(result.unconfirmedServers,[2]);assert.deepEqual(result.candidates,[]);
 const missing=fixture(0);missing.servers.splice(1,1);assert.equal(classify(missing).status,'source_unconfirmed');
});
test('un servidor lleno no inicia una búsqueda de plaza y se prefiere un candidato disponible',()=>{
 const payload=fixture(100);assert.equal(classify(payload).status,'full_servers_only');
 payload.servers[2].players=70;payload.servers[0].players=40;
 const result=classify(payload);assert.deepEqual(result.candidates.map(s=>s.number),[3,1]);assert.equal(result.fullServers[0].number,2);
});
test('un nombre de otra comunidad o un ID de entrada malformado requiere revisión de la fuente',()=>{
 for(const change of [{name:'#02 another-wardogsspain.com.invalid'},{joinId:'not-a-server-id'}]){
  const payload=fixture(30);Object.assign(payload.servers[1],change);const result=classify(payload);
  assert.equal(result.status,'source_unconfirmed');assert.deepEqual(result.candidates,[]);
 }
});
