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
 setAttribute(name,value){this.attributes[name]=value;}
 querySelector(selector){assert.ok(['.map','.players','.status'].includes(selector));if(!this.children.has(selector))this.children.set(selector,new Element());return this.children.get(selector);}
 reportValidity(){return true;}
 focus(){}
}
function sample(){return {token:'test-token',now:'2026-10-31T10:00:00Z',capabilities:{standaloneMovement:true},config:{selectedServer:1},source:{lastSuccessAt:'2026-10-31T10:00:00Z',error:null},servers:Array.from({length:5},(_,i)=>({number:i+1,trusted:true,joinId,players:25,capacity:100,map:'Prueba',seedingActive:true,status:'above_entry_threshold'})),seedingContinuity:{},account:{vipFresh:false,seedingFresh:false},movement:{available:false},localTools:{game:true,movement:true,automaticMovement:true},autoSeeding:null,activity:null,opening:null,watch:null,rewards:null,teamClicker:{available:true,automaticSelectionAvailable:true,enabled:false,startMode:'automatic',team:'blue',intervalMs:20,targets:{}},diagnostics:{}};}
async function app({initial=sample(),clipboardFails=false,onPost}={}){
 const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>[match[1],new Element()]));
 for(const [id,node]of elements){const tag=[...html.matchAll(/<[^>]+>/g)].find(match=>match[0].includes(`id="${id}"`))?.[0]||'';node.value=tag.match(/\bvalue="([^"]*)"/)?.[1]||'';node.checked=/\schecked(?:\s|>)/.test(tag);}
 const radios=['blue','red','green'].map(team=>Object.assign(new Element(),{value:team,checked:team==='blue'}));
 for(const radio of radios){radio._checked=radio.checked;Object.defineProperty(radio,'checked',{get(){return this._checked;},set(value){if(value)for(const peer of radios)peer._checked=false;this._checked=!!value;}});}
 const node=id=>{assert.ok(elements.has(id),`ID real del HTML: ${id}`);return elements.get(id);};
 const document={getElementById:node,querySelectorAll(selector){if(selector==='input[name="clicker-team"]')return radios;if(selector==='input[name="clicker-team"],#clicker-interval')return [...radios,node('clicker-interval')];assert.ok(['[data-go-tab]','[data-seed-mode]'].includes(selector));return [];},querySelector(selector){if(selector==='input[name="clicker-team"]:checked')return radios.find(r=>r.checked);const team=selector.match(/\[value="(blue|red|green)"\]/)?.[1];assert.ok(team);return radios.find(r=>r.value===team);}};
 let current=initial,copies=0;const requests=[];
 const context=vm.createContext({document,window:{},navigator:{clipboard:{writeText:async()=>{copies++;if(clipboardFails)throw Error('Portapapeles remoto ocupado');}}},console,Intl,Date,Number,Object,Set,fetch:async(route,options={})=>{const request={route,method:options.method||'GET',body:options.body?JSON.parse(options.body):null,headers:options.headers};requests.push(request);if(request.method==='POST'&&onPost)current=await onPost(route,request.body,current)||current;return {ok:true,json:async()=>current};},setInterval:()=>0});
 vm.runInContext(script,context,{filename:'public/mini.js'});await new Promise(setImmediate);
 return {node,requests,get copies(){return copies;},get current(){return current;},selectedTeam:()=>radios.find(radio=>radio.checked)?.value,async selectTeam(team){const radio=radios.find(r=>r.value===team);assert.ok(radio);assert.equal(radio.disabled,false);radio.checked=true;for(const handler of radio.listeners.get('change')||[])await handler();},async change(id,value){assert.equal(node(id).disabled,false);node(id).checked=value;for(const handler of node(id).listeners.get('change')||[])await handler();},async click(id){assert.equal(node(id).disabled,false,`${id} habilitado`);for(const handler of node(id).listeners.get('click')||[])await handler();},update(value){current=value;context.nextState=value;vm.runInContext('render(nextState)',context);},posts:()=>requests.filter(request=>request.method==='POST')};
}

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
