'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),bin=path.join(root,'bin');
if(process.platform!=='win32')throw Error('El executor de entrada requiere Windows para compilar.');
const compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
const common=['/nologo','/codepage:65001','/langversion:5','/platform:x64','/r:System.Drawing.dll','/r:System.Web.Extensions.dll'];
const options={cwd:root,stdio:'inherit',windowsHide:true,timeout:30000};
const source=name=>path.join(root,'native',name);
if(!process.argv.includes('--test-only')){
 const outputIndex=process.argv.indexOf('--output'),customOutput=outputIndex>=0?process.argv[outputIndex+1]:null;
 if(outputIndex>=0&&(!customOutput||customOutput.startsWith('--')))throw Error('Falta la ruta de salida de staging.');
 const staging=process.argv.includes('--staging')||!!customOutput,output=customOutput?path.resolve(customOutput):path.join(bin,staging?'WardogsEntry.next.exe':'WardogsEntry.exe');
 fs.mkdirSync(path.dirname(output),{recursive:true});
 execFileSync(compiler,[...common,'/target:exe','/out:'+output,source('GameWindow.cs'),source('EntryControlVisual.cs'),source('InputIntegrity.cs'),source('MouseActivity.cs'),source('GameEntry.cs')],options);
 if(!staging||customOutput)fs.writeFileSync(path.join(path.dirname(output),'entry-capabilities.json'),JSON.stringify({format:'farmdogs-entry-capabilities-v1',automaticEntry:true,oneShot:true,stopKey:'F8',stopWatcher:true,initialFocus:true,mainDeployGate:true,splashKeyStart:true,absolutePointer:true,restartRecovery:true,mousePause:true,maxActionMilliseconds:3000,sha256:crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex')}));
 console.log('Built: '+output);
}
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'farmdogs-entry-tests-'));
try{
 const output=path.join(temporary,'GameEntryTests.exe');
 execFileSync(compiler,[...common,'/target:exe','/main:GameEntryTests','/out:'+output,source('GameWindow.cs'),source('EntryControlVisual.cs'),source('InputIntegrity.cs'),source('MouseActivity.cs'),source('GameEntry.cs'),source('GameEntryTests.cs')],options);
 execFileSync(output,[],options);
 const windows=path.join(temporary,'GameWindowTests.exe');
 execFileSync(compiler,[...common,'/target:exe','/main:GameWindowTests','/out:'+windows,source('GameWindow.cs'),source('GameWindowTests.cs')],options);
 execFileSync(windows,[],options);
}finally{
 const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temporary));
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!path.basename(temporary).startsWith('farmdogs-entry-tests-'))throw Error('Ruta temporal no verificada.');
 fs.rmSync(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:20});
}
