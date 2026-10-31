'use strict';
function movementView(data,now){
 const unknown=reason=>({available:false,status:'unknown',armed:null,reason});
 if(!data||typeof data!=='object')return unknown('Abre el control de movimiento para consultar su estado.');
 const at=Date.parse(data.at),age=now-at;
 if(!Number.isFinite(at)||age< -5000||age>5000)return {...unknown('El controlador no comunica un estado reciente.'),lastSeen:Number.isFinite(at)?data.at:null};
 if(typeof data.armed!=='boolean'||typeof data.busy!=='boolean'||!Number.isInteger(data.count)||data.count<0||!Number.isInteger(data.pid)||data.pid<=0)return unknown('Registro del controlador incompleto.');
 const end=Date.parse(data.endUtc),limit=Date.parse(data.hardStopUtc);
 if(data.armed&&(!Number.isFinite(end)||now>=end||(Number.isFinite(limit)&&now>=limit)))return unknown('El estado recibido supera su limite temporal; hay que revisar el controlador.');
 const status=data.error?'error':data.armed?'running':'stopped';
 return {available:true,status,armed:data.armed,busy:data.busy,at:data.at,pid:data.pid,count:data.count,autoSessionId:typeof data.autoSessionId==='string'?data.autoSessionId:null,autoOperatorStopped:typeof data.autoOperatorStopped==='string'?data.autoOperatorStopped:null,autoCount:Number.isInteger(data.autoCount)?data.autoCount:null,lastKey:['A','D','W','S'].includes(data.lastKey)?data.lastKey:null,holdMs:Number.isFinite(data.holdMs)?data.holdMs:null,intervalMs:Number.isFinite(data.intervalMs)?data.intervalMs:null,gameForeground:data.gameForeground===true,startUtc:Number.isFinite(Date.parse(data.startUtc))?data.startUtc:null,endUtc:Number.isFinite(end)?data.endUtc:null,hardStopUtc:Number.isFinite(limit)?data.hardStopUtc:null,reason:typeof data.reason==='string'?data.reason.slice(0,500):'',error:typeof data.error==='string'?data.error.slice(0,500):null};
}
module.exports={movementView};
