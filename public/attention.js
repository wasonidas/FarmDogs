'use strict';
(()=>{
 const $=id=>document.getElementById(id),banner=$('focus-alert');if(!banner)return;
 const bridge=window.chrome?.webview,clock=()=>performance.now();
 let state=null,stateAt=-Infinity,native=null,nativeAt=-Infinity,supported=false,sound=true,pendingPreference=null,previewUntil=0,pendingKey=null,pendingSince=0,sounded=false,lastSound=-Infinity,audio=null;
 try{const saved=localStorage.getItem('farmdogs-alert-sound');if(saved!==null)sound=saved==='true';}catch{}
 $('focus-sound').checked=sound;
 function savePreference(){try{localStorage.setItem('farmdogs-alert-sound',String(sound));}catch{}}
 function post(kind,extra={}){if(bridge)bridge.postMessage({kind,...extra});}
 function audioReady(){if(bridge)return;try{const Audio=window.AudioContext||window.webkitAudioContext;if(!audio&&Audio)audio=new Audio();if(audio?.state==='suspended')void audio.resume().catch(()=>{});}catch{}}
 function beep(){if(!sound||bridge)return;audioReady();if(!audio)return;try{const oscillator=audio.createOscillator(),gain=audio.createGain(),at=audio.currentTime;oscillator.type='sine';oscillator.frequency.setValueAtTime(740,at);gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.14,at+.025);gain.gain.linearRampToValueAtTime(0,at+.25);oscillator.connect(gain);gain.connect(audio.destination);oscillator.start(at);oscillator.stop(at+.27);}catch{}}
 function fallbackIntent(){
  if(!state||clock()-stateAt>5000||!document.hasFocus())return null;
  const a=state.autoSeeding,c=state.teamClicker,e=state.entry;
  if(a&&['waiting_game','starting_movement','moving'].includes(a.status))return {key:'movement:'+a.id,title:'PON WARDOGS EN PRIMER PLANO',detail:a.purpose==='break'?'Tu anti-AFK espera el juego desplegado y con las manos vacías.':'El movimiento de seeding necesita el juego desplegado y con las manos vacías.'};
  if(e&&!e.operatorStopped&&['opening','waiting_game','navigating','joining','choosing_team','deploying','starting_seeding'].includes(e.status)&&Date.parse(e.endAt)>Date.parse(state.now))return {key:'entry:'+e.id,title:'PON WARDOGS EN PRIMER PLANO',detail:'FarmDogs está completando la entrada al servidor y al equipo elegido. Deja el juego delante; F8 o Detener cancelan.'};
  if(c?.enabled)return {key:'team:'+c.sessionId,title:'PON WARDOGS EN PRIMER PLANO',detail:'La selección automática necesita ver el selector de facciones. Vuelve al juego para que pueda elegir tu equipo.'};
  return null;
 }
 function render(){
  const at=clock();let alert=null;
  if(at<previewUntil)alert={key:'preview',title:'PON WARDOGS EN PRIMER PLANO',detail:'Así te avisará FarmDogs cuando el juego necesite estar delante.'};
  else if(supported){if(at-nativeAt<3500&&native?.known===true&&native.gameForeground===false&&native.alert?.active===true)alert=native.alert;}
  else{
   const candidate=fallbackIntent();
   if(candidate){if(pendingKey!==candidate.key){pendingKey=candidate.key;pendingSince=at;sounded=false;}if(at-pendingSince>=1200){alert=candidate;if(!sounded){if(at-lastSound>=15000){beep();lastSound=at;}sounded=true;}}}
   else{pendingKey=null;sounded=false;}
  }
  banner.hidden=!alert;
  if(alert){$('focus-title').textContent=String(alert.title||'PON WARDOGS EN PRIMER PLANO').slice(0,160);$('focus-detail').textContent=String(alert.detail||'Vuelve a Wardogs para continuar.').slice(0,400);}
  $('focus-channel').textContent=supported?'Avisos de FarmDogs activos aunque la app esté minimizada.':bridge?'Vuelve a abrir FarmDogs para cargar los avisos con sonido.':'Para recibir el aviso fuera del navegador, abre FarmDogs.exe.';
 }
 window.addEventListener('farmdogs-state',event=>{state=event.detail||null;stateAt=clock();render();});
 if(bridge){bridge.addEventListener('message',event=>{const message=event.data;if(message?.kind!=='host_foreground_status'||message.supported!==true)return;supported=true;native=message;nativeAt=clock();if(typeof message.soundEnabled==='boolean'&&(!pendingPreference||message.soundEnabled===pendingPreference.value||clock()-pendingPreference.at>3000)){sound=message.soundEnabled;pendingPreference=null;$('focus-sound').checked=sound;savePreference();}if(message.known===true&&message.gameForeground===true)previewUntil=0;render();});post('host_focus_ready');}
 $('focus-sound').addEventListener('change',()=>{sound=$('focus-sound').checked;pendingPreference={value:sound,at:clock()};savePreference();post('host_focus_preferences',{soundEnabled:sound});audioReady();render();});
 $('focus-preview').addEventListener('click',()=>{audioReady();previewUntil=clock()+3000;if(bridge)post('host_focus_preview');else beep();render();});
 document.addEventListener('pointerdown',audioReady,{once:true,capture:true});
 render();setInterval(render,200);
})();
