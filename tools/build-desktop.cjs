const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const {buildIcon}=require('./build-icon.cjs');
const version='1.0.4314.35';
const sha512='cOaiVqP3BmQHMnxGpZzANM22tUXgycrisyJHjIGNzIaMsm8iXj7Kx+ceYg+RbYwJtzT009qfcFTocvVLY+ekMw==';
async function build(){
 const cache=path.join(root,'data','dependencies','webview2-'+version);fs.mkdirSync(cache,{recursive:true});
 const archive=path.join(cache,'sdk.nupkg');
 if(!fs.existsSync(archive)){
  const url=`https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${version}/microsoft.web.webview2.${version}.nupkg`;
  const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('NuGet HTTP '+r.status);
  const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>30*1024*1024)throw Error('SDK demasiado grande.');fs.writeFileSync(archive,bytes);
 }
 if(crypto.createHash('sha512').update(fs.readFileSync(archive)).digest('base64')!==sha512)throw Error('La identidad del SDK no coincide con la versión fijada.');
 const bin=path.join(root,'bin');fs.mkdirSync(bin,{recursive:true});
 for(const name of ['lib/net462/Microsoft.Web.WebView2.Core.dll','lib/net462/Microsoft.Web.WebView2.WinForms.dll','runtimes/win-x64/native/WebView2Loader.dll']){
  // Only these three exact members are extracted, into fixed filenames.
  const bytes=execFileSync('tar.exe',['-xOf',archive,name],{maxBuffer:20*1024*1024,windowsHide:true});
  const destination=path.join(bin,path.basename(name));
  if(!fs.existsSync(destination)||!fs.readFileSync(destination).equals(bytes))fs.writeFileSync(destination,bytes);
 }
 const compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 const output=path.join(bin,process.argv.includes('--staging')?'FarmDogsApp.next.exe':'FarmDogsApp.exe');
 const icon=buildIcon();
 execFileSync(compiler,['/nologo','/codepage:65001','/platform:x64','/target:winexe','/out:'+output,'/win32icon:'+icon,'/resource:'+icon+',FarmDogs.AppIcon',
  '/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Net.Http.dll','/r:System.Web.Extensions.dll',
  '/r:'+path.join(bin,'Microsoft.Web.WebView2.Core.dll'),'/r:'+path.join(bin,'Microsoft.Web.WebView2.WinForms.dll'),
  path.join(root,'native','DesktopProtocol.cs'),path.join(root,'native','DesktopAppearance.cs'),path.join(root,'native','AccountReadScript.cs'),path.join(root,'native','DesktopClose.cs'),path.join(root,'native','DesktopEntryFocus.cs'),path.join(root,'native','RewardBridge.cs'),path.join(root,'native','ForegroundAlert.cs'),path.join(root,'native','AppShutdown.cs'),path.join(root,'native','DesktopApp.cs')],{cwd:root,stdio:'inherit',windowsHide:true});
 console.log('Built: '+output);
 execFileSync(compiler,['/nologo','/codepage:65001','/platform:x64','/target:exe','/out:'+path.join(bin,'DesktopProtocolTests.exe'),'/r:System.Net.Http.dll','/r:System.Web.Extensions.dll',path.join(root,'native','DesktopProtocol.cs'),path.join(root,'native','DesktopProtocolTests.cs')],{cwd:root,stdio:'inherit',windowsHide:true});
 execFileSync(path.join(bin,'DesktopProtocolTests.exe'),[],{cwd:root,stdio:'inherit',windowsHide:true});
}
build().catch(error=>{console.error(error.message);process.exitCode=1;});
