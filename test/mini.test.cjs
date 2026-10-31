'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const publicDir=path.resolve(__dirname,'../public');
const html=fs.readFileSync(path.join(publicDir,'mini.html'),'utf8');
const script=fs.readFileSync(path.join(publicDir,'mini.js'),'utf8');
const joinId='0665a9c0-80b7-4f32-ad47-f36b70367f10';
class Element{
 constructor(){this.listeners=new Map();this.attributes={};this.dataset={};this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.textContent='';this.children=new Map();}
 addEventListener(name,handler){const list=this.listeners.get(name)||[];list.push(handler);this.listeners.set(name,list);}
 get disabled(){return this._disabled;}
 set disabled(value){this._disabled=!!value;}
 setAttribute(name,value){this.attributes[name]=value;}
 querySelector(selector){assert.ok(['.map','.players','.status','.clan-presence','.clan-label'].includes(selector));if(!this.children.has(selector))this.children.set(selector,new Element());return this.children.get(selector);}
 reportValidity(){return true;}
 set innerHTML(value){throw Error('La interfaz debe mostrar el contenido de la fuente como texto, sin interpretar HTML.');}
 focus(){}
}
function sample(){return {token:'test-token',now:'2026-10-31T10:00:00Z',capabilities:{standaloneMovement:true},config:{selectedServer:1},source:{lastSuccessAt:'2026-10-31T10:00:00Z',error:null},servers:Array.from({length:5},(_,i)=>({number:i+1,trusted:true,joinId,players:25,capacity:100,map:'Prueba',seedingActive:true,status:'above_entry_threshold'})),seedingContinuity:{},account:{vipFresh:false,seedingFresh:false},movement:{available:false},localTools:{game:true,movement:true,automaticMovement:true},autoSeeding:null,activity:null,opening:null,watch:null,rewards:null,teamClicker:{available:true,automaticSelectionAvailable:true,automaticAnyTeamAvailable:true,enabled:false,startMode:'automatic',team:'blue',intervalMs:20,targets:{}},diagnostics:{}};}
async function app({initial=sample(),clipboardFails=false,onPost,host=false}={}){
 const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>[match[1],new Element()]));
 for(const [id,node]of elements){const tag=[...html.matchAll(/<[^>]+>/g)].find(match=>match[0].includes(`id="${id}"`))?.[0]||'';node.value=tag.match(/\bvalue="([^"]*)"/)?.[1]||'';node.checked=/\schecked(?:\s|>)/.test(tag);}
 const radios=['blue','red','green'].map(team=>Object.assign(new Element(),{value:team,checked:team==='blue'}));
 for(const radio of radios){radio._checked=radio.checked;Object.defineProperty(radio,'checked',{get(){return this._checked;},set(value){if(value)for(const peer of radios)peer._checked=false;this._checked=!!value;}});}
 const node=id=>{assert.ok(elements.has(id),`ID real del HTML: ${id}`);return elements.get(id);};
 const document={getElementById:node,querySelectorAll(selector){if(selector==='input[name="clicker-team"]')return radios;if(selector==='input[name="clicker-team"],#clicker-interval')return [...radios,node('clicker-interval')];assert.ok(['[data-go-tab]','[data-seed-mode]'].includes(selector));return [];},querySelector(selector){if(selector==='input[name="clicker-team"]:checked')return radios.find(r=>r.checked);const team=selector.match(/\[value="(blue|red|green)"\]/)?.[1];assert.ok(team);return radios.find(r=>r.value===team);}};
 let current=initial,copies=0;const requests=[],hostMessages=[],hostListeners=[],hostWindowListeners=new Map();
 const mockWindow=host?{addEventListener:(name,handler)=>hostWindowListeners.set(name,handler),crypto:{randomUUID:()=> '44444444-4444-4444-8444-444444444444'},chrome:{webview:{postMessage:msg=>hostMessages.push(msg),addEventListener:(kind,handler)=>hostListeners.push(handler)}}}:{};
 const context=vm.createContext({document,window:mockWindow,navigator:{clipboard:{writeText:async()=>{copies++;if(clipboardFails)throw Error('Portapapeles remoto ocupado');}}},console,Intl,Date,Number,Object,Set,fetch:async(route,options={})=>{const request={route,method:options.method||'GET',body:options.body?JSON.parse(options.body):null,headers:options.headers};requests.push(request);if(request.method==='POST'&&onPost)current=await onPost(route,request.body,current)||current;return {ok:true,json:async()=>current};},setInterval:()=>0});
 vm.runInContext(script,context,{filename:'public/mini.js'});await new Promise(setImmediate);
 if(host)for(const handler of hostListeners)handler({data:{kind:'host_entry_focus_support',supported:true}});
 return {node,requests,hostMessages,hostEvent:message=>{for(const handler of hostListeners)handler({data:message});},hostKey:key=>hostWindowListeners.get("keydown")?.({key}),get copies(){return copies;},get current(){return current;},selectedTeam:()=>radios.find(radio=>radio.checked)?.value,async selectTeam(team){const radio=radios.find(r=>r.value===team);assert.ok(radio);assert.equal(radio.disabled,false);radio.checked=true;for(const handler of radio.listeners.get('change')||[])await handler();},async change(id,value){assert.equal(node(id).disabled,false);node(id).checked=value;for(const handler of node(id).listeners.get('change')||[])await handler();},async click(id,event){assert.equal(node(id).disabled,false,`${id} habilitado`);for(const handler of node(id).listeners.get('click')||[])await handler(event);},update(value){current=value;context.nextState=value;vm.runInContext('render(nextState)',context);},async disconnect(){current=null;await vm.runInContext('poll()',context);},posts:()=>requests.filter(request=>request.method==='POST')};
}

test('clan: solo una presencia lista en servidor confirmado se vuelve verde y muestra el recuento real',async()=>{
 const initial=sample();initial.servers=initial.servers.map(s=>({...s,online:true}));initial.clanPresence={status:'ready',clan:{slug:'arc-troopers',tag:'ARC',name:'Arc Troopers'},selfExcluded:false,servers:{'1':{status:'present',reportedCount:7,teams:{blue:7,red:0,green:0,unassigned:0},members:[{name:'DO_NOT_RENDER_ROSTER_NAME'}]},'2':{status:'empty',reportedCount:0,teams:{blue:0,red:0,green:0}},'3':{status:'unknown',reportedCount:null},'4':{status:'present',reportedCount:2},'5':{status:'present',reportedCount:1}}};initial.servers[3].online=false;initial.servers[4].trusted=false;
 const a=await app({initial}),indicator=n=>a.node('server-'+n).querySelector('.clan-presence'),label=n=>a.node('server-'+n).querySelector('.clan-label').textContent;
 assert.equal(indicator(1).dataset.state,'present');assert.equal(label(1),'Miembros del clan · 7');assert.match(indicator(1).title,/\[ARC\] Arc Troopers/);assert.match(indicator(1).title,/Azul 7 \/ Rojo 0 \/ Verde 0/);assert.match(indicator(1).title,/cada minuto; puedes estar incluido/);assert.doesNotMatch(indicator(1).title,/DO_NOT_RENDER_ROSTER_NAME/);
 assert.equal(indicator(2).dataset.state,'empty');assert.equal(label(2),'Miembros del clan · 0');for(const n of [3,4,5]){assert.equal(indicator(n).dataset.state,'unknown');assert.doesNotMatch(label(n),/Miembros del clan · [0-9]/);}
 await a.click('server-3');assert.equal(a.node('server-3').attributes['aria-pressed'],'true');assert.equal(a.posts().length,0);
});

test('clan: cuenta ausente, datos pendientes, caducados o inválidos permanecen neutros sin inventar cero',async()=>{
 const initial=sample();initial.servers=initial.servers.map(s=>({...s,online:true}));const a=await app({initial});
 for(const [status,expected]of [['login_required',/Conecta Steam/],['no_clan',/Sin clan/],['loading',/Consultando/],['stale',/caducada/],['unavailable',/sin datos/]]){a.update({...initial,clanPresence:{status,servers:{1:{status:'present',reportedCount:3}}}});assert.equal(a.node('server-1').querySelector('.clan-presence').dataset.state,'unknown');assert.match(a.node('server-1').querySelector('.clan-label').textContent,expected);}
 for(const row of [{status:'stale',reportedCount:3},{status:'unknown',reportedCount:null},{status:'present',reportedCount:'3'},{status:'present',reportedCount:-1},{status:'empty',reportedCount:null}]){a.update({...initial,clanPresence:{status:'ready',servers:{1:row}}});assert.equal(a.node('server-1').querySelector('.clan-presence').dataset.state,'unknown');assert.doesNotMatch(a.node('server-1').querySelector('.clan-label').textContent,/Miembros del clan · 0/);}
 const ready={...initial,clanPresence:{status:'ready',servers:{1:{status:'present',reportedCount:3}}}};a.update(ready);assert.equal(a.node('server-1').querySelector('.clan-presence').dataset.state,'present');a.update({...ready,servers:initial.servers.filter(s=>s.number!==1)});assert.equal(a.node('server-1').querySelector('.clan-presence').dataset.state,'unknown');a.update(ready);await a.disconnect();assert.equal(a.node('server-1').querySelector('.clan-presence').dataset.state,'unknown');
});

test('clan: nombre hostil se presenta como texto y no cambia equipo, destino ni modo elegidos',async()=>{
 const initial=sample();initial.servers=initial.servers.map(s=>({...s,online:true}));const a=await app({initial});a.node('entry-team').value='red';a.node('seed-team').value='green';
 const name='<img src=x onerror=alert(1)>',renamed={...initial,clanPresence:{status:'ready',clan:{tag:'<script>',name},servers:{1:{status:'present',reportedCount:1,teams:{blue:null,red:1,green:undefined}}}}};a.update(renamed);
 const indicator=a.node('server-1').querySelector('.clan-presence');assert.ok(indicator.title.includes(name));assert.match(indicator.title,/Azul — \/ Rojo 1 \/ Verde —/);assert.equal(indicator.attributes['aria-label'],indicator.title);assert.equal(a.node('entry-team').value,'red');assert.equal(a.node('seed-team').value,'green');assert.equal(a.selectedTeam(),'blue');assert.equal(a.node('server-1').attributes['aria-pressed'],'true');assert.equal(a.posts().length,0);
});

test('interfaz entrada: elige servidor y equipo sin portapapeles, muestra progreso y cancela por UUID',async()=>{
 const initial=sample();initial.capabilities.automaticEntry=true;initial.teamClicker.team='red';
 const id='99999999-9999-4999-8999-999999999999';
 const a=await app({initial,clipboardFails:true,onPost(route,body,s){
  if(route==='/api/entry/start')return {...s,entry:{id,server:body.server,team:body.team,durationMinutes:body.durationMinutes,status:'waiting_game',reason:'Esperando Wardogs.',endAt:'2026-10-31T12:00:00Z'}};
  assert.equal(route,'/api/entry/stop');assert.equal(body.expectedSessionId,id);return {...s,entry:{...s.entry,status:'cancelled',reason:'Entrada detenida.'}};
 }});
 assert.equal(a.node('play').textContent,'Entrar automáticamente');assert.equal(a.node('entry-team').value,'red');a.node('entry-team').value='green';await a.change('entry-team',true);await a.click('play');
 assert.equal(a.copies,0);assert.deepEqual(a.posts().map(p=>[p.route,p.body]),[['/api/entry/start',{server:1,expectedJoinId:joinId,team:'green',seeding:false,durationMinutes:120}]]);
 assert.equal(a.node('entry-progress').hidden,false);assert.equal(a.node('entry-progress-state').textContent,'Esperando Wardogs');assert.equal(a.node('entry-stage-game').dataset.state,'current');
 assert.equal(a.node('entry-guidance').hidden,false);
 for(const control of ['play','auto-start','clicker-save','break-start','entry-team','server-2'])assert.equal(a.node(control).disabled,true,control);
 await a.click('entry-stop');assert.equal(a.node('entry-progress-state').textContent,'Detenido');assert.equal(a.node('play').disabled,false);assert.equal(a.posts().length,2);
 assert.equal(a.node('entry-guidance').hidden,true);
});

test('interfaz entrada: seeding completo usa equipo elegido y no pide Steam ni entrada manual',async()=>{
 const initial=sample();initial.capabilities.automaticEntry=true;
 const a=await app({initial,onPost(route,body,s){assert.equal(route,'/api/seeding/start');return {...s,entry:{id:'99999999-9999-4999-8999-999999999999',server:1,team:body.team,status:'navigating',reason:'Abriendo entrada por ID.',...body,endAt:'2026-10-31T12:00:00Z'}};}});
 assert.equal(a.node('auto-start').textContent,'Entrar y seedear');assert.match(a.node('auto-start-help').textContent,/No requiere conectar Steam/);await a.click('auto-start');assert.equal(a.copies,0);assert.equal(a.posts()[0].body.team,'any');assert.match(a.node('notice-text').textContent,/Entrará al #1/);assert.equal(a.node('auto-status').textContent,'Entrada automática');
});

test('interfaz seeding: equipo visible y aleatorio predeterminado se conserva en inicio, programación y actividad sin cambiar el clan',async()=>{
 for(const team of ['any','blue','red','green'])for(const mode of ['now','schedule','activity']){
  const initial=sample();initial.capabilities.automaticEntry=true;initial.teamClicker.team='red';const a=await app({initial});assert.equal(a.node('seed-team').value,'any');assert.equal(a.selectedTeam(),'red');a.node('entry-team').value='green';a.node('seed-team').value=team;await a.change('seed-team',false);
  if(mode==='now')await a.click('auto-start');
  if(mode==='activity')await a.click('activity-start');
  if(mode==='schedule'){a.node('opening-at').value='2026-10-31T12:00';for(const handler of a.node('schedule-form').listeners.get('submit')||[])await handler({preventDefault(){}});}
  assert.equal(a.posts().length,1);assert.equal(a.posts()[0].body.team,team,mode+' conserva '+team);assert.equal(a.selectedTeam(),'red');assert.equal(a.node('entry-team').value,'green');
 }
});

test('interfaz seeding: un helper anterior pide elegir color y no promete la selección aleatoria',async()=>{
 const initial=sample();initial.capabilities.automaticEntry=true;initial.teamClicker.automaticAnyTeamAvailable=false;const a=await app({initial});assert.equal(a.node('seed-team').value,'any');for(const id of ['auto-start','schedule','activity-start'])assert.equal(a.node(id).disabled,true,id);assert.match(a.node('seed-team-help').textContent,/Actualiza/);
 a.node('seed-team').value='blue';await a.change('seed-team',false);assert.equal(a.node('auto-start').disabled,false);a.node('entry-team').value='any';await a.change('entry-team',false);assert.equal(a.node('play').disabled,true);assert.equal(a.selectedTeam(),'blue');
});

test('interfaz entrada: el propietario backend no recibe heartbeats UI ni inicia de nuevo al completar',async()=>{
 const initial=sample(),id='99999999-9999-4999-8999-999999999999';initial.capabilities.automaticEntry=true;initial.entry={id,server:1,team:'red',status:'choosing_team',reason:'Eligiendo equipo.',endAt:'2026-10-31T12:00:00Z'};initial.teamClicker={...initial.teamClicker,enabled:true,ownerId:id,sessionId:id};
 const a=await app({initial});assert.equal(a.posts().length,0);assert.equal(a.node('entry-stage-team').dataset.state,'current');assert.match(a.node('clicker-detail').textContent,/entrada automática/);
 a.update({...a.current,entry:{...a.current.entry,status:'completed',connected:true,reason:'Entrada completada.'},teamClicker:{...a.current.teamClicker,enabled:false}});
 assert.equal(a.node('entry-stage-hud').dataset.state,'done');assert.equal(a.node('entry-stop').disabled,true);assert.equal(a.posts().length,0);
 assert.equal(a.node('entry-guidance').hidden,true);
});

test('interfaz entrada: solo un clic real en host compatible arma foco único y lo une a la sesión devuelta',async()=>{
 for(const route of ['/api/entry/start','/api/seeding/start']){
  const initial=sample();initial.capabilities.automaticEntry=true;
  const a=await app({initial,host:true,onPost(actual,body,s){if(actual.endsWith('/stop'))return {...s,entry:{...s.entry,status:'cancelled'}};assert.equal(actual,route);return {...s,entry:{id:'99999999-9999-4999-8999-999999999999',server:1,joinId,team:body.team,status:'waiting_game',reason:'Esperando.',endAt:'2026-10-31T12:00:00Z'}};}});
  await a.click(route==='/api/entry/start'?'play':'auto-start',{isTrusted:true});assert.equal(a.posts()[0].body.initialFocus,'desktop');
  const messages=a.hostMessages.filter(m=>m.kind.startsWith('host_entry_focus_'));
  assert.equal(messages.length,2);assert.equal(messages[0].kind,'host_entry_focus_arm');assert.equal(messages[0].server,1);assert.equal(messages[0].joinId,joinId);assert.equal(messages[1].kind,'host_entry_focus_bind');assert.equal(messages[1].id,messages[0].id);assert.equal(messages[1].sessionId,'99999999-9999-4999-8999-999999999999');
  await a.click('entry-stop');assert.equal(a.hostMessages.at(-1).kind,'host_entry_focus_cancel');assert.equal(a.hostMessages.at(-1).id,messages[0].id);
 }
 const initial=sample();initial.capabilities.automaticEntry=true;const synthetic=await app({initial,host:true});await synthetic.click('play',{isTrusted:false});assert.equal(synthetic.posts()[0].body.initialFocus,undefined);assert.equal(synthetic.hostMessages.some(m=>m.kind==='host_entry_focus_arm'),false);
});

test('interfaz entrada: F8 mientras start sigue pendiente conserva el nonce para detener la sesión al vincularla',async()=>{
 let resolve;const pending=new Promise(done=>resolve=done),initial=sample();initial.capabilities.automaticEntry=true;
 const a=await app({initial,host:true,onPost:async(route,body,s)=>{await pending;return {...s,entry:{id:'99999999-9999-4999-8999-999999999999',server:1,joinId,team:body.team,status:'waiting_game',reason:'Esperando.',endAt:'2026-10-31T12:00:00Z'}};}});
 const start=a.click('play',{isTrusted:true});a.hostKey('F8');const messages=()=>a.hostMessages.filter(m=>m.kind.startsWith('host_entry_focus_'));assert.deepEqual(messages().map(m=>m.kind),['host_entry_focus_arm','host_entry_focus_stop']);assert.equal(messages()[0].id,messages()[1].id);
 resolve();await start;assert.equal(messages().at(-1).kind,'host_entry_focus_bind');assert.equal(messages().at(-1).id,messages()[0].id);assert.equal(messages().at(-1).sessionId,'99999999-9999-4999-8999-999999999999');
});

test('foco inicial: admite el aviso antes del POST, deduplica tras vincular y conserva F8',async()=>{
 let resolve;const pending=new Promise(done=>resolve=done),initial=sample();initial.capabilities.automaticEntry=true;
 initial.entry={id:'88888888-8888-4888-8888-888888888888',server:1,status:'completed',reason:'Entrada anterior.'};
 const sessionId='99999999-9999-4999-8999-999999999999';
 const a=await app({initial,host:true,onPost:async(route,body,s)=>{await pending;return {...s,entry:{id:sessionId,server:1,joinId,status:'waiting_game',reason:'Esperando.',endAt:'2026-10-31T12:00:00Z'}};}});
 const start=a.click('play',{isTrusted:true}),id=a.hostMessages.find(m=>m.kind==='host_entry_focus_arm').id;
 const warning={kind:'host_entry_focus_status',id,sessionId:null,status:'cancelled',reason:'Has cambiado de aplicación; vuelve a Wardogs cuando quieras.'};
 a.hostEvent(warning);assert.equal(a.node('notice-text').textContent,warning.reason);assert.equal(a.node('notice').hidden,false);
 await a.click('notice-close');a.hostEvent(warning);assert.equal(a.node('notice').hidden,true,'el mismo estado no reabre un aviso cerrado');
 a.hostKey('F8');assert.equal(a.hostMessages.at(-1).kind,'host_entry_focus_stop');assert.equal(a.hostMessages.at(-1).id,id);
 resolve();await start;const prepared=a.node('notice-text').textContent;assert.match(prepared,/Entrada automática al #1 preparada/);
 a.hostEvent({...warning,sessionId});assert.equal(a.node('notice-text').textContent,prepared,'un Bind tardío no sustituye el mensaje de éxito por el aviso repetido');
 assert.equal(a.hostMessages.at(-1).kind,'host_entry_focus_bind');assert.equal(a.hostMessages.at(-1).sessionId,sessionId);
});

test('foco inicial: sólo la sesión vigente puede avisar y el primer plano conocido liquida sólo ese aviso',async()=>{
 const initial=sample();initial.capabilities.automaticEntry=true;const sessionId='99999999-9999-4999-8999-999999999999';
 const a=await app({initial,host:true,onPost:(route,body,s)=>({...s,entry:{id:sessionId,server:1,joinId,status:'waiting_game',reason:'Esperando.',endAt:'2026-10-31T12:00:00Z'}})});
 a.hostEvent({kind:'host_foreground_status',supported:true,known:true,gameForeground:true});
 await a.click('play',{isTrusted:true});const id=a.hostMessages.find(m=>m.kind==='host_entry_focus_arm').id,prepared=a.node('notice-text').textContent;
 const warning={kind:'host_entry_focus_status',id,sessionId,status:'refused',reason:'Windows no permitió activar Wardogs; ponlo delante manualmente.'};
 a.hostEvent({...warning,id:'77777777-7777-4777-8777-777777777777'});a.hostEvent({...warning,sessionId:'88888888-8888-4888-8888-888888888888'});assert.equal(a.node('notice-text').textContent,prepared);
 a.hostEvent(warning);assert.equal(a.node('notice-text').textContent,warning.reason,'una muestra de foco anterior al clic no oculta un aviso nuevo');
 for(const message of [{supported:false,known:true,gameForeground:true},{supported:true,known:false,gameForeground:true},{supported:true,known:true,gameForeground:false}]){a.hostEvent({kind:'host_foreground_status',...message});assert.equal(a.node('notice').hidden,false);}
 a.hostEvent({kind:'host_foreground_status',supported:true,known:true,gameForeground:true});assert.equal(a.node('notice').hidden,true);
 a.hostEvent({...warning,status:'cancelled',reason:'Estado inicial tardío.'});assert.equal(a.node('notice').hidden,true,'el foco inicial ya satisfecho no vuelve a avisar');
 a.hostKey('F8');assert.equal(a.hostMessages.at(-1).kind,'host_entry_focus_stop');assert.equal(a.hostMessages.at(-1).id,id);
});

test('foco inicial: avanzar, terminar, cambiar de sesión o detener invalida los avisos tardíos sin perder el nonce',async()=>{
 for(const status of ['navigating','joining','choosing_team','deploying','starting_seeding','completed','cancelled','expired','error','interrupted','operator_stop','other_session']){
  const initial=sample();initial.capabilities.automaticEntry=true;const sessionId='99999999-9999-4999-8999-999999999999';
  const a=await app({initial,host:true,onPost:(route,body,s)=>({...s,entry:{id:sessionId,server:1,joinId,status:'opening',reason:'Abriendo.',endAt:'2026-10-31T12:00:00Z'}})});
  await a.click('play',{isTrusted:true});const id=a.hostMessages.find(m=>m.kind==='host_entry_focus_arm').id;
  const warning={kind:'host_entry_focus_status',id,sessionId,status:'cancelled',reason:'Vuelve a Wardogs.'};a.hostEvent(warning);assert.equal(a.node('notice').hidden,false);
  a.update({...a.current,entry:{...a.current.entry,status:status==='other_session'||status==='operator_stop'?'waiting_game':status,id:status==='other_session'?'88888888-8888-4888-8888-888888888888':sessionId,operatorStopped:status==='operator_stop'}});
  assert.equal(a.node('notice').hidden,true,status+' limpia el aviso inicial');a.hostEvent({...warning,status:'refused',reason:'Respuesta inicial tardía.'});assert.equal(a.node('notice').hidden,true,status+' ignora avisos posteriores');
  a.hostKey('F8');assert.equal(a.hostMessages.at(-1).kind,'host_entry_focus_stop');assert.equal(a.hostMessages.at(-1).id,id);
 }
});

test('foco inicial: primer plano y progreso conservan mensajes de éxito y error',async()=>{
 for(const failure of [false,true]){
  const initial=sample();initial.capabilities.automaticEntry=true;const sessionId='99999999-9999-4999-8999-999999999999';
  const a=await app({initial,host:true,onPost:(route,body,s)=>{if(failure)throw Error('No se pudo iniciar la entrada.');return {...s,entry:{id:sessionId,server:1,joinId,status:'waiting_game',reason:'Esperando.',endAt:'2026-10-31T12:00:00Z'}};}});
  await a.click('play',{isTrusted:true});const message=a.node('notice-text').textContent;assert.match(message,failure?/No se pudo iniciar/:/Entrada automática/);
  a.hostEvent({kind:'host_foreground_status',supported:true,known:true,gameForeground:true});a.update({...a.current,entry:{id:sessionId,server:1,status:'completed',reason:'Completada.'}});
  const id=a.hostMessages.find(m=>m.kind==='host_entry_focus_arm').id;a.hostEvent({kind:'host_entry_focus_status',id,sessionId,status:'cancelled',reason:'Aviso tardío.'});assert.equal(a.node('notice-text').textContent,message);assert.equal(a.node('notice').hidden,false);
 }
});

test('interfaz actualización: preferencia, comprobación e instalación conservan estado y bloquean nuevas entradas',async()=>{
 const initial=sample();initial.capabilities.automaticEntry=true;initial.update={enabled:true,status:'idle',currentVersion:'0.4.0',available:false,busy:false,reason:'Actualizaciones automáticas activas.',installBlocked:false};
 const a=await app({initial,onPost(route,body,s){
  if(route==='/api/update/config')return {...s,update:{...s.update,enabled:body.enabled}};
  if(route==='/api/update/check')return {...s,update:{...s.update,status:'available',available:true,latestVersion:'0.5.0',reason:'Lista para instalar.'}};
  assert.equal(route,'/api/update/install');return {...s,update:{...s.update,status:'installing',available:false,reason:'Instalando y reabriendo.'}};
 }});
 assert.equal(a.node('update-version').textContent,'v0.4.0');await a.change('update-enabled',false);assert.equal(a.posts().at(-1).body.enabled,false);
 await a.click('update-check');assert.equal(a.posts().at(-1).route,'/api/update/check');assert.equal(a.node('update-install').disabled,false);
 await a.click('update-install');assert.equal(a.node('play').disabled,true);assert.equal(a.node('auto-start').disabled,true);assert.equal(a.node('update-check').disabled,true);assert.match(a.node('update-status').textContent,/Instalando/);
});

test('interfaz anti-AFK: pausa explícita sin Steam, población ni servidor y ajustes separados de seeding',async()=>{
 const initial=sample();initial.servers=[];initial.account={available:false,vipFresh:false,seedingFresh:false};
 const a=await app({initial,onPost(route,body,s){assert.equal(route,'/api/movement/start');return {...s,autoSeeding:{purpose:'break',server:null,status:'waiting_game',reason:'Esperando Wardogs desplegado en primer plano.',endAt:'2026-10-31T10:05:00Z',...body}};}});
 assert.equal(a.posts().length,0);assert.equal(a.node('break-start').disabled,true);assert.equal(a.node('play').disabled,true);
 await a.click('break-5');a.node('break-interval').value=45;a.node('break-hold').value=750;await a.change('break-confirm',true);await a.click('break-start');
 assert.deepEqual(a.posts().map(p=>[p.route,p.body]),[['/api/movement/start',{durationMinutes:5,intervalSeconds:45,holdMs:750,confirmedDeployed:true}]]);assert.equal(a.copies,0);
 assert.equal(a.node('entry-title').textContent,'Servidor #1');assert.equal(a.node('auto-duration').value,'120');assert.equal(a.node('auto-players').value,'20');assert.equal(a.node('break-state').textContent,'Vuelve a Wardogs');assert.match(a.node('break-detail').textContent,/quedan 5:00/);assert.equal(a.node('break-stop').disabled,false);assert.equal(a.node('break-confirm').disabled,true);assert.equal(a.node('auto-start').disabled,true);assert.equal(a.node('clicker-save').disabled,true);assert.match(a.node('clicker-detail').textContent,/Detén el anti-AFK/);
 a.update({...a.current,now:'2026-10-31T10:01:00Z',autoSeeding:{...a.current.autoSeeding,status:'moving',startedMovementAt:'2026-10-31T10:00:01Z',reason:'Movimiento para tu pausa en marcha.'}});assert.equal(a.node('break-state').textContent,'Anti-AFK activo');assert.match(a.node('break-detail').textContent,/quedan 4:00/);
 a.update({...a.current,autoSeeding:{...a.current.autoSeeding,status:'waiting_game',reason:'Esperando el juego en primer plano.'}});assert.match(a.node('break-state').textContent,/Pausado.*Wardogs/);assert.equal(a.posts().length,1);
 a.update({...a.current,autoSeeding:{...a.current.autoSeeding,screen:{status:'verified_capture',gameForeground:true,scene:'unknown'}}});assert.equal(a.node('break-state').textContent,'Esperando despliegue');assert.match(a.node('break-detail').textContent,/Cierra los menús.*manos vacías/);assert.doesNotMatch(a.node('break-detail').textContent,/primer plano/);assert.equal(a.posts().length,1);
});

test('interfaz anti-AFK: Detener usa su ruta y ni F8 ni el tiempo terminado reactivan la pausa',async()=>{
 const initial=sample();initial.autoSeeding={purpose:'break',server:null,status:'moving',reason:'En marcha.',durationMinutes:15,intervalSeconds:30,holdMs:500,endAt:'2026-10-31T10:15:00Z'};
 const a=await app({initial,onPost(route,body,s){assert.equal(route,'/api/movement/stop');return {...s,autoSeeding:{...s.autoSeeding,status:'cancelled',operatorStopped:true,reason:'Detenido con F8 o por el usuario.'}};}});
 assert.equal(a.posts().length,0);assert.equal(a.node('play').disabled,true);assert.equal(a.node('adjust').disabled,true);await a.click('break-stop');assert.deepEqual(a.posts().map(p=>p.route),['/api/movement/stop']);assert.equal(a.node('break-state').textContent,'Detenido');assert.equal(a.node('break-stop').disabled,true);assert.equal(a.node('break-confirm').disabled,false);assert.equal(a.node('play').disabled,false);assert.match(a.node('notice-text').textContent,/No volverá a moverse/);
 a.update({...a.current,autoSeeding:{...a.current.autoSeeding,status:'expired',reason:'Fin de la pausa.'}});assert.equal(a.node('break-state').textContent,'Tiempo terminado');assert.equal(a.posts().length,1);assert.equal(a.node('break-card').dataset.active,'false');
});

test('interfaz anti-AFK: capacidad explícita, confirmación y exclusión con otros automatismos',async()=>{
 const initial=sample();delete initial.capabilities;const a=await app({initial});await a.change('break-confirm',true);assert.equal(a.node('break-start').disabled,true);assert.match(a.node('break-help').textContent,/Actualiza/);assert.equal(a.posts().length,0);
 initial.capabilities={standaloneMovement:true};initial.autoSeeding={purpose:'seeding',server:1,status:'waiting_match',durationMinutes:120,startPlayers:20,intervalSeconds:60,holdMs:500,endAt:'2026-10-31T12:00:00Z',reason:'Esperando población.'};a.update(initial);assert.equal(a.node('break-start').disabled,true);assert.match(a.node('break-help').textContent,/otro automatismo/);
 initial.autoSeeding=null;initial.teamClicker={...initial.teamClicker,enabled:true};a.update(initial);assert.equal(a.node('break-start').disabled,true);
 initial.teamClicker={...initial.teamClicker,enabled:false};initial.opening={server:1,status:'scheduled',scheduledAt:'2026-10-31T11:00:00Z'};a.update(initial);assert.equal(a.node('break-start').disabled,true);
 initial.opening=null;a.update(initial);assert.equal(a.node('break-start').disabled,false);assert.equal(a.posts().length,0);
});

test('interfaz: portapapeles remoto ocupado no impide abrir Wardogs una sola vez',async()=>{
 const a=await app({clipboardFails:true});await a.click('play');
 assert.equal(a.copies,1);assert.deepEqual(a.posts().map(p=>[p.route,p.body]),[['/api/open/game',{server:1,expectedJoinId:joinId}]]);
 assert.equal(a.node('join-id').value,joinId);assert.match(a.node('notice-text').textContent,/Apertura de Wardogs solicitada/);assert.match(a.node('notice-text').textContent,/copiarlo manualmente/);assert.equal(a.node('play').disabled,false);
});

test('interfaz: continuar un ciclo admitido no solicita nueva entrada ni confunde programación',async()=>{
 const initial=sample();initial.servers[0].seedingActive=false;initial.servers[0].status='seeding_inactive';initial.seedingContinuity[1]=true;
 const a=await app({initial});assert.equal(a.node('auto-start').textContent,'Continuar seeding');assert.equal(a.node('auto-start').disabled,false);assert.equal(a.node('schedule').disabled,true);assert.match(a.node('server-1').querySelector('.status').textContent,/ciclo sigue en curso/);
 await a.click('auto-start');assert.equal(a.copies,0);assert.deepEqual(a.posts().map(p=>p.route),['/api/seeding/start']);assert.equal(a.posts()[0].body.presenceMode,undefined);assert.match(a.node('notice-text').textContent,/continuar tu ciclo del #1/);
 initial.seedingContinuity[1]=false;a.update(initial);assert.equal(a.node('auto-start').disabled,true);assert.equal(a.node('auto-start').textContent,'Iniciar seeding');assert.match(a.node('auto-start-help').textContent,/no admite nuevos seeders/);
});

test('interfaz: un diálogo reciente se muestra durante espera de presencia sin reconexión automática',async()=>{
 const initial=sample();initial.autoSeeding={server:1,status:'waiting_presence',reason:'Esperando que la cuenta confirme presencia.',endAt:'2026-10-31T11:00:00Z',durationMinutes:60,startPlayers:20,intervalSeconds:60,holdMs:500};
 initial.diagnostics[1]={status:'game_afk_kick',title:'El juego muestra una expulsión por inactividad',detail:'La captura no identifica el servidor del mensaje.',severity:'warning',action:{kind:'review_game'},screenEvidence:{capturedAt:'2026-10-31T10:00:00Z'}};
 const a=await app({initial});assert.equal(a.node('auto-status').textContent,'Revisar juego');assert.match(a.node('auto-detail').textContent,/expulsión por inactividad/);assert.match(a.node('diagnostic-detail').textContent,/Captura del juego/);assert.equal(a.node('diagnostic-select').hidden,true);assert.equal(a.node('diagnostic-panel').dataset.severity,'warning');assert.equal(a.posts().length,0);
 initial.diagnostics[1]={title:'Presencia sin comprobar',severity:'info'};a.update(initial);assert.equal(a.node('auto-status').textContent,'Esperando tu cuenta');assert.doesNotMatch(a.node('auto-detail').textContent,/expulsión/);assert.equal(a.posts().length,0);
});

test('interfaz: elegir color prepara espera automática y DESPLEGANDO la termina sin teclas de inicio',async()=>{
 const a=await app({onPost(route,body,s){assert.equal(route,'/api/team-clicker/config');return {...s,teamClicker:{...s.teamClicker,...body,waitingAutomatic:true,active:false,running:false}};}});
 await a.selectTeam('green');await a.click('clicker-save');
 assert.deepEqual(a.posts().map(p=>[p.route,p.body]),[['/api/team-clicker/config',{enabled:true,team:'green',intervalMs:20,startMode:'automatic'}]]);
 assert.equal(a.node('clicker-state').textContent,'Esperando selector');assert.match(a.node('clicker-detail').textContent,/verde/);assert.equal(a.node('clicker-save').disabled,true);assert.equal(a.node('clicker-stop').disabled,false);assert.doesNotMatch(a.node('notice-text').textContent,/F6|F9/);
 a.update({...a.current,teamClicker:{...a.current.teamClicker,waitingAutomatic:false,active:true,running:true,count:75}});
 assert.equal(a.node('clicker-state').textContent,'Intentando entrar');assert.match(a.node('clicker-detail').textContent,/75 clics.*DESPLEGANDO/);
 a.update({...a.current,teamClicker:{...a.current.teamClicker,enabled:false,active:false,running:false,completedAttemptId:'55555555-5555-4555-8555-555555555555',entryConfirmation:{status:'confirmed'}}});
 assert.equal(a.node('clicker-state').textContent,'Equipo elegido');assert.match(a.node('clicker-detail').textContent,/DESPLEGANDO.*desactivado/);assert.equal(a.node('clicker-stop').disabled,true);assert.equal(a.node('clicker-save').disabled,false);assert.equal(a.posts().length,1);
});

test('interfaz: cancelar espera no la reactiva y cambiar color espera al desarme',async()=>{
 const a=await app({onPost(route,body,s){return {...s,teamClicker:{...s.teamClicker,...(route==='/api/team-clicker/config'?body:{enabled:false,active:false,running:false,waitingAutomatic:false,stopping:true})}};}});
 await a.click('clicker-save');await a.selectTeam('red');
 assert.equal(a.posts().at(-1).route,'/api/team-clicker/stop');assert.equal(a.node('clicker-save').disabled,true);assert.equal(a.selectedTeam(),'blue');
 a.update({...a.current,teamClicker:{...a.current.teamClicker,stopping:false}});
 assert.equal(a.selectedTeam(),'red');assert.equal(a.node('clicker-save').disabled,false);assert.equal(a.node('clicker-state').textContent,'Desactivado');assert.equal(a.posts().length,2);
 await a.click('clicker-save');assert.equal(a.posts().at(-1).body.team,'red');await a.click('clicker-stop');
 assert.equal(a.posts().at(-1).route,'/api/team-clicker/stop');assert.match(a.node('notice-text').textContent,/cancelada/);
 a.update({...a.current,teamClicker:{...a.current.teamClicker,stopping:false}});assert.equal(a.node('clicker-state').textContent,'Desactivado');assert.equal(a.posts().length,4);
});

test('interfaz: la selección automática respeta conflictos y requiere capacidad explícita del servicio',async()=>{
 const initial=sample();delete initial.teamClicker.automaticSelectionAvailable;const a=await app({initial});
 assert.equal(a.node('clicker-save').disabled,true);assert.equal(a.node('clicker-state').textContent,'Actualización necesaria');assert.match(a.node('clicker-detail').textContent,/FarmDogs/);assert.equal(a.posts().length,0);
 initial.teamClicker.automaticSelectionAvailable=true;initial.autoSeeding={server:1,status:'waiting_match',reason:'Esperando población.',endAt:'2026-10-31T11:00:00Z',durationMinutes:60,startPlayers:20,intervalSeconds:60,holdMs:500};a.update(initial);
 assert.equal(a.node('clicker-save').disabled,true);assert.match(a.node('clicker-detail').textContent,/Detén la sesión de seeding/);assert.equal(a.posts().length,0);
 initial.autoSeeding=null;initial.teamClicker={...initial.teamClicker,enabled:true,waitingAutomatic:true};a.update(initial);assert.equal(a.node('auto-start').disabled,true);assert.equal(a.node('schedule').disabled,true);assert.match(a.node('auto-start-help').textContent,/Cancela la espera/);
});
