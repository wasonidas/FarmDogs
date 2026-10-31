const path=require('node:path');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {ensureObserver}=require('../src/service-start.cjs');
const root=path.resolve(__dirname,'..');
async function open(){
 if(Number(process.versions.node.split('.')[0])<24)throw Error('Se requiere Node.js 24 o posterior.');
 const app=path.join(root,'bin','FarmDogsApp.exe');if(!fs.existsSync(app))throw Error('Compila primero la app con npm run build:desktop.');
 await ensureObserver({root});
 await new Promise((resolve,reject)=>{const child=spawn(app,[],{cwd:root,detached:true,stdio:'ignore',windowsHide:false});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
}
open().catch(error=>{console.error(error.message);process.exitCode=1;});
