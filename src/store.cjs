const fs=require('node:fs');
const path=require('node:path');
const transientRenameErrors=new Set(['EPERM','EBUSY','EACCES']);
const renameWait=new Int32Array(new SharedArrayBuffer(4));
function atomicJson(file,value){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(value,null,2));
 // Windows readers can briefly deny replacement while their handle is open.
 // Retry only the atomic rename, never remove the previous complete document.
 for(let attempt=0;;attempt++){
  try{fs.renameSync(temporary,file);return;}
  catch(error){if(attempt>=3||!transientRenameErrors.has(error.code))throw error;Atomics.wait(renameWait,0,0,5);}
 }
}
function readJson(file,fallback=null){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}}
function appendEvent(file,event){fs.mkdirSync(path.dirname(file),{recursive:true});fs.appendFileSync(file,JSON.stringify(event)+'\n');}
module.exports={atomicJson,readJson,appendEvent};
