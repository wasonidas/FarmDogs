using System;
using System.Collections.Generic;
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
 public static int Main(){try{
  var p=new DesktopEntryFocusPolicy();Check(!p.Arm(Nonce,1,Join,false,100,0),"Background click armed");Check(!p.Arm("bad",1,Join,true,100,0),"Bad nonce armed");Check(!p.Arm(Nonce,0,Join,true,100,0),"Bad server armed");
  p=Armed(false);Check(Tick(p)=="wait","Unbound activated");p.Bind("other",Session);Check(Tick(p,mono:300)=="wait","Wrong nonce bound");p.Bind(Nonce,Session);Check(Tick(p,mono:400)=="activate","Matching bound click did not activate");p.Result(false);Check(p.Status=="refused"&&!p.Pending,"Refusal remains armed");Check(Tick(p,mono:500)=="none","Refusal retried");
  p=Armed();Check(Tick(p,own:false,input:100,target:false)=="wait","Steam automatic transition cancelled");Check(Tick(p,mono:400,own:false,input:100)=="activate","No-input Steam transition lost permission");p.Result(true);Check(p.Status=="focused"&&!p.Pending,"Success remains armed");Check(Tick(p,mono:500)=="none","Success retried");
  p=Armed();Check(Tick(p,own:true,input:150,target:false)=="wait","Own input cancelled");Check(Tick(p,mono:400,own:false,input:151)=="cancelled","Human app change did not cancel");Check(Tick(p,mono:500)=="none","Human cancellation rearmed");
  p=Armed();Check(Tick(p,own:false,game:true,input:200)=="none"&&p.Status=="already_foreground","Already foreground reactivated");
  p=Armed();Check(Tick(p,stop:true)=="cancelled","F8 ignored");p=Armed();Check(Tick(p,local:false)=="cancelled","Navigation ignored");p=Armed();Check(Tick(p,mono:180000)=="cancelled","Deadline ignored");p=Armed();Tick(p,target:false);Check(Tick(p,mono:100)=="cancelled","Monotonic rollback ignored");
  foreach(string kind in new[]{"session","server","join","root","stop","status","old","future","end"}){p=Armed();var s=Sample();if(kind=="session")s.SessionId=Nonce;if(kind=="server")s.Server=2;if(kind=="join")s.JoinId=Nonce;if(kind=="root")s.Root="C:\\Other";if(kind=="stop")s.Stopped=true;if(kind=="status")s.Status="cancelled";if(kind=="old")s.At=now.AddSeconds(-2);if(kind=="future")s.At=now.AddMilliseconds(1);if(kind=="end")s.End=now;Check(Tick(p,s)=="cancelled","Invalid sample accepted: "+kind);}
  p=Armed();Check(p.Tick(200,100,true,false,false,true,null,false,now,Root,false)=="wait"&&p.Pending,"Context guard required session prematurely");Check(p.Tick(400,100,true,false,false,true,null,true,now,Root)=="cancelled","Missing final session accepted");
  p=Armed();var wrongMode=Sample();wrongMode.FocusMode="driver";Check(Tick(p,wrongMode)=="cancelled","Driver-owned session accepted");
  p=Armed();p.Cancel("manual");Check(Tick(p)=="none","Explicit cancel rearmed");Check(DesktopEntryFocusPolicy.SameRoot("c:/fixture/farmdogs/",Root),"Equivalent root failed");
  StopBridge();Console.WriteLine(checks+" comprobaciones de foco inicial por clic; sin ventanas, procesos, audio ni entradas.");return 0;
 }catch(Exception error){Console.Error.WriteLine(error);return 1;}}
}
