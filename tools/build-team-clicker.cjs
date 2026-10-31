'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),bin=path.join(root,'bin');
fs.mkdirSync(bin,{recursive:true});
const compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
const source=name=>path.join(root,'native',name);
const common=['/nologo','/codepage:65001','/platform:x64','/r:System.Web.Extensions.dll'];
const options={cwd:root,stdio:'inherit',windowsHide:true,timeout:30000};
if(!process.argv.includes('--test-only')){
 const output=path.join(bin,process.argv.includes('--staging')?'WardogsTeamClicker.next.exe':'WardogsTeamClicker.exe');
 execFileSync(compiler,[...common,'/target:winexe','/out:'+output,'/r:System.Drawing.dll',source('GameWindow.cs'),source('TeamClickerCore.cs'),source('TeamClickerHotkeys.cs'),source('TeamClickerLogoDetector.cs'),source('TeamClickerSelectorFrame.cs'),source('TeamClickerWaiter.cs'),source('TeamClickerNative.cs'),source('TeamClickerProgram.cs')],options);
 if(!process.argv.includes('--staging'))fs.writeFileSync(path.join(bin,'team-clicker-capabilities.json'),JSON.stringify({format:'wardogs-team-clicker-capabilities-v1',teamClicker:true,automaticTeamRecognition:true,automaticTeamSelection:true,automaticAnyTeam:true,messageHotkeys:true,persistentTeamAttempt:true,positiveEntryConfirmation:true,sha256:crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex')}));
 console.log('Built: '+output);
}
// node --test may discover both the wrapper and the standalone runner concurrently.
const temp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'wardogs-clicker-native-tests-'));
try{
 const tests=path.join(temp,'TeamClickerTests.exe');
 execFileSync(compiler,[...common,'/target:exe','/out:'+tests,'/r:System.Drawing.dll',source('TeamClickerCore.cs'),source('TeamClickerHotkeys.cs'),source('TeamClickerLogoDetector.cs'),source('TeamClickerSelectorFrame.cs'),source('TeamClickerSelectorFrameTests.cs'),source('TeamClickerWaiter.cs'),source('TeamClickerWaiterTests.cs'),source('TeamClickerTests.cs')],options);
 const imageIndex=process.argv.indexOf('--image');
 if(imageIndex>=0&&!process.argv[imageIndex+1])throw Error('Falta la imagen de la sonda.');
 execFileSync(tests,imageIndex>=0?['--image',path.resolve(process.argv[imageIndex+1])]:process.argv.includes('--timer-probe')?['--timer-probe']:[],options);
}finally{const relative=path.relative(path.resolve(require('node:os').tmpdir()),path.resolve(temp));if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!path.basename(temp).startsWith('wardogs-clicker-native-tests-'))throw Error('Carpeta temporal no confirmada.');fs.rmSync(temp,{recursive:true,force:true});}
