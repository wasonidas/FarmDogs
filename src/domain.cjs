const madrid=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const wallString=ms=>{const p=Object.fromEntries(madrid.formatToParts(ms).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;};

function madridToUtc(wall){
 if(typeof wall!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall))throw Error('Introduce una fecha y hora válidas.');
 const nominal=Date.parse(wall+'Z');if(!Number.isFinite(nominal))throw Error('Fecha no válida.');
 const matches=[];
 for(let offset=-180;offset<=180;offset+=30){const candidate=nominal+offset*60000;if(wallString(candidate)===wall)matches.push(candidate);}
 if(matches.length===0)throw Error('Esa hora no existe en Madrid por el cambio de hora, o la fecha no es válida.');
 if(matches.length!==1)throw Error('Esa hora se repite por el cambio de hora. Elige una hora anterior o posterior al cambio.');
 return new Date(matches[0]).toISOString();
}
function validateProfile(p){
 if(!p||!Number.isInteger(p.server)||p.server<1||p.server>5)throw Error('Servidor no válido.');
 if(!Number.isInteger(p.entryBelow)||p.entryBelow<1||p.entryBelow>100)throw Error('El umbral de entrada debe estar entre 1 y 100.');
 if(!['unknown','population','timed'].includes(p.mode))throw Error('Tipo de regla no válido.');
 if(p.mode==='population'&&(!Number.isInteger(p.target)||p.target<p.entryBelow||p.target>100))throw Error('El objetivo debe estar entre el umbral y 100 jugadores.');
 if(p.mode==='timed'&&(!Number.isInteger(p.holdMinutes)||p.holdMinutes<1||p.holdMinutes>1440))throw Error('La permanencia debe ser de 1 a 1440 minutos.');
 const reviewAfterHours=Object.hasOwn(p,'reviewAfterHours')?p.reviewAfterHours:24;
 if(!Number.isInteger(reviewAfterHours)||reviewAfterHours<1||reviewAfterHours>168)throw Error('Revisa el perfil cada 1 a 168 horas.');
 if(typeof p.source!=='string'||p.source.trim().length<3||p.source.length>500)throw Error('Indica la procedencia de la regla (3–500 caracteres).');
 if(p.verifiedAt!==null&&(!Number.isFinite(Date.parse(p.verifiedAt))))throw Error('Fecha de verificación no válida.');
 if(p.mode!=='unknown'&&!p.verifiedAt)throw Error('Añade la fecha de verificación del perfil.');
 return {server:p.server,entryBelow:p.entryBelow,mode:p.mode,target:p.mode==='population'?p.target:null,holdMinutes:p.mode==='timed'?p.holdMinutes:null,reviewAfterHours,source:p.source.trim(),verifiedAt:p.verifiedAt,updatedAt:new Date().toISOString()};
}
function profileValidity(profile,now){
 const age=now-Date.parse(profile?.verifiedAt);
 if(!profile||profile.mode==='unknown'||!Number.isFinite(age))return 'unknown';
 if(age< -60000)return 'future';
 return age>=(profile.reviewAfterHours??24)*3600000?'stale':'recent';
}
function defaultProfiles(){
 return [1,2,3,4,5].map(server=>validateProfile({server,entryBelow:20,mode:server===2?'population':'unknown',target:server===2?50:null,holdMinutes:null,source:server===2?'Mi cuenta: sesión #2 observada el 29/10/2026; volver a contrastar al entrar.':'API pública: umbral 20; modalidad final sin verificar.',verifiedAt:server===2?'2026-10-29T06:50:53Z':null}));
}
function normalizeServers(payload,now=Date.now()){
 if(!payload||!Array.isArray(payload.servers)||!Number.isFinite(payload.fetchedAt))throw Error('Respuesta de servidores incompleta.');
 const age=now-payload.fetchedAt;
 const seen=new Set();
 return payload.servers.map(row=>{
  if(!Number.isInteger(row.num)||row.num<1||row.num>5||seen.has(row.num))throw Error('Identidad de servidor ausente o duplicada.');seen.add(row.num);
  const validPopulation=Number.isInteger(row.players)&&row.players>=0&&Number.isInteger(row.maxPlayers)&&row.maxPlayers>0&&row.players<=row.maxPlayers;
  const trusted=payload.configured===true&&row.configured===true&&row.online===true&&row.stale!==true&&validPopulation&&age>=-60000&&age<=90000;
  let reason=null;
  if(!validPopulation)reason='Población inválida';else if(row.stale===true)reason='Datos marcados como desactualizados';else if(age>90000||age< -60000)reason='Fecha de la fuente no fiable';else if(row.online!==true)reason='Servidor sin confirmar en línea';else if(!trusted)reason='Fuente sin configurar';
  return {number:row.num,apiId:row.id,name:String(row.name||`Servidor #${row.num}`),joinId:typeof row.joinId==='string'?row.joinId:null,map:typeof row.map==='string'?row.map:null,players:validPopulation?row.players:null,capacity:validPopulation?row.maxPlayers:null,online:row.online===true,stale:row.stale===true,trusted,reason,sourceAt:new Date(payload.fetchedAt).toISOString(),observedAt:new Date(now).toISOString(),publicRule:row.sedeo||null,seedingActive:row.sedeoActivo===true};
 }).sort((a,b)=>a.number-b.number);
}
function serverView(server,profile,now=Date.now(),sourceError=null){
 const age=now-Date.parse(server.sourceAt);
 const trusted=server.trusted&&!sourceError&&age>=-60000&&age<=90000;
 const ruleValidity=profileValidity(profile,now),ruleKnown=ruleValidity==='recent';
 const entryCandidate=trusted&&server.seedingActive&&ruleKnown&&server.players<profile.entryBelow;
 let status='unknown',message=sourceError?'Fuente temporalmente no disponible':server.reason;
 if(trusted){
  if(!server.seedingActive){status='seeding_inactive';message='El seeding figura desactivado';}
  else if(!ruleKnown){status='rule_unknown';message=ruleValidity==='stale'?'Toca revisar la vigencia del perfil':ruleValidity==='future'?'La fecha del perfil está en el futuro':'Falta verificar la regla final';}
  else if(entryCandidate){status='entry_candidate';message='Candidato para entrar por debajo del umbral';}
  else{status='above_entry_threshold';message='Ya no está por debajo del umbral de entrada';}
 }else if(!message)message='Lectura antigua o no confirmada';
 return {...server,trusted,viewedAt:new Date(now).toISOString(),ruleValidity,sourceAgeSeconds:Number.isFinite(age)?Math.max(0,Math.round(age/1000)):null,entryCandidate,status,message,profile};
}
function recommend(views){return views.filter(s=>s.entryCandidate).sort((a,b)=>b.players-a.players||a.number-b.number)[0]?.number??null;}
function advanceObservation(watch,server,elapsedMs){
 const next={...watch,elapsedMs};
 if(!['watching','threshold_candidate','target_candidate','unknown_source','requires_review','rule_unknown','time_candidate'].includes(watch.status))return next;
 if(elapsedMs>=watch.durationMinutes*60000)return {...next,status:'expired',reason:'Duración máxima alcanzada'};
 if(!server||!server.trusted){return {...next,status:'unknown_source',holdStartedElapsedMs:null,uncertain:true,reason:'Sin una lectura reciente fiable'};}
 if(!server.seedingActive)return {...next,status:'requires_review',holdStartedElapsedMs:null,reason:'El servidor indica seeding desactivado',rewardVerified:false};
 const p=watch.profile;
 if(p.mode==='unknown')return {...next,status:'rule_unknown',reason:'El perfil necesita verificación'};
 if(profileValidity(p,Date.parse(server.viewedAt||server.observedAt))!=='recent')return {...next,status:'requires_review',holdStartedElapsedMs:null,reason:'La vigencia del perfil necesita una nueva comprobación',rewardVerified:false};
 if(p.mode==='population'){
  if(server.players>=p.target)return {...next,status:'target_candidate',reason:`La población ha alcanzado ${p.target}; comprobar la cuenta`,rewardVerified:false};
  return {...next,status:server.players>=p.entryBelow?'threshold_candidate':'watching',reason:server.players>=p.entryBelow?'Umbral observado; falta el objetivo final':'Esperando población',rewardVerified:false};
 }
 if(watch.status==='requires_review')return next;
 if(server.players<p.entryBelow){
  if(watch.holdStartedElapsedMs!==null&&watch.holdStartedElapsedMs!==undefined)return {...next,status:'requires_review',reason:'Bajó la población durante la espera; continuidad sin verificar',holdStartedElapsedMs:null,rewardVerified:false};
  return {...next,status:'watching',reason:'Esperando el umbral',rewardVerified:false};
 }
 const started=watch.holdStartedElapsedMs??elapsedMs;
 const reached=elapsedMs-started>=p.holdMinutes*60000;
 return {...next,status:reached?'time_candidate':'threshold_candidate',holdStartedElapsedMs:started,reason:reached?'Tiempo de referencia completado; comprobar la cuenta':'Tiempo de referencia desde el umbral',rewardVerified:false};
}
function rewardDifference(before,after,server,sessionStart){
 if(!before||!after||!Array.isArray(before.historial)||!Array.isArray(after.historial))return {status:'unknown',newSeeding:[],expiryDeltaMs:null};
 const id=r=>JSON.stringify([r.origen,r.servidor??null,Date.parse(r.at),r.dias]);const known=new Set(before.historial.map(id));
 const newer=after.historial.filter(r=>!known.has(id(r))&&r.origen==='sedeo'&&r.servidor===server&&Date.parse(r.at)>=Date.parse(sessionStart)&&Number.isFinite(r.dias)&&r.dias>0);
 const a=Date.parse(before.prioridad?.caduca),b=Date.parse(after.prioridad?.caduca);
 const delta=Number.isFinite(a)&&Number.isFinite(b)?b-a:null;
 return {status:newer.length?'new_seeding_record':'no_new_seeding_record',newSeeding:newer,expiryDeltaMs:delta};
}
module.exports={madridToUtc,wallString,validateProfile,defaultProfiles,normalizeServers,serverView,recommend,advanceObservation,rewardDifference};
