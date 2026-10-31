'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {atomicJson}=require('../src/store.cjs');

function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wardogs-store-test-')),file=path.join(dir,'command.json');
 const previous=JSON.stringify({enabled:true,session:'previous'});fs.writeFileSync(file,previous);
 t.after(()=>{const relative=path.relative(os.tmpdir(),dir);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(dir).startsWith('wardogs-store-test-'));fs.rmSync(dir,{recursive:true,force:true});});
 return {file,previous};
}

test('almacén: un bloqueo temporal de reemplazo conserva JSON anterior hasta el cambio atómico',t=>{
 const f=fixture(t),rename=fs.renameSync,next={enabled:false,session:'previous'};let calls=0;
 fs.renameSync=(source,target)=>{calls++;assert.equal(fs.readFileSync(target,'utf8'),f.previous);assert.deepEqual(JSON.parse(fs.readFileSync(source,'utf8')),next);if(calls<=2)throw Object.assign(Error('Lector temporal'),{code:calls===1?'EPERM':'EACCES'});return rename(source,target);};
 try{atomicJson(f.file,next);}finally{fs.renameSync=rename;}
 assert.equal(calls,3);assert.deepEqual(JSON.parse(fs.readFileSync(f.file,'utf8')),next);assert.equal(fs.existsSync(f.file+'.tmp'),false);
});

test('almacén: un bloqueo persistente termina tras cuatro intentos y mantiene el destino completo',t=>{
 const f=fixture(t),rename=fs.renameSync,error=Object.assign(Error('Lector bloqueado'),{code:'EBUSY'});let calls=0;
 fs.renameSync=()=>{calls++;throw error;};
 try{assert.throws(()=>atomicJson(f.file,{enabled:false}),value=>value===error);}finally{fs.renameSync=rename;}
 assert.equal(calls,4);assert.equal(fs.readFileSync(f.file,'utf8'),f.previous);assert.deepEqual(JSON.parse(fs.readFileSync(f.file+'.tmp','utf8')),{enabled:false});
});

test('almacén: un error ajeno al bloqueo no se reintenta ni borra el destino',t=>{
 const f=fixture(t),rename=fs.renameSync,error=Object.assign(Error('Error de dispositivo'),{code:'EIO'});let calls=0;
 fs.renameSync=()=>{calls++;throw error;};
 try{assert.throws(()=>atomicJson(f.file,{enabled:false}),value=>value===error);}finally{fs.renameSync=rename;}
 assert.equal(calls,1);assert.equal(fs.readFileSync(f.file,'utf8'),f.previous);
});
