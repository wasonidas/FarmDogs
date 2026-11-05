'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
if(process.platform!=='win32'){console.log('Desktop wake signal: Windows only.');process.exit(0);}
const root=path.resolve(__dirname,'..'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'farmdogs-desktop-wake-'));
try{
 const out=path.join(directory,'DesktopWakeSignalTests.exe'),compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
 execFileSync(compiler,['/nologo','/codepage:65001','/platform:x64','/target:exe','/out:'+out,...['DesktopWakeSignal.cs','DesktopWakeSignalTests.cs'].map(name=>path.join(root,'native',name))],{cwd:root,windowsHide:true,stdio:'inherit',timeout:30000});
 execFileSync(out,[],{cwd:root,windowsHide:true,stdio:'inherit',timeout:15000});
}finally{const relative=path.relative(os.tmpdir(),directory);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(directory).startsWith('farmdogs-desktop-wake-'));fs.rmSync(directory,{recursive:true,force:true});}
