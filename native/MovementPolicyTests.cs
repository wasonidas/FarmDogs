using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using WardogsSeeding;
class MovementPolicyTests {
 static int assertions;
 static void Check(bool value,string message) { assertions++;if(!value)throw new Exception(message); }
 static MovementPolicy Arm(DateTime now,double mono) { var p=new MovementPolicy();p.Arm(now,now,TimeSpan.FromMinutes(25),TimeSpan.FromSeconds(60),mono,null);return p; }
 sealed class FakeKeyboard {
  public readonly List<int> Keys=new List<int>();
  public double FinishedMono;
  TaskCompletionSource<bool> pending;
  public Task<bool> Hold(int key) { Check(pending==null,"No overlapping fake keyboard calls");Keys.Add(key);pending=new TaskCompletionSource<bool>();return pending.Task; }
  public void Release(double mono,bool full) { FinishedMono=mono;var task=pending;pending=null;task.SetResult(full); }
 }
 static MovementPolicy Resume(DateTime t,double mono,AutomaticCadence cadence) {
  var p=new MovementPolicy();p.Arm(t,t,TimeSpan.FromMinutes(25),TimeSpan.FromSeconds(5),mono,null);p.RestoreCadence(cadence.CompletedCount,cadence.NextDue(mono,5000));return p;
 }
 static async Task<bool> FakePulse(AutomaticCadence cadence,MovementPolicy plan,FakeKeyboard keyboard,double mono) {
  var attempt=cadence.Begin(mono,plan.IntervalMs,0x41,0x44);if(attempt==null)return false;
  bool completed=false,belongs=false;
  try { completed=await keyboard.Hold(attempt.Key); }
  finally { belongs=cadence.Finish(attempt,keyboard.FinishedMono,completed); }
  if(belongs&&completed&&plan.Armed)plan.Complete(keyboard.FinishedMono);return belongs;
 }
 static void AutomaticChecks(DateTime t) {
  var cadence=new AutomaticCadence();cadence.Select("one");var keyboard=new FakeKeyboard();var p=Resume(t,0,cadence);
  Check(p.Decide(t,0,true,true)=="pulse","Automatic first pulse due");var first=FakePulse(cadence,p,keyboard,0);keyboard.Release(500,true);Check(first.Result,"First automatic completion belongs to session");
  Check(keyboard.Keys.Count==1&&keyboard.Keys[0]==0x41,"Automatic begins A");Check(cadence.CompletedCount==1&&cadence.AttemptCount==1,"Full pulse counts once");
  p.Stop("OCR pause");cadence.Select("one");p=Resume(t.AddSeconds(2),2000,cadence);
  Check(p.Decide(t.AddSeconds(2),2000,true,true)=="waiting","Resume waits remaining interval");Check(p.Decide(t.AddMilliseconds(5499),5499,true,true)=="waiting","No early resume pulse");
  Check(p.Decide(t.AddMilliseconds(5500),5500,true,true)=="pulse","Pulse due from previous release");var second=FakePulse(cadence,p,keyboard,5500);keyboard.Release(6000,true);Check(second.Result,"Resumed completion accepted");
  Check(keyboard.Keys.Count==2&&keyboard.Keys[1]==0x44,"Resume alternates D");Check(cadence.CompletedCount==2&&p.Count==2,"Automatic and plan count preserve full completions");
  var third=FakePulse(cadence,p,keyboard,11000);p.Stop("Pause mid-hold");keyboard.Release(11200,false);Check(third.Result,"Canceled partial attempt records release");
  Check(cadence.CompletedCount==2&&cadence.AttemptCount==3,"Canceled partial does not inflate completed count");p=Resume(t.AddSeconds(12),12000,cadence);
  Check(p.Decide(t.AddSeconds(12),12000,true,true)=="waiting","Canceled partial also enforces interval");Check(p.Decide(t.AddMilliseconds(16199),16199,true,true)=="waiting","Canceled release exact remaining interval");
  Check(p.Decide(t.AddMilliseconds(16200),16200,true,true)=="pulse","Canceled release next due");var fourth=FakePulse(cadence,p,keyboard,16200);keyboard.Release(16700,true);Check(fourth.Result&&keyboard.Keys[3]==0x44,"Canceled A advances cursor to D");
  var old=FakePulse(cadence,p,keyboard,21700);cadence.Select("two");var newPlan=Resume(t.AddSeconds(22),22000,cadence);keyboard.Release(22200,true);Check(!old.Result,"Old async hold cannot complete into a new automatic session");
  Check(cadence.CompletedCount==0&&cadence.AttemptCount==0&&!cadence.LastFinishedMono.HasValue,"New session has no old counters or due time");
  Check(newPlan.Count==0&&newPlan.Decide(t.AddSeconds(22),22000,true,true)=="pulse","New automatic session starts immediately");var fresh=FakePulse(cadence,newPlan,keyboard,22000);keyboard.Release(22500,true);Check(fresh.Result&&keyboard.Keys[keyboard.Keys.Count-1]==0x41,"New session starts A");
  var token=cadence.Begin(27500,5000,0x41,0x44);Check(token!=null&&cadence.Begin(27500,5000,0x41,0x44)==null,"A pending attempt cannot be reserved twice");
  Check(cadence.Finish(token,28000,true)&&!cadence.Finish(token,28000,true),"Duplicate async completion ignored");
 }
 static int Main() {
  try {
   DateTime t=new DateTime(2026,10,30,8,0,0,DateTimeKind.Utc);var p=Arm(t,0);
   Check(p.Decide(t,0,false,true)=="waiting","No foreground input");
   Check(p.Decide(t,0,true,true)=="pulse","First pulse");p.Complete(500);
   Check(p.Decide(t.AddSeconds(59),59000,true,true)=="waiting","No early pulse");
   Check(p.Decide(t.AddSeconds(61),61000,true,true)=="pulse","Due pulse");p.Complete(61500);
   Check(p.Decide(t.AddMinutes(5),300000,true,true)=="pulse","Late single pulse");p.Complete(300500);
   Check(p.Decide(t.AddMinutes(5),300500,true,true)=="waiting","No catch-up burst");
   Check(p.Count==3,"Accurate completed count");
   Check(p.Decide(t.AddMinutes(6),360000,false,true)=="stopped"&&!p.Armed,"Focus loss stops");
   p=Arm(t,0);Check(p.Decide(t.AddMinutes(25),1500000,true,true)=="stopped","Exact end no pulse");
   p=Arm(t,0);Check(p.Decide(t,0,true,false)=="stopped","Closed game stops");
   p=Arm(t,0);p.Stop("manual");Check(p.Decide(t,0,true,true)=="stopped","Manual stop persists");
   p=new MovementPolicy();p.Arm(t,t.AddMinutes(5),TimeSpan.FromMinutes(10),TimeSpan.FromSeconds(60),0,null);
   Check(p.Decide(t,0,true,true)=="waiting","Scheduled waits");
   Check(p.Decide(t.AddMinutes(7),420000,true,true)=="stopped","Missed start rejected");
   p=new MovementPolicy();p.Arm(t,t,TimeSpan.FromHours(1),TimeSpan.FromSeconds(60),0,t.AddMinutes(3));
   Check(p.EndUtc==t.AddMinutes(3),"Hard stop caps duration");
   Check(p.Decide(t.AddMinutes(3),180000,true,true)=="stopped","Hard stop enforced");
   bool rejected=false;try { p.Arm(t,t,TimeSpan.FromHours(13),TimeSpan.FromSeconds(60),0,null); } catch(ArgumentException) { rejected=true; }
   Check(rejected,"Unbounded duration rejected");
   p=Arm(t,1000);Check(p.Decide(t,999,true,true)=="stopped","Monotonic rollback stops");
   p=Arm(t,0);Check(p.Decide(t.AddMinutes(-5),1500000,true,true)=="stopped","Elapsed deadline survives wall clock rollback");
   Check(PulseTiming.NextDelay(500,0)==20,"Bounded pulse poll");
   Check(PulseTiming.NextDelay(500,499)==1,"Last positive millisecond");
   Check(PulseTiming.NextDelay(500,500)==0,"Exact pulse end");
   Check(PulseTiming.NextDelay(500,501)==0,"No infinite -1 delay after foreground check");
   Check(PulseTiming.NextDelay(500,520)==0,"No negative delay after scheduler stall");
   Check(PulseTiming.NextDelay(500,long.MaxValue)==0,"Elapsed time cannot overflow into a delay");
   string limit="{\"format\":\"wardogs-movement-run-v1\",\"dayMadrid\":\"2026-10-30\",\"stopAtUtc\":\"2026-10-30T13:30:00Z\"}";
   DateTime deadline=new DateTime(2026,10,30,13,30,0,DateTimeKind.Utc);
   Check(RunDeadline.Parse(limit,t)==deadline,"Daily Madrid limit loaded");
   Check(RunDeadline.Parse(limit,deadline.AddHours(1))==deadline,"Expired same-day limit stays enforced");
   Check(!RunDeadline.Parse(limit,t.AddDays(1)).HasValue,"Daily limit does not block a later manual session");
   rejected=false;try { RunDeadline.Parse(limit.Replace("13:30:00Z","13:30:00+01:00"),t); } catch(ArgumentException) { rejected=true; }
   Check(rejected,"Ambiguous/non-UTC limit rejected");
   rejected=false;try { RunDeadline.Parse(limit.Replace("\"dayMadrid\":\"2026-10-30\"","\"dayMadrid\":\"2026-10-31\""),t); } catch(ArgumentException) { rejected=true; }
   Check(rejected,"Mismatched Madrid day rejected");
   AutomaticChecks(t);
   Console.WriteLine("Movement policy: "+assertions+" checks passed; no native input invoked.");return 0;
  } catch(Exception e) { Console.Error.WriteLine(e);return 1; }
 }
}
