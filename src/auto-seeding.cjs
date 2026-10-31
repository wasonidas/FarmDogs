'use strict';
const {randomUUID}=require('node:crypto');
function isAdmittedSeedingContinuation(server,account){
 const data=account?.seedingFresh===true?account.seeding:null;
 // La admisión pública puede cerrarse mientras una cuenta sigue en su ciclo.
 return server?.trusted===true&&Number.isInteger(server.number)&&server.number>=1&&server.number<=5&&Number.isInteger(server.players)&&server.players>=0&&server.players<=100&&server.seedingActive===false&&server.publicRule?.aguantando===true&&['lleno','no_puntua'].includes(server.publicRule.estado)&&data?.servidor===server.number&&data.estado==='aguantando'&&data.dentro===true;
}
function createAutoSeeding({purpose='seeding',server,durationMinutes,startPlayers=20,intervalSeconds=60,holdMs=500,presenceMode='account',confirmedServer,confirmedDeployed},now){
 if(!['seeding','break'].includes(purpose))throw Error('Elige una sesión de seeding o de movimiento temporal.');
 if(!Number.isInteger(durationMinutes)||durationMinutes<1||durationMinutes>720)throw Error('Duración de 1 a 720 minutos.');
 if(!Number.isInteger(intervalSeconds)||intervalSeconds<5||intervalSeconds>300||!Number.isInteger(holdMs)||holdMs<100||holdMs>2000)throw Error('Ajustes de movimiento fuera de rango.');
 const createdAt=new Date(now).toISOString();
 if(purpose==='break'){
  if(confirmedDeployed!==true)throw Error('Confirma que ya estás desplegado en la partida para activar el movimiento.');
  return {id:randomUUID(),purpose,server:null,durationMinutes,startPlayers:null,intervalSeconds,holdMs,presenceMode:'manual',confirmedServer:null,confirmedDeployed:true,deploymentConfirmedAt:createdAt,createdAt,endAt:new Date(now+durationMinutes*60000).toISOString(),status:'waiting',thresholdObservedAt:null,startedMovementAt:null,operatorStopped:false,reason:'Movimiento temporal preparado; esperando tu personaje desplegado y Wardogs en primer plano.'};
 }
 if(!Number.isInteger(server)||server<1||server>5)throw Error('Elige un servidor del 1 al 5.');
 if(!Number.isInteger(startPlayers)||startPlayers<1||startPlayers>100)throw Error('Umbral de inicio de 1 a 100 jugadores.');
 if(!['account','manual'].includes(presenceMode))throw Error('Elige presencia mediante Steam o confirmación manual.');
 const manual=presenceMode==='manual';
 if(manual&&(!Number.isInteger(confirmedServer)||confirmedServer!==server))throw Error('Confirma que estás desplegado en el mismo servidor seleccionado.');
 return {id:randomUUID(),purpose,server,durationMinutes,startPlayers,intervalSeconds,holdMs,presenceMode,confirmedServer:manual?confirmedServer:null,manualConfirmedAt:manual?createdAt:null,createdAt,endAt:new Date(now+durationMinutes*60000).toISOString(),status:'waiting',thresholdObservedAt:null,startedMovementAt:null,operatorStopped:false,reason:manual?`Prueba sin lectura Steam: presencia confirmada por el usuario en el #${server}; esperando población y pantalla de juego.`:'Esperando población, presencia y pantalla de juego.'};
}
function advanceAutoSeeding(session,{server,account,screen,movement},now){
 const purpose=session.purpose===undefined?'seeding':session.purpose,temporary=purpose==='break';
 const mode=session.presenceMode===undefined?'account':session.presenceMode,manual=!temporary&&mode==='manual',prefix='Prueba sin lectura Steam: ';
 const describe=reason=>manual&&!String(reason).startsWith(prefix)?prefix+reason:reason;
 let next={...session};const decide=(status,reason,command=null)=>({session:{...next,status,reason:describe(reason)},command});
 if(['cancelled','expired','error','interrupted'].includes(session.status)||session.operatorStopped)return decide(session.status,session.reason);
 if(now>=Date.parse(session.endAt))return decide('expired',temporary?'Fin del movimiento temporal.':manual?'Fin de la sesión de prueba.':'Fin de la sesión de seeding.','stop');
 if(movement?.autoOperatorStopped===session.id){next.operatorStopped=true;return decide('cancelled','Movimiento detenido por el usuario.','stop');}
 if(!['seeding','break'].includes(purpose))return decide('error','El propósito de esta sesión de movimiento no es válido.','stop');
 if(temporary&&(session.confirmedDeployed!==true||session.presenceMode!=='manual'||session.server!==null||session.startPlayers!==null||!Number.isFinite(Date.parse(session.deploymentConfirmedAt))||session.deploymentConfirmedAt!==session.createdAt||Date.parse(session.deploymentConfirmedAt)>now))return decide('error','Falta una confirmación válida de que estás desplegado en la partida.','stop');
 if(!['account','manual'].includes(mode))return decide('error','El modo de presencia de esta sesión no es válido.','stop');
 if(manual&&(!Number.isInteger(session.confirmedServer)||session.confirmedServer!==session.server||!Number.isFinite(Date.parse(session.manualConfirmedAt))||session.manualConfirmedAt!==session.createdAt||Date.parse(session.manualConfirmedAt)>now))return decide('error','Falta una confirmación manual válida para este servidor.','stop');
 const moving=movement?.available===true&&movement.armed===true;
 if(movement?.available!==true)return decide('waiting_controller','Esperando un estado reciente del controlador.','stop');
 if(movement?.available===true&&movement.status==='error')return decide('error','Revisa el controlador antes de continuar.','stop');
 if(!temporary&&(!server?.trusted||server.number!==session.server||!Number.isInteger(server.players)||server.players<0||server.players>100||(!manual&&server.seedingActive!==true&&!isAdmittedSeedingContinuation(server,account))))return decide('waiting_source',manual?'Esperando datos recientes del servidor confirmado.':'Esperando datos recientes y seeding activo en el servidor.',moving?'stop':null);
 if(!temporary&&!manual){
  const data=account?.seedingFresh===true?account.seeding:null;
  const inside=data?.servidor===session.server&&((data.estado==='sedeando'&&data.contando===true&&data.dentro!==false)||(data.estado==='aguantando'&&data.dentro===true));
  if(!inside)return decide('waiting_presence',`Esperando que la cuenta confirme presencia en el #${session.server}.`,moving?'stop':null);
 }
 if(!temporary&&!session.thresholdObservedAt&&server.players<session.startPlayers)return decide('waiting_match',`Esperando inicio: ${server.players} / ${session.startPlayers} jugadores.`,moving?'stop':null);
 if(!temporary&&!next.thresholdObservedAt)next.thresholdObservedAt=new Date(now).toISOString();
 const age=now-Date.parse(screen?.capturedAt);
 const gameplay=screen?.status==='verified_capture'&&screen.scene==='gameplay_hud'&&screen.gameForeground===true&&Number.isInteger(screen.gamePid)&&screen.gamePid>0&&Number.isFinite(age)&&age>=0&&age<=5000;
 if(!gameplay)return decide('waiting_game','Esperando el juego desplegado en primer plano.',moving?'stop':null);
 if(moving&&movement.autoSessionId!==session.id)return decide('error','Hay otra sesión de movimiento; detenla antes de iniciar.','stop');
 if(moving&&!next.startedMovementAt)next.startedMovementAt=new Date(now).toISOString();
 return decide(moving?'moving':'starting_movement',moving?temporary?'Movimiento temporal en marcha.':'Automatismo en marcha.':'Solicitando movimiento automático.',moving?null:'start');
}
module.exports={createAutoSeeding,advanceAutoSeeding,isAdmittedSeedingContinuation};
