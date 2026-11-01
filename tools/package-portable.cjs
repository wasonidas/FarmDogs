'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const fixed=['FarmDogs.exe','LICENSE','README.md','package.json','bin/FarmDogsApp.exe','bin/WardogsMovement.exe','bin/WardogsTeamClicker.exe','bin/team-clicker-capabilities.json','bin/WardogsEntry.exe','bin/entry-capabilities.json','bin/FarmDogsUpdater.exe','bin/WardogsImageText.exe','bin/Microsoft.Web.WebView2.Core.dll','bin/Microsoft.Web.WebView2.WinForms.dll','bin/WebView2Loader.dll','bin/movement-capabilities.json','bin/runtime/node.exe','bin/runtime/LICENSE','bin/runtime/runtime.json'];
const files=[...fixed];
const desktopStaged=process.argv.includes('--staging-desktop');
const sourceFile=relative=>path.join(root,desktopStaged&&relative==='bin/FarmDogsApp.exe'?'bin/FarmDogsApp.next.exe':relative);
for(const directory of ['src','public'])for(const entry of fs.readdirSync(path.join(root,directory),{withFileTypes:true}))if(entry.isFile()&&(/\.(?:cjs|js|html|css)$/.test(entry.name)||directory==='public'&&/\.(?:png|ttf|txt)$/.test(entry.name)))files.push(directory+'/'+entry.name);
for(const relative of files)if(!fs.statSync(sourceFile(relative)).isFile())throw Error('Falta '+relative);
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const cap=JSON.parse(fs.readFileSync(path.join(root,'bin/movement-capabilities.json')));
if(cap.sha256!==hash(path.join(root,'bin/WardogsMovement.exe')))throw Error('El controlador y sus capacidades no coinciden.');
const clickCap=JSON.parse(fs.readFileSync(path.join(root,'bin/team-clicker-capabilities.json')));
if(clickCap.format!=='wardogs-team-clicker-capabilities-v1'||clickCap.teamClicker!==true||clickCap.automaticTeamRecognition!==true||clickCap.automaticTeamSelection!==true||clickCap.automaticAnyTeam!==true||clickCap.messageHotkeys!==true||clickCap.persistentTeamAttempt!==true||clickCap.positiveEntryConfirmation!==true||clickCap.sha256!==hash(path.join(root,'bin/WardogsTeamClicker.exe')))throw Error('El autoclic y sus capacidades no coinciden.');
const entryCap=JSON.parse(fs.readFileSync(path.join(root,'bin/entry-capabilities.json')));
if(entryCap.automaticEntry!==true||entryCap.stopWatcher!==true||entryCap.mainDeployGate!==true||entryCap.splashKeyStart!==true||entryCap.absolutePointer!==true||entryCap.restartRecovery!==true||entryCap.sha256!==hash(path.join(root,'bin/WardogsEntry.exe')))throw Error('La entrada automática y sus capacidades no coinciden.');
const stamp=new Date().toISOString().replace(/[^0-9]/g,'');
const build=path.join(root,'dist','portable-'+stamp),folder=path.join(build,'FarmDogs');
fs.mkdirSync(folder,{recursive:true});
for(const relative of files){const destination=path.join(folder,relative);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(sourceFile(relative),destination);}
const sdk=path.join(root,'data/dependencies/webview2-1.0.4314.35/sdk.nupkg');
for(const member of ['LICENSE.txt','NOTICE.txt']){
 const contents=execFileSync('tar.exe',['-xOf',sdk,member],{maxBuffer:2*1024*1024,windowsHide:true});
 fs.mkdirSync(path.join(folder,'licenses'),{recursive:true});fs.writeFileSync(path.join(folder,'licenses','WebView2-'+member),contents);
}
fs.writeFileSync(path.join(folder,'LEEME.txt'),[
 'FARMDOGS LAUNCHER 0.5.4 - Windows x64',
 'Entrada automática, equipo elegido, anti-AFK opcional al desplegar y actualizaciones automáticas.',
 '',
 'Extrae esta carpeta completa y abre FarmDogs.exe con doble clic.',
 'Conserva las carpetas bin, src y public junto al ejecutable. Node está incluido.',
 'Usa WebView2 de Windows; Steam y Wardogs deben estar instalados.',
 '',
 'Cuatro secciones: JUGAR, SEEDING, EQUIPO y MI VIP.',
 'Anti-AFK tiene un acceso directo visible en todas las secciones para una ausencia breve dentro de cualquier partida de Wardogs.',
 'Elige 5, 15 o 30 minutos o una duración propia; puedes ajustar tiempo entre pasos y duración de cada paso.',
 'Confirma que estás desplegado y con las manos vacías, pulsa Activar anti-AFK y vuelve al juego. No requiere Steam en la app, servidor elegido ni población.',
 'Solo mueve con HUD reconocido y Wardogs delante. Los menús o la pérdida de foco pausan; F8/Detener y el tiempo máximo cancelan.',
 'FarmDogs muestra un aviso grande y reproduce un sonido cuando necesites poner el juego delante.',
 'La entrada automática intenta activar Wardogs una sola vez al empezar. Si cambias después de aplicación, espera y avisa sin recuperar el foco.',
 'Los avisos nativos funcionan con FarmDogs minimizada. Avisos con sonido permite silenciarlos; Probar aviso muestra un ejemplo.',
 'Conecta Steam desde Mi VIP para consultar premios y presencia. No se incluye ninguna sesión privada.',
 'El autoclic no necesita Steam conectado a la app.',
 'En Elegir equipo, elige azul/rojo/verde y pulsa Esperar equipo.',
 'En Entrar, elige servidor y equipo y pulsa Entrar automáticamente. FarmDogs abre Wardogs, recorre sus menús, escribe el ID y confirma el destino.',
 'En JUGAR, marca Activar anti-AFK al desplegar para prepararlo en la misma entrada. Usa los ajustes de Anti-AFK; su duración empieza al confirmar el despliegue, no durante la cola.',
 'Es opcional y no necesita Steam conectado a la app ni población mínima. Espera HUD válido, manos vacías y juego delante; F8 y Detener conservan parada.',
 'Puedes usar Elegir equipo por separado si prefieres entrar tú al servidor. Al aparecer el selector, FarmDogs reconoce la tarjeta y empieza a clicar automáticamente.',
 'No necesitas teclas de inicio, colocar el cursor ni guardar coordenadas.',
 'Cancelar detiene la espera o los clics; F8 conserva la parada de emergencia.',
 'Mantiene clics continuos al intervalo elegido. El color apagado o el equilibrio no pausan el bucle.',
 'Se detiene automáticamente al leer DESPLEGANDO. Esa lectura trabaja en paralelo con los clics.',
 'El modo automático pausa sin clicar al perder el foco o con modificadores; al volver exige reconocer de nuevo el selector de la misma ventana y tamaño.',
 'Mover el ratón o un color apagado no cancelan. No bloquea el ratón: mientras clica vuelve a situarlo sobre el equipo. F8/Cancelar sí terminan.',
 'La ventana del launcher es compacta y fija; se minimiza al ceder el foco inicial autorizado al juego. No recupera el foco indefinidamente.',
 'Si Wardogs tiene permisos superiores al controlador, informa para cerrar FarmDogs por completo y abrirla como administrador, o abrir ambos normalmente.',
 'Después de DESPLEGANDO, el autoclic se desactiva y puedes preparar seeding.',
 'El usuario ha confirmado en el juego el recorrido de entrada, equipo, despliegue y anti-AFK opcional.',
 'En Seeding, selecciona servidor, equipo y duración y pulsa Entrar y seedear. FarmDogs completa la entrada y el despliegue.',
 'Si falla el portapapeles, la apertura sigue y el ID permanece visible para copiarlo manualmente.',
 'Continuar seeding conserva un ciclo ya confirmado por tu cuenta aunque se cierren nuevas admisiones; no vuelve a abrir el juego.',
 'El movimiento espera por defecto a 20 jugadores, presencia de tu cuenta y HUD con manos vacías en primer plano.',
 'Si ya estás desplegado, marca la casilla de confirmación manual para usar movimiento sin conectar Steam a la app.',
 'F8 o Detener sesión cancelan el automatismo. La entrada, equipo y despliegue se verifican antes de preparar el movimiento.',
 'Si un reinicio confirmado interrumpe un seeding con entrada propia verificada, puede recuperar una sola vez el mismo servidor y equipo sin ampliar el plazo.',
 'Espera datos válidos del servidor y no vuelve a abrir Steam ni recupera el foco. F8 o Detener cancelan también esa espera.',
 'No recupera expulsiones AFK, mensajes desconocidos, cambios de ID ni sesiones con presencia confirmada sólo de forma manual.',
 'También puedes programar cuándo se prepara la sesión; el PC y el servicio deben seguir encendidos.',
 'El modo por actividad vigila los cinco servidores, elige un destino y prepara una sola sesión.',
 'Cobro antes de caducar puede proteger los retos semanales; actívalo con Steam conectado en la app.',
 'Espera al plazo final publicado por Wardogs y cobra con el margen elegido. Necesita PC y app encendidos.',
 'No cobra el premio actual al activar la protección. Los resultados inciertos requieren revisión.',
 '',
 'La recepción automática de avisos de Discord todavía NO está conectada.',
 'La versión base superó 579 pruebas automáticas. El usuario confirmó entrada, equipo, despliegue y anti-AFK opcional en el juego.',
 'En un ensayo anterior hubo 25 minutos de partida activa sin expulsión observada y un día nuevo de VIP por sedeo verificado. Hubo pausas de lectura y una reanudación manual.',
 'Quedan pendientes pruebas reales completas de entrada por actividad, recuperación tras reinicio y esperas muy largas por cola o equipo.',
 'Si el monitor de seguridad deja de responder, se detienen las entradas. No significa que hayas pulsado F8.',
 'El reconocimiento puede pausar o fallar. No se garantiza evitar cualquier expulsión ni conseguir VIP.',
 'Reglas de premios: https://wardogsspain.com/vip',
 '',
 'Los datos que cree la app se guardan en data junto a ella. Este paquete no contiene data, cuentas, cookies, historial ni capturas.',
 'Node incluye su LICENSE completo en bin/runtime. WebView2 incluye LICENSE y NOTICE en licenses.',
 'FarmDogs comprueba nuevas versiones públicas de wasonidas/FarmDogs en GitHub, verifica el ZIP y espera a estar inactiva para instalar.',
 'La actualización conserva data y el perfil Steam y vuelve a abrir FarmDogs sin reactivar una sesión anterior.',
 'Deja marcada Actualizar automáticamente en la tarjeta Actualizaciones. Las betas no se instalan solas.',
 'Si tu versión antigua no muestra Actualizaciones, descarga una vez el ZIP nuevo y conserva tu carpeta data al sustituir los archivos. No compartas data.'
].join('\r\n'),'utf8');
const payload=[...files,'LEEME.txt','licenses/WebView2-LICENSE.txt','licenses/WebView2-NOTICE.txt'].sort();
const manifest={format:'wardogs-portable-v1',application:'FarmDogs',version:JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,createdAt:new Date().toISOString(),platform:'win32-x64',privateDataIncluded:false,files:payload.map(relative=>({path:relative,sha256:hash(path.join(folder,relative))}))};
fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(manifest,null,2));
const archive=path.join(build,'FarmDogs-portable.zip');
execFileSync('tar.exe',['-a','-cf',archive,'-C',build,'FarmDogs'],{windowsHide:true,timeout:60000});
const entries=execFileSync('tar.exe',['-tf',archive],{windowsHide:true,encoding:'utf8'}).trim().split(/\r?\n/);
const allowed=new Set([...payload,'manifest.json'].map(relative=>'FarmDogs/'+relative));
for(const entry of entries){if(entry.endsWith('/'))continue;if(!allowed.has(entry))throw Error('Archivo inesperado en paquete: '+entry);allowed.delete(entry);}
if(allowed.size)throw Error('Paquete incompleto.');
const output={archive,folder,files:payload.length+1,bytes:fs.statSync(archive).size,sha256:hash(archive),containsPrivateData:false};
fs.writeFileSync(path.join(root,'dist/latest-portable.json'),JSON.stringify(output,null,2));
console.log(JSON.stringify(output));
