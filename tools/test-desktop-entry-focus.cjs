'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
if(process.platform!=='win32'){console.log('Foco de escritorio: política nativa solo Windows.');process.exit(0);}
const root=path.resolve(__dirname,'..'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'farmdogs-desktop-focus-tests-'));
// Reading even only the high bit consumes GetAsyncKeyState's brief-key latch,
// which belongs to the game's existing F8 watcher, never this host monitor.
assert.doesNotMatch(fs.readFileSync(path.join(root,'native','DesktopEntryFocus.cs'),'utf8'),/GetAsyncKeyState\s*\(/);
// A cold Windows test executable can take16s to start. Only this fixture wrapper
// gets30s; production focus remains one call with at most500ms observation.
try{const out=path.join(directory,'DesktopEntryFocusTests.exe'),compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');execFileSync(compiler,['/nologo','/codepage:65001','/platform:x64','/target:exe','/main:DesktopEntryFocusTests','/r:System.Windows.Forms.dll','/r:System.Net.Http.dll','/r:System.Web.Extensions.dll','/out:'+out,...['DesktopProtocol.cs','DesktopEntryFocus.cs','DesktopEntryFocusTests.cs'].map(name=>path.join(root,'native',name))],{cwd:root,windowsHide:true,stdio:'inherit'});execFileSync(out,[],{windowsHide:true,stdio:'inherit',timeout:30000});}
finally{const relative=path.relative(os.tmpdir(),directory);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(directory).startsWith('farmdogs-desktop-focus-tests-'));fs.rmSync(directory,{recursive:true,force:true});}
