'use strict';
const path=require('node:path');
const {execFileSync}=require('node:child_process');
execFileSync(process.execPath,[path.join(__dirname,'build-team-clicker.cjs'),'--test-only',...process.argv.slice(2)],{cwd:path.resolve(__dirname,'..'),stdio:'inherit',windowsHide:true,timeout:30000});
