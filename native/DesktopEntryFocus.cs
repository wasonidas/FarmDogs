using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;

internal sealed class DesktopEntryFocusSample
{
 internal string SessionId,Root,Status,JoinId,FocusMode;internal int Server;internal DateTime At,End;internal bool Stopped;
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
 [DllImport("user32.dll")]private static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 [DllImport("user32.dll")]private static extern bool EnumWindows(EnumCallback callback,IntPtr ignored);
 [DllImport("user32.dll")]private static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll")]private static extern bool IsIconic(IntPtr window);
 [DllImport("user32.dll")]private static extern bool GetClientRect(IntPtr window,out RECT bounds);
 [DllImport("user32.dll")]private static extern bool SetForegroundWindow(IntPtr window);
 private readonly DesktopEntryFocusPolicy policy=new DesktopEntryFocusPolicy();
 private readonly DesktopEntryStop stopping;
 private readonly Form owner;private readonly string root;private readonly Func<bool> localPage;private readonly Action<object> publish;
 private readonly HttpClient client=new HttpClient(new HttpClientHandler{UseProxy=false,UseCookies=false,AllowAutoRedirect=false}){Timeout=TimeSpan.FromSeconds(2),MaxResponseContentBufferSize=524288};
 private readonly JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=524288};
 private readonly Timer timer=new Timer{Interval=200};private readonly Stopwatch clock=Stopwatch.StartNew();
 private bool busy,disposed;
 internal DesktopEntryFocus(Form owner,string root,Func<bool> localPage,Action<object> publish){this.owner=owner;this.root=root;this.localPage=localPage;this.publish=publish;stopping=new DesktopEntryStop(async session=>{await DesktopProtocol.PostLocal(client,"/api/entry/stop",new{expectedSessionId=session});});timer.Tick+=async(s,e)=>await Pulse();timer.Start();}
 private static bool Input(out uint value){var last=new LASTINPUTINFO{cbSize=(uint)Marshal.SizeOf(typeof(LASTINPUTINFO))};bool ok=GetLastInputInfo(ref last);value=last.dwTime;return ok;}
 private bool Own(IntPtr foreground){return foreground!=IntPtr.Zero&&(foreground==owner.Handle||GetAncestor(foreground,2)==owner.Handle);}
 private static bool Game(IntPtr window){try{uint pid;if(window==IntPtr.Zero||GetWindowThreadProcessId(window,out pid)==0||pid==0)return false;using(var p=Process.GetProcessById((int)pid))return !p.HasExited&&p.ProcessName=="WardogsClient-Win64-Shipping";}catch{return false;}}
 private static IntPtr Target(){IntPtr result=IntPtr.Zero;bool ambiguous=false;if(!EnumWindows((window,ignored)=>{RECT bounds;if(IsWindowVisible(window)&&!IsIconic(window)&&Game(window)&&GetClientRect(window,out bounds)&&bounds.Right-bounds.Left>=320&&bounds.Bottom-bounds.Top>=200){if(result!=IntPtr.Zero&&result!=window)ambiguous=true;result=window;}return true;},IntPtr.Zero)||ambiguous)return IntPtr.Zero;return result;}
 internal bool Arm(string nonce,int server,string joinId){uint input;if(disposed||!localPage()||!Input(out input)||!policy.Arm(nonce,server,joinId,Own(GetForegroundWindow()),input,clock.Elapsed.TotalMilliseconds))return false;stopping.Arm(nonce);Publish();return true;}
 internal async Task Bind(string nonce,string session){policy.Bind(nonce,session);try{await stopping.Bind(nonce,session);}catch{policy.Cancel("No se pudo confirmar la parada; usa Detener.");}Publish();}
 internal async Task StopFromKey(string nonce=null){if(disposed||(nonce!=null&&nonce!=policy.Nonce))return;policy.Cancel("Detenido con F8.");try{await stopping.Request(policy.Nonce);}catch{policy.Cancel("No se pudo confirmar la parada; usa Detener.");}Publish();}
 internal void Cancel(string nonce){if(nonce==null||nonce==policy.Nonce){policy.Cancel("Inicio cancelado desde la app.");Publish();}}
 internal void Ready(){try{publish(new{kind="host_entry_focus_support",supported=true});}catch{}}
 private static DateTime Utc(string value){DateTime result;return value!=null&&value.EndsWith("Z",StringComparison.Ordinal)&&DateTime.TryParse(value,CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind,out result)&&result.Kind==DateTimeKind.Utc?result:DateTime.MinValue;}
 private async Task<DesktopEntryFocusSample> Read(){using(var response=await client.GetAsync(DesktopProtocol.LocalBase+"/api/state")){if(!response.IsSuccessStatusCode)return null;var state=DesktopProtocol.Object(json.DeserializeObject(await response.Content.ReadAsStringAsync()));object raw;var entry=state!=null&&state.TryGetValue("entry",out raw)?DesktopProtocol.Object(raw):null;if(DesktopProtocol.Text(state,"appId")!="wardogs-seeding-local-v1"||entry==null)return null;int server=0;if(entry.TryGetValue("server",out raw)&&raw is int)server=(int)raw;bool stopped=entry.TryGetValue("operatorStopped",out raw)&&raw is bool&&(bool)raw;return new DesktopEntryFocusSample{SessionId=DesktopProtocol.Text(entry,"id"),Root=DesktopProtocol.Text(state,"installationRoot"),Status=DesktopProtocol.Text(entry,"status"),JoinId=DesktopProtocol.Text(entry,"joinId"),FocusMode=DesktopProtocol.Text(entry,"initialFocus"),Server=server,At=Utc(DesktopProtocol.Text(state,"now")),End=Utc(DesktopProtocol.Text(entry,"endAt")),Stopped=stopped};}}
 private async Task Pulse(){if(disposed||busy||!policy.Pending)return;busy=true;try{uint input;if(!Input(out input)){policy.Cancel("No se puede comprobar la última interacción.");return;}var foreground=GetForegroundWindow();var outcome=policy.Tick(clock.Elapsed.TotalMilliseconds,input,Own(foreground),Game(foreground),false,localPage(),null,false,DateTime.UtcNow,root,false);if(!policy.Pending||policy.SessionId==null)return;var session=policy.SessionId;var sample=await Read();if(disposed||!policy.Pending||policy.SessionId!=session)return;var target=Target();if(!Input(out input)){policy.Cancel("No se puede comprobar la última interacción.");return;}foreground=GetForegroundWindow();outcome=policy.Tick(clock.Elapsed.TotalMilliseconds,input,Own(foreground),Game(foreground),false,localPage(),sample,target!=IntPtr.Zero,DateTime.UtcNow,root);if(outcome=="activate"){bool success=false;try{success=Game(target)&&SetForegroundWindow(target)&&Game(GetForegroundWindow());}catch{}policy.Result(success);}}catch{policy.Cancel("No se pudo confirmar la sesión para activar Wardogs.");}finally{busy=false;if(!disposed)Publish();}}
 private void Publish(){try{publish(new{kind="host_entry_focus_status",id=policy.Nonce,sessionId=policy.SessionId,status=policy.Status,reason=policy.Reason});}catch{}}
 public void Dispose(){if(disposed)return;disposed=true;policy.Cancel("App cerrada.");timer.Stop();timer.Dispose();client.Dispose();clock.Stop();}
}
