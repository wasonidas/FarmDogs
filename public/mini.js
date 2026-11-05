'use strict';
const $=id=>document.getElementById(id);
const active=new Set(['scheduled','watching','threshold_candidate','target_candidate','unknown_source','requires_review','rule_unknown','time_candidate']);
const time=new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit',second:'2-digit'});
const date=new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const at=v=>v&&Number.isFinite(Date.parse(v))?time.format(new Date(v)):'—';
const when=v=>v&&Number.isFinite(Date.parse(v))?date.format(new Date(v)):'—';
let state=null,selected=null,busy=false,polling=false,settingsInitialized=false,rewardSettingsInitialized=false,manualConfirmedServer=null,clickerSettingsInitialized=false,pendingClickerDraft=null,breakSettingsInitialized=false,entryTeamInitialized=false,updateRequestPending=false,mutationEpoch=0;
let desktopEntryFocusSupported=false,desktopEntryFocusId=null,desktopEntryFocusIntent=null,noticeKind=null;
let deferredEntryFocusSupported=false,deferredEntryFocusIntent=null,accountStateRefreshQueued=false;
let seedTeamInitialized=false,breakWasRunning=false,seedMode='manual',maximumDurationInitialized=false,displayedActivityId=null,maximumNormalThreshold=null,maximumThresholdNotice='';
let hostViewVisible=true,pollTimer=null;
let workspacePlayDuration=null,workspaceMouseDraft=null;
function sessionLimit(endAt,now){const end=Date.parse(endAt),current=Date.parse(now);if(!Number.isFinite(end))return 'Límite de sesión sin comprobar.';if(!Number.isFinite(current))return `Fin de la sesión: ${at(endAt)}.`;const seconds=Math.max(0,Math.ceil((end-current)/1000));return `Quedan ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} · fin ${at(endAt)}.`;}
const autoActive=s=>s&&!['cancelled','expired','error','interrupted'].includes(s.status);
const entryRunning=s=>s&&!['completed','cancelled','expired','error','interrupted'].includes(s.status);
const isBreak=s=>s?.purpose==='break';
const breakActive=s=>isBreak(s)&&autoActive(s);
const activityRunning=s=>['watching','launching'].includes(s?.status);
const autoLabels={waiting:'Preparado',waiting_controller:'Preparando controlador',waiting_source:'Esperando datos',waiting_presence:'Esperando tu cuenta',waiting_match:'Esperando inicio',waiting_game:'Esperando juego',starting_movement:'Activando',moving:'En marcha',paused_mouse:'Pausado · estás usando el ratón',cancelled:'Detenido',expired:'Tiempo terminado',error:'Revisar sesión',interrupted:'Interrumpido'};
const serverLabels={seeding_inactive:'Seeding desactivado',rule_unknown:'Regla del VIP sin comprobar',entry_candidate:'Oportunidad para seedear',above_entry_threshold:'Umbral de entrada superado'};
function toolReason(key,fallback){const reason=state?.localTools?.diagnostics?.[key]?.reason;return typeof reason==='string'&&reason?reason:fallback;}
function notice(message,kind=null){noticeKind=kind;$('notice-text').textContent=message;$('notice').hidden=false;}
function clearInitialFocusNotice(){if(noticeKind==='initial_focus'){$('notice').hidden=true;noticeKind=null;}}
function initialFocusNoticeNeeded(){const intent=desktopEntryFocusIntent;if(!intent||intent.id!==desktopEntryFocusId||intent.finished)return false;if(intent.pending)return true;const entry=state?.entry;return entry?.id===intent.sessionId&&!entry.operatorStopped&&['opening','waiting_game'].includes(entry.status);}
function syncInitialFocusNotice(){const intent=desktopEntryFocusIntent;if(intent&&!intent.pending&&!initialFocusNoticeNeeded())intent.finished=true;if(!initialFocusNoticeNeeded())clearInitialFocusNotice();}
function initialFocusStatus(message){
 const intent=desktopEntryFocusIntent;if(!intent||message.id!==intent.id||message.id!==desktopEntryFocusId||!['cancelled','refused'].includes(message.status)||typeof message.reason!=='string'||!message.reason)return;
 if(message.sessionId!=null&&message.sessionId!==intent.sessionId)return;
 if(!initialFocusNoticeNeeded())return;
 const key=JSON.stringify([message.id,message.status,message.reason]);if(intent.seen.has(key))return;intent.seen.add(key);notice(message.reason,'initial_focus');
}
function initialFocusForeground(message){if(message.supported!==true||message.known!==true||message.gameForeground!==true)return;if(desktopEntryFocusIntent)desktopEntryFocusIntent.finished=true;clearInitialFocusNotice();}
function publishState(value){if(typeof window.dispatchEvent==='function'&&typeof CustomEvent==='function')window.dispatchEvent(new CustomEvent('farmdogs-state',{detail:value}));}
function flushAccountStateRefresh(){if(!accountStateRefreshQueued||busy||polling)return;accountStateRefreshQueued=false;void poll();}
const tabNames=['enter','seed','team','vip'];
function showTab(name,focus=false){if(!tabNames.includes(name))return;for(const key of tabNames){const current=key===name;$('tab-'+key).setAttribute('aria-selected',String(current));$('tab-'+key).tabIndex=current?0:-1;$('panel-'+key).hidden=!current;}if(focus)$('tab-'+name).focus();}
for(const name of tabNames){$('tab-'+name).addEventListener('click',()=>showTab(name));$('tab-'+name).addEventListener('keydown',event=>{const index=tabNames.indexOf(name);let next;if(event.key==='ArrowRight')next=(index+1)%tabNames.length;else if(event.key==='ArrowLeft')next=(index+tabNames.length-1)%tabNames.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabNames.length-1;else return;event.preventDefault();showTab(tabNames[next],true);});}
for(const button of document.querySelectorAll('[data-go-tab]'))button.addEventListener('click',()=>showTab(button.dataset.goTab,true));
function setSeedMode(mode,{applyDefault=false}={}){
 if(!['manual','schedule','activity','maximum'].includes(mode))return;
 const idle=!entryRunning(state?.entry)&&!autoActive(state?.autoSeeding)&&!activityRunning(state?.activity)&&!['scheduled','launching'].includes(state?.opening?.status);
 if(applyDefault&&idle&&mode==='maximum'&&seedMode!=='maximum'){
  maximumNormalThreshold=$('auto-players').value;maximumThresholdNotice='';
  if(Number($('auto-players').value)<20){$('auto-players').value=20;maximumThresholdNotice=`El ajuste anterior de ${maximumNormalThreshold} jugador(es) se ha elevado a 20 para Sedeo máximo. Volverá a su valor anterior al salir de este modo.`;}
 }
 if(applyDefault&&idle&&mode!=='maximum'&&seedMode==='maximum'&&maximumNormalThreshold!==null&&Number(maximumNormalThreshold)<20){$('auto-players').value=maximumNormalThreshold;maximumNormalThreshold=null;maximumThresholdNotice='';}
 seedMode=mode;
 if(mode==='maximum'&&applyDefault&&!maximumDurationInitialized&&!entryRunning(state?.entry)&&!autoActive(state?.autoSeeding)&&!activityRunning(state?.activity)&&!['scheduled','launching'].includes(state?.opening?.status)){$('auto-duration').value=720;maximumDurationInitialized=true;}
 for(const other of document.querySelectorAll('[data-seed-mode]'))other.setAttribute('aria-pressed',String(other.dataset.seedMode===mode));
 for(const name of ['manual','schedule','activity','maximum'])$('seed-mode-'+name).hidden=name!==mode;
}
for(const button of document.querySelectorAll('[data-seed-mode]'))button.addEventListener('click',()=>{if(busy||button.disabled)return;setSeedMode(button.dataset.seedMode,{applyDefault:true});controls();});
function maximumOwnedEntry(){const job=state?.activity,origin=state?.entryOrigin,entry=state?.entry;return job?.strategy==='maximum'&&origin?.kind==='activity'&&origin.ownerId===job.id&&origin.entryId===entry?.id?entry:null;}
function maximumPreparedState(){
 if(state?.activity?.strategy!=='maximum'||state.activity.status!=='prepared')return null;
 const entry=maximumOwnedEntry(),session=state.autoSeeding,ownedSession=entry&&session?.purpose!=='break'&&session?.entryId===entry.id;
 if(entryRunning(entry))return {active:true,reason:`Entrada automática: ${entry.reason||'En curso.'}`};
 if(ownedSession&&autoActive(session))return {active:true,reason:session.reason||'Sesión de sedeo en curso.'};
 const child=ownedSession?session:entry,ended=child?.status==='expired';
 return {active:false,reason:`Sedeo máximo ${ended?'terminado':'detenido'}. ${child?.reason||'Su entrada y movimiento ya no están activos.'} No hay búsqueda activa.`};
}
function renderMaximumPlan(){
 const job=state?.activity,entry=maximumOwnedEntry(),session=state?.autoSeeding,ownedSession=entry&&session?.purpose!=='break'&&session?.entryId===entry.id;
 const liveJob=job?.strategy==='maximum'&&(activityRunning(job)||entryRunning(entry)||(ownedSession&&autoActive(session)));
 const end=liveJob?job.endAt:null,minutes=Number($('auto-duration').value),now=Date.parse(state?.now),validDuration=Number.isInteger(minutes)&&minutes>=1&&minutes<=720;
 const prepared=maximumPreparedState();
 $('maximum-plan').textContent=liveJob?`Sedeo máximo activo. ${sessionLimit(end,state?.now)} Hora de Madrid. El plazo incluye búsqueda, entrada y estancia.`:!state?'Sin conexión: no se puede comprobar una sesión ni iniciar otra.':prepared&&!prepared.active?prepared.reason:validDuration&&Number.isFinite(now)?`${minutes} min en total · fin previsto ${when(new Date(now+minutes*60000).toISOString())}, hora de Madrid. Puedes ajustar la duración antes de iniciar.`:'Elige una duración entre 1 y 720 minutos.';
 const maximum=seedMode==='maximum';$('auto-players-setting').hidden=false;$('auto-players').min=maximum?'20':'1';
 $('seed-threshold-help').textContent=maximum?`${maximumThresholdNotice?maximumThresholdNotice+' ':''}Puede entrar en un servidor vacío y sumar puntos durante el calentamiento. El movimiento espera el umbral configurado (mínimo 20 jugadores), HUD reciente y Wardogs delante. La población no confirma un premio.`:'El umbral de movimiento no determina cuándo ganas VIP.';
 $('maximum-help').textContent=!state?'Sin conexión con FarmDogs.':state.capabilities?.maximumSeeding!==true?'Actualiza FarmDogs para disponer del modo máximo y de su entrada automática.':'Suma puntos mensuales mientras ayudas a llenar. Un día VIP requiere completar las condiciones del servidor; mantiene el mismo servidor para conservar el ciclo. No gasta puntos ni cobra premios pendientes.';
}
$('notice-close').addEventListener('click',()=>{$('notice').hidden=true;noticeKind=null;});
const teamNames={blue:'azul',red:'rojo',green:'verde'};
const entryTeamNames={any:'aleatorio',...teamNames};
function selectedTeam(){return document.querySelector('input[name="clicker-team"]:checked')?.value||'blue';}
function entryTeam(){return Object.hasOwn(entryTeamNames,$('entry-team').value)?$('entry-team').value:selectedTeam();}
function seedingTeam(){return Object.hasOwn(entryTeamNames,$('seed-team').value)?$('seed-team').value:'any';}
function armDesktopEntryFocus(event,server){if(event?.isTrusted!==true||!desktopEntryFocusSupported||!window.chrome?.webview||typeof window.crypto?.randomUUID!=='function')return null;clearInitialFocusNotice();const id=window.crypto.randomUUID();desktopEntryFocusId=id;desktopEntryFocusIntent={id,sessionId:null,pending:true,finished:false,seen:new Set()};window.chrome.webview.postMessage({kind:'host_entry_focus_arm',id,server:server.number,joinId:server.joinId});return id;}
function bindDesktopEntryFocus(id,result){if(id&&desktopEntryFocusId===id&&entryRunning(result?.entry)){if(desktopEntryFocusIntent?.id===id){desktopEntryFocusIntent.pending=false;desktopEntryFocusIntent.sessionId=result.entry.id;syncInitialFocusNotice();}window.chrome.webview.postMessage({kind:'host_entry_focus_bind',id,sessionId:result.entry.id});}else if(id)cancelDesktopEntryFocus(id);}
function cancelDesktopEntryFocus(id=desktopEntryFocusId){if(!id)return;if(window.chrome?.webview)window.chrome.webview.postMessage({kind:'host_entry_focus_cancel',id});if(desktopEntryFocusId===id){desktopEntryFocusId=null;desktopEntryFocusIntent=null;clearInitialFocusNotice();}}
function stopDesktopEntryFromKey(){if(desktopEntryFocusId&&window.chrome?.webview)window.chrome.webview.postMessage({kind:'host_entry_focus_stop',id:desktopEntryFocusId});}
function clearDeferredFocusNotice(){if(noticeKind==='deferred_focus'){noticeKind=null;$('notice').hidden=true;}}
function armDeferredEntryFocus(event,jobKind,server){
 if(event?.isTrusted!==true||state?.capabilities?.deferredEntryFocus!==true||!deferredEntryFocusSupported||!window.chrome?.webview||typeof window.crypto?.randomUUID!=='function')return null;
 clearDeferredFocusNotice();const id=window.crypto.randomUUID();deferredEntryFocusIntent={id,jobKind,ownerId:null,pending:true,stopped:false,seen:new Set()};
 window.chrome.webview.postMessage({kind:'host_entry_focus_job_arm',id,jobKind,...(server?{server:server.number,joinId:server.joinId}:{})});return id;
}
function bindDeferredEntryFocus(id,jobKind,job){
 if(!id)return false;
 if(typeof job?.id!=='string'){cancelDeferredEntryFocus(id);return false;}
 const intent=deferredEntryFocusIntent?.id===id?deferredEntryFocusIntent:null;
 if(intent){intent.ownerId=job.id;intent.pending=false;syncDeferredFocusNotice();}
 // A late bind must reach the host so F8 pressed during the request can cancel this exact job.
 window.chrome?.webview?.postMessage({kind:'host_entry_focus_job_bind',id,jobKind,ownerId:job.id});
 return intent?.stopped===true;
}
function cancelDeferredEntryFocus(id=deferredEntryFocusIntent?.id){if(!id)return;window.chrome?.webview?.postMessage({kind:'host_entry_focus_job_cancel',id});if(deferredEntryFocusIntent?.id===id){deferredEntryFocusIntent=null;clearDeferredFocusNotice();}}
function stopDeferredEntryFromKey(){if(deferredEntryFocusIntent?.id&&window.chrome?.webview)window.chrome.webview.postMessage({kind:'host_entry_focus_job_stop',id:deferredEntryFocusIntent.id});}
function deferredFocusEntry(){const intent=deferredEntryFocusIntent,origin=state?.entryOrigin;return intent?.ownerId&&origin?.kind===intent.jobKind&&origin.ownerId===intent.ownerId&&origin.entryId===state?.entry?.id?state.entry:null;}
function deferredFocusForeground(msg){if(msg.supported===true&&msg.known===true&&msg.gameForeground===true&&deferredFocusEntry()){deferredEntryFocusIntent.finished=true;clearDeferredFocusNotice();}}
function syncDeferredFocusNotice(){const intent=deferredEntryFocusIntent;if(!intent||intent.pending)return;const job=intent.jobKind==='scheduled'?state?.opening:state?.activity,entry=deferredFocusEntry();if(job?.id!==intent.ownerId||(entry&&!['opening','waiting_game'].includes(entry.status))||(!entry&&['cancelled','expired','error','missed','interrupted','blocked'].includes(job?.status))){intent.finished=true;clearDeferredFocusNotice();}}
function deferredFocusStatus(msg){
 const intent=deferredEntryFocusIntent;if(!intent||intent.finished||msg.id!==intent.id||msg.jobKind!==intent.jobKind||(intent.ownerId&&msg.ownerId&&msg.ownerId!==intent.ownerId))return;
 if(msg.status==='stopped')intent.stopped=true;
 if(['focused','already_foreground'].includes(msg.status)){intent.finished=true;clearDeferredFocusNotice();return;}
 if(!['stopped','revoked','refused','expired'].includes(msg.status)||typeof msg.reason!=='string')return;
 const entry=deferredFocusEntry();if(msg.status!=='stopped'&&entry&&!['opening','waiting_game'].includes(entry.status))return;
 const key=msg.status+'\n'+msg.reason;if(intent.seen.has(key))return;intent.seen.add(key);notice(msg.reason,'deferred_focus');
}
function clickerBody(enabled=true){return {enabled,team:selectedTeam(),intervalMs:Number($('clicker-interval').value),startMode:'automatic'};}
function setClickerDraft(draft){const radio=document.querySelector(`input[name="clicker-team"][value="${Object.hasOwn(teamNames,draft.team)?draft.team:'blue'}"]`);if(radio)radio.checked=true;$('clicker-interval').value=draft.intervalMs;}
function clickerPaused(c){return c?.enabled===true&&(c.pausedForContext===true||c.userPause?.active===true)&&!c.stopping&&!c.error;}
function persistentTeamActive(p=state?.persistentTeam){return p?.enabled===true||p?.cleanupPending===true;}
function clickerControls(){const c=state?.teamClicker,p=state?.persistentTeam,repeating=persistentTeamActive(p),repeat=$('clicker-repeat').checked,stopping=c?.stopping===true||pendingClickerDraft!==null||p?.cleanupPending===true,conflict=entryRunning(state?.entry)||autoActive(state?.autoSeeding)||activityRunning(state?.activity)||['scheduled','launching'].includes(state?.opening?.status)||state?.movement?.armed===true||state?.movement?.busy===true;
 const repeatReady=state?.capabilities?.persistentTeam===true&&c?.persistentSelectionAvailable===true,persistentSourceReady=!!target(),unavailable=busy||stopping||!c?.available||c?.automaticSelectionAvailable!==true||conflict||repeating||c?.enabled===true||c?.active===true||c?.running===true;
 $('clicker-save').disabled=unavailable||(repeat&&(!repeatReady||!persistentSourceReady||active.has(state?.watch?.status)));$('clicker-save').textContent='Elegir ahora';$('clicker-next').hidden=!repeat;$('clicker-next').disabled=unavailable||!repeatReady||!persistentSourceReady||active.has(state?.watch?.status);$('clicker-stop').disabled=busy||(!repeating&&stopping)||(!repeating&&!c?.enabled&&!c?.active&&!c?.running);
 $('clicker-repeat').disabled=busy||stopping||repeating||c?.enabled===true||c?.active===true||c?.running===true||!repeatReady;$('clicker-repeat-options').hidden=!repeat;$('clicker-server').value=String(repeating?p.server:selected||state?.config?.selectedServer||1);$('clicker-server').disabled=busy||stopping||repeating||conflict||c?.enabled===true||c?.active===true||c?.running===true;
 $('clicker-repeat-help').textContent=!repeatReady?'Actualiza FarmDogs para repetir el equipo entre partidas.':repeating?`Preparado para el servidor #${p.server}. No cambia de servidor ni abre el juego.`:!persistentSourceReady?'Elige un servidor con datos recientes antes de activar la repetición.':'Usa el marcador y las rondas públicas para esperar entre partidas sin capturas. Elige el mismo servidor del juego; no abre Wardogs ni cambia de servidor.';
 for(const input of document.querySelectorAll('input[name="clicker-team"],#clicker-interval'))input.disabled=busy||stopping||repeating||entryRunning(state?.entry)||c?.active===true||c?.running===true;
 if(conflict&&!(clickerPaused(c)&&entryRunning(state?.entry)&&c.ownerId===state.entry.id))$('clicker-detail').textContent=entryRunning(state?.entry)?'La entrada automática elegirá el equipo que has indicado. Puedes detenerla en su tarjeta de progreso.':breakActive(state?.autoSeeding)?'Detén el anti-AFK antes de activar la espera de equipo.':'Detén la sesión de seeding antes de activar la espera de equipo.';
}
function breakSettings(){return {durationMinutes:Number($('break-duration').value),intervalSeconds:Number($('break-interval').value),holdMs:Number($('break-hold').value)};}
function entryAntiAfkReady(){return state?.capabilities?.automaticEntry===true&&state.capabilities.entryAntiAfk===true&&state.localTools?.automaticMovement===true;}
function validEntryAntiAfkSettings(value){return Number.isInteger(value.durationMinutes)&&value.durationMinutes>=1&&value.durationMinutes<=720&&Number.isInteger(value.intervalSeconds)&&value.intervalSeconds>=5&&value.intervalSeconds<=300&&Number.isInteger(value.holdMs)&&value.holdMs>=100&&value.holdMs<=2000;}
function entryAntiAfkControls(){
 const e=state?.entry,entering=entryRunning(e),ready=entryAntiAfkReady(),checkbox=$('entry-anti-afk'),clicker=state?.teamClicker;
 const locked=busy||!state||persistentTeamActive()||entering||autoActive(state?.autoSeeding)||activityRunning(state?.activity)||['scheduled','launching'].includes(state?.opening?.status)||active.has(state?.watch?.status)||clicker?.enabled===true||clicker?.active===true||clicker?.running===true||clicker?.stopping===true;
 if(entering)checkbox.checked=e.antiAfk===true;
 checkbox.disabled=locked||(!ready&&!checkbox.checked);
 const settings=entering&&e.antiAfk===true?e.antiAfkSettings:breakSettings(),valid=!!settings&&validEntryAntiAfkSettings(settings);
 $('entry-anti-afk-help').textContent=!state?'Sin conexión. No se puede preparar el anti-AFK.':!ready?state.capabilities?.entryAntiAfk!==true?'Actualiza FarmDogs para activar el anti-AFK desde la entrada.':toolReason('automaticMovement','El controlador de movimiento no está disponible.'):entering&&!checkbox.checked?'Esta entrada no tiene anti-AFK preparado.':checkbox.checked&&!valid?'Revisa duración, intervalo y paso en los ajustes de Anti-AFK.':checkbox.checked?`Al desplegar: ${settings.durationMinutes} min, pasos cada ${settings.intervalSeconds} s (${settings.holdMs} ms). La cola no consume ese tiempo. Manos vacías y Wardogs delante; sin Steam ni mínimo de jugadores.`:'Opcional: empieza al desplegarte con los ajustes de Anti-AFK. No requiere Steam ni un mínimo de jugadores.';
 if(checkbox.checked&&(!ready||!valid))$('play').disabled=true;
}
function breakControls(){
 const session=state?.autoSeeding,running=breakActive(session),otherSession=autoActive(session)&&!isBreak(session),clicker=state?.teamClicker;
 const conflict=persistentTeamActive()||entryRunning(state?.entry)||otherSession||activityRunning(state?.activity)||['scheduled','launching'].includes(state?.opening?.status)||active.has(state?.watch?.status)||clicker?.enabled===true||clicker?.active===true||clicker?.running===true||clicker?.stopping===true||(!running&&(state?.movement?.armed===true||state?.movement?.busy===true));
 $('break-start').disabled=busy||!state||running||conflict||state.capabilities?.standaloneMovement!==true||!state.localTools?.automaticMovement||!$('break-confirm').checked;
 $('break-stop').disabled=busy||!running;
 $('break-stop').hidden=!running;
 for(const id of ['break-duration','break-interval','break-hold','break-confirm','break-5','break-15','break-30'])$(id).disabled=busy||!state||running;
 for(const minutes of [5,15,30])$('break-'+minutes).setAttribute('aria-pressed',String(Number($('break-duration').value)===minutes));
 $('break-help').textContent=!state?'El servicio no responde. No se puede iniciar el movimiento.':state.capabilities?.standaloneMovement!==true?'Actualiza y vuelve a abrir FarmDogs Launcher para usar el anti-AFK independiente.':!state.localTools?.automaticMovement?toolReason('automaticMovement','El controlador de movimiento no está disponible. Reinstala el portable completo conservando data.'):running?'F8 o Detener cancelan. Mantén Wardogs delante; los menús o la pérdida de foco pausan los pasos.':conflict?'Detén el otro automatismo antes de iniciar una pausa anti-AFK.':!$('break-confirm').checked?'Confirma que estás desplegado y con las manos vacías. No necesita Steam, servidor seleccionado ni población mínima.':'Listo. Actívalo y vuelve a Wardogs; empezará cuando reconozca tu personaje desplegado.';
 entryAntiAfkControls();
}
function renderBreak(s){
 const session=isBreak(s?.autoSeeding)?s.autoSeeding:null,running=breakActive(session);
 if(session&&(!breakSettingsInitialized||running)){for(const [id,key]of [['break-duration','durationMinutes'],['break-interval','intervalSeconds'],['break-hold','holdMs']])$(id).value=session[key];breakSettingsInitialized=true;}
 const remaining=session?Date.parse(session.endAt)-Date.parse(s.now):NaN,seconds=Number.isFinite(remaining)?Math.max(0,Math.ceil(remaining/1000)):null;
 const timeLeft=seconds===null?'':` · quedan ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
 const observedGame=session?.screen?.status==='verified_capture'&&session.screen.gameForeground===true;
 const labels={moving:'Anti-AFK activo',starting_movement:'Activando',waiting_game:observedGame?'Esperando despliegue':session?.startedMovementAt?'Pausado · vuelve a Wardogs':'Vuelve a Wardogs',waiting_controller:'Preparando controlador',waiting:'Preparado',cancelled:'Detenido',expired:'Tiempo terminado',interrupted:'Interrumpido',error:'Revisar movimiento'};
 $('break-state').textContent=!s?'Sin conexión':session?labels[session.status]||autoLabels[session.status]||session.status:'Detenido';
 $('break-detail').textContent=!s?'No se puede comprobar la sesión.':session?running?`${session.status==='waiting_game'&&observedGame?'Esperando reconocer a tu personaje. Cierra los menús y deja las manos vacías.':session.reason}${timeLeft}`:`Última pausa: ${session.reason}`:'Movimiento temporal en tu partida actual, sin esperar jugadores ni conectar Steam.';
 if(running&&!breakWasRunning)$('break-options').open=true;breakWasRunning=!!running;
 $('break-card').dataset.active=String(!!running);breakControls();
}
function renderClicker(c){const p=state?.persistentTeam;if(persistentTeamActive(p)){setClickerDraft({team:p.team,intervalMs:p.intervalMs});$('clicker-repeat').checked=true;const labels={watching:'Preparado entre partidas',preparing:'Preparando selector',waiting_selector:'Esperando selector',selecting:'Intentando entrar',waiting_source:'Esperando web',waiting_cleanup:'Terminando intento',waiting_controller:'Esperando controlador',paused_controller:'Revisar controlador',paused_identity:'Revisar servidor',paused_error:'Revisar selector'};$('clicker-state').textContent=p.cleanupPending?'Terminando intento':labels[p.status]||p.status;$('clicker-detail').textContent=`Servidor #${p.server} · ${teamNames[p.team]||'equipo elegido'}. ${p.reason||'Repetición preparada.'}`;const end=p.selectorAcquired?p.selectionEndsAt:p.acquisitionEndsAt;$('clicker-limit').hidden=!end;$('clicker-limit').textContent=end?`${p.selectorAcquired?'Intentará entrar hasta':'Buscará el selector hasta'} ${at(end)}. Al entrar se apagan los clics y sigue preparado para la próxima partida.`:'';return;}
 if(p?.id&&!c?.enabled&&!c?.active&&!c?.running&&!c?.stopping){$('clicker-state').textContent='Desactivado';$('clicker-detail').textContent=p.reason||'Repetición de equipo desactivada.';$('clicker-limit').hidden=true;return;}
 if(c&&!clickerSettingsInitialized){setClickerDraft({team:c.team,intervalMs:Number.isInteger(c.intervalMs)?c.intervalMs:20});clickerSettingsInitialized=true;}
 if(c&&pendingClickerDraft&&!c.enabled&&!c.active&&!c.running&&!c.stopping){setClickerDraft(pendingClickerDraft);pendingClickerDraft=null;}
 const completed=c?.entryConfirmation?.status==='confirmed'||!!c?.completedAttemptId;
 const paused=!completed&&clickerPaused(c);
 const actualName=teamNames[c?.entryConfirmation?.actualTeam||c?.actualTeam];
 $('clicker-state').textContent=c?.stopping||pendingClickerDraft?'Deteniendo':!c?.available?'No disponible':c.automaticSelectionAvailable!==true?'Actualización necesaria':completed?'Equipo elegido':c.error?'Revisar selector':paused?'En pausa · volverá a continuar':c.running?'Intentando entrar':c.enabled||c.active||c.waitingAutomatic?'Esperando selector':'Desactivado';
 $('clicker-detail').textContent=c?.error?c.error:!c?.available?'La selección automática estará disponible al instalar su controlador.':c.automaticSelectionAvailable!==true?'Actualiza y vuelve a abrir FarmDogs Launcher para usar la selección automática.':completed?`Se ha leído DESPLEGANDO.${actualName?' Equipo '+actualName+'.':''} La selección automática se ha desactivado.`:paused?c.reason||'Vuelve a Wardogs; se reconocerá de nuevo el selector antes de continuar.':c.running?`Intentando entrar en el equipo ${actualName||entryTeamNames[c.team]||'elegido'}${Number.isInteger(c.count)?` · ${c.count} clics`:''}. Continuará hasta leer DESPLEGANDO.`:c.enabled||c.active||c.waitingAutomatic?`Esperando el selector para entrar en el equipo ${entryTeamNames[c.team]||'elegido'}. Entra al servidor y deja Wardogs en primer plano.`:c.reason||'Elige un color y pulsa Esperar equipo. Después entra al servidor desde Wardogs.';
 const waiting=!completed&&(c?.enabled||c?.running||c?.active||c?.waitingAutomatic);
 $('clicker-limit').hidden=!waiting;
 $('clicker-limit').textContent=!waiting?'':c.ownerId?`${sessionLimit(c.ownerEndAt,state?.now)} La disponibilidad del equipo no tiene un tiempo garantizado.`:'Este selector no tiene una duración máxima configurada. Espera hasta DESPLEGANDO o hasta que pulses Cancelar/F8; el equipo puede tardar en admitir jugadores.';
 clickerControls();
}
function target(){return state?.servers.find(s=>s.number===selected&&s.trusted&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s.joinId||''));}
function renderEntry(s){
 const e=s?.entry,entering=entryRunning(e),recovering=entering&&!!e.recovery,automatic=s?.capabilities?.automaticEntry===true;
 if(!entryTeamInitialized&&s?.teamClicker){$('entry-team').value=Object.hasOwn(teamNames,s.teamClicker.team)?s.teamClicker.team:'blue';entryTeamInitialized=true;}
 if(!seedTeamInitialized){$('seed-team').value='any';seedTeamInitialized=true;}
 const queuedTeam=entering&&e.seeding?e.team:['scheduled','launching'].includes(s?.opening?.status)?s.opening.team:activityRunning(s?.activity)?s.activity.team:null;
 if(Object.hasOwn(entryTeamNames,queuedTeam))$('seed-team').value=queuedTeam;
 if(entering)$('entry-team').value=e.team;
 $('play').textContent=automatic?'DESPLEGAR EN SERVIDOR':'Abrir Wardogs y copiar ID';
 $('entry-intro').textContent=automatic?'Abre Wardogs, entra al servidor y elige equipo automáticamente.':'Abre Wardogs y lleva el ID preparado para completar la entrada en el juego.';
 $('entry-help').textContent=automatic?'F8 o Detener cancelan. El anti-AFK es opcional al entrar.':'El controlador de entrada automática no está instalado. Copia el ID y completa tú la entrada y el despliegue.';
 $('entry-guide').hidden=!automatic;
 $('schedule-help').textContent=automatic?'A la hora elegida completará la entrada y elegirá tu equipo. Necesita el PC despierto, Steam conectado y Wardogs en primer plano.':'Necesita el PC despierto y la app abierta. Abre el juego a esa hora; la entrada al servidor sigue asistida.';
 $('activity-help').textContent=automatic?'Funciona con la web, sin Discord. Entra al servidor elegido y prepara el movimiento automáticamente.':'Funciona con la web, sin Discord. Completa tú la entrada y el despliegue cuando abra el juego.';
 $('entry-progress').hidden=!e;
 $('entry-progress').dataset.active=String(entering);
 $('entry-guidance').hidden=!entering;
 $('entry-wait-limit').hidden=!entering||!['joining','choosing_team'].includes(e?.status);
 $('entry-wait-limit').textContent=!entering?'':`${sessionLimit(e.endAt,s.now)} ${e.status==='choosing_team'?'Seguirá intentando entrar en tu equipo aunque esté apagado. No se puede predecir cuándo permitirá entrar.':'La cola del servidor puede tardar; la espera cuenta dentro de este plazo.'}`;
 if(!e)return;
 const labels={opening:'Abriendo juego',recovering_source:'Esperando al servidor',waiting_game:'Esperando Wardogs',navigating:'Buscando servidor',joining:'Entrando al servidor',choosing_team:'Eligiendo equipo',deploying:'Esperando despliegue',starting_seeding:e.antiAfk===true?'Preparando anti-AFK':'Preparando seeding',completed:'Entrada completada',cancelled:'Detenido',expired:'Tiempo terminado',interrupted:'Interrumpido',error:'Revisar entrada'};
 $('entry-progress-server').textContent=`· #${e.server}${recovering?' · Reconexión':''}`;$('entry-progress-state').textContent=labels[e.status]||e.status;
 $('entry-progress-detail').textContent=`${e.reason}${entering?' · fin '+at(e.endAt):''}`;
 const stage={opening:0,recovering_source:1,waiting_game:0,navigating:1,joining:1,choosing_team:2,deploying:3,starting_seeding:3,completed:4}[e.status];
 for(const [index,key]of ['game','server','team','hud'].entries())$('entry-stage-'+key).dataset.state=stage===undefined?'idle':index<stage?'done':index===stage?'current':'idle';
 $('entry-stop').disabled=busy||!entering;
}
function updateControls(){
 const u=state?.update,working=!!u?.busy||updateRequestPending||persistentTeamActive(),installing=u?.status==='installing';
 $('update-check').disabled=busy||working||!u||installing;
 $('update-install').disabled=busy||working||!u?.available||u.installBlocked===true||installing;
 $('update-enabled').disabled=busy||installing||!u;
}
function renderUpdate(s){
 const u=s?.update;$('update-version').textContent=u?.currentVersion?'v'+u.currentVersion:s?.version?'v'+s.version:'';
 $('update-status').textContent=!u?'La actualización automática estará disponible al instalar la versión nueva de FarmDogs Launcher.':`${u.reason}${u.status==='downloading'&&u.totalBytes?` · ${Math.min(100,Math.floor(u.downloadedBytes/u.totalBytes*100))}%`:''}${u.available&&u.installBlocked?' '+u.installBlockedReason:''}`;
 if(u)$('update-enabled').checked=u.enabled===true;updateControls();
}
function controls(){
 const entering=entryRunning(state?.entry),repeating=persistentTeamActive(),fullEntry=state?.capabilities?.automaticEntry===true,planned=['scheduled','launching'].includes(state?.opening?.status),running=autoActive(state?.autoSeeding),detecting=activityRunning(state?.activity),clickerEnabled=repeating||state?.teamClicker?.enabled===true||state?.teamClicker?.active===true||state?.teamClicker?.running===true||state?.teamClicker?.stopping===true,plannedSeeding=planned&&!!state?.opening?.seeding,locked=repeating||active.has(state?.watch?.status)||planned||running||detecting||entering;
 for(let i=1;i<=5;i++)$('server-'+i).disabled=busy||!state||locked;
 $('diagnostic-select').disabled=busy||!state||locked;$('play').disabled=busy||repeating||entering||planned||detecting||breakActive(state?.autoSeeding)||(fullEntry&&(running||clickerEnabled||state?.movement?.armed===true||state?.movement?.busy===true))||!state?.localTools?.game||!target();$('adjust').disabled=busy||repeating||entering||breakActive(state?.autoSeeding)||!state?.localTools?.movement;
 $('entry-team').disabled=busy||locked||clickerEnabled||!state;$('entry-stop').disabled=busy||!entering;
 $('seed-team').disabled=busy||locked||clickerEnabled||!state||$('manual-presence').checked;
 $('schedule').disabled=busy||entering||planned||running||detecting||clickerEnabled||!state?.localTools?.game||!target()||($('prepare-seeding').checked&&(!state?.localTools?.automaticMovement||target()?.seedingActive!==true));
 for(const id of ['opening-at','only-eligible','prepare-seeding'])$(id).disabled=busy||entering||planned||running||detecting||!state;
 $('schedule').textContent=$('prepare-seeding').checked?'Programar seeding':'Programar apertura';
 if($('manual-presence').checked&&manualConfirmedServer!==selected){$('manual-presence').checked=false;manualConfirmedServer=null;}
 const manual=$('manual-presence').checked&&manualConfirmedServer===selected,continuing=state?.seedingContinuity?.[selected]===true;
 $('manual-presence').disabled=busy||entering||planned||running||detecting||!state;
 $('manual-presence-label').textContent=`Ya estoy desplegado en el #${selected||'…'}`;
 $('auto-start').textContent=manual?'Activar movimiento':continuing?'Continuar seeding':fullEntry?'Entrar y seedear':'Iniciar seeding';
 $('cancel-opening').disabled=busy||state?.opening?.status!=='scheduled';$('auto-start').disabled=busy||entering||planned||running||detecting||clickerEnabled||!state?.localTools?.automaticMovement||!target()||(!manual&&target()?.seedingActive!==true&&!continuing);
 $('auto-start-help').textContent=entering?'La entrada automática está en marcha. Puedes seguir sus pasos en la tarjeta superior.':clickerEnabled?'Cancela la espera en Elegir equipo para iniciar seeding.':breakActive(state?.autoSeeding)?'El anti-AFK para tu pausa está activo. Puedes detenerlo en la tarjeta superior.':running?'La sesión ya está preparada. Vuelve al juego para que pueda reconocer tu personaje.':planned?'Tienes una entrada programada. Cancélala antes de iniciar otra.':detecting?'La búsqueda de servidor está activa.':!state?.localTools?.automaticMovement?toolReason('automaticMovement','El controlador de movimiento no está disponible. Reinstala el portable completo conservando data.'):!target()?'Elige un servidor con datos recientes en Entrar.':manual?'Activa la sesión y vuelve a Wardogs. No necesitas iniciar sesión en Steam.':continuing?'Tu cuenta confirma un ciclo en curso. Puedes continuar aunque el servidor ya no admita nuevos seeders.':target()?.seedingActive!==true?'Este servidor no admite nuevos seeders. Si ya estás desplegado, confirma la casilla para probar solo el movimiento.':fullEntry?`Entrará al servidor, elegirá el equipo ${entryTeamNames[seedingTeam()]} y preparará el movimiento. No requiere conectar Steam a la app; sí tener Steam y el juego conectados.`:'Abre el juego y prepara el movimiento. Completa tú la entrada y el despliegue.';
 $('auto-stop').disabled=busy||(!entering&&!(running&&!isBreak(state?.autoSeeding))&&!plannedSeeding&&!detecting);for(const id of ['auto-duration','auto-players','auto-interval','auto-hold','activity-min','activity-max'])$(id).disabled=busy||entering||running||planned||detecting||!state;
 $('activity-start').disabled=busy||entering||planned||running||detecting||clickerEnabled||active.has(state?.watch?.status)||!state?.localTools?.automaticMovement||!state?.localTools?.game;
 $('activity-stop').disabled=busy||!detecting;
 $('maximum-start').disabled=$('activity-start').disabled||state?.capabilities?.maximumSeeding!==true||!Number.isInteger(Number($('auto-players').value))||Number($('auto-players').value)<20||Number($('auto-players').value)>100;
 const maximumEntry=maximumOwnedEntry(),maximumSession=maximumEntry&&state?.autoSeeding?.purpose!=='break'&&state?.autoSeeding?.entryId===maximumEntry.id&&running;
 $('maximum-stop').disabled=busy||!(state?.activity?.strategy==='maximum'&&detecting||entryRunning(maximumEntry)||maximumSession);
 $('reward-save').disabled=busy||!state?.rewards;$('reward-enabled').disabled=busy||!state?.rewards;$('reward-lead').disabled=busy||!state?.rewards;
 clickerControls();breakControls();
 const anyReady=state?.teamClicker?.automaticAnyTeamAvailable===true,seedAnyBlocked=fullEntry&&seedingTeam()==='any'&&!anyReady;
 $('seed-team-help').textContent=seedAnyBlocked?'Actualiza el selector para usar Aleatorio o elige azul, rojo o verde.':'Aleatorio busca entrar antes. Elige un color si quieres coincidir con tu clan. No cambia tu equipo si ya estás desplegado.';
 if(seedAnyBlocked){$('schedule').disabled=true;$('activity-start').disabled=true;$('maximum-start').disabled=true;if(!manual&&!continuing){$('auto-start').disabled=true;$('auto-start-help').textContent='Elige un color o actualiza el selector para entrar en el primer equipo disponible.';}}
 if(fullEntry&&entryTeam()==='any'&&!anyReady){$('play').disabled=true;$('entry-help').textContent='Actualiza el selector para usar Aleatorio o elige un color.';}
 updateControls();
 if(state?.update?.status==='installing'){
   for(const id of ['play','entry-team','entry-anti-afk','seed-team','auto-start','schedule','activity-start','maximum-start','break-start','clicker-save','clicker-next','clicker-repeat','clicker-server','adjust','manual-presence','connect-account','reward-save'])$(id).disabled=true;
  for(let i=1;i<=5;i++)$('server-'+i).disabled=true;
 }
 renderMaximumPlan();
 flushAccountStateRefresh();
}
function movementSettings(){return {durationMinutes:Number($('auto-duration').value),startPlayers:Number($('auto-players').value),intervalSeconds:Number($('auto-interval').value),holdMs:Number($('auto-hold').value)};}
function validMovementSettings(){return ['auto-duration','auto-players','auto-interval','auto-hold'].every(id=>$(id).reportValidity());}
function renderServerClan(row,presence,server){
 const indicator=row.querySelector('.clan-presence'),label=row.querySelector('.clan-label');
 const observed=presence?.servers?.[String(server?.number)],count=observed?.reportedCount;
 const countKnown=Number.isSafeInteger(count)&&count>=0,serverKnown=server?.trusted===true&&server?.online===true;
 const present=presence?.status==='ready'&&serverKnown&&observed?.status==='present'&&countKnown&&count>0;
 const empty=presence?.status==='ready'&&serverKnown&&observed?.status==='empty'&&count===0;
 const states={login_required:'Conecta Steam para ver tu clan',no_clan:'Sin clan vinculado',loading:'Consultando tu clan…',stale:'Clan · lectura caducada',unavailable:'Clan · sin datos'};
 let detail=states[presence?.status]||'Clan · sin comprobar';
 if(present||empty)detail=`Miembros del clan · ${count}`;
 else if(presence?.status==='ready'&&!serverKnown)detail='Clan · servidor sin confirmar';
 else if(presence?.status==='ready'&&observed?.status==='stale')detail='Clan · lectura caducada';
 indicator.dataset.state=present?'present':empty?'empty':'unknown';label.textContent=detail;
 const clan=presence?.clan,tag=typeof clan?.tag==='string'?clan.tag.trim().slice(0,24):'',name=typeof clan?.name==='string'?clan.name.trim().slice(0,120):'';
 const title=[tag?`[${tag}]`:'',name].filter(Boolean).join(' '),parts=[title,detail].filter(Boolean);
 if(present||empty){
  const n=value=>Number.isSafeInteger(value)&&value>=0?value:'—',teams=observed.teams;
  parts.push(`Azul ${n(teams?.blue)} / Rojo ${n(teams?.red)} / Verde ${n(teams?.green)}`);
  if(Number.isSafeInteger(teams?.unassigned)&&teams.unassigned>0)parts.push(`Sin facción ${teams.unassigned}`);
 }
 parts.push('La web se actualiza cada minuto; puedes estar incluido.');
 indicator.title=parts.join(' · ');indicator.setAttribute('aria-label',indicator.title);
}
function render(s){
 state=s;syncInitialFocusNotice();syncDeferredFocusNotice();if(entryRunning(s.entry))selected=s.entry.server;else if(persistentTeamActive(s.persistentTeam))selected=s.persistentTeam.server;else if(autoActive(s.autoSeeding)&&!isBreak(s.autoSeeding))selected=s.autoSeeding.server;else if(['scheduled','launching'].includes(s.opening?.status))selected=s.opening.server;else if(selected===null)selected=s.config.selectedServer;
 $('health').textContent=s.source.error?'Fuente con error':s.servers.some(v=>v.trusted)?'Datos recientes':'Sin confirmar';
 $('source').textContent=`Consulta ${at(s.source.lastSuccessAt)}`;
 for(let number=1;number<=5;number++)renderServerClan($('server-'+number),s.clanPresence,s.servers.find(server=>server.number===number));
 for(const server of s.servers){const row=$('server-'+server.number);row.setAttribute('aria-pressed',String(selected===server.number));row.querySelector('.map').textContent=server.map||'Mapa sin confirmar';row.querySelector('.players').textContent=server.trusted?`${server.players} / ${server.capacity}`:'—';row.querySelector('.status').textContent=s.seedingContinuity?.[server.number]===true?'Tu ciclo sigue en curso; nuevas entradas cerradas':serverLabels[server.status]||server.message||'Sin confirmar';}
 const detecting=activityRunning(s.activity),ownedMaximumEntry=maximumOwnedEntry(),maximumRunning=entryRunning(ownedMaximumEntry)||(ownedMaximumEntry&&s.autoSeeding?.purpose!=='break'&&s.autoSeeding?.entryId===ownedMaximumEntry.id&&autoActive(s.autoSeeding));
 if((detecting||maximumRunning)&&s.activity.id!==displayedActivityId){displayedActivityId=s.activity.id;setSeedMode(s.activity.strategy==='maximum'?'maximum':'activity');if(s.activity.strategy==='maximum')maximumDurationInitialized=true;}
 $('entry-title').textContent=detecting&&!s.activity.selectedServer?'Elección automática':`Servidor #${selected}`;$('seed-destination').textContent=detecting&&!s.activity.selectedServer?'Elección automática':`Servidor #${selected}`;$('join-id').value=detecting&&!s.activity.selectedServer?'Se elegirá al detectar actividad':target()?.joinId||'Sin ID reciente confirmado';
 const a=s.account;
 $('vip').textContent=a.vipFresh&&a.vip?.comprobado?(a.vip.permanente||a.vip.sinCaducidad?'VIP permanente':a.vip.tiene?'VIP activo':'Sin VIP activo'):'Sin lectura reciente';
 $('vip-detail').textContent=a.vip?.caduca?`${a.vipFresh?'Caduca':'Último dato'}: ${when(a.vip.caduca)}${a.vipFresh?'':' · sin confirmar'}`:'Consulta tu cuenta para comprobarlo.';
 $('seeding').textContent=a.seedingFresh?(a.seeding.servidor?`#${a.seeding.servidor} · ${a.seeding.estado}`:'Fuera de seeding'):'Sin comprobar';
 $('condition').textContent=a.seedingFresh&&a.condition?(a.condition.mode==='timed'?`${a.condition.reason} Fecha: ${when(a.condition.deadline)}.`:a.condition.reason):'La presencia requiere una lectura reciente de tu cuenta.';
 const m=s.movement;
 $('movement-state').textContent=!m?.available?'Sin lectura':m.error?'Detenido por error':m.armed?'En marcha':'Detenido';
 $('movement-detail').textContent=m?.available?`${m.reason||'Preparado'} · ${m.autoSessionId&&m.autoCount!==null?m.autoCount:m.count} pulsaciones${m.armed?' · fin '+at(m.endUtc):''}`:m?.reason||'Abre el controlador para consultar su estado.';
 const j=s.opening;$('opening-status').textContent=j?`Horario #${j.server} · ${when(j.scheduledAt)} · ${j.reason}`:'Sin horario pendiente.';$('opening-status').hidden=!j;
 const aSession=isBreak(s.autoSeeding)?null:s.autoSeeding,planned=['scheduled','launching'].includes(j?.status),plannedSeeding=planned&&j.seeding;
 $('auto-status').textContent=!s.localTools?.automaticMovement?'No disponible':plannedSeeding?'Programado':aSession?autoLabels[aSession.status]||aSession.status:'Detenido';$('auto-detail').textContent=!s.localTools?.automaticMovement?toolReason('automaticMovement','El controlador de movimiento no está disponible. Reinstala el portable completo conservando data.'):plannedSeeding?`Preparará la sesión el ${when(j.scheduledAt)}. La duración empieza a esa hora.`:aSession?autoActive(aSession)?`${aSession.reason} · fin ${at(aSession.endAt)}`:`Sesión anterior: ${aSession.reason}`:s.localTools?.automaticMovement?'Al iniciar, esperará población y tu personaje desplegado.':'El controlador de movimiento no está disponible.';
 const displayedSettings=entryRunning(s.entry)?s.entry:detecting?{durationMinutes:s.activity.durationMinutes,...s.activity.seeding}:plannedSeeding||(aSession&&(!settingsInitialized||autoActive(aSession))?aSession:null);
 if(displayedSettings){for(const [id,key]of [['auto-duration','durationMinutes'],['auto-players','startPlayers'],['auto-interval','intervalSeconds'],['auto-hold','holdMs']])$(id).value=displayedSettings[key];}if(planned)$('prepare-seeding').checked=!!j.seeding;settingsInitialized=true;
 const activityFinished=['expired','cancelled','error','interrupted'].includes(s.activity?.status),activityTime=activityFinished&&s.activity?.finishedAt?s.activity.finishedAt:s.activity?.endAt;
 $('activity-state').textContent=s.activity?`${s.activity.reason} · ${activityFinished&&s.activity.finishedAt?'Terminó':activityFinished?'Límite previsto':'Fin'} ${when(activityTime)}, hora de Madrid${s.activity.status==='expired'?'. La búsqueda está detenida aunque la app siga abierta.':''}`:'Sin búsqueda activa.';$('activity-state').hidden=!s.activity;
 const maximumPrepared=maximumPreparedState();if(maximumPrepared)$('activity-state').textContent=maximumPrepared.active?`${maximumPrepared.reason} · fin ${when(s.activity.endAt)}, hora de Madrid.`:maximumPrepared.reason;
 if(detecting){if(s.activity.strategy!=='maximum'){$('activity-min').value=s.activity.minPlayers;$('activity-max').value=s.activity.maxEntryPlayers;}if(!autoActive(aSession)){$('auto-status').textContent=s.activity.strategy==='maximum'?'Sedeo máximo':'Vigilando';$('auto-detail').textContent=s.activity.strategy==='maximum'?`${s.activity.reason} ${sessionLimit(s.activity.endAt,s.now)}`:'Esperando actividad pública para elegir servidor.';}}
 if(s.activity?.strategy==='maximum'&&s.activity.status==='expired'&&!entryRunning(s.entry)&&!autoActive(aSession)){$('auto-status').textContent='Tiempo terminado';$('auto-detail').textContent=`Sedeo máximo terminó el ${when(s.activity.endAt)}, hora de Madrid. No está buscando servidores. Inicia una sesión nueva para continuar.`;}
 const rewards=s.rewards;
 if(rewards&&!rewardSettingsInitialized){$('reward-enabled').checked=rewards.enabled;$('reward-lead').value=rewards.leadMinutes;rewardSettingsInitialized=true;}
 if(!rewards)$('reward-status').textContent='Lector de premios sin actualizar.';
 else if(!rewards.source.fresh)$('reward-status').textContent='Conecta Steam para renovar los premios. No se cobrará con una lectura antigua.';
 else if(rewards.ownerConfigured&&!rewards.source.accountMatch)$('reward-status').textContent='La cuenta conectada no coincide con la cuenta protegida.';
 else{const pending=rewards.pending||[],dated=pending.filter(p=>p.deadline).sort((a,b)=>Date.parse(a.deadline)-Date.parse(b.deadline)),days=pending.reduce((total,p)=>total+p.dias,0);$('reward-status').textContent=dated.length?`${days} día(s) pendiente(s). Primer límite: ${when(dated[0].deadline)}; margen ${rewards.leadMinutes} min.`:days?`${days} día(s) pendiente(s) de esta semana. Se espera a que Wardogs publique el plazo final tras el cambio de semana.`:'No hay premios pendientes de cobrar.';}
 if(rewards?.storageError)$('reward-status').textContent='Protección detenida: no se pudo guardar el diario de premios.';
 else if(rewards?.attempts?.length){const last=rewards.attempts.at(-1);if(['uncertain','error','skipped'].includes(last.status))$('reward-status').textContent+=' El último intento necesita revisión; no se repetirá automáticamente.';else if(['success','already_claimed'].includes(last.status))$('reward-status').textContent+=` Último premio confirmado como cobrado: ${when(last.finishedAt)}.`;}
 const d=s.diagnostics?.[selected];$('diagnostic-title').textContent=d?.title||'Estado de sesión sin comprobar';$('diagnostic-detail').textContent=(d?.detail||'Esperando una lectura del servicio.')+(d?.screenEvidence?` Captura del juego: ${when(d.screenEvidence.capturedAt)}.`:'');$('diagnostic-panel').dataset.severity=d?.severity||'info';$('diagnostic-select').hidden=!['prepare_entry','review_server'].includes(d?.action?.kind);$('diagnostic-select').textContent=`Seleccionar #${d?.action?.server||selected}`;
 if(d?.action?.kind==='review_game'&&autoActive(aSession)){$('auto-status').textContent='Revisar juego';$('auto-detail').textContent=`${d.title} · captura ${at(d.screenEvidence?.capturedAt)}. ${aSession.reason}`;}
 if(breakActive(s.autoSeeding)){$('auto-status').textContent='Anti-AFK en uso';$('auto-detail').textContent='La pausa anti-AFK se controla en la tarjeta superior. Detén esa pausa antes de iniciar seeding.';}
 if(entryRunning(s.entry)){$('auto-status').textContent=s.entry.recovery?'Recuperando seeding':'Entrada automática';$('auto-detail').textContent=s.entry.reason;}
 renderBreak(s);renderClicker(s.teamClicker);renderEntry(s);renderUpdate(s);controls();
 publishState(s);
}
async function post(route,body){if(workspaceMouseDraft&&['/api/entry/start','/api/seeding/start','/api/movement/start','/api/persistent-team/start','/api/team-clicker/config','/api/opening/schedule','/api/activity/start'].includes(route)){body={...body,mousePause:{...workspaceMouseDraft}};if(body.seeding&&typeof body.seeding==='object')body.seeding={...body.seeding,mousePause:{...workspaceMouseDraft}};}if(!state)throw Error('El servicio no responde.');if(route.endsWith('/stop'))cancelDesktopEntryFocus();mutationEpoch++;try{const r=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':state.token},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||'No se pudo completar.');render(data);return data;}finally{mutationEpoch++;schedulePoll();}}
for(const minutes of [5,15,30])$('break-'+minutes).addEventListener('click',()=>{if(busy||breakActive(state?.autoSeeding))return;$('break-duration').value=minutes;controls();});
for(const id of ['break-duration','break-interval','break-hold'])$(id).addEventListener('input',controls);
$('break-confirm').addEventListener('change',breakControls);
$('break-start').addEventListener('click',async()=>{if(busy||$('break-start').disabled||!$('break-confirm').checked||!['break-duration','break-interval','break-hold'].every(id=>$(id).reportValidity()))return;busy=true;controls();try{await post('/api/movement/start',{...breakSettings(),confirmedDeployed:true});notice('Anti-AFK preparado para tu pausa. Vuelve a Wardogs con las manos vacías. F8 o Detener cancelan la sesión.');}catch(e){notice(e.message);}finally{busy=false;controls();}});
$('break-stop').addEventListener('click',async()=>{if(busy||$('break-stop').disabled)return;busy=true;controls();try{await post('/api/movement/stop',{});notice('Anti-AFK detenido. No volverá a moverse hasta que lo actives otra vez.');}catch(e){notice(e.message);}finally{busy=false;controls();}});
async function clickerDraftChanged(){const c=state?.teamClicker;if(persistentTeamActive()){setClickerDraft(state.persistentTeam);return;}if(!c?.enabled&&!c?.running&&!c?.stopping){clickerControls();return;}const draft={team:selectedTeam(),intervalMs:$('clicker-interval').value};pendingClickerDraft=draft;setClickerDraft(c);busy=true;$('clicker-state').textContent='Deteniendo';controls();try{await post('/api/team-clicker/stop',{});notice('Espera cancelada para cambiar los ajustes. Pulsa Elegir ahora para activar la nueva selección.');}catch(e){pendingClickerDraft=null;setClickerDraft(c);notice(e.message);}finally{busy=false;controls();}}
for(const radio of document.querySelectorAll('input[name="clicker-team"]'))radio.addEventListener('change',clickerDraftChanged);
$('clicker-interval').addEventListener('input',clickerDraftChanged);
async function startTeamSelection(startNow){if(busy||$(startNow?'clicker-save':'clicker-next').disabled||!$('clicker-interval').reportValidity())return;const repeat=$('clicker-repeat').checked,server=target();if(!startNow&&!repeat||repeat&&!server)return;busy=true;controls();try{if(repeat){await post('/api/persistent-team/start',{server:server.number,expectedJoinId:server.joinId,team:selectedTeam(),intervalMs:Number($('clicker-interval').value),startNow});notice(startNow?`Elegirá ${teamNames[selectedTeam()]} en el #${server.number} y seguirá preparado entre partidas. Deja Wardogs delante al elegir. F8 desactiva el modo completo.`:`Preparado para repetir ${teamNames[selectedTeam()]} en el #${server.number}. Puedes seguir jugando: espera una señal pública nueva, sin capturas mientras no haya un intento. F8 lo desactiva.`);}else{await post('/api/team-clicker/config',clickerBody());notice(`Esperando el equipo ${teamNames[selectedTeam()]}. Entra al servidor; al aparecer el selector intentará entrar y se desactivará al leer DESPLEGANDO.`);}}catch(e){notice(e.message);}finally{busy=false;controls();}}
$('clicker-save').addEventListener('click',()=>startTeamSelection(true));
$('clicker-next').addEventListener('click',()=>startTeamSelection(false));
$('clicker-repeat').addEventListener('change',clickerControls);
$('clicker-server').addEventListener('change',()=>{if(busy||persistentTeamActive())return;const number=Number($('clicker-server').value);if(Number.isInteger(number)&&number>=1&&number<=5){selected=number;render(state);}});
$('clicker-stop').addEventListener('click',async()=>{if(busy||$('clicker-stop').disabled)return;const p=state?.persistentTeam;busy=true;controls();try{await post(persistentTeamActive(p)?'/api/persistent-team/stop':'/api/team-clicker/stop',persistentTeamActive(p)?{expectedSessionId:p.id}:{});notice('Selección automática cancelada. La repetición queda desactivada hasta que la actives de nuevo.');}catch(e){notice(e.message);}finally{busy=false;controls();}});
for(let i=1;i<=5;i++)$('server-'+i).addEventListener('click',()=>{if(busy||!state)return;if(selected!==i){$('manual-presence').checked=false;manualConfirmedServer=null;}selected=i;render(state);});
 $('entry-anti-afk').addEventListener('change',controls);
$('entry-team').addEventListener('change',()=>{if(busy||entryRunning(state?.entry))return;if(Object.hasOwn(teamNames,entryTeam()))setClickerDraft({team:entryTeam(),intervalMs:Number($('clicker-interval').value)||20});controls();});
 $('seed-team').addEventListener('change',controls);
$('entry-stop').addEventListener('click',async()=>{if(busy||$('entry-stop').disabled)return;busy=true;controls();try{await post('/api/entry/stop',{expectedSessionId:state.entry.id});notice('Entrada automática detenida. No se volverá a intentar hasta que la actives.');}catch(e){notice(e.message);}finally{busy=false;controls();}});
$('update-enabled').addEventListener('change',async()=>{if(busy||$('update-enabled').disabled)return;busy=true;controls();try{await post('/api/update/config',{enabled:$('update-enabled').checked});}catch(e){notice(e.message);}finally{busy=false;controls();}});
$('update-check').addEventListener('click',async()=>{if(busy||$('update-check').disabled)return;updateRequestPending=true;updateControls();try{await post('/api/update/check',{});}catch(e){notice(e.message);}finally{updateRequestPending=false;controls();}});
$('update-install').addEventListener('click',async()=>{if(busy||$('update-install').disabled)return;busy=true;controls();try{await post('/api/update/install',{});notice('Actualización preparada. FarmDogs Launcher se cerrará y volverá a abrirse; se conservan tus datos.');}catch(e){notice(e.message);}finally{busy=false;controls();}});
$('diagnostic-select').addEventListener('click',()=>{if(busy||!state||$('diagnostic-select').disabled)return;const server=state.diagnostics?.[selected]?.action?.server;if(!Number.isInteger(server)||server<1||server>5)return;selected=server;render(state);notice(`Servidor #${server} seleccionado. Usa el botón de apertura para preparar la entrada.`);});
$('play').addEventListener('click',async event=>{if(busy||$('play').disabled)return;const antiAfk=$('entry-anti-afk').checked,antiAfkSettings=antiAfk?breakSettings():null;if(antiAfk&&(!entryAntiAfkReady()||!validEntryAntiAfkSettings(antiAfkSettings)||!['break-duration','break-interval','break-hold'].every(id=>$(id).reportValidity())))return;const server=target();if(!server)return;const automatic=state.capabilities?.automaticEntry===true,focusId=automatic?armDesktopEntryFocus(event,server):null;busy=true;controls();let copied=true;try{if(automatic){const result=await post('/api/entry/start',{server:server.number,expectedJoinId:server.joinId,team:entryTeam(),seeding:false,durationMinutes:Math.min(workspacePlayDuration??state.config.durationMinutes??120,720),...(antiAfk?{antiAfk:true,antiAfkSettings}:{}),...(focusId?{initialFocus:'desktop'}:{})});bindDesktopEntryFocus(focusId,result);notice(`Entrada automática al #${server.number} preparada, equipo ${entryTeamNames[entryTeam()]}.${antiAfk?result?.entry?.antiAfk===true?` Anti-AFK preparado para ${antiAfkSettings.durationMinutes} min tras confirmar el despliegue.`:' El servidor local no ha confirmado el anti-AFK; revisa el estado de la entrada.':''} Deja Wardogs en primer plano. F8 o Detener cancelan.`);}else{try{await navigator.clipboard.writeText(server.joinId);}catch{copied=false;}await post('/api/open/game',{server:server.number,expectedJoinId:server.joinId});notice(copied?`ID del #${server.number} copiado. Apertura de Wardogs solicitada; completa la entrada dentro del juego.`:`Apertura de Wardogs solicitada. No se pudo copiar el ID del #${server.number}; está visible en el campo para copiarlo manualmente.`);}}catch(e){cancelDesktopEntryFocus(focusId);notice(e.message);}finally{busy=false;controls();}});
$('adjust').addEventListener('click',async()=>{if(busy)return;busy=true;controls();try{await post('/api/open/movement',{});notice('Control de movimiento solicitado. Sus ajustes se abren en una ventana de Windows.');}catch(e){notice(e.message);}finally{busy=false;controls();}});
$('manual-presence').addEventListener('change',()=>{manualConfirmedServer=$('manual-presence').checked?selected:null;controls();});
$('auto-start').addEventListener('click',async event=>{if(busy||$('auto-start').disabled||!validMovementSettings())return;const server=target();if(!server)return;const manual=$('manual-presence').checked&&manualConfirmedServer===server.number,continuing=!manual&&state.seedingContinuity?.[server.number]===true,automatic=state.capabilities?.automaticEntry===true&&!manual&&!continuing,focusId=automatic?armDesktopEntryFocus(event,server):null;busy=true;controls();let copied=true;try{if(!manual&&!continuing&&!automatic){try{await navigator.clipboard.writeText(server.joinId);}catch{copied=false;}}const result=await post('/api/seeding/start',{server:server.number,expectedJoinId:server.joinId,...movementSettings(),team:seedingTeam(),...(manual?{presenceMode:'manual',confirmedServer:server.number}:{}),...(focusId?{initialFocus:'desktop'}:{})});bindDesktopEntryFocus(focusId,result);notice(manual?'Prueba sin Steam preparada. Vuelve al juego con manos vacías; espera población y HUD. La presencia la has confirmado tú y los premios quedan sin comprobar.':continuing?`Sesión preparada para continuar tu ciclo del #${server.number}. Vuelve al juego desplegado; esperará la población configurada y el HUD.`:automatic?`Entrará al #${server.number}, elegirá el equipo ${entryTeamNames[seedingTeam()]} y preparará el seeding. Deja Wardogs en primer plano; F8 o Detener cancelan.`:copied?'ID copiado y sesión preparada. Completa la entrada; el movimiento se activará automáticamente al comenzar.':'Sesión preparada. Copia el ID del campo para entrar; después el movimiento será automático.');}catch(e){cancelDesktopEntryFocus(focusId);notice(e.message);}finally{busy=false;controls();}});
$('auto-stop').addEventListener('click',async()=>{if(busy)return;const focusId=deferredEntryFocusIntent?.id;busy=true;controls();try{cancelDeferredEntryFocus(focusId);await post('/api/seeding/stop',{});notice('Sesión detenida. No volverá a iniciar movimiento hasta que pulses Iniciar seeding.');}catch(e){notice(e.message);}finally{busy=false;controls();}});
async function startActivity(event,maximum=false){
 if(busy||$(maximum?'maximum-start':'activity-start').disabled||!validMovementSettings()||(!maximum&&(!$('activity-min').reportValidity()||!$('activity-max').reportValidity())))return;
 const automatic=state.capabilities?.automaticEntry===true,focusId=automatic?armDeferredEntryFocus(event,'activity'):null,settings=movementSettings();
 busy=true;controls();
 try{
  const result=await post('/api/activity/start',{durationMinutes:settings.durationMinutes,...(maximum?{strategy:'maximum',minPlayers:0,maxEntryPlayers:99}:{minPlayers:Number($('activity-min').value),maxEntryPlayers:Number($('activity-max').value)}),team:seedingTeam(),seeding:settings,...(focusId?{initialFocus:'desktop'}:{})});
  const stopped=bindDeferredEntryFocus(focusId,'activity',result.activity);
  notice(stopped?'Vigilancia detenida con F8.':maximum?`Sedeo máximo preparado hasta ${when(result.activity?.endAt)}, hora de Madrid. Puede entrar en un servidor vacío y sumar puntos durante el calentamiento. El movimiento esperará ${settings.startPlayers} jugadores y el HUD del personaje. Mantiene el servidor para conservar el ciclo. Deja el PC despierto y Wardogs delante; F8 o Detener cancelan.`:automatic?'Vigilancia activada. Elegirá un servidor tras dos lecturas válidas, entrará y preparará el seeding. '+(focusId?'Deja el PC despierto. Puedes detener la búsqueda aquí; F8 cancela la entrada cuando comience.':'Deja Wardogs en primer plano cuando se abra. Usa Detener búsqueda para cancelar.')+'':'Vigilancia activada. Elegirá un servidor tras dos lecturas válidas; la entrada y el despliegue siguen asistidos.');
 }catch(e){cancelDeferredEntryFocus(focusId);notice(e.message);}finally{busy=false;controls();}
}
$('activity-start').addEventListener('click',event=>startActivity(event));
$('maximum-start').addEventListener('click',event=>startActivity(event,true));
async function stopActivity(){if(busy)return;const ownerId=state?.activity?.id,focusId=deferredEntryFocusIntent?.jobKind==='activity'&&deferredEntryFocusIntent.ownerId===ownerId?deferredEntryFocusIntent.id:null;busy=true;controls();try{cancelDeferredEntryFocus(focusId);await post('/api/activity/stop',ownerId&&state?.capabilities?.deferredEntryFocus===true?{expectedJobId:ownerId}:{});notice('Vigilancia y sesión detenidas. No se reactivarán solas.');}catch(e){notice(e.message);}finally{busy=false;controls();}}
$('activity-stop').addEventListener('click',stopActivity);
$('maximum-stop').addEventListener('click',()=>{if(!$('maximum-stop').disabled)return stopActivity();});
$('auto-duration').addEventListener('input',renderMaximumPlan);
$('auto-players').addEventListener('input',controls);
$('reward-save').addEventListener('click',async()=>{if(busy||!$('reward-lead').reportValidity())return;busy=true;controls();try{await post('/api/rewards/config',{enabled:$('reward-enabled').checked,leadMinutes:Number($('reward-lead').value)});if(window.chrome?.webview)window.chrome.webview.postMessage({kind:'reward_cancel'});notice($('reward-enabled').checked?'Protección guardada: solo cobrará retos pendientes al acercarse su fecha final.':'Cobro automático desactivado.');}catch(e){notice(e.message);}finally{busy=false;controls();}});
$('prepare-seeding').addEventListener('change',controls);
$('schedule-form').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;const prepare=$('prepare-seeding').checked,automatic=state.capabilities?.automaticEntry===true;if(prepare&&!validMovementSettings())return;const server=target();if(!server)return;const focusId=automatic?armDeferredEntryFocus(event,'scheduled',server):null;busy=true;controls();try{const result=await post('/api/opening/schedule',{server:server.number,expectedJoinId:server.joinId,team:seedingTeam(),madridStart:$('opening-at').value,onlyEligible:$('only-eligible').checked,...(prepare?{seeding:movementSettings()}:{}),...(focusId?{initialFocus:'desktop'}:{})});const stopped=bindDeferredEntryFocus(focusId,'scheduled',result.opening);notice(stopped?'Programación detenida con F8.':automatic?'Entrada automática'+(prepare?' y seeding':'')+' programada con el equipo '+entryTeamNames[seedingTeam()]+(focusId?'. Necesita el PC despierto. Puedes cancelar aquí; F8 cancela la entrada cuando comience.':'. Necesita el PC despierto y Wardogs en primer plano al entrar. Puedes cancelar la programación aquí.'):prepare?'Seeding programado con los ajustes actuales. A esa hora prepara el movimiento; la entrada sigue asistida.':'Apertura programada. Puedes cancelarla aquí; la entrada al servidor se completa en el juego.');}catch(e){cancelDeferredEntryFocus(focusId);notice(e.message);}finally{busy=false;controls();}});
$('cancel-opening').addEventListener('click',async()=>{if(busy)return;const ownerId=state?.opening?.id,focusId=deferredEntryFocusIntent?.jobKind==='scheduled'&&deferredEntryFocusIntent.ownerId===ownerId?deferredEntryFocusIntent.id:null;busy=true;controls();try{cancelDeferredEntryFocus(focusId);await post('/api/opening/cancel',ownerId&&state?.capabilities?.deferredEntryFocus===true?{expectedJobId:ownerId}:{});notice('Apertura programada cancelada.');}catch(e){notice(e.message);}finally{busy=false;controls();}});
async function poll(){if(polling)return;polling=true;const epoch=mutationEpoch;try{const r=await fetch('/api/state',{cache:'no-store'});if(!r.ok)throw Error('Sin conexión');const fresh=await r.json();if(epoch!==mutationEpoch||busy)return;render(fresh);if(fresh.teamClicker?.enabled&&!fresh.teamClicker.ownerId&&fresh.teamClicker.sessionId){const renewed=await fetch('/api/team-clicker/heartbeat',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':fresh.token},body:JSON.stringify({sessionId:fresh.teamClicker.sessionId})});if(epoch!==mutationEpoch||busy)return;if(!renewed.ok){const message=await renewed.json();state.teamClicker={...fresh.teamClicker,enabled:false,running:false,reason:message.error||'Activa de nuevo la espera de equipo.'};renderClicker(state.teamClicker);controls();}}}catch{if(epoch!==mutationEpoch||busy)return;state=null;publishState(null);renderBreak(null);$('entry-wait-limit').hidden=true;$('entry-guidance').hidden=true;if(!$('entry-progress').hidden){$('entry-progress-state').textContent='Sin conexión';$('entry-progress-detail').textContent='No se puede comprobar ni renovar la entrada. Se detendrá al vencer su concesión.';}$('activity-state').textContent='Búsqueda sin comprobar: el servicio no responde.';$('auto-status').textContent='Sin conexión';$('auto-detail').textContent='No se puede comprobar ni renovar la sesión.';$('opening-status').textContent='Programación sin comprobar: el servicio no responde.';$('health').textContent='Sin conexión';$('vip').textContent='Sin comprobar';$('seeding').textContent='Sin comprobar';$('condition').textContent='El servicio no permite renovar la lectura.';$('movement-state').textContent='Sin lectura';$('movement-detail').textContent='No se puede comprobar el controlador.';$('diagnostic-title').textContent='Sesión sin comprobar';$('diagnostic-detail').textContent='No hay conexión con el servicio para comprobar la sesión.';$('diagnostic-select').hidden=true;$('diagnostic-panel').dataset.severity='info';$('join-id').value='Sin conexión';renderClicker(null);$('clicker-detail').textContent='El servicio no responde. El autoclic se detiene al vencer la conexión.';for(let i=1;i<=5;i++){$('server-'+i).querySelector('.players').textContent='—';$('server-'+i).querySelector('.status').textContent='Últimos datos sin confirmar';renderServerClan($('server-'+i),null,null);}controls();}finally{polling=false;flushAccountStateRefresh();}}
function uiPollDelay(){const legacy=state?.teamClicker?.enabled===true&&!state.teamClicker.ownerId;return (document.hidden===true||!hostViewVisible)&&!legacy?10000:2000;}
function schedulePoll(){if(pollTimer!==null)clearTimeout(pollTimer);pollTimer=setTimeout(async()=>{pollTimer=null;await poll();schedulePoll();},uiPollDelay());}
function viewVisibilityChanged(){if(document.hidden!==true&&hostViewVisible)void poll();schedulePoll();}
if(typeof document.addEventListener==='function')document.addEventListener('visibilitychange',viewVisibilityChanged);
if(window.chrome?.webview){
 $('connect-account').hidden=false;$('reader-status').hidden=false;$('reader-status').textContent='Lector de cuenta preparado en la app.';
 $('connect-account').addEventListener('click',()=>window.chrome.webview.postMessage({kind:'account_open'}));
 window.chrome.webview.addEventListener('message',event=>{const msg=event.data;if(msg?.kind==='host_window_visibility'){if(typeof msg.visible==='boolean'){hostViewVisible=msg.visible;viewVisibilityChanged();}return;}if(msg?.kind==='host_entry_focus_support'){desktopEntryFocusSupported=msg.supported===true;deferredEntryFocusSupported=desktopEntryFocusSupported&&msg.deferred===true;return;}if(msg?.kind==='host_entry_focus_job_status'){deferredFocusStatus(msg);return;}if(msg?.kind==='host_entry_focus_status'){initialFocusStatus(msg);return;}if(msg?.kind==='host_foreground_status'){initialFocusForeground(msg);deferredFocusForeground(msg);return;}if(msg?.kind!=='host_account_status'||typeof msg.detail!=='string')return;$('reader-status').textContent=msg.detail;$('connect-account').textContent=msg.reading?'Ver cuenta Steam':'Conectar cuenta Steam';if(msg.state==='connected'&&msg.reading===true){accountStateRefreshQueued=true;flushAccountStateRefresh();}});
 window.chrome.webview.postMessage({kind:'host_ready'});
 if(typeof window.addEventListener==='function'){window.addEventListener('keydown',event=>{if(event.key==='F8'){stopDesktopEntryFromKey();stopDeferredEntryFromKey();}});window.addEventListener('pagehide',()=>{cancelDesktopEntryFocus();cancelDeferredEntryFocus();});}
}
$('export-session-report').addEventListener('click',async()=>{
 const button=$('export-session-report');if(!state?.token||button.disabled)return;button.disabled=true;
 try{const response=await fetch('/api/session-report',{headers:{'X-Session-Token':state.token}});if(!response.ok)throw Error('No se pudo preparar el diagnóstico.');const report=await response.json();if(report?.format!=='farmdogs-session-report-v1'||report.claims?.diagnosticOnly!==true||report.claims.accountDataIncluded!==false||report.claims.screenshotsIncluded!==false||report.claims.freeTextIncluded!==false)throw Error('El diagnóstico no tiene el formato seguro esperado.');
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='FarmDogs-diagnostico-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('Diagnóstico preparado, sin cuenta, tokens ni capturas.');
 }catch(error){notice(error.message);}finally{button.disabled=false;}
});
function workspaceBusy(){return busy||!state||entryRunning(state.entry)||autoActive(state.autoSeeding)||activityRunning(state.activity)||persistentTeamActive()||state.teamClicker?.enabled===true||state.teamClicker?.running===true||state.teamClicker?.stopping===true||['scheduled','launching'].includes(state.opening?.status)||active.has(state.watch?.status);}
function workspaceDraft(){
 const tab=tabNames.find(name=>$('tab-'+name).getAttribute('aria-selected')==='true')||'enter',mode=$('pause-dialog')?.open?'pause':tab==='seed'?'seeding':tab==='team'?'team':'play',number=id=>Number($(id).value);
 const mousePause=workspaceMouseDraft||state?.preferences?.mousePause||{enabled:true,resumeAfterSeconds:3},draft={mode,server:selected||state?.config?.selectedServer||1,team:mode==='team'?selectedTeam():mode==='seeding'?$('seed-team').value:mode==='pause'?'any':entryTeam(),durationMinutes:mode==='pause'?number('break-duration'):mode==='seeding'?number('auto-duration'):mode==='team'?120:workspacePlayDuration??Math.min(state?.config?.durationMinutes||120,720),mousePause:{...mousePause}};
 if(mode==='play'){draft.antiAfk=$('entry-anti-afk').checked;draft.antiAfkSettings=breakSettings();}
 if(mode==='pause')Object.assign(draft,{intervalSeconds:number('break-interval'),holdMs:number('break-hold')});
 if(mode==='team')Object.assign(draft,{repeat:$('clicker-repeat').checked,intervalMs:number('clicker-interval')});
 if(mode==='seeding')Object.assign(draft,{seedMode,startPlayers:number('auto-players'),intervalSeconds:number('auto-interval'),holdMs:number('auto-hold'),minPlayers:number('activity-min'),maxEntryPlayers:number('activity-max'),onlyEligible:$('only-eligible').checked,prepareSeeding:$('prepare-seeding').checked});
 return draft;
}
function workspaceApplyDraft(input){
 if(workspaceBusy())throw Error('Detén la sesión actual antes de cargar otros ajustes.');
 if(!input||!['play','seeding','team','pause'].includes(input.mode)||!Number.isInteger(input.server)||input.server<1||input.server>5||!['any','blue','red','green'].includes(input.team))throw Error('El perfil no tiene un destino válido.');
 const set=(id,value)=>{if(value!==undefined&&value!==null)$(id).value=value;};selected=input.server;workspaceMouseDraft=input.mousePause?{...input.mousePause}:null;
 if(workspaceMouseDraft){$('mouse-pause-enabled').checked=workspaceMouseDraft.enabled;$('mouse-pause-seconds').value=workspaceMouseDraft.resumeAfterSeconds;}
 $('manual-presence').checked=false;manualConfirmedServer=null;$('break-confirm').checked=false;$('opening-at').value='';
 if(input.mode==='play')workspacePlayDuration=input.durationMinutes;entryTeamInitialized=true;seedTeamInitialized=true;settingsInitialized=true;breakSettingsInitialized=true;clickerSettingsInitialized=true;
 if(input.mode==='play'){set('entry-team',input.team);$('entry-anti-afk').checked=input.antiAfk===true;const values=input.antiAfkSettings||{};set('break-duration',values.durationMinutes);set('break-interval',values.intervalSeconds);set('break-hold',values.holdMs);showTab('enter');}
 if(input.mode==='seeding'){setSeedMode(input.seedMode||'manual');set('seed-team',input.team);set('auto-duration',input.durationMinutes);set('auto-players',input.startPlayers);set('auto-interval',input.intervalSeconds);set('auto-hold',input.holdMs);set('activity-min',input.minPlayers);set('activity-max',input.maxEntryPlayers);if(typeof input.onlyEligible==='boolean')$('only-eligible').checked=input.onlyEligible;if(typeof input.prepareSeeding==='boolean')$('prepare-seeding').checked=input.prepareSeeding;showTab('seed');}
 if(input.mode==='team'){if(input.team==='any')throw Error('Selecciona un color para el perfil de equipo.');setClickerDraft({team:input.team,intervalMs:input.intervalMs??20});$('clicker-repeat').checked=input.repeat===true;set('clicker-server',input.server);showTab('team');}
 if(input.mode==='pause'){set('break-duration',input.durationMinutes);set('break-interval',input.intervalSeconds);set('break-hold',input.holdMs);$('break-options').open=true;}
 render(state);return {loaded:true,started:false};
}
window.FarmDogsWorkspace={getState:()=>state,getDraft:workspaceDraft,applyDraft:workspaceApplyDraft,refresh:poll,notify:notice,isBusy:workspaceBusy,getMouseDraft:()=>workspaceMouseDraft?{...workspaceMouseDraft}:null,clearMouseDraft:()=>{workspaceMouseDraft=null;}};
void poll().finally(schedulePoll);
