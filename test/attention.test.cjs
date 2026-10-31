'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../public/attention.js'),'utf8');
function app({native=false}={}){
 let now=0,focused=true,sounds=0;const posts=[],intervals=[],listeners=new Map(),messages=[],nodes=new Map(),storage=new Map();
 for(const name of ['focus-alert','focus-title','focus-detail','focus-channel','focus-sound','focus-preview'])nodes.set(name,{hidden:true,checked:true,textContent:'',listeners:new Map(),addEventListener(kind,fn){this.listeners.set(kind,fn);}});
 class Audio{constructor(){this.state='running';this.currentTime=0;this.destination={};}createOscillator(){return {frequency:{setValueAtTime(){}},connect(){},start(){sounds++;},stop(){}};}createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){}};}resume(){return Promise.resolve();}}
 const bridge={postMessage:value=>posts.push(value),addEventListener:(kind,fn)=>{assert.equal(kind,'message');messages.push(fn);}};
 const window={AudioContext:Audio,addEventListener:(kind,fn)=>listeners.set(kind,fn),...(native?{chrome:{webview:bridge}}:{})};
 const document={getElementById:name=>{assert.ok(nodes.has(name),name);return nodes.get(name);},hasFocus:()=>focused,addEventListener(){}};
 const context=vm.createContext({window,document,performance:{now:()=>now},localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},setInterval:fn=>intervals.push(fn)});vm.runInContext(source,context);
 return {node:name=>nodes.get(name),posts,get sounds(){return sounds;},state:value=>listeners.get('farmdogs-state')({detail:value}),host:value=>messages.forEach(fn=>fn({data:{kind:'host_foreground_status',supported:true,...value}})),advance(ms){now+=ms;for(const fn of intervals)fn();},focus(value){focused=value;},click(name){nodes.get(name).listeners.get('click')();},sound(value){nodes.get('focus-sound').checked=value;nodes.get('focus-sound').listeners.get('change')();}};
}
const waiting=()=>({autoSeeding:{id:'55555555-5555-4555-8555-555555555555',purpose:'break',status:'waiting_game'}});

test('aviso entrada: cubre el recorrido antes del selector y desaparece al terminar o cancelar',()=>{
 const a=app(),state={now:'2026-10-31T15:00:00Z',entry:{id:'55555555-5555-4555-8555-555555555555',status:'navigating',endAt:'2026-10-31T15:05:00Z'}};
 a.state(state);a.advance(1200);assert.equal(a.node('focus-alert').hidden,false);assert.match(a.node('focus-detail').textContent,/entrada al servidor/);assert.equal(a.sounds,1);
 a.state({...state,entry:{...state.entry,status:'completed'}});assert.equal(a.node('focus-alert').hidden,true);
 a.state({...state,entry:{...state.entry,operatorStopped:true}});a.advance(1400);assert.equal(a.node('focus-alert').hidden,true);assert.equal(a.sounds,1);
 a.state({...state,entry:{...state.entry,endAt:state.now}});a.advance(1400);assert.equal(a.node('focus-alert').hidden,true);
});

test('aviso navegador: espera foco, no alarma por población, deduplica sonido y limpia al parar',()=>{
 const a=app();a.state({autoSeeding:{...waiting().autoSeeding,status:'waiting_match'}});a.advance(2000);assert.equal(a.node('focus-alert').hidden,true);assert.equal(a.sounds,0);
 a.state(waiting());a.advance(1199);assert.equal(a.node('focus-alert').hidden,true);a.advance(1);assert.equal(a.node('focus-alert').hidden,false);assert.match(a.node('focus-title').textContent,/PRIMER PLANO/);assert.equal(a.sounds,1);
 for(let n=0;n<8;n++){a.state(waiting());a.advance(250);}assert.equal(a.sounds,1);
 a.focus(false);a.advance(200);assert.equal(a.node('focus-alert').hidden,true);
 a.state(null);a.focus(true);a.advance(1000);assert.equal(a.node('focus-alert').hidden,true);assert.equal(a.sounds,1);
});

test('aviso nativo: usa señal real del host, no reproduce audio duplicado ni atribuye HUD a foco',()=>{
 const a=app({native:true});assert.equal(a.posts[0].kind,'host_focus_ready');a.state(waiting());
 a.host({known:true,gameForeground:false,soundEnabled:true,alert:{active:true,key:'movement:1',title:'PON WARDOGS EN PRIMER PLANO',detail:'Vuelve al juego.'}});assert.equal(a.node('focus-alert').hidden,false);assert.equal(a.sounds,0);
 a.host({known:true,gameForeground:true,soundEnabled:true,alert:{active:false}});assert.equal(a.node('focus-alert').hidden,true);a.advance(1400);assert.equal(a.node('focus-alert').hidden,true);
 a.host({known:false,gameForeground:false,soundEnabled:true,alert:{active:false}});a.advance(1400);assert.equal(a.node('focus-alert').hidden,true);assert.equal(a.sounds,0);
 a.host({known:true,gameForeground:false,soundEnabled:true,alert:{active:true,title:'SELECCIÓN DE EQUIPO DETENIDA',detail:'Reactiva la espera.'}});assert.match(a.node('focus-title').textContent,/DETENIDA/);a.advance(3501);assert.equal(a.node('focus-alert').hidden,true);
});

test('aviso: previsualización y silencio explícitos, preferencias nativas y caducidad',()=>{
 const browser=app();browser.sound(false);browser.click('focus-preview');assert.equal(browser.sounds,0);assert.equal(browser.node('focus-alert').hidden,false);browser.advance(3000);assert.equal(browser.node('focus-alert').hidden,true);
 browser.sound(true);browser.click('focus-preview');assert.equal(browser.sounds,1);
 const native=app({native:true});native.host({known:true,gameForeground:false,soundEnabled:false,alert:{active:false}});assert.equal(native.node('focus-sound').checked,false);native.sound(true);assert.equal(native.posts.at(-1).kind,'host_focus_preferences');assert.equal(native.posts.at(-1).soundEnabled,true);
 native.host({known:true,gameForeground:false,soundEnabled:false,alert:{active:false}});assert.equal(native.node('focus-sound').checked,true);
 native.host({known:true,gameForeground:false,soundEnabled:true,alert:{active:false}});native.click('focus-preview');assert.equal(native.posts.at(-1).kind,'host_focus_preview');assert.equal(native.sounds,0);native.host({known:true,gameForeground:true,soundEnabled:true,alert:{active:false}});assert.equal(native.node('focus-alert').hidden,true);
});
