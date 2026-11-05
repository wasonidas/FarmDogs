'use strict';
const {randomUUID}=require('node:crypto');
const FORMAT='farmdogs-user-presets-v1';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const clone=value=>structuredClone(value);
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const object=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('PRESET_INVALID','El perfil contiene ajustes no admitidos.');};
const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
function normalizePresetSettings(input){
 const keys=['mode','server','team','durationMinutes','antiAfk','antiAfkSettings','seedMode','startPlayers','intervalSeconds','holdMs','intervalMs','repeat','minPlayers','maxEntryPlayers','onlyEligible','prepareSeeding','mousePause'];
 object(input,keys);
 if(!['play','seeding','team','pause'].includes(input.mode))fail('PRESET_MODE','Elige jugar, seeding, equipo o pausa.');
 const server=input.server??1,team=input.team??(input.mode==='team'?'green':'any'),durationMinutes=input.durationMinutes??(input.mode==='pause'?15:120);
 if(!integer(server,1,5)||!['blue','red','green','any'].includes(team)||input.mode==='team'&&team==='any'||!integer(durationMinutes,1,720))fail('PRESET_SETTINGS','Revisa servidor, equipo y duración del perfil.');
 const result={mode:input.mode,server,team,durationMinutes};
 for(const key of ['antiAfk','repeat','onlyEligible','prepareSeeding'])if(input[key]!==undefined){if(typeof input[key]!=='boolean')fail('PRESET_SETTINGS','Revisa las casillas del perfil.');result[key]=input[key];}
 const ranges={startPlayers:[1,100],intervalSeconds:[5,300],holdMs:[100,2000],intervalMs:[20,2000],minPlayers:[1,99],maxEntryPlayers:[1,99]};
 for(const [key,[min,max]]of Object.entries(ranges))if(input[key]!==undefined){if(!integer(input[key],min,max))fail('PRESET_SETTINGS','Hay un ajuste numérico fuera de rango.');result[key]=input[key];}
 if(result.minPlayers!==undefined&&result.maxEntryPlayers!==undefined&&result.minPlayers>result.maxEntryPlayers)fail('PRESET_SETTINGS','El mínimo de jugadores supera al máximo.');
 if(input.seedMode!==undefined){if(!['manual','schedule','activity','maximum'].includes(input.seedMode))fail('PRESET_SETTINGS','El modo de seeding no es válido.');result.seedMode=input.seedMode;}
 if(input.antiAfkSettings!==undefined){object(input.antiAfkSettings,['durationMinutes','intervalSeconds','holdMs']);const value={durationMinutes:input.antiAfkSettings.durationMinutes??15,intervalSeconds:input.antiAfkSettings.intervalSeconds??30,holdMs:input.antiAfkSettings.holdMs??500};if(!integer(value.durationMinutes,1,720)||!integer(value.intervalSeconds,5,300)||!integer(value.holdMs,100,2000))fail('PRESET_SETTINGS','Revisa los ajustes de anti-AFK.');result.antiAfkSettings=value;}
 const mouse=input.mousePause??{};object(mouse,['enabled','resumeAfterSeconds']);const enabled=mouse.enabled??true,resumeAfterSeconds=mouse.resumeAfterSeconds??3;
 if(typeof enabled!=='boolean'||!integer(resumeAfterSeconds,1,30))fail('PRESET_MOUSE','La reanudación del ratón debe ser de 1 a 30 segundos.');
 result.mousePause={enabled,resumeAfterSeconds};return result;
}
function normalizeName(value){if(typeof value!=='string')fail('PRESET_NAME','Escribe un nombre para el perfil.');const name=value.normalize('NFC').trim().replace(/\s+/g,' ');if(!name||name.length>40||/[\u0000-\u001f\u007f]/.test(name))fail('PRESET_NAME','El nombre debe tener entre 1 y 40 caracteres.');return name;}
function createUserPresets({load=()=>null,save=()=>{},now=Date.now,newId=randomUUID}={}){
 if(![load,save,now,newId].every(fn=>typeof fn==='function'))throw Error('Faltan dependencias de perfiles.');
 let current={format:FORMAT,revision:0,presets:[]},errorCode=null,readOnly=false;
 try{const stored=load();if(stored!==null&&stored!==undefined){object(stored,['format','revision','presets']);if(stored.format!==FORMAT||!integer(stored.revision,0,Number.MAX_SAFE_INTEGER)||!Array.isArray(stored.presets)||stored.presets.length>20)throw Error('Invalid preset document');const ids=new Set();current={format:FORMAT,revision:stored.revision,presets:stored.presets.map(value=>{object(value,['id','name','settings','createdAt','updatedAt']);if(typeof value.id!=='string'||!UUID.test(value.id)||ids.has(value.id.toLowerCase())||!instant(value.createdAt)||!instant(value.updatedAt))throw Error('Invalid preset record');ids.add(value.id.toLowerCase());return{id:value.id.toLowerCase(),name:normalizeName(value.name),settings:normalizePresetSettings(value.settings),createdAt:instant(value.createdAt),updatedAt:instant(value.updatedAt)};})};}}
 catch{errorCode='PRESETS_READ_FAILED';readOnly=true;}
 function view(){return{...clone(current),errorCode,readOnly,maximumProfiles:20};}
 function revision(value){if(readOnly)fail('PRESETS_RECOVERY_REQUIRED','No se pudieron leer los perfiles. Se conserva el archivo anterior.');if(!integer(value,0,Number.MAX_SAFE_INTEGER)||value!==current.revision)fail('PRESETS_CHANGED','Los perfiles cambiaron. Actualiza la lista antes de guardar.');if(current.revision===Number.MAX_SAFE_INTEGER)fail('PRESETS_REVISION_LIMIT','Se alcanzó el límite de revisiones de perfiles.');}
 function commit(presets){const next={format:FORMAT,revision:current.revision+1,presets};try{save(clone(next));}catch{errorCode='PRESETS_WRITE_FAILED';fail(errorCode,'No se pudo guardar el perfil. Los ajustes anteriores se conservan.');}current=next;errorCode=null;return view();}
 function savePreset(input){object(input,['id','name','settings','expectedRevision']);revision(input.expectedRevision);const name=normalizeName(input.name),settings=normalizePresetSettings(input.settings),at=new Date(now()).toISOString();let id=input.id,prior=null;
  if(id!==undefined){if(typeof id!=='string'||!UUID.test(id))fail('PRESET_ID','El perfil no es válido.');id=id.toLowerCase();prior=current.presets.find(row=>row.id===id);if(!prior)fail('PRESET_NOT_FOUND','El perfil ya no está disponible.');}
  else{if(current.presets.length>=20)fail('PRESETS_LIMIT','Puedes guardar hasta 20 perfiles.');id=newId();if(typeof id!=='string'||!UUID.test(id)||current.presets.some(row=>row.id===id.toLowerCase()))fail('PRESET_ID','No se pudo crear el identificador del perfil.');id=id.toLowerCase();}
  const row={id,name,settings,createdAt:prior?.createdAt||at,updatedAt:at};return commit([...current.presets.filter(value=>value.id!==id),row]);
 }
 function remove(input){object(input,['id','expectedRevision']);revision(input.expectedRevision);if(typeof input.id!=='string'||!UUID.test(input.id))fail('PRESET_ID','El perfil no es válido.');const id=input.id.toLowerCase();if(!current.presets.some(row=>row.id===id))fail('PRESET_NOT_FOUND','El perfil ya no está disponible.');return commit(current.presets.filter(row=>row.id!==id));}
 function get(id){if(typeof id!=='string'||!UUID.test(id))fail('PRESET_ID','El perfil no es válido.');const row=current.presets.find(row=>row.id===id.toLowerCase());if(!row)fail('PRESET_NOT_FOUND','El perfil ya no está disponible.');return clone(row);}
 return{view,save:savePreset,remove,get};
}
module.exports={createUserPresets,normalizePresetSettings};
