'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
if(process.platform!=='win32'){console.log('Apariencia de escritorio: sólo Windows.');process.exit(0);}
const root=path.resolve(__dirname,'..'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'farmdogs-desktop-appearance-'));
try{
 const icon=require('./build-icon.cjs').buildIcon(directory),out=path.join(directory,'DesktopAppearanceTests.exe'),compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
 execFileSync(compiler,['/nologo','/codepage:65001','/platform:x64','/target:exe','/main:DesktopAppearanceTests','/win32icon:'+icon,'/resource:'+icon+',FarmDogs.AppIcon','/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/out:'+out,...['DesktopAppearance.cs','DesktopAppearanceTests.cs'].map(f=>path.join(root,'native',f))],{cwd:root,windowsHide:true,stdio:'inherit',timeout:30000});
 execFileSync(out,[],{cwd:root,windowsHide:true,stdio:'inherit',timeout:15000});
}finally{const relative=path.relative(os.tmpdir(),directory);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(directory).startsWith('farmdogs-desktop-appearance-'));fs.rmSync(directory,{recursive:true,force:true});}
