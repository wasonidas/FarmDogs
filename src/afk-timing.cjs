// Evidence analysis only: this module never reads windows or generates input.
function timestamp(value,label){
 if(typeof value!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw Error(label+': fecha ISO con zona requerida');
 return Date.parse(value);
}
function analyzeAfkTrial(trial){
 if(!trial||!Array.isArray(trial.observations)||!trial.observations.length)throw Error('Faltan observaciones');
 const input=trial.lastIdentifiedInput??null;
 let before=null,after=null;
 if(input){before=timestamp(input.beforeAt,'Última interacción');after=timestamp(input.afterAt,'Última interacción');if(after<before)throw Error('Límites de interacción invertidos');}
 let previous=-Infinity,lastConnected=null,terminal=null,uncertain=trial.activityUncertain===true,allCaptureWindows=true;
 for(const item of trial.observations){
  const bounded=item.captureStartedAt!==undefined||item.captureFinishedAt!==undefined;
  const started=timestamp(bounded?item.captureStartedAt:item.capturedAt,'Inicio de captura');
  const finished=timestamp(bounded?item.captureFinishedAt:item.capturedAt,'Fin de captura');
  if(finished<started)throw Error('Límites de captura invertidos');
  if(started<previous)throw Error('Las observaciones no están ordenadas');
  if(terminal)throw Error('Una transición o desconexión requiere un ensayo separado');
  if(after!==null&&started<after)throw Error('La captura precede a la última interacción');
  if(typeof item.evidence!=='string'||!item.evidence.trim())throw Error('Cada observación requiere una referencia de evidencia');
  const at=item.state==='connected'?started:finished;
  const observed={...item,capturedAt:new Date(at).toISOString(),at};
  allCaptureWindows=allCaptureWindows&&bounded;
  uncertain=uncertain||item.activityUncertain===true;
  if(item.state==='connected')lastConnected=observed;
  else if(item.state==='kicked'||item.state==='disconnected')terminal=observed;
  else if(item.state==='transition')terminal=observed;
  else throw Error('Estado de observación desconocido');
  previous=finished;
 }
 const outcome=terminal?.state==='transition'?'interrupted_by_transition':terminal?(terminal.state==='kicked'&&terminal.reason==='inactivity'?'kicked_for_inactivity':'other_disconnect'):'connected_at_last_observation';
 const result={server:typeof trial.server==='string'?trial.server:null,phase:typeof trial.phase==='string'?trial.phase:'unknown',outcome,afkTimerSettingKnown:false,boundsUseCaptureWindows:allCaptureWindows,activityUncertain:uncertain,lastIdentifiedInput:input,lastConnectedAt:lastConnected?.capturedAt??null,detectedAt:terminal?.capturedAt??null,detectionWindow:null,elapsedSinceLastIdentifiedInput:null};
 if(outcome==='kicked_for_inactivity'){
  if(typeof terminal.message!=='string'||!terminal.message.trim())throw Error('Falta el mensaje de expulsión observado');
  const lastAt=lastConnected?timestamp(lastConnected.capturedAt,'Última conexión'):null;
  result.message=terminal.message;
  result.detectionWindow={after:lastConnected?.capturedAt??null,atOrBefore:terminal.capturedAt,gapMs:lastAt===null?null:terminal.at-lastAt};
  if(input&&!uncertain&&lastAt!==null)result.elapsedSinceLastIdentifiedInput={moreThanMs:lastAt-after,atMostMs:terminal.at-before};
 }else if(outcome==='connected_at_last_observation'&&input&&!uncertain){
  result.elapsedSinceLastIdentifiedInput={atLeastMs:lastConnected.at-after,atMostMs:null};
 }
 return result;
}
module.exports={analyzeAfkTrial};
