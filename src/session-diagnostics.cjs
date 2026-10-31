'use strict';

const serverNumber=value=>Number.isInteger(value)&&value>=1&&value<=5?value:null;
const text=value=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,240):'';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const gameMessages={
 afk_kick:{status:'game_afk_kick',title:'El juego muestra una expulsión por inactividad',detail:'Una captura reciente muestra el mensaje de expulsión por inactividad.'},
 server_restart:{status:'game_server_restart',title:'El juego muestra un reinicio de servidor',detail:'Una captura reciente muestra el aviso de reinicio del servidor.'},
 server_message_unknown:{status:'game_server_message',title:'El juego muestra un mensaje de servidor',detail:'Hay un mensaje reciente de servidor cuyo motivo no se ha identificado.'}
};
function recentGameMessage(screen,now){
 const age=now-Date.parse(screen?.capturedAt),message=Object.hasOwn(gameMessages,screen?.scene)?gameMessages[screen.scene]:null;
 if(!message||screen.status!=='verified_capture'||screen.gameForeground!==true||!UUID.test(screen.frameId||'')||!Number.isInteger(screen.gamePid)||screen.gamePid<1||!Number.isSafeInteger(screen.gameWindow)||screen.gameWindow<1||!Number.isFinite(age)||age<0||age>5000)return null;
 return {...message,evidence:{scene:screen.scene,capturedAt:screen.capturedAt,frameId:screen.frameId,gamePid:screen.gamePid,gameWindow:screen.gameWindow,ageSeconds:Math.floor(age/1000),server:null}};
}

// Consumes normalized views: their freshness flags remain the authority.
// This describes observations only; it never sends input, reconnects, or verifies a reward.
function sessionDiagnostics(state={}, {now=Date.now()}={}){
 const account=state?.account||{},movement=state?.movement||{};
 const gameMessage=recentGameMessage(state?.screen,now);
 const selected=serverNumber(state?.config?.selectedServer);
 const seeding=account.seedingFresh===true&&account.seeding&&typeof account.seeding==='object'?account.seeding:null;
 const observed=seeding?serverNumber(seeding.servidor):null;
 const knownPhase=seeding&&['sedeando','aguantando'].includes(seeding.estado);
 let presence='unknown';
 if(knownPhase&&observed){
  if(seeding.dentro===false)presence=seeding.estado==='sedeando'&&seeding.contando===true?'inconsistent':'away';
  else if(seeding.estado==='aguantando'&&seeding.dentro===true)presence='inside';
  else if(seeding.estado==='sedeando'&&seeding.contando===true)presence='seeding';
 }
 const presenceDetail=presence==='away'?`La cuenta te detecta fuera del #${observed}. El motivo no está identificado.`:
  presence==='seeding'?`La cuenta registra sedeo contando en el #${observed}. Esto no confirma un premio.`:
  presence==='inside'?`La cuenta te detecta dentro del #${observed} durante la espera. Esto no confirma un premio.`:
  presence==='inconsistent'?`La lectura del #${observed} combina contador activo y presencia fuera; revisa la cuenta antes de concluir qué ocurre.`:
  seeding?.estado==='nada'?'La cuenta no registra un ciclo de seeding. Este estado no identifica por sí solo una desconexión.':
  seeding?'La lectura de seeding no permite confirmar la presencia actual.':'No hay una lectura reciente de seeding; la presencia queda sin confirmar.';

 let motion='unknown',motionDetail='Sin un estado reciente del controlador no se puede comprobar el movimiento.';
 if(movement.available===true){
  if(movement.status==='error'||text(movement.error)){
   motion='error';motionDetail=`El controlador comunica un error${text(movement.error)?': '+text(movement.error):'.'}`;
  }else if(movement.status==='stopped'&&movement.armed===false){
   const reason=text(movement.reason);
   const normalizedReason=reason.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
   motion=/perdida de foco/i.test(normalizedReason)?'focus_stop':'stopped';
   motionDetail=motion==='focus_stop'?'El movimiento se detuvo por pérdida de foco; este dato no explica la presencia en el servidor.':`El movimiento está detenido${reason?': '+reason:'.'}`;
  }else if(movement.status==='running'&&movement.armed===true){
   motion='running';motionDetail='El controlador comunica una sesión en marcha. Esto no confirma despliegue ni permanencia en partida activa.';
  }
 }
 const result=(status,severity,title,action=null)=>({status,severity,title,detail:`${gameMessage?gameMessage.detail+' La captura no identifica el servidor del mensaje. ':''}${presenceDetail} ${motionDetail}`,action,observedServer:observed,...(gameMessage?{screenEvidence:gameMessage.evidence}:{})});

 // A controller fault is prominent, but the same detail retains any observed absence.
 if(motion==='error')return result('movement_error','error','Revisar el controlador',{kind:'review_movement'});
 if(gameMessage)return result(gameMessage.status,'warning',gameMessage.title,{kind:'review_game'});
 if(presence==='away')return result('account_away','warning',`La cuenta te detecta fuera del #${observed}`,{kind:'prepare_entry',server:observed});
 if(presence==='inconsistent')return result('presence_inconsistent','warning','Revisar la lectura de presencia',{kind:'refresh_account'});
 if(['inside','seeding'].includes(presence)&&selected&&observed!==selected){
  return result('server_mismatch','warning',`La cuenta señala el #${observed}; está seleccionado el #${selected}`,{kind:'review_server',server:observed});
 }
 if(motion==='focus_stop')return result('movement_focus_stop','info','Movimiento detenido al cambiar de ventana',{kind:'review_movement'});
 if(!seeding)return result('account_unknown','info','Presencia sin comprobar',{kind:'refresh_account'});
 if(presence==='seeding')return result('seeding_observed','info',`Sedeo registrado en el #${observed}`);
 if(presence==='inside')return result('presence_observed','info',`Cuenta detectada dentro del #${observed}`);
 if(seeding.estado==='nada')return result('no_seeding_cycle','info','Sin ciclo de seeding registrado');
 return result('presence_unknown','info','Presencia sin confirmar',{kind:'refresh_account'});
}

module.exports={sessionDiagnostics};
