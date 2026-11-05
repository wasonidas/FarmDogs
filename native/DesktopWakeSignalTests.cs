using System;
using System.Collections.Generic;
using System.Threading;

internal static class DesktopWakeSignalTests {
 static int checks;
 static void Check(bool condition,string text){checks++;if(!condition)throw new Exception(text);}
 public static int Main(){
  try{
   var queued=new Queue<Action>();var gate=new object();int wakes=0,posts=0;
   using(var signal=new EventWaitHandle(false,EventResetMode.AutoReset))
   using(var posted=new AutoResetEvent(false)){
    var watcher=new DesktopWakeSignal(signal,action=>{lock(gate){queued.Enqueue(action);posts++;}posted.Set();},()=>wakes++);
    Check(!posted.WaitOne(80)&&wakes==0,"Idle wait does not schedule periodic UI callbacks.");
    signal.Set();Check(posted.WaitOne(3000),"A second-instance signal schedules a callback.");
    Check(wakes==0,"The wait thread never directly manipulates the UI.");
    Action first;lock(gate)first=queued.Dequeue();first();
    Check(wakes==1,"Owner-dispatched wake callback runs once.");
    signal.Set();Check(posted.WaitOne(3000),"A later signal still wakes the owner.");
    Action second;lock(gate)second=queued.Dequeue();watcher.Dispose();second();
    Check(wakes==1,"A queued wake is inert after disposal.");
    watcher.Dispose();signal.Set();Check(!posted.WaitOne(80),"Disposal unregisters future wake events.");
   }
   using(var signal=new EventWaitHandle(false,EventResetMode.AutoReset))
   using(var attempted=new AutoResetEvent(false)){
    int attempts=0;
    using(var watcher=new DesktopWakeSignal(signal,action=>{Interlocked.Increment(ref attempts);attempted.Set();throw new InvalidOperationException("owner closed");},()=>{throw new Exception("must not run");})){
     signal.Set();Check(attempted.WaitOne(3000),"A closing owner can reject a dispatch.");
     // The failed post releases its coalescing guard before the next event.
     for(int i=0;i<20&&attempts<2;i++){signal.Set();attempted.WaitOne(100);}
     Check(attempts>=2,"A rejected dispatch does not permanently wedge the subscription.");
    }
   }
   Console.WriteLine("Desktop wake signal: "+checks+" checks passed; local event handles only, no windows opened.");return 0;
  }catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
 }
}
