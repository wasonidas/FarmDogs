using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;

internal sealed class DesktopEntryFocusSample
{
 internal string SessionId,Root,Status,JoinId,FocusMode;internal int Server;internal DateTime At,End,CreatedAt;internal bool Stopped;
}
internal sealed class DesktopEntryJobSample
{
 internal string Id,Status,FocusMode,JoinId;internal int Server;
}
internal sealed class DesktopEntryJobSnapshot
{
 internal string Root,OriginKind,OriginOwnerId,OriginEntryId;internal DateTime At,WatchStartedAt;
 internal DesktopEntryJobSample Job;internal DesktopEntryFocusSample Entry;internal uint? InputAtStart;internal bool TargetVerified;
}
internal static class DesktopEntryStopDispatch
{
 internal static Task Both(Func<Task> manual,Func<Task> job){var first=manual();var second=job();return Task.WhenAll(first,second);}
}
// Each nonce retains its own pending stop even if a newer job becomes visible.
// The backend compares expectedJobId, so late delivery cannot stop a new job.
internal sealed class DesktopEntryJobStop
{
 private sealed class Ticket {internal string Kind,Owner;internal bool Requested,Delivered,Busy;}
 private readonly Dictionary<string,Ticket> tickets=new Dictionary<string,Ticket>();
 private readonly Func<string,string,Task> send;
 internal DesktopEntryJobStop(Func<string,string,Task> send){this.send=send;}
 internal bool Pending {get{foreach(var item in tickets.Values)if(item.Requested&&!item.Delivered)return true;return false;}}
 internal void Arm(string nonce,string kind){if(!tickets.ContainsKey(nonce))tickets.Add(nonce,new Ticket {Kind=kind});}
 internal async Task Bind(string nonce,string kind,string owner){Ticket item;Guid parsed;if(!tickets.TryGetValue(nonce,out item)||item.Kind!=kind||!Guid.TryParseExact(owner,"D",out parsed)||item.Owner!=null&&item.Owner!=owner)return;item.Owner=owner;await Deliver(item);}
 internal async Task Request(string nonce){Ticket item;if(nonce==null||!tickets.TryGetValue(nonce,out item))return;item.Requested=true;await Deliver(item);}
 private async Task Deliver(Ticket item){if(!item.Requested||item.Delivered||item.Busy||item.Owner==null)return;item.Busy=true;try{await send(item.Kind,item.Owner);item.Delivered=true;}finally{item.Busy=false;}}
 internal async Task Retry(){foreach(var item in new List<Ticket>(tickets.Values))if(item.Requested&&!item.Delivered)await Deliver(item);}
}
internal sealed class DesktopEntryJobFocusPolicy
{
 internal string Nonce,Kind,OwnerId,SessionId,Status="idle",Reason="";internal int Server;internal string JoinId;
 private double lastMono,bindDeadline,entryDeadline;
 internal bool Pending {get{return Status=="armed"||Status=="waiting_job"||Status=="waiting_game";}}
 internal bool Arm(string nonce,string kind,int server,string joinId,bool ownForeground,uint input,double mono)
 {
  Guid parsed;if(!ownForeground||!Guid.TryParseExact(nonce,"D",out parsed)||(kind!="scheduled"&&kind!="activity")||Double.IsNaN(mono)||Double.IsInfinity(mono))return false;
  if(kind=="scheduled"&&(server<1||server>5||!Guid.TryParseExact(joinId,"D",out parsed)))return false;
  if(kind=="activity"&&(server!=0||joinId!=null))return false;
  Nonce=nonce;Kind=kind;OwnerId=null;SessionId=null;Server=server;JoinId=joinId;Status="armed";Reason="Esperando la tarea autorizada desde tu clic.";lastMono=mono;bindDeadline=mono+30000;entryDeadline=0;return true;
 }
 internal void Bind(string nonce,string kind,string owner){Guid parsed;if(nonce!=Nonce||kind!=Kind||!Guid.TryParseExact(owner,"D",out parsed)||OwnerId!=null&&OwnerId!=owner)return;OwnerId=owner;if(Pending){Status="waiting_job";Reason="Permiso preparado; puedes usar el PC hasta que se inicie la tarea.";}}
 internal void Revoke(string reason){if(Pending||Status=="attempted"){Status="revoked";Reason=reason;}}
 internal void Stop(string nonce){if(nonce==Nonce){Status="stopped";Reason="Detenido con F8. La parada se confirma para esta tarea.";}}
 internal string Tick(double mono,uint input,bool gameForeground,bool localPage,DesktopEntryJobSnapshot sample,bool targetAvailable,DateTime now,string expectedRoot,DateTime? inputOccurredAt=null)
 {
  if(!Pending)return "none";
  if(Double.IsNaN(mono)||Double.IsInfinity(mono)||mono<lastMono){Revoke("El reloj no permite verificar el permiso inicial.");return "revoked";}lastMono=mono;
  if(!localPage){Revoke("Se ha cerrado la vista local de FarmDogs.");return "revoked";}
  if(OwnerId==null){if(mono>=bindDeadline){Status="expired";Reason="No se confirmó la tarea iniciada por tu clic.";return "expired";}return "wait";}
  if(SessionId!=null&&mono>=entryDeadline){Status="expired";Reason="Terminó el permiso inicial de primer plano.";return "expired";}
  if(sample==null)return "wait";
  if(!DesktopEntryFocusPolicy.SameRoot(sample.Root,expectedRoot)||sample.At>now||(now-sample.At).TotalMilliseconds>1500){Revoke("La tarea ya no tiene una lectura local vigente.");return "revoked";}
  var job=sample.Job;if(job==null||job.Id!=OwnerId||job.FocusMode!="desktop"){Revoke("La tarea autorizada ha cambiado.");return "revoked";}
  if(job.Status=="cancelled"||job.Status=="error"||job.Status=="expired"||job.Status=="interrupted"||job.Status=="missed"||job.Status=="blocked"||job.Status=="uncertain"){Revoke("La tarea autorizada ha terminado o se ha detenido.");return "revoked";}
  var entry=sample.Entry;bool bound=entry!=null&&sample.OriginKind==Kind&&sample.OriginOwnerId==OwnerId&&sample.OriginEntryId==entry.SessionId;
  if(!bound){if(SessionId!=null){Revoke("La entrada pertenece ahora a otra tarea.");return "revoked";}return "wait";}
  Guid parsed;if(!Guid.TryParseExact(entry.SessionId,"D",out parsed)||!DesktopEntryFocusPolicy.SameRoot(entry.Root,expectedRoot)||entry.FocusMode!="desktop"||entry.Server<1||entry.Server>5||!Guid.TryParseExact(entry.JoinId,"D",out parsed)||entry.Stopped||entry.End<=now||entry.CreatedAt==DateTime.MinValue||entry.CreatedAt>now){Revoke("La entrada ya no autoriza un foco inicial.");return "revoked";}
  if(Kind=="scheduled"&&(entry.Server!=Server||!String.Equals(entry.JoinId,JoinId,StringComparison.OrdinalIgnoreCase))||job.Server!=entry.Server||!String.Equals(job.JoinId,entry.JoinId,StringComparison.OrdinalIgnoreCase)){Revoke("El destino de la tarea ha cambiado.");return "revoked";}
  if(SessionId==null){SessionId=entry.SessionId;double remaining=Math.Min(180000-(now-entry.CreatedAt).TotalMilliseconds,(entry.End-now).TotalMilliseconds);entryDeadline=mono+remaining;}
  if(SessionId!=entry.SessionId){Revoke("La tarea ha sustituido su entrada inicial.");return "revoked";}
  if(mono>=entryDeadline){Status="expired";Reason="Terminó el permiso inicial de primer plano.";return "expired";}
  if(entry.Status!="opening"&&entry.Status!="waiting_game"){Revoke("La entrada ya ha avanzado; no se volverá a activar la ventana.");return "revoked";}
  if(gameForeground){Status="already_foreground";Reason="Wardogs ya está delante.";return "none";}
  if(!inputOccurredAt.HasValue||inputOccurredAt.Value>now)return "wait";
  if(inputOccurredAt.Value>=entry.CreatedAt){Revoke("Has usado el PC durante el arranque; vuelve a Wardogs cuando quieras.");return "revoked";}
  if(!sample.InputAtStart.HasValue||sample.WatchStartedAt<entry.CreatedAt||sample.WatchStartedAt>now)return "wait";
  if(input!=sample.InputAtStart.Value){Revoke("Has cambiado de aplicación durante el arranque; vuelve a Wardogs cuando quieras.");return "revoked";}
  if(!sample.TargetVerified||!targetAvailable)return "wait";
  Status="attempted";Reason="Intento único de activar Wardogs para esta tarea.";return "activate";
 }
 internal void Result(bool success){if(Status=="attempted"){Status=success?"focused":"refused";Reason=success?"Wardogs está delante.":"Windows no permitió activar Wardogs; ponlo delante manualmente.";}}
}
internal static class DesktopEntryWatchBaseline
{
 private static Dictionary<string,object> Read(string file,int limit){var info=new FileInfo(file);if(!info.Exists||info.Length>limit||(info.Attributes&FileAttributes.ReparsePoint)!=0)return null;using(var stream=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)){if(stream.Length>limit)return null;using(var reader=new StreamReader(stream))return DesktopProtocol.Object(DesktopProtocol.Json.DeserializeObject(reader.ReadToEnd()));}}
 internal static void Apply(DesktopEntryJobSnapshot sample,string root,DateTime now)
 {
  sample.InputAtStart=null;sample.WatchStartedAt=DateTime.MinValue;
  try{
   var entry=sample.Entry;Guid id;if(entry==null||!Guid.TryParseExact(entry.SessionId,"D",out id)||!DesktopEntryFocusPolicy.SameRoot(root,sample.Root))return;
   string data=Path.Combine(root,"data");if((File.GetAttributes(data)&FileAttributes.ReparsePoint)!=0)return;
   string watchFile=Path.Combine(data,"entry-watch-"+entry.SessionId+".json");if(File.Exists(watchFile+".stop"))return;
   var service=Read(Path.Combine(data,"service.json"),8192);var watch=Read(watchFile,16384);object pid,watchPid,input;
   if(service==null||watch==null||!service.TryGetValue("pid",out pid)||!(pid is int)||(int)pid<=0||!watch.TryGetValue("servicePid",out watchPid)||!(watchPid is int)||(int)pid!=(int)watchPid||DesktopProtocol.Text(watch,"format")!="farmdogs-entry-watch-v1"||DesktopProtocol.Text(watch,"sessionId")!=entry.SessionId||DesktopProtocol.Text(watch,"status")!="watching")return;
   DateTime at=DesktopEntryFocus.Utc(DesktopProtocol.Text(watch,"at")),started=DesktopEntryFocus.Utc(DesktopProtocol.Text(watch,"startedAt")),serviceStart=DesktopEntryFocus.Utc(DesktopProtocol.Text(service,"startedAt")),end=DesktopEntryFocus.Utc(DesktopProtocol.Text(watch,"endAt"));
   if(at>now||(now-at).TotalMilliseconds>3000||started<entry.CreatedAt||started>at||serviceStart==DateTime.MinValue||serviceStart>started||end!=entry.End||end<=now||!watch.TryGetValue("inputAtStart",out input)||!(input is int||input is long))return;
   long value=Convert.ToInt64(input,CultureInfo.InvariantCulture);if(value<0||value>UInt32.MaxValue)return;sample.InputAtStart=(uint)value;sample.WatchStartedAt=started;
  }catch{}
 }
}
// Stops are scoped to the UUID returned for the same explicit click. A key can
// arrive while /start is still pending: binding later must deliver that stop.
internal sealed class DesktopEntryStop
{
 private readonly Func<string,Task> stop;private string nonce,session;private bool requested,sent;
 internal DesktopEntryStop(Func<string,Task> stop){this.stop=stop;}
 internal void Arm(string value){nonce=value;session=null;requested=false;sent=false;}
 internal Task Bind(string value,string id){Guid parsed;if(value!=nonce||!Guid.TryParseExact(id,"D",out parsed))return Task.FromResult(0);session=id;return Deliver();}
 internal Task Request(string value){if(value==null||value!=nonce)return Task.FromResult(0);requested=true;return Deliver();}
 private Task Deliver(){if(!requested||sent||session==null)return Task.FromResult(0);sent=true;return stop(session);}
}
// One explicit click permits at most one normal Windows activation. This policy
// never constructs a window or invokes user32, so cancellation is tested alone.
internal sealed class DesktopEntryFocusPolicy
{
 internal string Nonce,SessionId,Status="idle",Reason="";internal int Server;internal string JoinId;
 private double deadline,lastMono;private uint lastOwnInput;private bool bound;
 internal bool Pending {get{return Status=="armed"||Status=="waiting_game";}}
 internal bool Arm(string nonce,int server,string joinId,bool ownForeground,uint input,double mono)
 {
  Guid parsed;if(!ownForeground||!Guid.TryParseExact(nonce,"D",out parsed)||!Guid.TryParseExact(joinId,"D",out parsed)||server<1||server>5||Double.IsNaN(mono)||Double.IsInfinity(mono))return false;
  Nonce=nonce;Server=server;JoinId=joinId;SessionId=null;bound=false;lastOwnInput=input;lastMono=mono;deadline=mono+180000;Status="armed";Reason="Esperando la sesión iniciada por tu clic.";return true;
 }
 internal void Bind(string nonce,string session){Guid parsed;if(!Pending||nonce!=Nonce||!Guid.TryParseExact(session,"D",out parsed))return;SessionId=session;bound=true;Status="waiting_game";}
 internal void Cancel(string reason){if(!Pending)return;Status="cancelled";Reason=reason;}
 internal string Tick(double mono,uint input,bool ownForeground,bool gameForeground,bool stop,bool localPage,DesktopEntryFocusSample sample,bool targetAvailable,DateTime now,string expectedRoot,bool checkSession=true)
 {
  if(!Pending)return "none";
  if(Double.IsNaN(mono)||Double.IsInfinity(mono)||mono<lastMono||mono>=deadline){Cancel("Terminó el permiso inicial de primer plano.");return "cancelled";}lastMono=mono;
  if(stop||!localPage){Cancel("Permiso inicial cancelado.");return "cancelled";}
  // Steam may open itself without human input. A changed input timestamp while
  // another app is foreground means the user chose that app: never take it back.
  if(!ownForeground&&!gameForeground&&input!=lastOwnInput){Cancel("Has cambiado de aplicación; vuelve a Wardogs cuando quieras.");return "cancelled";}
  if(ownForeground)lastOwnInput=input;
  if(!bound||!checkSession)return "wait";
  if(sample==null||sample.FocusMode!="desktop"||sample.SessionId!=SessionId||sample.Server!=Server||!String.Equals(sample.JoinId,JoinId,StringComparison.OrdinalIgnoreCase)||!SameRoot(sample.Root,expectedRoot)||sample.Stopped||sample.End<=now||sample.At>now||(now-sample.At).TotalMilliseconds>1500||!(sample.Status=="opening"||sample.Status=="waiting_game"))
  {Cancel("La sesión ya no autoriza el foco inicial.");return "cancelled";}
  if(gameForeground){Status="already_foreground";Reason="Wardogs ya está delante.";return "none";}
  if(!targetAvailable)return "wait";
  Status="attempted";Reason="Intento único de activar Wardogs desde tu clic.";return "activate";
 }
 internal void Result(bool success){if(Status=="attempted"){Status=success?"focused":"refused";Reason=success?"Wardogs está delante.":"Windows no permitió activar Wardogs; ponlo delante manualmente.";}}
 internal static bool SameRoot(string left,string right){try{return !String.IsNullOrEmpty(left)&&System.IO.Path.IsPathRooted(left)&&String.Equals(System.IO.Path.GetFullPath(left).TrimEnd('\\','/'),System.IO.Path.GetFullPath(right).TrimEnd('\\','/'),StringComparison.OrdinalIgnoreCase);}catch{return false;}}
}
internal sealed class DesktopEntryFocus : IDisposable
{
 [StructLayout(LayoutKind.Sequential)]private struct LASTINPUTINFO{public uint cbSize,dwTime;}
 [StructLayout(LayoutKind.Sequential)]private struct RECT{public int Left,Top,Right,Bottom;}
 private delegate bool EnumCallback(IntPtr window,IntPtr ignored);
 [DllImport("user32.dll")]private static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]private static extern IntPtr GetAncestor(IntPtr window,uint flags);
 [DllImport("user32.dll")]private static extern bool GetLastInputInfo(ref LASTINPUTINFO value);
 [DllImport("kernel32.dll")]private static extern uint GetTickCount();
 [DllImport("user32.dll")]private static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 [DllImport("user32.dll")]private static extern bool EnumWindows(EnumCallback callback,IntPtr ignored);
 [DllImport("user32.dll")]private static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll")]private static extern bool IsIconic(IntPtr window);
 [DllImport("user32.dll")]private static extern bool GetClientRect(IntPtr window,out RECT bounds);
 [DllImport("user32.dll")]private static extern bool SetForegroundWindow(IntPtr window);
 private readonly DesktopEntryFocusPolicy policy=new DesktopEntryFocusPolicy();
 private readonly DesktopEntryStop stopping;
 private readonly DesktopEntryJobFocusPolicy jobPolicy=new DesktopEntryJobFocusPolicy();
 private readonly DesktopEntryJobStop jobStopping;
 private readonly Form owner;private readonly string root;private readonly Func<bool> localPage;private readonly Action<object> publish;
 private readonly HttpClient client=new HttpClient(new HttpClientHandler{UseProxy=false,UseCookies=false,AllowAutoRedirect=false}){Timeout=TimeSpan.FromSeconds(2),MaxResponseContentBufferSize=524288};
 private readonly JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=524288};
 private readonly Timer timer=new Timer{Interval=200};private readonly Stopwatch clock=Stopwatch.StartNew();
 private bool busy,disposed;
 internal DesktopEntryFocus(Form owner,string root,Func<bool> localPage,Action<object> publish){this.owner=owner;this.root=root;this.localPage=localPage;this.publish=publish;stopping=new DesktopEntryStop(async session=>{await DesktopProtocol.PostLocal(client,"/api/entry/stop",new{expectedSessionId=session});});jobStopping=new DesktopEntryJobStop(async(kind,id)=>{await DesktopProtocol.StopOwnJob(client,root,kind,id);});timer.Tick+=async(s,e)=>await Pulse();timer.Start();}
 private static bool Input(out uint value){var last=new LASTINPUTINFO{cbSize=(uint)Marshal.SizeOf(typeof(LASTINPUTINFO))};bool ok=GetLastInputInfo(ref last);value=last.dwTime;return ok;}
 internal static DateTime? InputDate(uint input,uint currentTick,DateTime utcNow){uint age=unchecked(currentTick-input);if(utcNow.Kind!=DateTimeKind.Utc||age>Int32.MaxValue)return null;return utcNow.AddMilliseconds(-age);}
 private static bool InputWithDate(out uint value,out DateTime? at){if(!Input(out value)){at=null;return false;}uint tick=GetTickCount();at=InputDate(value,tick,DateTime.UtcNow);return true;}
 internal static bool OwnedWindow(long foreground,long ancestor,long rootOwner,long own){return own>0&&foreground>0&&(foreground==own||ancestor==own||rootOwner==own);}
 private bool Own(IntPtr foreground){return OwnedWindow(foreground.ToInt64(),GetAncestor(foreground,2).ToInt64(),GetAncestor(foreground,3).ToInt64(),owner.Handle.ToInt64());}
 private static bool Game(IntPtr window){try{uint pid;if(window==IntPtr.Zero||GetWindowThreadProcessId(window,out pid)==0||pid==0)return false;using(var p=Process.GetProcessById((int)pid))return !p.HasExited&&p.ProcessName=="WardogsClient-Win64-Shipping";}catch{return false;}}
 private static IntPtr Target(){IntPtr result=IntPtr.Zero;bool ambiguous=false;if(!EnumWindows((window,ignored)=>{RECT bounds;if(IsWindowVisible(window)&&!IsIconic(window)&&Game(window)&&GetClientRect(window,out bounds)&&bounds.Right-bounds.Left>=320&&bounds.Bottom-bounds.Top>=200){if(result!=IntPtr.Zero&&result!=window)ambiguous=true;result=window;}return true;},IntPtr.Zero)||ambiguous)return IntPtr.Zero;return result;}
 internal bool Arm(string nonce,int server,string joinId){uint input;if(disposed||!localPage()||!Input(out input)||!policy.Arm(nonce,server,joinId,Own(GetForegroundWindow()),input,clock.Elapsed.TotalMilliseconds))return false;stopping.Arm(nonce);Publish();return true;}
 internal string ManualNonce {get{return policy.Nonce;}}
 internal string JobNonce {get{return jobPolicy.Nonce;}}
 internal bool ArmJob(string nonce,string kind,int server,string joinId){uint input;if(disposed||!localPage()||!Input(out input)||!jobPolicy.Arm(nonce,kind,server,joinId,Own(GetForegroundWindow()),input,clock.Elapsed.TotalMilliseconds))return false;jobStopping.Arm(nonce,kind);PublishJob();return true;}
 internal async Task BindJob(string nonce,string kind,string ownerId){if(disposed)return;jobPolicy.Bind(nonce,kind,ownerId);try{await jobStopping.Bind(nonce,kind,ownerId);}catch{if(nonce==jobPolicy.Nonce&&jobPolicy.Status=="stopped")jobPolicy.Reason="F8 recibido. Esperando confirmar la parada de esta tarea.";}PublishJob();}
 internal async Task StopJobFromKey(string nonce){if(disposed||nonce==null)return;jobPolicy.Stop(nonce);try{await jobStopping.Request(nonce);}catch{if(nonce==jobPolicy.Nonce)jobPolicy.Reason="F8 recibido. Esperando confirmar la parada de esta tarea.";}PublishJob();}
 internal void CancelJob(string nonce){if(nonce==null||nonce==jobPolicy.Nonce){jobPolicy.Revoke("Permiso de primer plano cancelado desde la app.");PublishJob();}}
 internal async Task Bind(string nonce,string session){policy.Bind(nonce,session);try{await stopping.Bind(nonce,session);}catch{policy.Cancel("No se pudo confirmar la parada; usa Detener.");}Publish();}
 internal async Task StopFromKey(string nonce=null){if(disposed||(nonce!=null&&nonce!=policy.Nonce))return;policy.Cancel("Detenido con F8.");try{await stopping.Request(policy.Nonce);}catch{policy.Cancel("No se pudo confirmar la parada; usa Detener.");}Publish();}
 internal void Cancel(string nonce){if(nonce==null||nonce==policy.Nonce){policy.Cancel("Inicio cancelado desde la app.");Publish();}}
 internal void Ready(){try{publish(new{kind="host_entry_focus_support",supported=true,deferred=true});}catch{}}
 internal static DateTime Utc(string value){DateTime result;return value!=null&&value.EndsWith("Z",StringComparison.Ordinal)&&DateTime.TryParse(value,CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind,out result)&&result.Kind==DateTimeKind.Utc?result:DateTime.MinValue;}
 private async Task<Dictionary<string,object>> ReadState(){using(var response=await client.GetAsync(DesktopProtocol.LocalBase+"/api/state")){if(!response.IsSuccessStatusCode)return null;var state=DesktopProtocol.Object(json.DeserializeObject(await response.Content.ReadAsStringAsync()));return DesktopProtocol.Text(state,"appId")=="wardogs-seeding-local-v1"?state:null;}}
 private static int Integer(Dictionary<string,object> value,string key){object result;return value!=null&&value.TryGetValue(key,out result)&&result is int?(int)result:0;}
 private static bool Boolean(Dictionary<string,object> value,string key){object result;return value!=null&&value.TryGetValue(key,out result)&&result is bool&&(bool)result;}
 private static Dictionary<string,object> Child(Dictionary<string,object> value,string key){object result;return value!=null&&value.TryGetValue(key,out result)?DesktopProtocol.Object(result):null;}
 private static DesktopEntryFocusSample Entry(Dictionary<string,object> state){var entry=Child(state,"entry");return entry==null?null:new DesktopEntryFocusSample {SessionId=DesktopProtocol.Text(entry,"id"),Root=DesktopProtocol.Text(state,"installationRoot"),Status=DesktopProtocol.Text(entry,"status"),JoinId=DesktopProtocol.Text(entry,"joinId"),FocusMode=DesktopProtocol.Text(entry,"initialFocus"),Server=Integer(entry,"server"),At=Utc(DesktopProtocol.Text(state,"now")),End=Utc(DesktopProtocol.Text(entry,"endAt")),CreatedAt=Utc(DesktopProtocol.Text(entry,"createdAt")),Stopped=Boolean(entry,"operatorStopped")};}
 internal static DesktopEntryJobSnapshot ParseJobState(Dictionary<string,object> state,string jobKind){if(state==null||DesktopProtocol.Text(state,"appId")!="wardogs-seeding-local-v1"||!Boolean(Child(state,"capabilities"),"deferredEntryFocus"))return null;var entry=Entry(state);var job=Child(state,jobKind=="scheduled"?"opening":"activity");var origin=Child(state,"entryOrigin");
  var sample=new DesktopEntryJobSnapshot {Root=DesktopProtocol.Text(state,"installationRoot"),At=Utc(DesktopProtocol.Text(state,"now")),Entry=entry,OriginKind=DesktopProtocol.Text(origin,"kind"),OriginOwnerId=DesktopProtocol.Text(origin,"ownerId"),OriginEntryId=DesktopProtocol.Text(origin,"entryId"),Job=job==null?null:new DesktopEntryJobSample {Id=DesktopProtocol.Text(job,"id"),Status=DesktopProtocol.Text(job,"status"),FocusMode=DesktopProtocol.Text(job,"initialFocus"),Server=Integer(job,jobKind=="scheduled"?"server":"selectedServer"),JoinId=DesktopProtocol.Text(job,jobKind=="scheduled"?"joinId":"selectedJoinId")}};
  object raw;var rows=state.TryGetValue("servers",out raw)?raw as object[]:null;if(rows!=null&&entry!=null)foreach(var item in rows){var server=DesktopProtocol.Object(item);if(Integer(server,"number")==entry.Server&&Boolean(server,"trusted")&&Boolean(server,"online")&&String.Equals(DesktopProtocol.Text(server,"joinId"),entry.JoinId,StringComparison.OrdinalIgnoreCase))sample.TargetVerified=true;}
  return sample;}
 private async Task<DesktopEntryJobSnapshot> ReadJob(){var sample=ParseJobState(await ReadState(),jobPolicy.Kind);if(sample!=null)DesktopEntryWatchBaseline.Apply(sample,root,DateTime.UtcNow);return sample;}
 private async Task PulseManual(){uint input;if(!Input(out input)){policy.Cancel("No se puede comprobar la última interacción.");return;}var foreground=GetForegroundWindow();var outcome=policy.Tick(clock.Elapsed.TotalMilliseconds,input,Own(foreground),Game(foreground),false,localPage(),null,false,DateTime.UtcNow,root,false);if(!policy.Pending||policy.SessionId==null)return;var session=policy.SessionId;var sample=Entry(await ReadState());if(disposed||!policy.Pending||policy.SessionId!=session)return;var target=Target();if(!Input(out input)){policy.Cancel("No se puede comprobar la última interacción.");return;}foreground=GetForegroundWindow();outcome=policy.Tick(clock.Elapsed.TotalMilliseconds,input,Own(foreground),Game(foreground),false,localPage(),sample,target!=IntPtr.Zero,DateTime.UtcNow,root);if(outcome=="activate"){bool success=false;try{success=Game(target)&&SetForegroundWindow(target)&&Game(GetForegroundWindow());}catch{}policy.Result(success);}}
 private async Task PulseJob(){uint input;DateTime? inputAt;var nonce=jobPolicy.Nonce;var sample=await ReadJob();if(disposed||!jobPolicy.Pending||jobPolicy.Nonce!=nonce)return;var target=Target();if(!InputWithDate(out input,out inputAt)){jobPolicy.Revoke("No se puede comprobar la última interacción.");return;}var outcome=jobPolicy.Tick(clock.Elapsed.TotalMilliseconds,input,Game(GetForegroundWindow()),localPage(),sample,target!=IntPtr.Zero,DateTime.UtcNow,root,inputAt);if(outcome!="activate")return;
  bool accepted=false,success=false;try{accepted=Game(target)&&SetForegroundWindow(target);for(int waited=0;;waited+=25){if(disposed||jobPolicy.Nonce!=nonce||jobPolicy.Status!="attempted")return;if(!Input(out input)){jobPolicy.Revoke("No se puede comprobar la última interacción.");return;}if(input!=sample.InputAtStart.Value){jobPolicy.Revoke("Ha habido interacción durante el foco inicial; no se volverá a intentar.");return;}DesktopEntryWatchBaseline.Apply(sample,root,DateTime.UtcNow);if(!sample.InputAtStart.HasValue||!localPage()){jobPolicy.Revoke("La entrada ya no autoriza el foco inicial.");return;}if(Game(target)&&GetForegroundWindow()==target){success=true;break;}if(!accepted||waited>=500)break;await Task.Delay(25);}}catch{}jobPolicy.Result(success);}
 private async Task Pulse(){if(disposed||busy||!policy.Pending&&!jobPolicy.Pending&&!jobStopping.Pending)return;busy=true;try{if(policy.Pending)await PulseManual();if(!disposed&&jobPolicy.Pending)await PulseJob();if(!disposed&&jobStopping.Pending)try{await jobStopping.Retry();}catch{}}catch{if(policy.Pending)policy.Cancel("No se pudo confirmar la sesión para activar Wardogs.");}finally{busy=false;if(!disposed){Publish();PublishJob();}}}
 private void Publish(){try{publish(new{kind="host_entry_focus_status",id=policy.Nonce,sessionId=policy.SessionId,status=policy.Status,reason=policy.Reason});}catch{}}
 private void PublishJob(){if(jobPolicy.Nonce==null)return;try{publish(new{kind="host_entry_focus_job_status",id=jobPolicy.Nonce,jobKind=jobPolicy.Kind,ownerId=jobPolicy.OwnerId,sessionId=jobPolicy.SessionId,status=jobPolicy.Status,reason=jobPolicy.Reason});}catch{}}
 public void Dispose(){if(disposed)return;disposed=true;policy.Cancel("App cerrada.");jobPolicy.Revoke("App cerrada.");timer.Stop();timer.Dispose();client.Dispose();clock.Stop();}
}
