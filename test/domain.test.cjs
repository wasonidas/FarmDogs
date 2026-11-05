const {test}=require('node:test');
const assert=require('node:assert/strict');
const {madridToUtc,validateProfile,defaultProfiles,normalizeServers,serverView,recommend,advanceObservation,rewardDifference}=require('../src/domain.cjs');
const now=Date.parse('2026-10-29T08:00:00Z');
const row=(players,extra={})=>({id:1,num:2,name:'#2',players,maxPlayers:100,online:true,configured:true,sedeoActivo:true,sedeo:{tope:20,esperaMin:30,cobroN:50},...extra});
const payload=(players,extra={})=>({configured:true,fetchedAt:now,servers:[row(players,extra)]});
const profile=defaultProfiles().find(p=>p.server===2);
const view=(players,extra={})=>serverView(normalizeServers(payload(players,extra),now)[0],profile,now);
const watch=(p=profile)=>({status:'watching',profile:p,durationMinutes:120,elapsedMs:0,holdStartedElapsedMs:null,rewardVerified:false});

test('marcadores públicos: conserva facciones y modo sin mezclar confianza de población con marcador',()=>{
 const factions=[{name:'Lonestar',color:'#4cb1ef',score:0},{name:'Valkyra',color:'#fa503e',score:34},{name:'Manticore',color:'#1dd65c',score:99}],input=payload(19,{factions,experience:'Madrid_KOTH_01'}),result=normalizeServers(input,now)[0];
 assert.equal(result.scoresTrusted,true);assert.equal(result.experience,'Madrid_KOTH_01');assert.deepEqual(result.factions.map(f=>f.score),[0,34,99]);assert.equal(result.factions[0].color,'#4CB1EF');result.factions[0].score=90;assert.equal(factions[0].score,0);
 for(const invalid of [Infinity,NaN,true,'99',-1,1.5]){const corrupt=structuredClone(factions);corrupt[0].score=invalid;const bad=normalizeServers(payload(19,{factions:corrupt}),now)[0];assert.equal(bad.trusted,true);assert.equal(bad.scoresTrusted,false);assert.equal(bad.players,19);assert.deepEqual(bad.factions,[]);}
});
test('marcadores públicos: rechaza identidades de facción duplicadas y caduca con la fuente',()=>{
 const factions=[{name:'Lonestar',color:'#4CB1EF',score:0},{name:'Valkyra',color:'#FA503E',score:34},{name:'Manticore',color:'#1DD65C',score:99}];
 for(const invalid of [[factions[0],factions[0],factions[2]],factions.slice(0,2),[{...factions[0],color:'red'},...factions.slice(1)]])assert.equal(normalizeServers(payload(19,{factions:invalid}),now)[0].scoresTrusted,false);
 const fresh=normalizeServers(payload(19,{factions}),now)[0];assert.equal(serverView(fresh,profile,now+90001).scoresTrusted,false);assert.equal(serverView(fresh,profile,now,'HTTP 429').scoresTrusted,false);
});

test('un perfil pasado de su revisión deja de recomendar, aunque la población sea reciente',()=>{
 const p={...profile,verifiedAt:new Date(now-24*3600000+1).toISOString(),reviewAfterHours:24};
 assert.equal(serverView(normalizeServers(payload(6),now)[0],p,now).entryCandidate,true);
 p.verifiedAt=new Date(now-24*3600000).toISOString();const s=serverView(normalizeServers(payload(6),now)[0],p,now);
 assert.equal(s.trusted,true);assert.equal(s.entryCandidate,false);assert.equal(s.ruleValidity,'stale');
});
test('el plazo local de revisión se configura sin cambiar la condición del servidor',()=>{
 const p=validateProfile({...profile,reviewAfterHours:48,verifiedAt:new Date(now-36*3600000).toISOString()});
 assert.equal(p.target,50);assert.equal(serverView(normalizeServers(payload(6),now)[0],p,now).entryCandidate,true);
 assert.throws(()=>validateProfile({...profile,reviewAfterHours:0}),/1 a 168/);assert.throws(()=>validateProfile({...profile,reviewAfterHours:169}),/1 a 168/);
});
test('una fecha de verificación futura no confirma el perfil',()=>{
 const s=serverView(normalizeServers(payload(6),now)[0],{...profile,verifiedAt:new Date(now+3600000).toISOString()},now);
 assert.equal(s.entryCandidate,false);assert.equal(s.ruleValidity,'future');
});
test('un perfil que necesita revisión durante la sesión no convierte el objetivo en candidato de premio',()=>{
 const later=Date.parse(profile.verifiedAt)+24*3600000;
 const s=serverView(normalizeServers({...payload(50),fetchedAt:later},later)[0],profile,later);
 const next=advanceObservation(watch(),s,60000);assert.equal(next.status,'requires_review');assert.equal(next.rewardVerified,false);
});

test('distintas precisiones ISO del mismo premio no lo convierten en un registro nuevo',()=>{
 const before={historial:[{origen:'sedeo',servidor:2,at:'2026-10-29T08:00:00.1Z',dias:1}]};
 const after={historial:[{origen:'sedeo',servidor:2,at:'2026-10-29T08:00:00.100Z',dias:1}]};
 assert.equal(rewardDifference(before,after,2,'2026-10-29T07:00:00Z').newSeeding.length,0);
});
test('Madrid se interpreta independientemente de la zona del proceso',()=>{
 assert.equal(madridToUtc('2026-10-29T10:30'),'2026-10-29T09:30:00.000Z');
 assert.equal(madridToUtc('2027-07-01T10:30'),'2027-07-01T08:30:00.000Z');
});
test('no programa una hora inexistente o duplicada por el cambio de hora',()=>{
 assert.throws(()=>madridToUtc('2027-03-28T02:30'),/no existe/);
 assert.throws(()=>madridToUtc('2026-10-25T02:30'),/se repite/);
 assert.throws(()=>madridToUtc('2027-02-30T12:00'),/no existe/);
});
test('el número visible se conserva distinto del ID interno',()=>{
 const result=normalizeServers(payload(19),now)[0];assert.equal(result.number,2);assert.equal(result.apiId,1);
});
test('19 permite candidato; 20 y 21 no permiten una entrada nueva elegible',()=>{
 assert.equal(view(19).entryCandidate,true);assert.equal(view(20).entryCandidate,false);assert.equal(view(21).entryCandidate,false);
});
test('no presenta cero ni recomienda cuando la población está desactualizada',()=>{
 const result=view(0,{stale:true});assert.equal(result.trusted,false);assert.equal(result.entryCandidate,false);assert.equal(recommend([result]),null);
 const old=payload(0);old.fetchedAt=now-90001;assert.equal(serverView(normalizeServers(old,now)[0],profile,now).entryCandidate,false);
});
test('el envejecimiento se evalúa también entre sondeos y el fallo invalida datos conservados',()=>{
 const result=normalizeServers(payload(19),now)[0];assert.equal(serverView(result,profile,now+90001).trusted,false);assert.equal(serverView(result,profile,now,'HTTP 429').trusted,false);
});
test('población corrupta, fechas futuras y servidor sin configurar no dan candidatos',()=>{
 for(const count of [-1,101,1.5,'19',null])assert.equal(view(count).entryCandidate,false);
 const future=payload(19);future.fetchedAt=now+61000;assert.equal(normalizeServers(future,now)[0].trusted,false);
 const unconfigured=payload(19);unconfigured.configured=false;assert.equal(normalizeServers(unconfigured,now)[0].trusted,false);
});
test('el perfil desconocido no se deduce de tener esperaMin y cobroN juntos',()=>{
 const p={...profile,mode:'unknown',verifiedAt:null};const result=serverView(normalizeServers(payload(19),now)[0],p,now);assert.equal(result.status,'rule_unknown');assert.equal(result.entryCandidate,false);
});
test('el seeding desactivado tampoco es un candidato con población baja',()=>{
 const result=view(3,{sedeoActivo:false});assert.equal(result.entryCandidate,false);assert.equal(advanceObservation(watch(),result,100).status,'requires_review');
});
test('la recomendación prefiere el candidato más próximo al umbral, sin elegir uno lleno',()=>{
 const a={...view(5),number:1},b={...view(18),number:2},c={...view(30),number:3};assert.equal(recommend([a,b,c]),2);
});
test('alcanzar 50 solo da un candidato público de recompensa',()=>{
 const result=advanceObservation(watch(),view(50),10000);assert.equal(result.status,'target_candidate');assert.equal(result.rewardVerified,false);
 assert.equal(advanceObservation(watch(),view(20),10000).status,'threshold_candidate');
});
test('una ausencia de fuente no se convierte en población cero ni en fin correcto',()=>{
 const result=advanceObservation(watch(),null,10000);assert.equal(result.status,'unknown_source');assert.equal(result.holdStartedElapsedMs,null);assert.notEqual(result.status,'target_candidate');
});
test('el máximo de tiempo termina aunque la fuente falle',()=>{
 const result=advanceObservation({...watch(),durationMinutes:1},null,60000);assert.equal(result.status,'expired');
});
test('la regla temporal exige un periodo completo tras el umbral y sigue sin acreditar VIP',()=>{
 const p=validateProfile({...profile,mode:'timed',holdMinutes:30});let result=advanceObservation(watch(p),view(20),1000);
 result=advanceObservation(result,view(22),1800999);assert.equal(result.status,'threshold_candidate');
 result=advanceObservation(result,view(22),1801000);assert.equal(result.status,'time_candidate');assert.equal(result.rewardVerified,false);
});
test('la caída de población durante permanencia exige revisar la continuidad',()=>{
 const p=validateProfile({...profile,mode:'timed',holdMinutes:30});let result=advanceObservation(watch(p),view(20),1000);result=advanceObservation(result,view(19),2000);assert.equal(result.status,'requires_review');
 assert.equal(advanceObservation(result,view(25),1900000).status,'requires_review');
});
test('un corte de datos reinicia la referencia temporal; no cuenta ese hueco como permanencia',()=>{
 const p=validateProfile({...profile,mode:'timed',holdMinutes:30});let result=advanceObservation(watch(p),view(20),1000);result=advanceObservation(result,null,1000000);result=advanceObservation(result,view(20),1801000);assert.equal(result.status,'threshold_candidate');assert.equal(result.holdStartedElapsedMs,1801000);
});
test('los perfiles se validan antes de guardarse',()=>{
 assert.throws(()=>validateProfile({...profile,server:6}));assert.throws(()=>validateProfile({...profile,target:19}));assert.throws(()=>validateProfile({...profile,mode:'timed',holdMinutes:0}));assert.throws(()=>validateProfile({...profile,verifiedAt:null}));assert.throws(()=>validateProfile({...profile,source:''}));
});
test('cambiar una regla guardada no reescribe la copia de una sesión iniciada',()=>{
 const p=structuredClone(profile),w=watch(structuredClone(p));p.target=30;assert.equal(advanceObservation(w,view(30),100).status,'threshold_candidate');assert.equal(w.profile.target,50);
});
test('VIP existente y un contador de caducidad distinto no bastan para atribuir seeding',()=>{
 const before={prioridad:{caduca:'2026-10-30T09:51:00Z'},historial:[]};const after={prioridad:{caduca:'2026-10-31T09:51:00Z'},historial:[{origen:'fidelidad',dias:1,at:'2026-10-29T08:10:00Z'}]};const result=rewardDifference(before,after,2,'2026-10-29T08:00:00Z');assert.equal(result.status,'no_new_seeding_record');assert.equal(result.expiryDeltaMs,86400000);
});
test('detecta solo premios nuevos de seeding del servidor y sesión indicados',()=>{
 const old={origen:'sedeo',servidor:2,dias:1,at:'2026-10-27T12:00:00Z'};const before={prioridad:{caduca:'2026-10-30T09:51:00Z'},historial:[old]};
 const fresh={origen:'sedeo',servidor:2,dias:1,at:'2026-10-29T08:10:00Z'};const other={...fresh,servidor:1};const after={prioridad:{caduca:'2026-10-31T09:51:00Z'},historial:[old,fresh,other]};const result=rewardDifference(before,after,2,'2026-10-29T08:00:00Z');assert.deepEqual(result.newSeeding,[fresh]);assert.equal(result.status,'new_seeding_record');assert.equal(result.expiryDeltaMs,86400000);
 assert.equal(rewardDifference(before,after,2,'2026-10-29T08:20:00Z').newSeeding.length,0);
});
test('un historial ausente conserva el resultado desconocido',()=>{assert.equal(rewardDifference(null,{historial:[]},2,new Date().toISOString()).status,'unknown');});
