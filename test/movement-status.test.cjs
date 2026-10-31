const {test}=require('node:test');
const assert=require('node:assert/strict');
const {movementView}=require('../src/movement-status.cjs');
const now=Date.parse('2026-10-30T08:00:00Z');
const sample=()=>({at:new Date(now).toISOString(),pid:123,armed:true,busy:false,count:2,lastKey:'D',gameForeground:true,startUtc:'2026-10-30T07:59:00Z',endUtc:'2026-10-30T08:24:00Z',hardStopUtc:'2026-10-30T13:30:00Z',reason:'En marcha',error:null});
test('movimiento: un registro fresco muestra la sesion y conserva el limite',()=>{const m=movementView(sample(),now);assert.equal(m.available,true);assert.equal(m.status,'running');assert.equal(m.count,2);assert.equal(m.hardStopUtc,'2026-10-30T13:30:00Z');});
test('movimiento: un fichero atrasado o futuro no se convierte en una sesion detenida',()=>{for(const clock of [now+5001,now-5001]){const m=movementView(sample(),clock);assert.equal(m.available,false);assert.equal(m.armed,null);}});
test('movimiento: un registro armado despues de su fin requiere revision',()=>{const s=sample();s.endUtc='2026-10-30T07:59:59Z';assert.equal(movementView(s,now).available,false);s.endUtc='2026-10-30T08:24:00Z';s.hardStopUtc='2026-10-30T07:59:59Z';assert.equal(movementView(s,now).available,false);});
test('movimiento: el estado no expone campos ajenos y distingue un fallo',()=>{const s=sample();s.token='private-placeholder';s.error='Interrumpido';const m=movementView(s,now);assert.equal(m.status,'error');assert.equal('token' in m,false);assert.equal(movementView(null,now).available,false);});
