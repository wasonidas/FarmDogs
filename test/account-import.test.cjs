const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeAccountImport,browserBaselineFile,VIP_SOURCE,SEED_SOURCE}=require('../src/account-import.cjs');
const at='2026-10-30T08:00:00Z',now=Date.parse(at);
function sample(){return {format:'wardogs-account-snapshot-v1',observedAt:at,vip:{observedAt:at,source:VIP_SOURCE,data:{prioridad:{comprobado:true,tiene:true},historial:[]}},seeding:{observedAt:at,source:SEED_SOURCE,data:{ahora:at,estado:'nada'}}};}
test('importacion: conserva las fechas reales y separa la recepcion de la consulta',()=>{
 const input=sample(),saved=normalizeAccountImport(input,now+500);
 assert.equal(saved.status,'browser_snapshot');assert.equal(saved.vip.observedAt,at);assert.equal(saved.ingestedAt,'2026-10-30T08:00:00.500Z');
 input.vip.data.prioridad.tiene=false;assert.equal(saved.vip.data.prioridad.tiene,true);
});
test('importacion: una nueva fecha exterior no refresca una consulta privada antigua',()=>{
 const input=sample();input.vip.observedAt='2026-10-30T07:57:00Z';assert.throws(()=>normalizeAccountImport(input,now),/reciente/);
});
test('importacion: rechaza consultas futuras y un reloj de seeding antiguo',()=>{
 const input=sample();assert.throws(()=>normalizeAccountImport(input,now-6000),/reciente/);
 input.seeding.data.ahora='2026-10-30T07:58:00Z';assert.throws(()=>normalizeAccountImport(input,now),/atrasada/);
});
test('importacion: rechaza otra fuente, ausencia de sesion e historial no renderizable',()=>{
 let input=sample();input.vip.source='https://otro.example/api/cuenta/vip';assert.throws(()=>normalizeAccountImport(input,now),/fuentes/);
 input=sample();input.vip.data={error:'No autorizado'};assert.throws(()=>normalizeAccountImport(input,now),/incompleta/);
 input=sample();input.vip.data.historial=[null];assert.throws(()=>normalizeAccountImport(input,now),/Historial/);
});
test('importacion: la referencia diaria usa Madrid y genera un nombre fijo de fichero',()=>{
 assert.equal(browserBaselineFile('2026-10-29T23:30:00Z'),'browser-account-baseline-2026-10-30.json');
 assert.throws(()=>browserBaselineFile('../../cuenta'));
});

test('importación: identifica el lector de escritorio sin aceptar identificadores arbitrarios',()=>{
 const input=sample();input.readerId='9b4950a8-25fd-4dfa-b9cd-b50fb6300089';const saved=normalizeAccountImport(input,now);
 assert.equal(saved.transport,'desktop_webview');assert.equal(saved.readerId,input.readerId);
 input.readerId='../otro';assert.throws(()=>normalizeAccountImport(input,now),/lector/);
});
