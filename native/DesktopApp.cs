using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class DesktopApp
{
    [STAThread] public static int Main(string[] args)
    {
        var reportPath=args.Length==2?Path.GetFullPath(args[1]):null;
        try
        {
            var version=CoreWebView2Environment.GetAvailableBrowserVersionString();
            if(args.Length==2&&args[0]=="--probe") { File.WriteAllText(reportPath,DesktopProtocol.Json.Serialize(new {available=true,runtime=version})); return 0; }
            Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
            if(args.Length==2&&args[0]=="--self-test")
            {
                int result=1;var context=new ApplicationContext();var form=new DesktopWindow(true);
                var handle=form.Handle;
                form.BeginInvoke(new Action(async delegate {
                    try { await form.InitializeView();await form.VerifyHidden(reportPath,version);result=0; }
                    catch(Exception error) { File.WriteAllText(reportPath,DesktopProtocol.Json.Serialize(new {success=false,error=error.Message})); }
                    finally { form.Dispose();context.ExitThread(); }
                }));
                Application.Run(context);return result;
            }
            bool created;
            using(var single=new Mutex(true,"Local\\WardogsDesktopApp",out created))
            {
                if(!created){using(var show=new EventWaitHandle(false,EventResetMode.AutoReset,"Local\\WardogsDesktopAppOpen"))show.Set();return 0;}
                Application.Run(new DesktopWindow(false));
            }
            return 0;
        }
        catch(Exception error)
        {
            if(reportPath!=null)File.WriteAllText(reportPath,DesktopProtocol.Json.Serialize(new {success=false,error=error.Message}));
            else MessageBox.Show("No se pudo abrir la app. Comprueba el servicio local y WebView2.\n"+error.Message,"FarmDogs",MessageBoxButtons.OK,MessageBoxIcon.Information);
            return 1;
        }
    }
}

internal sealed class DesktopWindow : Form
{
    private readonly WebView2 view=new WebView2();
    private readonly HttpClient http=new HttpClient(new HttpClientHandler {UseProxy=false,UseCookies=false}) {Timeout=TimeSpan.FromSeconds(10)};
    private readonly string root=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,".."));
    private readonly string readerId=Guid.NewGuid().ToString("D");
    private readonly bool selfTest;
    private readonly ToolStripLabel status=new ToolStripLabel("Cuenta sin conectar");
    private readonly ToolStripButton stop=new ToolStripButton("Detener lectura");
    private readonly System.Windows.Forms.Timer poll=new System.Windows.Forms.Timer {Interval=30000};
    private System.Windows.Forms.Timer showTimer;
    private System.Windows.Forms.Timer updateCloseTimer;
    private EventWaitHandle showRequest;
    private Form authForm;
    private WebView2 authView;
    private Label authLocation;
    private CoreWebView2Environment environment;
    private string pendingId;
    private DateTime pendingSince,nextRead;
    private Dictionary<string,object> vipPart,seedPart;
    private bool reading,exiting,closeAllowed,importing;
    private int handshakes;
    private Task importTask;
    private readonly RewardBridge rewards;
    private ForegroundAlertMonitor foregroundAlerts;
    private DesktopEntryFocus entryFocus;
    private bool authNavigating;
    private string state="disconnected",detail="Conecta Steam para actualizar tu cuenta.";

    public DesktopWindow(bool hiddenTest)
    {
        selfTest=hiddenTest;Text="FarmDogs";ClientSize=new Size(1000,790);MinimumSize=new Size(780,650);StartPosition=FormStartPosition.CenterScreen;
        rewards=new RewardBridge(http,root,readerId,()=>authView==null?null:authView.CoreWebView2,()=>reading&&!exiting&&!selfTest&&!authNavigating,message=>SetStatus("reward_protection",message));
        BackColor=Color.FromArgb(16,22,21);Font=new Font("Segoe UI",9);
        view.Dock=DockStyle.Fill;Controls.Add(view);
        var bar=new ToolStrip {GripStyle=ToolStripGripStyle.Hidden,Dock=DockStyle.Top};
        var home=new ToolStripButton("FarmDogs");home.Click+=(s,e)=>{if(view.CoreWebView2!=null)view.CoreWebView2.Navigate(DesktopProtocol.LocalBase+"/mini");};
        var account=new ToolStripButton("Cuenta Steam");account.Click+=async(s,e)=>await OpenAccount();
        stop.Enabled=false;stop.Click+=async(s,e)=>await StopReading();
        bar.Items.AddRange(new ToolStripItem[]{home,account,stop,new ToolStripSeparator(),status});Controls.Add(bar);
        poll.Tick+=async(s,e)=>{await ReadAccount();await rewards.ReadAsync();};
        if(!selfTest)foregroundAlerts=new ForegroundAlertMonitor(this,root,message=>{
            if(!view.IsDisposed&&view.CoreWebView2!=null&&DesktopProtocol.IsLocal(view.CoreWebView2.Source))view.CoreWebView2.PostWebMessageAsJson(DesktopProtocol.Json.Serialize(message));
        });
        if(!selfTest)entryFocus=new DesktopEntryFocus(this,root,()=>!exiting&&view.CoreWebView2!=null&&DesktopProtocol.IsLocal(view.CoreWebView2.Source),message=>{if(!view.IsDisposed&&view.CoreWebView2!=null&&DesktopProtocol.IsLocal(view.CoreWebView2.Source))view.CoreWebView2.PostWebMessageAsJson(DesktopProtocol.Json.Serialize(message));});
        if(!selfTest){showRequest=new EventWaitHandle(false,EventResetMode.AutoReset,"Local\\WardogsDesktopAppOpen");showTimer=new System.Windows.Forms.Timer {Interval=400};showTimer.Tick+=(s,e)=>{if(showRequest.WaitOne(0)){Show();WindowState=FormWindowState.Normal;Activate();}};showTimer.Start();}
        if(!selfTest){updateCloseTimer=new System.Windows.Forms.Timer{Interval=200};updateCloseTimer.Tick+=(s,e)=>{if(!exiting&&AppShutdown.Requested(root,Path.Combine(root,"data"),DateTime.UtcNow))Close();};updateCloseTimer.Start();}
        if(!selfTest)Shown+=async(s,e)=>{try{await InitializeView();}catch(Exception error){SetStatus("error",error.Message);}};
        FormClosing+=async(s,e)=>{
            if(closeAllowed)return;e.Cancel=true;if(exiting)return;exiting=true;
            await Task.Yield(); // Return the initial cancelled FormClosing before any final Close/Dispose.
            reading=false;poll.Stop();pendingId=null;vipPart=null;seedPart=null;view.Enabled=false;
            if(updateCloseTimer!=null){updateCloseTimer.Stop();updateCloseTimer.Dispose();updateCloseTimer=null;}
            if(showTimer!=null)showTimer.Stop();
            if(foregroundAlerts!=null){foregroundAlerts.Dispose();foregroundAlerts=null;}
            if(entryFocus!=null){entryFocus.Dispose();entryFocus=null;}
            string rewardCommand=rewards.BeginClose();
            // Dispose the old client now: an old import/reward continuation may
            // never post to a new service after this host has closed.
            try{http.CancelPendingRequests();}catch{}http.Dispose();
            var closeHttp=new HttpClient(new HttpClientHandler{UseProxy=false,UseCookies=false,AllowAutoRedirect=false}){Timeout=TimeSpan.FromSeconds(7),MaxResponseContentBufferSize=524288};
            string version=null;try{version=DesktopProtocol.Text(DesktopProtocol.Object(DesktopProtocol.Json.DeserializeObject(File.ReadAllText(Path.Combine(root,"package.json")))),"version");}catch{}
            try{await DesktopClose.RunAsync(async cancellation=>{
                var service=DesktopClose.StopOwnServiceAsync(closeHttp,root,version,readerId,rewardCommand,cancellation);
                var browser=rewards.AbortForCloseAsync();
                await Task.WhenAll(service,browser,importTask??Task.FromResult(0));
            },()=>{closeHttp.CancelPendingRequests();closeHttp.Dispose();},()=>{
                try{if(authForm!=null)authForm.Dispose();}finally{closeAllowed=true;try{Close();}finally{Dispose();}}
            });}
            finally{closeHttp.Dispose();}
        };
    }
    public async Task InitializeView()
    {
        var profile=Path.Combine(root,"data",selfTest?"webview-selftest":"webview-profile");
        environment=await CoreWebView2Environment.CreateAsync(null,profile);
        await view.EnsureCoreWebView2Async(environment);
        Configure(view.CoreWebView2);
        // WinForms WebView2 forwards its controller's accelerator keys through
        // KeyDown. Queue work because its browser is blocked during this event.
        if(!selfTest)view.KeyDown+=(s,e)=>{if(e.KeyCode==Keys.F8)QueueEntryStop();};
        view.CoreWebView2.NavigationStarting+=(s,e)=>{if(entryFocus!=null)entryFocus.Cancel(null);if(!DesktopProtocol.IsLocal(e.Uri))e.Cancel=true;};
        view.CoreWebView2.NewWindowRequested+=(s,e)=>{e.Handled=true;};
        view.CoreWebView2.WebMessageReceived+=async(s,e)=>{
            if(!DesktopProtocol.IsLocal(e.Source)||!DesktopProtocol.IsLocal(view.CoreWebView2.Source)||e.WebMessageAsJson.Length>2048)return;
            var msg=DesktopProtocol.Object(DesktopProtocol.Json.DeserializeObject(e.WebMessageAsJson));var kind=DesktopProtocol.Text(msg,"kind");
            if(kind=="host_ready"){handshakes++;Publish();if(foregroundAlerts!=null)foregroundAlerts.Ready();if(entryFocus!=null)entryFocus.Ready();}
            else if(kind=="host_entry_focus_arm"&&!selfTest&&entryFocus!=null){object raw;int server=msg.TryGetValue("server",out raw)&&raw is int?(int)raw:0;entryFocus.Arm(DesktopProtocol.Text(msg,"id"),server,DesktopProtocol.Text(msg,"joinId"));}
            else if(kind=="host_entry_focus_bind"&&!selfTest&&entryFocus!=null)await entryFocus.Bind(DesktopProtocol.Text(msg,"id"),DesktopProtocol.Text(msg,"sessionId"));
            else if(kind=="host_entry_focus_stop"&&!selfTest&&entryFocus!=null)await entryFocus.StopFromKey(DesktopProtocol.Text(msg,"id"));
            else if(kind=="host_entry_focus_cancel"&&!selfTest&&entryFocus!=null)entryFocus.Cancel(DesktopProtocol.Text(msg,"id"));
            else if(kind=="host_focus_ready"&&!selfTest&&foregroundAlerts!=null)foregroundAlerts.Ready();
            else if(kind=="host_focus_preferences"&&!selfTest&&foregroundAlerts!=null){object enabled;if(msg!=null&&msg.TryGetValue("soundEnabled",out enabled)&&enabled is bool)foregroundAlerts.SetSound((bool)enabled);}
            else if(kind=="host_focus_preview"&&!selfTest&&foregroundAlerts!=null)foregroundAlerts.Preview();
            else if(kind=="account_open"&&!selfTest)await OpenAccount();
            else if(kind=="account_stop"&&!selfTest)await StopReading();
            else if(kind=="reward_cancel"&&!selfTest)await rewards.CancelAsync();
        };
        view.CoreWebView2.Navigate(DesktopProtocol.LocalBase+"/mini");
    }
    private static void Configure(CoreWebView2 core)
    {
        core.Settings.AreHostObjectsAllowed=false;core.Settings.AreDevToolsEnabled=false;core.Settings.IsStatusBarEnabled=false;
        core.PermissionRequested+=(s,e)=>{e.State=CoreWebView2PermissionState.Deny;};
    }
    private void SetStatus(string next,string message)
    {
        if(exiting||IsDisposed)return;
        state=next;detail=message.Length>240?message.Substring(0,240):message;status.Text=detail;stop.Enabled=reading;Publish();
    }
    private void Publish()
    {
        if(view.IsDisposed||view.CoreWebView2==null||!DesktopProtocol.IsLocal(view.CoreWebView2.Source))return;
        view.CoreWebView2.PostWebMessageAsJson(DesktopProtocol.Json.Serialize(new {kind="host_account_status",state=state,detail=detail,reading=reading}));
    }
    private async Task OpenAccount()
    {
        if(exiting)return;
        try
        {
            if(environment==null)throw new InvalidOperationException("La app todavía se está abriendo.");
            if(authForm==null)
            {
                authForm=new Form {Text="FarmDogs · Conectar cuenta Steam",ClientSize=new Size(1000,780),StartPosition=FormStartPosition.CenterParent};
                authView=new WebView2 {Dock=DockStyle.Fill};authForm.Controls.Add(authView);
                var header=new Panel {Dock=DockStyle.Top,Height=65};
                authLocation=new Label {Dock=DockStyle.Fill,AutoEllipsis=true,Text="Inicia Steam una vez. Puedes ocultar esta ventana y mantener la lectura mientras la app esté abierta."};
                var hide=new Button {Text="Ocultar y seguir leyendo",Dock=DockStyle.Right,Width=190};hide.Click+=(s,e)=>authForm.Hide();
                header.Controls.Add(authLocation);header.Controls.Add(hide);authForm.Controls.Add(header);
                authForm.FormClosing+=(s,e)=>{if(!exiting){e.Cancel=true;authForm.Hide();}};
                authForm.Show(this);
                await authView.EnsureCoreWebView2Async(environment);Configure(authView.CoreWebView2);
                authView.CoreWebView2.NavigationStarting+=async(s,e)=>{
                    if(!DesktopProtocol.IsLoginNavigation(e.Uri)){e.Cancel=true;SetStatus("navigation_blocked","Continúa solo con Steam o Wardogs en esta ventana.");return;}
                    authNavigating=true;
                    Uri u;if(Uri.TryCreate(e.Uri,UriKind.Absolute,out u))authLocation.Text="Dominio: "+u.Host+" · Ocultar conserva la lectura; Detener lectura la desconecta.";
                    if(!DesktopProtocol.IsAccount(e.Uri)){pendingId=null;await rewards.DisconnectAsync();await DisconnectSnapshot();SetStatus("sign_in_required","Completa el inicio de sesión en la ventana de cuenta.");}
                };
                authView.CoreWebView2.NewWindowRequested+=(s,e)=>{e.Handled=true;if(DesktopProtocol.IsLoginNavigation(e.Uri))authView.CoreWebView2.Navigate(e.Uri);};
                authView.CoreWebView2.WebMessageReceived+=async(s,e)=>{if(!await rewards.HandleAsync(e))await ReceivePart(e);};
                authView.CoreWebView2.NavigationCompleted+=async(s,e)=>{authNavigating=false;if(reading&&DesktopProtocol.IsAccount(authView.CoreWebView2.Source)){await ReadAccount();await rewards.ReadAsync();}};
                authView.CoreWebView2.Navigate(DesktopProtocol.AccountUrl);
            }
            else {authForm.Show(this);authForm.Activate();}
            reading=true;nextRead=DateTime.MinValue;poll.Start();SetStatus("connecting","Abre tu cuenta Steam para renovar VIP y seeding.");
            await ReadAccount();
            await rewards.ReadAsync();
        }
        catch(Exception error){SetStatus("error",error.Message);}
    }
    private async Task ReadAccount()
    {
        if(exiting||!reading||authView==null||authView.CoreWebView2==null||!DesktopProtocol.IsAccount(authView.CoreWebView2.Source)||DateTime.UtcNow<nextRead||importing)return;
        if(pendingId!=null&&DateTime.UtcNow-pendingSince<TimeSpan.FromSeconds(20))return;
        pendingId=Guid.NewGuid().ToString("D");pendingSince=DateTime.UtcNow;vipPart=null;seedPart=null;
        var id=DesktopProtocol.Json.Serialize(pendingId);
        var script="(()=>{const id="+id+";const entries=[['vip','"+DesktopProtocol.VipUrl+"'],['sedeo','"+DesktopProtocol.SeedUrl+"']];for(const [endpoint,source] of entries){(async()=>{const c=new AbortController();const t=setTimeout(()=>c.abort(),15000);try{const r=await fetch(source,{credentials:'include',cache:'no-store',signal:c.signal});const data=await r.json();window.chrome.webview.postMessage({kind:'account_part',id,endpoint,source,httpStatus:r.status,data});}catch{window.chrome.webview.postMessage({kind:'account_error',id,endpoint});}finally{clearTimeout(t);}})();}})();";
        bool failed=false;
        try{await authView.CoreWebView2.ExecuteScriptAsync(script);}catch{failed=true;}
        if(failed){pendingId=null;await DisconnectSnapshot();SetStatus("read_error","No se pudo consultar la cuenta. Vuelve a abrirla.");}
    }
    private async Task ReceivePart(CoreWebView2WebMessageReceivedEventArgs args)
    {
        Exception failure=null;
        try
        {
            if(exiting||!reading||authView==null||!DesktopProtocol.IsAccount(args.Source)||!DesktopProtocol.IsAccount(authView.CoreWebView2.Source)||args.WebMessageAsJson.Length>65536||pendingId==null||DateTime.UtcNow-pendingSince>TimeSpan.FromSeconds(20))return;
            var msg=DesktopProtocol.Object(DesktopProtocol.Json.DeserializeObject(args.WebMessageAsJson));
            if(DesktopProtocol.Text(msg,"id")!=pendingId)return;
            var kind=DesktopProtocol.Text(msg,"kind");
            if(kind=="account_error"){pendingId=null;await DisconnectSnapshot();SetStatus("read_error","No se pudo renovar la lectura de cuenta.");return;}
            if(kind!="account_part")return;
            object code;if(!msg.TryGetValue("httpStatus",out code)||!(code is int))return;
            if((int)code!=200){pendingId=null;nextRead=DateTime.UtcNow.AddSeconds((int)code==429?120:30);await DisconnectSnapshot();SetStatus((int)code==401?"sign_in_required":"read_error",(int)code==401?"Inicia Steam en la ventana de cuenta.":"La cuenta no responde; se volverá a consultar.");return;}
            string endpoint=DesktopProtocol.Text(msg,"endpoint"),source=DesktopProtocol.Text(msg,"source");object data;
            if(!msg.TryGetValue("data",out data)||DesktopProtocol.Object(data)==null)return;
            var part=new Dictionary<string,object>{{"observedAt",DateTime.UtcNow.ToString("o")},{"source",source},{"data",data}};
            if(endpoint=="vip"&&source==DesktopProtocol.VipUrl)vipPart=part;else if(endpoint=="sedeo"&&source==DesktopProtocol.SeedUrl)seedPart=part;else return;
            if(vipPart==null||seedPart==null||importing)return;
            importing=true;var id=pendingId;pendingId=null;
            try
            {
                importTask=DesktopProtocol.PostLocal(http,"/api/account/import",new {format="wardogs-account-snapshot-v1",readerId=readerId,observedAt=DateTime.UtcNow.ToString("o"),vip=vipPart,seeding=seedPart});
                await importTask;
                if(reading){nextRead=DateTime.UtcNow.AddSeconds(25);SetStatus("connected","Cuenta actualizada · lectura cada 30 segundos.");}
                else await DisconnectSnapshot();
            }
            finally{importing=false;}
        }
        catch(Exception error){failure=error;}
        if(failure!=null){await DisconnectSnapshot();SetStatus("read_error",failure.Message);}
    }
    private async Task DisconnectSnapshot()
    {
        try{await DesktopProtocol.PostLocal(http,"/api/account/disconnect",new {readerId=readerId});}catch{}
    }
    private async Task StopReading()
    {
        reading=false;poll.Stop();pendingId=null;vipPart=null;seedPart=null;
        await rewards.DisconnectAsync();
        if(importTask!=null){try{await importTask;}catch{}}
        await DisconnectSnapshot();SetStatus("disconnected","Lectura detenida. La sesión web se conserva en la app.");
    }
    public async Task VerifyHidden(string report,string runtime)
    {
        var deadline=DateTime.UtcNow.AddSeconds(25);string document=null;
        while(DateTime.UtcNow<deadline)
        {
            document=await view.CoreWebView2.ExecuteScriptAsync("JSON.stringify({title:document.title,servers:document.querySelectorAll('#servers button').length,reader:!!document.getElementById('connect-account'),antiAfk:!!document.getElementById('break-card'),focusAlert:!!document.getElementById('focus-alert'),horizontalOverflow:document.documentElement.scrollWidth>innerWidth})");
            var decoded=DesktopProtocol.Json.DeserializeObject(document) as string;
            if(decoded!=null&&decoded.Contains("\"servers\":5")&&handshakes>0)
            {
                string preview=report+".png";
                using(var output=File.Create(preview))await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,output);
                File.WriteAllText(report,DesktopProtocol.Json.Serialize(new {success=true,runtime=runtime,windowShown=Visible,handshakes=handshakes,document=DesktopProtocol.Json.DeserializeObject(decoded),accountWindowCreated=authForm!=null,preview=preview}));return;
            }
            await Task.Delay(200);
        }
        throw new TimeoutException("La vista local no terminó de cargar o no respondió al puente de escritorio.");
    }
    protected override void Dispose(bool disposing)
    {
        if(disposing){if(entryFocus!=null)entryFocus.Dispose();if(foregroundAlerts!=null)foregroundAlerts.Dispose();if(showTimer!=null)showTimer.Dispose();if(showRequest!=null)showRequest.Dispose();poll.Dispose();http.Dispose();if(authForm!=null)authForm.Dispose();view.Dispose();}base.Dispose(disposing);
    }
    protected override bool ProcessCmdKey(ref Message message,Keys keyData)
    {
        if((keyData&Keys.KeyCode)==Keys.F8)QueueEntryStop();
        return base.ProcessCmdKey(ref message,keyData);
    }
    private void QueueEntryStop()
    {
        var owned=entryFocus;if(owned==null||IsDisposed||!IsHandleCreated)return;
        BeginInvoke(new Action(async delegate{if(!exiting&&entryFocus==owned)await owned.StopFromKey();}));
    }
}
