'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
if(process.platform!=='win32')throw Error('La prueba de avisos requiere el compilador .NET de Windows.');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'farmdogs-alert-tests-'));
try{
 const compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe'),file=path.join(temp,'ForegroundAlertTests.exe');
 const args=['/nologo','/codepage:65001','/platform:x64','/target:exe','/out:'+file,'/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Net.Http.dll','/r:System.Web.Extensions.dll',...['DesktopProtocol.cs','ForegroundAlert.cs','ForegroundAlertTests.cs'].map(name=>path.join(root,'native',name))];
 execFileSync(compiler,args,{cwd:root,windowsHide:true,stdio:'inherit',timeout:30000});
 execFileSync(file,[],{cwd:root,windowsHide:true,stdio:'inherit',timeout:15000});
}finally{const rel=path.relative(path.resolve(os.tmpdir()),path.resolve(temp));if(!rel||rel.startsWith('..')||path.isAbsolute(rel)||!path.basename(temp).startsWith('farmdogs-alert-tests-'))throw Error('Ruta temporal fuera del alcance.');fs.rmSync(temp,{recursive:true,force:true});}
