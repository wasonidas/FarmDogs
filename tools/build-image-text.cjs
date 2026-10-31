const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const windows=process.env.WINDIR||'C:\\Windows';
const framework=path.join(windows,'Microsoft.NET','Framework64','v4.0.30319');
const metadata=path.join(windows,'System32','WinMetadata');
const test=process.argv.includes('--test');
const out=path.join(root,'bin',test?'ImageTextReaderGeometryTests.exe':'WardogsImageText.exe');
fs.mkdirSync(path.dirname(out),{recursive:true});
const references=fs.readdirSync(metadata).filter(name=>name.endsWith('.winmd')).map(name=>'/r:'+path.join(metadata,name));
const runtimeFacade=path.join(windows,'Microsoft.NET','assembly','GAC_MSIL','System.Runtime','v4.0_4.0.0.0__b03f5f7f11d50a3a','System.Runtime.dll');
execFileSync(path.join(framework,'csc.exe'),['/nologo','/codepage:65001','/langversion:5','/platform:x64','/target:exe','/out:'+out,...(test?['/main:ImageTextReaderGeometryTests']:[]),
 '/r:System.Web.Extensions.dll','/r:System.Drawing.dll','/r:System.Windows.Forms.dll','/r:'+path.join(framework,'System.Runtime.WindowsRuntime.dll'),...references,
 '/r:'+runtimeFacade,path.join(root,'native','GameFrameCapture.cs'),path.join(root,'native','ImageTextReader.cs'),...(test?[path.join(root,'native','ImageTextReaderGeometryTests.cs')]:[])],{cwd:root,stdio:'inherit',windowsHide:true});
console.log((test?'Built OCR geometry tests: ':'Built read-only OCR reader: ')+out);
