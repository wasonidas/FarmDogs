const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sessionDiagnostics}=require('../src/session-diagnostics.cjs');

const state=(seeding,extra={})=>({config:{selectedServer:2},account:{seedingFresh:true,seeding},movement:{available:true,status:'stopped',armed:false,reason:'Detenido por el usuario'},...extra});
const stoppedFocus={available:true,status:'stopped',armed:false,gameForeground:false,reason:'Pérdida de foco: vuelve a armar para continuar'};

test('diagnóstico: datos antiguos o ausentes no prueban ausencia ni controlador detenido',()=>{
 for(const input of [undefined,null,{},state({estado:'aguantando',servidor:2,dentro:false},{account:{available:true,vipFresh:true,seedingFresh:false,seeding:{estado:'aguantando',servidor:2,dentro:false}},movement:{available:false,status:'stopped',armed:false,reason:'Perdida de foco'}})]){
  const d=sessionDiagnostics(input);assert.equal(d.status,'account_unknown');assert.equal(d.observedServer,null);assert.equal(d.action.kind,'refresh_account');assert.match(d.detail,/sin confirmar/);assert.doesNotMatch(d.detail,/detecta fuera|movimiento está detenido|se detuvo por pérdida/);
 }
});

test('diagnóstico: perder el foco no se convierte en expulsión ni ausencia',()=>{
 const d=sessionDiagnostics(state({estado:'aguantando',servidor:2,dentro:true},{movement:stoppedFocus}));
 assert.equal(d.status,'movement_focus_stop');assert.match(d.detail,/dentro del #2/);assert.match(d.detail,/pérdida de foco/);assert.doesNotMatch(d.detail,/AFK|expuls|reinici|desconexión/);
 const other=sessionDiagnostics(state({estado:'nada'},{movement:{...stoppedFocus,reason:'Limite de tiempo'}}));assert.equal(other.status,'no_seeding_cycle');assert.doesNotMatch(other.detail,/pérdida de foco/);
});

test('diagnóstico: ausencia explícita conserva el servidor y propone solo preparar la entrada',()=>{
 const d=sessionDiagnostics(state({estado:'aguantando',servidor:2,dentro:false},{movement:stoppedFocus}));
 assert.equal(d.status,'account_away');assert.deepEqual(d.action,{kind:'prepare_entry',server:2});assert.match(d.detail,/motivo no está identificado/);assert.match(d.detail,/pérdida de foco/);
 assert.doesNotMatch(d.detail,/AFK|expuls|reinici/);
});

test('diagnóstico: un error del controlador no oculta la ausencia privada observada',()=>{
 const d=sessionDiagnostics(state({estado:'aguantando',servidor:2,dentro:false},{movement:{available:true,status:'error',armed:false,error:'No se ha podido enviar la tecla'}}));
 assert.equal(d.status,'movement_error');assert.equal(d.severity,'error');assert.match(d.detail,/detecta fuera del #2/);assert.match(d.detail,/No se ha podido enviar la tecla/);assert.equal(d.action.kind,'review_movement');
});

test('diagnóstico: la selección no sustituye al servidor que observa la cuenta',()=>{
 const d=sessionDiagnostics(state({estado:'sedeando',servidor:1,contando:true}));assert.equal(d.status,'server_mismatch');assert.equal(d.observedServer,1);assert.match(d.title,/#1.*#2/);assert.match(d.detail,/contando en el #1/);assert.doesNotMatch(d.detail,/dentro del #2|contando en el #2/);
});

test('diagnóstico: distingue contador de sedeo, presencia durante espera y despliegue desconocido',()=>{
 const running={available:true,status:'running',armed:true};
 const s=sessionDiagnostics(state({estado:'sedeando',servidor:2,contando:true},{movement:running}));assert.equal(s.status,'seeding_observed');assert.match(s.detail,/registra sedeo contando/);assert.match(s.detail,/no confirma despliegue/);
 const waiting=sessionDiagnostics(state({estado:'aguantando',servidor:2,dentro:true}));assert.equal(waiting.status,'presence_observed');assert.match(waiting.detail,/durante la espera/);
});

test('diagnóstico: un ciclo inexistente, un estado nuevo o señales incompletas no prueban conexión',()=>{
 const cases=[
  [{estado:'nada'},'no_seeding_cycle'],
  [{estado:'desconocido_nuevo',servidor:2,dentro:true},'presence_unknown'],
  [{estado:'aguantando',servidor:2},'presence_unknown'],
  [{estado:'sedeando',servidor:2,contando:false},'presence_unknown'],
  [{estado:'sedeando',servidor:6,contando:true},'presence_unknown'],
  [{estado:'sedeando',servidor:2,contando:true,dentro:false},'presence_inconsistent']
 ];
 for(const [reading,status] of cases){const d=sessionDiagnostics(state(reading));assert.equal(d.status,status);assert.doesNotMatch(d.title,/detectada dentro|registrado en|te detecta fuera/);}
});

test('diagnóstico: no muta su entrada ni atribuye un VIP a datos de historial o población',()=>{
 const input=state({estado:'aguantando',servidor:2,dentro:true,jugadores:100});input.account.vip={tiene:true};input.account.difference={status:'new_seeding_record'};input.account.condition={status:'condition_candidate'};
 const before=structuredClone(input),d=sessionDiagnostics(input);assert.deepEqual(input,before);assert.equal(d.status,'presence_observed');assert.match(d.detail,/no confirma un premio/);assert.equal('rewardVerified' in d,false);
});

const captureNow=Date.parse('2026-10-31T10:00:00Z');
const screen=(scene,extra={})=>({status:'verified_capture',scene,gameForeground:true,gamePid:1234,gameWindow:5678,frameId:'55555555-5555-4555-8555-555555555555',capturedAt:new Date(captureNow-1000).toISOString(),...extra});

test('diagnóstico: un mensaje actual del juego conserva procedencia sin atribuirlo al servidor seleccionado',()=>{
 for(const [scene,status] of [['afk_kick','game_afk_kick'],['server_restart','game_server_restart'],['server_message_unknown','game_server_message']]){
  const input={config:{selectedServer:2},screen:screen(scene,{server:2,reason:'VIP acreditado por texto no autorizado'})},before=structuredClone(input);
  const d=sessionDiagnostics(input,{now:captureNow});assert.equal(d.status,status);assert.equal(d.severity,'warning');assert.deepEqual(d.action,{kind:'review_game'});assert.equal(d.observedServer,null);
  assert.deepEqual(d.screenEvidence,{scene,capturedAt:new Date(captureNow-1000).toISOString(),frameId:'55555555-5555-4555-8555-555555555555',gamePid:1234,gameWindow:5678,ageSeconds:1,server:null});
  assert.match(d.detail,/captura no identifica el servidor/);assert.doesNotMatch(d.title,/#2/);assert.doesNotMatch(d.detail,/VIP acreditado/);assert.deepEqual(input,before);
 }
});

test('diagnóstico: el servidor observado por la cuenta sigue separado del origen desconocido del mensaje',()=>{
 const input=state({estado:'aguantando',servidor:1,dentro:false});input.screen=screen('afk_kick');
 const d=sessionDiagnostics(input,{now:captureNow});assert.equal(d.status,'game_afk_kick');assert.equal(d.observedServer,1);assert.equal(d.screenEvidence.server,null);assert.match(d.detail,/detecta fuera del #1/);assert.match(d.detail,/captura no identifica el servidor/);assert.doesNotMatch(d.title,/#1|#2/);assert.deepEqual(d.action,{kind:'review_game'});
 const faulty={...input,movement:{available:true,status:'error',armed:false,error:'Tecla rechazada'}};
 const e=sessionDiagnostics(faulty,{now:captureNow});assert.equal(e.status,'movement_error');assert.equal(e.screenEvidence.scene,'afk_kick');assert.match(e.detail,/expulsión por inactividad/);assert.match(e.detail,/Tecla rechazada/);
});

test('diagnóstico: una lectura vieja, futura, ambigua o sin identidad válida no cambia el diagnóstico',()=>{
 const input=state({estado:'aguantando',servidor:2,dentro:false}),baseline=sessionDiagnostics(input,{now:captureNow});
 for(const extra of [{capturedAt:new Date(captureNow-5001).toISOString()},{capturedAt:new Date(captureNow+1).toISOString()},{status:'unknown'},{gameForeground:false},{gamePid:0},{gameWindow:0},{gameWindow:Number.MAX_SAFE_INTEGER+1},{frameId:'not-a-frame'},{scene:'unknown'},{scene:'__proto__'},{scene:'joining_faction'}]){
  const d=sessionDiagnostics({...input,screen:screen('afk_kick',extra)},{now:captureNow});assert.deepEqual(d,baseline);
 }
 const boundary=sessionDiagnostics({...input,screen:screen('afk_kick',{capturedAt:new Date(captureNow-5000).toISOString()})},{now:captureNow});assert.equal(boundary.status,'game_afk_kick');assert.equal(boundary.screenEvidence.ageSeconds,5);
});
