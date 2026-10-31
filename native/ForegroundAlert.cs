using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Media;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal sealed class ForegroundRequirement
{
    public string Key,Detail,Title;
    public bool Once;
}
internal sealed class ForegroundAlertView
{
    public bool Active,PlaySound;
    public string Key,Title,Detail;
}

// Pure policy: tests do not construct windows, inspect processes, or play audio.
internal sealed class ForegroundAlertPolicy
{
    private string candidate,dismissed;
    private double since,lastMono,lastSound=Double.NegativeInfinity;
    private bool shown,initialized;
    private readonly HashSet<string> notifiedOnce=new HashSet<string>();
    public void Dismiss(){dismissed=candidate;shown=false;}
    public ForegroundAlertView Update(ForegroundRequirement requirement,bool? gameForeground,bool soundEnabled,double mono)
    {
        var empty=new ForegroundAlertView();
        if(Double.IsNaN(mono)||Double.IsInfinity(mono)||(initialized&&mono<lastMono)){candidate=null;dismissed=null;shown=false;initialized=false;return empty;}
        lastMono=mono;initialized=true;
        if(requirement==null||gameForeground!=false){candidate=null;dismissed=null;shown=false;return empty;}
        if(candidate!=requirement.Key){candidate=requirement.Key;since=mono;dismissed=null;shown=false;}
        if(mono-since<1200||dismissed==candidate||(requirement.Once&&!shown&&notifiedOnce.Contains(candidate)))return empty;
        bool play=!shown&&soundEnabled&&mono-lastSound>=15000;
        shown=true;if(requirement.Once)notifiedOnce.Add(candidate);if(play)lastSound=mono;
        return new ForegroundAlertView{Active=true,PlaySound=play,Key=candidate,Title=requirement.Title??"PON WARDOGS EN PRIMER PLANO",Detail=requirement.Detail};
    }
    private static Dictionary<string,object> Object(Dictionary<string,object> value,string key)
    {
        object result;return value!=null&&value.TryGetValue(key,out result)?result as Dictionary<string,object>:null;
    }
    private static string Text(Dictionary<string,object> value,string key)
    {
        object result;return value!=null&&value.TryGetValue(key,out result)?result as string:null;
    }
    private static bool True(Dictionary<string,object> value,string key)
    {
        object result;return value!=null&&value.TryGetValue(key,out result)&&result is bool&&(bool)result;
    }
    private static bool Utc(string text,out DateTime value)
    {
        value=DateTime.MinValue;
        return text!=null&&text.EndsWith("Z",StringComparison.Ordinal)&&DateTime.TryParse(text,CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind,out value)&&value.Kind==DateTimeKind.Utc;
    }
    public static ForegroundRequirement FromState(Dictionary<string,object> state,DateTime now)
    {
        DateTime at;double age;
        if(Text(state,"appId")!="wardogs-seeding-local-v1"||!Utc(Text(state,"now"),out at)||(age=(now-at).TotalMilliseconds)<0||age>3000)return null;
        var movement=Object(state,"autoSeeding");Guid id;DateTime end;
        string status=Text(movement,"status"),session=Text(movement,"id");
        if(Guid.TryParse(session,out id)&&!True(movement,"operatorStopped")&&Utc(Text(movement,"endAt"),out end)&&end>now&&
            (status=="waiting_game"||status=="starting_movement"||status=="moving"))
        {
            if(Text(Object(state,"movement"),"autoOperatorStopped")==session)return null;
            return new ForegroundRequirement{Key="movement:"+session,Detail=Text(movement,"purpose")=="break"?
                "El anti-AFK necesita el juego delante para reconocer a tu personaje y moverse. Vuelve a Wardogs; deja los menús cerrados y las manos vacías.":
                "El movimiento de seeding necesita el juego delante para reconocer a tu personaje. Vuelve a Wardogs; deja los menús cerrados y las manos vacías."};
        }
        var entry=Object(state,"entry");session=Text(entry,"id");status=Text(entry,"status");
        if(Guid.TryParse(session,out id)&&!True(entry,"operatorStopped")&&Utc(Text(entry,"endAt"),out end)&&end>now&&
            (status=="opening"||status=="waiting_game"||status=="navigating"||status=="joining"||status=="choosing_team"||status=="deploying"||status=="starting_seeding"))
        {
            if(Text(Object(state,"movement"),"autoOperatorStopped")==session)return null;
            return new ForegroundRequirement{Key="entry:"+session,Detail="FarmDogs está completando la entrada al servidor y al equipo elegido. Deja Wardogs en primer plano para reconocer cada pantalla. F8 o Detener cancelan la entrada."};
        }
        var team=Object(state,"teamClicker");session=Text(team,"sessionId");
        if(True(team,"enabled")&&Guid.TryParse(session,out id))
            return new ForegroundRequirement{Key="team:"+session,Detail="La selección de equipo está esperando el selector. Entra al servidor y deja Wardogs delante para que FarmDogs pueda reconocerlo."};
        var reason=Text(team,"reason");object rawEvents;
        if(Guid.TryParse(session,out id)&&reason!=null&&reason.IndexOf("foco",StringComparison.OrdinalIgnoreCase)>=0&&state.TryGetValue("events",out rawEvents))
        {
            var events=rawEvents as object[];
            if(events!=null)foreach(var raw in events)
            {
                var item=raw as Dictionary<string,object>;DateTime stopped;
                if(Text(item,"kind")=="team_clicker_stopped"&&Text(item,"reason")==reason&&Utc(Text(item,"at"),out stopped)&&now>=stopped&&(now-stopped).TotalSeconds<=10)
                    return new ForegroundRequirement{Key="team-stopped:"+session,Once=true,Title="SELECCIÓN DE EQUIPO DETENIDA",Detail="Wardogs no está en primer plano. Pulsa Esperar equipo para reactivar la selección y vuelve al juego."};
            }
        }
        return null;
    }
}

internal static class ForegroundGameProbe
{
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
    public static bool? Read()
    {
        try
        {
            var window=GetForegroundWindow();uint pid;
            if(window==IntPtr.Zero)return null;
            GetWindowThreadProcessId(window,out pid);if(pid==0)return null;
            using(var process=Process.GetProcessById((int)pid))return !process.HasExited&&String.Equals(process.ProcessName,"WardogsClient-Win64-Shipping",StringComparison.OrdinalIgnoreCase);
        }
        catch{return null;}
    }
}

internal sealed class ForegroundNoticeForm : Form
{
    private readonly Label title=new Label(),detail=new Label();
    public event Action Dismissed;
    protected override bool ShowWithoutActivation {get{return true;}}
    protected override CreateParams CreateParams {get{var value=base.CreateParams;value.ExStyle|=0x08000000|0x00000080;return value;}}
    public ForegroundNoticeForm()
    {
        Text="FarmDogs · Aviso";FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;StartPosition=FormStartPosition.Manual;
        BackColor=Color.FromArgb(228,184,117);Padding=new Padding(2);AutoScaleMode=AutoScaleMode.Dpi;
        var body=new Panel{Dock=DockStyle.Fill,BackColor=Color.FromArgb(26,32,44),Padding=new Padding(22,18,22,16)};Controls.Add(body);
        var close=new Button{Text="Entendido",Dock=DockStyle.Bottom,Height=36,BackColor=Color.FromArgb(228,184,117),ForeColor=Color.FromArgb(37,29,18),FlatStyle=FlatStyle.Flat,TabStop=false};
        close.Click+=(s,e)=>{Hide();if(Dismissed!=null)Dismissed();};
        title.Dock=DockStyle.Top;title.Height=65;title.Font=new Font("Segoe UI",19,FontStyle.Bold);title.ForeColor=Color.FromArgb(245,223,186);
        detail.Dock=DockStyle.Fill;detail.Font=new Font("Segoe UI",10);detail.ForeColor=Color.FromArgb(225,232,244);
        body.Controls.Add(detail);body.Controls.Add(title);body.Controls.Add(close);
    }
    protected override void WndProc(ref Message message)
    {
        if(message.Msg==0x0021){message.Result=new IntPtr(3);return;} // MA_NOACTIVATE
        base.WndProc(ref message);
    }
    public void Display(ForegroundAlertView value,Screen screen)
    {
        title.Text=value.Title;detail.Text=value.Detail;
        var area=screen.WorkingArea;int width=Math.Min(620,Math.Max(320,area.Width-40));
        Size=new Size(width,width<500?280:250);Location=new Point(area.Right-width-20,area.Top+20);
        if(!Visible)Show();
    }
}

// Independent of page timers, so a minimized/occluded WebView can still notify.
internal sealed class ForegroundAlertMonitor : IDisposable
{
    private readonly HttpClient client=new HttpClient(new HttpClientHandler{UseProxy=false,UseCookies=false,AllowAutoRedirect=false}){Timeout=TimeSpan.FromSeconds(3),MaxResponseContentBufferSize=524288};
    private readonly JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=524288};
    private readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer{Interval=200};
    private readonly Stopwatch clock=Stopwatch.StartNew();
    private readonly ForegroundAlertPolicy policy=new ForegroundAlertPolicy();
    private readonly Form owner;
    private readonly Action<object> publish;
    private readonly string preferences;
    private ForegroundNoticeForm notice;
    private Dictionary<string,object> sample;
    private bool busy,disposed,soundEnabled=true;
    private double sampleAt=Double.NegativeInfinity,nextRead,lastPublish=Double.NegativeInfinity,previewUntil;
    private string lastPublished;
    public ForegroundAlertMonitor(Form owner,string root,Action<object> publish)
    {
        this.owner=owner;this.publish=publish;preferences=Path.Combine(root,"data","foreground-alert-settings.json");
        try
        {
            var saved=json.DeserializeObject(File.ReadAllText(preferences)) as Dictionary<string,object>;object value;
            if(saved!=null&&saved.TryGetValue("soundEnabled",out value)&&value is bool)soundEnabled=(bool)value;
        }catch{}
        timer.Tick+=async(s,e)=>{Pulse(false);await ReadIfNeeded();};timer.Start();
    }
    public void Ready(){Pulse(true);}
    public void SetSound(bool value)
    {
        soundEnabled=value;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(preferences));
            var temp=preferences+".tmp";File.WriteAllText(temp,json.Serialize(new{format="farmdogs-foreground-preferences-v1",soundEnabled=soundEnabled}));
            if(File.Exists(preferences))File.Replace(temp,preferences,null);else File.Move(temp,preferences);
        }catch{} // The current preference still applies if storage is unavailable.
        Pulse(true);
    }
    public void Preview()
    {
        if(disposed)return;
        previewUntil=clock.Elapsed.TotalMilliseconds+3000;
        if(soundEnabled)PlaySound();Pulse(true);
    }
    private async Task ReadIfNeeded()
    {
        double mono=clock.Elapsed.TotalMilliseconds;if(disposed||busy||mono<nextRead)return;busy=true;nextRead=mono+1000;
        try
        {
            using(var response=await client.GetAsync(DesktopProtocol.LocalBase+"/api/state"))
            {
                if(!response.IsSuccessStatusCode)throw new InvalidOperationException();
                var value=json.DeserializeObject(await response.Content.ReadAsStringAsync()) as Dictionary<string,object>;
                if(!disposed){sample=value;sampleAt=clock.Elapsed.TotalMilliseconds;}
            }
        }
        catch{sample=null;sampleAt=Double.NegativeInfinity;}
        finally{busy=false;if(!disposed)Pulse(false);}
    }
    private static void PlaySound(){try{SystemSounds.Exclamation.Play();}catch{}}
    private void Pulse(bool force)
    {
        if(disposed)return;
        double mono=clock.Elapsed.TotalMilliseconds;bool? game=ForegroundGameProbe.Read();
        var requirement=mono-sampleAt<=3000?ForegroundAlertPolicy.FromState(sample,DateTime.UtcNow):null;
        var alert=policy.Update(requirement,game,soundEnabled,mono);
        if(game==true)previewUntil=0;
        if(previewUntil>mono)alert=new ForegroundAlertView{Active=true,Key="preview",Title="AVISO DE FARMDOGS",Detail="Así te avisará FarmDogs cuando necesites poner Wardogs en primer plano. Este ejemplo se cierra en tres segundos."};
        else if(alert.PlaySound)PlaySound();
        if(alert.Active)
        {
            if(notice==null){notice=new ForegroundNoticeForm();notice.Dismissed+=()=>{previewUntil=0;policy.Dismiss();Pulse(true);};}
            notice.Display(alert,Screen.FromControl(owner));
        }
        else if(notice!=null&&notice.Visible)notice.Hide();
        var message=new{kind="host_foreground_status",supported=true,known=game.HasValue,gameForeground=game==true,soundEnabled=soundEnabled,alert=new{active=alert.Active,key=alert.Key,title=alert.Title,detail=alert.Detail}};
        string serialized=json.Serialize(message);
        if(force||serialized!=lastPublished||mono-lastPublish>=1000){lastPublished=serialized;lastPublish=mono;try{publish(message);}catch{}}
    }
    public void Dispose()
    {
        if(disposed)return;disposed=true;timer.Stop();timer.Dispose();client.Dispose();if(notice!=null)notice.Dispose();clock.Stop();
    }
}
