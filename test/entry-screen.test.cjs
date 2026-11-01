'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {classifyEntryScreen}=require('../src/entry-screen.cjs');
const target={server:2,joinId:'11111111-2222-4333-8444-555555555555'};
const report=lines=>({format:'wardogs-image-text-v1',width:2560,height:1440,lines:lines.map(([text,x,y,width=300,height=26])=>({text,words:[{text,x,y,width,height}]}))});
const idLines=[['BUSCAR SERVIDOR',1040,563],['INTRODUCE LA IDENTIFICACIÓN DEL SERVIDOR',908,650,558],['CANCELAR',1094,852,146],['BÚSQUEDA',1409,852,136]];

test('entrada: CONTINUAR sólo se propone para el reinicio completo con permiso interno',()=>{
 const raw=require('./fixtures/ocr-restart-modal.json');
 assert.equal(classifyEntryScreen(raw,target).phase,'error');assert.equal(classifyEntryScreen(raw,target).action,undefined);
 const action=classifyEntryScreen(raw,{...target,recovery:true}).action;assert.equal(action.key,'restart_continue');assert.equal(action.kind,'click');assert.ok(action.restartHeaderBounds.y<action.restartMessageBounds.y);assert.ok(action.restartMessageBounds.y<action.bounds.y);
 for(const fixture of ['ocr-afk-modal.json','ocr-join-modal.json'])assert.notEqual(classifyEntryScreen(require('./fixtures/'+fixture),{...target,recovery:true}).action?.key,'restart_continue');
 const partial=structuredClone(raw);partial.lines.find(l=>/reiniciando/.test(l.text)).text='El servidor se está reiniciando. Otro mensaje';assert.equal(classifyEntryScreen(partial,{...target,recovery:true}).action,undefined);
});
test('entrada: menú principal y categorías conducen por anclas reales',()=>{
 const readyMenu={...require('./fixtures/ocr-main-menu.json'),controls:{mainDeploy:{enabled:true}}};
 const menu=classifyEntryScreen(readyMenu,target);assert.equal(menu.action.key,'main_deploy');
 const category=classifyEntryScreen(report([['DESPLEGAR',297,32],['OFICIAL',541,1054],['COMUNIDAD',1052,1054]]),target);assert.equal(category.action.key,'community');
 const browser=classifyEntryScreen(report([['COMUNIDAD',297,49],['UNIRSE CON ID',145,1350,150,18]]),target);assert.equal(browser.action.key,'join_by_id');
});
test('entrada: Desplegar gris, cargando o sin evidencia de color espera sin clicar',()=>{
 const menu=require('./fixtures/ocr-main-menu.json');
 for(const controls of [undefined,{mainDeploy:{enabled:false}},{mainDeploy:{enabled:'true'}}]){
  const result=classifyEntryScreen({...menu,controls},target);assert.equal(result.phase,'main_menu');assert.equal(result.action,undefined);assert.match(result.reason,/termine de cargar/);
 }
 assert.equal(classifyEntryScreen({...menu,controls:{mainDeploy:{enabled:true}}},target).action.key,'main_deploy');
});
test('entrada: el cursor sobre Desplegar requiere cabecera, pie exacto y panel habilitado',()=>{
 const menu=report([['JUGAR',232,32,110],['DESPL>EGAR',175,1040,250],['NAVEGADOR DEL SERVIDOR',155,1084,300,20]]);
 assert.equal(classifyEntryScreen(menu,target).action,undefined);
 const ready={...menu,controls:{mainDeploy:{enabled:true}}};
 const result=classifyEntryScreen(ready,target);assert.equal(result.action.key,'main_deploy');assert.equal(result.action.bounds.y,1084);
 assert.equal(classifyEntryScreen({...ready,lines:ready.lines.slice(1)},target).action,undefined);
 assert.equal(classifyEntryScreen({...ready,lines:ready.lines.filter(line=>!line.text.startsWith('NAVEGADOR'))},target).action,undefined);
});
test('entrada: ID enmascarado requiere escritura propia antes de Lookup',()=>{
 const raw=report(idLines),before=classifyEntryScreen(raw,target);assert.equal(before.action.kind,'replace_join_id');assert.ok(before.action.anchorBounds);assert.ok(before.action.bounds.y>before.action.anchorBounds.y);
 const after=classifyEntryScreen(raw,{...target,typedJoinId:target.joinId});assert.equal(after.action.key,'lookup');
 assert.equal(classifyEntryScreen(raw,{...target,typedJoinId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'}).action.key,'type_join_id');
});
test('entrada: un ID visible distinto prevalece sobre la escritura anterior',()=>{
 const raw=report([...idLines,['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',920,716,570]]);
 assert.equal(classifyEntryScreen(raw,{...target,typedJoinId:target.joinId}).action.key,'type_join_id');
});
test('entrada: el placeholder gris usa la instrucción fija como prueba, sin exigir color al campo',()=>{
 const raw=report([...idLines,['IDENTIFICACION DEL SERVIDOR...',924,720,263,17]]);
 const result=classifyEntryScreen(raw,target);assert.equal(result.action.kind,'replace_join_id');assert.equal(result.action.bounds.y,720);assert.equal(result.action.anchorBounds.y,650);assert.ok(result.action.bounds.y>result.action.anchorBounds.y+result.action.anchorBounds.height);
});
test('entrada: no confirma un servidor distinto del esperado',()=>{
 const join=require('./fixtures/ocr-join-modal.json');assert.equal(classifyEntryScreen(join,target).action.key,'confirm_join');
 assert.equal(classifyEntryScreen(join,{...target,server:1}).phase,'error');
});
test('entrada: la confirmación real INFANTRY permite sólo el servidor leído',()=>{
 const report=require('./fixtures/ocr-join-infantry.json');assert.equal(classifyEntryScreen(report,{...target,server:3}).action.key,'confirm_join');assert.equal(classifyEntryScreen(report,{...target,server:2}).phase,'error');
});

const renamedModal=(title='#02 Título completamente nuevo')=>report([['¿UNIRSE AL SERVIDOR DEL JUEGO?',819,574,700,30],[title,819,650,650],['CANCELAR',1020,850,150],['UNIRSE A LA PARTIDA',1300,850,350]]);
const ownedTarget={...target,ownLookup:{server:target.server,joinId:target.joinId}};
test('entrada: nombre arbitrario sólo se acepta tras la búsqueda propia del mismo número e ID',()=>{
 const raw=renamedModal();const result=classifyEntryScreen(raw,ownedTarget);assert.equal(result.action.key,'confirm_join');assert.equal(result.server,2);
 assert.equal(classifyEntryScreen(raw,target).action,undefined);
 for(const ownLookup of [null,{}, {server:1,joinId:target.joinId},{server:2,joinId:'invalid'},{server:2,joinId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'}])assert.equal(classifyEntryScreen(raw,{...target,ownLookup}).action,undefined);
 assert.equal(classifyEntryScreen(raw,{...ownedTarget,joinId:'invalid'}).action,undefined);
});

test('entrada: búsqueda propia no permite número incorrecto, ausente ni ambiguo',()=>{
 for(const title of ['#01 Otro nombre','#99 Otro nombre','Título sin número']){const result=classifyEntryScreen(renamedModal(title),ownedTarget);assert.equal(result.phase,'error');assert.equal(result.action,undefined);}
 const mixed=renamedModal();mixed.lines.push(...renamedModal('#01 Otro servidor').lines.filter(line=>line.text.startsWith('#')).map(line=>({...line,words:line.words.map(word=>({...word,y:word.y+60}))})));
 const result=classifyEntryScreen(mixed,ownedTarget);assert.equal(result.phase,'error');assert.match(result.reason,/varios servidores/);assert.equal(result.action,undefined);
});

test('entrada: contexto propio conserva las tres anclas del modal y la geometría del número',()=>{
 for(const remove of ['¿UNIRSE AL SERVIDOR DEL JUEGO?','CANCELAR','UNIRSE A LA PARTIDA']){const raw=renamedModal();raw.lines=raw.lines.filter(line=>line.text!==remove);assert.equal(classifyEntryScreen(raw,ownedTarget).action,undefined);}
 const outside=renamedModal();outside.lines.find(line=>line.text.startsWith('#')).words[0].y=100;assert.equal(classifyEntryScreen(outside,ownedTarget).phase,'error');
 const repeated=renamedModal();repeated.lines.push(structuredClone(repeated.lines.find(line=>line.text.startsWith('#'))));assert.equal(classifyEntryScreen(repeated,ownedTarget).action.key,'confirm_join');
 const conflicting=renamedModal();conflicting.lines.push(...report([['EXPULSADO',900,720]]).lines);assert.equal(classifyEntryScreen(conflicting,ownedTarget).phase,'error');
});

test('entrada: pasadas OCR superpuestas no bloquean la confirmación del mismo servidor',()=>{
 const join=structuredClone(require('./fixtures/ocr-join-modal.json'));
 join.lines.push(...structuredClone(join.lines).map(line=>({...line,pass:'second_pass'})));
 assert.equal(classifyEntryScreen(join,target).action.key,'confirm_join');
 assert.equal(classifyEntryScreen(join,{...target,server:1}).phase,'error');
});
test('entrada: selector, HUD y despliegue son fases diferentes',()=>{
 assert.equal(classifyEntryScreen(require('./fixtures/ocr-team-selector.json'),target).phase,'team_selector');
 assert.equal(classifyEntryScreen(require('./fixtures/ocr-team-entry.json'),target).phase,'deploying');
 assert.equal(classifyEntryScreen(require('./fixtures/ocr-gameplay-hud.json'),target).phase,'gameplay_hud');
});
test('entrada: una sola etiqueta o su aparición en un chat no permite clicar',()=>{
 assert.equal(classifyEntryScreen(report([['COMUNIDAD',1052,1054]]),target).phase,'unknown');
 assert.equal(classifyEntryScreen(report([['BUSCAR SERVIDOR',20,1200],['CANCELAR',20,1230],['BÚSQUEDA',20,1260],['INTRODUCE LA IDENTIFICACIÓN DEL SERVIDOR',20,1290]]),target).phase,'unknown');
 assert.equal(classifyEntryScreen(report(idLines.filter(x=>x[0]!=='CANCELAR')),target).phase,'unknown');
});
test('entrada: OCR redundante del mismo texto no duplica el botón, dos botones sí bloquean',()=>{
 const duplicate=report([...idLines,['BÚSQUEDA',1410,853,135]]);assert.equal(classifyEntryScreen(duplicate,{...target,typedJoinId:target.joinId}).action.key,'lookup');
 const ambiguous=report([...idLines,['BÚSQUEDA',1450,1000,135]]);assert.equal(classifyEntryScreen(ambiguous,target).phase,'unknown');
});
test('entrada: pantalla inicial y cola no repiten conexión',()=>{
 const splash=classifyEntryScreen(report([['PULSA UN BOTÓN PARA EMPEZAR',1032,1144,496]]),target);assert.equal(splash.action.key,'splash_continue');assert.equal(splash.action.kind,'press_start');
 const queued=classifyEntryScreen(report([['EN COLA',1100,650],['CANCELAR',1100,850]]),target);assert.equal(queued.phase,'queue');assert.equal(queued.action,undefined);
});

test('entrada: la cola real inferior precede al navegador y conserva posición aunque no se lea el botón de salida',()=>{
 const fixture=require('./fixtures/ocr-browser-queue.json'),queued=classifyEntryScreen(fixture,target);
 assert.equal(queued.phase,'queue');assert.equal(queued.action,undefined);assert.match(queued.reason,/posición 8 de 10/);assert.equal(fixture.source.capturedAt,null);assert.equal(fixture.source.path,undefined);
 const split=structuredClone(fixture),bar=split.lines.find(row=>row.text.startsWith('EN LA COLA'));bar.text='EN LA COLA DEL SERVIDOR...';split.lines.push({text:'POSICIÓN 2 DE 9',words:[{text:'POSICIÓN 2 DE 9',x:1005,y:1006,width:150,height:11}]});const next=classifyEntryScreen(split,target);assert.equal(next.phase,'queue');assert.match(next.reason,/posición 2 de 9/);assert.equal(next.action,undefined);
});

test('entrada: una barra de cola incompleta no crea clics y texto fuera del pie no oculta el navegador',()=>{
 const fixture=require('./fixtures/ocr-browser-queue.json'),incomplete=structuredClone(fixture);incomplete.lines.find(row=>row.text.startsWith('EN LA COLA')).text='EN LA COLA DEL SERVIDOR...';
 const waiting=classifyEntryScreen(incomplete,target);assert.equal(waiting.phase,'unknown');assert.equal(waiting.action,undefined);
 const withExit=structuredClone(incomplete);withExit.lines.push({text:'SALIR DE LA COLA',words:[{text:'SALIR DE LA COLA',x:1190,y:1008,width:90,height:10}]});assert.equal(classifyEntryScreen(withExit,target).phase,'queue');
 const chat=structuredClone(fixture);for(const word of chat.lines.find(row=>row.text.startsWith('EN LA COLA')).words)word.y=750;assert.equal(classifyEntryScreen(chat,target).phase,'community_browser');
 const noContext=structuredClone(fixture);noContext.lines=noContext.lines.filter(row=>row.text!=='COMUNIDAD');assert.notEqual(classifyEntryScreen(noContext,target).phase,'queue');
});
