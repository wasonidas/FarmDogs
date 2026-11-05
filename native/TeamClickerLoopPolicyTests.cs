using System;
using WardogsSeeding;

public static class TeamClickerLoopPolicyTests {
 static int checks;
 static void Check(bool condition,string name){checks++;if(!condition)throw new Exception(name);}
 public static int Main(){
  try{
   Check(TeamClickerLoopPolicy.ReadMilliseconds(false)==250,"Unarmed command reads are throttled to four per second.");
   Check(TeamClickerLoopPolicy.WriteMilliseconds(false)==1000,"Unarmed status remains fresh without four disk writes per second.");
   Check(TeamClickerLoopPolicy.WriteMilliseconds(false)<3500,"Unarmed status stays within the native freshness contract.");
   Check(TeamClickerLoopPolicy.ReadMilliseconds(true)==50,"Armed lease and entry confirmation polling are unchanged.");
   Check(TeamClickerLoopPolicy.WriteMilliseconds(true)==250,"Armed status cadence is unchanged.");
   Check(TeamClickerLoopPolicy.WaitMilliseconds(true)==2,"Click cadence and emergency-key polling remain fast.");
   Check(TeamClickerLoopPolicy.WaitMilliseconds(false)==2,"A short F8 tap is still observed while the persistent mode is between attempts.");
   var first="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";var second="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
   var stop=new TeamClickerStopGate();
   Check(stop.ShouldStop(true,first),"F8 already held at helper startup cancels a disabled session too.");
   Check(!stop.ShouldStop(true,first),"One held key does not repeatedly cancel the same UUID.");
   Check(stop.ShouldStop(true,second),"A new grant while F8 remains held is also stopped.");
   Check(!stop.ShouldStop(false,second)&&stop.ShouldStop(true,second),"Releasing F8 allows a new press on the same UUID.");
   stop=new TeamClickerStopGate();
   Check(!stop.ShouldStop(true,null),"A press before the command exists waits for a valid UUID.");
   Check(!stop.ShouldStop(false,null),"Releasing before the command arrives does not invent a null-UUID stop.");
   Check(stop.ShouldStop(false,first),"An observed pre-command press remains latched until the first valid disabled command.");
   Check(!stop.ShouldStop(false,first),"The pending pre-command stop is consumed exactly once.");
   stop=new TeamClickerStopGate();
   Check(!stop.ShouldStop(true,"invalid")&&stop.ShouldStop(true,first),"An invalid command cannot absorb an operator stop before a valid grant.");
   Check(!stop.ShouldStop(true,first.ToUpperInvariant()),"Held-session deduplication uses UUID identity, not casing.");
   stop=new TeamClickerStopGate();
   Check(!stop.ShouldStop(false,null)&&!stop.ShouldStop(false,first),"An idle helper never emits a stop without a press.");
   // State changes must bypass the slower periodic deadline in the host loop;
   // this policy intentionally does not throttle emergency-key observation.
   Console.WriteLine("Team clicker loop policy: "+checks+" checks passed; no inputs or processes opened.");return 0;
  }catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
 }
}
