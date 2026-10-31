'use strict';

// Pure classification used by regression tests. No network, files, timers,
// account session or game controller is loaded by this helper.
function classifySpainServers(servers){
 const uuid=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
 const verified=servers.filter(s=>s.trusted&&/(?:^|[\s\]])wardogsspain\.com(?=$|[\s|])/i.test(s.name)&&uuid.test(s.joinId||''));
 const unconfirmedServers=[1,2,3,4,5].filter(n=>!verified.some(s=>s.number===n));
 const eligible=verified.filter(s=>s.players>=20);
 const candidates=eligible.filter(s=>s.players<s.capacity).sort((a,b)=>b.players-a.players||a.number-b.number);
 const fullServers=eligible.filter(s=>s.players===s.capacity);
 const status=candidates.length?'candidate_needs_game_confirmation':unconfirmedServers.length?'source_unconfirmed':fullServers.length?'full_servers_only':'awaiting_population';
 return {status,candidates,fullServers,unconfirmedServers,matchPhaseVerified:false};
}
module.exports={classifySpainServers};
