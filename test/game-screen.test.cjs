const {test}=require('node:test');
const assert=require('node:assert/strict');
const {classifyGameScreen}=require('../src/game-screen.cjs');
const lookup=require('./fixtures/ocr-join-modal.json');
const kick=require('./fixtures/ocr-afk-modal.json');
const restart=require('./fixtures/ocr-restart-modal.json');
const main=require('./fixtures/ocr-main-menu.json');
const hud=require('./fixtures/ocr-gameplay-hud.json');
test('pantalla: distingue los tres diálogos observados sin autorizar entradas desde una imagen',()=>{
 for(const [report,phase] of [[lookup,'join_confirmation'],[kick,'afk_kick'],[restart,'server_restart'],[main,'main_menu']]){
  const d=classifyGameScreen(report);assert.equal(d.phase,phase);assert.equal(d.inputAllowed,false);assert.equal(d.activeMatchVerified,false);assert.ok(d.buttonCandidate.bounds.width>0);
 }
});
test('pantalla: reconoce tres anclas del HUD y rechaza una superposición de menú o chat',()=>{
 assert.equal(classifyGameScreen(hud).phase,'gameplay_hud');assert.equal(classifyGameScreen(hud).inputAllowed,false);
 const missing=structuredClone(hud);missing.lines.pop();assert.equal(classifyGameScreen(missing).phase,'unknown');
 for(const text of ['CONTINUAR','ESCRIBE UN MENSAJE']){const overlay=structuredClone(hud);overlay.lines.push({text,words:[{text,x:800,y:600,width:200,height:20}]});assert.equal(classifyGameScreen(overlay).phase,'unknown');}
});

test('pantalla: salud usa palabra literal aunque los iconos compartan fila; pasadas solapadas no duplican el ancla',()=>{
 const report=structuredClone(hud),line=report.lines.find(line=>line.text==='100');
 assert.ok(line);line.text='100 i v';line.words.push({text:'i',x:report.width-8,y:report.height-40,width:4,height:10});
 assert.equal(classifyGameScreen(report).phase,'gameplay_hud');
 const duplicate=structuredClone(line);duplicate.text='100';duplicate.words=duplicate.words.filter(w=>w.text==='100');duplicate.words[0].x+=1;report.lines.push(duplicate);
 assert.equal(classifyGameScreen(report).phase,'gameplay_hud');
 const conflicting=structuredClone(duplicate);conflicting.text='99';conflicting.words[0].text='99';report.lines.push(conflicting);
 assert.equal(classifyGameScreen(report).phase,'unknown');
});

test('pantalla: el selector real de facción sobre un HUD impide clasificar despliegue',()=>{
 for(const text of ['// SELECCIONAR FACCIÓN','SELECCIONAR FACCION','// SELECT FACTION','SELECT FACTION']){
  const overlay=structuredClone(hud);overlay.lines.push({text,words:[{text,x:800,y:450,width:350,height:26}]});
  const result=classifyGameScreen(overlay);assert.equal(result.phase,'unknown');assert.equal(result.inputAllowed,false);
 }
});
test('pantalla: identifica otro servidor y no confunde nombre de dominio parecido',()=>{
 assert.equal(classifyGameScreen(lookup,{expectedServer:1}).phase,'join_wrong_server');
 assert.equal(classifyGameScreen(lookup,{expectedServer:2}).server,2);
 const wrong=structuredClone(lookup);for(const line of wrong.lines)line.text=line.text.replace(/Wardogsspain\.com/i,'Wardogsspain.com.ejemplo');assert.equal(classifyGameScreen(wrong).phase,'unknown');
});
test('pantalla: chat, geometría inválida y botones duplicados no forman una confirmación',()=>{
 const chat=structuredClone(lookup);for(const line of chat.lines)for(const word of line.words)word.y=10;assert.equal(classifyGameScreen(chat).phase,'unknown');
 const invalid=structuredClone(lookup);for(const line of invalid.lines)for(const word of line.words)word.x=NaN;assert.equal(classifyGameScreen(invalid).phase,'unknown');
 const duplicate=structuredClone(lookup);duplicate.lines.push(structuredClone(duplicate.lines.find(line=>line.text==='UNIRSE A LA PARTIDA')));assert.equal(classifyGameScreen(duplicate).phase,'unknown');
});
test('pantalla: texto genérico o un estado manipulado no prueban partida activa ni renuevan captura',()=>{
 const old=structuredClone(kick);old.analyzedAt=new Date().toISOString();old.captureFreshnessVerified=true;assert.equal(classifyGameScreen(old).inputAllowed,false);
 const generic=structuredClone(restart);generic.lines=generic.lines.filter(line=>!/reiniciando/.test(line.text));assert.equal(classifyGameScreen(generic).phase,'server_message_unknown');
 for(const report of [null,{}, {...lookup,lines:[]}, {...lookup,format:'other'}]){const d=classifyGameScreen(report);assert.equal(d.phase,'unknown');assert.equal(d.activeMatchVerified,false);}
});
