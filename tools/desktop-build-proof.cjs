'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');

const FORMAT='farmdogs-desktop-build-proof-v1';
const OUTPUTS=['bin/FarmDogsApp.exe','bin/FarmDogsApp.next.exe'];
const INPUTS=[
 'native/DesktopProtocol.cs','native/DesktopAppearance.cs','native/AccountReadScript.cs',
 'native/AccountRefreshPolicy.cs','native/DesktopClose.cs','native/DesktopEntryFocus.cs',
 'native/RewardBridge.cs','native/ForegroundAlert.cs','native/AppShutdown.cs',
 'native/DesktopWakeSignal.cs','native/DesktopVisibilityPolicy.cs','native/DesktopApp.cs',
 'tools/build-desktop.cjs','tools/build-icon.cjs','native/IconAssetBuilder.cs',
 'public/farmdogs-ai-mark.png','bin/Microsoft.Web.WebView2.Core.dll',
 'bin/Microsoft.Web.WebView2.WinForms.dll','bin/WebView2Loader.dll'
];
const SHA256=/^[a-f0-9]{64}$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fail(detail){throw Object.assign(Error('Recompila Desktop: '+detail),{code:'DESKTOP_BUILD_PROOF_INVALID'});}
function getDesktopBuildProofPath(output){if(typeof output!=='string'||!output)fail('el destino del ejecutable no es válido.');return output+'.build.json';}
function context(root,output){
 if(typeof root!=='string'||!root||typeof output!=='string'||!output)fail('faltan la carpeta o el destino del ejecutable.');
 let realRoot;try{realRoot=fs.realpathSync(path.resolve(root));if(!fs.statSync(realRoot).isDirectory())fail('la carpeta del proyecto no es válida.');}catch{fail('la carpeta del proyecto no está disponible.');}
 const resolved=path.resolve(root,output),same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
 const binary=OUTPUTS.find(relative=>same(path.resolve(root,...relative.split('/')),resolved));
 if(!binary)fail('solo se admite el ejecutable Desktop normal o de staging de este proyecto.');
 return {root:path.resolve(root),realRoot,binary};
}
function absolute(ctx,relative){return path.join(ctx.root,...relative.split('/'));}
function safeBytes(ctx,relative,{maximum=64*1024*1024}={}){
 try{
  const file=absolute(ctx,relative),stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maximum)fail('un archivo de compilación no es regular o excede su límite.');
  const actual=fs.realpathSync(file),inside=path.relative(ctx.realRoot,actual);
  if(!inside||inside==='..'||inside.startsWith('..'+path.sep)||path.isAbsolute(inside))fail('un archivo de compilación sale de la carpeta del proyecto.');
  return fs.readFileSync(file);
 }catch(error){if(error.code==='DESKTOP_BUILD_PROOF_INVALID')throw error;fail('falta o no se puede leer '+relative+'.');}
}
function writeDesktopBuildProof({root,output}={}){
 const ctx=context(root,output),proof={format:FORMAT,target:'FarmDogsApp',binary:{path:ctx.binary,sha256:hash(safeBytes(ctx,ctx.binary))},sources:INPUTS.map(relative=>({path:relative,sha256:hash(safeBytes(ctx,relative))}))};
 const relative=getDesktopBuildProofPath(ctx.binary),file=absolute(ctx,relative);
 if(fs.existsSync(file))safeBytes(ctx,relative,{maximum:65536});
 const temporary=file+'.'+randomUUID()+'.tmp';let created=false;
 try{const handle=fs.openSync(temporary,'wx');created=true;try{fs.writeFileSync(handle,JSON.stringify(proof,null,2)+'\n');}finally{fs.closeSync(handle);}fs.renameSync(temporary,file);}
 catch{fail('no se pudo guardar la prueba de compilación del ejecutable.');}
 finally{if(created)try{fs.unlinkSync(temporary);}catch{}}
 return proof;
}
function verifyDesktopBuildProof({root,output}={}){
 const ctx=context(root,output);let proof;
 try{proof=JSON.parse(safeBytes(ctx,getDesktopBuildProofPath(ctx.binary),{maximum:65536}).toString('utf8'));}
 catch(error){if(error.code==='DESKTOP_BUILD_PROOF_INVALID')throw error;fail('la prueba de compilación no es JSON válido.');}
 if(!exact(proof,['format','target','binary','sources'])||proof.format!==FORMAT||proof.target!=='FarmDogsApp'||!exact(proof.binary,['path','sha256'])||proof.binary.path!==ctx.binary||!SHA256.test(proof.binary.sha256)||!Array.isArray(proof.sources)||proof.sources.length!==INPUTS.length)fail('la prueba no corresponde a este ejecutable y a sus fuentes actuales.');
 for(let index=0;index<INPUTS.length;index++){
  const row=proof.sources[index];if(!exact(row,['path','sha256'])||row.path!==INPUTS[index]||!SHA256.test(row.sha256))fail('la lista fija de fuentes o dependencias no coincide.');
 }
 if(hash(safeBytes(ctx,ctx.binary))!==proof.binary.sha256)fail('el ejecutable cambió después de compilar; no mezcles binarios y pruebas.');
 for(const row of proof.sources)if(hash(safeBytes(ctx,row.path))!==row.sha256)fail('cambiaron '+row.path+' después de compilar.');
 return proof;
}
module.exports={writeDesktopBuildProof,verifyDesktopBuildProof,getDesktopBuildProofPath};
