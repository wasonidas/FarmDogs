'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
if(process.platform!=='win32'){console.log('Movement controller policy: Windows compiler required.');process.exit(0);}
const root=path.resolve(__dirname,'..'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'farmdogs-movement-policy-'));
try{
 const compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe'),source=name=>path.join(root,'native',name),options={windowsHide:true,stdio:'inherit',timeout:30000};
 const policy=path.join(directory,'MovementPolicyTests.exe');execFileSync(compiler,['/nologo','/codepage:65001','/platform:x64','/target:exe','/r:System.Web.Extensions.dll','/out:'+policy,...['MovementPolicy.cs','RunDeadline.cs','MovementPolicyTests.cs'].map(source)],options);execFileSync(policy,[],options);
 const controller=path.join(directory,'ControllerAutomationTests.exe');execFileSync(compiler,['/nologo','/codepage:65001','/platform:x64','/target:exe','/main:WardogsSeeding.ControllerAutomationTests','/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll','/out:'+controller,...['MouseActivity.cs','MovementPolicy.cs','RunDeadline.cs','AutomaticCommand.cs','AppShutdown.cs','MovementController.cs','ControllerAutomationTests.cs'].map(source)],options);execFileSync(controller,[],options);
}finally{const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(directory));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(directory).startsWith('farmdogs-movement-policy-'));fs.rmSync(directory,{recursive:true,force:true});}
