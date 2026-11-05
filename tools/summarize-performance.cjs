'use strict';
// Offline summaries only: explicit v2 JSON paths, no process discovery or app execution.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const FORMAT='farmdogs-process-tree-performance-v2';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const nonnegative=value=>finite(value)&&value>=0;
const approximately=(a,b)=>Math.abs(a-b)<=Math.max(1e-8,Math.abs(b)*1e-8);
const range=values=>({min:Math.min(...values),max:Math.max(...values)});
const sum=values=>values.reduce((total,value)=>total+value,0);

function readReport(file,{cores=16}={}){
 const resolved=path.resolve(file),errors=[];
 if(!fs.existsSync(resolved))return {file:resolved,valid:false,missing:true,errors:['missing_report']};
 let report,text;
 try{text=fs.readFileSync(resolved,'utf8').replace(/^\uFEFF/,'');report=JSON.parse(text);}catch{return {file:resolved,valid:false,missing:false,errors:['unreadable_or_invalid_json']};}
 if(report?.format!==FORMAT)errors.push('expected_v2_format');
 if(!Number.isSafeInteger(report.logicalProcessorsNormalization)||report.logicalProcessorsNormalization!==cores)errors.push('logical_processor_count_mismatch');
 if(!finite(report.actualDurationSeconds)||report.actualDurationSeconds<=0)errors.push('invalid_duration');
 if(!nonnegative(report.cpuSeconds))errors.push('invalid_cpu_counter');
 if(!nonnegative(report.cpuPercentTotalMean))errors.push('invalid_cpu_mean');
 const processes=Array.isArray(report.processes)?report.processes:[];
 if(!processes.length||processes.some(row=>!nonnegative(row.cpuSeconds)))errors.push('invalid_process_cpu_counters');
 if(report.trackedProcesses!==processes.length)errors.push('tracked_process_count_mismatch');
 const identities=processes.map(row=>row.processId+':'+row.createdAt);
 if(processes.some(row=>!Number.isSafeInteger(row.processId)||row.processId<1||!Number.isFinite(Date.parse(row.createdAt)))||new Set(identities).size!==identities.length)errors.push('invalid_or_duplicate_process_identity');
 const processCpu=sum(processes.map(row=>nonnegative(row.cpuSeconds)?row.cpuSeconds:0));
 if(nonnegative(report.cpuSeconds)&&!approximately(report.cpuSeconds,processCpu))errors.push('cpu_total_does_not_match_process_sum');
 const computedCpu=100*report.cpuSeconds/report.actualDurationSeconds/report.logicalProcessorsNormalization;
 if(finite(computedCpu)&&nonnegative(report.cpuPercentTotalMean)&&!approximately(report.cpuPercentTotalMean,computedCpu))errors.push('cpu_mean_does_not_match_counter_formula');
 for(const key of ['privateBytesMean','workingSetBytesMean','processReadBytes','processWriteBytes'])if(!nonnegative(report[key]))errors.push('invalid_'+key);
 const roots=Array.isArray(report.rootProcessIds)?report.rootProcessIds:[];
 if(!roots.length||roots.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(roots).size!==roots.length)errors.push('invalid_root_process_ids');
 const rootRows=processes.filter(row=>row.root===true);
 const allRootsAlive=roots.every(id=>rootRows.some(row=>row.processId===id&&row.aliveAtEnd===true));
 if(!allRootsAlive)errors.push('requested_root_missing_or_exited');
 if(!Array.isArray(report.failures)||report.failures.length)errors.push('sampler_failures');
 if(report.lateBaselineProcesses!==0)errors.push('late_process_baselines');
 if(processes.some(row=>row.readFailures!==0))errors.push('process_counter_read_failures');
 const samples=Array.isArray(report.samples)?report.samples:[];
 if(!samples.length)errors.push('missing_samples');
 if(samples.some(row=>row.memoryUnavailable!==0))errors.push('incomplete_memory_samples');
 if(samples.some(row=>row.ioUnavailable!==0))errors.push('incomplete_io_samples');
 let previous=-Infinity;
 for(const sample of samples){if(!nonnegative(sample.elapsedSeconds)||sample.elapsedSeconds<previous){errors.push('invalid_sample_timeline');break;}previous=sample.elapsedSeconds;}
 return {file:resolved,valid:errors.length===0,missing:false,errors,sha256:crypto.createHash('sha256').update(text).digest('hex'),report,computedCpu,coverage:{requestedRoots:roots,allRequestedRootsAlive:allRootsAlive,rootCount:roots.length,trackedProcessCount:processes.length,aliveProcessCount:processes.filter(row=>row.aliveAtEnd===true).length,failureCount:Array.isArray(report.failures)?report.failures.length:null,lateBaselineProcesses:report.lateBaselineProcesses,processReadFailures:sum(processes.map(row=>nonnegative(row.readFailures)?row.readFailures:0))}};
}

function summarizeGroup(name,files,options={}){
 const expectedRuns=options.runs??3;
 const rows=files.map(file=>readReport(file,options)),errors=[];
 if(files.length!==expectedRuns)errors.push('expected_'+expectedRuns+'_explicit_reports');
 if(new Set(rows.map(row=>row.file)).size!==rows.length)errors.push('duplicate_report_path');
 const hashes=rows.filter(row=>row.sha256).map(row=>row.sha256);
 if(new Set(hashes).size!==hashes.length)errors.push('duplicate_report_content');
 if(rows.some(row=>!row.valid))errors.push('invalid_or_missing_reports');
 const valid=errors.length===0;
 const output={name,valid,expectedRuns,receivedReports:rows.filter(row=>!row.missing).length,missing:rows.filter(row=>row.missing).map(row=>row.file),errors,reports:rows.map(({file,valid,missing,errors,sha256,coverage})=>({file,valid,missing,errors,...(sha256?{sha256}:{}),...(coverage?{coverage}:{})})),aggregate:null};
 if(!valid)return output;
 const data=rows.map(row=>row.report),elapsed=sum(data.map(row=>row.actualDurationSeconds)),cpuSeconds=sum(data.map(row=>row.cpuSeconds));
 const weighted=key=>sum(data.map(row=>row[key]*row.actualDurationSeconds))/elapsed;
 output.aggregate={runs:data.length,measurementSeconds:elapsed,logicalProcessors:options.cores??16,cpuSeconds,cpuPercentTotal:100*cpuSeconds/elapsed/(options.cores??16),cpuPercentOneCore:100*cpuSeconds/elapsed,cpuPercentTotalRunRange:range(rows.map(row=>row.computedCpu)),privateBytesMean:weighted('privateBytesMean'),privateMiBMean:weighted('privateBytesMean')/1048576,privateMiBRunRange:range(data.map(row=>row.privateBytesMean/1048576)),workingSetBytesMean:weighted('workingSetBytesMean'),workingSetMiBMean:weighted('workingSetBytesMean')/1048576,processReadBytesPerSecond:sum(data.map(row=>row.processReadBytes))/elapsed,processWriteBytesPerSecond:sum(data.map(row=>row.processWriteBytes))/elapsed,trackedProcessCountRange:range(data.map(row=>row.processes.length)),rootCountRange:range(rows.map(row=>row.coverage.rootCount)),samplerCpuPercentTotalMean:data.every(row=>nonnegative(row.samplerCpuPercentTotalMean))?weighted('samplerCpuPercentTotalMean'):null,warmupSecondsRange:data.every(row=>nonnegative(row.warmupSeconds))?range(data.map(row=>row.warmupSeconds)):null,sampleIntervalMsRange:data.every(row=>nonnegative(row.sampleIntervalMs))?range(data.map(row=>row.sampleIntervalMs)):null,discoveryIntervalSecondsRange:data.every(row=>nonnegative(row.discoveryIntervalSeconds))?range(data.map(row=>row.discoveryIntervalSeconds)):null};
 return output;
}

function compareGroups(from,to,{equivalent=false}={}){
 const key=from.name+':'+to.name;
 if(!from.valid||!to.valid)return {comparison:key,valid:false,equivalent:false,reason:'Both groups require complete valid reports.',difference:null};
 const a=from.aggregate,b=to.aggregate;
 if(a.logicalProcessors!==b.logicalProcessors)return {comparison:key,valid:false,equivalent:false,reason:'Different CPU normalizations.',difference:null};
 const equalRange=(left,right)=>!!left&&!!right&&left.min===left.max&&right.min===right.max&&left.min===right.min;
 const coverageComparable=equalRange(a.rootCountRange,b.rootCountRange)&&equalRange(a.trackedProcessCountRange,b.trackedProcessCountRange);
 const samplerSettingsComparable=equalRange(a.warmupSecondsRange,b.warmupSecondsRange)&&equalRange(a.sampleIntervalMsRange,b.sampleIntervalMsRange)&&equalRange(a.discoveryIntervalSecondsRange,b.discoveryIntervalSecondsRange);
 const verifiedEquivalent=equivalent&&coverageComparable&&samplerSettingsComparable;
 const relative=(before,after)=>before===0?null:100*(after-before)/before;
 return {comparison:key,valid:true,equivalent:verifiedEquivalent,equivalenceDeclared:equivalent,coverageComparable,samplerSettingsComparable,interpretation:verifiedEquivalent?'Same-condition comparison declared by the caller; the reports cannot verify visibility/account/game state themselves.':'Descriptive difference only; not a causal saving claim.',difference:{cpuPercentagePoints:b.cpuPercentTotal-a.cpuPercentTotal,cpuRelativePercent:relative(a.cpuPercentTotal,b.cpuPercentTotal),privateMiB:b.privateMiBMean-a.privateMiBMean,privateRelativePercent:relative(a.privateBytesMean,b.privateBytesMean),readBytesPerSecond:b.processReadBytesPerSecond-a.processReadBytesPerSecond,writeBytesPerSecond:b.processWriteBytesPerSecond-a.processWriteBytesPerSecond}};
}

function summarizePerformance(groups,{cores=16,runs=3,equivalentPairs=[],comparisons=[]}={}){
 if(!Number.isSafeInteger(cores)||cores<1||!Number.isSafeInteger(runs)||runs<1)throw Error('cores and runs must be positive integers.');
 const entries=Object.entries(groups);
 if(!entries.length)throw Error('At least one explicit group is required.');
 const result=entries.map(([name,files])=>{if(!/^[a-z][a-z0-9_-]{0,63}$/i.test(name)||!Array.isArray(files)||!files.length)throw Error('Each group needs a simple name and explicit report paths.');return summarizeGroup(name,files,{cores,runs});});
 const pairs=comparisons.length?comparisons:result.slice(1).map(group=>result[0].name+':'+group.name),equivalent=new Set(equivalentPairs);
 for(const pair of equivalent){const names=pair.split(':');if(names.length!==2||!result.some(group=>group.name===names[0])||!result.some(group=>group.name===names[1]))throw Error('Unknown equivalent comparison '+pair);}
 const comparisonResults=pairs.map(pair=>{const names=pair.split(':'),from=result.find(row=>row.name===names[0]),to=result.find(row=>row.name===names[1]);if(names.length!==2||!from||!to)throw Error('Unknown comparison '+pair);return compareGroups(from,to,{equivalent:equivalent.has(pair)});});
 return {format:'farmdogs-performance-summary-v1',createdAt:new Date().toISOString(),expectedFormat:FORMAT,expectedRuns:runs,logicalProcessors:cores,valid:result.every(group=>group.valid),groups:result,comparisons:comparisonResults,limitations:['Only explicit v2 files are read; missing or invalid groups have no aggregate.','CPU total is duration weighted from unrounded cumulative CPU counters and normalized by logical processors.','Memory means are duration-weighted report sample means, not continuously measured resident RAM.','Working-set sums may double-count shared pages; private bytes represent private commitment, not exclusive physical RAM.','I/O counters include cached, device and network I/O; bytes per second are not physical disk throughput.','Declared equivalence requires matching coverage and sampling settings, but visibility/account/game/automation state need independent evidence.','Different automation states may be compared descriptively; do not call that a causal reduction.','Short-lived descendants can be missed between inventories; no FPS, frametime, GPU or game-performance claim follows.','Sampler overhead is separate from target CPU and may influence the environment.']};
}

function parseArgs(args){
 const groups=Object.create(null),equivalentPairs=[],comparisons=[];let cores=16,runs=3,output=null;
 for(let index=0;index<args.length;index++){
  const flag=args[index],value=args[++index];if(!value)throw Error('Missing value for '+flag);
  if(flag==='--group'){const split=value.indexOf('=');if(split<1)throw Error('Use --group name=file1,file2,file3');const name=value.slice(0,split);if(Object.hasOwn(groups,name))throw Error('Duplicate group '+name);groups[name]=value.slice(split+1).split(',').filter(Boolean);}
  else if(flag==='--equivalent')equivalentPairs.push(value);
  else if(flag==='--compare')comparisons.push(value);
  else if(flag==='--cores')cores=Number(value);
  else if(flag==='--runs')runs=Number(value);
  else if(flag==='--output')output=value;
  else throw Error('Unknown argument '+flag);
 }
 return {groups,options:{cores,runs,equivalentPairs,comparisons},output};
}
if(require.main===module){
 try{const {groups,options,output}=parseArgs(process.argv.slice(2)),summary=summarizePerformance(groups,options),json=JSON.stringify(summary,null,2)+'\n';if(output)fs.writeFileSync(path.resolve(output),json,{encoding:'utf8',flag:'wx'});process.stdout.write(json);if(!summary.valid)process.exitCode=1;}
 catch(error){process.stderr.write('Performance summary: '+error.message+'\nUsage: node tools/summarize-performance.cjs --group baseline=a.json,b.json,c.json --group candidate=d.json,e.json,f.json --group quiet=g.json,h.json,i.json --equivalent baseline:candidate [--output new-summary.json]\n');process.exitCode=2;}
}
module.exports={readReport,summarizeGroup,compareGroups,summarizePerformance};
