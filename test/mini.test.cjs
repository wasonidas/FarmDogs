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
 for(const [id,node]of elements){const tag=[...html.matchAll(/<[^>]+>/g)].find(match=>match[0].includes(`id="${id}"`))?.[0]||'';node.value=tag.match(/\bvalue="([^"]*)"/)?.[1]||'';node.checked=/\schecked(?:\s|>)/.test(tag);const mode=tag.match(/\bdata-seed-mode="([^"]*)"/)?.[1];if(mode)node.dataset.seedMode=mode;}
 const radios=['blue','red','green'].map(team=>Object.assign(new Element(),{value:team,checked:team==='blue'}));
 for(const radio of radios){radio._checked=radio.checked;Object.defineProperty(radio,'checked',{get(){return this._checked;},set(value){if(value)for(const peer of radios)peer._checked=false;this._checked=!!value;}});}
 const node=id=>{assert.ok(elements.has(id),`ID real del HTML: ${id}`);return elements.get(id);};
 const documentListeners=new Map(),timers=new Map();let timerId=0;
 const document={hidden:false,addEventListener:(name,handler)=>documentListeners.set(name,handler),getElementById:node,querySelectorAll(selector){if(selector==='input[name="clicker-team"]')return radios;if(selector==='input[name="clicker-team"],#clicker-interval')return [...radios,node('clicker-interval')];if(selector==='[data-seed-mode]')return [...elements.values()].filter(node=>node.dataset.seedMode);assert.equal(selector,'[data-go-tab]');return [];},querySelector(selector){if(selector==='input[name="clicker-team"]:checked')return radios.find(r=>r.checked);const team=selector.match(/\[value="(blue|red|green)"\]/)?.[1];assert.ok(team);return radios.find(r=>r.value===team);}};
 let current=initial,copies=0;const requests=[],hostMessages=[],hostListeners=[],hostWindowListeners=new Map();
 const mockWindow=host?{addEventListener:(name,handler)=>hostWindowListeners.set(name,handler),crypto:{randomUUID:()=> '44444444-4444-4444-8444-444444444444'},chrome:{webview:{postMessage:msg=>hostMessages.push(msg),addEventListener:(kind,handler)=>hostListeners.push(handler)}}}:{};
 const context=vm.createContext({document,window:mockWindow,navigator:{clipboard:{writeText:async()=>{copies++;if(clipboardFails)throw Error('Portapapeles remoto ocupado');}}},console,Intl,Date,Number,Object,Set,fetch:async(route,options={})=>{const request={route,method:options.method||'GET',body:options.body?JSON.parse(options.body):null,headers:options.headers};requests.push(request);if(request.method==='POST'&&onPost)current=await onPost(route,request.body,current)||current;return {ok:true,json:async()=>current};},setInterval:()=>0,setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(script,context,{filename:'public/mini.js'});await new Promise(setImmediate);
 if(host)for(const handler of hostListeners)handler({data:{kind:'host_entry_focus_support',supported:true}});
 return {node,requests,hostMessages,hostEvent:message=>{for(const handler of hostListeners)handler({data:message});},hostKey:key=>hostWindowListeners.get("keydown")?.({key}),get copies(){return copies;},get current(){return current;},pollDelay:()=>[...timers.values()].at(-1)?.delay,async tickPoll(){const first=timers.entries().next().value;assert.ok(first);timers.delete(first[0]);await first[1].callback();},async hidden(value){document.hidden=value;documentListeners.get('visibilitychange')?.();await new Promise(setImmediate);},selectedTeam:()=>radios.find(radio=>radio.checked)?.value,async selectTeam(team){const radio=radios.find(r=>r.value===team);assert.ok(radio);assert.equal(radio.disabled,false);radio.checked=true;for(const handler of radio.listeners.get('change')||[])await handler();},async change(id,value){assert.equal(node(id).disabled,false);node(id).checked=value;for(const handler of node(id).listeners.get('change')||[])await handler();},async click(id,event){assert.equal(node(id).disabled,false,`${id} habilitado`);for(const handler of node(id).listeners.get('click')||[])await handler(event);},async submit(id,event={}){assert.equal(node('schedule').disabled,false);for(const handler of node(id).listeners.get('submit')||[])await handler({preventDefault(){},...event});},update(value){current=value;context.nextState=value;vm.runInContext('render(nextState)',context);},async disconnect(){current=null;await vm.runInContext('poll()',context);},posts:()=>requests.filter(request=>request.method==='POST')};
}

const focusJobId='55555555-5555-4555-8555-555555555555';
const repeatId='77777777-7777-4777-8777-777777777777';
function repeatSample(){const s=sample();s.capabilities.persistentTeam=true;s.teamClicker.persistentSelectionAvailable=true;s.persistentTeam={enabled:false,status:'disabled',cleanupPending:false,reason:'Desactivado.'};return s;}
function deferredHost(a){a.hostEvent({kind:'host_entry_focus_support',supported:true,deferred:true});}
function automaticSample(){const s=sample();s.capabilities.automaticEntry=true;s.capabilities.deferredEntryFocus=true;return s;}

test('equipo persistente: esperar siguiente partida usa la API y sigue preparado después de DESPLEGANDO',async()=>{
 const a=await app({initial:repeatSample(),onPost:(route,body,current)=>{
  if(route==='/api/persistent-team/start')return {...current,persistentTeam:{...body,id:repeatId,enabled:true,status:'watching',reason:'Sin capturas durante la partida.',cleanupPending:false}};
  assert.equal(route,'/api/persistent-team/stop');assert.equal(body.expectedSessionId,repeatId);return {...current,persistentTeam:{...current.persistentTeam,enabled:false,status:'disabled',reason:'Modo desactivado.',cleanupPending:false}};
 }});
 assert.equal(a.node('clicker-repeat').checked,false);assert.equal(a.node('clicker-next').hidden,true);
 await a.change('clicker-repeat',true);await a.selectTeam('green');assert.equal(a.node('clicker-next').hidden,false);assert.equal(a.node('clicker-server').value,'1');
 await a.click('clicker-next');assert.deepEqual(a.posts().map(row=>[row.route,row.body]),[['/api/persistent-team/start',{server:1,expectedJoinId:joinId,team:'green',intervalMs:20,startNow:false}]]);
 assert.equal(a.node('clicker-state').textContent,'Preparado entre partidas');assert.match(a.node('clicker-detail').textContent,/#1.*verde.*Sin capturas/);assert.equal(a.node('clicker-repeat').checked,true);assert.equal(a.node('clicker-stop').disabled,false);
 a.update({...a.current,persistentTeam:{...a.current.persistentTeam,status:'watching',reason:'Equipo seleccionado; sigue preparado.'},teamClicker:{...a.current.teamClicker,entryConfirmation:{status:'confirmed',actualTeam:'green'}}});
 assert.equal(a.node('clicker-state').textContent,'Preparado entre partidas');assert.match(a.node('clicker-detail').textContent,/sigue preparado/);assert.equal(a.node('clicker-repeat').checked,true);
 await a.tickPoll();assert.equal(a.posts().length,1,'La preferencia no depende de heartbeat HTML.');
 await a.click('clicker-stop');assert.equal(a.node('clicker-state').textContent,'Desactivado');assert.equal(a.node('clicker-save').disabled,false);assert.equal(a.node('clicker-repeat').checked,true);assert.equal(a.posts().length,2);
});

test('equipo persistente: elegir ahora mantiene un dueño de intento y bloquea otros automatismos',async()=>{
 const a=await app({initial:repeatSample(),onPost:(route,body,current)=>{
  assert.equal(route,'/api/persistent-team/start');return {...current,persistentTeam:{...body,id:repeatId,enabled:true,status:'waiting_selector',reason:'Esperando el selector.',cleanupPending:false},teamClicker:{...current.teamClicker,enabled:true,ownerId:focusJobId,sessionId:focusJobId}};
 }});
 await a.change('clicker-repeat',true);await a.selectTeam('green');await a.click('clicker-save');assert.equal(a.posts()[0].body.startNow,true);assert.equal(a.node('clicker-state').textContent,'Esperando selector');
 for(const id of ['play','adjust','auto-start','activity-start','schedule','break-start','clicker-save','clicker-next','clicker-repeat','clicker-server','server-2'])assert.equal(a.node(id).disabled,true,id);
 await a.tickPoll();assert.equal(a.posts().length,1,'No se envía heartbeat de otro propietario.');assert.equal(a.node('clicker-stop').disabled,false);
});

test('equipo persistente: un servicio antiguo o un servidor no fiable no permiten prepararlo',async()=>{
 const old=await app({initial:sample()});assert.equal(old.node('clicker-repeat').disabled,true);assert.equal(old.node('clicker-next').hidden,true);assert.equal(old.node('clicker-save').disabled,false);
 const initial=repeatSample();initial.servers=initial.servers.map(row=>({...row,trusted:false}));const missing=await app({initial});await missing.change('clicker-repeat',true);assert.equal(missing.node('clicker-save').disabled,true);assert.equal(missing.node('clicker-next').disabled,true);assert.match(missing.node('clicker-repeat-help').textContent,/datos recientes/);
});

test('consumo UI: minimizada consulta cada 10 s; al volver o conectar cuenta refresca inmediatamente',async()=>{
 const a=await app({initial:repeatSample(),host:true});assert.equal(a.pollDelay(),2000);const first=a.requests.length;
 a.hostEvent({kind:'host_window_visibility',visible:false});await new Promise(setImmediate);assert.equal(a.pollDelay(),10000);assert.equal(a.requests.length,first);
 a.hostEvent({kind:'host_account_status',state:'connected',reading:true,detail:'Cuenta actualizada.'});await new Promise(setImmediate);assert.equal(a.requests.length,first+1);assert.equal(a.pollDelay(),10000);
 a.hostEvent({kind:'host_window_visibility',visible:true});await new Promise(setImmediate);assert.equal(a.requests.length,first+2);assert.equal(a.pollDelay(),2000);
 await a.hidden(true);assert.equal(a.pollDelay(),10000);await a.hidden(false);assert.equal(a.pollDelay(),2000);
});

test('consumo UI: el selector legacy conserva renovación de 2 s incluso oculto y el dueño persistente no la necesita',async()=>{
 const legacy=sample();legacy.teamClicker={...legacy.teamClicker,enabled:true,sessionId:focusJobId};const a=await app({initial:legacy});await a.hidden(true);assert.equal(a.pollDelay(),2000);const initialPosts=a.posts().length;await a.tickPoll();assert.equal(a.posts().length,initialPosts+1);assert.equal(a.posts().at(-1).route,'/api/team-clicker/heartbeat');
 const owned=repeatSample();owned.persistentTeam={id:repeatId,enabled:true,status:'selecting',server:1,team:'green',intervalMs:20,reason:'Entrando.',cleanupPending:false};owned.teamClicker={...owned.teamClicker,enabled:true,ownerId:repeatId,sessionId:focusJobId};const b=await app({initial:owned});await b.hidden(true);assert.equal(b.pollDelay(),10000);await b.tickPoll();assert.equal(b.posts().length,0);
});

test('cuenta Steam: una importación confirmada por el host renueva los datos API sin volver a abrir el login',async()=>{
 const initial=sample(),a=await app({initial,host:true});const before=a.requests.filter(row=>row.method==='GET').length;
 assert.equal(a.node('vip').textContent,'Sin lectura reciente');initial.account={vipFresh:true,seedingFresh:false,vip:{comprobado:true,tiene:true,caduca:'2026-11-05T10:00:00Z'}};
 a.hostEvent({kind:'host_account_status',state:'connected',reading:true,detail:'Cuenta actualizada.'});await new Promise(setImmediate);
 assert.equal(a.requests.filter(row=>row.method==='GET').length,before+1);assert.equal(a.node('vip').textContent,'VIP activo');assert.equal(a.node('reader-status').textContent,'Cuenta actualizada.');assert.equal(a.posts().length,0);assert.equal(a.hostMessages.some(row=>row.kind==='account_open'),false);
 a.hostEvent({kind:'host_account_status',state:'read_error',reading:true,detail:'Sin lectura reciente.'});a.hostEvent({kind:'host_account_status',state:'connected',reading:false,detail:'Lectura detenida.'});await new Promise(setImmediate);assert.equal(a.requests.filter(row=>row.method==='GET').length,before+1);
});

test('cuenta Steam: varios avisos durante un POST se agrupan en una lectura posterior sin perder la mutación',async()=>{
 let release;const hold=new Promise(resolve=>release=resolve);const a=await app({initial:automaticSample(),host:true,onPost:async(route,body,s)=>{await hold;return {...s,entry:{id:focusJobId,server:1,team:'blue',status:'waiting_game',reason:'Esperando.',endAt:'2026-10-31T12:00:00Z'}};}});
 const before=a.requests.filter(row=>row.method==='GET').length,pending=a.click('play');await new Promise(setImmediate);
 for(let i=0;i<3;i++)a.hostEvent({kind:'host_account_status',state:'connected',reading:true,detail:'Cuenta actualizada.'});assert.equal(a.requests.filter(row=>row.method==='GET').length,before);
 release();await pending;await new Promise(setImmediate);assert.equal(a.requests.filter(row=>row.method==='GET').length,before+1);assert.equal(a.posts().length,1);assert.equal(a.node('entry-progress-state').textContent,'Esperando Wardogs');assert.equal(a.hostMessages.some(row=>row.kind==='account_open'),false);
});

test('entrar con anti-AFK: casilla opcional conserva la entrada compatible sin iniciar movimiento desde la interfaz',async()=>{
 const initial=automaticSample();initial.capabilities.entryAntiAfk=true;const a=await app({initial});
 assert.equal(a.node('entry-anti-afk').checked,false);assert.equal(a.node('entry-anti-afk').disabled,false);assert.match(a.node('entry-anti-afk-help').textContent,/Opcional/);
 await a.click('play');assert.deepEqual(a.posts().map(row=>[row.route,row.body]),[['/api/entry/start',{server:1,expectedJoinId:joinId,team:'blue',seeding:false,durationMinutes:120}]]);
});

test('entrar con anti-AFK: envía ajustes propios una sola vez y el backend confirma despliegue, sin Steam ni población mínima',async()=>{
 const initial=automaticSample();initial.capabilities.entryAntiAfk=true;initial.servers=initial.servers.map(s=>({...s,players:1,seedingActive:false}));initial.account={};
 const id='99999999-9999-4999-8999-999999999999';
 const a=await app({initial,onPost:(route,body,state)=>({...state,entry:{id,server:body.server,team:body.team,seeding:body.seeding,antiAfk:body.antiAfk,antiAfkSettings:body.antiAfkSettings,status:'waiting_game',endAt:'2026-10-31T12:00:00Z',reason:'Esperando Wardogs.'}})});
 a.node('break-duration').value='45';a.node('break-interval').value='20';a.node('break-hold').value='750';assert.equal(a.node('break-confirm').checked,false);
 await a.change('entry-anti-afk',true);assert.match(a.node('entry-anti-afk-help').textContent,/45 min.*20 s.*750 ms/);assert.match(a.node('entry-anti-afk-help').textContent,/La cola no consume/);assert.match(a.node('entry-anti-afk-help').textContent,/Manos vacías/);
 a.update({...a.current,now:'2026-10-31T10:00:01Z'});assert.equal(a.node('entry-anti-afk').checked,true);assert.equal(a.posts().length,0);
 await a.click('play');assert.deepEqual(a.posts().map(row=>[row.route,row.body]),[['/api/entry/start',{server:1,expectedJoinId:joinId,team:'blue',seeding:false,durationMinutes:120,antiAfk:true,antiAfkSettings:{durationMinutes:45,intervalSeconds:20,holdMs:750}}]]);
 assert.equal(a.node('entry-anti-afk').disabled,true);assert.equal(a.node('entry-anti-afk').checked,true);assert.equal(a.posts().some(row=>row.route==='/api/movement/start'),false);assert.match(a.node('notice-text').textContent,/45 min tras confirmar el despliegue/);
 // Changing future pause settings never rewrites the entry already accepted.
 a.node('break-duration').value='5';a.node('break-interval').value='300';a.update({...a.current,now:'2026-10-31T10:01:00Z'});assert.match(a.node('entry-anti-afk-help').textContent,/45 min.*20 s/);assert.equal(a.posts().length,1);
 a.update({...a.current,entry:{...a.current.entry,status:'starting_seeding'}});assert.equal(a.node('entry-progress-state').textContent,'Preparando anti-AFK');assert.equal(a.posts().length,1);
});

test('entrar con anti-AFK: un servicio anterior o un controlador ausente no promete ni envía la opción',async()=>{
 for(const kind of ['legacy','movement','entry']){
  const initial=automaticSample();initial.capabilities.entryAntiAfk=kind!=='legacy';if(kind==='movement')initial.localTools.automaticMovement=false;if(kind==='entry')initial.capabilities.automaticEntry=false;
  const a=await app({initial});assert.equal(a.node('entry-anti-afk').disabled,true,kind);assert.equal(a.node('entry-anti-afk').checked,false);assert.equal(a.posts().length,0);
  // A selection from a previously compatible state cannot be silently dropped.
  a.node('entry-anti-afk').checked=true;a.update(a.current);assert.equal(a.node('play').disabled,true,kind);assert.equal(a.posts().length,0);
 }
});

test('entrar con anti-AFK: valida ajustes, refleja la opción del intento activo y no conserva controles utilizables sin conexión',async()=>{
 const initial=automaticSample();initial.capabilities.entryAntiAfk=true;const a=await app({initial});await a.change('entry-anti-afk',true);
 a.node('break-duration').value='0';for(const f of a.node('break-duration').listeners.get('input'))await f();assert.equal(a.node('play').disabled,true);assert.match(a.node('entry-anti-afk-help').textContent,/Revisa duración/);assert.equal(a.posts().length,0);
 await a.click('break-15');assert.equal(a.node('play').disabled,false);assert.match(a.node('entry-anti-afk-help').textContent,/15 min/);
 a.update({...a.current,entry:{id:'99999999-9999-4999-8999-999999999999',server:1,team:'green',antiAfk:false,status:'joining',endAt:'2026-10-31T12:00:00Z',reason:'En cola.'}});assert.equal(a.node('entry-anti-afk').checked,false);assert.equal(a.node('entry-anti-afk').disabled,true);assert.match(a.node('entry-anti-afk-help').textContent,/no tiene anti-AFK/);
 await a.disconnect();assert.equal(a.node('entry-anti-afk').disabled,true);assert.equal(a.node('play').disabled,true);assert.match(a.node('entry-anti-afk-help').textContent,/Sin conexión/);assert.equal(a.posts().length,0);
});

test('entrar con anti-AFK: perder capacidad después de marcar conserva la intención y bloquea Play sin enviar una entrada reducida',async()=>{
 const initial=automaticSample();initial.capabilities.entryAntiAfk=true;const a=await app({initial});await a.change('entry-anti-afk',true);assert.equal(a.node('play').disabled,false);
 const legacy={...a.current,capabilities:{...a.current.capabilities,entryAntiAfk:false}};a.update(legacy);assert.equal(a.node('entry-anti-afk').checked,true);assert.equal(a.node('entry-anti-afk').disabled,false);assert.equal(a.node('play').disabled,true);assert.match(a.node('entry-anti-afk-help').textContent,/Actualiza FarmDogs/);assert.equal(a.posts().length,0);
 await a.disconnect();assert.equal(a.node('entry-anti-afk').checked,true);assert.equal(a.node('play').disabled,true);assert.equal(a.posts().length,0);
 a.update(initial);assert.equal(a.node('entry-anti-afk').checked,true);assert.equal(a.node('entry-anti-afk').disabled,false);assert.equal(a.node('play').disabled,false);assert.equal(a.posts().length,0);
 a.update(legacy);await a.change('entry-anti-afk',false);assert.equal(a.node('entry-anti-afk').checked,false);assert.equal(a.node('entry-anti-afk').disabled,true);assert.equal(a.node('play').disabled,false);await a.click('play');assert.equal(a.posts().length,1);assert.equal(Object.hasOwn(a.posts()[0].body,'antiAfk'),false);assert.equal(Object.hasOwn(a.posts()[0].body,'antiAfkSettings'),false);
});

test('interfaz compacta: anti-AFK se prepara bajo demanda y abre sus controles al comenzar sin imponer el plegado en cada lectura',async()=>{
 const a=await app();assert.equal(!!a.node('break-options').open,false);assert.equal(a.posts().length,0);
 a.node('break-options').open=true;a.update(a.current);assert.equal(a.node('break-options').open,true);
 const moving={purpose:'break',status:'moving',durationMinutes:15,intervalSeconds:30,holdMs:500,endAt:'2026-10-31T10:15:00Z',reason:'En marcha.'};
 a.node('break-options').open=false;a.update({...a.current,autoSeeding:moving});assert.equal(a.node('break-options').open,true);assert.equal(a.node('break-stop').disabled,false);assert.equal(a.node('break-stop').hidden,false);
 a.node('break-options').open=false;a.update({...a.current,now:'2026-10-31T10:00:02Z'});assert.equal(a.node('break-options').open,false);assert.equal(a.node('break-stop').hidden,false);assert.equal(a.posts().length,0);
});

test('espera de equipo: enseña el plazo backend y lo reduce sin anunciar cuándo habrá hueco ni enviar entradas',async()=>{
 const initial=automaticSample();initial.entry={id:'99999999-9999-4999-8999-999999999999',server:1,team:'green',status:'choosing_team',reason:'Esperando verde.',endAt:'2026-10-31T10:30:00Z'};initial.teamClicker={...initial.teamClicker,enabled:true,ownerId:initial.entry.id,ownerEndAt:initial.entry.endAt,running:true,count:75};
 const a=await app({initial});assert.equal(a.node('entry-wait-limit').hidden,false);assert.match(a.node('entry-wait-limit').textContent,/Quedan 30:00/);assert.match(a.node('entry-wait-limit').textContent,/aunque esté apagado/);assert.match(a.node('entry-wait-limit').textContent,/No se puede predecir/);assert.match(a.node('clicker-limit').textContent,/Quedan 30:00/);
 a.update({...a.current,now:'2026-10-31T10:29:59Z'});assert.match(a.node('entry-wait-limit').textContent,/Quedan 0:01/);
 a.update({...a.current,now:'2026-10-31T10:31:00Z'});assert.match(a.node('entry-wait-limit').textContent,/Quedan 0:00/);assert.doesNotMatch(a.node('entry-wait-limit').textContent,/Quedan -/);
 a.update({...a.current,entry:{...a.current.entry,status:'completed'},teamClicker:{...a.current.teamClicker,enabled:false,running:false,entryConfirmation:{status:'confirmed'}}});assert.equal(a.node('entry-wait-limit').hidden,true);assert.equal(a.node('clicker-limit').hidden,true);assert.equal(a.posts().length,0);
});

test('espera de equipo: selector independiente no inventa límite y una desconexión retira el contador de entrada',async()=>{
 const initial=automaticSample();initial.teamClicker={...initial.teamClicker,enabled:true,running:true};const a=await app({initial});assert.match(a.node('clicker-limit').textContent,/no tiene una duración máxima configurada/);assert.match(a.node('clicker-limit').textContent,/Cancelar\/F8/);assert.doesNotMatch(a.node('clicker-limit').textContent,/Quedan/);
 a.update({...a.current,entry:{id:'99999999-9999-4999-8999-999999999999',server:1,team:'green',status:'joining',reason:'En cola.',endAt:'2026-10-31T10:30:00Z'}});assert.equal(a.node('entry-wait-limit').hidden,false);assert.match(a.node('entry-wait-limit').textContent,/cola.*plazo/);
 a.update({...a.current,now:'fecha-no-válida'});assert.doesNotMatch(a.node('entry-wait-limit').textContent,/Quedan/);assert.match(a.node('entry-wait-limit').textContent,/Fin de la sesión/);
 await a.disconnect();assert.equal(a.node('entry-wait-limit').hidden,true);assert.equal(a.node('clicker-limit').hidden,true);assert.equal(a.posts().length,0);
});

test('programación: el gesto real arma antes de POST y liga el permiso al UUID del trabajo',async()=>{
 let a;a=await app({initial:automaticSample(),host:true,onPost:(route,body,current)=>{
  assert.equal(route,'/api/opening/schedule');assert.equal(body.initialFocus,'desktop');
  const armed=a.hostMessages.find(m=>m.kind==='host_entry_focus_job_arm');assert.ok(armed);assert.equal(armed.jobKind,'scheduled');assert.equal(armed.server,1);assert.equal(armed.joinId,joinId);
  return {...current,opening:{id:focusJobId,status:'scheduled',server:1}};
 }});deferredHost(a);await a.submit('schedule-form',{isTrusted:true});
 const bound=a.hostMessages.find(m=>m.kind==='host_entry_focus_job_bind');assert.ok(bound);assert.equal(bound.jobKind,'scheduled');assert.equal(bound.ownerId,focusJobId);assert.equal(bound.id,a.hostMessages.find(m=>m.kind==='host_entry_focus_job_arm').id);
 assert.equal(a.hostMessages.some(m=>m.kind==='host_entry_focus_arm'),false);
});

test('actividad: el permiso nativo se arma sin fijar un destino antes de las lecturas públicas',async()=>{
 const a=await app({initial:automaticSample(),host:true,onPost:(route,body,current)=>{assert.equal(route,'/api/activity/start');assert.equal(body.initialFocus,'desktop');return {...current,activity:{id:focusJobId,status:'watching'}};}});
 deferredHost(a);await a.click('activity-start',{isTrusted:true});
 const armed=a.hostMessages.find(m=>m.kind==='host_entry_focus_job_arm'),bound=a.hostMessages.find(m=>m.kind==='host_entry_focus_job_bind');assert.ok(armed);assert.ok(bound);assert.equal(armed.jobKind,'activity');assert.equal(armed.server,undefined);assert.equal(armed.joinId,undefined);assert.equal(bound.ownerId,focusJobId);
});

test('sedeo máximo: elección explícita propone doce horas editables y no utiliza el filtro antiguo de 16 jugadores',async()=>{
 const initial=automaticSample();initial.capabilities.maximumSeeding=true;
 const a=await app({initial,onPost:(route,body,s)=>{assert.equal(route,'/api/activity/start');return {...s,activity:{id:focusJobId,strategy:body.strategy,status:'watching',reason:'Confirmando un servidor que puntúe, incluso vacío.',durationMinutes:body.durationMinutes,minPlayers:0,maxEntryPlayers:99,seeding:body.seeding,endAt:'2026-10-31T16:00:00Z'}};}});
 a.node('activity-min').value='16';a.node('activity-max').value='19';
 assert.equal(a.node('auto-duration').value,'120');await a.click('seed-choice-maximum');
 assert.equal(Number(a.node('auto-duration').value),720);assert.equal(a.node('seed-choice-maximum').attributes['aria-pressed'],'true');assert.equal(a.node('seed-mode-maximum').hidden,false);assert.equal(a.node('seed-mode-activity').hidden,true);assert.equal(a.node('auto-players-setting').hidden,false);assert.equal(a.node('auto-players').disabled,false);assert.equal(a.node('auto-players').min,'20');assert.match(a.node('seed-threshold-help').textContent,/calentamiento.*movimiento espera.*mínimo 20 jugadores.*HUD/);assert.match(a.node('maximum-plan').textContent,/720 min.*fin previsto.*23:00.*Madrid/);assert.equal(a.posts().length,0);
 a.node('auto-duration').value='360';a.node('auto-interval').value='25';a.node('auto-hold').value='700';a.node('seed-team').value='green';
 await a.click('seed-choice-activity');assert.equal(a.node('auto-players-setting').hidden,false);assert.equal(a.node('auto-players').disabled,false);assert.equal(a.node('activity-min').value,'16');await a.click('seed-choice-maximum');assert.equal(a.node('auto-duration').value,'360');
 await a.click('maximum-start');assert.deepEqual(a.posts().map(p=>[p.route,p.body]),[['/api/activity/start',{strategy:'maximum',durationMinutes:360,minPlayers:0,maxEntryPlayers:99,team:'green',seeding:{durationMinutes:360,startPlayers:20,intervalSeconds:25,holdMs:700}}]]);
 assert.equal(a.node('activity-min').value,'16');assert.equal(a.node('activity-max').value,'19');assert.match(a.node('maximum-plan').textContent,/activo.*Quedan 360:00.*17:00:00/);assert.equal(a.node('maximum-stop').disabled,false);assert.equal(a.node('maximum-start').disabled,true);assert.equal(a.node('auto-status').textContent,'Sedeo máximo');assert.match(a.node('notice-text').textContent,/servidor vacío.*calentamiento.*movimiento esperará 20 jugadores y el HUD/);assert.doesNotMatch(a.node('notice-text').textContent,/mover al personaje tras reconocer el despliegue/);
});

test('sedeo máximo: requiere capacidad explícita y conserva la exclusión de otros automatismos y actualizaciones',async()=>{
 const initial=automaticSample(),a=await app({initial});await a.click('seed-choice-maximum');assert.equal(a.node('maximum-start').disabled,true);assert.match(a.node('maximum-help').textContent,/Actualiza FarmDogs/);
 for(const handler of a.node('maximum-start').listeners.get('click')||[])await handler();assert.equal(a.posts().length,0);
 initial.capabilities.maximumSeeding=true;a.update(initial);assert.equal(a.node('maximum-start').disabled,false);
 for(const change of [{teamClicker:{...initial.teamClicker,enabled:true}},{autoSeeding:{purpose:'break',status:'moving'}},{opening:{status:'scheduled'}},{update:{status:'installing'}}]){a.update({...initial,...change});assert.equal(a.node('maximum-start').disabled,true);}
 a.update({...initial,teamClicker:{...initial.teamClicker,automaticAnyTeamAvailable:false}});assert.equal(a.node('maximum-start').disabled,true);a.node('seed-team').value='blue';await a.change('seed-team',false);assert.equal(a.node('maximum-start').disabled,false);assert.equal(a.posts().length,0);
});

test('sedeo máximo: carga la vigilancia vigente con su plazo real y distingue expiración de app abierta',async()=>{
 const initial=automaticSample();initial.capabilities.maximumSeeding=true;initial.activity={id:focusJobId,strategy:'maximum',status:'watching',reason:'Esperando dos lecturas recientes.',durationMinutes:480,minPlayers:0,maxEntryPlayers:99,seeding:{startPlayers:20,intervalSeconds:45,holdMs:800},team:'red',endAt:'2026-10-31T18:00:00Z'};
 const a=await app({initial});assert.equal(Number(a.node('auto-duration').value),480);assert.equal(a.node('seed-mode-maximum').hidden,false);assert.equal(a.node('seed-team').value,'red');assert.match(a.node('maximum-plan').textContent,/activo.*480:00.*19:00:00/);assert.equal(a.node('maximum-stop').disabled,false);assert.equal(a.posts().length,0);
 a.update({...initial,now:'2026-10-31T18:00:01Z',activity:{...initial.activity,status:'expired',reason:'Fin del tiempo de sedeo máximo.'}});assert.equal(a.node('auto-status').textContent,'Tiempo terminado');assert.match(a.node('auto-detail').textContent,/No está buscando servidores/);assert.match(a.node('activity-state').textContent,/búsqueda está detenida aunque la app siga abierta/);assert.equal(a.node('maximum-stop').disabled,true);assert.equal(a.node('maximum-start').disabled,false);assert.equal(a.posts().length,0);
});

test('sedeo máximo: prepared mantiene plazo y parada solo para la entrada y movimiento propios',async()=>{
 const initial=automaticSample();initial.capabilities.maximumSeeding=true;const entryId='99999999-9999-4999-8999-999999999999';
 initial.activity={id:focusJobId,strategy:'maximum',status:'prepared',reason:'Mantiene el mismo servidor.',durationMinutes:720,endAt:'2026-10-31T22:00:00Z',selectedServer:2};initial.entry={id:entryId,server:2,seeding:true,status:'completed',reason:'Entrada completada.',endAt:initial.activity.endAt};initial.entryOrigin={kind:'activity',ownerId:focusJobId,entryId};initial.autoSeeding={id:'88888888-8888-4888-8888-888888888888',purpose:'seeding',entryId,server:2,status:'moving',reason:'Automatismo en marcha.',durationMinutes:720,startPlayers:20,intervalSeconds:60,holdMs:500,endAt:initial.activity.endAt};
 const a=await app({initial});assert.equal(a.node('seed-mode-maximum').hidden,false);assert.match(a.node('maximum-plan').textContent,/activo.*720:00/);assert.equal(a.node('maximum-stop').disabled,false);assert.equal(a.node('auto-status').textContent,'En marcha');assert.match(a.node('auto-detail').textContent,/Automatismo en marcha/);
 a.update({...initial,autoSeeding:{...initial.autoSeeding,entryId:'otro-intento'}});assert.doesNotMatch(a.node('maximum-plan').textContent,/Sedeo máximo activo/);assert.equal(a.node('maximum-stop').disabled,true);assert.equal(a.posts().length,0);
 a.update({...initial,entry:{...initial.entry,status:'choosing_team'}});assert.equal(a.node('maximum-stop').disabled,false);assert.match(a.node('maximum-plan').textContent,/activo/);
 a.update({...initial,entryOrigin:{...initial.entryOrigin,entryId:'otro-intento'}});assert.equal(a.node('maximum-stop').disabled,true);assert.doesNotMatch(a.node('maximum-plan').textContent,/Sedeo máximo activo/);
});

test('sedeo máximo: prepared histórico muestra la parada, error o fin real del movimiento y no una conservación futura',async()=>{
 const entryId='99999999-9999-4999-8999-999999999999';
 const initial=automaticSample();initial.capabilities.maximumSeeding=true;initial.activity={id:focusJobId,strategy:'maximum',status:'prepared',reason:'Conservando este servidor hasta el final.',durationMinutes:720,endAt:'2026-10-31T22:00:00Z'};initial.entry={id:entryId,status:'completed',reason:'Entrada completada.'};initial.entryOrigin={kind:'activity',ownerId:focusJobId,entryId};initial.autoSeeding={id:'88888888-8888-4888-8888-888888888888',purpose:'seeding',entryId,status:'moving',reason:'Automatismo en marcha.',durationMinutes:720,startPlayers:20,intervalSeconds:60,holdMs:500,endAt:initial.activity.endAt};
 const a=await app({initial});assert.match(a.node('activity-state').textContent,/Automatismo en marcha/);assert.doesNotMatch(a.node('activity-state').textContent,/Conservando/);
 for(const [status,reason]of [['cancelled','Movimiento detenido con F8.'],['error','La pantalla indica que terminó la conexión verificada.'],['expired','Fin de la sesión de seeding.']]){
  a.update({...initial,autoSeeding:{...initial.autoSeeding,status,reason}});assert.match(a.node('activity-state').textContent,/Sedeo máximo (detenido|terminado)/);assert.ok(a.node('activity-state').textContent.includes(reason));assert.match(a.node('activity-state').textContent,/No hay búsqueda activa/);assert.doesNotMatch(a.node('activity-state').textContent,/Conservando|fin.*23:00/);assert.equal(a.node('maximum-stop').disabled,true);assert.match(a.node('maximum-plan').textContent,/No hay búsqueda activa/);
 }
 a.update({...initial,autoSeeding:{...initial.autoSeeding,entryId:'sesión-ajena',reason:'NO ATRIBUIR ESTE MOTIVO'}});assert.match(a.node('activity-state').textContent,/No hay búsqueda activa/);assert.doesNotMatch(a.node('activity-state').textContent,/NO ATRIBUIR|Conservando/);assert.equal(a.posts().length,0);
 a.update({...initial,entry:{...initial.entry,status:'error',reason:'No se pudo entrar en el equipo.'},autoSeeding:null});assert.match(a.node('activity-state').textContent,/No se pudo entrar en el equipo.*No hay búsqueda activa/);assert.equal(a.posts().length,0);
});

test('sedeo máximo: permite configurar el umbral de movimiento y conserva la misma preferencia al volver a Ahora',async()=>{
 for(const threshold of [20,30]){
  const initial=automaticSample();initial.capabilities.maximumSeeding=true;const a=await app({initial});await a.click('seed-choice-maximum');assert.equal(a.node('auto-players').disabled,false);a.node('auto-players').value=String(threshold);
  await a.click('maximum-start');assert.equal(a.posts().at(-1).route,'/api/activity/start');assert.equal(a.posts().at(-1).body.seeding.startPlayers,threshold);assert.match(a.node('notice-text').textContent,new RegExp('movimiento esperará '+threshold+' jugadores y el HUD'));
  const entryId='99999999-9999-4999-8999-999999999999',activity={id:focusJobId,strategy:'maximum',status:'watching',reason:'Confirmando servidor.',durationMinutes:720,minPlayers:0,maxEntryPlayers:99,seeding:{startPlayers:threshold,intervalSeconds:60,holdMs:500},endAt:'2026-10-31T22:00:00Z'};
  a.update({...initial,activity});assert.equal(Number(a.node('auto-players').value),threshold);
  const progress={...initial,activity:{...activity,status:'prepared'},entry:{id:entryId,server:1,status:'completed'},entryOrigin:{kind:'activity',ownerId:focusJobId,entryId},autoSeeding:{purpose:'seeding',entryId,server:1,status:'waiting_match',durationMinutes:720,startPlayers:threshold,intervalSeconds:60,holdMs:500,endAt:activity.endAt,reason:'Esperando inicio.'}};
  a.update(progress);assert.equal(Number(a.node('auto-players').value),threshold);assert.equal(a.node('auto-status').textContent,'Esperando inicio');assert.match(a.node('auto-detail').textContent,/Esperando inicio/);
  a.update({...progress,autoSeeding:{...progress.autoSeeding,status:'cancelled',reason:'Detenido.'}});await a.click('seed-choice-manual');assert.equal(a.node('auto-players-setting').hidden,false);assert.equal(a.node('auto-players').disabled,false);assert.equal(Number(a.node('auto-players').value),threshold);
  await a.click('auto-start');assert.equal(a.posts().at(-1).route,'/api/seeding/start');assert.equal(a.posts().at(-1).body.startPlayers,threshold);
 }
});

test('sedeo máximo: eleva con aviso un umbral antiguo inferior a veinte al elegirlo y restaura el borrador normal',async()=>{
 for(const previous of [1,16]){
  const initial=automaticSample();initial.capabilities.maximumSeeding=true;initial.autoSeeding={purpose:'seeding',server:1,status:'interrupted',reason:'Sesión antigua interrumpida.',durationMinutes:120,startPlayers:previous,intervalSeconds:60,holdMs:500,endAt:'2026-10-31T12:00:00Z'};
  const a=await app({initial});assert.equal(Number(a.node('auto-players').value),previous);await a.click('seed-choice-maximum');assert.equal(Number(a.node('auto-players').value),20);assert.equal(a.node('auto-players').min,'20');assert.match(a.node('seed-threshold-help').textContent,new RegExp('anterior de '+previous+'.*elevado a 20'));
  await a.click('maximum-start');assert.equal(a.posts().at(-1).body.seeding.startPlayers,20);assert.equal(a.posts().at(-1).body.strategy,'maximum');await a.click('seed-choice-manual');assert.equal(Number(a.node('auto-players').value),previous);assert.equal(a.node('auto-players').min,'1');
 }
});

test('sedeo máximo: Detener conserva propietario de actividad y no vuelve a iniciar tras cancelación o desconexión',async()=>{
 const initial=automaticSample();initial.capabilities.maximumSeeding=true;initial.activity={id:focusJobId,strategy:'maximum',status:'watching',reason:'Buscando.',durationMinutes:720,seeding:{startPlayers:20,intervalSeconds:60,holdMs:500},endAt:'2026-10-31T22:00:00Z'};
 const a=await app({initial,onPost:(route,body,s)=>{assert.equal(route,'/api/activity/stop');assert.equal(body.expectedJobId,focusJobId);return {...s,activity:{...s.activity,status:'cancelled',reason:'Detenido.'}};}});await a.click('maximum-stop');assert.equal(a.posts().length,1);assert.equal(a.node('maximum-stop').disabled,true);assert.match(a.node('notice-text').textContent,/No se reactivarán solas/);a.update({...a.current,now:'2026-10-31T11:00:00Z'});assert.equal(a.posts().length,1);await a.disconnect();assert.equal(a.node('maximum-start').disabled,true);assert.match(a.node('maximum-plan').textContent,/Sin conexión/);assert.equal(a.posts().length,1);
});

test('foco diferido: web, host legado y eventos sintéticos conservan la ruta driver',async()=>{
 for(const options of [{host:false,trusted:true},{host:true,trusted:true},{host:true,deferred:true,trusted:false},{host:true,deferred:true,trusted:true,backend:false}]){
  const initial=automaticSample();if(options.backend===false)delete initial.capabilities.deferredEntryFocus;const a=await app({initial,host:options.host,onPost:(route,body,current)=>{assert.equal(body.initialFocus,undefined);return {...current,activity:{id:focusJobId,status:'watching'}};}});
  if(options.deferred)deferredHost(a);await a.click('activity-start',{isTrusted:options.trusted});assert.equal(a.hostMessages.some(m=>m.kind.startsWith('host_entry_focus_job_')),false);assert.doesNotMatch(a.node('notice-text').textContent,/F8/);assert.match(a.node('notice-text').textContent,/Detener búsqueda/);
 }
});

test('F8 durante POST: conserva el bind tardío y no duplica el HTTP que realiza el host',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});
 const a=await app({initial:automaticSample(),host:true,onPost:async(route,body,current)=>{await pending;return {...current,opening:{id:focusJobId,status:'scheduled',server:1}};}});deferredHost(a);
 const starting=a.submit('schedule-form',{isTrusted:true});await new Promise(setImmediate);
 const armed=a.hostMessages.find(m=>m.kind==='host_entry_focus_job_arm');assert.ok(armed);a.hostKey('F8');
 assert.equal(a.hostMessages.filter(m=>m.kind==='host_entry_focus_job_stop'&&m.id===armed.id).length,1);
 a.hostEvent({kind:'host_entry_focus_job_status',id:armed.id,jobKind:'scheduled',status:'stopped',reason:'Detenido con F8.'});release();await starting;
 const bound=a.hostMessages.find(m=>m.kind==='host_entry_focus_job_bind');assert.equal(bound.ownerId,focusJobId);assert.equal(bound.id,armed.id);assert.equal(a.posts().length,1);assert.match(a.node('notice-text').textContent,/detenida con F8/);
});

test('cancelación: los botones dirigen el POST al trabajo exacto y revocan sólo su nonce',async()=>{
 for(const jobKind of ['scheduled','activity']){
  const jobKey=jobKind==='scheduled'?'opening':'activity',startRoute=jobKind==='scheduled'?'/api/opening/schedule':'/api/activity/start',stopRoute=jobKind==='scheduled'?'/api/opening/cancel':'/api/activity/stop';
  const a=await app({initial:automaticSample(),host:true,onPost:(route,body,current)=>{
   if(route===startRoute)return {...current,[jobKey]:{id:focusJobId,status:jobKind==='scheduled'?'scheduled':'watching',server:1}};
   assert.equal(route,stopRoute);assert.equal(body.expectedJobId,focusJobId);assert.ok(a.hostMessages.some(m=>m.kind==='host_entry_focus_job_cancel'));return {...current,[jobKey]:{...current[jobKey],status:'cancelled'}};
  }});deferredHost(a);if(jobKind==='scheduled')await a.submit('schedule-form',{isTrusted:true});else await a.click('activity-start',{isTrusted:true});
  const armed=a.hostMessages.find(m=>m.kind==='host_entry_focus_job_arm');await a.click(jobKind==='scheduled'?'cancel-opening':'activity-stop');
  assert.equal(a.posts().length,2);assert.equal(a.hostMessages.filter(m=>m.kind==='host_entry_focus_job_cancel'&&m.id===armed.id).length,1);assert.equal(a.hostMessages.some(m=>m.kind==='host_entry_focus_job_stop'),false);
 }
});

test('avisos diferidos: descarta UUID ajeno y rechazos atrasados cuando ya está navegando',async()=>{
 const a=await app({initial:automaticSample(),host:true,onPost:(route,body,current)=>({...current,activity:{id:focusJobId,status:'watching'}})});deferredHost(a);await a.click('activity-start',{isTrusted:true});const id=a.hostMessages.find(m=>m.kind==='host_entry_focus_job_arm').id;
 const status={kind:'host_entry_focus_job_status',id,jobKind:'activity',ownerId:focusJobId,status:'refused',reason:'Rechazo de Windows.'};
 a.hostEvent({...status,ownerId:'otro-trabajo',reason:'NO MOSTRAR'});assert.doesNotMatch(a.node('notice-text').textContent,/NO MOSTRAR/);
 a.hostEvent(status);assert.equal(a.node('notice-text').textContent,status.reason);
 const next={...a.current,activity:{...a.current.activity,status:'open_requested'},entry:{id:'entry-uuid',status:'navigating'},entryOrigin:{kind:'activity',ownerId:focusJobId,entryId:'entry-uuid'}};a.update(next);assert.equal(a.node('notice').hidden,true);
 a.hostEvent({...status,status:'revoked',reason:'NO RESUCITAR'});assert.equal(a.node('notice').hidden,true);assert.equal(a.posts().length,1);
});

test('avisos diferidos: un trabajo cancelado o sustituido invalida sus mensajes tardíos',async()=>{
 for(const replacement of [{id:focusJobId,status:'cancelled'},{id:'otro-uuid',status:'watching'}]){
  const a=await app({initial:automaticSample(),host:true,onPost:(route,body,current)=>({...current,activity:{id:focusJobId,status:'watching'}})});deferredHost(a);await a.click('activity-start',{isTrusted:true});const id=a.hostMessages.find(m=>m.kind==='host_entry_focus_job_arm').id;
  const status={kind:'host_entry_focus_job_status',id,jobKind:'activity',ownerId:focusJobId,status:'refused',reason:'Aviso vigente.'};a.hostEvent(status);assert.equal(a.node('notice').hidden,false);a.update({...a.current,activity:replacement});assert.equal(a.node('notice').hidden,true);
  a.hostEvent({...status,status:'revoked',reason:'AVISO OBSOLETO'});assert.equal(a.node('notice').hidden,true);assert.doesNotMatch(a.node('notice-text').textContent,/AVISO OBSOLETO/);assert.equal(a.posts().length,1);
 }
});

test('avisos diferidos: el primer plano del juego sólo liquida el aviso ligado a su entrada',async()=>{
 const a=await app({initial:automaticSample(),host:true,onPost:(route,body,current)=>({...current,activity:{id:focusJobId,status:'watching'}})});deferredHost(a);await a.click('activity-start',{isTrusted:true});const id=a.hostMessages.find(m=>m.kind==='host_entry_focus_job_arm').id;
 const status={kind:'host_entry_focus_job_status',id,jobKind:'activity',ownerId:focusJobId,status:'refused',reason:'No está delante.'};a.hostEvent(status);
 a.hostEvent({kind:'host_foreground_status',supported:true,known:true,gameForeground:true});assert.equal(a.node('notice').hidden,false);
 a.update({...a.current,activity:{...a.current.activity,status:'open_requested'},entry:{id:'entry-uuid',status:'waiting_game'},entryOrigin:{kind:'activity',ownerId:focusJobId,entryId:'entry-uuid'}});
 a.hostEvent({kind:'host_foreground_status',supported:true,known:false,gameForeground:true});assert.equal(a.node('notice').hidden,false);
 a.hostEvent({kind:'host_foreground_status',supported:true,known:true,gameForeground:true});assert.equal(a.node('notice').hidden,true);a.hostEvent({...status,status:'revoked',reason:'TARDÍO'});assert.equal(a.node('notice').hidden,true);
 a.hostKey('F8');assert.equal(a.hostMessages.filter(m=>m.kind==='host_entry_focus_job_stop').length,1);
});

test('componentes: un controlador incoherente explica el bloqueo sin anunciar una actualización ficticia',async()=>{
 const initial=sample();initial.localTools.automaticMovement=false;
 const reason='El controlador de movimiento no coincide con su archivo de verificación. Vuelve a extraer el portable completo.';
 initial.localTools.diagnostics={automaticMovement:{code:'hash_mismatch',reason}};
 const a=await app({initial});
 assert.equal(a.node('break-start').disabled,true);assert.equal(a.node('auto-start').disabled,true);assert.equal(a.node('activity-start').disabled,true);
 for(const id of ['break-help','auto-detail','auto-start-help'])assert.equal(a.node(id).textContent,reason,id);
 assert.equal(a.node('auto-status').textContent,'No disponible');assert.doesNotMatch(a.node('auto-detail').textContent,/Actualizando/);
 // A newly verified installation becomes usable on the next state update, but
 // rendering readiness never starts a controller or bypasses confirmation.
 a.update({...initial,localTools:{...initial.localTools,automaticMovement:true,diagnostics:{automaticMovement:{code:'ready',reason:'Verificado.'}}}});
 assert.equal(a.node('auto-start').disabled,false);assert.equal(a.node('activity-start').disabled,false);assert.equal(a.node('break-start').disabled,true);assert.equal(a.posts().length,0);
});

test('componentes: una versión anterior sin diagnóstico conserva un motivo útil y no afirma estar actualizando',async()=>{
 const initial=sample();initial.localTools.automaticMovement=false;
 const a=await app({initial});
 assert.match(a.node('break-help').textContent,/controlador.*no está disponible/);
 assert.match(a.node('auto-detail').textContent,/conservando data/);assert.doesNotMatch(a.node('auto-detail').textContent,/Actualizando/);
 assert.equal(a.posts().length,0);
});

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
 assert.equal(a.node('play').textContent,'DESPLEGAR EN SERVIDOR');assert.equal(a.node('entry-team').value,'red');a.node('entry-team').value='green';await a.change('entry-team',true);await a.click('play');
 assert.equal(a.copies,0);assert.deepEqual(a.posts().map(p=>[p.route,p.body]),[['/api/entry/start',{server:1,expectedJoinId:joinId,team:'green',seeding:false,durationMinutes:120}]]);
 assert.equal(a.node('entry-progress').hidden,false);assert.equal(a.node('entry-progress-state').textContent,'Esperando Wardogs');assert.equal(a.node('entry-stage-game').dataset.state,'current');
 assert.equal(a.node('entry-guidance').hidden,false);
 for(const control of ['play','auto-start','clicker-save','break-start','entry-team','server-2'])assert.equal(a.node(control).disabled,true,control);
 await a.click('entry-stop');assert.equal(a.node('entry-progress-state').textContent,'Detenido');assert.equal(a.node('play').disabled,false);assert.equal(a.posts().length,2);
 assert.equal(a.node('entry-guidance').hidden,true);
});

test('interfaz recuperación: conserva parada del hijo y bloquea otras tareas sin pedir foco ni iniciar otra entrada',async()=>{
 const initial=automaticSample(),id='99999999-9999-4999-8999-999999999999';
 initial.autoSeeding={id:'88888888-8888-4888-8888-888888888888',purpose:'seeding',server:1,status:'error',reason:'Reinicio confirmado.'};
 initial.entry={id,server:1,joinId,team:'green',seeding:true,status:'recovering_source',reason:'Esperando dos lecturas válidas del mismo servidor.',endAt:'2026-10-31T12:00:00Z',recovery:{id:'77777777-7777-4777-8777-777777777777'}};
 const a=await app({initial,host:true,onPost(route,body,s){
  assert.equal(route,'/api/entry/stop');assert.equal(body.expectedSessionId,id);
  return {...s,entry:{...s.entry,status:'cancelled',reason:'Recuperación detenida.'}};
 }});
 assert.equal(a.node('entry-progress-state').textContent,'Esperando al servidor');assert.match(a.node('entry-progress-server').textContent,/Reconexión/);
 assert.equal(a.node('entry-stage-game').dataset.state,'done');assert.equal(a.node('entry-stage-server').dataset.state,'current');
 assert.equal(a.node('auto-status').textContent,'Recuperando seeding');assert.match(a.node('auto-detail').textContent,/dos lecturas válidas/);
 for(const control of ['play','auto-start','activity-start','clicker-save','break-start','server-2'])assert.equal(a.node(control).disabled,true,control);
 assert.equal(a.posts().length,0);assert.equal(a.hostMessages.some(m=>/host_entry_focus_(?:arm|job_arm|bind)/.test(m.kind)),false);
 await a.click('entry-stop');assert.equal(a.node('entry-progress-state').textContent,'Detenido');assert.equal(a.node('play').disabled,false);assert.equal(a.posts().length,1);
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

test('selector: una pausa de contexto muestra el motivo exacto y el retorno no solicita un inicio nuevo',async()=>{
 const initial=sample(),reason='Wardogs no está delante. Volveré a reconocer el selector al regresar.';initial.teamClicker={...initial.teamClicker,enabled:true,pausedForContext:true,waitingAutomatic:true,active:false,running:false,count:75,reason};
 const a=await app({initial,onPost(route,body,s){assert.equal(route,'/api/team-clicker/stop');return {...s,teamClicker:{...s.teamClicker,enabled:false,active:false,running:false,waitingAutomatic:false,reason:'Espera cancelada por el usuario.'}};}});
 assert.equal(a.node('clicker-state').textContent,'En pausa · volverá a continuar');assert.equal(a.node('clicker-detail').textContent,reason);assert.equal(a.node('clicker-stop').disabled,false);assert.equal(a.posts().length,0);
 a.update({...a.current,teamClicker:{...a.current.teamClicker,pausedForContext:false,waitingAutomatic:false,active:true,running:true,count:76}});assert.equal(a.node('clicker-state').textContent,'Intentando entrar');assert.match(a.node('clicker-detail').textContent,/76 clics.*DESPLEGANDO/);assert.equal(a.posts().length,0);
 a.update({...a.current,teamClicker:{...a.current.teamClicker,pausedForContext:true,active:false,running:false,reason}});await a.click('clicker-stop');assert.equal(a.node('clicker-state').textContent,'Desactivado');assert.equal(a.node('clicker-detail').textContent,'Espera cancelada por el usuario.');assert.equal(a.posts().length,1);
 a.update({...a.current,teamClicker:{...a.current.teamClicker,pausedForContext:false}});assert.equal(a.node('clicker-state').textContent,'Desactivado');assert.equal(a.posts().length,1);
});

test('selector de entrada: una pausa propia conserva el motivo del controlador sin sustituirlo por la guía genérica',async()=>{
 const initial=automaticSample(),id='99999999-9999-4999-8999-999999999999',reason='El selector ha cambiado de tamaño. Esperando reconocerlo de nuevo.';initial.entry={id,server:1,team:'green',status:'choosing_team',reason:'Eligiendo equipo.',endAt:'2026-10-31T10:30:00Z'};initial.teamClicker={...initial.teamClicker,enabled:true,ownerId:id,ownerEndAt:initial.entry.endAt,pausedForContext:true,waitingAutomatic:true,reason};
 const a=await app({initial});assert.equal(a.node('clicker-state').textContent,'En pausa · volverá a continuar');assert.equal(a.node('clicker-detail').textContent,reason);assert.match(a.node('entry-wait-limit').textContent,/Quedan 30:00/);assert.equal(a.posts().length,0);
 a.update({...a.current,teamClicker:{...a.current.teamClicker,ownerId:'otro-intento'}});assert.match(a.node('clicker-detail').textContent,/entrada automática/);assert.equal(a.posts().length,0);
});

test('selector: la pausa requiere booleano vigente y no sobrevive a desactivar, completar o perder el servicio',async()=>{
 const initial=sample();initial.teamClicker={...initial.teamClicker,enabled:true,pausedForContext:'true',waitingAutomatic:true,reason:'Motivo anterior.'};const a=await app({initial});assert.equal(a.node('clicker-state').textContent,'Esperando selector');
 const withoutFlag={...a.current.teamClicker};delete withoutFlag.pausedForContext;a.update({...a.current,teamClicker:withoutFlag});assert.equal(a.node('clicker-state').textContent,'Esperando selector');
 a.update({...a.current,teamClicker:{...a.current.teamClicker,enabled:false,waitingAutomatic:false,pausedForContext:true,reason:'Detenido con F8.'}});assert.equal(a.node('clicker-state').textContent,'Desactivado');assert.equal(a.node('clicker-detail').textContent,'Detenido con F8.');
 a.update({...a.current,teamClicker:{...a.current.teamClicker,entryConfirmation:{status:'confirmed'}}});assert.equal(a.node('clicker-state').textContent,'Equipo elegido');assert.match(a.node('clicker-detail').textContent,/DESPLEGANDO/);
 a.update({...initial,teamClicker:{...initial.teamClicker,pausedForContext:true}});assert.equal(a.node('clicker-state').textContent,'En pausa · volverá a continuar');await a.disconnect();assert.equal(a.node('clicker-state').textContent,'No disponible');assert.doesNotMatch(a.node('clicker-detail').textContent,/volverá a continuar/);assert.equal(a.posts().length,0);
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
