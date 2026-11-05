const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const out=path.join(root,'bin');fs.mkdirSync(out,{recursive:true});
const compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
const source=name=>path.join(root,'native',name);
const common=['/nologo','/codepage:65001','/platform:x64'];
const controllerName=process.argv.includes('--staging')?'WardogsMovement.next.exe':'WardogsMovement.exe';
execFileSync(compiler,[...common,'/target:winexe','/out:'+path.join(out,controllerName),'/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll',source('MovementPolicy.cs'),source('RunDeadline.cs'),source('MouseActivity.cs'),source('AutomaticCommand.cs'),source('AppShutdown.cs'),source('KeyboardInput.cs'),source('MovementController.cs')],{cwd:root,stdio:'inherit',windowsHide:true});
execFileSync(compiler,[...common,'/target:exe','/out:'+path.join(out,'MovementPolicyTests.exe'),'/r:System.Web.Extensions.dll',source('MovementPolicy.cs'),source('RunDeadline.cs'),source('MovementPolicyTests.cs')],{cwd:root,stdio:'inherit',windowsHide:true});
execFileSync(path.join(out,'MovementPolicyTests.exe'),[],{cwd:root,stdio:'inherit',windowsHide:true});
execFileSync(compiler,[...common,'/target:exe','/main:WardogsSeeding.ControllerAutomationTests','/out:'+path.join(out,'ControllerAutomationTests.exe'),'/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll',source('MovementPolicy.cs'),source('RunDeadline.cs'),source('MouseActivity.cs'),source('AutomaticCommand.cs'),source('AppShutdown.cs'),source('MovementController.cs'),source('ControllerAutomationTests.cs')],{cwd:root,stdio:'inherit',windowsHide:true});
execFileSync(path.join(out,'ControllerAutomationTests.exe'),[],{cwd:root,stdio:'inherit',windowsHide:true,timeout:15000});
if(controllerName==='WardogsMovement.exe'){const hash=require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(out,controllerName))).digest('hex');fs.writeFileSync(path.join(out,'movement-capabilities.json'),JSON.stringify({automaticMovement:true,mousePause:true,sha256:hash}));}
console.log('Built: '+path.join(out,controllerName));
