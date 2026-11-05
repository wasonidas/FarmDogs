'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
if(process.platform!=='win32'){console.log('Mouse activity policy: Windows compiler required.');process.exit(0);}
const root=path.resolve(__dirname,'..'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'farmdogs-mouse-policy-'));
try{const compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe'),output=path.join(directory,'MousePolicyTests.exe');
 execFileSync(compiler,['/nologo','/codepage:65001','/langversion:5','/platform:x64','/target:exe','/out:'+output,path.join(root,'native/MouseActivity.cs'),path.join(root,'native/MouseActivityPolicyTests.cs')],{windowsHide:true,stdio:'inherit',timeout:30000});
 execFileSync(output,[],{windowsHide:true,stdio:'inherit',timeout:10000});
}finally{const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(directory));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(directory).startsWith('farmdogs-mouse-policy-'));fs.rmSync(directory,{recursive:true,force:true});}
