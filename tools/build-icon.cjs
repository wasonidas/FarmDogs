'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function buildIcon(directory=path.join(root,'bin')){
 fs.mkdirSync(directory,{recursive:true});const compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe'),builder=path.join(directory,'IconAssetBuilder.exe'),icon=path.join(directory,'FarmDogs.ico');
 execFileSync(compiler,['/nologo','/codepage:65001','/platform:x64','/target:exe','/r:System.Drawing.dll','/out:'+builder,path.join(root,'native/IconAssetBuilder.cs')],{cwd:root,windowsHide:true,stdio:'pipe',timeout:30000});
 execFileSync(builder,[path.join(root,'public/farmdogs-ai-mark.png'),icon],{cwd:root,windowsHide:true,stdio:'pipe',timeout:15000});return icon;
}
module.exports={buildIcon};
if(require.main===module)console.log(buildIcon());
