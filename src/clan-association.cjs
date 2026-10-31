'use strict';
const IDENTITY_SOURCE='https://api.wardogsspain.com/api/cuenta/yo';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function normalizeClanAssociation(part,now){
 const unknown=(accountId=null,observedAt=null)=>({status:'unknown',accountId,observedAt,slug:null,tag:null,name:null});
 if(part===undefined)return unknown();
 if(!object(part)||part.source!==IDENTITY_SOURCE)throw Error('La fuente de identidad del clan no corresponde a Wardogs Spain.');
 const at=Date.parse(part.observedAt),age=now-at;
 if(!Number.isFinite(at)||age< -5000||age>=100000)throw Error('La identidad del clan no es reciente. Vuelve a consultar la cuenta.');
 const data=part.data;
 if(!object(data)||typeof data.conectado!=='boolean')return unknown(null,part.observedAt);
 if(!data.conectado)return {...unknown(null,part.observedAt),status:'disconnected'};
 const account=data.cuenta;
 if(!object(account)||typeof account.steamId!=='string'||!/^\d{17}$/.test(account.steamId))return unknown(null,part.observedAt);
 const base=unknown(account.steamId,part.observedAt);
 if(!Object.hasOwn(account,'equipo'))return base;
 if(account.equipo===null)return {...base,status:'no_clan'};
 const team=account.equipo;
 if(!object(team)||typeof team.slug!=='string'||team.slug.length>100||!SLUG.test(team.slug))return base;
 const clean=(value,max)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max):null;
 return {...base,status:'member',slug:team.slug,tag:clean(team.tag,32),name:clean(team.nombre??team.name,120)};
}
function currentClanAssociation(association,{running,now}){
 const at=Date.parse(association?.observedAt),age=now-at;
 if(!running)return {status:'disconnected',accountId:null,observedAt:null,slug:null,tag:null,name:null};
 if(!association||!Number.isFinite(at)||age< -5000||age>=100000)return {status:'unknown',accountId:null,observedAt:null,slug:null,tag:null,name:null};
 return {...association};
}
module.exports={IDENTITY_SOURCE,normalizeClanAssociation,currentClanAssociation};
