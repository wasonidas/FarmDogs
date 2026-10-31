using System;
using WardogsSeeding;

public static class TeamClickerWaiterTests {
 sealed class Fake : ITeamClickerWaitApi {
  public bool Available=true,ScheduleOk=true,ThrowCreate,ThrowSchedule;
  public uint WaitResult;
  public int Creates,Schedules,Waits,Closes,Sleeps,LastSleep;
  public long Due;
  public IntPtr CreateHighResolution(){Creates++;if(ThrowCreate)throw new EntryPointNotFoundException("unsupported");return Available?new IntPtr(42):IntPtr.Zero;}
  public bool Schedule(IntPtr timer,long relativeDueTime){Schedules++;Due=relativeDueTime;if(ThrowSchedule)throw new InvalidOperationException("schedule failed");return ScheduleOk;}
  public uint Wait(IntPtr timer,uint timeout){Waits++;return WaitResult;}
  public void Close(IntPtr timer){Closes++;}
  public void Sleep(int milliseconds){Sleeps++;LastSleep=milliseconds;}
 }
 static int checks;
 static void Check(bool condition,string text){checks++;if(!condition)throw new Exception("Waiter: "+text);}
 public static int Run(){
  checks=0;var api=new Fake();var waiter=new TeamClickerWaiter(api);
  Check(waiter.Mode=="high_resolution_waitable_timer"&&api.Creates==1,"high resolution capability exposed");
  waiter.Delay(2);Check(api.Due==-20000&&api.Schedules==1&&api.Waits==1&&api.Sleeps==0,"relative one-shot 2ms timer used without Sleep");
  waiter.Delay(7);Check(api.Due==-70000&&api.Creates==1&&api.Schedules==2,"same owned timer is reused");
  waiter.Dispose();waiter.Dispose();Check(api.Closes==1,"owned handle closed exactly once");
  bool disposed=false;try{waiter.Delay(2);}catch(ObjectDisposedException){disposed=true;}Check(disposed,"disposed waiter never waits");
  api=new Fake{Available=false};using(waiter=new TeamClickerWaiter(api)){waiter.Delay(2);Check(waiter.Mode=="thread_sleep_fallback"&&api.LastSleep==2&&api.Waits==0,"unavailable timer falls back and exposes mode");}Check(api.Closes==0,"no nonexistent handle closed");
  api=new Fake{ThrowCreate=true};using(waiter=new TeamClickerWaiter(api)){waiter.Delay(2);Check(api.Sleeps==1&&!String.IsNullOrEmpty(waiter.Error),"unsupported API has explicit fallback reason");}
  api=new Fake{ScheduleOk=false};using(waiter=new TeamClickerWaiter(api)){waiter.Delay(2);waiter.Delay(2);Check(api.Closes==1&&api.Schedules==1&&api.Sleeps==2&&waiter.Mode=="thread_sleep_fallback","schedule failure permanently selects fallback");}
  api=new Fake{WaitResult=258};using(waiter=new TeamClickerWaiter(api)){waiter.Delay(2);Check(api.Closes==1&&api.Sleeps==1,"timeout closes handle and falls back");}
  api=new Fake{WaitResult=0xffffffff};using(waiter=new TeamClickerWaiter(api)){waiter.Delay(2);Check(api.Closes==1&&api.Sleeps==1,"wait error closes handle and falls back");}
  api=new Fake{ThrowSchedule=true};using(waiter=new TeamClickerWaiter(api)){waiter.Delay(2);Check(api.Closes==1&&api.Sleeps==1,"native exception falls back");}
  api=new Fake();using(waiter=new TeamClickerWaiter(api)){
   bool small=false,large=false;try{waiter.Delay(0);}catch(ArgumentOutOfRangeException){small=true;}try{waiter.Delay(1001);}catch(ArgumentOutOfRangeException){large=true;}
   Check(small&&large&&api.Schedules==0,"invalid wait duration is rejected");
  }
  return checks;
 }
}
