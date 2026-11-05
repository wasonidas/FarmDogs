'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {installWorkspace,madridTime,remainingLabel,sessionStopInput,presetDraft}=require('../public/workspace.js');
const {createUserPresets}=require('../src/user-presets.cjs');
const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',NOW=Date.parse('2026-11-04T19:00:00Z');
class Target{constructor(){this.listeners=new Map();}addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);}removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}emit(name,input={}){const event={type:name,target:this,isTrusted:true,preventDefault(){this.defaultPrevented=true;},...input};for(const fn of [...this.listeners.get(name)||[]])fn(event);return event;}}
function matches(element,selector){return selector.split(',').some(part=>{part=part.trim();if(part.startsWith('[')){const name=part.slice(1,-1).replace(/^data-/,'').replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());return element.dataset[name]!==undefined;}const split=part.split('['),tag=split[0];return element.tagName===tag.toUpperCase()&&(!split[1]||matches(element,'['+split[1]));});}
class Element extends Target{constructor(tag,document){super();this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.dataset={};this.attributes={};this._text='';this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.open=false;}set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}set innerHTML(value){throw Error('Unsafe HTML insertion');}append(...nodes){for(const child of nodes){child.parentElement=this;this.children.push(child);}}replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}setAttribute(key,value){this.attributes[key]=String(value);if(key==='open')this.open=true;}removeAttribute(key){delete this.attributes[key];if(key==='open')this.open=false;}querySelectorAll(selector){return this.children.flatMap(child=>[...(matches(child,selector)?[child]:[]),...child.querySelectorAll(selector)]);}closest(selector){return matches(this,selector)?this:this.parentElement?.closest?.(selector)||null;}contains(other){return this===other||this.children.some(child=>child.contains(other));}showModal(){this.open=true;}close(){this.open=false;}click(){if(this.disabled)return;const event=this.emit('click');let parent=this.parentElement;while(parent){parent.emit('click',{...event,target:this});parent=parent.parentElement;}this.ownerDocument.emit('click',{...event,target:this});}}
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};}
function fixture({connected=true,reducedMotion=false,menuSound=false,fallbackDialog=false,handler}={}){
 const document=new Target(),window=new Target(),elements=new Map(),calls=[],drafts=[],notifications=[],audioEvents=[],audioContexts=[],oscillators=[];let busy=false,clearedMouse=0,refreshes=0,clock=NOW;
 document.hidden=false;document.body=new Element('body',document);document.createElement=tag=>new Element(tag,document);document.getElementById=id=>elements.get(id)||null;
 const html=fs.readFileSync(require.resolve('../public/mini.html'),'utf8');for(const match of html.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"/g)){const element=new Element(match[1],document);element.id=match[2];elements.set(element.id,element);document.body.append(element);}for(const form of ['preset-form','preferences-form'])elements.get(form).append(new Element('button',document));
 if(fallbackDialog)for(const id of ['settings-dialog','presets-dialog','history-dialog','checks-dialog','pause-dialog','session-details-dialog']){elements.get(id).showModal=undefined;elements.get(id).close=undefined;}
 window.document=document;window.setTimeout=setTimeout;window.clearTimeout=clearTimeout;window.AbortController=AbortController;window.matchMedia=()=>Object.assign(new Target(),{matches:reducedMotion});window.chrome={webview:new Target()};
 window.AudioContext=class{constructor(){audioEvents.push('created');audioContexts.push(this);this.currentTime=0;this.state='running';this.destination={};}createOscillator(){audioEvents.push('tone');const oscillator={frequency:{setValueAtTime(){}},stops:[],connect(){},start(){},stop(at){this.stops.push(at);},disconnect(){},finish(){this.onended?.();}};oscillators.push(oscillator);return oscillator;}createGain(){return{gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}suspend(){audioEvents.push('suspend');if(this.suspendGate)return this.suspendGate.promise.then(()=>{this.state='suspended';});this.state='suspended';return Promise.resolve();}resume(){audioEvents.push('resume');if(this.resumeGate)return this.resumeGate.promise.then(()=>{this.state='running';});this.state='running';return Promise.resolve();}close(){audioEvents.push('closed');this.state='closed';return Promise.resolve();}};
 const summary={format:'farmdogs-session-summary-v1',freshness:'fresh',status:'idle',title:'Listo para empezar',detail:'Elige una función.',server:null,team:null,timing:{remainingSeconds:null},stop:null};
 let state=connected?{token:'PRIVATE_TOKEN',summary,presetsRevision:0,preferences:{mousePause:{enabled:true,resumeAfterSeconds:3},menuSound,menuVolume:20,motion:true}}:null;
 const store=createUserPresets({now:()=>clock,newId:()=>OWNER});
 const response=data=>({ok:true,json:async()=>data});
 const defaultFetch=async(route,options)=>{if(options.headers['X-Session-Token']!==state?.token)throw Error('Wrong token');const body=options.body?JSON.parse(options.body):undefined;
  if(route==='/api/presets')return response(store.view());
  if(route==='/api/presets/save'){const result=store.save(body);state.presetsRevision=result.revision;return response(result);}
  if(route==='/api/presets/delete'){const result=store.remove(body);state.presetsRevision=result.revision;return response(result);}
  if(route==='/api/preferences'){state.preferences=body;return response(state);}
  if(route==='/api/session/stop'){state.summary={...summary,title:'Sesión detenida'};return response(state);}
  if(route==='/api/checks')return response({format:'farmdogs-error-checks-v1',overall:'ok',counts:{error:0,warning:0,ok:1},checks:[{code:'runtime',status:'ok',title:'Runtime',detail:'Disponible.'}],account:{token:'NEVER_SHOW'}});
  if(route.startsWith('/api/history?'))return response({format:'farmdogs-session-history-v1',events:[{sessionId:OWNER,at:new Date(NOW).toISOString(),status:'interrupted',reasonCode:'service_restarted',message:'NEVER_SHOW'}],sessions:[{rootSessionId:OWNER,sessionIds:[OWNER],mode:'seeding',server:2,team:'green',startedAt:new Date(NOW-3600000).toISOString(),lastAt:new Date(NOW).toISOString(),status:'interrupted',reasonCode:'service_restarted',interruptedByRestart:true}],coverage:{trimmedEvents:0,historyComplete:false}});
  throw Error('Unexpected route '+route);
 };
 const fetchImpl=async(route,options)=>{calls.push({route,options:structuredClone({...options,signal:undefined}),body:options.body?JSON.parse(options.body):undefined});try{return await(handler?handler(route,options,defaultFetch):defaultFetch(route,options));}catch(error){if(error.code)return{ok:false,json:async()=>({code:error.code,error:error.message})};throw error;}};
 window.FarmDogsWorkspace={getState:()=>state,getDraft:()=>({mode:'play',server:2,team:'green',durationMinutes:60,mousePause:{enabled:true,resumeAfterSeconds:4},token:'DO_NOT_SEND',confirmedDeployed:true}),applyDraft:async value=>{if(busy)throw Error('Tarea activa');drafts.push(value);},refresh:async()=>{refreshes++;window.emit('farmdogs-state',{detail:state});},notify:value=>notifications.push(value),isBusy:()=>busy,clearMouseDraft:()=>clearedMouse++};
 const ui=installWorkspace({window,document,fetchImpl,now:()=>clock});
 const event=(id,type,input={})=>elements.get(id).emit(type,input);
 return{ui,window,document,elements,calls,drafts,notifications,audioEvents,audioContexts,oscillators,store,event,get state(){return state;},set busy(value){busy=value;},get refreshes(){return refreshes;},get clearedMouse(){return clearedMouse;},setState(value){state=value;window.emit('farmdogs-state',{detail:value});},advance:ms=>clock+=ms};
}
test('workspace: disconnected construction executes all controls safely without requests, sounds or actions',async()=>{const f=fixture({connected:false});await f.ui.whenIdle();assert.equal(f.calls.length,0);assert.equal(f.audioEvents.length,0);assert.equal(f.elements.get('global-stop').disabled,true);assert.equal(f.elements.get('global-status-title').textContent,'SIN CONEXIÓN');f.ui.dispose();});
test('workspace: a fresh state loads profiles once and repeated snapshots do not add polling or commands',async()=>{const f=fixture();await f.ui.whenIdle();for(let index=0;index<20;index++)f.setState(f.state);await f.ui.whenIdle();assert.deepEqual(f.calls.map(row=>row.route),['/api/presets']);assert.equal(f.calls[0].options.method,'GET');assert.equal(f.calls[0].options.headers['X-Session-Token'],'PRIVATE_TOKEN');assert.equal(f.elements.get('preset-quick').disabled,false);f.ui.dispose();});
test('workspace: a valid profile list clears the disconnected-service feedback after reconnecting',async()=>{
 const f=fixture();await f.ui.whenIdle();const connected=f.state;
 f.setState(null);assert.match(f.elements.get('preset-feedback').textContent,/servicio no responde/);
 f.setState({...connected,token:'NEW_SESSION_TOKEN'});assert.equal(f.elements.get('preset-quick').disabled,true);
 await f.ui.whenIdle();assert.equal(f.elements.get('preset-feedback').textContent,'');assert.equal(f.elements.get('preset-quick').disabled,false);
 f.event('presets-open','click');await f.ui.whenIdle();assert.equal(f.elements.get('preset-feedback').textContent,'');
 assert.equal(f.calls.at(-1).options.headers['X-Session-Token'],'NEW_SESSION_TOKEN');f.ui.dispose();
});
test('workspace: successful reads clear transient or storage errors but preserve saved and loaded feedback',async()=>{
 let failure=null;const f=fixture({handler:async(route,options,next)=>{if(route==='/api/presets'&&failure==='request')throw Error('No se pudo leer la lista temporalmente.');if(route==='/api/presets'&&failure==='storage')return{ok:true,json:async()=>({...f.store.view(),readOnly:true,errorCode:'READ_FAILED'})};return next(route,options);}});await f.ui.whenIdle();
 failure='request';await assert.rejects(f.ui.refreshPresets(true),/temporalmente/);assert.match(f.elements.get('preset-feedback').textContent,/temporalmente/);
 failure=null;await f.ui.refreshPresets(true);assert.equal(f.elements.get('preset-feedback').textContent,'');
 failure='storage';await f.ui.refreshPresets(true);assert.match(f.elements.get('preset-feedback').textContent,/archivo anterior/);assert.equal(f.elements.get('preset-quick').disabled,true);
 failure=null;await f.ui.refreshPresets(true);assert.equal(f.elements.get('preset-feedback').textContent,'');assert.equal(f.elements.get('preset-quick').disabled,false);
 f.elements.get('preset-name').value='Clan';f.event('preset-form','submit');await f.ui.whenIdle();
 const saved=f.elements.get('preset-feedback').textContent;assert.match(saved,/Perfil guardado/);
 for(let index=0;index<5;index++)f.setState(f.state);await f.ui.refreshPresets(true);assert.equal(f.elements.get('preset-feedback').textContent,saved);
 await f.ui.loadPreset(OWNER);const loaded=f.elements.get('preset-feedback').textContent;assert.match(loaded,/cargado/);
 for(let index=0;index<5;index++)f.setState(f.state);await f.ui.refreshPresets(true);assert.equal(f.elements.get('preset-feedback').textContent,loaded);f.ui.dispose();
});
for(const nextToken of ['PRIVATE_TOKEN','NEW_SESSION_TOKEN'])test(`workspace: a profile response before a disconnect cannot overwrite a recovered list (${nextToken})`,async()=>{
 const gate=deferred();let reads=0;const f=fixture({handler:async(route,options,next)=>{if(route==='/api/presets'&&++reads===1){await gate.promise;return{ok:true,json:async()=>({format:'farmdogs-user-presets-v1',revision:99,presets:[],readOnly:true,errorCode:'OLD_FAILURE'})};}return next(route,options);}});
 const connected=f.state;f.setState(null);f.setState({...connected,token:nextToken});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,2);assert.equal(f.elements.get('preset-quick').disabled,false);assert.equal(f.elements.get('preset-feedback').textContent,'');
 gate.resolve();await f.ui.whenIdle();assert.equal(f.elements.get('preset-quick').disabled,false);assert.equal(f.elements.get('preset-feedback').textContent,'');
 assert.equal(f.notifications.length,0);f.ui.dispose();
});
test('workspace: save and load use the real preset store but only apply a draft, never start an automation',async()=>{const f=fixture();await f.ui.whenIdle();f.elements.get('preset-name').value='Clan <verde>';f.event('preset-form','submit');await f.ui.whenIdle();assert.equal(f.store.view().revision,1);const request=f.calls.find(row=>row.route==='/api/presets/save');assert.equal(request.body.expectedRevision,0);assert.equal('token'in request.body.settings,false);assert.equal('confirmedDeployed'in request.body.settings,false);await f.ui.loadPreset(OWNER);assert.equal(f.drafts.length,1);assert.equal(f.drafts[0].team,'green');assert.equal(f.drafts[0].mousePause.resumeAfterSeconds,4);assert.equal(f.calls.some(row=>/entry\/start|seeding\/start|open\/game/.test(row.route)),false);assert.match(f.elements.get('preset-list').textContent,/Clan <verde>/);f.busy=true;await assert.rejects(f.ui.loadPreset(OWNER),/termine/);assert.equal(f.drafts.length,1);f.ui.dispose();});
for(const opener of ['presets-open','pause-profile-save'])test(`workspace: ${opener} captures the pause draft before closing Anti-AFK`,async()=>{
 const f=fixture();await f.ui.whenIdle();
 const pauseDraft={mode:'pause',server:2,team:'any',durationMinutes:37,intervalSeconds:45,holdMs:650,mousePause:{enabled:true,resumeAfterSeconds:8}};
 f.window.FarmDogsWorkspace.getDraft=()=>f.elements.get('pause-dialog').open?pauseDraft:{mode:'play',server:1,team:'green',durationMinutes:120};
 f.event('pause-open','click');assert.equal(f.elements.get('pause-dialog').open,true);
 f.event(opener,'click');await f.ui.whenIdle();
 assert.equal(f.elements.get('pause-dialog').open,false);assert.equal(f.elements.get('presets-dialog').open,true);
 assert.match(f.elements.get('preset-current-detail').textContent,/Anti-AFK · 37 min/);
 pauseDraft.durationMinutes=90;pauseDraft.mousePause.resumeAfterSeconds=1;
 f.elements.get('preset-name').value='Pausa para comer';f.event('preset-form','submit');await f.ui.whenIdle();
 const request=f.calls.find(row=>row.route==='/api/presets/save');
 assert.equal(request.body.settings.mode,'pause');assert.equal(request.body.settings.durationMinutes,37);
 assert.equal(request.body.settings.intervalSeconds,45);assert.equal(request.body.settings.mousePause.resumeAfterSeconds,8);
 assert.equal(f.store.get(OWNER).settings.mode,'pause');assert.deepEqual(f.calls.filter(row=>row.options.method==='POST').map(row=>row.route),['/api/presets/save']);
 f.ui.dispose();
});
test('workspace: loading a pause profile opens its settings only after applying the draft and closing Profiles',async()=>{
 const f=fixture(),gate=deferred();await f.ui.whenIdle();
 f.store.save({name:'Pausa corta',settings:{mode:'pause',durationMinutes:12,intervalSeconds:20,holdMs:400},expectedRevision:0});await f.ui.refreshPresets(true);
 f.event('presets-open','click');await f.ui.whenIdle();
 f.window.FarmDogsWorkspace.applyDraft=async draft=>{f.drafts.push(draft);await gate.promise;};
 f.elements.get('pause-dialog').showModal=function(){assert.equal(f.elements.get('presets-dialog').open,false);this.open=true;};
 const loading=f.ui.loadPreset(OWNER);
 assert.equal(f.elements.get('presets-dialog').open,true);assert.equal(f.elements.get('pause-dialog').open,false);
 gate.resolve();await loading;
 assert.equal(f.elements.get('presets-dialog').open,false);assert.equal(f.elements.get('pause-dialog').open,true);
 assert.equal(f.drafts[0].mode,'pause');assert.equal(f.drafts[0].durationMinutes,12);
 assert.match(f.elements.get('preset-current-detail').textContent,/Anti-AFK · 12 min/);
 assert.equal(f.calls.some(row=>row.options.method==='POST'),false);assert.match(f.notifications.at(-1),/pulsa iniciar/);
 f.ui.dispose();
});
test('workspace: loading another profile replaces the captured settings used by a subsequent save',async()=>{
 const f=fixture();await f.ui.whenIdle();
 f.store.save({name:'Sedeo',settings:{mode:'seeding',server:3,team:'any',durationMinutes:240,intervalSeconds:60,holdMs:500},expectedRevision:0});await f.ui.refreshPresets(true);
 f.event('presets-open','click');await f.ui.whenIdle();assert.match(f.elements.get('preset-current-detail').textContent,/Jugar · 60 min/);
 await f.ui.loadPreset(OWNER);assert.match(f.elements.get('preset-current-detail').textContent,/Seeding · 240 min/);
 f.elements.get('preset-name').value='Sedeo actualizado';f.event('preset-form','submit');await f.ui.whenIdle();
 const saved=f.calls.find(row=>row.route==='/api/presets/save').body.settings;
 assert.equal(saved.mode,'seeding');assert.equal(saved.server,3);assert.equal(saved.durationMinutes,240);
 assert.equal(f.elements.get('presets-dialog').open,true);assert.deepEqual(f.calls.filter(row=>row.options.method==='POST').map(row=>row.route),['/api/presets/save']);
 f.ui.dispose();
});
test('workspace: a stale preset deletion is rejected without deleting the current revision or retrying writes',async()=>{const f=fixture();await f.ui.whenIdle();f.store.save({name:'Clan',settings:{mode:'play'},expectedRevision:0});await f.ui.refreshPresets(true);f.store.save({id:OWNER,name:'Clan nuevo',settings:{mode:'play'},expectedRevision:1});const button=f.elements.get('preset-list').querySelectorAll('button').find(row=>row.dataset.action==='delete');f.event('preset-list','click',{target:button});await f.ui.whenIdle();assert.equal(f.store.view().revision,2);assert.equal(f.store.get(OWNER).name,'Clan nuevo');assert.equal(f.calls.filter(row=>row.route==='/api/presets/delete').length,1);assert.ok(f.notifications.some(value=>/cambiaron/.test(value)));f.ui.dispose();});
test('workspace: the sticky stop remains usable during checks and sends only the captured kind and ID',async()=>{const gate=deferred(),f=fixture({handler:async(route,options,next)=>{if(route==='/api/checks')await gate.promise;return next(route,options);}});await f.ui.whenIdle();f.setState({...f.state,summary:{...f.state.summary,status:'working',title:'Seleccionando verde',stop:{kind:'entry',id:OWNER},scope:{id:OTHER},timing:{remainingSeconds:600}}});f.event('checks-run','click');assert.equal(f.elements.get('checks-run').disabled,true);assert.equal(f.elements.get('global-stop').disabled,false);f.event('global-stop','click');await new Promise(resolve=>setImmediate(resolve));const stop=f.calls.find(row=>row.route==='/api/session/stop');assert.deepEqual(stop.body,{kind:'entry',id:OWNER});assert.equal(f.calls.some(row=>row.route==='/api/stop'),false);gate.resolve();await f.ui.whenIdle();assert.equal(f.elements.get('global-stop').disabled,true);assert.match(f.elements.get('checks-summary').textContent,/0 errores/);assert.equal(f.elements.get('checks-list').textContent.includes('NEVER_SHOW'),false);f.ui.dispose();});
test('workspace: preferences keep focus alerts separate, clear profile mouse override and respect reduced motion',async()=>{const f=fixture({reducedMotion:true});await f.ui.whenIdle();f.elements.get('mouse-pause-enabled').checked=true;f.elements.get('mouse-pause-seconds').value='7';f.elements.get('menu-sound-enabled').checked=false;f.elements.get('menu-sound-volume').value='35';f.elements.get('menu-motion-enabled').checked=true;f.event('preferences-form','submit');await f.ui.whenIdle();const preference=f.calls.find(row=>row.route==='/api/preferences');assert.deepEqual(preference.body,{mousePause:{enabled:true,resumeAfterSeconds:7},menuSound:false,menuVolume:35,motion:true});assert.equal('focusSound'in preference.body,false);assert.equal(f.clearedMouse,1);assert.equal(f.document.body.dataset.motion,'off');assert.equal(f.audioEvents.length,0);f.ui.dispose();});
test('workspace: history is requested explicitly and renders Madrid times without UUIDs or arbitrary messages',async()=>{const f=fixture();await f.ui.whenIdle();f.elements.get('history-range').value='24';await f.ui.refreshHistory();const request=f.calls.find(row=>row.route.startsWith('/api/history?'));assert.ok(request.route.includes('2026-11-03T19%3A00%3A00.000Z'));const text=f.elements.get('history-list').textContent;assert.match(text,/Interrumpida/);assert.match(text,/20:00:00/);assert.equal(text.includes(OWNER),false);assert.equal(text.includes('NEVER_SHOW'),false);assert.match(text,/no lo acredita/);assert.match(f.elements.get('history-coverage').textContent,/parcial/);f.ui.dispose();});
test('workspace: menu audio is opt-in, gesture-gated and silent while hidden or native host is occluded',async()=>{const f=fixture({menuSound:true});await f.ui.whenIdle();const target=f.elements.get('history-refresh');f.document.emit('pointerover',{target});assert.equal(f.audioEvents.length,0);f.document.emit('click',{target,isTrusted:true});assert.deepEqual(f.audioEvents,['created','tone']);f.advance(100);f.document.hidden=true;f.document.emit('visibilitychange');f.document.emit('click',{target,isTrusted:true});assert.equal(f.audioEvents.filter(value=>value==='tone').length,1);f.document.hidden=false;f.window.chrome.webview.emit('message',{data:{kind:'host_window_visibility',visible:false}});f.document.emit('click',{target,isTrusted:true});assert.equal(f.audioEvents.filter(value=>value==='tone').length,1);f.window.chrome.webview.emit('message',{data:{kind:'host_window_visibility',visible:true}});f.document.emit('pointerover',{target:f.elements.get('checks-run')});await new Promise(resolve=>setImmediate(resolve));assert.equal(f.audioEvents.filter(value=>value==='tone').length,2);f.ui.dispose();assert.ok(f.audioEvents.includes('closed'));});
test('workspace: AudioContext suspends after the last tone and resumes only for the next unlocked interaction',async()=>{
 const f=fixture({menuSound:true});await f.ui.whenIdle();const target=f.elements.get('history-refresh');
 f.document.emit('click',{target,isTrusted:true});f.advance(100);f.document.emit('click',{target,isTrusted:true});
 f.oscillators[0].finish();assert.equal(f.audioEvents.includes('suspend'),false);
 f.oscillators[1].finish();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.audioContexts[0].state,'suspended');assert.equal(f.audioEvents.filter(value=>value==='suspend').length,1);
 for(let index=0;index<10;index++)f.setState(f.state);
 assert.equal(f.audioEvents.includes('resume'),false);assert.equal(f.audioEvents.filter(value=>value==='suspend').length,1);
 f.advance(100);f.document.emit('pointerover',{target});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.audioContexts.length,1);assert.equal(f.audioContexts[0].state,'running');assert.equal(f.oscillators.length,3);
 assert.equal(f.audioEvents.filter(value=>value==='resume').length,1);
 f.oscillators[2].finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.audioContexts[0].state,'suspended');
 f.ui.dispose();
});
test('workspace: hiding the document or native host cuts an active beep and restoring visibility does not resume audio',async()=>{
 const f=fixture({menuSound:true});await f.ui.whenIdle();const target=f.elements.get('history-refresh');
 f.document.emit('click',{target,isTrusted:true});f.document.hidden=true;f.document.emit('visibilitychange');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(f.oscillators[0].stops.length,2);assert.equal(f.audioContexts[0].state,'suspended');
 f.document.hidden=false;f.document.emit('visibilitychange');assert.equal(f.audioEvents.includes('resume'),false);
 f.advance(100);f.document.emit('click',{target,isTrusted:true});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.oscillators.length,2);f.window.chrome.webview.emit('message',{data:{kind:'host_window_visibility',visible:false}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(f.oscillators[1].stops.length,2);assert.equal(f.audioContexts[0].state,'suspended');
 f.window.chrome.webview.emit('message',{data:{kind:'host_window_visibility',visible:true}});
 assert.equal(f.audioEvents.filter(value=>value==='resume').length,1);assert.equal(f.audioEvents.filter(value=>value==='suspend').length,2);
 f.ui.dispose();
});
for(const preference of [{menuSound:false},{menuVolume:0}])test(`workspace: ${JSON.stringify(preference)} stops audio without repeated suspension or automatic resume`,async()=>{
 const f=fixture({menuSound:true});await f.ui.whenIdle();const target=f.elements.get('history-refresh');f.document.emit('click',{target,isTrusted:true});
 f.setState({...f.state,preferences:{...f.state.preferences,...preference}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.oscillators[0].stops.length,2);assert.equal(f.audioContexts[0].state,'suspended');
 for(let index=0;index<10;index++)f.setState(f.state);f.advance(100);f.document.emit('click',{target,isTrusted:true});
 assert.equal(f.audioEvents.filter(value=>value==='suspend').length,1);assert.equal(f.audioEvents.includes('resume'),false);
 f.setState({...f.state,preferences:{...f.state.preferences,menuSound:true,menuVolume:20}});assert.equal(f.audioEvents.includes('resume'),false);
 f.document.emit('click',{target,isTrusted:true});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.audioEvents.filter(value=>value==='resume').length,1);assert.equal(f.oscillators.length,2);
 f.ui.dispose();
});
test('workspace: a new tone waits for an outstanding suspension rather than being frozen by it',async()=>{
 const f=fixture({menuSound:true}),gate=deferred();await f.ui.whenIdle();const target=f.elements.get('history-refresh');f.document.emit('click',{target,isTrusted:true});
 f.audioContexts[0].suspendGate=gate;f.oscillators[0].finish();f.advance(100);f.document.emit('click',{target,isTrusted:true});
 assert.equal(f.oscillators.length,1);assert.equal(f.audioEvents.includes('resume'),false);
 gate.resolve();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.audioContexts[0].state,'running');assert.equal(f.oscillators.length,2);assert.equal(f.audioEvents.filter(value=>value==='resume').length,1);
 f.ui.dispose();
});
test('workspace: hiding during a pending resume invalidates the queued tone and returns the context to sleep',async()=>{
 const f=fixture({menuSound:true}),gate=deferred();await f.ui.whenIdle();const target=f.elements.get('history-refresh');f.document.emit('click',{target,isTrusted:true});f.oscillators[0].finish();await new Promise(resolve=>setImmediate(resolve));
 f.audioContexts[0].resumeGate=gate;f.advance(100);f.document.emit('click',{target,isTrusted:true});
 f.document.hidden=true;f.document.emit('visibilitychange');f.document.hidden=false;f.document.emit('visibilitychange');
 gate.resolve();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.oscillators.length,1);assert.equal(f.audioContexts[0].state,'suspended');assert.equal(f.audioEvents.filter(value=>value==='resume').length,1);
 f.advance(100);f.document.emit('pointerover',{target});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.oscillators.length,2);assert.equal(f.audioContexts[0].state,'running');
 f.ui.dispose();
});
test('workspace: fallback dialogs close only their own UI and never stop a background task',async()=>{const f=fixture({fallbackDialog:true});await f.ui.whenIdle();f.event('settings-open','click');await f.ui.whenIdle();assert.equal(f.elements.get('settings-dialog').open,true);f.document.emit('keydown',{key:'Escape'});assert.equal(f.elements.get('settings-dialog').open,false);assert.equal(f.calls.length,1);f.ui.openDialog('pause-dialog');assert.equal(f.elements.get('break-options').open,true);f.ui.closeDialog('pause-dialog');assert.equal(f.calls.some(row=>row.route.endsWith('/stop')),false);f.ui.dispose();});
test('workspace: an old pending response cannot restore a disconnected token or enable controls',async()=>{const gate=deferred(),f=fixture({handler:async(route,options,next)=>{if(route==='/api/presets')await gate.promise;return{ok:true,json:async()=>({format:'farmdogs-user-presets-v1',revision:0,presets:[]})};}});f.setState(null);gate.resolve();await f.ui.whenIdle();assert.equal(f.elements.get('global-stop').disabled,true);assert.equal(f.elements.get('preset-quick').disabled,true);assert.match(f.elements.get('preset-feedback').textContent,/servicio no responde/);f.ui.dispose();});
test('workspace: stop projection rejects unknown, stale, malformed or unscoped sessions',()=>{for(const summary of [{},{format:'farmdogs-session-summary-v1',freshness:'stale',stop:{kind:'entry',id:OWNER}},{format:'farmdogs-session-summary-v1',freshness:'fresh',stop:{kind:'all',id:OWNER}},{format:'farmdogs-session-summary-v1',freshness:'fresh',stop:{kind:'entry',id:'bad'}}])assert.equal(sessionStopInput(summary),null);assert.equal(remainingLabel(3601),'1 h 00 min');assert.equal(madridTime('invalid'),'—');assert.deepEqual(presetDraft({mode:'play',team:'green',intervalMs:undefined,token:'PRIVATE',entryId:OWNER}),{mode:'play',team:'green'});});
