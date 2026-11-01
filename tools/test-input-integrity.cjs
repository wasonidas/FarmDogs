'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
if(process.platform!=='win32')throw Error('La prueba de integridad requiere el compilador .NET de Windows.');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'farmdogs-integrity-tests-'));
try{
 const compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe'),file=path.join(temp,'InputIntegrityTests.exe');
 execFileSync(compiler,['/nologo','/codepage:65001','/langversion:5','/platform:x64','/target:exe','/out:'+file,...['InputIntegrity.cs','InputIntegrityTests.cs'].map(name=>path.join(root,'native',name))],{cwd:root,windowsHide:true,stdio:'inherit',timeout:30000});
 execFileSync(file,[],{cwd:root,windowsHide:true,stdio:'inherit',timeout:15000});
}finally{
 const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temp));
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!path.basename(temp).startsWith('farmdogs-integrity-tests-'))throw Error('Ruta temporal fuera del alcance.');
 fs.rmSync(temp,{recursive:true,force:true});
}
