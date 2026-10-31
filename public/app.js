'use strict';
const $=id=>document.getElementById(id);
const activeStates=new Set(['scheduled','watching','threshold_candidate','target_candidate','unknown_source','requires_review','rule_unknown','time_candidate']);
const dates=new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',dateStyle:'medium',timeStyle:'short'});
const times=new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit',second:'2-digit'});
const formatDate=value=>value&&Number.isFinite(Date.parse(value))?dates.format(new Date(value)):'Sin fecha';
const time=value=>value&&Number.isFinite(Date.parse(value))?times.format(new Date(value)):'—';
const duration=ms=>{const n=Math.max(0,Math.floor(ms/1000));return `${Math.floor(n/3600)} h ${Math.floor(n/60)%60} min ${n%60} s`;};
const labels={scheduled:'Programado',watching:'Observando',threshold_candidate:'Umbral observado',target_candidate:'Objetivo público observado',unknown_source:'Fuente desconocida',requires_review:'Continuidad por revisar',rule_unknown:'Regla por verificar',time_candidate:'Tiempo de referencia completado',expired:'Tiempo máximo alcanzado',cancelled:'Detenido',missed:'Hora perdida',interrupted:'Interrumpido'};
let latest=null,lastKnown=null,profiles=[],initialized=false,busy=false,profileDirty=false,noticeTimer=null,polling=false;
function el(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;}
function notice(message,success=false){clearTimeout(noticeTimer);$('notice').hidden=false;$('notice').textContent=message;$('notice').className='notice'+(success?' success':'');noticeTimer=setTimeout(()=>{$('notice').hidden=true;},10000);}
function selected(){return Number($('selected-server').value)||2;}
function entryTarget(){return latest?.servers.find(s=>s.number===selected()&&s.trusted&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s.joinId||''));}
function ruleFields(){const mode=$('rule-mode').value;$('target-field').hidden=mode!=='population';$('hold-field').hidden=mode!=='timed';$('target').required=mode==='population';$('hold').required=mode==='timed';$('verified-date').required=mode!=='unknown';}
function loadProfile(){const p=profiles.find(p=>p.server===selected());if(!p)return;$('entry-below').value=p.entryBelow;$('rule-mode').value=p.mode;$('target').value=p.target??50;$('hold').value=p.holdMinutes??30;$('rule-source').value=p.source;$('verified-date').value=p.verifiedAt?.slice(0,10)||'';$('review-hours').value=p.reviewAfterHours??24;profileDirty=false;ruleFields();}
function controls(){const active=activeStates.has(latest?.watch?.status);for(const id of ['selected-server','duration','start-mode','scheduled-at','entry-below','rule-mode','target','hold','rule-source','verified-date','review-hours','save-profile','start'])$(id).disabled=busy||active||!latest;for(const button of $('servers').querySelectorAll('button'))button.disabled=busy||active||!latest;$('stop').disabled=busy||!active;$('shutdown').disabled=busy||!latest;$('open-game').disabled=busy||['scheduled','launching'].includes(latest?.opening?.status)||!latest?.localTools?.game||!entryTarget();$('open-movement').disabled=busy||!latest?.localTools?.movement;}
function renderServers(){
 const root=$('servers');root.replaceChildren();
 for(const s of latest.servers){
  const card=el('article',undefined,'server'+(s.number===selected()?' selected':''));
  card.append(el('div',`#${s.number}`,'number'),el('p',s.map||'Mapa sin confirmar'));
  const count=el('strong',s.trusted?s.players:'—');count.append(el('span',s.trusted?` / ${s.capacity}`:' sin confirmar'));card.append(count);
  const bar=el('progress');bar.max=s.capacity||100;if(s.trusted)bar.value=s.players;else bar.setAttribute('aria-valuetext','Sin lectura confirmada');bar.setAttribute('aria-label',`Población del servidor ${s.number}`);card.append(bar);
  card.append(el('p',s.message,'state'+(!s.trusted||s.status==='rule_unknown'?' unknown':'')),el('p',`Fuente: ${time(s.sourceAt)}${s.sourceAgeSeconds!==null?' · hace '+s.sourceAgeSeconds+' s':''}`));
  const button=el('button',s.number===selected()?'Seleccionado':'Elegir');button.type='button';button.disabled=busy||activeStates.has(latest.watch?.status);button.addEventListener('click',()=>{if(profileDirty){notice('Guarda el perfil antes de cambiar de servidor.');return;}$('selected-server').value=s.number;loadProfile();renderServers();renderEntry();renderDiagnostic();controls();});card.append(button);root.append(card);
 }
 if(!latest.servers.length)root.append(el('p','Todavía no hay una lectura de servidores.','muted'));
}
function renderEntry(){
 $('entry-server').textContent=`#${selected()}`;
 const target=entryTarget();$('join-id').value=target?.joinId||'Sin ID reciente confirmado';
 const launch=latest.lastLaunch;
 if(launch?.kind==='game')$('launch-status').textContent=`Apertura solicitada a las ${time(launch.requestedAt)} para #${launch.server}. Completa la entrada por ID en el juego; la cuenta confirmara la presencia cuando haya una lectura reciente.`;
 else if(launch?.kind==='movement')$('launch-status').textContent='Control de movimiento solicitado. Abrir sus ajustes detiene una sesion en marcha.';
 else $('launch-status').textContent=target?'En el juego: Desplegar → Unirse por ID → pegar el ID → buscar y unirse.':'Espera una lectura reciente antes de preparar la entrada.';
}
function renderWatch(){
 const w=latest.watch||latest.lastResult,root=$('watch-status');root.replaceChildren();
 if(!w){root.append(el('strong','Sin seguimiento activo'),el('p','Elige servidor y duración.'));return;}
 root.append(el('strong',`${labels[w.status]||w.status} · #${w.server}`),el('p',w.reason||''));
 if(w.status==='scheduled')root.append(el('p',`Inicio: ${formatDate(w.scheduledAt)} · máximo ${w.durationMinutes} min`));
 else root.append(el('p',`Transcurrido: ${duration(w.elapsedMs||0)} · máximo ${w.durationMinutes} min`));
 if(w.profile?.mode==='timed'&&w.holdStartedElapsedMs!==null)root.append(el('p',`Referencia desde el umbral: ${duration((w.elapsedMs||0)-w.holdStartedElapsedMs)} de ${w.profile.holdMinutes} min`));
 root.append(el('p','Este estado público no acredita por sí solo elegibilidad individual ni VIP.'));
}
function renderAccount(){
 const a=latest.account;
 const condition=a.condition;$('account-condition').textContent=a.seedingFresh&&condition?condition.mode==='timed'?`${condition.reason} Fecha: ${formatDate(condition.deadline)} · Madrid.`:condition.reason:'';
 if(a.seedingFresh){const s=a.seeding;$('account-state').textContent=s.servidor?`#${s.servidor} · ${s.estado}`:s.estado==='nada'?'Fuera del seeding':s.estado;$('account-detail').textContent=s.contando?`Tiempo contando · ${s.jugadores??'—'} jugadores · lectura ${time(a.seedingAt)}`:`Lectura ${time(a.seedingAt)} · el contador no figura activo.`;}
 else{$('account-state').textContent='Sin lectura reciente';$('account-detail').textContent='La población pública no confirma que tu cuenta esté dentro.';}
 if(a.vipFresh&&a.vip?.comprobado){$('vip-state').textContent=a.vip.permanente||a.vip.sinCaducidad?'VIP permanente':a.vip.tiene?'VIP activo':'VIP no activo';$('vip-detail').textContent=a.vip.caduca?`Caduca: ${formatDate(a.vip.caduca)} · Madrid`:`Comprobado a las ${time(a.vipAt)}`;}
 else{$('vip-state').textContent='Sin comprobar';$('vip-detail').textContent=a.vip?.caduca?`Última caducidad conocida: ${formatDate(a.vip.caduca)}. Lectura sin confirmar.`:'Hace falta una lectura reciente de tu cuenta.';}
 $('history-source').textContent=a.vipFresh?`Cuenta leída: ${time(a.vipAt)}`:'Historial antiguo o no disponible';
 const root=$('history');root.replaceChildren();
 for(const row of (a.history||[]).slice(0,30)){const tr=el('tr');for(const text of [formatDate(row.at),row.origen,row.servidor?`#${row.servidor}`:'—',row.dias])tr.append(el('td',text));root.append(tr);}
 if(!a.history?.length){const tr=el('tr'),td=el('td','No hay historial disponible para esta lectura.');td.colSpan=4;tr.append(td);root.append(tr);}
 const d=a.difference;
 $('award-status').textContent=d?.status==='new_seeding_record'?`Hay ${d.newSeeding.length} registro(s) nuevo(s) de seeding en #${a.differenceServer}. Contrasta la sesión y su condición.`:a.vipFresh?`No aparece un premio nuevo de seeding en #${a.differenceServer} desde la referencia de esta investigación.`:'Sin una lectura reciente no se pueden comprobar premios nuevos.';
}
function renderEvents(){const root=$('events');root.replaceChildren();const names={source_error:'Error de la fuente',source_recovered:'Fuente recuperada',config_saved:'Configuración guardada',observation_started:'Seguimiento iniciado',observation_scheduled:'Seguimiento programado',observation_finished:'Seguimiento finalizado',observation_state:'Cambio de seguimiento',account_imported:'Cuenta actualizada'};for(const e of latest.events.slice(0,15)){const li=el('li');li.append(el('time',time(e.at)),el('span',`${names[e.kind]||e.kind}${e.server?' · #'+e.server:''}${e.status?' · '+(labels[e.status]||e.status):''}${e.message?' · '+e.message:''}${e.reason?' · '+e.reason:''}`));root.append(li);}if(!latest.events.length)root.append(el('li','Sin eventos en esta ejecución.'));}
function renderMovement(){
 const m=latest.movement;
 if(!m?.available){$('movement-state').textContent='Sin lectura reciente';$('movement-detail').textContent=m?.reason||'Abre el control de movimiento.';return;}
 $('movement-state').textContent=m.status==='error'?'Detenido por error':m.armed?'En marcha':'Detenido';
 $('movement-detail').textContent=`${m.reason} · Pulsaciones completadas: ${m.count}${m.lastKey?' · Ultima tecla: '+m.lastKey:''}${m.endUtc?' · Fin Madrid: '+time(m.endUtc):''}${m.hardStopUtc?' · Limite de hoy: '+time(m.hardStopUtc):''} · Lectura: ${time(m.at)}`;
}
function renderDiagnostic(){const d=latest?.diagnostics?.[selected()];$('diagnostic-title').textContent=d?.title||'Estado de sesión sin comprobar';$('diagnostic-detail').textContent=d?.detail||'Esperando datos del servicio.';}
function render(data){
 latest=data;lastKnown=data;
 if(!initialized){profiles=structuredClone(data.config.profiles);for(let i=1;i<=5;i++){const option=el('option',`Servidor #${i}`);option.value=i;$('selected-server').append(option);}$('selected-server').value=data.config.selectedServer;$('duration').value=data.config.durationMinutes;loadProfile();initialized=true;}
 const pendingOpening=['scheduled','launching'].includes(data.opening?.status);$('opening-summary').hidden=!pendingOpening;$('opening-summary-text').textContent=pendingOpening?`Apertura programada del #${data.opening.server}: ${formatDate(data.opening.scheduledAt)}. ${data.opening.reason}`:'';
 const anyFresh=data.servers.some(s=>s.trusted);$('connection').textContent=data.source.error?'Fuente con error':anyFresh?'Datos recientes':'Datos sin confirmar';$('connection').className='pill '+(anyFresh&&!data.source.error?'good':'warn');
 $('source-time').textContent=data.source.error?`${data.source.error} · nuevo intento ${time(data.source.nextFetchAt)}`:`Última consulta ${time(data.source.lastSuccessAt)} · cada 30 s`;
 $('recommendation').textContent=data.recommendation?`Servidor #${data.recommendation}`:'Sin candidato confirmado';$('recommendation-detail').textContent=data.recommendation?'Con datos recientes y perfil guardado; comprueba la regla al entrar.':'Revisa la vigencia de los perfiles y la población.';
 renderDiagnostic();
 renderServers();renderEntry();renderWatch();renderAccount();renderMovement();renderEvents();controls();
}
async function post(route,input){if(!latest)throw Error('El observador no responde.');const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':latest.token},body:JSON.stringify(input)});const result=await response.json();if(!response.ok)throw Error(result.error||'No se pudo completar la acción.');render(result);return result;}
async function saveConfig(){return post('/api/config',{selectedServer:selected(),durationMinutes:Number($('duration').value),profiles});}
$('selected-server').addEventListener('change',()=>{if(profileDirty){$('selected-server').value=latest.config.selectedServer;notice('Guarda el perfil antes de cambiar de servidor.');return;}loadProfile();renderServers();renderEntry();renderDiagnostic();controls();});
$('open-game').addEventListener('click',async()=>{if(busy)return;const target=entryTarget();if(!target)return;busy=true;controls();try{try{await navigator.clipboard.writeText(target.joinId);}catch{throw Error('El navegador no pudo copiar el ID. Seleccionalo en el campo de arriba y copialo antes de continuar.');}await post('/api/open/game',{server:target.number,expectedJoinId:target.joinId});notice(`ID del #${target.number} copiado y apertura de Wardogs solicitada. Completa la entrada dentro del juego.`,true);}catch(error){notice(error.message);}finally{busy=false;controls();}});
$('open-movement').addEventListener('click',async()=>{if(busy)return;busy=true;controls();try{await post('/api/open/movement',{});notice('Control de movimiento solicitado.',true);}catch(error){notice(error.message);}finally{busy=false;controls();}});
$('start-mode').addEventListener('change',()=>{$('scheduled-field').hidden=$('start-mode').value!=='scheduled';$('scheduled-at').required=$('start-mode').value==='scheduled';});
$('rule-mode').addEventListener('change',ruleFields);
$('profile-form').addEventListener('input',()=>{profileDirty=true;});
$('profile-form').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;controls();try{const prior=profiles.find(p=>p.server===selected()),date=$('verified-date').value;const p={server:selected(),entryBelow:Number($('entry-below').value),mode:$('rule-mode').value,target:Number($('target').value),holdMinutes:Number($('hold').value),reviewAfterHours:Number($('review-hours').value),source:$('rule-source').value,verifiedAt:date?(prior.verifiedAt?.startsWith(date)?prior.verifiedAt:date+'T00:00:00Z'):null};const nextProfiles=profiles.map(old=>old.server===p.server?p:old);const response=await post('/api/config',{selectedServer:selected(),durationMinutes:Number($('duration').value),profiles:nextProfiles});profiles=structuredClone(response.config.profiles);loadProfile();notice('Perfil guardado con su procedencia.',true);}catch(error){notice(error.message);}finally{busy=false;controls();}});
$('watch-form').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;if(profileDirty){notice('Guarda el perfil editado antes de iniciar.');return;}busy=true;controls();try{await saveConfig();await post('/api/watch/start',{madridStart:$('start-mode').value==='scheduled'?$('scheduled-at').value:null});notice('Seguimiento activado. La entrada al juego se realiza por separado.',true);}catch(error){notice(error.message);}finally{busy=false;controls();}});
$('stop').addEventListener('click',async()=>{if(busy)return;busy=true;controls();try{await post('/api/watch/stop',{});notice('Seguimiento detenido. El juego conserva su estado.',true);}catch(error){notice(error.message);}finally{busy=false;controls();}});
$('shutdown').addEventListener('click',async()=>{if(busy)return;busy=true;controls();try{await post('/api/service/stop',{});latest=null;notice('Observador cerrado. El juego conserva su estado.',true);}catch(error){notice(error.message);}finally{busy=false;controls();}});
async function poll(){if(polling)return;polling=true;try{const response=await fetch('/api/state',{cache:'no-store'});if(!response.ok)throw Error('No responde');render(await response.json());}catch{
 $('connection').textContent='Observador sin conexión';$('connection').className='pill warn';
 $('source-time').textContent=`Última consulta conocida: ${time(lastKnown?.source.lastSuccessAt)} · servicio sin conexión`;
 $('recommendation').textContent='Sin datos recientes';$('recommendation-detail').textContent='El servicio local no responde; los datos anteriores no se consideran actuales.';
 $('account-state').textContent='Sin conexión';$('account-detail').textContent=`Última lectura ${time(lastKnown?.account.seedingAt)} · estado actual sin confirmar.`;
 $('account-condition').textContent='';
 $('vip-state').textContent='Sin lectura reciente';$('vip-detail').textContent=lastKnown?.account.vip?.caduca?`Última caducidad conocida: ${formatDate(lastKnown.account.vip.caduca)}. Sin confirmar.`:'No hay una lectura actual de tu cuenta.';
 $('history-source').textContent=`Historial sin actualizar · última lectura ${time(lastKnown?.account.vipAt)}`;$('award-status').textContent='Sin conexión no se pueden comprobar premios nuevos.';
 $('watch-status').replaceChildren(el('strong','Seguimiento sin conexión'),el('p','No se puede confirmar el estado actual del seguimiento.'));
 $('movement-state').textContent='Sin conexion';$('movement-detail').textContent='El servicio local no permite consultar el controlador.';
 $('diagnostic-title').textContent='Sesión sin comprobar';$('diagnostic-detail').textContent='No hay conexión con el servicio para comprobar la sesión.';
 if(! $('opening-summary').hidden)$('opening-summary-text').textContent='Programación sin comprobar: el servicio no responde.';
 $('join-id').value='Sin conexion';$('launch-status').textContent='Recupera el servicio antes de preparar una entrada.';
 for(const card of $('servers').children){card.querySelector('strong')?.replaceChildren(el('span','Sin conexión'));const state=card.querySelector('.state');if(state)state.textContent='Últimos datos sin confirmar';const bar=card.querySelector('progress');if(bar){bar.removeAttribute('value');bar.setAttribute('aria-valuetext','Sin conexión');}}
 latest=null;controls();
 }finally{polling=false;}}
poll();setInterval(poll,2000);
