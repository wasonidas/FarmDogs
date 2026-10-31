'use strict';
const {classifyGameScreen}=require('./game-screen.cjs');
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const text=v=>typeof v==='string'?v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toUpperCase():'';
// Coordinates always come from this OCR frame. This function alone grants no input.
function classifyEntryScreen(report,{server,joinId,typedJoinId=null,ownLookup=null}={}){
 const unknown={phase:'unknown',reason:'Esperando reconocer el siguiente paso de entrada.'};
 if(report?.format!=='wardogs-image-text-v1'||!Number.isInteger(report.width)||!Number.isInteger(report.height)||report.width<320||report.height<200||!Array.isArray(report.lines)||report.lines.length>1000)return unknown;
 const w=report.width,h=report.height,rows=[];
 for(const line of report.lines){
  if(!Array.isArray(line.words)||!line.words.length||!line.words.every(a=>['x','y','width','height'].every(k=>Number.isFinite(a[k]))&&a.x>=0&&a.y>=0&&a.width>0&&a.height>0&&a.x+a.width<=w+1&&a.y+a.height<=h+1))continue;
  const x=Math.min(...line.words.map(a=>a.x)),y=Math.min(...line.words.map(a=>a.y)),right=Math.max(...line.words.map(a=>a.x+a.width)),bottom=Math.max(...line.words.map(a=>a.y+a.height));
  const row={text:text(line.text).replace(/^#\s*0?([1-5])(?=\s*\[ESP\])/, '#$1'),bounds:{x,y,width:right-x,height:bottom-y},line};
  const duplicate=rows.some(a=>a.text===row.text&&Math.abs(a.bounds.x-x)<w*.012&&Math.abs(a.bounds.y-y)<h*.012);
  if(!duplicate)rows.push(row);
 }
 const exact=(regex,where=()=>true)=>rows.filter(a=>regex.test(a.text)&&where(a.bounds));
 const one=(regex,where)=>{const found=exact(regex,where);return found.length===1?found[0]:null;};
 const action=(phase,reason,key,row,kind='click')=>({phase,reason,action:{key,kind,bounds:row.bounds}});
 const top=b=>b.y<h*.12,left=b=>b.x<w*.42,bottom=b=>b.y>h*.55&&b.y<h*.92,center=b=>b.x>w*.2&&b.x+b.width<w*.87&&b.y>h*.15&&b.y+b.height<h*.88;
 const basic=classifyGameScreen({...report,lines:rows.map(row=>row.line)},{expectedServer:server});
 if(['afk_kick','server_restart','server_message_unknown','join_wrong_server'].includes(basic.phase))return {phase:'error',reason:basic.reason};
 // Only the driver can derive this context from its completed native UUID write
 // and lookup, bound to the same game window and fresh capture. A server may
 // rename every word, but the result must still show its expected number in
 // the complete join modal. Critical execution rechecks the public UUID too.
 const owned=Number.isInteger(server)&&server>=1&&server<=5&&UUID.test(joinId||'')&&ownLookup?.server===server&&UUID.test(ownLookup?.joinId||'')&&ownLookup.joinId.toLowerCase()===joinId.toLowerCase();
 if(owned){
  const header=one(/^[¿?]?(?:UNIRSE AL SERVIDOR DEL JUEGO|JOIN GAME SERVER)[?]?$/,center);
  const join=one(/^(?:UNIRSE A LA PARTIDA|JOIN GAME)$/,center),cancel=one(/^(?:CANCELAR|CANCEL)$/,center);
  if(header&&join&&cancel){
   if(rows.some(row=>center(row.bounds)&&/^(?:EXPULSADO|KICKED|MENSAJE DEL SERVIDOR|SERVER MESSAGE)$/.test(row.text)))return {phase:'error',reason:'La confirmación contiene mensajes de servidor contradictorios.'};
   const numbered=[];
   for(const row of rows){
    if(!center(row.bounds)||row.bounds.y<header.bounds.y+header.bounds.height||row.bounds.y+row.bounds.height>Math.min(join.bounds.y,cancel.bounds.y))continue;
    const match=row.text.match(/^#\s*(\d{1,3})(?=\s|\[|$)(?:\s*\S.*)?$/);if(!match)continue;
    const number=Number(match[1]);
    if(!numbered.some(other=>other.server===number&&Math.abs(other.bounds.x-row.bounds.x)<w*.015&&Math.abs(other.bounds.y-row.bounds.y)<h*.015))numbered.push({server:number,bounds:row.bounds});
   }
   if(numbered.length!==1)return {phase:'error',reason:numbered.length?'La confirmación contiene varios servidores numerados.':'No se puede leer el número del servidor en la confirmación. No se enviarán clics.'};
   if(numbered[0].server!==server)return {phase:'error',reason:'La confirmación muestra otro servidor (#'+numbered[0].server+').'};
   return {...action('join_confirmation','Confirmando el servidor #'+server+' obtenido por su ID.','confirm_join',join),server};
  }
 }
 if(basic.phase==='join_confirmation')return {...action('join_confirmation','Confirmando Wardogs Spain #'+server+'.','confirm_join',{bounds:basic.buttonCandidate.bounds}),server:basic.server};
 if(basic.phase==='gameplay_hud')return {phase:'gameplay_hud',reason:'Personaje desplegado con manos vacías.'};
 const faction=one(/^(?:\/{1,3}\s*)?(?:SELECCIONAR FACCION|SELECT FACTION)$/,center);
 const abandon=one(/^(?:ABANDONAR PARTIDA|LEAVE MATCH)$/,b=>b.y>h*.9&&left(b));
 if(faction&&abandon)return {phase:'team_selector',reason:'Selector de facción reconocido. Preparando el equipo elegido.'};
 const deploying=one(/^(?:\/{1,3}\s*)?(?:DESPLEGANDO|DEPLOYING|ENTRANDO|ENTERING)(?:\s*\.{0,3})?$/,center);
 if(deploying&&abandon)return {phase:'deploying',reason:'El juego está entrando o desplegando. Sin nuevos clics de conexión.'};
 // The game's own pointer can cover a letter of DESPLEGAR. The independent
 // JUGAR header, SERVER BROWSER caption and positive panel colour still identify
 // this exact control; no fuzzy spelling or selected-server inference is used.
 const mainPlay=one(/^(?:JUGAR|PLAY)$/,b=>top(b)&&left(b));
 const mainBrowser=one(/^(?:NAVEGADOR DEL SERVIDOR|SERVER BROWSER)$/,b=>b.x<w*.24&&b.y>h*.70&&b.y<h*.84);
 if(basic.phase==='main_menu'||mainPlay&&mainBrowser){
  if(report.controls?.mainDeploy?.enabled!==true)return {phase:'main_menu',reason:'Esperando a que Desplegar termine de cargar y aparezca a pleno color.'};
  return action('main_menu','Abriendo Desplegar.','main_deploy',{bounds:basic.phase==='main_menu'?basic.buttonCandidate.bounds:mainBrowser.bounds});
 }
 const splash=one(/^(?:PULSA UN BOTON PARA EMPEZAR|PRESS ANY (?:BUTTON|KEY) TO (?:START|CONTINUE))$/,b=>b.x>w*.25&&b.x<w*.7&&bottom(b));
 if(splash)return action('splash','Iniciando Wardogs.','splash_continue',splash,'press_start');
 const deployHeader=one(/^(?:DESPLEGAR|DEPLOY)$/,b=>top(b)&&left(b));
 const community=one(/^(?:COMUNIDAD|COMMUNITY)$/,b=>bottom(b)&&b.x>w*.32&&b.x<w*.65);
 const official=one(/^(?:OFICIAL|OFFICIAL)$/,b=>bottom(b)&&b.x<w*.4);
 if(deployHeader&&community&&official)return action('server_categories','Abriendo servidores de comunidad.','community',community);
 const communityHeader=one(/^(?:COMUNIDAD|COMMUNITY)$/,b=>top(b)&&left(b));
 const byId=one(/^(?:UNIRSE (?:POR|CON) (?:EL )?ID|UNIRSE POR ID DE SERVIDOR|JOIN (?:BY|VIA) (?:SERVER )?ID)$/,b=>b.y>h*.5&&b.y<h*.96);
 if(communityHeader&&byId)return action('community_browser','Abriendo entrada por ID.','join_by_id',byId);
 const idHeader=one(/^(?:BUSCAR SERVIDOR|FIND SERVER|UNIRSE (?:POR|CON) (?:EL )?ID|UNIRSE POR ID DE SERVIDOR|JOIN (?:BY|VIA) (?:SERVER )?ID)$/,center);
 const lookup=one(/^(?:BUSCAR|BUSQUEDA|LOOKUP|LOOK UP|SEARCH)$/,center);
 const cancel=one(/^(?:CANCELAR|CANCEL)$/,center);
 const idLabel=one(/^(?:ID (?:DEL? )?SERVIDOR|SERVER ID|IDENTIFICACION DEL SERVIDOR\.{0,3}|ENTER SERVER ID)$/,center);
 const idInstruction=one(/^(?:INTRODUCE LA IDENTIFICACION DEL SERVIDOR|ENTER (?:THE )?SERVER (?:ID|IDENTIFICATION))$/,center);
 const idValue=rows.filter(a=>UUID.test(a.text)&&center(a.bounds));
 if(idHeader&&idInstruction&&lookup&&cancel){
  const value=idValue.length===1?idValue[0]:null;
  // Wardogs masks the ID. Only this driver's completed native write can attest
  // masked content; a prefilled field or an HTTP confirmation cannot do so.
  const written=typedJoinId===joinId&&UUID.test(typedJoinId||'');
  if(written&&(!value||value.text===joinId.toUpperCase()))return action('join_id_ready','ID escrito por esta sesión. Buscando el servidor.','lookup',lookup);
  const target=value||idLabel;
  if(target){
   const step=action('join_id_input','Escribiendo el ID del servidor seleccionado.','type_join_id',target,'replace_join_id');
   // A dark placeholder or the field's changing value is not a stable patch.
   // Recheck the same verified instruction used for an empty field instead.
   step.action.anchorBounds=idInstruction.bounds;return step;
  }
  // Empty-field text is too dark for OCR. Locate the field immediately below
  // the verified instruction; the native helper rechecks the instruction patch.
  const b=idInstruction.bounds,field={x:b.x+w*.006,y:b.y+b.height+h*.023,width:Math.min(b.width*.7,w*.23),height:h*.023};
  return {phase:'join_id_input',reason:'Escribiendo el ID en el cuadro reconocido.',action:{key:'type_join_id',kind:'replace_join_id',bounds:field,anchorBounds:b}};
 }
 const queue=rows.find(a=>center(a.bounds)&&/^(?:POSICION EN (?:LA )?COLA|QUEUE POSITION|EN COLA|QUEUED)(?:\s*[:#]?\s*\d.*)?$/.test(a.text));
 if(queue&&cancel)return {phase:'queue',reason:'En cola del servidor. Esperando plaza sin repetir la conexión.'};
 return unknown;
}
module.exports={classifyEntryScreen};
