using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

// Bounded, one-shot product helper. Never activates a window or uses the clipboard.
internal sealed class EntryBounds { public double x,y,width,height; }
internal sealed class EntryAction
{
    public string format,id,sessionId,issuedAt,expiresAt,endAt,frameId,framePath,frameSha256,frameCapturedAt,kind,joinId,control;
    public double gamePid,width,height;
    public object gameWindow;
    public EntryBounds bounds,anchorBounds;
}
internal sealed class EntryWindow
{
    public int Pid,Width,Height,OriginX,OriginY;
    public long Handle;
}
internal sealed class EntryFailure : Exception
{
    public readonly string Status,Reason;
    public EntryFailure(string status,string reason):base(reason){Status=status;Reason=reason;}
}
internal interface IEntryPlatform
{
    DateTime UtcNow {get;}
    long ElapsedMilliseconds {get;}
    bool StopRequested();
    bool ModifiersDown();
    EntryWindow ForegroundGame();
    bool PointBelongs(EntryWindow window,Point clientPoint);
    Bitmap CapturePatch(EntryWindow window,Rectangle bounds);
    bool MainDeployReady(EntryWindow window);
    void MoveCursor(EntryWindow window,Point clientPoint);
    void Click();
    void PressStart();
    void SelectAll();
    void TypeCharacter(char value);
    void ReleasePending();
}
internal static class GameEntryPolicy
{
    internal static readonly Regex Uuid=new Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",RegexOptions.IgnoreCase|RegexOptions.CultureInvariant);
    internal static void Reject(bool condition,string reason){if(condition)throw new EntryFailure("rejected",reason);}
    internal static DateTime Time(string value)
    {
        DateTimeOffset parsed=DateTimeOffset.MinValue;
        Reject(value==null||!Regex.IsMatch(value,"(?:Z|\\+00:00)$",RegexOptions.CultureInvariant)||!DateTimeOffset.TryParse(value,CultureInfo.InvariantCulture,DateTimeStyles.None,out parsed),"invalid_timestamp");
        DateTimeOffset.TryParse(value,CultureInfo.InvariantCulture,DateTimeStyles.None,out parsed);
        Reject(parsed.Offset!=TimeSpan.Zero,"invalid_timestamp");return parsed.UtcDateTime;
    }
    internal static long WindowHandle(object value)
    {
        long handle=0;Reject(value==null||!Int64.TryParse(Convert.ToString(value,CultureInfo.InvariantCulture),NumberStyles.None,CultureInfo.InvariantCulture,out handle),"invalid_window");
        Int64.TryParse(Convert.ToString(value,CultureInfo.InvariantCulture),NumberStyles.None,CultureInfo.InvariantCulture,out handle);
        Reject(handle<=0,"invalid_window");return handle;
    }
    internal static bool Integer(double number,int min,int max){return !Double.IsNaN(number)&&!Double.IsInfinity(number)&&number>=min&&number<=max&&Math.Floor(number)==number;}
    internal static Rectangle Target(EntryAction command)
    {
        EntryBounds b=command.bounds;Reject(b==null,"invalid_bounds");
        double[] values={b.x,b.y,b.width,b.height};foreach(double value in values)Reject(Double.IsNaN(value)||Double.IsInfinity(value),"invalid_bounds");
        Reject(b.x<0||b.y<0||b.width<4||b.height<4||b.x+b.width>command.width||b.y+b.height>command.height||b.width*b.height>command.width*command.height*.4,"invalid_bounds");
        int left=(int)Math.Floor(b.x),top=(int)Math.Floor(b.y),right=(int)Math.Ceiling(b.x+b.width),bottom=(int)Math.Ceiling(b.y+b.height);
        Reject(right>(int)command.width||bottom>(int)command.height,"invalid_bounds");return Rectangle.FromLTRB(left,top,right,bottom);
    }
    internal static Rectangle Anchor(EntryAction command)
    {
        if(command.anchorBounds==null)return Target(command);
        Reject(command.kind!="replace_join_id","invalid_anchor");
        EntryBounds original=command.bounds;Rectangle anchor;
        try{command.bounds=command.anchorBounds;anchor=Target(command);}finally{command.bounds=original;}
        Rectangle target=Target(command);
        Reject(target.Top<anchor.Bottom||target.Top-anchor.Bottom>command.height*.15||target.Left<anchor.Left-command.width*.1||target.Left>anchor.Right+command.width*.1,"invalid_anchor");
        return anchor;
    }
    internal static void Validate(EntryAction command,string commandFile,DateTime now)
    {
        Reject(command==null||command.format!="farmdogs-entry-action-v1","invalid_format");
        Reject(command.id==null||!Uuid.IsMatch(command.id)||command.sessionId==null||!Uuid.IsMatch(command.sessionId)||command.frameId==null||!Uuid.IsMatch(command.frameId),"invalid_identity");
        Reject(!Integer(command.gamePid,1,Int32.MaxValue)||!Integer(command.width,320,2600)||!Integer(command.height,200,2600),"invalid_geometry");
        WindowHandle(command.gameWindow);Target(command);
        Reject(command.kind!="click"&&command.kind!="replace_join_id"&&command.kind!="press_start","invalid_action");
        bool clickControl=command.control=="main_deploy"||command.control=="community"||command.control=="join_by_id"||command.control=="lookup"||command.control=="confirm_join";
        Reject(command.control!=null&&!(clickControl&&command.kind=="click")&&!(command.control=="type_join_id"&&command.kind=="replace_join_id")&&!(command.control=="splash_continue"&&command.kind=="press_start"),"invalid_control");
        Reject(command.kind=="press_start"&&command.control!="splash_continue","invalid_control");
        if(command.kind=="press_start"){Rectangle start=Target(command);Reject(start.Left<command.width*.2||start.Right>command.width*.85||start.Top<command.height*.55||start.Bottom>command.height*.93,"invalid_control_bounds");}
        if(command.control=="main_deploy")Reject(!EntryControlVisual.MainDeployBounds((int)command.width,(int)command.height).Contains(Target(command)),"invalid_control_bounds");
        Anchor(command);
        Reject(command.kind=="replace_join_id"&&(command.joinId==null||!Uuid.IsMatch(command.joinId)),"invalid_join_id");
        Reject(command.kind!="replace_join_id"&&command.joinId!=null,"unexpected_join_id");
        Reject(command.frameSha256==null||!Regex.IsMatch(command.frameSha256,"^[a-f0-9]{64}$",RegexOptions.IgnoreCase|RegexOptions.CultureInvariant),"invalid_frame_hash");
        string root=Path.GetDirectoryName(Path.GetFullPath(commandFile));
        Reject(!String.Equals(Path.GetFileName(commandFile),"entry-action-"+command.id+".json",StringComparison.OrdinalIgnoreCase),"invalid_command_path");
        string expected=Path.Combine(root,"entry-screen-monitor","game-frame-"+command.frameId+".png");
        Reject(command.framePath==null||!Path.IsPathRooted(command.framePath)||!String.Equals(Path.GetFullPath(command.framePath),Path.GetFullPath(expected),StringComparison.OrdinalIgnoreCase),"invalid_frame_path");
        DateTime issued=Time(command.issuedAt),expires=Time(command.expiresAt),end=Time(command.endAt);
        Reject(issued>now||(now-issued).TotalMilliseconds>5000||expires<=now||expires<=issued||(expires-issued).TotalMilliseconds>3000||expires>end,"expired_command");
        if(command.frameCapturedAt!=null){DateTime captured=Time(command.frameCapturedAt);Reject(captured>issued||(now-captured).TotalMilliseconds>5000,"stale_frame");}
    }
    internal static bool Same(EntryWindow one,EntryWindow other)
    {
        return one!=null&&other!=null&&one.Pid==other.Pid&&one.Handle==other.Handle&&one.Width==other.Width&&one.Height==other.Height&&one.OriginX==other.OriginX&&one.OriginY==other.OriginY;
    }
    internal static bool PatchMatches(Bitmap expected,Bitmap actual)
    {
        if(expected==null||actual==null||expected.Width!=actual.Width||expected.Height!=actual.Height)return false;
        int step=Math.Max(1,(int)Math.Sqrt(expected.Width*expected.Height/14000.0)),anchors=0,matches=0;
        for(int y=1;y<expected.Height-1;y+=step)for(int x=1;x<expected.Width-1;x+=step)
        {
            Color refColor=expected.GetPixel(x,y);int bright=(refColor.R*3+refColor.G*6+refColor.B)/10;
            if(bright<90)continue;
            Color left=expected.GetPixel(x-1,y),right=expected.GetPixel(x+1,y),up=expected.GetPixel(x,y-1),down=expected.GetPixel(x,y+1);
            int contrast=Math.Max(Math.Max(Math.Abs(bright-(left.R*3+left.G*6+left.B)/10),Math.Abs(bright-(right.R*3+right.G*6+right.B)/10)),Math.Max(Math.Abs(bright-(up.R*3+up.G*6+up.B)/10),Math.Abs(bright-(down.R*3+down.G*6+down.B)/10)));
            if(contrast<24)continue;
            anchors++;Color current=actual.GetPixel(x,y);
            if((Math.Abs(current.R-refColor.R)+Math.Abs(current.G-refColor.G)+Math.Abs(current.B-refColor.B))/3.0<=55)matches++;
        }
        return anchors>=12&&matches>=anchors*.78;
    }
}
internal static class GameEntryFrameStore
{
    internal static Bitmap Load(EntryAction command,DateTime now)
    {
        string folder=Path.GetDirectoryName(command.framePath);
        GameEntryPolicy.Reject((File.GetAttributes(folder)&FileAttributes.ReparsePoint)!=0,"invalid_frame_path");
        var file=new FileInfo(command.framePath);
        GameEntryPolicy.Reject(!file.Exists||file.Length<8||file.Length>20*1024*1024||(file.Attributes&FileAttributes.ReparsePoint)!=0,"invalid_frame");
        GameEntryPolicy.Reject(file.LastWriteTimeUtc>now||(now-file.LastWriteTimeUtc).TotalMilliseconds>5000,"stale_frame");
        byte[] bytes=File.ReadAllBytes(file.FullName);string hash;
        using(var digest=SHA256.Create())hash=BitConverter.ToString(digest.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();
        GameEntryPolicy.Reject(!String.Equals(hash,command.frameSha256,StringComparison.OrdinalIgnoreCase),"frame_hash_mismatch");
        using(var stream=new MemoryStream(bytes,false))using(var image=Image.FromStream(stream,true,true))
        {
            GameEntryPolicy.Reject(image.RawFormat.Guid!=ImageFormat.Png.Guid||image.Width!=(int)command.width||image.Height!=(int)command.height,"invalid_frame_geometry");
            return new Bitmap(image);
        }
    }
}
internal static class GameEntryRunner
{
    internal static void Guard(EntryAction command,IEntryPlatform platform,EntryWindow acquired,Rectangle bounds)
    {
        if(platform.StopRequested())throw new EntryFailure("cancelled","operator_stop");
        GameEntryPolicy.Reject(platform.ElapsedMilliseconds>=3000||platform.UtcNow>=GameEntryPolicy.Time(command.expiresAt)||platform.UtcNow>=GameEntryPolicy.Time(command.endAt),"expired_command");
        if(command.frameCapturedAt!=null)GameEntryPolicy.Reject(platform.UtcNow<GameEntryPolicy.Time(command.frameCapturedAt)||(platform.UtcNow-GameEntryPolicy.Time(command.frameCapturedAt)).TotalMilliseconds>5000,"stale_frame");
        GameEntryPolicy.Reject(platform.ModifiersDown(),"operator_input");
        var current=platform.ForegroundGame();GameEntryPolicy.Reject(current==null,"game_not_foreground");
        GameEntryPolicy.Reject(!GameEntryPolicy.Same(acquired,current),"game_window_changed");
        Point[] points={new Point(bounds.Left+bounds.Width/2,bounds.Top+bounds.Height/2),new Point(bounds.Left,bounds.Top),new Point(bounds.Right-1,bounds.Top),new Point(bounds.Left,bounds.Bottom-1),new Point(bounds.Right-1,bounds.Bottom-1)};
        foreach(Point point in points)GameEntryPolicy.Reject(!platform.PointBelongs(acquired,point),"cursor_obstructed");
    }
    internal static void Run(EntryAction command,IEntryPlatform platform,Bitmap frame)
    {
        if(platform.StopRequested())throw new EntryFailure("cancelled","operator_stop");
        Rectangle bounds=GameEntryPolicy.Target(command);var window=platform.ForegroundGame();
        GameEntryPolicy.Reject(window==null,"game_not_foreground");
        GameEntryPolicy.Reject(window.Pid!=(int)command.gamePid||window.Handle!=GameEntryPolicy.WindowHandle(command.gameWindow)||window.Width!=(int)command.width||window.Height!=(int)command.height,"game_window_changed");
        bool attempted=false;
        try
        {
            Guard(command,platform,window,bounds);
            if(command.control=="main_deploy")GameEntryPolicy.Reject(!EntryControlVisual.MainDeploy(frame).enabled,"main_deploy_disabled");
            Rectangle anchor=GameEntryPolicy.Anchor(command);
            using(var expected=frame.Clone(anchor,PixelFormat.Format32bppArgb))using(var actual=platform.CapturePatch(window,anchor))
                GameEntryPolicy.Reject(!GameEntryPolicy.PatchMatches(expected,actual),"stale_target");
            Guard(command,platform,window,bounds);
            if(command.kind=="press_start")
            {
                attempted=true;platform.PressStart();Guard(command,platform,window,bounds);return;
            }
            platform.MoveCursor(window,new Point(bounds.Left+bounds.Width/2,bounds.Top+bounds.Height/2));
            Guard(command,platform,window,bounds);
            if(command.control=="main_deploy")GameEntryPolicy.Reject(!platform.MainDeployReady(window),"main_deploy_disabled");
            Guard(command,platform,window,bounds);attempted=true;platform.Click();
            if(command.kind=="replace_join_id")
            {
                Guard(command,platform,window,bounds);platform.SelectAll();
                foreach(char value in command.joinId){Guard(command,platform,window,bounds);platform.TypeCharacter(value);}
            }
        }
        finally{if(attempted)platform.ReleasePending();}
    }
}
internal static class EntryPointerGeometry
{
    internal static Point Absolute(Point target,Rectangle virtualDesktop)
    {
        GameEntryPolicy.Reject(virtualDesktop.Width<2||virtualDesktop.Height<2||!virtualDesktop.Contains(target),"cursor_outside_desktop");
        // SendInput maps normalized coordinates over the entire virtual desktop.
        // Address pixel centers so negative monitor origins and right/bottom
        // edges do not land in an adjacent physical pixel.
        int x=(int)Math.Floor((target.X-(double)virtualDesktop.Left+.5)*65536/virtualDesktop.Width);
        int y=(int)Math.Floor((target.Y-(double)virtualDesktop.Top+.5)*65536/virtualDesktop.Height);
        return new Point(Math.Max(0,Math.Min(65535,x)),Math.Max(0,Math.Min(65535,y)));
    }
}
internal sealed class GameEntryNative : IEntryPlatform
{
    [StructLayout(LayoutKind.Sequential)] private struct RECT {public int Left,Top,Right,Bottom;}
    [StructLayout(LayoutKind.Sequential)] private struct POINT {public int X,Y;public POINT(int x,int y){X=x;Y=y;}}
    [StructLayout(LayoutKind.Sequential)] private struct MOUSEINPUT {public int dx,dy;public uint mouseData,flags,time;public UIntPtr extra;}
    [StructLayout(LayoutKind.Sequential)] private struct KEYBDINPUT {public ushort vk,scan;public uint flags,time;public UIntPtr extra;}
    [StructLayout(LayoutKind.Explicit)] private struct UNION {[FieldOffset(0)]public MOUSEINPUT mouse;[FieldOffset(0)]public KEYBDINPUT keyboard;}
    [StructLayout(LayoutKind.Sequential)] private struct INPUT {public uint type;public UNION data;}
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr h,out RECT rect);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr h,ref POINT point);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window,uint flags);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll",SetLastError=true)] private static extern uint SendInput(uint count,INPUT[] inputs,int size);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    private readonly Stopwatch clock;
    private bool pendingMouse,pendingChord,pendingStart;private char? pendingCharacter;
    internal GameEntryNative(Stopwatch actionClock){clock=actionClock;if(!SetProcessDPIAware())throw new EntryFailure("rejected","dpi_unavailable");}
    public DateTime UtcNow {get{return DateTime.UtcNow;}}
    public long ElapsedMilliseconds {get{return clock.ElapsedMilliseconds;}}
    private static bool Down(int key){return(GetAsyncKeyState(key)&0x8000)!=0;}
    public bool StopRequested(){return GetAsyncKeyState(0x77)!=0;}
    public bool ModifiersDown(){return Down(0x10)||Down(0x11)||Down(0x12)||Down(0x5b)||Down(0x5c)||Down(1)||Down(2)||Down(4);}
    public EntryWindow ForegroundGame()
    {
        try
        {
            var resolved=GameWindowResolver.ResolveForeground();if(resolved==null||resolved.Width<320||resolved.Height<200||resolved.Width>2600||resolved.Height>2600)return null;
            return new EntryWindow {Pid=resolved.Pid,Handle=resolved.Window,Width=resolved.Width,Height=resolved.Height,OriginX=resolved.OriginX,OriginY=resolved.OriginY};
        }catch{return null;}
    }
    public bool PointBelongs(EntryWindow window,Point clientPoint)
    {
        if(!GameEntryPolicy.Same(window,ForegroundGame()))return false;
        var hit=WindowFromPoint(new POINT(window.OriginX+clientPoint.X,window.OriginY+clientPoint.Y));uint pid;GetWindowThreadProcessId(hit,out pid);
        return hit!=IntPtr.Zero&&pid==window.Pid&&(hit.ToInt64()==window.Handle||GetAncestor(hit,2).ToInt64()==window.Handle);
    }
    public Bitmap CapturePatch(EntryWindow window,Rectangle bounds)
    {
        if(!GameEntryPolicy.Same(window,ForegroundGame()))throw new EntryFailure("rejected","game_window_changed");
        var image=new Bitmap(bounds.Width,bounds.Height,PixelFormat.Format32bppArgb);
        try{using(var graphics=Graphics.FromImage(image))graphics.CopyFromScreen(window.OriginX+bounds.X,window.OriginY+bounds.Y,0,0,bounds.Size,CopyPixelOperation.SourceCopy);
            if(!GameEntryPolicy.Same(window,ForegroundGame()))throw new EntryFailure("rejected","game_window_changed");return image;}
        catch{image.Dispose();throw;}
    }
    public void MoveCursor(EntryWindow window,Point clientPoint)
    {
        if(!PointBelongs(window,clientPoint))throw new EntryFailure("rejected","cursor_obstructed");
        Point target=new Point(window.OriginX+clientPoint.X,window.OriginY+clientPoint.Y);
        Rectangle desktop=new Rectangle(GetSystemMetrics(76),GetSystemMetrics(77),GetSystemMetrics(78),GetSystemMetrics(79));
        Point absolute=EntryPointerGeometry.Absolute(target,desktop);
        var movement=new INPUT();movement.data.mouse.dx=absolute.X;movement.data.mouse.dy=absolute.Y;movement.data.mouse.flags=0x0001u|0x8000u|0x4000u;
        Send(new[]{movement});
        // Allow the game's UI to observe the pointer before the executor's next
        // focus/patch/cancellation guard and button-down.
        Thread.Sleep(35);
        POINT actual;if(!GetCursorPos(out actual)||Math.Abs(actual.X-target.X)>1||Math.Abs(actual.Y-target.Y)>1||!PointBelongs(window,clientPoint))throw new EntryFailure("rejected","cursor_position_unconfirmed");
    }
    public bool MainDeployReady(EntryWindow window)
    {
        Rectangle bounds=EntryControlVisual.MainDeployBounds(window.Width,window.Height);
        using(var patch=CapturePatch(window,bounds))return EntryControlVisual.MainDeployPanel(patch,bounds).enabled;
    }
    private static INPUT Mouse(bool up){var input=new INPUT();input.data.mouse.flags=up?0x0004u:0x0002u;return input;}
    private static INPUT Key(ushort key,bool up,bool unicode){var input=new INPUT();input.type=1;input.data.keyboard.vk=unicode?(ushort)0:key;input.data.keyboard.scan=unicode?key:(ushort)0;input.data.keyboard.flags=(unicode?0x0004u:0u)|(up?0x0002u:0u);return input;}
    private static void Send(INPUT[] inputs){if(SendInput((uint)inputs.Length,inputs,Marshal.SizeOf(typeof(INPUT)))!=inputs.Length)throw new EntryFailure("error","input_rejected");}
    public void Click(){pendingMouse=true;try{Send(new[]{Mouse(false)});Thread.Sleep(35);Send(new[]{Mouse(true)});pendingMouse=false;}finally{try{Send(new[]{Mouse(true)});pendingMouse=false;}catch{}}}
    public void PressStart(){pendingStart=true;try{Send(new[]{Key(0x20,false,false)});Thread.Sleep(35);Send(new[]{Key(0x20,true,false)});pendingStart=false;}finally{try{Send(new[]{Key(0x20,true,false)});pendingStart=false;}catch{}}}
    public void SelectAll(){pendingChord=true;try{Send(new[]{Key(0x11,false,false),Key(0x41,false,false),Key(0x41,true,false),Key(0x11,true,false)});pendingChord=false;}finally{try{Send(new[]{Key(0x41,true,false),Key(0x11,true,false)});pendingChord=false;}catch{}}}
    public void TypeCharacter(char value){pendingCharacter=value;try{Send(new[]{Key(value,false,true),Key(value,true,true)});pendingCharacter=null;}finally{try{Send(new[]{Key(value,true,true)});pendingCharacter=null;}catch{}}}
    public void ReleasePending()
    {
        if(pendingMouse)try{Send(new[]{Mouse(true)});pendingMouse=false;}catch{}
        if(pendingChord)try{Send(new[]{Key(0x41,true,false),Key(0x11,true,false)});pendingChord=false;}catch{}
        if(pendingCharacter.HasValue)try{Send(new[]{Key(pendingCharacter.Value,true,true)});pendingCharacter=null;}catch{}
        if(pendingStart)try{Send(new[]{Key(0x20,true,false)});pendingStart=false;}catch{}
        if(pendingMouse||pendingChord||pendingStart||pendingCharacter.HasValue)throw new EntryFailure("error","input_release_failed");
    }
}
internal sealed class EntryWatchDecision
{
    internal string Status,Reason;
    internal EntryWatchDecision(string status,string reason){Status=status;Reason=reason;}
}
internal static class GameEntryWatchPolicy
{
    internal static EntryWatchDecision Decide(bool stopKey,bool stopFile,bool serviceAlive,DateTime now,DateTime end,long elapsedMilliseconds,long budgetMilliseconds)
    {
        if(stopKey)return new EntryWatchDecision("cancelled","operator_stop");
        if(stopFile)return new EntryWatchDecision("closed","watch_stopped");
        if(!serviceAlive)return new EntryWatchDecision("closed","service_closed");
        if(now>=end||elapsedMilliseconds>=budgetMilliseconds)return new EntryWatchDecision("closed","deadline_reached");
        return new EntryWatchDecision("watching",null);
    }
    internal static string Validate(string file,string endValue,string serviceValue,DateTime now,out DateTime end,out int servicePid)
    {
        string actual=Path.GetFullPath(file),name=Path.GetFileName(actual),prefix="entry-watch-";
        GameEntryPolicy.Reject(!name.StartsWith(prefix,StringComparison.Ordinal)||!name.EndsWith(".json",StringComparison.Ordinal),"invalid_watch_path");
        string session=name.Substring(prefix.Length,name.Length-prefix.Length-5);
        GameEntryPolicy.Reject(!GameEntryPolicy.Uuid.IsMatch(session)||actual.StartsWith("\\\\",StringComparison.Ordinal),"invalid_watch_path");
        end=GameEntryPolicy.Time(endValue);servicePid=0;
        GameEntryPolicy.Reject(end<=now||(end-now).TotalMinutes>720,"invalid_watch_deadline");
        GameEntryPolicy.Reject(!Int32.TryParse(serviceValue,NumberStyles.None,CultureInfo.InvariantCulture,out servicePid)||servicePid<=0,"invalid_service_pid");
        return session;
    }
}
internal static class GameEntryWatch
{
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    private static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
    private static void Write(string file,object report,bool initial)
    {
        string temporary=file+".next-"+Guid.NewGuid().ToString("N");
        try
        {
            File.WriteAllText(temporary,Json.Serialize(report),new UTF8Encoding(false));
            for(int attempt=0;;attempt++)
            {
                try{if(initial)File.Move(temporary,file);else File.Replace(temporary,file,null);return;}
                catch(IOException){if(attempt>=3)throw;Thread.Sleep(10);}
            }
        }
        finally{if(File.Exists(temporary))File.Delete(temporary);}
    }
    private static bool Alive(int pid,DateTime started)
    {
        try{using(var process=Process.GetProcessById(pid))return !process.HasExited&&process.StartTime.ToUniversalTime()==started;}
        catch{return false;}
    }
    internal static int Run(string[] args)
    {
        try
        {
            string file=Path.GetFullPath(args[1]);DateTime started=DateTime.UtcNow,end;int servicePid;
            string session=GameEntryWatchPolicy.Validate(file,args[2],args[3],started,out end,out servicePid);
            GameEntryPolicy.Reject(!Directory.Exists(Path.GetDirectoryName(file))||(File.GetAttributes(Path.GetDirectoryName(file))&FileAttributes.ReparsePoint)!=0||File.Exists(file),"invalid_watch_path");
            DateTime processStarted=DateTime.MinValue;
            try{using(var process=Process.GetProcessById(servicePid))processStarted=process.StartTime.ToUniversalTime();}catch{}
            var clock=Stopwatch.StartNew();long budget=(long)(end-started).TotalMilliseconds,lastWrite=0;
            Write(file,new {format="farmdogs-entry-watch-v1",sessionId=session,servicePid,status="watching",reason=(string)null,at=started.ToString("o"),startedAt=started.ToString("o"),endAt=end.ToString("o")},true);
            while(true)
            {
                DateTime now=DateTime.UtcNow;bool stop=(GetAsyncKeyState(0x77)&0x8001)!=0;
                EntryWatchDecision decision=GameEntryWatchPolicy.Decide(stop,File.Exists(file+".stop"),Alive(servicePid,processStarted),now,end,clock.ElapsedMilliseconds,budget);
                if(decision.Status!="watching"||clock.ElapsedMilliseconds-lastWrite>=1000)
                {
                    GameEntryPolicy.Reject(!File.Exists(file)||(File.GetAttributes(file)&FileAttributes.ReparsePoint)!=0,"invalid_watch_path");
                    Write(file,new {format="farmdogs-entry-watch-v1",sessionId=session,servicePid,status=decision.Status,reason=decision.Reason,at=now.ToString("o"),startedAt=started.ToString("o"),endAt=end.ToString("o")},false);
                    lastWrite=clock.ElapsedMilliseconds;
                }
                if(decision.Status!="watching")return 0;
                Thread.Sleep(25);
            }
        }
        catch(EntryFailure failure){Console.Error.WriteLine(failure.Reason);return 1;}
        catch{Console.Error.WriteLine("entry_watch_failed");return 1;}
    }
}
internal sealed class EntryFocusWindow
{
    internal int Pid;internal long Handle;internal string ProcessName;internal bool Visible,Minimized;
}
internal sealed class EntryFocusOutcome
{
    internal bool Found,Focused;internal string Reason;internal EntryFocusWindow Window;
}
internal interface IEntryFocusPlatform
{
    bool StopRequested();bool ServiceAlive();EntryFocusWindow[] Windows();
    bool Valid(EntryFocusWindow window);bool Foreground(EntryFocusWindow window);
    void Restore(EntryFocusWindow window);bool Focus(EntryFocusWindow window);
}
internal static class GameEntryFocusPolicy
{
    private static EntryFocusOutcome Result(bool found,bool focused,string reason,EntryFocusWindow window){return new EntryFocusOutcome {Found=found,Focused=focused,Reason=reason,Window=window};}
    internal static EntryFocusOutcome Run(IEntryFocusPlatform platform)
    {
        if(platform.StopRequested())return Result(false,false,"operator_stop",null);
        if(!platform.ServiceAlive())return Result(false,false,"service_closed",null);
        var eligible=new List<EntryFocusWindow>();
        foreach(var window in platform.Windows())if(window!=null&&window.ProcessName=="WardogsClient-Win64-Shipping"&&window.Pid>0&&window.Handle>0&&(window.Visible||window.Minimized))eligible.Add(window);
        if(eligible.Count!=1)return Result(false,false,eligible.Count==0?"game_window_not_found":"ambiguous_game_windows",null);
        var selected=eligible[0];
        if(platform.StopRequested())return Result(true,false,"operator_stop",selected);
        if(!platform.ServiceAlive()||!platform.Valid(selected))return Result(true,false,"game_window_changed",selected);
        if(platform.Foreground(selected))return Result(true,true,null,selected);
        if(selected.Minimized)
        {
            platform.Restore(selected);
            if(platform.StopRequested())return Result(true,false,"operator_stop",selected);
            if(!platform.ServiceAlive()||!platform.Valid(selected))return Result(true,false,"game_window_changed",selected);
        }
        // Respect Windows' foreground lock. No input synthesis, thread attachment,
        // retries or permission changes are used when the normal API refuses.
        if(platform.StopRequested())return Result(true,false,"operator_stop",selected);
        if(!platform.ServiceAlive()||!platform.Valid(selected))return Result(true,false,"game_window_changed",selected);
        if(!platform.Foreground(selected))platform.Focus(selected);
        bool focused=platform.Foreground(selected);return Result(true,focused,focused?null:"foreground_refused",selected);
    }
}
internal sealed class GameEntryFocusNative : IEntryFocusPlatform
{
    private delegate bool EnumCallback(IntPtr window,IntPtr value);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumCallback callback,IntPtr value);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window,uint relation);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window,int mode);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    private readonly int servicePid;private readonly DateTime serviceStarted,endAt;private readonly string watchFile,sessionId;
    internal GameEntryFocusNative(int pid,string directory,string session,DateTime end)
    {
        servicePid=pid;sessionId=session;endAt=end;watchFile=Path.Combine(directory,"entry-watch-"+session+".json");
        using(var process=Process.GetProcessById(pid))serviceStarted=process.StartTime.ToUniversalTime();
    }
    public bool StopRequested()
    {
        if((GetAsyncKeyState(0x77)&0x8001)!=0)return true;
        var file=new FileInfo(watchFile);if(!file.Exists||file.Length>16384||(file.Attributes&FileAttributes.ReparsePoint)!=0)throw new EntryFailure("rejected","watcher_unavailable");
        var report=new JavaScriptSerializer().DeserializeObject(File.ReadAllText(watchFile)) as Dictionary<string,object>;object format,id,pid,status,at,reason;
        if(report==null||!report.TryGetValue("format",out format)||(format as string)!="farmdogs-entry-watch-v1"||!report.TryGetValue("sessionId",out id)||(id as string)!=sessionId||!report.TryGetValue("servicePid",out pid)||Convert.ToInt32(pid)!=servicePid||!report.TryGetValue("status",out status)||!report.TryGetValue("at",out at))throw new EntryFailure("rejected","watcher_unavailable");
        if((status as string)=="cancelled"&&report.TryGetValue("reason",out reason)&&(reason as string)=="operator_stop")return true;
        DateTime timestamp=GameEntryPolicy.Time(at as string);double age=(DateTime.UtcNow-timestamp).TotalMilliseconds;
        if((status as string)!="watching"||age<0||age>3000||File.Exists(watchFile+".stop"))throw new EntryFailure("rejected","watcher_unavailable");
        return false;
    }
    public bool ServiceAlive(){try{using(var process=Process.GetProcessById(servicePid))return !process.HasExited&&process.StartTime.ToUniversalTime()==serviceStarted&&DateTime.UtcNow<endAt;}catch{return false;}}
    private static EntryFocusWindow Read(IntPtr window)
    {
        try
        {
            uint pid;GetWindowThreadProcessId(window,out pid);if(pid==0||GetWindow(window,4)!=IntPtr.Zero)return null;
            using(var process=Process.GetProcessById((int)pid))if(process.HasExited||process.ProcessName!="WardogsClient-Win64-Shipping")return null;
            return new EntryFocusWindow {Pid=(int)pid,Handle=window.ToInt64(),ProcessName="WardogsClient-Win64-Shipping",Visible=IsWindowVisible(window),Minimized=IsIconic(window)};
        }catch{return null;}
    }
    public EntryFocusWindow[] Windows(){var result=new List<EntryFocusWindow>();if(!EnumWindows((window,unused)=>{var item=Read(window);if(item!=null)result.Add(item);return true;},IntPtr.Zero))throw new EntryFailure("rejected","windows_unavailable");return result.ToArray();}
    public bool Valid(EntryFocusWindow window){var current=Read(new IntPtr(window.Handle));return current!=null&&current.Pid==window.Pid&&(current.Visible||current.Minimized);}
    public bool Foreground(EntryFocusWindow window){return Valid(window)&&GetForegroundWindow().ToInt64()==window.Handle;}
    public void Restore(EntryFocusWindow window){if(!Valid(window))throw new EntryFailure("rejected","game_window_changed");ShowWindow(new IntPtr(window.Handle),9);}
    public bool Focus(EntryFocusWindow window){return Valid(window)&&SetForegroundWindow(new IntPtr(window.Handle));}
}
internal static class GameEntryFocus
{
    internal static int Run(string[] args)
    {
        string file=null,session=null;bool outputAllowed=false;var outcome=new EntryFocusOutcome {Reason="invalid_focus_request"};
        try
        {
            file=Path.GetFullPath(args[1]);string name=Path.GetFileName(file),prefix="entry-focus-";
            GameEntryPolicy.Reject(!name.StartsWith(prefix,StringComparison.Ordinal)||!name.EndsWith(".json",StringComparison.Ordinal),"invalid_focus_path");
            session=name.Substring(prefix.Length,name.Length-prefix.Length-5);GameEntryPolicy.Reject(!GameEntryPolicy.Uuid.IsMatch(session),"invalid_focus_path");
            string folder=Path.GetDirectoryName(file);GameEntryPolicy.Reject(!Directory.Exists(folder)||(File.GetAttributes(folder)&FileAttributes.ReparsePoint)!=0||(File.Exists(file)&&(File.GetAttributes(file)&FileAttributes.ReparsePoint)!=0),"invalid_focus_path");outputAllowed=true;
            DateTime end;int pid;GameEntryWatchPolicy.Validate(Path.Combine(folder,"entry-watch-"+session+".json"),args[2],args[3],DateTime.UtcNow,out end,out pid);
            if(File.Exists(file))
            {
                var previous=new FileInfo(file);GameEntryPolicy.Reject(previous.Length>16384,"invalid_focus_path");
                var report=new JavaScriptSerializer().DeserializeObject(File.ReadAllText(file)) as Dictionary<string,object>;object format,id,found;
                if(report!=null&&report.TryGetValue("format",out format)&&(format as string)=="farmdogs-entry-focus-v1"&&report.TryGetValue("sessionId",out id)&&(id as string)==session&&report.TryGetValue("found",out found)&&found is bool&&(bool)found)return 0;
            }
            outcome=GameEntryFocusPolicy.Run(new GameEntryFocusNative(pid,folder,session,end));
        }
        catch(EntryFailure failure){outcome.Reason=failure.Reason;}
        catch{outcome.Reason="focus_observation_failed";}
        if(!outputAllowed){Console.Error.WriteLine(outcome.Reason);return 1;}
        try{File.WriteAllText(file,new JavaScriptSerializer().Serialize(new {format="farmdogs-entry-focus-v1",sessionId=session,at=DateTime.UtcNow.ToString("o"),found=outcome.Found,focused=outcome.Focused,gamePid=outcome.Window==null?(int?)null:outcome.Window.Pid,gameWindow=outcome.Window==null?(long?)null:outcome.Window.Handle,reason=outcome.Reason}),new UTF8Encoding(false));return 0;}
        catch{Console.Error.WriteLine("focus_result_write_failed");return 1;}
    }
}
internal static class GameEntryProgram
{
    private static readonly JavaScriptSerializer Json=new JavaScriptSerializer {MaxJsonLength=65536};
    internal static bool OutputAllowed(string commandFile,string resultFile,string id)
    {
        try
        {
            if(id==null||!GameEntryPolicy.Uuid.IsMatch(id))return false;
            string command=Path.GetFullPath(commandFile),result=Path.GetFullPath(resultFile),name=Path.GetFileName(result);
            return String.Equals(Path.GetDirectoryName(command),Path.GetDirectoryName(result),StringComparison.OrdinalIgnoreCase)&&
                (String.Equals(name,"entry-result-"+id+".json",StringComparison.OrdinalIgnoreCase)||String.Equals(name,"entry-action-"+id+".result.json",StringComparison.OrdinalIgnoreCase))&&
                !String.Equals(command,result,StringComparison.OrdinalIgnoreCase)&&(!File.Exists(result)||(File.GetAttributes(result)&FileAttributes.ReparsePoint)==0);
        }catch{return false;}
    }
    public static int Main(string[] args)
    {
        var actionClock=Stopwatch.StartNew();
        if(args.Length==1&&args[0]=="--probe"){Console.WriteLine(Json.Serialize(new {format="farmdogs-entry-capabilities-v1",automaticEntry=true,oneShot=true,stopKey="F8",stopWatcher=true,initialFocus=true,mainDeployGate=true,splashKeyStart=true,absolutePointer=true,maxActionMilliseconds=3000}));return 0;}
        if(args.Length==4&&args[0]=="--focus-game")return GameEntryFocus.Run(args);
        if(args.Length==4&&args[0]=="--watch")return GameEntryWatch.Run(args);
        if(args.Length!=3||args[0]!="--execute"){Console.Error.WriteLine("Usage: WardogsEntry.exe --execute command.json result.json");return 1;}
        EntryAction command=null;string status="rejected",reason="invalid_command";bool success=false;
        try
        {
            string commandPath=Path.GetFullPath(args[1]);var file=new FileInfo(commandPath);
            GameEntryPolicy.Reject(!file.Exists||file.Length>65536||(file.Attributes&FileAttributes.ReparsePoint)!=0,"invalid_command");
            GameEntryPolicy.Reject((File.GetAttributes(file.DirectoryName)&FileAttributes.ReparsePoint)!=0,"invalid_command_path");
            command=Json.Deserialize<EntryAction>(File.ReadAllText(commandPath));GameEntryPolicy.Validate(command,commandPath,DateTime.UtcNow);
            GameEntryPolicy.Reject(!OutputAllowed(commandPath,args[2],command.id),"invalid_result_path");
            using(var mutex=new Mutex(false,"Local\\FarmDogsEntryAction"))
            {
                bool owns=false;try
                {
                    try{owns=mutex.WaitOne(0);}catch(AbandonedMutexException){owns=true;}
                    GameEntryPolicy.Reject(!owns,"entry_busy");
                    using(var frame=GameEntryFrameStore.Load(command,DateTime.UtcNow))
                    {
                        try{using(var used=new FileStream(commandPath+".claimed",FileMode.CreateNew,FileAccess.Write,FileShare.None)){byte[] marker=Encoding.ASCII.GetBytes(DateTime.UtcNow.ToString("o"));used.Write(marker,0,marker.Length);}}
                        catch(IOException){throw new EntryFailure("rejected","replayed_command");}
                        var platform=new GameEntryNative(actionClock);GameEntryRunner.Run(command,platform,frame);
                    }
                    success=true;status="completed";reason=null;
                }
                finally{if(owns)mutex.ReleaseMutex();}
            }
        }
        catch(EntryFailure failure){status=failure.Status;reason=failure.Reason;}
        catch(Exception){status="error";reason="entry_execution_failed";}
        if(command==null||!OutputAllowed(args[1],args[2],command.id)){Console.Error.WriteLine(reason);return 1;}
        try{File.WriteAllText(Path.GetFullPath(args[2]),Json.Serialize(new {format="farmdogs-entry-result-v1",id=command.id,sessionId=command.sessionId,success,status,reason,at=DateTime.UtcNow.ToString("o")}),new UTF8Encoding(false));return 0;}
        catch{Console.Error.WriteLine("result_write_failed");return 1;}
    }
}
