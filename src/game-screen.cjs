'use strict';
// Read-only classification of OCR, including archived images. Never authorizes input.
function classifyGameScreen(report,{expectedServer=null}={}){
 const unknown=reason=>({phase:'unknown',reason,inputAllowed:false,activeMatchVerified:false});
 if(!report||report.format!=='wardogs-image-text-v1'||!Number.isInteger(report.width)||!Number.isInteger(report.height)||report.width<1||report.height<1||!Array.isArray(report.lines)||report.lines.length>1000)return unknown('Formato de lectura no válido.');
 const normalize=value=>typeof value==='string'?value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toUpperCase():'';
 const rows=[],allRows=[],allWords=[];
 for(const line of report.lines){
  if(!Array.isArray(line.words)||!line.words.length||line.words.length>300)continue;
  if(!line.words.every(w=>['x','y','width','height'].every(k=>Number.isFinite(w[k]))&&w.x>=0&&w.y>=0&&w.width>0&&w.height>0&&w.x+w.width<=report.width+1&&w.y+w.height<=report.height+1))continue;
  for(const word of line.words)allWords.push({text:normalize(word.text),bounds:{x:word.x,y:word.y,width:word.width,height:word.height}});
  const x=Math.min(...line.words.map(w=>w.x)),y=Math.min(...line.words.map(w=>w.y));
  const right=Math.max(...line.words.map(w=>w.x+w.width)),bottom=Math.max(...line.words.map(w=>w.y+w.height));
  const row={text:normalize(line.text),bounds:{x,y,width:right-x,height:bottom-y}};allRows.push(row);
  // Chat and edge overlays are not modal anchors.
  if(x<report.width*.15||right>report.width*.90||y<report.height*.20||bottom>report.height*.85)continue;
  rows.push(row);
 }
 const exact=pattern=>rows.filter(row=>pattern.test(row.text));
 const all=rows.map(row=>row.text).join(' ');
 const next=exact(/^(?:CONTINUAR|CONTINUE)$/);
 const expelled=exact(/^(?:EXPULSADO|KICKED)$/).length>0;
 const message=exact(/^(?:MENSAJE DEL SERVIDOR|SERVER MESSAGE)$/).length>0;
 const afk=expelled&&/SE TE HA DESCONECTADO DEL SERVIDOR POR INACTIVIDAD\b|DISCONNECTED FROM THE SERVER FOR INACTIVITY\b/.test(all);
 const restart=message&&/SERVIDOR SE ESTA REINICIANDO\b|SERVER IS RESTARTING\b/.test(all);
 const header=exact(/^[¿?]?(?:UNIRSE AL SERVIDOR DEL JUEGO|JOIN GAME SERVER)[?]?$/);
 const join=exact(/^(?:UNIRSE A LA PARTIDA|JOIN GAME)$/);
 const cancel=exact(/^(?:CANCELAR|CANCEL)$/);
 const serverRows=[];
 for(const row of rows){
  // The number and exact community name identify the destination. Servers may
  // append a mode after a separator; OCR also reads the vertical bar as I.
  const match=row.text.match(/^#\s*0?([1-5])\s*\[ESP\]\s*WARDOGSSPAIN\.COM(?:\s+[|I]\s+\S.*)?$/);
  if(!match)continue;
  const server=Number(match[1]);
  const duplicate=serverRows.some(other=>other.server===server&&Math.abs(other.bounds.x-row.bounds.x)<report.width*.015&&Math.abs(other.bounds.y-row.bounds.y)<report.height*.015);
  if(!duplicate)serverRows.push({server,bounds:row.bounds});
 }
 const joinModal=header.length===1&&join.length===1&&cancel.length===1&&serverRows.length===1;
 if((afk&&restart)||((afk||restart)&&joinModal))return unknown('Lectura con estados contradictorios.');
 const result=(phase,reason,button=null)=>({phase,reason,inputAllowed:false,activeMatchVerified:false,buttonCandidate:button?{bounds:button.bounds}:null});
 if(next.length===1&&afk)return result('afk_kick','El mensaje visible indica inactividad.',next[0]);
 if(next.length===1&&restart)return result('server_restart','El mensaje visible indica reinicio del servidor.',next[0]);
 if(joinModal){
  const server=serverRows[0].server;
  if(expectedServer!==null&&(!Number.isInteger(expectedServer)||expectedServer<1||expectedServer>5))return unknown('Servidor esperado no válido.');
  return {...result(expectedServer!==null&&server!==expectedServer?'join_wrong_server':'join_confirmation',`Confirmación visible para Wardogs Spain #${server}.`,join[0]),server};
 }
 if(next.length===1&&(message||expelled))return result('server_message_unknown','Mensaje de servidor con motivo sin identificar.',next[0]);
 const play=allRows.filter(row=>/^(?:JUGAR|PLAY)$/.test(row.text)&&row.bounds.y<report.height*.08&&row.bounds.x<report.width*.4);
 const deploy=allRows.filter(row=>/^(?:DESPLEGAR|DEPLOY)$/.test(row.text)&&row.bounds.x<report.width*.4&&row.bounds.y>report.height*.55&&row.bounds.y<report.height*.83);
 const browser=allRows.filter(row=>/^(?:NAVEGADOR DEL SERVIDOR|SERVER BROWSER)$/.test(row.text)&&row.bounds.x<report.width*.4&&row.bounds.y>report.height*.6&&row.bounds.y<report.height*.9);
 if(play.length===1&&deploy.length===1&&browser.length===1)return result('main_menu','Menú principal reconocido por sus tres anclas de navegación.',deploy[0]);
 const blockers=allRows.some(row=>/^(?:CONTINUAR|CONTINUE|CANCELAR|CANCEL|COMPRAR|BUY|EQUIPAR|EQUIP|AJUSTES|SETTINGS|SELECCIONAR EQUIPO|SELECT TEAM)$/.test(row.text)||/^(?:\/{1,3}\s*)?(?:SELECCIONAR FACCION|SELECT FACTION)$/.test(row.text)||/^(?:\/{1,3}\s*)?(?:CARGANDO|LOADING|DESPLEGANDO|DEPLOYING|ENTRANDO|ENTERING)(?:\s*\.{0,3})?$/.test(row.text)||/ESCRIBE UN MENSAJE|TYPE A MESSAGE/.test(row.text));
 const fists=allRows.filter(row=>/^(?:FISTS|PUNOS)$/.test(row.text)&&row.bounds.x>report.width*.85&&row.bounds.y>report.height*.78);
 // Icons beside the health value may share its OCR line. Use the literal numeric
 // word, retaining its original geometry; overlapping passes describe one anchor.
 const health=[];
 for(const word of allWords.filter(row=>/^\d{1,3}$/.test(row.text)&&Number(row.text)>0&&Number(row.text)<=100&&row.bounds.x>report.width*.90&&row.bounds.y>report.height*.90)){
  const duplicate=health.some(existing=>{
   if(existing.text!==word.text)return false;
   const a=existing.bounds,b=word.bounds;
   const area=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
   return area>=Math.min(a.width*a.height,b.width*b.height)*.25;
  });
  if(!duplicate)health.push(word);
 }
 const compass=allRows.filter(row=>{
  const heading=row.text.match(/^\|?\s*([0-9]{1,3})\s*(?:N|NE|E|SE|S|SW|W|NW)$/);
  return heading&&Number(heading[1])<=359&&row.bounds.x>report.width*.25&&row.bounds.x<report.width*.75&&row.bounds.y<report.height*.08;
 });
 const control=allRows.filter(row=>/^CONTROL:\s*(?:LONESTAR|VALKYRA|MANTICORE)$/.test(row.text)&&row.bounds.x>report.width*.01&&row.bounds.x+row.bounds.width<report.width*.25&&row.bounds.y>report.height*.92&&row.bounds.y+row.bounds.height<report.height*.99);
 const third=compass.length===1||compass.length===0&&control.length===1;
 if(!blockers&&fists.length===1&&health.length===1&&third)return result('gameplay_hud',compass.length===1?'HUD de personaje con manos vacías, salud y brújula reconocido.':'HUD de personaje con manos vacías, salud y control de facción reconocido.');
 return unknown('No hay suficientes anclas de interfaz verificadas.');
}
module.exports={classifyGameScreen};
