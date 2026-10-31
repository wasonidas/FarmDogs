using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
internal static class DesktopCloseTests
{
 private const string Root="C:\\Fixture\\FarmDogs",Reader="11111111-1111-4111-8111-111111111111",Command="22222222-2222-4222-8222-222222222222";
 private static int checks;
 private static void Check(bool value,string message){checks++;if(!value)throw new Exception(message);}
 private sealed class FakeHttp:HttpMessageHandler
 {
  internal string RootValue=Root,App="wardogs-seeding-local-v1",Version="0.4.0",Token="captured-old-token";internal bool Offline,Replacement;internal int Gets;internal readonly List<string> Posts=new List<string>();internal TaskCompletionSource<HttpResponseMessage> Delayed;
  internal HttpResponseMessage State(){return new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(DesktopProtocol.Json.Serialize(new{appId=App,installationRoot=RootValue,version=Version,token=Token}))};}
  protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancellation)
  {
   Check(request.RequestUri.Host=="127.0.0.1"&&request.RequestUri.Port==24243,"Cleanup left local service");
   if(Offline)throw new HttpRequestException("offline fixture");
   if(request.Method==HttpMethod.Get){Gets++;Check(request.RequestUri.AbsolutePath=="/api/state","Wrong state route");return Delayed!=null?Delayed.Task:Task.FromResult(State());}
   Check(request.Method==HttpMethod.Post,"Unexpected method");Check(String.Join("",request.Headers.GetValues("X-Session-Token"))=="captured-old-token","Cleanup refreshed token");Posts.Add(request.RequestUri.AbsolutePath);Check(cancellation.CanBeCanceled,"Cleanup request lacks cancellation token");return Task.FromResult(new HttpResponseMessage(Replacement?HttpStatusCode.Forbidden:HttpStatusCode.OK){Content=new StringContent("{}")});
  }
 }
 private static async Task Run()
 {
  using(var handler=new FakeHttp())using(var client=new HttpClient(handler))using(var cancellation=new CancellationTokenSource())
  {
   await DesktopClose.StopOwnServiceAsync(client,Root,"0.4.0",Reader,Command,cancellation.Token);Check(handler.Gets==1,"Snapshot was refreshed");Check(handler.Posts.Count==4,"Missing parallel reader/reward/service cleanup");Check(handler.Posts.Contains("/api/service/stop"),"Service did not stop all native controls");Check(handler.Posts.Contains("/api/rewards/result"),"Pending reward not reported uncertain");
  }
  foreach(string mismatch in new[]{"root","app","version","token"})using(var handler=new FakeHttp())using(var client=new HttpClient(handler))using(var cancellation=new CancellationTokenSource())
  {if(mismatch=="root")handler.RootValue="C:\\Other\\FarmDogs";if(mismatch=="app")handler.App="another-app";if(mismatch=="version")handler.Version="0.3.0";if(mismatch=="token")handler.Token=null;await DesktopClose.StopOwnServiceAsync(client,Root,"0.4.0",Reader,Command,cancellation.Token);Check(handler.Gets==1&&handler.Posts.Count==0,"Foreign/incomplete state caused a mutation: "+mismatch);}
  using(var handler=new FakeHttp{Replacement=true})using(var client=new HttpClient(handler))using(var cancellation=new CancellationTokenSource())
  {await DesktopClose.StopOwnServiceAsync(client,Root,"0.4.0",Reader,Command,cancellation.Token);Check(handler.Gets==1,"Replacement token was fetched");Check(handler.Posts.Count==4,"Replacement scenario did not use only captured requests");}
  var hangingImport=new TaskCompletionSource<int>();bool cancelled=false,finished=false;var clock=Stopwatch.StartNew();
  await DesktopClose.RunAsync(token=>hangingImport.Task,()=>cancelled=true,()=>finished=true,80);Check(finished&&cancelled,"Hung import prevented final close");Check(clock.ElapsedMilliseconds<1000,"Hung import exceeded global close budget");hangingImport.SetResult(0);
  finished=false;cancelled=false;await DesktopClose.RunAsync(token=>{throw new HttpRequestException("offline fixture");},()=>{cancelled=true;throw new Exception("cancel failed");},()=>finished=true,80);Check(finished&&cancelled,"Offline/cancel error prevented finally");
  using(var handler=new FakeHttp{Offline=true})using(var client=new HttpClient(handler))
  {bool final=false;await DesktopClose.RunAsync(token=>DesktopClose.StopOwnServiceAsync(client,Root,"0.4.0",Reader,Command,token),()=>client.CancelPendingRequests(),()=>final=true,80);Check(final&&handler.Posts.Count==0,"Offline HTTP prevented final close");}
  using(var handler=new FakeHttp{Delayed=new TaskCompletionSource<HttpResponseMessage>()})using(var client=new HttpClient(handler))
  {
   Task cleanup=null;bool final=false;await DesktopClose.RunAsync(token=>cleanup=DesktopClose.StopOwnServiceAsync(client,Root,"0.4.0",Reader,Command,token),()=>client.CancelPendingRequests(),()=>final=true,80);Check(final&&handler.Gets==1&&handler.Posts.Count==0,"Delayed state prevented bounded close");handler.Delayed.SetResult(handler.State());try{await cleanup;}catch(OperationCanceledException){}Check(handler.Gets==1&&handler.Posts.Count==0,"Late state response reached a reopened backend");
  }
 }
 public static int Main(){try{Run().GetAwaiter().GetResult();Console.WriteLine(checks+" comprobaciones de cierre acotado; importación/red simuladas, sin UI ni procesos reales.");return 0;}catch(Exception error){Console.Error.WriteLine(error);return 1;}}
}
