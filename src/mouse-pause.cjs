'use strict';
const DEFAULT_MOUSE_PAUSE=Object.freeze({enabled:true,resumeAfterSeconds:3});
function normalizeMousePause(value){
 if(value===undefined)return {...DEFAULT_MOUSE_PAUSE};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['enabled','resumeAfterSeconds'].includes(key)))throw Error('Ajustes de pausa por ratón no válidos.');
 const enabled=value.enabled??true,resumeAfterSeconds=value.resumeAfterSeconds??3;
 if(typeof enabled!=='boolean'||!Number.isInteger(resumeAfterSeconds)||resumeAfterSeconds<1||resumeAfterSeconds>30)throw Error('La reanudación por ratón debe estar entre 1 y 30 segundos.');
 return {enabled,resumeAfterSeconds};
}
function mousePauseView(value,now=Date.now()){
 if(!value||value.kind!=='mouse'||typeof value.active!=='boolean'||typeof value.buttonsDown!=='boolean'||!Number.isFinite(value.remainingMs)||value.remainingMs<0||value.remainingMs>30000)return null;
 const at=Date.parse(value.resumeAt),future=Number.isFinite(at)&&at>=now-5000&&at<=now+30000;
 return {kind:'mouse',active:value.active,resumeAt:value.active&&!value.buttonsDown&&future?new Date(at).toISOString():null,remainingMs:value.active?Math.round(value.buttonsDown?value.remainingMs:future?Math.max(0,at-now):value.remainingMs):0,buttonsDown:value.buttonsDown,...(Number.isSafeInteger(value.revision)&&value.revision>=0?{revision:value.revision}:{})};
}
module.exports={DEFAULT_MOUSE_PAUSE,normalizeMousePause,mousePauseView};
