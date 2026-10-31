using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

// All executor tests use a fake platform: no windows, input, activation, or game process.
internal static class GameEntryTests
{
    private static int checks;
    private static readonly DateTime Now=DateTime.UtcNow;
    private static readonly string Id="22222222-2222-4222-8222-222222222222",Session="11111111-1111-4111-8111-111111111111",FrameId="33333333-3333-4333-8333-333333333333";
    private static void Check(bool pass,string text){if(!pass)throw new Exception(text);checks++;}
    private static void Reject(Action action,string reason)
    {
        try{action();}catch(EntryFailure error){Check(error.Reason==reason,"Wrong rejection: "+error.Reason+" expected "+reason);return;}
        throw new Exception("Accepted: "+reason);
    }
    private static EntryAction Command(string root)
    {
        return new EntryAction {format="farmdogs-entry-action-v1",id=Id,sessionId=Session,issuedAt=Now.AddMilliseconds(-20).ToString("o"),expiresAt=Now.AddSeconds(2).ToString("o"),endAt=Now.AddMinutes(20).ToString("o"),gamePid=123,gameWindow="456",width=640,height=480,frameId=FrameId,framePath=Path.Combine(root,"entry-screen-monitor","game-frame-"+FrameId+".png"),frameSha256=new String('a',64),frameCapturedAt=Now.AddSeconds(-1).ToString("o"),kind="click",bounds=new EntryBounds {x=40,y=50,width=160,height=32}};
    }
    private static string CommandPath(string root){return Path.Combine(root,"entry-action-"+Id+".json");}
    private static Bitmap Image()
    {
        var frame=new Bitmap(640,480,PixelFormat.Format32bppArgb);using(var graphics=Graphics.FromImage(frame))
        {
            graphics.Clear(Color.FromArgb(20,20,20));for(int x=42;x<198;x+=8)graphics.FillRectangle(Brushes.White,x,55,3,22);
        }return frame;
    }
    private sealed class FakePlatform : IEntryPlatform
    {
        internal EntryWindow Window=new EntryWindow {Pid=123,Handle=456,Width=640,Height=480,OriginX=10,OriginY=20};
        internal bool Focus=true,Stop,Modifiers,Obstructed,ChangedPatch,FailClick,FailSelect,FailType,FailStart,DeployReady=true;
        internal int Clicks,Selects,Releases,Moves,Starts,StopAfterCharacters=-1;
        internal string Characters="";internal Bitmap Frame;internal Action OnMove,OnClick,OnSelect,OnStart;internal DateTime NowValue=Now;internal long Elapsed;internal Point LastPoint;internal Rectangle LastCapture;
        public DateTime UtcNow {get{return NowValue;}}
        public long ElapsedMilliseconds {get{return Elapsed;}}
        public bool StopRequested(){return Stop||(StopAfterCharacters>=0&&Characters.Length>=StopAfterCharacters);}
        public bool ModifiersDown(){return Modifiers;}
        public EntryWindow ForegroundGame(){return Focus?new EntryWindow {Pid=Window.Pid,Handle=Window.Handle,Width=Window.Width,Height=Window.Height,OriginX=Window.OriginX,OriginY=Window.OriginY}:null;}
        public bool PointBelongs(EntryWindow window,Point point){return !Obstructed;}
        public Bitmap CapturePatch(EntryWindow window,Rectangle bounds){LastCapture=bounds;return ChangedPatch?new Bitmap(bounds.Width,bounds.Height):Frame.Clone(bounds,PixelFormat.Format32bppArgb);}
        public bool MainDeployReady(EntryWindow window){return DeployReady;}
        public void MoveCursor(EntryWindow window,Point point){LastPoint=point;Moves++;if(OnMove!=null)OnMove();}
        public void Click(){Clicks++;if(OnClick!=null)OnClick();if(FailClick)throw new Exception("Mock input failure");}
        public void PressStart(){Starts++;if(OnStart!=null)OnStart();if(FailStart)throw new Exception("Mock start key failure");}
        public void SelectAll(){Selects++;if(OnSelect!=null)OnSelect();if(FailSelect)throw new Exception("Mock select failure");}
        public void TypeCharacter(char value){if(FailType&&Characters.Length==3)throw new Exception("Mock Unicode failure");Characters+=value;}
        public void ReleasePending(){Releases++;}
    }
    private static void Policies(string root)
    {
        EntryAction command=Command(root);GameEntryPolicy.Validate(command,CommandPath(root),Now);Check(true,"Valid command rejected");
        Action<Action<EntryAction>,string> invalid=(edit,reason)=>{var changed=Command(root);edit(changed);Reject(()=>GameEntryPolicy.Validate(changed,CommandPath(root),Now),reason);};
        invalid(c=>c.format="other","invalid_format");invalid(c=>c.id="../file","invalid_identity");invalid(c=>c.sessionId="bad","invalid_identity");invalid(c=>c.frameId="bad","invalid_identity");
        invalid(c=>c.gamePid=1.5,"invalid_geometry");invalid(c=>c.gamePid=0,"invalid_geometry");invalid(c=>c.width=2601,"invalid_geometry");invalid(c=>c.height=199,"invalid_geometry");invalid(c=>c.gameWindow="0x123","invalid_window");invalid(c=>c.gameWindow=1.5,"invalid_window");
        invalid(c=>c.kind="shell","invalid_action");invalid(c=>{c.kind="replace_join_id";c.joinId="hello;other";},"invalid_join_id");invalid(c=>c.joinId=Id,"unexpected_join_id");
        invalid(c=>c.control="other","invalid_control");invalid(c=>c.control="main_deploy","invalid_control_bounds");
        invalid(c=>{c.control="main_deploy";c.kind="replace_join_id";c.joinId=Id;},"invalid_control");
        invalid(c=>c.kind="press_start","invalid_control");invalid(c=>c.control="splash_continue","invalid_control");
        invalid(c=>{c.kind="press_start";c.control="splash_continue";},"invalid_control_bounds");
        invalid(c=>c.anchorBounds=new EntryBounds{x=40,y=20,width=160,height=20},"invalid_anchor");
        invalid(c=>{c.kind="replace_join_id";c.joinId=Id;c.anchorBounds=new EntryBounds{x=40,y=400,width=160,height=20};},"invalid_anchor");
        invalid(c=>c.bounds.x=-1,"invalid_bounds");invalid(c=>c.bounds.width=640,"invalid_bounds");invalid(c=>c.bounds.height=Double.NaN,"invalid_bounds");invalid(c=>c.bounds.width=3,"invalid_bounds");invalid(c=>c.bounds=null,"invalid_bounds");
        invalid(c=>c.frameSha256="aa","invalid_frame_hash");invalid(c=>c.framePath=Path.Combine(root,"game-frame-"+FrameId+".png"),"invalid_frame_path");invalid(c=>c.framePath=Path.Combine(root,"entry-screen-monitor","game-frame-"+Id+".png"),"invalid_frame_path");
        invalid(c=>c.issuedAt=Now.AddSeconds(1).ToString("o"),"expired_command");invalid(c=>c.issuedAt=Now.AddSeconds(-6).ToString("o"),"expired_command");invalid(c=>c.expiresAt=Now.AddMilliseconds(-1).ToString("o"),"expired_command");invalid(c=>c.expiresAt=Now.AddSeconds(4).ToString("o"),"expired_command");invalid(c=>c.endAt=Now.AddSeconds(1).ToString("o"),"expired_command");
        invalid(c=>c.issuedAt="2026-10-31T10:00:00","invalid_timestamp");invalid(c=>c.frameCapturedAt=Now.AddSeconds(-6).ToString("o"),"stale_frame");invalid(c=>c.frameCapturedAt=Now.AddSeconds(1).ToString("o"),"stale_frame");
        Reject(()=>GameEntryPolicy.Validate(Command(root),Path.Combine(root,"other.json"),Now),"invalid_command_path");
        Check(GameEntryProgram.OutputAllowed(CommandPath(root),Path.Combine(root,"entry-result-"+Id+".json"),Id),"Valid result rejected");
        Check(GameEntryProgram.OutputAllowed(CommandPath(root),Path.Combine(root,"entry-action-"+Id+".result.json"),Id),"Alternate result rejected");
        Check(!GameEntryProgram.OutputAllowed(CommandPath(root),Path.Combine(root,"elsewhere","entry-result-"+Id+".json"),Id),"Other output folder accepted");
        Check(!GameEntryProgram.OutputAllowed(CommandPath(root),CommandPath(root),Id),"Command overwrite accepted");
        var parsed=new JavaScriptSerializer().Deserialize<EntryAction>(new JavaScriptSerializer().Serialize(command));GameEntryPolicy.Validate(parsed,CommandPath(root),Now);Check(true,"JSON roundtrip failed");
        var fractional=Command(root);fractional.bounds.x=40.2;fractional.bounds.width=159.5;Check(GameEntryPolicy.Target(fractional)==new Rectangle(40,50,160,32),"OCR float bounding changed");
        string[,] controls={{"main_deploy","click"},{"community","click"},{"join_by_id","click"},{"lookup","click"},{"confirm_join","click"},{"type_join_id","replace_join_id"},{"splash_continue","press_start"}};
        for(int index=0;index<controls.GetLength(0);index++)
        {
            var controlled=Command(root);controlled.control=controls[index,0];controlled.kind=controls[index,1];
            if(controlled.kind=="replace_join_id")controlled.joinId=Id;
            if(controlled.control=="main_deploy")controlled.bounds=new EntryBounds{x=40,y=350,width=70,height=20};
            if(controlled.control=="splash_continue")controlled.bounds=new EntryBounds{x=200,y=350,width=240,height=24};
            GameEntryPolicy.Validate(controlled,CommandPath(root),Now);Check(true,"Valid control pair rejected: "+controlled.control);
            string correctKind=controlled.kind;
            foreach(string wrongKind in new[]{"click","replace_join_id","press_start"})
            {
                if(wrongKind==correctKind)continue;
                controlled.kind=wrongKind;Reject(()=>GameEntryPolicy.Validate(controlled,CommandPath(root),Now),"invalid_control");
            }
        }
        var legacyText=Command(root);legacyText.kind="replace_join_id";legacyText.joinId=Id;GameEntryPolicy.Validate(legacyText,CommandPath(root),Now);Check(true,"Null control rejected for legacy replace_join_id");
    }
    private static void Frames(string root)
    {
        var command=Command(root);Directory.CreateDirectory(Path.GetDirectoryName(command.framePath));
        using(var image=Image())image.Save(command.framePath,ImageFormat.Png);File.SetLastWriteTimeUtc(command.framePath,Now.AddMilliseconds(-200));
        using(var digest=SHA256.Create())command.frameSha256=BitConverter.ToString(digest.ComputeHash(File.ReadAllBytes(command.framePath))).Replace("-","").ToLowerInvariant();
        using(var loaded=GameEntryFrameStore.Load(command,Now)){Check(loaded.Width==640&&loaded.Height==480,"PNG not loaded");}
        string correct=command.frameSha256;command.frameSha256=new String('f',64);Reject(()=>{using(var loaded=GameEntryFrameStore.Load(command,Now)){}},"frame_hash_mismatch");command.frameSha256=correct;
        command.width=641;Reject(()=>{using(var loaded=GameEntryFrameStore.Load(command,Now)){}},"invalid_frame_geometry");command.width=640;
        File.SetLastWriteTimeUtc(command.framePath,Now.AddSeconds(-6));Reject(()=>{using(var loaded=GameEntryFrameStore.Load(command,Now)){}},"stale_frame");
        File.SetLastWriteTimeUtc(command.framePath,Now.AddSeconds(1));Reject(()=>{using(var loaded=GameEntryFrameStore.Load(command,Now)){}},"stale_frame");
        using(var image=Image())using(var expected=image.Clone(new Rectangle(40,50,160,32),PixelFormat.Format32bppArgb))using(var same=new Bitmap(expected))using(var blank=new Bitmap(160,32))
        {
            Check(GameEntryPolicy.PatchMatches(expected,same),"Matching OCR label rejected");Check(!GameEntryPolicy.PatchMatches(expected,blank),"Missing OCR label accepted");Check(!GameEntryPolicy.PatchMatches(blank,blank),"Uniform blank patch accepted");
        }
        using(var gray=new Bitmap(160,32))using(var blank=new Bitmap(160,32))
        {
            using(var graphics=Graphics.FromImage(gray))using(var brush=new SolidBrush(Color.FromArgb(115,115,115))){graphics.Clear(Color.FromArgb(20,20,20));for(int x=2;x<158;x+=8)graphics.FillRectangle(brush,x,5,3,22);}
            using(var same=new Bitmap(gray))Check(GameEntryPolicy.PatchMatches(gray,same),"Contrasting gray label rejected");
            Check(!GameEntryPolicy.PatchMatches(gray,blank),"Missing gray label accepted");
            using(var graphics=Graphics.FromImage(blank))graphics.Clear(Color.FromArgb(115,115,115));Check(!GameEntryPolicy.PatchMatches(blank,blank),"Uniform gray patch accepted");
        }
    }
    private static void Executor(string root)
    {
        using(var image=Image())
        {
            var command=Command(root);var fake=new FakePlatform {Frame=image};GameEntryRunner.Run(command,fake,image);
            Check(fake.Clicks==1&&fake.Moves==1&&fake.Characters==""&&fake.Selects==0&&fake.Releases==1,"Click not one-shot");
            command.kind="replace_join_id";command.joinId=Id;fake=new FakePlatform {Frame=image};GameEntryRunner.Run(command,fake,image);
            Check(fake.Clicks==1&&fake.Selects==1&&fake.Characters==Id&&fake.Releases==1,"Join UUID sequence wrong");
            command.anchorBounds=command.bounds;command.bounds=new EntryBounds{x=40,y=110,width=100,height=10};fake=new FakePlatform {Frame=image};GameEntryRunner.Run(command,fake,image);
            Check(fake.LastCapture==new Rectangle(40,50,160,32)&&fake.LastPoint==new Point(90,115)&&fake.Characters==Id,"Blank field did not use the distinct instruction anchor");
            command.bounds=command.anchorBounds;command.anchorBounds=null;
            Action<Action<FakePlatform>,string> blocked=(edit,reason)=>{var platform=new FakePlatform {Frame=image};edit(platform);Reject(()=>GameEntryRunner.Run(command,platform,image),reason);Check(platform.Clicks==0&&platform.Characters=="","Blocked action sent input");};
            blocked(p=>p.Stop=true,"operator_stop");blocked(p=>{p.Stop=true;p.Focus=false;},"operator_stop");blocked(p=>p.Modifiers=true,"operator_input");blocked(p=>p.Focus=false,"game_not_foreground");blocked(p=>p.Window.Pid=999,"game_window_changed");blocked(p=>p.Window.Handle=999,"game_window_changed");blocked(p=>p.Window.Width=641,"game_window_changed");blocked(p=>p.Obstructed=true,"cursor_obstructed");blocked(p=>p.ChangedPatch=true,"stale_target");blocked(p=>p.Elapsed=3000,"expired_command");blocked(p=>p.NowValue=Now.AddSeconds(3),"expired_command");blocked(p=>p.OnMove=()=>p.Focus=false,"game_not_foreground");
            fake=new FakePlatform {Frame=image,StopAfterCharacters=10};Reject(()=>GameEntryRunner.Run(command,fake,image),"operator_stop");Check(fake.Characters.Length==10&&fake.Releases==1,"F8 failed to bound typing or release");
            fake=new FakePlatform {Frame=image};var modified=fake;fake.OnSelect=()=>modified.Modifiers=true;Reject(()=>GameEntryRunner.Run(command,fake,image),"operator_input");Check(fake.Characters==""&&fake.Releases==1,"Modifier during select did not stop");
            fake=new FakePlatform {Frame=image};var moved=fake;fake.OnClick=()=>moved.Window.OriginX++;Reject(()=>GameEntryRunner.Run(command,fake,image),"game_window_changed");Check(fake.Characters==""&&fake.Releases==1,"Moved window received text");
            foreach(string failure in new[]{"click","select","type"})
            {
                fake=new FakePlatform {Frame=image,FailClick=failure=="click",FailSelect=failure=="select",FailType=failure=="type"};bool failed=false;
                try{GameEntryRunner.Run(command,fake,image);}catch(Exception){failed=true;}
                Check(failed&&fake.Releases==1,"Input failure did not release: "+failure);Check(fake.Characters.Length<=3,"Input continued after failure");
            }
        }
    }
    private static void Watcher(string root)
    {
        DateTime end;int servicePid;string file=Path.Combine(root,"entry-watch-"+Session+".json");
        Check(GameEntryWatchPolicy.Validate(file,Now.AddMinutes(15).ToString("o"),"123",Now,out end,out servicePid)==Session&&servicePid==123,"Watcher valid session rejected");
        Check(GameEntryWatchPolicy.Validate(file,Now.AddSeconds(10).ToString("o"),"123",Now,out end,out servicePid)==Session,"Short remaining session rejected");
        Reject(()=>GameEntryWatchPolicy.Validate(Path.Combine(root,"other.json"),Now.AddMinutes(15).ToString("o"),"123",Now,out end,out servicePid),"invalid_watch_path");
        Reject(()=>GameEntryWatchPolicy.Validate(file,Now.AddMinutes(721).ToString("o"),"123",Now,out end,out servicePid),"invalid_watch_deadline");
        Reject(()=>GameEntryWatchPolicy.Validate(file,Now.ToString("o"),"123",Now,out end,out servicePid),"invalid_watch_deadline");
        Reject(()=>GameEntryWatchPolicy.Validate(file,Now.AddMinutes(15).ToString("o"),"0",Now,out end,out servicePid),"invalid_service_pid");
        Reject(()=>GameEntryWatchPolicy.Validate(file,Now.AddMinutes(15).ToString("o"),"123.4",Now,out end,out servicePid),"invalid_service_pid");
        Action<bool,bool,bool,DateTime,long,string,string> decision=(key,marker,alive,now,elapsed,status,reason)=>{var result=GameEntryWatchPolicy.Decide(key,marker,alive,now,Now.AddMinutes(1),elapsed,60000);Check(result.Status==status&&result.Reason==reason,"Watcher transition wrong: "+result.Reason);};
        decision(false,false,true,Now,0,"watching",null);decision(true,false,true,Now,0,"cancelled","operator_stop");
        decision(true,true,false,Now.AddMinutes(2),60001,"cancelled","operator_stop");
        decision(false,true,true,Now,0,"closed","watch_stopped");decision(false,false,false,Now,0,"closed","service_closed");
        decision(false,false,true,Now.AddMinutes(1),0,"closed","deadline_reached");decision(false,false,true,Now,60000,"closed","deadline_reached");
        decision(false,false,true,Now.AddHours(-2),60001,"closed","deadline_reached");
    }
    private sealed class FakeFocus : IEntryFocusPlatform
    {
        internal bool Stop,Alive=true,IsValid=true,IsForeground,Accept=true,StopAfterFind,StopAfterRestore;
        internal int FocusCalls,RestoreCalls;internal EntryFocusWindow[] Items=new EntryFocusWindow[0];
        public bool StopRequested(){return Stop;}
        public bool ServiceAlive(){return Alive;}
        public EntryFocusWindow[] Windows(){if(StopAfterFind)Stop=true;return Items;}
        public bool Valid(EntryFocusWindow window){return IsValid;}
        public bool Foreground(EntryFocusWindow window){return IsForeground;}
        public void Restore(EntryFocusWindow window){RestoreCalls++;if(StopAfterRestore)Stop=true;}
        public bool Focus(EntryFocusWindow window){FocusCalls++;IsForeground=Accept;return Accept;}
    }
    private static EntryFocusWindow FocusWindow(bool minimized=false){return new EntryFocusWindow {Pid=123,Handle=456,ProcessName="WardogsClient-Win64-Shipping",Visible=!minimized,Minimized=minimized};}
    private static void FocusPolicy()
    {
        var fake=new FakeFocus();var result=GameEntryFocusPolicy.Run(fake);Check(!result.Found&&!result.Focused&&fake.FocusCalls==0,"Missing game was activated");
        fake=new FakeFocus {Items=new[]{FocusWindow()}};result=GameEntryFocusPolicy.Run(fake);Check(result.Found&&result.Focused&&fake.FocusCalls==1&&fake.RestoreCalls==0,"Unique game was not activated once");
        fake=new FakeFocus {Items=new[]{FocusWindow(true)}};result=GameEntryFocusPolicy.Run(fake);Check(result.Focused&&fake.FocusCalls==1&&fake.RestoreCalls==1,"Minimized game restore wrong");
        fake=new FakeFocus {Items=new[]{FocusWindow()},Accept=false};result=GameEntryFocusPolicy.Run(fake);Check(result.Found&&!result.Focused&&result.Reason=="foreground_refused"&&fake.FocusCalls==1,"Foreground lock was retried/bypassed");
        fake=new FakeFocus {Items=new[]{FocusWindow()},IsForeground=true};result=GameEntryFocusPolicy.Run(fake);Check(result.Focused&&fake.FocusCalls==0,"Already foreground game was activated again");
        fake=new FakeFocus {Items=new[]{FocusWindow(),FocusWindow()}};result=GameEntryFocusPolicy.Run(fake);Check(!result.Found&&fake.FocusCalls==0&&result.Reason=="ambiguous_game_windows","Ambiguous windows were activated");
        var other=FocusWindow();other.ProcessName="OtherGame";fake=new FakeFocus {Items=new[]{other}};result=GameEntryFocusPolicy.Run(fake);Check(!result.Found&&fake.FocusCalls==0,"Different process was activated");
        var hidden=FocusWindow();hidden.Visible=false;fake=new FakeFocus {Items=new[]{hidden}};result=GameEntryFocusPolicy.Run(fake);Check(!result.Found&&fake.FocusCalls==0,"Hidden helper window was activated");
        fake=new FakeFocus {Items=new[]{FocusWindow()},Stop=true};result=GameEntryFocusPolicy.Run(fake);Check(!result.Focused&&result.Reason=="operator_stop"&&fake.FocusCalls==0,"F8 did not prevent initial focus");
        fake=new FakeFocus {Items=new[]{FocusWindow()},StopAfterFind=true};result=GameEntryFocusPolicy.Run(fake);Check(!result.Focused&&result.Reason=="operator_stop"&&fake.FocusCalls==0,"F8 during enumeration did not prevent focus");
        fake=new FakeFocus {Items=new[]{FocusWindow(true)},StopAfterRestore=true};result=GameEntryFocusPolicy.Run(fake);Check(!result.Focused&&result.Reason=="operator_stop"&&fake.FocusCalls==0&&fake.RestoreCalls==1,"F8 after restore was ignored");
        fake=new FakeFocus {Items=new[]{FocusWindow()},Alive=false};result=GameEntryFocusPolicy.Run(fake);Check(!result.Focused&&result.Reason=="service_closed"&&fake.FocusCalls==0,"Dead observer could focus game");
        fake=new FakeFocus {Items=new[]{FocusWindow()},IsValid=false};result=GameEntryFocusPolicy.Run(fake);Check(!result.Focused&&result.Reason=="game_window_changed"&&fake.FocusCalls==0,"Changed game window was focused");
    }
    private static Bitmap ControlImage(Color fill,bool text=false,bool outline=false)
    {
        var image=Image();Rectangle panel=EntryControlVisual.MainDeployBounds(image.Width,image.Height);
        using(var graphics=Graphics.FromImage(image))using(var brush=new SolidBrush(fill))
        {
            if(outline){using(var pen=new Pen(fill,3))graphics.DrawRectangle(pen,panel.X,panel.Y,panel.Width-1,panel.Height-1);}
            else graphics.FillRectangle(brush,panel);
            if(text)for(int x=32;x<108;x+=8)graphics.FillRectangle(Brushes.White,x,346,3,14);
        }return image;
    }
    private static void ControlVisual(string root)
    {
        Color amber=Color.FromArgb(150,115,30);
        foreach(Color fill in new[]{Color.FromArgb(115,115,115),Color.White,Color.FromArgb(50,50,50),Color.FromArgb(120,180,40),Color.FromArgb(200,70,10)})using(var image=ControlImage(fill))Check(!EntryControlVisual.MainDeploy(image).enabled,"Non-amber control accepted");
        using(var image=ControlImage(amber,true)){var result=EntryControlVisual.MainDeploy(image);Check(result.enabled&&result.sampleCount==200&&result.amberRatio>=.60,"Filled amber control rejected");}
        using(var image=ControlImage(amber,false,true))Check(!EntryControlVisual.MainDeploy(image).enabled,"Amber border counted as fill");
        using(var image=ControlImage(Color.FromArgb(20,20,20),true))Check(!EntryControlVisual.MainDeploy(image).enabled,"White text counted as fill");
        using(var image=ControlImage(Color.FromArgb(20,20,20)))
        {Rectangle panel=EntryControlVisual.MainDeployBounds(image.Width,image.Height);using(var graphics=Graphics.FromImage(image))using(var brush=new SolidBrush(amber))graphics.FillRectangle(brush,panel.X,panel.Y,panel.Width/2,panel.Height);Check(!EntryControlVisual.MainDeploy(image).enabled,"Half amber panel accepted");}
        var command=Command(root);command.control="main_deploy";command.bounds=new EntryBounds{x=30,y=342,width=80,height=24};GameEntryPolicy.Validate(command,CommandPath(root),Now);
        using(var disabled=ControlImage(Color.FromArgb(50,50,50),true))
        {var platform=new FakePlatform {Frame=disabled};Reject(()=>GameEntryRunner.Run(command,platform,disabled),"main_deploy_disabled");Check(platform.Clicks==0&&platform.Moves==0,"Disabled reference frame sent a click");}
        using(var ready=ControlImage(amber,true))
        {
            var platform=new FakePlatform {Frame=ready};GameEntryRunner.Run(command,platform,ready);Check(platform.Clicks==1,"Ready control did not click");
            platform=new FakePlatform {Frame=ready,DeployReady=false};Reject(()=>GameEntryRunner.Run(command,platform,ready),"main_deploy_disabled");Check(platform.Clicks==0&&platform.Moves==1,"Current disabled control clicked");
            platform=new FakePlatform {Frame=ready};var changed=platform;platform.OnMove=()=>changed.DeployReady=false;Reject(()=>GameEntryRunner.Run(command,platform,ready),"main_deploy_disabled");Check(platform.Clicks==0,"Control disabled after move was clicked");
        }
    }
    private static void StartAndPointer(string root)
    {
        var command=Command(root);command.kind="press_start";command.control="splash_continue";command.bounds=new EntryBounds{x=200,y=350,width=240,height=24};GameEntryPolicy.Validate(command,CommandPath(root),Now);Check(true,"Valid splash start rejected");
        var withText=Command(root);withText.kind="press_start";withText.control="splash_continue";withText.bounds=command.bounds;withText.joinId=Id;Reject(()=>GameEntryPolicy.Validate(withText,CommandPath(root),Now),"unexpected_join_id");
        using(var image=Image())
        {
            using(var graphics=Graphics.FromImage(image))for(int x=204;x<436;x+=8)graphics.FillRectangle(Brushes.White,x,354,3,16);
            var platform=new FakePlatform {Frame=image};GameEntryRunner.Run(command,platform,image);Check(platform.Starts==1&&platform.Clicks==0&&platform.Moves==0&&platform.Selects==0&&platform.Characters==""&&platform.Releases==1,"Splash start moved/clicked or did not release");
            platform=new FakePlatform {Frame=image,Stop=true};Reject(()=>GameEntryRunner.Run(command,platform,image),"operator_stop");Check(platform.Starts==0,"F8 allowed a start key");
            platform=new FakePlatform {Frame=image,ChangedPatch=true};Reject(()=>GameEntryRunner.Run(command,platform,image),"stale_target");Check(platform.Starts==0,"Stale splash allowed a start key");
            platform=new FakePlatform {Frame=image};var stopped=platform;platform.OnStart=()=>stopped.Stop=true;Reject(()=>GameEntryRunner.Run(command,platform,image),"operator_stop");Check(platform.Starts==1&&platform.Releases==1,"F8 after key did not release/cancel");
            platform=new FakePlatform {Frame=image,FailStart=true};bool failed=false;try{GameEntryRunner.Run(command,platform,image);}catch{failed=true;}Check(failed&&platform.Starts==1&&platform.Releases==1,"Start key failure did not release");
        }
        Rectangle desktop=new Rectangle(-1920,-1080,4480,2520);
        foreach(Point physical in new[]{new Point(-1920,-1080),new Point(2559,1439),new Point(0,0),new Point(-1000,500),new Point(1280,1150)})
        {
            Point absolute=EntryPointerGeometry.Absolute(physical,desktop);
            Point restored=new Point(desktop.Left+(int)Math.Floor(absolute.X*desktop.Width/65536.0),desktop.Top+(int)Math.Floor(absolute.Y*desktop.Height/65536.0));
            Check(absolute.X>=0&&absolute.X<=65535&&absolute.Y>=0&&absolute.Y<=65535,"Absolute pointer outside normalized range");
            Check(restored==physical,"Virtual-desktop pointer lost a physical pixel");
        }
        Reject(()=>EntryPointerGeometry.Absolute(new Point(2560,0),desktop),"cursor_outside_desktop");
        Reject(()=>EntryPointerGeometry.Absolute(new Point(-1921,0),desktop),"cursor_outside_desktop");
        Reject(()=>EntryPointerGeometry.Absolute(Point.Empty,new Rectangle(0,0,1,1)),"cursor_outside_desktop");
    }
    public static int Main()
    {
        string root=Path.Combine(Path.GetTempPath(),"farmdogs-entry-policy-"+Guid.NewGuid().ToString("N"));
        try{Directory.CreateDirectory(root);Policies(root);Frames(root);Executor(root);Watcher(root);FocusPolicy();ControlVisual(root);StartAndPointer(root);Console.WriteLine(checks+" game entry checks passed; fake platform only, no native input, GUI, game or clipboard.");return 0;}
        catch(Exception error){Console.Error.WriteLine(error);return 1;}
        finally{string parent=Path.GetDirectoryName(Path.GetFullPath(root));if(parent==Path.GetTempPath().TrimEnd(Path.DirectorySeparatorChar)&&Path.GetFileName(root).StartsWith("farmdogs-entry-policy-"))Directory.Delete(root,true);}
    }
}
