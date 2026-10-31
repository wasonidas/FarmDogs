using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

internal static class DesktopClose
{
 // A failed network call or a browser/import task that never returns must not
 // keep the portable executable locked. Late continuations get no live client.
 internal static async Task RunAsync(Func<CancellationToken,Task> cleanup,Action cancelPending,Action finish,int milliseconds=7000)
 {
  using(var cancellation=new CancellationTokenSource())
  {
   Task work=null;
   try
   {
    work=cleanup(cancellation.Token)??Task.FromResult(0);
    var completed=await Task.WhenAny(work,Task.Delay(milliseconds));
    if(completed==work)try{await work;}catch{}
   }
   catch{}
   finally
   {
    try{cancellation.Cancel();}catch{}try{cancelPending();}catch{}
    if(work!=null&&!work.IsCompleted)ObserveFault(work);
    finish();
   }
  }
 }
 private static void ObserveFault(Task work){work.ContinueWith(task=>{var ignored=task.Exception;},TaskContinuationOptions.OnlyOnFaulted);}
 private static bool SameRoot(string left,string right){try{return !String.IsNullOrEmpty(left)&&Path.IsPathRooted(left)&&String.Equals(Path.GetFullPath(left).TrimEnd('\\','/'),Path.GetFullPath(right).TrimEnd('\\','/'),StringComparison.OrdinalIgnoreCase);}catch{return false;}}
 private static async Task PostCaptured(HttpClient client,string route,string token,object body,CancellationToken cancellation)
 {
  cancellation.ThrowIfCancellationRequested();
  using(var request=new HttpRequestMessage(HttpMethod.Post,DesktopProtocol.LocalBase+route))
  {
   request.Headers.Add("X-Session-Token",token);request.Content=new StringContent(DesktopProtocol.Json.Serialize(body),Encoding.UTF8,"application/json");
   using(var response=await client.SendAsync(request,cancellation)){cancellation.ThrowIfCancellationRequested();}
  }
 }
 private static async Task Quiet(Task task){try{await task;}catch{}}
 internal static async Task StopOwnServiceAsync(HttpClient client,string root,string version,string readerId,string rewardCommand,CancellationToken cancellation)
 {
  cancellation.ThrowIfCancellationRequested();Dictionary<string,object> state;
  using(var request=new HttpRequestMessage(HttpMethod.Get,DesktopProtocol.LocalBase+"/api/state"))
  using(var response=await client.SendAsync(request,cancellation))
  {
   if(!response.IsSuccessStatusCode)return;var text=await response.Content.ReadAsStringAsync();cancellation.ThrowIfCancellationRequested();state=DesktopProtocol.Object(DesktopProtocol.Json.DeserializeObject(text));
  }
  if(DesktopProtocol.Text(state,"appId")!="wardogs-seeding-local-v1"||!SameRoot(DesktopProtocol.Text(state,"installationRoot"),root)||String.IsNullOrEmpty(version)||DesktopProtocol.Text(state,"version")!=version)return;
  var token=DesktopProtocol.Text(state,"token");if(String.IsNullOrEmpty(token))return;cancellation.ThrowIfCancellationRequested();
  // Never renew this token. A replacement backend owns a different token, so a
  // delayed request from this closing host cannot stop the reopened app.
  var tasks=new List<Task>();Guid parsed;
  if(Guid.TryParseExact(readerId,"D",out parsed))
  {
   tasks.Add(Quiet(PostCaptured(client,"/api/account/disconnect",token,new{readerId=readerId},cancellation)));
   tasks.Add(Quiet(PostCaptured(client,"/api/rewards/disconnect",token,new{readerId=readerId},cancellation)));
   if(Guid.TryParseExact(rewardCommand,"D",out parsed))tasks.Add(Quiet(PostCaptured(client,"/api/rewards/result",token,new{readerId=readerId,commandId=rewardCommand,status="uncertain"},cancellation)));
  }
  tasks.Add(Quiet(PostCaptured(client,"/api/service/stop",token,new{},cancellation)));
  await Task.WhenAll(tasks);
 }
}
