'use strict';
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
// Explicit source roots keep exported source snapshots in dist out of the suite.
const files=[...fs.readdirSync(path.join(root,'test')).filter(name=>name.endsWith('.test.cjs')).map(name=>path.join('test',name)),...fs.readdirSync(__dirname).filter(name=>/^test-.*\.cjs$/.test(name)).map(name=>path.join('tools',name))].sort();
const result=spawnSync(process.execPath,['--test',...files],{cwd:root,stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;
process.exitCode=result.status===null?1:result.status;
