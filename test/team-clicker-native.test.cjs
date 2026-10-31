'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
test('autoclic nativo: concesión, calibración, alternar y parada con entrada simulada',{skip:process.platform!=='win32',timeout:35000},()=>{
 const output=execFileSync(process.execPath,[path.join(__dirname,'..','tools','test-team-clicker.cjs')],{encoding:'utf8',windowsHide:true,timeout:30000});
 assert.match(output,/Team clicker: \d+ checks passed; no native input/);
});
