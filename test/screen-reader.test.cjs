const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const os=require('node:os');
const fs=require('node:fs/promises');
const {randomUUID}=require('node:crypto');
const {createScreenReader,normalizeScreen}=require('../src/screen-reader.cjs');
const {classifyTeamEntry}=require('../src/team-clicker-entry.cjs');
const hud=require('./fixtures/ocr-gameplay-hud.json');
const now=Date.parse('2026-10-30T10:00:00Z'),directory=path.join(os.tmpdir(),'screen-monitor');
function sample(){const r=structuredClone(hud);const frameId='55555555-5555-4555-8555-555555555555';r.source={kind:'foreground_game',captureMethod:'foreground_client_screen_copy',frameId,gamePid:1234,window:5678,capturedAt:new Date(now-1000).toISOString(),captureFinishedAt:new Date(now-900).toISOString(),path:path.join(directory,'game-frame-'+frameId+'.png')};return r;}
test('lector: una captura propia reciente conserva su adquisición y clasifica sin dar permiso de entrada',()=>{
 const r=normalizeScreen(sample(),now,directory);assert.equal(r.status,'verified_capture');assert.equal(r.scene,'gameplay_hud');assert.equal(r.capturedAt,new Date(now-1000).toISOString());assert.equal(r.occlusionVerified,false);
});
test('lector: archivos, ventanas distintas, fechas antiguas y rutas externas no renuevan la escena',()=>{
 for(const alter of [r=>r.source.kind='file',r=>r.source.gamePid=0,r=>r.source.capturedAt=new Date(now-6000).toISOString(),r=>r.source.capturedAt=new Date(now+1000).toISOString(),r=>r.source.path=path.join(directory,'..','outside.png')]){const r=sample();alter(r);assert.equal(normalizeScreen(r,now,directory).status,'unknown');}
 assert.equal(normalizeScreen({format:'wardogs-game-screen-unavailable-v1',reason:'game_not_foreground'},now,directory).gameForeground,false);
});

test('lector: el clasificador de autoclic conserva procedencia y solo informa DESPLEGANDO',()=>{
 const report=sample();report.lines=[{text:'DESPLEGANDO',words:[{text:'DESPLEGANDO',x:1000,y:650,width:400,height:32}]}];
 const result=normalizeScreen(report,now,directory,{classify:classifyTeamEntry});assert.equal(result.scene,'deploying');assert.equal(result.entryConfirmed,true);assert.equal(result.gamePid,1234);assert.equal(result.gameWindow,5678);
 report.source.kind='file';assert.equal(normalizeScreen(report,now,directory,{classify:classifyTeamEntry}).status,'unknown');
});

async function temporaryReader(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wardogs-screen-reader-test-'));
 t.after(async()=>{const target=path.resolve(root);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.match(path.basename(target),/^wardogs-screen-reader-test-/);await fs.rm(target,{recursive:true,force:true});});
 const cache=path.join(root,'screen-monitor');await fs.mkdir(cache);return {root,cache};
}
async function artifact(cache,index,{image=false}={}){
 const name=(image?'game-frame-':'read-')+index.toString(16).padStart(8,'0')+'-1111-4111-8111-111111111111'+(image?'.png':'.json');
 const file=path.join(cache,name);await fs.writeFile(file,'old artifact');await fs.utimes(file,new Date(now-60000+index*1000),new Date(now-60000+index*1000));return file;
}
async function retained(cache){return (await fs.readdir(cache,{withFileTypes:true})).filter(entry=>entry.isFile()&&/^(?:read-|game-frame-)/.test(entry.name)).map(entry=>entry.name);}
async function writeReport(file,{captured=now}={}){
 const report=sample();report.source.frameId=randomUUID();report.source.path=path.join(path.dirname(file),'game-frame-'+report.source.frameId+'.png');report.source.capturedAt=new Date(captured).toISOString();report.source.captureFinishedAt=new Date(captured+1).toISOString();
 await fs.writeFile(report.source.path,'frame');await fs.writeFile(file,JSON.stringify(report));return report;
}
test('lector: al reanudar poda el inventario previo y protege los dos archivos actuales aunque tengan fecha antigua',async t=>{
 const {root,cache}=await temporaryReader(t),old=[];
 for(let i=1;i<=12;i++)old.push(await artifact(cache,i,{image:i%2===0}));
 const research=path.join(cache,'research');await fs.mkdir(research);const researchFile=await artifact(research,90);
 const foreign=path.join(cache,'notes.txt'),malformed=path.join(cache,'game-frame-not-a-uuid.png');await fs.writeFile(foreign,'keep');await fs.writeFile(malformed,'keep');
 let currentFile,currentImage;
 const reader=createScreenReader({root,dataDir:root,directory:cache,now:()=>now,run:async(_exe,args)=>{
  assert.equal((await retained(cache)).filter(name=>name!==path.basename(malformed)).length,8);
  for(const file of old.slice(0,4))await assert.rejects(fs.access(file),{code:'ENOENT'});
  currentFile=args[1];const report=await writeReport(currentFile);currentImage=report.source.path;
  for(const file of [currentFile,currentImage])await fs.utimes(file,new Date(0),new Date(0));
 }});
 await reader.refresh();assert.equal(reader.view().status,'verified_capture');assert.equal((await retained(cache)).length,9);
 for(const file of [currentFile,currentImage,researchFile,foreign,malformed])await fs.access(file);
 const restarted=createScreenReader({root,dataDir:root,directory:cache,now:()=>now,run:async()=>{assert.equal((await retained(cache)).length,9);throw Error('helper unavailable');}});
 await restarted.refresh();assert.equal(restarted.busy,false);assert.equal((await retained(cache)).length,9);await fs.access(researchFile);
});
test('lector: salida JSON inválida y fallos del helper no dejan una caché creciente',async t=>{
 const {root,cache}=await temporaryReader(t);let attempts=0,currentFile;
 const reader=createScreenReader({root,dataDir:root,directory:cache,now:()=>now,run:async(_exe,args)=>{
  currentFile=args[1];await fs.writeFile(currentFile,'{invalid json');await fs.utimes(currentFile,new Date(0),new Date(0));
  await artifact(cache,100+attempts*2,{image:true});await artifact(cache,101+attempts*2,{image:true});
  if(++attempts%2===0)throw Error('helper failed after output');
 }});
 for(let i=0;i<8;i++){await reader.refresh();assert.equal(reader.busy,false);assert.equal(reader.view().status,'unknown');assert.ok((await retained(cache)).length<=8);await fs.access(currentFile);}
 assert.equal((await retained(cache)).length,8);assert.equal(attempts,8);
});
test('lector: no poda enlaces, directorios con nombres de caché ni sus destinos',async t=>{
 const {root,cache}=await temporaryReader(t),outside=path.join(root,'research');await fs.mkdir(outside);const researchFile=await artifact(outside,70);
 const linkedName=path.basename(await artifact(cache,71)),linked=path.join(cache,linkedName);await fs.unlink(linked);await fs.symlink(outside,linked,process.platform==='win32'?'junction':'dir');
 const directoryName=path.basename(await artifact(cache,72));await fs.unlink(path.join(cache,directoryName));await fs.mkdir(path.join(cache,directoryName));
 for(let i=1;i<=12;i++)await artifact(cache,i);
 const reader=createScreenReader({root,dataDir:root,directory:cache,run:async()=>{throw Error('no capture');}});await reader.refresh();
 assert.equal((await retained(cache)).length,8);assert.equal((await fs.lstat(linked)).isSymbolicLink(),true);assert.equal((await fs.lstat(path.join(cache,directoryName))).isDirectory(),true);await fs.access(researchFile);
 const linkedCache=path.join(root,'linked-monitor');await fs.symlink(outside,linkedCache,process.platform==='win32'?'junction':'dir');let called=false;
 const forbidden=createScreenReader({root,dataDir:root,directory:linkedCache,run:async()=>{called=true;}});await forbidden.refresh();assert.equal(called,false);await fs.access(researchFile);
});
test('lector: terminar un helper cancelado o entregar un OCR antiguo no renueva la escena',async t=>{
 const {root,cache}=await temporaryReader(t);let clock=now,release,started;const entered=new Promise(resolve=>started=resolve);let attempt=0;
 const reader=createScreenReader({root,dataDir:root,directory:cache,now:()=>clock,run:async(_exe,args)=>{
  if(++attempt===1){started();await new Promise(resolve=>release=resolve);}
  await writeReport(args[1],{captured:attempt===2?now:clock});
 }});
 const first=reader.refresh();await entered;assert.equal(reader.busy,true);reader.stop();release();await first;assert.equal(reader.busy,false);assert.equal(reader.view().status,'unknown');
 clock=now+6001;await reader.refresh();assert.equal(reader.view().status,'unknown');await reader.refresh();assert.equal(reader.view().status,'verified_capture');assert.equal((await retained(cache)).length,6);
});
