'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {test}=require('node:test'),assert=require('node:assert/strict');
test('lector de cuenta: política nativa de refresco coalescido sin omitir backoff',{skip:process.platform!=='win32'},t=>{
 const root=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'farmdogs-account-refresh-'));
 t.after(()=>{assert.equal(path.dirname(path.resolve(temporary)),path.resolve(os.tmpdir()));assert.ok(path.basename(temporary).startsWith('farmdogs-account-refresh-'));assert.ok(!fs.lstatSync(temporary).isSymbolicLink());fs.rmSync(temporary,{recursive:true,force:true});});
 const compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe'),output=path.join(temporary,'AccountRefreshPolicyTests.exe');
 execFileSync(compiler,['/nologo','/codepage:65001','/platform:x64','/target:exe','/main:AccountRefreshPolicyTests','/out:'+output,...['AccountRefreshPolicy.cs','AccountRefreshPolicyTests.cs'].map(name=>path.join(root,'native',name))],{windowsHide:true,timeout:30000});
 const result=execFileSync(output,[],{windowsHide:true,timeout:30000,encoding:'utf8'});assert.match(result,/checks passed/);
});
