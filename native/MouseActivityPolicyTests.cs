using System;
using WardogsSeeding;
internal static class MouseActivityPolicyTests {
 static int checks;static readonly DateTime now=new DateTime(2026,11,4,12,0,0,DateTimeKind.Utc);
 static void Check(bool good,string message){checks++;if(!good)throw new Exception(message);}
 static void Invalid(int seconds){try{new MousePauseSettings{resumeAfterSeconds=seconds}.Validate();throw new Exception("Invalid pause accepted");}catch(ArgumentException){checks++;}}
 public static int Main(){
  var settings=MousePauseSettings.Normalize(null);Check(settings.enabled&&settings.resumeAfterSeconds==3,"Default pause is three seconds");Invalid(0);Invalid(31);
  var policy=new MouseActivityPolicy();Check(!policy.View(settings,now,0).active,"Starting without an event cannot fabricate activity");
  policy.InitializePosition(100,100);policy.Observe(0x200,100,100,0,UIntPtr.Zero,0);Check(!policy.View(settings,now,0).active,"Initial cursor position or an identical move does not invent user activity");
  policy.Observe(0x200,100,100,0,FarmDogsInputMarker.Value,1);Check(!policy.View(settings,now,2).active,"Own movement is ignored");
  policy.Observe(0x201,100,100,0,FarmDogsInputMarker.Value,3);Check(!policy.View(settings,now,4).active,"Own click is ignored");
  policy.Observe(0x200,101,100,0,UIntPtr.Zero,10);var active=policy.View(settings,now,11);Check(active.active&&!active.buttonsDown&&active.remainingMs==2999,"Human movement pauses");
  policy.Observe(0x200,101,100,0,UIntPtr.Zero,2999);Check(!policy.View(settings,now,3010).active,"Duplicate zero movement cannot extend pause");
  policy.Observe(0x200,500,500,0,FarmDogsInputMarker.Value,4000);policy.Observe(0x200,500,500,0,UIntPtr.Zero,4001);Check(!policy.View(settings,now,4002).active,"Own warp updates position without causing delayed self pause");
  policy.Observe(0x20a,500,500,120u<<16,UIntPtr.Zero,5000);Check(policy.View(settings,now,5001).active,"Wheel activity pauses");Check(!policy.View(settings,now,8000).active,"Exact monotonic deadline resumes");
  policy.Observe(0x201,500,500,0,UIntPtr.Zero,9000);Check(policy.View(settings,now,15000).active&&policy.View(settings,now,15000).buttonsDown&&policy.View(settings,now,15000).resumeAt==null,"Held mouse button prevents resumption indefinitely");
  policy.Observe(0x204,500,500,0,UIntPtr.Zero,15001);policy.Observe(0x202,500,500,0,UIntPtr.Zero,15002);Check(policy.View(settings,now,20000).buttonsDown,"Other button remains held");
  policy.Observe(0x205,500,500,0,UIntPtr.Zero,20001);Check(policy.View(settings,now,23000).active&&!policy.View(settings,now,23001).active,"Release restarts full quiet period");
  policy.Observe(0x20b,500,500,2u<<16,UIntPtr.Zero,24000);Check(policy.View(settings,now,30000).buttonsDown,"X2 hold tracked");policy.Observe(0x20c,500,500,2u<<16,UIntPtr.Zero,30001);Check(!policy.View(settings,now,33001).active,"X2 released");
  policy.Observe(0x200,501,500,0,UIntPtr.Zero,34000);Check(policy.View(settings,now,33999).active,"Backward clock is fail closed");Check(!policy.View(new MousePauseSettings{enabled=false},now,34001).active,"Explicitly disabled pause is inactive");
  Check(policy.Revision==9,"Only meaningful non-own events change activity revision");
  policy.Observe(0x201,501,500,0,UIntPtr.Zero,35000);Check(policy.View(settings,now,40000).buttonsDown,"A held button exists before observer stop");policy.Reset();policy.InitializePosition(501,500);Check(!policy.View(settings,now,41000).active&&!policy.View(settings,now,41000).buttonsDown,"Restart after release while stopped cannot inherit an old held-button mask");
  policy.Observe(0x201,501,500,0,UIntPtr.Zero,42000);long revision=policy.Revision;policy.Restart();policy.InitializePosition(501,500);var restarted=policy.View(settings,now,43000);Check(!restarted.active&&!restarted.buttonsDown&&restarted.revision>revision,"Observer restart clears held state and advances, rather than reviving an old permission revision");
  Console.WriteLine("Mouse pause: "+checks+" checks passed; pure policy, no listener or inputs opened.");return 0;
 }
}
