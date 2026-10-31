'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
if(process.platform==='win32'){
 const root=path.resolve(__dirname,'..'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'farmdogs-shutdown-tests-'));
 try{
  const target=path.join(folder,'AppShutdownTests.exe'),compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  execFileSync(compiler,['/nologo','/codepage:65001','/platform:x64','/target:exe','/out:'+target,'/r:System.Web.Extensions.dll',path.join(root,'native','AppShutdown.cs'),path.join(root,'native','AppShutdownTests.cs')],{windowsHide:true,stdio:'inherit'});
  execFileSync(target,[],{windowsHide:true,stdio:'inherit',timeout:15000});
 }finally{const relative=path.relative(path.resolve(os.tmpdir()),folder);if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!path.basename(folder).startsWith('farmdogs-shutdown-tests-'))throw Error('Ruta temporal de limpieza no válida.');fs.rmSync(folder,{recursive:true,force:true});}
}
