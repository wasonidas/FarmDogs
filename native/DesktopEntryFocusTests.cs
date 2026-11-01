using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
internal static class DesktopEntryFocusTests
{
 private static int checks;private const string Nonce="11111111-1111-4111-8111-111111111111",Session="22222222-2222-4222-8222-222222222222",Join="33333333-3333-4333-8333-333333333333",Root="C:\\Fixture\\FarmDogs";
 private static DateTime now=new DateTime(2026,10,31,16,0,0,DateTimeKind.Utc);
 private static void Check(bool value,string message){checks++;if(!value)throw new Exception(message);}
 private static DesktopEntryFocusPolicy Armed(bool bind=true){var p=new DesktopEntryFocusPolicy();Check(p.Arm(Nonce,1,Join,true,100,0),"Arm failed");if(bind)p.Bind(Nonce,Session);return p;}
 private static DesktopEntryFocusSample Sample(){return new DesktopEntryFocusSample{SessionId=Session,Root=Root,Status="waiting_game",JoinId=Join,FocusMode="desktop",Server=1,At=now,End=now.AddMinutes(2)};}
 private static string Tick(DesktopEntryFocusPolicy p,DesktopEntryFocusSample sample=null,double mono=200,uint input=100,bool own=true,bool game=false,bool stop=false,bool local=true,bool target=true){return p.Tick(mono,input,own,game,stop,local,sample??Sample(),target,now,Root);}
 private sealed class StopHttp:HttpMessageHandler
 {
  internal int Gets,Posts;internal string Expected;
  protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancel)
  {
   Check(request.RequestUri.Host=="127.0.0.1"&&request.RequestUri.Port==24243,"Stop request left local service");
   if(request.Method==HttpMethod.Get){Gets++;Check(request.RequestUri.AbsolutePath=="/api/state","Unexpected GET");return new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent("{\"token\":\"authorized-local-token\"}")};}
   Posts++;Check(request.Method==HttpMethod.Post&&request.RequestUri.AbsolutePath=="/api/entry/stop","Wrong stop route");Check(String.Join("",request.Headers.GetValues("X-Session-Token"))=="authorized-local-token","Missing state token");var body=DesktopProtocol.Object(DesktopProtocol.Json.DeserializeObject(await request.Content.ReadAsStringAsync()));Check(DesktopProtocol.Text(body,"expectedSessionId")==Expected,"Stop targeted another session");return new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent("{}")};
  }
 }
 private static void StopBridge()
 {
  using(var handler=new StopHttp())using(var client=new HttpClient(handler))
  {
   var stop=new DesktopEntryStop(async session=>{await DesktopProtocol.PostLocal(client,"/api/entry/stop",new{expectedSessionId=session});});
   stop.Arm(Nonce);stop.Request(Nonce).GetAwaiter().GetResult();Check(handler.Posts==0&&handler.Gets==0,"Pending F8 stopped an unknown session");stop.Bind("other",Session).GetAwaiter().GetResult();Check(handler.Posts==0,"Wrong nonce bound pending F8");
   handler.Expected=Session;stop.Bind(Nonce,Session).GetAwaiter().GetResult();Check(handler.Gets==1&&handler.Posts==1,"Pending F8 was lost before bind");stop.Request(Nonce).GetAwaiter().GetResult();Check(handler.Posts==1,"Repeated F8 duplicated stop");
   stop.Arm(Join);stop.Bind(Join,Nonce).GetAwaiter().GetResult();stop.Request(Session).GetAwaiter().GetResult();Check(handler.Posts==1,"An old key stopped a new session");handler.Expected=Nonce;stop.Request(Join).GetAwaiter().GetResult();Check(handler.Gets==2&&handler.Posts==2,"Bound F8 did not stop own session");
  }
 }
 private static DesktopEntryJobFocusPolicy Deferred(bool bind=true,string kind="scheduled")
 {var p=new DesktopEntryJobFocusPolicy();Check(p.Arm(Nonce,kind,kind=="scheduled"?1:0,kind=="scheduled"?Join:null,true,100,0),"Deferred arm failed");if(bind)p.Bind(Nonce,kind,Join);return p;}
 private static DesktopEntryJobSnapshot DeferredSample(string kind="scheduled")
 {var entry=Sample();entry.CreatedAt=now.AddSeconds(-1);return new DesktopEntryJobSnapshot {Root=Root,At=now,OriginKind=kind,OriginOwnerId=Join,OriginEntryId=Session,Job=new DesktopEntryJobSample {Id=Join,Status=kind=="scheduled"?"open_requested":"launching",FocusMode="desktop",Server=1,JoinId=Join},Entry=entry,InputAtStart=100,WatchStartedAt=now.AddMilliseconds(-500),TargetVerified=true};}
 private static string DeferredTick(DesktopEntryJobFocusPolicy policy,DesktopEntryJobSnapshot sample=null,double mono=200,uint input=100,bool game=false,bool target=true)
 {return policy.Tick(mono,input,game,true,sample??DeferredSample(),target,now,Root,now.AddSeconds(-2));}
 private static void DeferredPolicy()
 {
  var p=new DesktopEntryJobFocusPolicy();Check(!p.Arm(Nonce,"scheduled",1,Join,false,100,0),"Background scheduled click armed");Check(!p.Arm(Nonce,"other",1,Join,true,100,0),"Unknown job kind armed");Check(!p.Arm(Nonce,"scheduled",0,Join,true,100,0),"Bad scheduled target armed");Check(!p.Arm(Nonce,"activity",1,Join,true,100,0),"Activity adopted invented target");
  p=Deferred(false);Check(DeferredTick(p)=="wait","Unbound job activated");p.Bind(Nonce,"activity",Join);Check(DeferredTick(p,mono:250)=="wait","Wrong kind bound");p.Bind(Session,"scheduled",Join);Check(DeferredTick(p,mono:300)=="wait","Wrong nonce bound");p.Bind(Nonce,"scheduled",Join);Check(DeferredTick(p,mono:400)=="activate","Matching scheduled entry did not activate");p.Result(false);Check(p.Status=="refused"&&DeferredTick(p,mono:500)=="none","Refused deferred activation retried");
  p=Deferred();Check(DeferredTick(p,game:true)=="none"&&p.Status=="already_foreground","Already foreground scheduled game was reactivated");
  p=Deferred(kind:"activity");Check(DeferredTick(p,DeferredSample("activity"))=="activate","Activity entry did not bind its chosen official target");p.Result(true);Check(DeferredTick(p,DeferredSample("activity"),mono:400)=="none","Activity success rearmed");
  p=Deferred();var waiting=DeferredSample();waiting.At=now.AddHours(-1);waiting.Entry=null;waiting.OriginEntryId=null;waiting.Job.Status="scheduled";Check(p.Tick(1000,200,false,true,waiting,false,now.AddHours(-1),Root,now.AddHours(-1))=="wait","Input an hour before due revoked schedule");var due=DeferredSample();due.InputAtStart=200;Check(DeferredTick(p,due,mono:3601000,input:200)=="activate","Using PC before due invalidated later baseline");
  p=Deferred();var startup=DeferredSample();startup.InputAtStart=200;Check(p.Tick(200,200,false,true,startup,true,now,Root,now.AddMilliseconds(-500))=="wait"&&p.Pending,"Input during cold startup cancelled the pending chain");
  p=Deferred();var beforeDue=DeferredSample();beforeDue.InputAtStart=200;Check(p.Tick(200,200,false,true,beforeDue,true,now,Root,beforeDue.Entry.CreatedAt.AddMilliseconds(-1))=="activate","A late API response misdated input before the due time");
  p=Deferred();Check(p.Tick(200,100,false,true,DeferredSample(),true,now,Root,null)=="wait","Uncertain input timestamp authorized focus");
  Check(DesktopEntryFocus.InputDate(UInt32.MaxValue-5,5,now)==now.AddMilliseconds(-11),"Input age failed tick wrap");Check(!DesktopEntryFocus.InputDate(101,100,now).HasValue,"Future input stamp was accepted");Check(!DesktopEntryFocus.InputDate(0,0x80000000,now).HasValue,"Ambiguous half-wrap input age accepted");Check(!DesktopEntryFocus.InputDate(100,100,DateTime.SpecifyKind(now,DateTimeKind.Unspecified)).HasValue,"Unspecified clock accepted for input date");
  p=Deferred();Check(DeferredTick(p,input:101)=="wait"&&p.Pending,"New input during entry cancelled the pending chain");Check(DeferredTick(p,mono:400,input:101)=="wait","Other application input authorized focus theft");Check(p.Tick(600,101,false,true,DeferredSample(),true,now,Root,now.AddMilliseconds(-800),true)=="activate","Idle launcher did not resume deferred initial handoff");
  p=Deferred();Check(p.Tick(200,101,false,true,DeferredSample(),true,now,Root,now.AddMilliseconds(-100),true)=="wait","Launcher was minimized during an active drag");
  p=Deferred();Check(p.Tick(200,100,false,true,DeferredSample(),true,now,Root,now.AddSeconds(-2),true,true)=="wait"&&p.Pending,"Idle held drag minimized launcher during scheduled start");Check(p.Tick(400,100,false,true,DeferredSample(),true,now,Root,now.AddSeconds(-2),true,false)=="activate","Releasing held drag did not resume scheduled handoff");
  p=Deferred();Check(DeferredTick(p,target:false)=="wait","Missing target activated");Check(DeferredTick(p,mono:180000)=="expired","Initial entry focus outlived180s");
  p=Deferred(false);Check(DeferredTick(p,mono:30000)=="expired","Unconfirmed job click outlived bind limit");
  p=Deferred();DeferredTick(p,target:false);Check(DeferredTick(p,mono:100)=="revoked","Deferred monotonic rollback ignored");
  foreach(var kind in new[]{"root","snapshot_old","snapshot_future","job","driver","target","entryRoot","entry_server","entry_join","entry_stop","entry_end","entry_created","baseline","baseline_before_entry","baseline_future","origin","owner","origin_entry"})
  {p=Deferred();var s=DeferredSample();if(kind=="root")s.Root="C:\\Other";if(kind=="snapshot_old")s.At=now.AddSeconds(-2);if(kind=="snapshot_future")s.At=now.AddMilliseconds(1);if(kind=="job")s.Job.Id=Nonce;if(kind=="driver")s.Job.FocusMode="driver";if(kind=="target")s.TargetVerified=false;if(kind=="entryRoot")s.Entry.Root="C:\\Other";if(kind=="entry_server")s.Entry.Server=2;if(kind=="entry_join")s.Entry.JoinId=Nonce;if(kind=="entry_stop")s.Entry.Stopped=true;if(kind=="entry_end")s.Entry.End=now;if(kind=="entry_created")s.Entry.CreatedAt=now.AddMilliseconds(1);if(kind=="baseline")s.InputAtStart=null;if(kind=="baseline_before_entry")s.WatchStartedAt=s.Entry.CreatedAt.AddMilliseconds(-1);if(kind=="baseline_future")s.WatchStartedAt=now.AddMilliseconds(1);if(kind=="origin")s.OriginKind="manual";if(kind=="owner")s.OriginOwnerId=Nonce;if(kind=="origin_entry")s.OriginEntryId=Nonce;Check(DeferredTick(p,s)!="activate","Invalid deferred authority activated: "+kind);}
  p=Deferred();p.Stop(Nonce);p.Bind(Nonce,"scheduled",Join);Check(p.Status=="stopped"&&DeferredTick(p)=="none","F8 before bind was overwritten");
  p=Deferred();Check(DeferredTick(p)=="activate","Expected pending observation");p.Revoke("cancelled from UI");p.Result(true);Check(p.Status=="revoked","Late activation result overwrote UI cancellation");
  Check(DesktopEntryFocus.OwnedWindow(22,22,11,11),"Account owned window was rejected");Check(DesktopEntryFocus.OwnedWindow(12,11,11,11),"Own child rejected");Check(!DesktopEntryFocus.OwnedWindow(22,22,33,11),"Unrelated process/window accepted as own");Check(!DesktopEntryFocus.OwnedWindow(0,0,0,11),"Null foreground accepted");
 }
 private sealed class JobHttp:HttpMessageHandler
 {
  internal string Current=Join,StateRoot=Root,Expected=Join,Kind="scheduled",Mode="desktop";internal int Gets,Posts;internal bool FailOnce,Deferred=true;
  protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancel)
  {
   Check(request.RequestUri.Host=="127.0.0.1"&&request.RequestUri.Port==24243,"Job stop left local service");
   if(request.Method==HttpMethod.Get){Gets++;if(FailOnce){FailOnce=false;throw new HttpRequestException("Fixture temporarily unavailable");}return new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(DesktopProtocol.Json.Serialize(new{appId="wardogs-seeding-local-v1",installationRoot=StateRoot,token="captured-job-token",capabilities=new{deferredEntryFocus=Deferred},opening=new{id=Current,initialFocus=Mode},activity=new{id=Current,initialFocus=Mode}}))};}
   Posts++;Check(request.RequestUri.AbsolutePath==(Kind=="scheduled"?"/api/opening/cancel":"/api/activity/stop"),"Wrong job stop route");Check(String.Join("",request.Headers.GetValues("X-Session-Token"))=="captured-job-token","Job stop missed captured token");var body=DesktopProtocol.Object(DesktopProtocol.Json.DeserializeObject(await request.Content.ReadAsStringAsync()));Check(DesktopProtocol.Text(body,"expectedJobId")==Expected,"Late stop targeted replacement job");return new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent("{}")};
  }
 }
 private static void DeferredStopBridge()
 {
  var oldManualHttp=new TaskCompletionSource<int>();bool jobLatched=false;var both=DesktopEntryStopDispatch.Both(()=>oldManualHttp.Task,()=>{jobLatched=true;return Task.FromResult(0);});Check(jobLatched&&!both.IsCompleted,"An old manual HTTP call delayed the deferred F8 latch");oldManualHttp.SetResult(0);both.GetAwaiter().GetResult();
  using(var handler=new JobHttp())using(var client=new HttpClient(handler))
  {
   var stopping=new DesktopEntryJobStop(async(kind,id)=>{await DesktopProtocol.StopOwnJob(client,Root,kind,id);});stopping.Arm(Nonce,"scheduled");stopping.Request(Nonce).GetAwaiter().GetResult();Check(handler.Posts==0&&handler.Gets==0&&stopping.Pending,"F8 before bind was lost or guessed a job");stopping.Bind(Nonce,"activity",Join).GetAwaiter().GetResult();Check(handler.Posts==0,"Wrong job kind bound stop");stopping.Bind(Nonce,"scheduled",Join).GetAwaiter().GetResult();Check(handler.Posts==1&&!stopping.Pending,"Bind did not deliver pending F8");stopping.Request(Nonce).GetAwaiter().GetResult();stopping.Retry().GetAwaiter().GetResult();Check(handler.Posts==1,"Duplicate key/events duplicated HTTP stop");
   stopping.Arm(Session,"activity");handler.Kind="activity";handler.Current=Session;handler.Expected=Session;stopping.Bind(Session,"activity",Session).GetAwaiter().GetResult();stopping.Request(Session).GetAwaiter().GetResult();Check(handler.Posts==2,"Bound activity F8 failed");
   var late=new DesktopEntryJobStop(async(kind,id)=>{await DesktopProtocol.StopOwnJob(client,Root,kind,id);});late.Arm(Nonce,"scheduled");late.Request(Nonce).GetAwaiter().GetResult();late.Arm(Session,"activity");handler.Current=Join;handler.Expected=Join;handler.Kind="scheduled";late.Bind(Nonce,"scheduled",Join).GetAwaiter().GetResult();Check(handler.Posts==3,"New arm lost older pending stop");
   var replaced=new DesktopEntryJobStop(async(kind,id)=>{await DesktopProtocol.StopOwnJob(client,Root,kind,id);});replaced.Arm(Nonce,"scheduled");replaced.Request(Nonce).GetAwaiter().GetResult();handler.Current=Session;replaced.Bind(Nonce,"scheduled",Join).GetAwaiter().GetResult();Check(handler.Posts==3&&!replaced.Pending,"Replacement job received stale F8");
   var retry=new DesktopEntryJobStop(async(kind,id)=>{await DesktopProtocol.StopOwnJob(client,Root,kind,id);});retry.Arm(Nonce,"scheduled");retry.Bind(Nonce,"scheduled",Join).GetAwaiter().GetResult();handler.Current=Join;handler.FailOnce=true;bool failed=false;try{retry.Request(Nonce).GetAwaiter().GetResult();}catch(HttpRequestException){failed=true;}Check(failed&&retry.Pending,"Transient failure erased F8 latch");retry.Retry().GetAwaiter().GetResult();Check(handler.Posts==4&&!retry.Pending,"F8 was not retried for same owner");
   handler.StateRoot="C:\\Other";failed=false;try{DesktopProtocol.StopOwnJob(client,Root,"scheduled",Join).GetAwaiter().GetResult();}catch(InvalidOperationException){failed=true;}Check(failed&&handler.Posts==4,"Cross-installation stop sent HTTP mutation");
   handler.StateRoot=Root;handler.Deferred=false;failed=false;try{DesktopProtocol.StopOwnJob(client,Root,"scheduled",Join).GetAwaiter().GetResult();}catch(InvalidOperationException){failed=true;}Check(failed&&handler.Posts==4,"Legacy API received an unenforced owner guard");handler.Deferred=true;handler.Mode="driver";failed=false;try{DesktopProtocol.StopOwnJob(client,Root,"scheduled",Join).GetAwaiter().GetResult();}catch(InvalidOperationException){failed=true;}Check(failed&&handler.Posts==4,"Driver job received unrelated host stop");
  }
 }
 private static void WatchBaseline()
 {
  string root=Path.Combine(Path.GetTempPath(),"farmdogs-deferred-watch-"+Guid.NewGuid().ToString("N")),data=Path.Combine(root,"data");Directory.CreateDirectory(data);string file=Path.Combine(data,"entry-watch-"+Session+".json");
  try{
   File.WriteAllText(Path.Combine(data,"service.json"),DesktopProtocol.Json.Serialize(new{pid=1234,startedAt=now.AddMinutes(-1).ToString("o")}));
   Func<Dictionary<string,object>> watch=()=>new Dictionary<string,object>{{"format","farmdogs-entry-watch-v1"},{"sessionId",Session},{"servicePid",1234},{"status","watching"},{"at",now.ToString("o")},{"startedAt",now.AddMilliseconds(-500).ToString("o")},{"endAt",now.AddMinutes(2).ToString("o")},{"inputAtStart",4294967295L}};
   var sample=DeferredSample();sample.Root=root;sample.Entry.Root=root;File.WriteAllText(file,DesktopProtocol.Json.Serialize(watch()));DesktopEntryWatchBaseline.Apply(sample,root,now);Check(sample.InputAtStart==UInt32.MaxValue,"Real watcher JSON uint baseline not decoded");
   foreach(var key in new[]{"format","sessionId","servicePid","status","at","startedAt","endAt","inputAtStart"}){var bad=watch();if(key=="format")bad[key]="other";if(key=="sessionId")bad[key]=Nonce;if(key=="servicePid")bad[key]=999;if(key=="status")bad[key]="cancelled";if(key=="at")bad[key]=now.AddSeconds(-4).ToString("o");if(key=="startedAt")bad[key]=now.AddMinutes(-2).ToString("o");if(key=="endAt")bad[key]=now.ToString("o");if(key=="inputAtStart")bad[key]="100";File.WriteAllText(file,DesktopProtocol.Json.Serialize(bad));sample.InputAtStart=100;DesktopEntryWatchBaseline.Apply(sample,root,now);Check(!sample.InputAtStart.HasValue,"Invalid watcher retained input authority: "+key);}
   File.WriteAllText(file,DesktopProtocol.Json.Serialize(watch()));File.WriteAllText(file+".stop","");DesktopEntryWatchBaseline.Apply(sample,root,now);Check(!sample.InputAtStart.HasValue,"Stopped watcher authorized focus");File.Delete(file+".stop");File.WriteAllText(file,"{");DesktopEntryWatchBaseline.Apply(sample,root,now);Check(!sample.InputAtStart.HasValue,"Malformed watcher authorized focus");
  }finally{if(Path.GetDirectoryName(Path.GetFullPath(root))!=Path.GetTempPath().TrimEnd(Path.DirectorySeparatorChar)||!Path.GetFileName(root).StartsWith("farmdogs-deferred-watch-"))throw new Exception("Unsafe fixture cleanup");Directory.Delete(root,true);}
 }
 private static void ParseDeferredState()
 {
  var raw=DesktopProtocol.Object(DesktopProtocol.Json.DeserializeObject(DesktopProtocol.Json.Serialize(new{appId="wardogs-seeding-local-v1",installationRoot=Root,now=now.ToString("o"),capabilities=new{deferredEntryFocus=true},opening=new{id=Join,status="launching",initialFocus="desktop",server=1,joinId=Join},entryOrigin=new{kind="scheduled",ownerId=Join,entryId=Session},entry=new{id=Session,status="waiting_game",initialFocus="desktop",server=1,joinId=Join,createdAt=now.AddSeconds(-1).ToString("o"),endAt=now.AddMinutes(2).ToString("o"),operatorStopped=false},servers=new[]{new{number=1,joinId=Join,trusted=true,online=true}}})));
  var parsed=DesktopEntryFocus.ParseJobState(raw,"scheduled");Check(parsed.TargetVerified&&parsed.Job.Id==Join&&parsed.Entry.SessionId==Session&&parsed.OriginKind=="scheduled","Actual API JSON shape failed host contract");var rows=(object[])raw["servers"];var server=DesktopProtocol.Object(rows[0]);server["trusted"]=false;Check(!DesktopEntryFocus.ParseJobState(raw,"scheduled").TargetVerified,"Untrusted public target authorized host focus");server["trusted"]=true;server["online"]=false;Check(!DesktopEntryFocus.ParseJobState(raw,"scheduled").TargetVerified,"Offline target authorized host focus");server["online"]=true;server["joinId"]=Nonce;Check(!DesktopEntryFocus.ParseJobState(raw,"scheduled").TargetVerified,"Different official UUID authorized focus");raw.Remove("capabilities");Check(DesktopEntryFocus.ParseJobState(raw,"scheduled")==null,"Legacy API armed deferred focus");raw["appId"]="other";Check(DesktopEntryFocus.ParseJobState(raw,"scheduled")==null,"Wrong app identity parsed");
 }
 private static void Handoff()
 {
  int withdrawn=0,activated=0,waited=0;bool allowed=false,front=false;
  Func<bool> authority=()=>allowed;Action withdraw=()=>{withdrawn++;};Func<bool> activate=()=>{activated++;return true;};Func<bool> foreground=()=>front;
  Func<int,Task> delay=ms=>{waited+=ms;if(waited>=75)front=true;return Task.FromResult(0);};
  Check(!DesktopEntryHandoff.Run(authority,withdraw,activate,foreground,delay,()=>waited).GetAwaiter().GetResult()&&withdrawn==0&&activated==0,"Unverified entry withdrew launcher");
  allowed=true;
  Check(DesktopEntryHandoff.Run(authority,withdraw,activate,foreground,delay,()=>waited).GetAwaiter().GetResult()&&withdrawn==1&&activated==1&&waited==75,"Launcher did not yield before bounded initial focus");
  withdrawn=activated=waited=0;front=true;
  Check(DesktopEntryHandoff.Run(authority,withdraw,activate,foreground,delay,()=>waited).GetAwaiter().GetResult()&&withdrawn==1&&activated==0&&waited==0,"Already foreground did not withdraw launcher without reactivation");
  withdrawn=activated=waited=0;front=false;
  Check(!DesktopEntryHandoff.Run(authority,()=>{withdrawn++;allowed=false;},activate,foreground,delay,()=>waited).GetAwaiter().GetResult()&&withdrawn==1&&activated==0,"Revocation during withdrawal still activated game");
  allowed=true;withdrawn=activated=waited=0;
  Check(!DesktopEntryHandoff.Run(authority,withdraw,()=>{activated++;return false;},foreground,delay,()=>waited).GetAwaiter().GetResult()&&activated==1&&waited==0,"Windows refusal retried foreground activation");
  withdrawn=activated=waited=0;
  Check(!DesktopEntryHandoff.Run(authority,withdraw,activate,foreground,ms=>{waited+=ms;return Task.FromResult(0);},()=>waited).GetAwaiter().GetResult()&&activated==1&&waited==500,"Initial focus exceeded one activation or500ms");
  withdrawn=activated=waited=0;
  Check(!DesktopEntryHandoff.Run(authority,withdraw,activate,foreground,ms=>{waited+=ms;allowed=false;return Task.FromResult(0);},()=>waited).GetAwaiter().GetResult()&&activated==1&&waited==25,"User intervention during focus was ignored");
  allowed=true;withdrawn=activated=waited=0;front=false;
  Check(!DesktopEntryHandoff.Run(authority,withdraw,activate,foreground,ms=>{waited=2000;front=true;return Task.FromResult(0);},()=>waited).GetAwaiter().GetResult()&&activated==1,"Late continuation accepted foreground beyond real500ms budget");
  withdrawn=activated=waited=0;front=false;
  Check(!DesktopEntryHandoff.Run(authority,withdraw,activate,foreground,ms=>{waited=-1;return Task.FromResult(0);},()=>waited).GetAwaiter().GetResult()&&activated==1,"Clock rollback extended initial handoff");
  var p=Armed();Check(Tick(p)=="activate","Manual fixture did not activate");p.Cancel("F8");p.Result(true);Check(p.Status=="cancelled"&&Tick(p)=="none","Late manual focus result overwrote F8");
  p=Armed();Check(Tick(p,mono:179900)=="activate"&&p.HandoffActive(179999)&&!p.HandoffActive(180000),"Manual initial permission survived its monotonic deadline");
  var job=Deferred();Check(DeferredTick(job)=="activate"&&job.HandoffActive(120199)&&!job.HandoffActive(120200),"Deferred initial permission survived its monotonic deadline");
 }
 public static int Main(){try{
  var p=new DesktopEntryFocusPolicy();Check(!p.Arm(Nonce,1,Join,false,100,0),"Background click armed");Check(!p.Arm("bad",1,Join,true,100,0),"Bad nonce armed");Check(!p.Arm(Nonce,0,Join,true,100,0),"Bad server armed");
  p=Armed(false);Check(Tick(p)=="wait","Unbound activated");p.Bind("other",Session);Check(Tick(p,mono:300)=="wait","Wrong nonce bound");p.Bind(Nonce,Session);Check(Tick(p,mono:400)=="activate","Matching bound click did not activate");p.Result(false);Check(p.Status=="refused"&&!p.Pending,"Refusal remains armed");Check(Tick(p,mono:500)=="none","Refusal retried");
  p=Armed();Check(Tick(p,own:false,input:100,target:false)=="wait","Steam automatic transition cancelled");Check(Tick(p,mono:400,own:false,input:100)=="activate","No-input Steam transition lost permission");p.Result(true);Check(p.Status=="focused"&&!p.Pending,"Success remains armed");Check(Tick(p,mono:500)=="none","Success retried");
  p=Armed();Check(Tick(p,own:true,input:150,target:false)=="wait","Own input cancelled");Check(Tick(p,mono:400,own:false,input:151)=="wait"&&p.Pending,"Human app change cancelled the chain");Check(Tick(p,mono:500,own:true,input:151)=="activate","Returning to launcher did not resume pending initial handoff");
  p=Armed();Check(p.Tick(200,100,true,false,false,true,Sample(),true,now,Root,true,true)=="wait"&&p.Pending,"Launcher drag triggered minimization");Check(Tick(p,mono:400)=="activate","Release of launcher drag did not resume handoff");
  p=Armed();Check(Tick(p,own:false,game:true,input:200)=="none"&&p.Status=="already_foreground","Already foreground reactivated");
  p=Armed();Check(Tick(p,stop:true)=="cancelled","F8 ignored");p=Armed();Check(Tick(p,local:false)=="cancelled","Navigation ignored");p=Armed();Check(Tick(p,mono:180000)=="cancelled","Deadline ignored");p=Armed();Tick(p,target:false);Check(Tick(p,mono:100)=="cancelled","Monotonic rollback ignored");
  foreach(string kind in new[]{"session","server","join","root","stop","status","old","future","end"}){p=Armed();var s=Sample();if(kind=="session")s.SessionId=Nonce;if(kind=="server")s.Server=2;if(kind=="join")s.JoinId=Nonce;if(kind=="root")s.Root="C:\\Other";if(kind=="stop")s.Stopped=true;if(kind=="status")s.Status="cancelled";if(kind=="old")s.At=now.AddSeconds(-2);if(kind=="future")s.At=now.AddMilliseconds(1);if(kind=="end")s.End=now;Check(Tick(p,s)=="cancelled","Invalid sample accepted: "+kind);}
  p=Armed();Check(p.Tick(200,100,true,false,false,true,null,false,now,Root,false)=="wait"&&p.Pending,"Context guard required session prematurely");Check(p.Tick(400,100,true,false,false,true,null,true,now,Root)=="cancelled","Missing final session accepted");
  p=Armed();var wrongMode=Sample();wrongMode.FocusMode="driver";Check(Tick(p,wrongMode)=="cancelled","Driver-owned session accepted");
  p=Armed();p.Cancel("manual");Check(Tick(p)=="none","Explicit cancel rearmed");Check(DesktopEntryFocusPolicy.SameRoot("c:/fixture/farmdogs/",Root),"Equivalent root failed");
  StopBridge();DeferredPolicy();DeferredStopBridge();WatchBaseline();ParseDeferredState();Handoff();Console.WriteLine(checks+" comprobaciones de foco inicial y tareas diferidas; sin ventanas, procesos, audio ni entradas.");return 0;
 }catch(Exception error){Console.Error.WriteLine(error);return 1;}}
}
