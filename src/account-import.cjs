'use strict';
const {normalizeClanAssociation}=require('./clan-association.cjs');
const VIP_SOURCE='https://api.wardogsspain.com/api/cuenta/vip';
const SEED_SOURCE='https://api.wardogsspain.com/api/cuenta/sedeo';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function readingTime(value,now){const t=typeof value==='string'?Date.parse(value):NaN;if(!Number.isFinite(t)||t>now+5000||now-t>=100000)throw Error('La lectura no es reciente. Vuelve a consultar la cuenta.');return t;}
function normalizeAccountImport(input,now){
 if(!object(input)||input.format!=='wardogs-account-snapshot-v1')throw Error('Formato de lectura no admitido.');
 if(input.readerId!==undefined&&(typeof input.readerId!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.readerId)))throw Error('Identificador del lector no válido.');
 readingTime(input.observedAt,now);
 if(!object(input.vip)||!object(input.seeding)||input.vip.source!==VIP_SOURCE||input.seeding.source!==SEED_SOURCE)throw Error('Las fuentes de cuenta no corresponden a Wardogs Spain.');
 readingTime(input.vip.observedAt,now);const seedAt=readingTime(input.seeding.observedAt,now);
 const v=input.vip.data,s=input.seeding.data;
 if(!object(v)||!object(v.prioridad)||typeof v.prioridad.comprobado!=='boolean'||typeof v.prioridad.tiene!=='boolean'||!Array.isArray(v.historial)||v.historial.length>1000)throw Error('La lectura VIP esta incompleta.');
 for(const r of v.historial)if(!object(r)||typeof r.origen!=='string'||!Number.isFinite(r.dias)||!Number.isFinite(Date.parse(r.at)))throw Error('Historial VIP no valido.');
 if(!object(s)||typeof s.estado!=='string'||!Number.isFinite(Date.parse(s.ahora))||Math.abs(Date.parse(s.ahora)-seedAt)>90000)throw Error('La lectura de seeding esta incompleta o atrasada.');
 if(s.servidor!==undefined&&(!Number.isInteger(s.servidor)||s.servidor<1||s.servidor>5))throw Error('Servidor de cuenta no admitido.');
 if(s.contando!==undefined&&typeof s.contando!=='boolean')throw Error('Estado del contador no valido.');
 return {status:'browser_snapshot',transport:input.readerId?'desktop_webview':'browser_import',readerId:input.readerId||null,observedAt:input.observedAt,ingestedAt:new Date(now).toISOString(),vip:structuredClone(input.vip),seeding:structuredClone(input.seeding),clanAssociation:normalizeClanAssociation(input.identity,now),errors:[]};
}
function browserBaselineFile(observedAt){
 const date=new Date(observedAt);if(!Number.isFinite(date.getTime()))throw Error('Referencia de cuenta sin fecha.');
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(p=>[p.type,p.value]));
 return `browser-account-baseline-${parts.year}-${parts.month}-${parts.day}.json`;
}
module.exports={normalizeAccountImport,browserBaselineFile,VIP_SOURCE,SEED_SOURCE};
