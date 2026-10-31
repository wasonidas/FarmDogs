'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
if(process.platform!=='win32'){console.log('Cierre de escritorio: política nativa solo Windows.');process.exit(0);}
const root=path.resolve(__dirname,'..'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'farmdogs-desktop-close-tests-'));
// Allow cold Windows test-executable startup; the production close budget stays7s.
try{const out=path.join(directory,'DesktopCloseTests.exe'),compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');execFileSync(compiler,['/nologo','/codepage:65001','/platform:x64','/target:exe','/main:DesktopCloseTests','/r:System.Net.Http.dll','/r:System.Web.Extensions.dll','/out:'+out,...['DesktopProtocol.cs','DesktopClose.cs','DesktopCloseTests.cs'].map(name=>path.join(root,'native',name))],{cwd:root,windowsHide:true,stdio:'inherit'});execFileSync(out,[],{windowsHide:true,stdio:'inherit',timeout:30000});}
finally{const relative=path.relative(os.tmpdir(),directory);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(directory).startsWith('farmdogs-desktop-close-tests-'));fs.rmSync(directory,{recursive:true,force:true});}
