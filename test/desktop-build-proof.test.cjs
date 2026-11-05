'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {writeDesktopBuildProof,verifyDesktopBuildProof,getDesktopBuildProofPath}=require('../tools/desktop-build-proof.cjs');
const INPUTS=[
 'native/DesktopProtocol.cs','native/DesktopAppearance.cs','native/AccountReadScript.cs',
 'native/AccountRefreshPolicy.cs','native/DesktopClose.cs','native/DesktopEntryFocus.cs',
 'native/RewardBridge.cs','native/ForegroundAlert.cs','native/AppShutdown.cs',
 'native/DesktopWakeSignal.cs','native/DesktopVisibilityPolicy.cs','native/DesktopApp.cs',
 'tools/build-desktop.cjs','tools/build-icon.cjs','native/IconAssetBuilder.cs',
 'public/farmdogs-ai-mark.png','bin/Microsoft.Web.WebView2.Core.dll',
 'bin/Microsoft.Web.WebView2.WinForms.dll','bin/WebView2Loader.dll'
];
function fixture(t){
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'farmdogs-build-proof-')),root=path.join(parent,'project');
 t.after(()=>{const relative=path.relative(os.tmpdir(),parent);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(parent).startsWith('farmdogs-build-proof-'));fs.rmSync(parent,{recursive:true,force:true});});
 const file=relative=>path.join(root,...relative.split('/'));
 for(const relative of [...INPUTS,'bin/FarmDogsApp.exe','bin/FarmDogsApp.next.exe']){fs.mkdirSync(path.dirname(file(relative)),{recursive:true});fs.writeFileSync(file(relative),'fixture bytes: '+relative);}
 const output=file('bin/FarmDogsApp.exe');return{root,parent,file,output,write:()=>writeDesktopBuildProof({root,output}),verify:()=>verifyDesktopBuildProof({root,output}),read:()=>JSON.parse(fs.readFileSync(getDesktopBuildProofPath(output),'utf8')),setProof:value=>fs.writeFileSync(getDesktopBuildProofPath(output),JSON.stringify(value))};
}
function rejected(fn,pattern=/Recompila Desktop/){assert.throws(fn,error=>error.code==='DESKTOP_BUILD_PROOF_INVALID'&&pattern.test(error.message));}
test('desktop build proof: records exact public inputs, verifies content and contains no absolute paths',t=>{
 const f=fixture(t),proof=f.write();assert.equal(proof.format,'farmdogs-desktop-build-proof-v1');assert.equal(proof.target,'FarmDogsApp');assert.equal(proof.binary.path,'bin/FarmDogsApp.exe');assert.deepEqual(proof.sources.map(row=>row.path),INPUTS);assert.deepEqual(f.verify(),proof);
 const json=JSON.stringify(proof);assert.equal(json.includes(f.root),false);assert.equal(json.includes(f.parent),false);for(const row of [proof.binary,...proof.sources])assert.match(row.sha256,/^[a-f0-9]{64}$/);
 const builder=fs.readFileSync(path.join(__dirname,'../tools/build-desktop.cjs'),'utf8'),compiled=[...builder.matchAll(/path\.join\(root,'native','([^']+\.cs)'\)/g)].map(match=>'native/'+match[1]);
 assert.deepEqual([...new Set(compiled)].filter(name=>!name.endsWith('Tests.cs')),INPUTS.slice(0,12));
 assert.equal(getDesktopBuildProofPath(f.output),f.output+'.build.json');
});
test('desktop build proof: rejects a missing, malformed or missing-input receipt with a clear rebuild message',t=>{
 const f=fixture(t);rejected(f.verify);f.write();fs.writeFileSync(getDesktopBuildProofPath(f.output),'{bad');rejected(f.verify);
 fs.unlinkSync(f.file('native/DesktopApp.cs'));rejected(f.write,/Recompila Desktop.*DesktopApp/);
});
test('desktop build proof: packaging an older binary with a newer receipt is rejected',t=>{
 const f=fixture(t);f.write();fs.writeFileSync(f.output,'old binary from the previous release');rejected(f.verify,/Recompila Desktop.*ejecutable cambió/);
});
for(const input of ['native/DesktopApp.cs','native/DesktopVisibilityPolicy.cs','tools/build-desktop.cjs','native/IconAssetBuilder.cs','public/farmdogs-ai-mark.png','bin/Microsoft.Web.WebView2.Core.dll'])test(`desktop build proof: detects changed build input ${input} even with unchanged size and timestamp`,t=>{
 const f=fixture(t);f.write();const stat=fs.statSync(f.file(input)),bytes=fs.readFileSync(f.file(input));bytes[0]^=1;fs.writeFileSync(f.file(input),bytes);fs.utimesSync(f.file(input),stat.atime,stat.mtime);rejected(f.verify,/Recompila Desktop.*después de compilar/);
});
test('desktop build proof: normal and staging receipts cannot be interchanged even for identical executable bytes',t=>{
 const f=fixture(t),next=f.file('bin/FarmDogsApp.next.exe');fs.copyFileSync(f.output,next);f.write();fs.copyFileSync(getDesktopBuildProofPath(f.output),getDesktopBuildProofPath(next));
 rejected(()=>verifyDesktopBuildProof({root:f.root,output:next}),/Recompila Desktop.*corresponde/);
 const staged=writeDesktopBuildProof({root:f.root,output:next});assert.equal(staged.binary.path,'bin/FarmDogsApp.next.exe');assert.deepEqual(verifyDesktopBuildProof({root:f.root,output:next}),staged);assert.equal(f.verify().binary.path,'bin/FarmDogsApp.exe');
});
test('desktop build proof: rejects modified schemas, omissions, duplicates and arbitrary paths before hashing supplied paths',t=>{
 const f=fixture(t),original=f.write(),outside=path.join(f.parent,'private.txt');fs.writeFileSync(outside,'PRIVATE CANARY');
 const variants=[
  value=>value.format='other',value=>value.target='OtherApp',value=>value.token='PRIVATE',
  value=>value.sources.pop(),value=>value.sources.push({...value.sources[0]}),
  value=>value.sources[1]={...value.sources[0]},value=>value.sources.reverse(),
  value=>value.sources[0].path=outside,value=>value.sources[0].path='../private.txt',
  value=>value.sources[0].unexpected=true,value=>value.binary.path=outside,
  value=>value.binary.sha256=value.binary.sha256.toUpperCase()
 ];
 for(const mutate of variants){const proof=structuredClone(original);mutate(proof);f.setProof(proof);rejected(f.verify);}
 assert.equal(fs.readFileSync(outside,'utf8'),'PRIVATE CANARY');
});
test('desktop build proof: output paths are fixed and cannot create or read proofs outside the project',t=>{
 const f=fixture(t),outside=path.join(f.parent,'FarmDogsApp.exe');fs.writeFileSync(outside,'PRIVATE CANARY');
 for(const output of [outside,path.join(f.parent,'project-other/bin/FarmDogsApp.exe'),'../FarmDogsApp.exe','bin/Other.exe','bin/FarmDogsApp.exe.build.json']){
  rejected(()=>writeDesktopBuildProof({root:f.root,output}));rejected(()=>verifyDesktopBuildProof({root:f.root,output}));
 }
 assert.equal(fs.readFileSync(outside,'utf8'),'PRIVATE CANARY');assert.equal(fs.existsSync(getDesktopBuildProofPath(outside)),false);
});
test('desktop build proof: a fixed input directory cannot redirect reads outside the project',t=>{
 const f=fixture(t),external=path.join(f.parent,'external-tools'),tools=f.file('tools');fs.mkdirSync(external);for(const name of ['build-desktop.cjs','build-icon.cjs'])fs.writeFileSync(path.join(external,name),'PRIVATE CANARY');
 fs.renameSync(tools,f.file('tools-backup'));
 try{fs.symlinkSync(external,tools,'junction');}catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('Directory links are unavailable.');return;}throw error;}
 rejected(f.write,/Recompila Desktop.*sale de la carpeta/);assert.equal(fs.existsSync(getDesktopBuildProofPath(f.output)),false);
});
