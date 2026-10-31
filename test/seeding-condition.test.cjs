const {test}=require('node:test');
const assert=require('node:assert/strict');
const {seedingCondition}=require('../src/seeding-condition.cjs');
const now=Date.parse('2026-10-30T08:00:00Z');

test('condición: publicar 30 minutos y 50 jugadores no selecciona una modalidad',()=>{
 const data={estado:'aguantando',servidor:2,esperaMin:30,cobroN:50,cobraAt:null};
 assert.equal(seedingCondition(data,now).mode,null);
 assert.equal(seedingCondition({...data,estado:'sedeando'},now).mode,null);
});
test('condición: la señal privada explícita identifica población y no acredita VIP al llegar',()=>{
 const data={estado:'aguantando',servidor:1,porJugadores:true,cobroN:50,cobraAt:null,dentro:true,jugadores:19};
 assert.equal(seedingCondition(data,now).mode,'population');
 const reached=seedingCondition({...data,jugadores:50},now);assert.equal(reached.status,'condition_candidate');assert.equal(reached.rewardVerified,false);
 assert.equal(seedingCondition({...data,jugadores:50,dentro:false},now).status,'away');
 assert.equal(seedingCondition({...data,jugadores:50,dentro:undefined},now).status,'presence_unknown');
 assert.equal(seedingCondition({...data,cobroN:undefined},now).status,'unknown');
});
test('condición: la modalidad temporal respeta el cobro real, aunque también se publique 50',()=>{
 const data={estado:'aguantando',servidor:2,porJugadores:false,cobroN:50,cobraAt:'2026-10-30T08:30:00Z',dentro:true};
 const before=seedingCondition(data,now);assert.equal(before.mode,'timed');assert.equal(before.remainingMs,1800000);
 const after=seedingCondition(data,now+1800000);assert.equal(after.status,'condition_candidate');assert.equal(after.rewardVerified,false);
 assert.equal(seedingCondition({...data,cobraAt:null},now).status,'unknown');
 assert.equal(seedingCondition({...data,cobraAt:'2026-10-30T08:30:00'},now).status,'unknown');
});
test('condición: distingue días pendientes, ausencia y estados incompletos',()=>{
 const pending=seedingCondition({estado:'aguantando',servidor:2,final:true,porJugadores:true,cobroN:50,cobraAt:'2026-10-30T08:30:00Z'},now);
 assert.equal(pending.mode,'pending_days');assert.equal(pending.rewardVerified,false);
 assert.equal(seedingCondition({estado:'nada'},now).status,'outside');
 assert.equal(seedingCondition({estado:'aguantando',servidor:8,porJugadores:true,cobroN:50},now).status,'unknown');
});
