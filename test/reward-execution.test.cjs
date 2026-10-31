const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/reward-execution.js'),'utf8');
const OWNER='76561198000000000',ID='11111111-1111-4111-8111-111111111111',READER='22222222-2222-4222-8222-222222222222';
const initialNow=Date.parse('2026-10-28T22:55:00Z'),deadline=Date.parse('2026-10-28T23:00:00Z');
function fixture(options={}){
 let clock=initialNow,identityReads=0,rewardReads=0;const calls=[];
 const command={id:ID,readerId:READER,accountId:OWNER,week:'2026-10-19',contextWeek:'2026-10-26',hito:'semanal_3',dias:1,anterior:true,deadline:new Date(deadline).toISOString(),notBefore:'2026-10-28T22:30:00Z',issuedAt:new Date(clock).toISOString(),expiresAt:new Date(clock+15000).toISOString()};
 const data={activos:true,semana:'2026-10-26',hitos:[{id:'semanal_3',alcanzado:true,cobrado:false,dias:1}],anterior:{semana:'2026-10-19',cobrarHasta:deadline,hitos:[{id:'semanal_3',alcanzado:true,cobrado:false,dias:1}]}};
 const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(body)});
 let context;
 const fetch=async(url,init)=>{
  calls.push({url,...init});
  if(options.fetch)return options.fetch(url,init,{response,data,command,advance:ms=>clock+=ms,context});
  if(url.endsWith('/yo')){identityReads++;if(options.identityChange&&identityReads===2)return response({conectado:true,cuenta:{steamId:'76561198000000001'}});if(options.expireBeforePost&&identityReads===2)clock=Date.parse(command.expiresAt);return response({conectado:true,cuenta:{steamId:OWNER}});}
  if(url.endsWith('/retos')){rewardReads++;if(options.cancelOnRead)context.__wardogsRewardExecutionState.active[READER].controller.abort();const result=structuredClone(data);if(options.confirm&&rewardReads===2)result.anterior.hitos[0].cobrado=true;return response(result);}
  if(url.endsWith('/cobrar')){if(options.postThrow)throw Error('Transport timeout');return response(options.postBody===undefined?{dias:command.dias}:options.postBody,options.postStatus||200);}
  throw Error('Unexpected URL');
 };
 class ClockDate extends Date {static now(){return clock;}}
 context=vm.createContext({fetch,Date:ClockDate,AbortController,setTimeout,clearTimeout});
 const execute=vm.runInContext('('+source+')',context);
 return {command,data,calls,execute,context,posts:()=>calls.filter(call=>call.method==='POST'),run:()=>execute(command),advance:ms=>clock+=ms};
}
test('ejecutor: cobra solo un hito anterior pendiente con identidad, plazo y concesión vigentes',async()=>{
 const f=fixture();assert.equal((await f.run()).status,'success');assert.equal(f.posts().length,1);
 const posted=f.posts()[0];assert.equal(posted.url,'https://api.wardogsspain.com/api/cuenta/retos/cobrar');assert.deepEqual(JSON.parse(posted.body),{hito:'semanal_3',anterior:true});assert.equal(posted.headers['X-WDE'],'1');assert.equal(posted.credentials,'include');assert.equal(f.calls.filter(call=>call.url.endsWith('/yo')).length,2);
});
test('ejecutor: admite fecha de cobro ISO o milisegundos y semana anterior derivada sin campo opcional',async()=>{
 for(const value of [deadline,new Date(deadline).toISOString()]){const f=fixture();f.data.anterior.cobrarHasta=value;delete f.data.anterior.semana;assert.equal((await f.run()).status,'success');assert.equal(f.posts().length,1);}
});
test('ejecutor: la semana actual, demasiado pronto, caducidad y concesión antigua nunca mandan POST',async()=>{
 for(const change of [f=>f.command.anterior=false,f=>f.command.week=f.command.contextWeek,f=>f.command.notBefore=new Date(initialNow+60000).toISOString(),f=>f.command.deadline=new Date(initialNow).toISOString(),f=>f.command.expiresAt=new Date(initialNow).toISOString(),f=>f.command.expiresAt=new Date(initialNow+20001).toISOString()]){const f=fixture();change(f);assert.equal((await f.run()).status,'skipped');assert.equal(f.posts().length,0);}
});
test('ejecutor: valida campos, margen y fechas de semana sin ejecutar entradas malformadas',async()=>{
 for(const change of [f=>f.command.week='2026-13-19',f=>f.command.readerId='__proto__',f=>f.command.accountId='invalid',f=>f.command.hito='gift',f=>f.command.dias=2,f=>f.command.notBefore=new Date(deadline-4*60000).toISOString(),f=>f.command.notBefore=new Date(deadline-121*60000).toISOString()]){const f=fixture();change(f);assert.equal((await f.run()).status,'skipped');assert.equal(f.calls.length,0);}
});
test('ejecutor: no basta con que haya un premio pendiente en la semana actual o en otro contexto',async()=>{
 for(const change of [f=>f.data.anterior=null,f=>f.data.semana='2026-11-02',f=>f.data.anterior.semana='2026-10-12',f=>f.data.anterior.cobrarHasta=deadline+1,f=>f.data.anterior.hitos[0].alcanzado=false,f=>f.data.anterior.hitos[0].dias=2,f=>f.data.activos=false]){const f=fixture();change(f);assert.equal((await f.run()).status,'skipped');assert.equal(f.posts().length,0);}
});
test('ejecutor: una identidad diferente o cambiada antes de escribir impide el cobro',async()=>{
 let f=fixture({identityChange:true});assert.equal((await f.run()).status,'skipped');assert.equal(f.posts().length,0);
 f=fixture();f.command.accountId='76561198000000001';assert.equal((await f.run()).status,'skipped');assert.equal(f.posts().length,0);
});
test('ejecutor: vuelve a comprobar el tiempo y la cancelación justo antes de POST',async()=>{
 for(const options of [{expireBeforePost:true},{cancelOnRead:true}]){const f=fixture(options);assert.equal((await f.run()).status,'skipped');assert.equal(f.posts().length,0);}
});
test('ejecutor: un premio ya cobrado no se vuelve a solicitar',async()=>{
 let f=fixture();f.data.anterior.hitos[0].cobrado=true;assert.equal((await f.run()).status,'already_claimed');assert.equal(f.posts().length,0);
 f=fixture({postBody:{error:'ya_cobrado'},postStatus:409});assert.equal((await f.run()).status,'already_claimed');assert.equal(f.posts().length,1);
});
test('ejecutor: un HTTP200 vacío necesita confirmación; sin ella conserva resultado incierto',async()=>{
 for(const confirm of [true,false]){const f=fixture({postBody:{},confirm});assert.equal((await f.run()).status,confirm?'success':'uncertain');assert.equal(f.posts().length,1);}
});
test('ejecutor: una pérdida de respuesta tras POST no se reintenta automáticamente',async()=>{
 const f=fixture({postThrow:true});assert.equal((await f.run()).status,'uncertain');assert.equal((await f.run()).status,'skipped');assert.equal(f.posts().length,1);
});
test('ejecutor: un error de lectura no llega a la mutación y un error500 de cobro queda incierto',async()=>{
 let f=fixture({fetch:async()=>{throw Error('Network read failed');}});assert.equal((await f.run()).status,'error');assert.equal(f.posts().length,0);
 f=fixture({postStatus:500,postBody:{error:'server'}});assert.equal((await f.run()).status,'uncertain');assert.equal(f.posts().length,1);
});
test('ejecutor: admite el segundo hito anterior solamente con sus dos días exactos',async()=>{
 const f=fixture();f.command.hito='semanal_6';f.command.dias=2;f.data.anterior.hitos=[{id:'semanal_6',dias:2,alcanzado:true,cobrado:false}];assert.equal((await f.run()).status,'success');assert.deepEqual(JSON.parse(f.posts()[0].body),{hito:'semanal_6',anterior:true});
});
