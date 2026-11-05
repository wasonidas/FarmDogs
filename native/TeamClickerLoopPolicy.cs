namespace WardogsSeeding {
 // Keep emergency-key observation fast even after an attempt has completed.
 // Only disk traffic slows down while no native input permission is armed.
 public static class TeamClickerLoopPolicy {
  public static int ReadMilliseconds(bool armed){return armed?50:250;}
  public static int WriteMilliseconds(bool armed){return armed?250:1000;}
  public static int WaitMilliseconds(bool armed){return 2;}
 }
 // F8 belongs to the operator even when the current command is disabled. A
 // key already held when the helper starts must not become the initial ignored
 // edge. Remember a press observed before a valid command until its UUID exists.
 public sealed class TeamClickerStopGate {
  string stoppedHeldSession;
  bool pendingWithoutSession;
  public bool ShouldStop(bool held,string sessionId){
   if(!held)stoppedHeldSession=null;
   System.Guid parsed;
   if(!System.Guid.TryParseExact(sessionId,"D",out parsed)){if(held)pendingWithoutSession=true;return false;}
   if(pendingWithoutSession){pendingWithoutSession=false;if(held)stoppedHeldSession=sessionId;return true;}
   if(!held||System.String.Equals(stoppedHeldSession,sessionId,System.StringComparison.OrdinalIgnoreCase))return false;
   stoppedHeldSession=sessionId;return true;
  }
 }
}
