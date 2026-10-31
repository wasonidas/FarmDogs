const {test}=require('node:test');
const assert=require('node:assert/strict');
const {classifyGameScreen}=require('../src/game-screen.cjs');
const lookup=require('./fixtures/ocr-join-modal.json');
const kick=require('./fixtures/ocr-afk-modal.json');
const restart=require('./fixtures/ocr-restart-modal.json');
const main=require('./fixtures/ocr-main-menu.json');
const hud=require('./fixtures/ocr-gameplay-hud.json');
const controlHud=require('./fixtures/ocr-hud-faction-control.json');
const {normalizeScreen}=require('../src/screen-reader.cjs');
const path=require('node:path');
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

test('pantalla: el HUD soleado conserva tres anclas con CONTROL completo en su región, sin permiso desde una imagen',()=>{
 const result=classifyGameScreen(controlHud);assert.equal(result.phase,'gameplay_hud');assert.match(result.reason,/control de facción/);assert.equal(result.inputAllowed,false);assert.equal(result.activeMatchVerified,false);assert.equal(controlHud.source.capturedAt,null);assert.equal(controlHud.source.path,undefined);
 for(const faction of ['LONESTAR','VALKYRA','MANTICORE']){const report=structuredClone(controlHud);report.lines.find(row=>row.pass==='hud_control').text='CONTROL: '+faction;assert.equal(classifyGameScreen(report).phase,'gameplay_hud');}
});

test('pantalla: CONTROL parcial, otra facción, otra región o dos anclas nunca sustituyen la tercera prueba',()=>{
 for(const label of ['NTROL: MANTICORE','C NTROL: MANTICORE','CONTROL: MANT ICORE','CONTROL: OTHER']){const report=structuredClone(controlHud);report.lines.find(row=>row.pass==='hud_control').text=label;assert.equal(classifyGameScreen(report).phase,'unknown',label);}
 for(const missing of ['hud_control','hud_hands','hud_health']){const report=structuredClone(controlHud);report.lines=report.lines.filter(row=>row.pass!==missing);assert.equal(classifyGameScreen(report).phase,'unknown',missing);}
 const misplaced=structuredClone(controlHud);for(const word of misplaced.lines.find(row=>row.pass==='hud_control').words){word.x=900;word.y=500;}assert.equal(classifyGameScreen(misplaced).phase,'unknown');
 const ambiguous=structuredClone(controlHud);ambiguous.lines.push(structuredClone(ambiguous.lines.find(row=>row.pass==='hud_control')));assert.equal(classifyGameScreen(ambiguous).phase,'unknown');
});

test('pantalla: selector, chat, compra o carga siguen bloqueando el HUD con CONTROL',()=>{
 for(const text of ['// SELECCIONAR FACCIÓN','SELECT FACTION','ESCRIBE UN MENSAJE','COMPRAR','CARGANDO','LOADING...','DESPLEGANDO','ENTRANDO']){const report=structuredClone(controlHud);report.lines.push({text,words:[{text,x:800,y:500,width:350,height:25}]});assert.equal(classifyGameScreen(report).phase,'unknown',text);}
});

test('pantalla: el fallback CONTROL no convierte un archivo o una captura caducada en presencia reciente',()=>{
 const now=Date.parse('2026-10-31T20:00:00Z'),directory=path.resolve('inert-hud-frame'),id='11111111-1111-4111-8111-111111111111',source={...controlHud.source,kind:'foreground_game',captureMethod:'foreground_client_screen_copy',frameId:id,gamePid:123,window:456,path:path.join(directory,'game-frame-'+id+'.png'),capturedAt:new Date(now-100).toISOString(),captureFinishedAt:new Date(now-80).toISOString()};
 assert.equal(normalizeScreen(controlHud,now,directory).status,'unknown');
 assert.equal(normalizeScreen({...controlHud,source},now,directory).scene,'gameplay_hud');
 const old={...source,capturedAt:new Date(now-6000).toISOString(),captureFinishedAt:new Date(now-5980).toISOString()};assert.equal(normalizeScreen({...controlHud,source:old},now,directory).status,'unknown');assert.equal(normalizeScreen({...controlHud,source:{...source,kind:'file'}},now,directory).status,'unknown');
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
test('pantalla: el modo añadido al nombre conserva número y dominio exactos del servidor observado',()=>{
 const infantry=require('./fixtures/ocr-join-infantry.json');assert.equal(classifyGameScreen(infantry,{expectedServer:3}).phase,'join_confirmation');assert.equal(classifyGameScreen(infantry,{expectedServer:2}).phase,'join_wrong_server');
 for(const suffix of ['.ejemplo | INFANTRY','malicioso | INFANTRY']){const wrong=structuredClone(infantry);for(const line of wrong.lines)line.text=line.text.replace(/Wardogsspain\.com/i,'Wardogsspain.com'+suffix);assert.equal(classifyGameScreen(wrong,{expectedServer:3}).phase,'unknown');}
 const duplicate=structuredClone(infantry),identity=duplicate.lines.find(line=>/^#03/.test(line.text));duplicate.lines.push({...structuredClone(identity),text:identity.text.replace(' I INFAI',' | INFANTRY')});assert.equal(classifyGameScreen(duplicate,{expectedServer:3}).phase,'join_confirmation');
 const conflicting=structuredClone(infantry);conflicting.lines.push({...structuredClone(identity),text:identity.text.replace('#03','#04')});assert.equal(classifyGameScreen(conflicting,{expectedServer:3}).phase,'unknown');
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
