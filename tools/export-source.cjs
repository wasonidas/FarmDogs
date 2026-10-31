'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
const directories=['src','native','public','test','tools','.github'];
const fixed=['package.json','README.md','LICENSE','.gitignore'];
const relativeFiles=[...fixed];
function walk(relative){
 for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){
  const next=relative+'/'+entry.name;if(entry.isSymbolicLink())throw Error('No se exportan enlaces: '+next);
  if(entry.isDirectory())walk(next);else if(entry.isFile()&&(/\.(?:cjs|mjs|js|cs|json|html|css|md|ya?ml)$/.test(entry.name)||relative==='public'&&/\.(?:png|ttf|txt)$/.test(entry.name)))relativeFiles.push(next);
 }
}
for(const relative of directories)if(fs.existsSync(path.join(root,relative)))walk(relative);
const build=path.join(root,'dist','public-source-'+version+'-'+new Date().toISOString().replace(/[^0-9]/g,'')),folder=path.join(build,'FarmDogs');
fs.mkdirSync(folder,{recursive:true});
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),files=[];
for(const relative of relativeFiles.sort()){
 const source=path.resolve(root,relative),target=path.resolve(folder,relative);
 if(!source.startsWith(root+path.sep)||!target.startsWith(folder+path.sep))throw Error('Ruta fuera del export.');
 const bytes=fs.readFileSync(source);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);files.push({path:relative,sha256:hash(bytes),bytes:bytes.length});
}
const manifest={application:'FarmDogs',version,folder,createdAt:new Date().toISOString(),sourceOnly:true,includesPrivateWorkspaceHistory:false,files};
fs.writeFileSync(path.join(build,'source-manifest.json'),JSON.stringify(manifest,null,2));fs.writeFileSync(path.join(root,'dist','latest-public-source.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({folder,files:files.length,bytes:files.reduce((sum,file)=>sum+file.bytes,0)}));
