'use strict';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const text=value=>typeof value==='string'?value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toUpperCase():'';

function rowsFrom(report){
 if(report?.format!=='wardogs-image-text-v1'||!Number.isInteger(report.width)||!Number.isInteger(report.height)||report.width<320||report.height<200||!Array.isArray(report.lines)||report.lines.length>1000)return null;
 const rows=[];
 for(const line of report.lines){
  if(!Array.isArray(line.words)||!line.words.length||line.words.length>300)continue;
  if(!line.words.every(w=>typeof w.text==='string'&&['x','y','width','height'].every(k=>Number.isFinite(w[k]))&&w.x>=0&&w.y>=0&&w.width>0&&w.height>0&&w.x+w.width<=report.width+1&&w.y+w.height<=report.height+1))continue;
  const x=Math.min(...line.words.map(w=>w.x)),y=Math.min(...line.words.map(w=>w.y));
  const right=Math.max(...line.words.map(w=>w.x+w.width)),bottom=Math.max(...line.words.map(w=>w.y+w.height));
  rows.push({text:text(line.words.map(w=>w.text).join(' ')),x,y,right,bottom,width:right-x,height:bottom-y});
 }
 return rows;
}
function classifyTeamEntry(report){
 const unknown=reason=>({phase:'unknown',reason,selectorPending:false,entryConfirmed:false,inputAllowed:false,activeMatchVerified:false});
 const rows=rowsFrom(report);if(!rows)return unknown('Formato de confirmación de equipo no válido.');
 const w=report.width,h=report.height;
 const markers=rows.filter(r=>((r.x>=w*.2&&r.right<=w*.85&&r.y>=h*.2&&r.bottom<=h*.8)||(r.x>=w*.6&&r.right<=w*.99&&r.y>=h*.75&&r.bottom<=h*.985))&&r.height>=Math.max(14,h*.01)&&/^(?:\/{1,3}\s*)?(?:DESPLEGANDO|DEPLOYING)(?:\s*\.{1,3}|\s*…)?$/.test(r.text));
 if(!markers.length)return unknown('Todavía no se ha leído DESPLEGANDO; el OCR no cambia los clics.');
 // Overlapping OCR passes may describe one label. Separate copies of the
 // marker are ambiguous and must not be treated as the deployment heading.
 const first=markers[0];
 if(markers.some(r=>Math.max(0,Math.min(r.right,first.right)-Math.max(r.x,first.x))*Math.max(0,Math.min(r.bottom,first.bottom)-Math.max(r.y,first.y))<Math.min(r.width*r.height,first.width*first.height)*.5))return unknown('Marcador de despliegue ambiguo.');
 return {phase:'deploying',reason:'DESPLEGANDO visible como etiqueta independiente en una zona de despliegue.',selectorPending:false,entryConfirmed:true,inputAllowed:false,activeMatchVerified:false};
}
function clickerAttempt(current,sessionId){
 if(current?.sessionId!==sessionId||!UUID.test(sessionId||'')||current.active!==true||!UUID.test(current.attemptId||'')||!Number.isInteger(current.count)||current.count<0||!Number.isInteger(current.gamePid)||current.gamePid<1||!Number.isSafeInteger(current.gameWindow)||current.gameWindow<1||typeof current.attemptStartedAt!=='string'||!current.attemptStartedAt.endsWith('Z')||!Number.isFinite(Date.parse(current.attemptStartedAt)))return null;
 return {sessionId,attemptId:current.attemptId,attemptStartedAt:current.attemptStartedAt,gamePid:current.gamePid,gameWindow:current.gameWindow,count:current.count};
}
function attemptKey(attempt){return attempt?[attempt.sessionId,attempt.attemptId,attempt.attemptStartedAt,attempt.gamePid,attempt.gameWindow].join('|'):null;}
function currentAttemptScreen(screen,attempt,now){
 const age=now-Date.parse(screen?.capturedAt);
 return !!attempt&&screen?.status==='verified_capture'&&screen.gameForeground===true&&screen.gamePid===attempt.gamePid&&screen.gameWindow===attempt.gameWindow&&UUID.test(screen.frameId||'')&&Number.isFinite(age)&&age>=0&&age<=5000&&Date.parse(screen.capturedAt)>=Date.parse(attempt.attemptStartedAt);
}
function entryProof(screen,attempt,now){
 if(!currentAttemptScreen(screen,attempt,now)||attempt.count<1||screen.entryConfirmed!==true||screen.scene!=='deploying')return null;
 return {...attempt,frameId:screen.frameId,capturedAt:screen.capturedAt,scene:screen.scene};
}
module.exports={classifyTeamEntry,clickerAttempt,attemptKey,currentAttemptScreen,entryProof};
