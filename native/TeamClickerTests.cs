using System;
using System.Collections.Generic;
using System.Linq;
using System.Drawing;
using System.Drawing.Imaging;
using System.Web.Script.Serialization;
using WardogsSeeding;

class TeamClickerTests {
 static int checks;
 static void Check(bool value,string message){checks++;if(!value)throw new Exception(message);}
 static DateTime time=new DateTime(2026,10,31,10,0,0,DateTimeKind.Utc);
 sealed class FakePlatform:ITeamClickerPlatform,ITeamClickerAnyPlatform,ITeamClickerButtonInput {
  public bool Alive=true,Modifiers,Patch=true,FailDown,FailClick,FailCapture,DarkTarget,StaleCapture;
  public Action OnCapture,OnAvailable,AfterDown;
  public string[] AvailableTeams={"blue","red","green"};
  public readonly List<int> ClickedX=new List<int>();
  public string CapturedTeam;
  public TeamClickerFrame Frame=new TeamClickerFrame {Pid=123,Window=456,Width=1920,Height=1080};
  public int Clicks,Captures,PatchCalls,AnyCaptures,AvailabilityReads;
  public List<bool> Buttons=new List<bool>();
  public bool ServiceAlive(int p){return Alive;}
  public bool ModifiersDown(){return Modifiers;}
  public TeamClickerFrame ForegroundGame(){return Frame;}
  public TeamClickerTarget CaptureTarget(TeamClickerFrame f,DateTime now,string selectedTeam){Captures++;CapturedTeam=selectedTeam;if(OnCapture!=null)OnCapture();if(FailCapture)throw new InvalidOperationException("Selector missing or ambiguous");var target=Target();target.capturedAt=(StaleCapture?time.AddMilliseconds(-1):now).ToString("o");if(DarkTarget)target.signature=new int[45];return target;}
  public Dictionary<string,TeamClickerTarget> CaptureAnyTargets(TeamClickerFrame f,DateTime now){AnyCaptures++;if(OnCapture!=null)OnCapture();if(FailCapture)throw new InvalidOperationException("Selector missing or ambiguous");var values=new Dictionary<string,TeamClickerTarget>();int x=100;foreach(string team in new[]{"blue","red","green"}){var target=Target();target.capturedAt=(StaleCapture?time.AddMilliseconds(-1):now).ToString("o");target.x=x;target.patchLeft=x-32;values.Add(team,target);x+=200;}return values;}
  public Dictionary<string,TeamClickerTarget> AvailableTargets(TeamClickerFrame f,DateTime now){AvailabilityReads++;if(OnAvailable!=null)OnAvailable();var values=new Dictionary<string,TeamClickerTarget>();foreach(string team in AvailableTeams){var target=Target();target.x=team=="blue"?100:team=="red"?300:500;target.patchLeft=target.x-32;values.Add(team,target);}return values;}
  public bool PatchMatches(TeamClickerFrame f,TeamClickerTarget t){PatchCalls++;return Patch;}
  public void Click(TeamClickerFrame f,TeamClickerTarget t){Clicks++;ClickedX.Add(t.x);if(FailClick)throw new Exception("Input rejected");TeamClickerButton.Click(this,AfterDown);}
  public void Button(bool down){Buttons.Add(down);if(down&&FailDown)throw new Exception("Down rejected");}
 }
 sealed class FakeHotkeyRegistration:ITeamClickerHotkeyRegistration {
  public uint FailedKey;
  public readonly Dictionary<int,uint> Active=new Dictionary<int,uint>();
  public readonly List<int> Registered=new List<int>(),Unregistered=new List<int>();
  public readonly List<uint> Flags=new List<uint>();
  public bool Register(int id,uint modifiers,uint key){Registered.Add(id);Flags.Add(modifiers);if(key==FailedKey)return false;Active.Add(id,key);return true;}
  public void Unregister(int id){Unregistered.Add(id);Active.Remove(id);}
 }
 static void ButtonPulseTests(){
  var button=new FakePlatform();bool held=false;
  TeamClickerButton.Click(button,()=>{held=true;Check(button.Buttons.SequenceEqual(new[]{true}),"Hold/guard runs after down and before up");});
  Check(held&&button.Buttons.SequenceEqual(new[]{true,false}),"Successful hold releases button exactly once");
  foreach(Exception failure in new Exception[]{new InvalidOperationException("Wait interrupted"),new TeamClickerOperatorStopException(),new InvalidOperationException("Focus changed"),new InvalidOperationException("Point obscured"),new InvalidOperationException("Modifier pressed")}){
   button=new FakePlatform();Exception observed=null;try{TeamClickerButton.Click(button,()=>{Check(button.Buttons.SequenceEqual(new[]{true}),"Failure guard executes while button is held");throw failure;});}catch(Exception error){observed=error;}
   Check(Object.ReferenceEquals(observed,failure),"Pulse failure propagates to engine without being swallowed");Check(button.Buttons.SequenceEqual(new[]{true,false}),"Wait/stop/focus/point/modifier failure still releases button");
  }
  button=new FakePlatform{FailDown=true};bool waited=false;try{TeamClickerButton.Click(button,()=>waited=true);}catch{}Check(!waited&&button.Buttons.SequenceEqual(new[]{true,false}),"Rejected down skips hold but still attempts up");
  foreach(bool stop in new[]{true,false}){
   var fake=new FakePlatform();var engine=Engine(fake);var command=Command();command.startMode="automatic";engine.Apply(command,time,0);engine.Tick(time,0);
   fake.AfterDown=()=>{if(stop)throw new TeamClickerOperatorStopException();throw new InvalidOperationException("Focus changed during held click");};engine.Tick(time.AddMilliseconds(20),20);
   Check(fake.Buttons.SequenceEqual(new[]{true,false}),"Engine pulse interruption releases the accepted down");Check(!engine.Active&&!engine.Armed&&engine.Count==0,"Interrupted pulse is terminal and never counted as accepted");
   if(stop)Check(Convert.ToString(Field(engine,"operatorStoppedSessionId"))==command.sessionId,"F8 during hold remains an operator stop");
   fake.AfterDown=null;engine.Apply(Command(command.sessionId,time.AddMilliseconds(40)),time.AddMilliseconds(40),40);engine.Tick(time.AddMilliseconds(40),40);Check(fake.Buttons.Count==2,"Renewing same cancelled session never repeats input");
  }
 }
 static void HotkeyTests(){
  var native=new FakeHotkeyRegistration();var gate=new TeamClickerHotkeyGate(native);
  gate.Update("session-a",false,false,false,true);Check(native.Registered.Count==0&&!gate.Ready,"Hotkeys absent outside eligible game");
  gate.Update("session-a",true,true,true,true);Check(native.Registered.Count==0&&!gate.Ready,"Held-at-arm F6/F9 must release before registration");
  gate.Update("session-a",true,false,true,true);Check(gate.ToggleRegistered&&!gate.CaptureRegistered,"F6 released can register independently");
  int firstToggle=gate.ToggleId;Check(gate.Action(firstToggle,0x75)==6,"WM_HOTKEY delivers F6 after very short physical pulse");
  gate.Update("session-a",true,false,false,true);Check(gate.Ready&&native.Active.Count==2,"Both released keys register");
  int firstCapture=gate.CaptureId;Check(gate.Action(firstCapture,0x78)==9,"WM_HOTKEY delivers F9 after short pulse");
  Check(gate.Action(firstCapture,0x75)==0&&gate.Action(firstToggle,0x78)==0,"Wrong virtual key cannot act through valid ID");
  Check(native.Flags.All(value=>value==0x4000),"MOD_NOREPEAT bounds operating-system key-repeat notifications");
  for(int repeat=0;repeat<10;repeat++)gate.Update("session-a",true,true,true,true);
  Check(native.Registered.Count==2&&gate.ToggleId==firstToggle&&gate.CaptureId==firstCapture,"Held keys do not re-register or synthesize polling actions");
  gate.Update("session-a",false,false,false,true);Check(native.Active.Count==0&&!gate.Ready,"Focus loss unregisters both keys");
  Check(gate.Action(firstToggle,0x75)==0&&gate.Action(firstCapture,0x78)==0,"Queued messages inert after focus loss");
  gate.Update("session-a",true,false,false,true);Check(gate.Ready&&gate.ToggleId!=firstToggle&&gate.CaptureId!=firstCapture,"Focus return creates fresh registration IDs");
  Check(gate.Action(firstToggle,0x75)==0&&gate.Action(firstCapture,0x78)==0,"Old focus queue cannot activate after focus return");
  int secondToggle=gate.ToggleId,secondCapture=gate.CaptureId;
  gate.Update("session-b",true,false,false,true);Check(gate.Ready&&gate.ToggleId!=secondToggle&&gate.CaptureId!=secondCapture,"New session gets distinct IDs");
  Check(gate.Action(secondToggle,0x75)==0&&gate.Action(secondCapture,0x78)==0,"Previous session queue cannot toggle or capture");
  gate.Update("session-c",true,true,true,true);Check(!gate.Ready&&native.Active.Count==0,"Rearm while keys held cannot auto-start");
  gate.Update("session-c",true,false,false,true);Check(gate.Ready,"Fresh release permits explicit subsequent press");
  int stoppedId=gate.ToggleId;gate.Update("session-c",false,false,false,true);Check(gate.Action(stoppedId,0x75)==0,"F8/disarm gate invalidates pending F6");
  gate.Update("session-c",true,false,false,true);int lastId=gate.ToggleId;gate.Dispose();Check(native.Active.Count==0&&gate.Action(lastId,0x75)==0,"Dispose unregisters and rejects queued activation");
  gate.Update("session-d",true,false,false,true);Check(native.Active.Count==0,"Disposed gate never registers again");
  native=new FakeHotkeyRegistration{FailedKey=0x75};gate=new TeamClickerHotkeyGate(native);gate.Update("session-a",true,false,false,true);
  Check(!gate.Ready&&native.Active.Count==0&&gate.Error!=null&&gate.Error.Contains("F6"),"F6 registration error visible, without fallback polling");
  native=new FakeHotkeyRegistration{FailedKey=0x78};gate=new TeamClickerHotkeyGate(native);gate.Update("session-a",true,false,false,true);
  Check(!gate.Ready&&native.Active.Count==0&&gate.Error!=null&&gate.Error.Contains("F9"),"F9 registration error releases partial F6 registration");
  int failedRequests=native.Registered.Count;gate.Update("session-a",true,false,false,true);Check(native.Registered.Count==failedRequests,"Registration failure cannot spin-retry within epoch");
  native.FailedKey=0;gate.Update("session-a",false,false,false,true);gate.Update("session-b",true,false,false,true);Check(gate.Ready,"New explicit eligibility can recover from occupied key");
  Check(native.Active.Values.All(value=>value==0x75||value==0x78),"F8 is never registered or consumed by the clicker");
  gate.Dispose();
  native=new FakeHotkeyRegistration{FailedKey=0x78};gate=new TeamClickerHotkeyGate(native);
  gate.Update("normal",true,false,false);
  Check(gate.Ready&&gate.ToggleRegistered&&!gate.CaptureRegistered&&gate.Error==null,"Normal F6 readiness does not depend on an occupied optional F9");
  int normalToggle=gate.ToggleId;
  Check(native.Registered.Count==1&&native.Active.Count==1&&native.Active.Values.Single()==0x75,"Normal mode registers only F6 and leaves F9 with its owner");
  Check(gate.Action(normalToggle,0x75)==6&&gate.Action(normalToggle,0x78)==0,"Normal registered F6 remains operational with F9 unavailable");
  gate.Update("normal",true,false,true);
  Check(gate.Ready&&gate.ToggleId==normalToggle,"Holding unused F9 cannot block or re-register normal F6");
  gate.Update("normal",true,false,false,true);
  Check(!gate.Ready&&gate.Error!=null&&gate.Error.Contains("F9")&&native.Active.Count==0,"Explicit F9 check reports its conflict and releases that epoch");
  Check(gate.Action(normalToggle,0x75)==0,"Queued normal-mode F6 cannot act after switching to explicit capture mode");
  int requestedCount=native.Registered.Count;
  gate.Update("normal",true,false,false,true);
  Check(native.Registered.Count==requestedCount,"Optional capture conflict does not retry within its epoch");
  gate.Update("normal",true,false,false);
  Check(gate.Ready&&gate.Error==null&&!gate.CaptureRegistered&&gate.ToggleId!=normalToggle,"Canceling the optional check restores F6 despite F9 remaining occupied");
  int restoredToggle=gate.ToggleId;
  native.FailedKey=0;gate.Update("normal",true,false,true,true);
  Check(gate.ToggleRegistered&&!gate.CaptureRegistered&&!gate.Ready,"Held F9 at explicit-check start must be released before registration");
  Check(gate.Action(restoredToggle,0x75)==0,"Capture-mode change creates a fresh F6 registration ID");
  gate.Update("normal",true,false,false,true);
  Check(gate.Ready&&gate.CaptureRegistered,"Released requested F9 becomes ready");
  int captureToggle=gate.ToggleId,captureId=gate.CaptureId;
  Check(gate.Action(captureId,0x78)==9,"Only the explicitly requested F9 check consumes F9");
  gate.Update("normal",true,false,false);
  Check(gate.Ready&&!gate.CaptureRegistered&&native.Active.Count==1,"Completing capture returns to F6-only mode");
  Check(gate.Action(captureId,0x78)==0&&gate.Action(captureToggle,0x75)==0,"Queued capture-mode messages cannot affect returned normal mode");
  int released=gate.ToggleId;gate.Update("normal",false,false,false);
  Check(native.Active.Count==0&&!gate.Ready&&gate.Action(released,0x75)==0,"Focus loss releases normal F6 and invalidates queued messages");
  gate.Update("normal",true,true,false);
  Check(!gate.Ready&&native.Active.Count==0,"Held F6 at normal-mode rearm waits for a release");
  gate.Update("normal",true,false,false);
  Check(gate.Ready&&native.Active.Count==1,"Fresh normal-mode F6 can be prepared again");
  gate.Dispose();Check(native.Active.Count==0,"Dispose releases normal-mode F6");
 }
 static void DrawLogo(Graphics graphics,int color,int cx,int cy,int size){
  Brush brush=color==1?Brushes.DeepSkyBlue:color==2?Brushes.Tomato:Brushes.LimeGreen;
  int left=cx-size/2,top=cy-size/2;
  if(color==1){graphics.FillRectangle(brush,left,top,size,size);graphics.FillRectangle(Brushes.Black,cx-size/16,top,size/8,size);graphics.FillRectangle(Brushes.Black,left,cy-size/16,size,size/8);}
  else if(color==2){graphics.FillPolygon(brush,new[]{new Point(left,top),new Point(left+size,top),new Point(cx,top+size)});graphics.FillPolygon(Brushes.Black,new[]{new Point(left+size/4,top),new Point(left+size*3/4,top),new Point(cx,top+size*3/4)});}
  else{graphics.FillEllipse(brush,left,top,size,size);graphics.FillEllipse(Brushes.Black,left+size/4,top+size/4,size/2,size/2);}
 }
 static Bitmap Selector(int width,int height){
  var image=new Bitmap(width,height,PixelFormat.Format32bppArgb);
  using(var g=Graphics.FromImage(image)){g.Clear(System.Drawing.Color.Black);int size=(int)(height*.072),spacing=(int)(size*1.92);for(int color=1;color<=3;color++)DrawLogo(g,color,width/2+(color-2)*spacing,height/2,size);}
  return image;
 }
 static bool Refused(Bitmap image,string team="blue"){try{TeamClickerLogoDetector.Recognize(image,team,time);return false;}catch(InvalidOperationException){return true;}}
 static void LogoTests(){
  foreach(var resolution in new[]{new Size(1280,720),new Size(1920,1080),new Size(2560,1440)})using(var image=Selector(resolution.Width,resolution.Height)){
   var blue=TeamClickerLogoDetector.Recognize(image,"blue",time);var red=TeamClickerLogoDetector.Recognize(image,"red",time);var green=TeamClickerLogoDetector.Recognize(image,"green",time);
   Check(blue.Valid()&&red.Valid()&&green.Valid(),"Complete aligned selector recognized at "+resolution);
   Check(blue.x<red.x&&red.x<green.x,"Requested color selects its own logo, never cursor centre");
   var color=image.GetPixel(blue.x,blue.y);Check(color.B>color.R&&color.G>color.R,"Blue click point is an actual colored logo pixel");
   color=image.GetPixel(red.x,red.y);Check(color.R>color.G&&color.R>color.B,"Red point is on red logo");
   color=image.GetPixel(green.x,green.y);Check(color.G>color.R&&color.G>color.B,"Green point is on green logo");
   Check(!TeamClickerPatch.Matches(blue.signature,red.signature),"Different faction patches are not interchangeable");
  }
  using(var image=new Bitmap(1280,720)){Check(Refused(image),"Blank scene cannot authorize click");}
  using(var image=Selector(1280,720)){
   using(var g=Graphics.FromImage(image))g.FillRectangle(Brushes.Black,700,300,150,150);
   Check(Refused(image),"Missing green rejects entire layout, even blue requested");
  }
  using(var image=new Bitmap(1280,720)){
   using(var g=Graphics.FromImage(image)){g.Clear(System.Drawing.Color.Black);DrawLogo(g,3,540,360,52);DrawLogo(g,2,640,360,52);DrawLogo(g,1,740,360,52);}
   Check(Refused(image),"Reordered color row rejected");
  }
  using(var image=new Bitmap(1280,720)){
   using(var g=Graphics.FromImage(image)){g.Clear(System.Drawing.Color.Black);DrawLogo(g,1,540,360,52);DrawLogo(g,2,640,360,52);DrawLogo(g,3,740,460,52);}
   Check(Refused(image),"Scattered scene colors are not a selector");
  }
  using(var image=new Bitmap(1280,720)){
   using(var g=Graphics.FromImage(image)){g.Clear(System.Drawing.Color.Black);g.FillRectangle(Brushes.DeepSkyBlue,514,334,52,52);g.FillRectangle(Brushes.Tomato,614,334,52,52);g.FillRectangle(Brushes.LimeGreen,714,334,52,52);}
   Check(Refused(image),"Solid color swatches are not logos");
  }
  using(var image=new Bitmap(1920,1080)){
   using(var g=Graphics.FromImage(image)){g.Clear(System.Drawing.Color.Black);foreach(int centerY in new[]{430,650})for(int color=1;color<=3;color++)DrawLogo(g,color,960+(color-2)*148,centerY,78);}
   Check(Refused(image),"Two valid rows are ambiguous, never choose arbitrarily");
  }
  using(var image=Selector(1280,720)){Check(Refused(image,"orange"),"Unknown team cannot become arbitrary target");}
 }
 static int Probe(string file){
  var rows=new List<object>();
  try{using(var source=new Bitmap(file))using(var image=new Bitmap(source.Width,source.Height,PixelFormat.Format32bppArgb)){
   using(var graphics=Graphics.FromImage(image))graphics.DrawImageUnscaled(source,0,0);
   TeamClickerSelectorSnapshot snapshot;if(!TeamClickerSelectorFrame.TryRecognizeAll(image,DateTime.UtcNow,out snapshot))throw new InvalidOperationException("No se reconoce la estructura actual del selector.");
   foreach(string team in new[]{"blue","red","green"}){Rectangle bounds=snapshot.Cards[team];TeamClickerTarget target=snapshot.Targets[team];rows.Add(new {team=team,x=target.x,y=target.y,bounds=new{x=bounds.X,y=bounds.Y,width=bounds.Width,height=bounds.Height}});}
   var any=new TeamClickerAnySelector(image,snapshot);string[] available;
   using(var shared=image.Clone(any.ReadBounds,PixelFormat.Format32bppArgb))available=any.Available(shared,DateTime.UtcNow).Keys.ToArray();
   Console.WriteLine(new JavaScriptSerializer().Serialize(new{offlineImage=true,inputAllowed=false,recognizer="selector-cards",recognized=true,width=image.Width,height=image.Height,targets=rows,automaticAnyTeam=true,availableTeams=available,sharedReadBounds=new{x=any.ReadBounds.X,y=any.ReadBounds.Y,width=any.ReadBounds.Width,height=any.ReadBounds.Height}}));return 0;
  }}catch(Exception error){Console.WriteLine(new JavaScriptSerializer().Serialize(new{offlineImage=true,inputAllowed=false,recognized=false,error=error.Message}));return 0;}
 }
 static TeamClickerTarget Target(){return new TeamClickerTarget{x=100,y=200,width=1920,height=1080,patchLeft=68,patchTop=184,patchWidth=64,patchHeight=32,capturedAt=time.ToString("o"),signature=Enumerable.Repeat(0x4fb0e6,45).ToArray()};}
 static TeamClickerCommand Command(string session=null,DateTime? now=null){DateTime value=now??time;return new TeamClickerCommand {format="wardogs-team-clicker-command-v1",id=Guid.NewGuid().ToString("D"),sessionId=session??Guid.NewGuid().ToString("D"),issuedAt=value.ToString("o"),expiresAt=value.AddSeconds(3).ToString("o"),enabled=true,selectedTeam="blue",intervalMs=20,toggleKey="F6",captureKey="F9",servicePid=100};}
 static TeamClickerCommand AutoCommand(string session=null,DateTime? now=null){var command=Command(session,now);command.startMode="automatic";return command;}
 static TeamClickerEngine Engine(FakePlatform fake,bool target=true,Func<double> clock=null){return new TeamClickerEngine(fake,target?new Dictionary<string,TeamClickerTarget>{{"blue",Target()}}:null,clock??(()=>0));}
 static void Reject(Action<TeamClickerCommand> edit,string label){var c=Command();edit(c);bool rejected=false;try{c.Validate(time);}catch(ArgumentException){rejected=true;}Check(rejected,label);}
 static object Field(TeamClickerEngine engine,string name){var value=engine.View(time,99);return value.GetType().GetProperty(name).GetValue(value,null);}
 static TeamClickerCommand Proof(TeamClickerEngine engine,string session,DateTime captured,DateTime observed){var value=Command(session,observed);value.entryAttemptId=(string)Field(engine,"attemptId");value.entryGamePid=123;value.entryGameWindow=456;value.entryCapturedAt=captured.ToString("o");return value;}
 static void RejectProof(Action<TeamClickerCommand> edit,string text){
  var fake=new FakePlatform();var engine=Engine(fake);var cmd=Command();engine.Apply(cmd,time,0);engine.Toggle(time,0);engine.Tick(time,0);
  var proof=Proof(engine,cmd.sessionId,time.AddMilliseconds(20),time.AddMilliseconds(40));edit(proof);engine.Apply(proof,time.AddMilliseconds(40),40);
  Check(engine.Active&&engine.Armed&&Field(engine,"completedAttemptId")==null,text);
 }
 static void EngineTests(){
  var fake=new FakePlatform();var engine=Engine(fake);var cmd=Command();engine.Apply(cmd,time,0);engine.Tick(time,0);
  Check(engine.Armed&&!engine.Active&&!engine.Running&&fake.Clicks==0,"Preparing the API never creates an attempt or a click");
  Check(!engine.CaptureRequested,"Normal clicker preparation does not request the optional F9 hotkey");
  engine.Toggle(time,0);string first=(string)Field(engine,"attemptId");
  Check(engine.Active&&engine.Running&&!((bool)Field(engine,"waitingForSelector"))&&fake.Clicks==0,"F6 acquires a card without emitting the click itself");
  Check(!String.IsNullOrEmpty(first)&&Convert.ToInt64(Field(engine,"gameWindow"))==456,"Attempt publishes UUID and bound HWND");
  engine.Tick(time,0);Check(fake.Clicks==1&&engine.Count==1&&fake.Buttons.SequenceEqual(new[]{true,false}),"Tick emits a paired mouse click");
  engine.Tick(time.AddMilliseconds(19),19);Check(fake.Clicks==1,"Interval preserved");
  engine.Tick(time.AddMilliseconds(20),20);Check(fake.Clicks==2,"Next interval produces next click");
  fake.Patch=false;fake.FailCapture=true;engine.Tick(time.AddMilliseconds(40),40);
  Check(fake.Clicks==3&&fake.Captures==1&&fake.PatchCalls==0&&engine.Running,"Hidden/disabled color never gates or rescans the running loop");
  engine.Tick(time.AddMilliseconds(1000),1000);engine.Tick(time.AddMilliseconds(1000),1000);Check(fake.Clicks==4,"Late tick produces no catch-up burst");
  engine.Toggle(time.AddMilliseconds(1001),1001);Check(!engine.Active&&!engine.Running&&engine.Armed,"F6 cancels active attempt instantly");
  fake.FailCapture=false;engine.Toggle(time.AddMilliseconds(1002),1002);Check((string)Field(engine,"attemptId")!=first&&engine.Count==0,"New F6 attempt gets new UUID and resets count");
  var changedSession=Command(null,time.AddMilliseconds(1003));engine.Apply(changedSession,time.AddMilliseconds(1003),1003);Check(engine.Count==0&&!engine.Active&&Field(engine,"attemptId")==null,"New session resets attempt and count");

  fake=new FakePlatform{DarkTarget=true,Patch=false};engine=Engine(fake);cmd=Command();engine.Apply(cmd,time,0);engine.Toggle(time,0);engine.Tick(time,0);
  Check(engine.Running&&engine.Count==1&&fake.PatchCalls==0,"A structurally valid dark card is clickable without saturated pixels");
  engine.Toggle(time,1);Check(!engine.Active,"F6 also cancels a dark-card attempt");

  fake=new FakePlatform{FailCapture=true};engine=Engine(fake,true);cmd=Command();engine.Apply(cmd,time,0);engine.Toggle(time,0);
  Check(engine.Active&&!engine.Running&&(bool)Field(engine,"waitingForSelector")&&engine.Count==0,"Initial unavailable structure keeps intent without old-target fallback");
  Check(Convert.ToInt32(Field(engine,"gamePid"))==123&&Convert.ToInt64(Field(engine,"gameWindow"))==456,"Waiting intent retains process/window binding");
  engine.Tick(time,149);Check(fake.Captures==1&&fake.Clicks==0,"Initial structural retries are bounded to150ms");
  engine.Tick(time.AddMilliseconds(150),150);Check(fake.Captures==2&&fake.Clicks==0,"One retry after150ms without a click");
  fake.FailCapture=false;engine.Tick(time.AddMilliseconds(300),300);Check(engine.Active&&engine.Running&&fake.Captures==3&&fake.Clicks==0,"Structural availability resumes the same attempt without new F6");
  engine.Tick(time.AddMilliseconds(300),300);Check(fake.Clicks==1,"Acquired card clicks at the next tick");
  fake.FailCapture=true;engine.Tick(time.AddMilliseconds(320),320);Check(fake.Clicks==2&&fake.Captures==3,"No recapture after acquisition, even when color disappears");
  fake=new FakePlatform{FailCapture=true};engine=Engine(fake);cmd=Command();engine.Apply(cmd,time,0);engine.Toggle(time,0);int scans=fake.Captures;engine.Toggle(time,1);
  Check(!engine.Active&&fake.Captures==scans,"F6 cancels an initially waiting attempt without another scan");

  fake=new FakePlatform{FailCapture=true};engine=Engine(fake);cmd=Command();engine.Apply(cmd,time,0);engine.Toggle(time,0);engine.EmergencyStop();
  Check(!engine.Active&&!engine.Armed,"F8 cancels waiting intent and disarms");
  fake.FailCapture=false;engine.Apply(Command(cmd.sessionId,time.AddMilliseconds(1)),time.AddMilliseconds(1),1);engine.Toggle(time,1);Check(!engine.Active&&!engine.Armed,"Same-session leases cannot undo F8");
  engine.Apply(Command(null,time.AddMilliseconds(2)),time.AddMilliseconds(2),2);Check(engine.Armed&&!engine.Active,"New explicit session may prepare again");

  fake=new FakePlatform();engine=Engine(fake);cmd=Command();engine.Apply(cmd,time,0);engine.Toggle(time,0);fake.Frame=null;engine.Tick(time,1);Check(!engine.Active,"Focus loss cancels the attempt");
  fake.Frame=new TeamClickerFrame{Pid=123,Window=456,Width=1920,Height=1080};engine.Tick(time,2);Check(!engine.Active&&fake.Clicks==0,"Focus return does not restart");
  engine.Toggle(time,3);fake.Frame.Width=1280;engine.Tick(time,4);Check(!engine.Active,"Resize cancels without guessing new coordinates");

  fake=new FakePlatform{FailCapture=true};engine=Engine(fake);cmd=Command();engine.Apply(cmd,time,0);engine.Toggle(time,0);fake.Frame.Window=789;engine.Tick(time,1);Check(!engine.Active,"Window replacement cancels waiting intent");
  fake=new FakePlatform();engine=Engine(fake);cmd=Command();engine.Apply(cmd,time,0);engine.Toggle(time,0);fake.Modifiers=true;engine.Tick(time,1);Check(!engine.Active,"Modifiers cancel instead of changing UI actions");
  fake.Modifiers=false;engine.Tick(time,2);Check(!engine.Active,"Modifier release cannot resume");
  engine.Toggle(time,3);fake.Alive=false;engine.Tick(time,4);Check(!engine.Active&&!engine.Armed,"Service-owner exit cancels");

  fake=new FakePlatform();engine=Engine(fake);cmd=Command();engine.Apply(cmd,time,0);engine.Toggle(time,0);engine.Tick(time,3000);Check(!engine.Active&&!engine.Armed,"Monotonic lease expiry stops under frozen wall clock");
  engine.Apply(Command(cmd.sessionId,time.AddSeconds(4)),time.AddSeconds(4),4000);Check(engine.Armed&&!engine.Active,"Renewal after a lease gap prepares but never resumes");
  fake=new FakePlatform();engine=Engine(fake);cmd=Command();engine.Apply(cmd,time,100);engine.Toggle(time,100);engine.Tick(time,99);Check(!engine.Active,"Monotonic rollback cancels");
  fake=new FakePlatform();engine=Engine(fake);cmd=Command();engine.Apply(cmd,time,0);engine.Toggle(time,0);engine.Tick(time.AddSeconds(3),1);Check(!engine.Active,"UTC expiry also cancels");

  fake=new FakePlatform();engine=Engine(fake);cmd=Command();engine.Apply(cmd,time,0);engine.Toggle(time,0);
  for(int second=1;second<=200;second++){engine.Apply(Command(cmd.sessionId,time.AddSeconds(second)),time.AddSeconds(second),second*1000);engine.Tick(time.AddSeconds(second),second*1000);}
  Check(engine.Active&&engine.Count==200,"Continuous leases allow repeated attempts beyond two minutes");
  var disable=Command(cmd.sessionId,time.AddSeconds(200));disable.enabled=false;engine.Apply(disable,time.AddSeconds(200),200001);Check(!engine.Active&&!engine.Armed,"Disable cancels persistent intent");

  fake=new FakePlatform{FailClick=true};engine=Engine(fake);cmd=Command();engine.Apply(cmd,time,0);engine.Toggle(time,0);engine.Tick(time,0);int failed=fake.Clicks;fake.FailClick=false;engine.Tick(time,20);Check(!engine.Active&&fake.Clicks==failed,"Input failure never recaptures or resumes automatically");
  var button=new FakePlatform{FailDown=true};try{TeamClickerButton.Click(button);}catch{}Check(button.Buttons.SequenceEqual(new[]{true,false}),"Mouse-up attempted even after down failure");

  double operation=0;fake=new FakePlatform();fake.OnCapture=()=>operation+=80;engine=Engine(fake,false,()=>operation);cmd=Command();engine.Apply(cmd,time,0);engine.Toggle(time,0);
  Check(fake.Clicks==0,"Acquisition duration cannot authorize an earlier tick");
  engine.Tick(time.AddMilliseconds(80),80);Check(fake.Clicks==1,"First click follows completed acquisition without an extra interval");
  operation=0;fake=new FakePlatform();fake.OnCapture=()=>operation+=4000;engine=Engine(fake,false,()=>operation);cmd=Command();engine.Apply(cmd,time,0);engine.Toggle(time,0);Check(!engine.Active&&!engine.Armed&&fake.Clicks==0,"Lease expiry during acquisition cancels");
  fake=new FakePlatform();engine=Engine(fake);cmd=Command();engine.Apply(cmd,time,0);fake.OnCapture=()=>engine.EmergencyStop();engine.Toggle(time,0);Check(!engine.Active&&!engine.Armed,"F8 cannot be undone by an acquisition result");

  fake=new FakePlatform();engine=Engine(fake);cmd=Command();cmd.calibrateTeam="blue";engine.Apply(cmd,time,0);Check(engine.CaptureRequested,"An explicit optional check requests F9 registration");engine.Capture(time,0);Check(!engine.Active&&fake.Clicks==0&&engine.TargetsChanged,"Optional F9 recognition remains read-only");
  cmd=Command(cmd.sessionId);engine.Apply(cmd,time,1);Check(!engine.CaptureRequested,"Completing the optional check releases the F9 request");
  engine.TargetsSaved();Check(!engine.TargetsChanged,"Recognition persistence acknowledgement");
  var keys=new TeamClickerKeyEdges(true,true,true);Check(keys.Read(true,true,true)==0,"Held startup keys cannot activate");keys.Read(false,false,false);Check(keys.Read(true,true,true)==8,"F8 has priority over activation");keys.Read(false,false,false);Check(keys.Read(false,true,false)==9,"F9 edge stays recognized");
 }
 static void ConfirmationTests(){
  RejectProof(c=>c.entryAttemptId=Guid.NewGuid().ToString("D"),"Foreign attempt confirmation ignored");
  RejectProof(c=>c.entryGamePid=124,"Different process confirmation ignored");
  RejectProof(c=>c.entryGameWindow=789,"Different window confirmation ignored");
  RejectProof(c=>c.entryCapturedAt=time.AddMilliseconds(-1).ToString("o"),"Pre-attempt capture ignored");
  RejectProof(c=>c.entryCapturedAt=time.AddSeconds(1).ToString("o"),"Future capture ignored");
  RejectProof(c=>c.entryCapturedAt="bad","Malformed capture UTC ignored");
  RejectProof(c=>c.entryCapturedAt="2026-10-31T11:00:00+01:00","Non-UTC capture ignored");
  var fake=new FakePlatform();var engine=Engine(fake);var cmd=Command();engine.Apply(cmd,time,0);engine.Toggle(time,0);
  var proof=Proof(engine,cmd.sessionId,time,time.AddMilliseconds(1));engine.Apply(proof,time.AddMilliseconds(1),1);Check(engine.Active&&Field(engine,"completedAttemptId")==null,"Zero-click attempt cannot complete");
  engine.Tick(time.AddMilliseconds(1),1);string id=(string)Field(engine,"attemptId");proof=Proof(engine,cmd.sessionId,time.AddMilliseconds(1),time.AddMilliseconds(40));engine.Apply(proof,time.AddMilliseconds(40),40);
  Check(!engine.Active&&!engine.Armed&&!engine.Running&&(string)Field(engine,"completedAttemptId")==id,"Fresh bound positive evidence completes and disarms");
  int clicks=fake.Clicks,captures=fake.Captures;engine.Apply(Command(cmd.sessionId,time.AddMilliseconds(50)),time.AddMilliseconds(50),50);engine.Toggle(time.AddMilliseconds(50),50);engine.Tick(time.AddMilliseconds(50),50);
  Check(!engine.Armed&&!engine.Active&&fake.Clicks==clicks&&fake.Captures==captures,"Same session cannot resume after positive completion");
  var other=Command(null,time.AddMilliseconds(60));engine.Apply(other,time.AddMilliseconds(60),60);Check(engine.Armed&&!engine.Active&&engine.Count==0&&Field(engine,"completedAttemptId")==null,"New session is separately prepared with reset count");
  engine.Apply(Command(cmd.sessionId,time.AddMilliseconds(70)),time.AddMilliseconds(70),70);Check(!engine.Armed&&(string)Field(engine,"completedAttemptId")==id,"A completed old session stays permanently blocked");

  fake=new FakePlatform();engine=Engine(fake);cmd=Command();engine.Apply(cmd,time,0);engine.Toggle(time,0);engine.Tick(time,0);string oldId=(string)Field(engine,"attemptId");engine.Toggle(time,1);engine.Toggle(time.AddMilliseconds(2),2);engine.Tick(time.AddMilliseconds(2),2);
  proof=Proof(engine,cmd.sessionId,time.AddMilliseconds(3),time.AddMilliseconds(4));proof.entryAttemptId=oldId;engine.Apply(proof,time.AddMilliseconds(4),4);Check(engine.Active&&Field(engine,"completedAttemptId")==null,"Late result from a cancelled attempt cannot complete the next one");

  fake=new FakePlatform();engine=Engine(fake);cmd=Command();engine.Apply(cmd,time,0);engine.Toggle(time,0);engine.Tick(time,0);
  for(int second=1;second<=6;second++)engine.Apply(Command(cmd.sessionId,time.AddSeconds(second)),time.AddSeconds(second),second*1000);
  proof=Proof(engine,cmd.sessionId,time.AddMilliseconds(20),time.AddSeconds(6));engine.Apply(proof,time.AddSeconds(6),6000);Check(engine.Active&&Field(engine,"completedAttemptId")==null,"Capture older than five seconds cannot complete");
  proof=Proof(engine,cmd.sessionId,time.AddSeconds(1),time.AddSeconds(6));engine.Apply(proof,time.AddSeconds(6),6000);Check(!engine.Active&&!engine.Armed,"Five-second freshness boundary accepted");

  fake=new FakePlatform();engine=Engine(fake);cmd=Command();engine.Apply(cmd,time,0);engine.Toggle(time,0);engine.Tick(time,0);engine.Toggle(time,1);proof=Proof(engine,cmd.sessionId,time,time.AddMilliseconds(20));engine.Apply(proof,time.AddMilliseconds(20),20);Check(!engine.Active&&Field(engine,"completedAttemptId")==null,"Cancelled intent cannot be revived or completed by a late capture");
 }
 static void AutomaticCancellation(Action<FakePlatform> cause,string label){
  var fake=new FakePlatform();var engine=Engine(fake);var command=AutoCommand();engine.Apply(command,time,0);engine.Tick(time,0);engine.Tick(time.AddMilliseconds(1),1);
  Check(engine.Running&&engine.Count==1,"Automatic baseline acquired and clicked: "+label);
  string first=(string)Field(engine,"attemptId");cause(fake);engine.Tick(time.AddMilliseconds(21),21);
  Check(!engine.Active&&!engine.Armed&&(string)Field(engine,"automaticStoppedSessionId")==command.sessionId&&!String.IsNullOrEmpty((string)Field(engine,"automaticStopReason")),"Automatic terminal cancellation reported: "+label);
  int clicks=fake.Clicks,captures=fake.Captures;fake.Frame=new TeamClickerFrame{Pid=123,Window=456,Width=1920,Height=1080};fake.Modifiers=false;fake.FailClick=false;fake.Alive=true;
  engine.Apply(AutoCommand(command.sessionId,time.AddMilliseconds(30)),time.AddMilliseconds(30),30);engine.Tick(time.AddMilliseconds(50),50);
  Check(!engine.Armed&&!engine.Active&&fake.Clicks==clicks&&fake.Captures==captures,"Same-session refresh cannot resume after "+label);
  engine.Apply(AutoCommand(null,time.AddMilliseconds(60)),time.AddMilliseconds(60),60);engine.Tick(time.AddMilliseconds(60),60);
  Check(engine.Armed&&engine.Active&&(string)Field(engine,"attemptId")!=first&&Field(engine,"automaticStoppedSessionId")==null,"Explicit new wait may recover after "+label);
 }
 static void AutomaticTests(){
  var fake=new FakePlatform{Frame=null};var engine=Engine(fake);var command=AutoCommand();command.selectedTeam="green";engine.Apply(command,time,0);
  Check(engine.Armed&&engine.AutomaticWaiting&&!engine.RequiresHotkeys&&!engine.CaptureRequested,"Automatic preparation waits without F6/F9 dependencies");
  engine.Tick(time,0);engine.Tick(time.AddMilliseconds(100),100);
  Check(fake.Captures==0&&fake.Clicks==0&&!engine.Active&&Field(engine,"attemptId")==null&&Convert.ToInt32(Field(engine,"gamePid"))==0,"No game cannot create an attempt, bind a process or click");
  fake.Frame=new TeamClickerFrame{Pid=123,Window=456,Width=1920,Height=1080};fake.FailCapture=true;engine.Tick(time.AddMilliseconds(150),150);
  Check(fake.Captures==1&&fake.Clicks==0&&!engine.Active&&engine.AutomaticWaiting&&Field(engine,"attemptId")==null,"A menu without selector keeps waiting without using a saved point");
  engine.Tick(time.AddMilliseconds(299),299);Check(fake.Captures==1,"Automatic selector scans are spaced, not a capture loop per click");
  fake.Frame.Pid=789;fake.Frame.Window=678;engine.Tick(time.AddMilliseconds(300),300);
  Check(fake.Captures==2&&engine.Armed&&!engine.Active&&Field(engine,"attemptId")==null,"PID/HWND may change before a selector is acquired");
  fake.Frame=null;engine.Tick(time.AddMilliseconds(450),450);Check(engine.Armed&&engine.AutomaticWaiting,"Focus may leave while only waiting");
  fake.Frame=new TeamClickerFrame{Pid=777,Window=888,Width=1920,Height=1080};fake.FailCapture=false;fake.DarkTarget=true;engine.Tick(time.AddMilliseconds(600),600);
  Check(engine.Active&&engine.Running&&fake.Clicks==0&&fake.CapturedTeam=="green"&&Convert.ToInt32(Field(engine,"gamePid"))==777&&Convert.ToInt64(Field(engine,"gameWindow"))==888,"The chosen dark card starts an automatic bound attempt without a key");
  Check(!String.IsNullOrEmpty((string)Field(engine,"attemptId"))&&!engine.AutomaticWaiting,"An attempt UUID is published only after current structure is acquired");
  engine.Tick(time.AddMilliseconds(601),601);fake.FailCapture=true;fake.Patch=false;engine.Tick(time.AddMilliseconds(621),621);engine.Tick(time.AddMilliseconds(641),641);
  Check(fake.Clicks==3&&fake.Captures==3&&fake.PatchCalls==0,"Automatic clicks continue on schedule without rescanning color or selector");
  engine.Toggle(time.AddMilliseconds(642),642);engine.Capture(time.AddMilliseconds(643),643);
  Check(engine.Active&&engine.Running&&fake.Captures==3,"F6 and F9 dispatch have no effect in automatic mode");
  var registration=new FakeHotkeyRegistration();var gate=new TeamClickerHotkeyGate(registration);gate.Update(command.sessionId,engine.RequiresHotkeys,false,false,engine.CaptureRequested);
  Check(registration.Registered.Count==0&&!gate.ToggleRegistered&&!gate.CaptureRegistered,"Automatic program eligibility reserves neither F6 nor F9");gate.Dispose();

  fake=new FakePlatform{Modifiers=true};engine=Engine(fake);command=AutoCommand();engine.Apply(command,time,0);engine.Tick(time,0);
  Check(fake.Captures==0&&fake.Clicks==0&&engine.Armed,"Modifiers before acquisition merely keep waiting");
  fake.Modifiers=false;engine.Tick(time.AddMilliseconds(150),150);Check(engine.Running,"Releasing modifiers before acquisition allows automatic recognition");
  fake=new FakePlatform();engine=Engine(fake);command=AutoCommand();engine.Apply(command,time,0);fake.OnCapture=()=>fake.Frame.Window++;
  engine.Tick(time,0);Check(!engine.Active&&engine.Armed&&Field(engine,"attemptId")==null&&fake.Clicks==0,"A window change during acquisition cannot commit its point");
  fake.OnCapture=null;engine.Tick(time.AddMilliseconds(150),150);Check(engine.Active&&Convert.ToInt64(Field(engine,"gameWindow"))==457,"A later stable selector binds its current window");

  fake=new FakePlatform();engine=Engine(fake);command=AutoCommand();engine.Apply(command,time,0);fake.OnCapture=()=>engine.EmergencyStop();engine.Tick(time,0);
  Check(!engine.Active&&!engine.Armed&&fake.Clicks==0&&Field(engine,"attemptId")==null,"F8 during acquisition cannot be undone by its result");
  fake.OnCapture=null;engine.Apply(AutoCommand(command.sessionId,time.AddMilliseconds(1)),time.AddMilliseconds(1),1);engine.Tick(time.AddMilliseconds(1),1);Check(!engine.Armed,"A same-session lease cannot undo F8 while waiting");
  fake=new FakePlatform();engine=Engine(fake);command=AutoCommand();engine.Apply(command,time,0);engine.EmergencyStop();engine.Tick(time,0);Check(fake.Captures==0&&fake.Clicks==0&&!engine.Armed,"F8 before seeing a selector cancels the waiting session");

  foreach(var cause in new Action<FakePlatform>[] {f=>f.FailClick=true,f=>f.Alive=false})
   AutomaticCancellation(cause,"input failure or owner loss remains terminal");

  fake=new FakePlatform{Frame=null};engine=Engine(fake);command=AutoCommand();engine.Apply(command,time,0);engine.Tick(time.AddSeconds(3),3000);
  engine.Apply(AutoCommand(command.sessionId,time.AddSeconds(4)),time.AddSeconds(4),4000);fake.Frame=new TeamClickerFrame{Pid=123,Window=456,Width=1920,Height=1080};engine.Tick(time.AddSeconds(4),4000);
  Check(!engine.Armed&&!engine.Active&&fake.Clicks==0&&(string)Field(engine,"automaticStoppedSessionId")==command.sessionId,"Expired automatic waiting does not restart through renewed leases");
  fake=new FakePlatform();engine=Engine(fake);command=AutoCommand();engine.Apply(command,time,0);engine.Apply(AutoCommand(command.sessionId,time.AddSeconds(4)),time.AddSeconds(4),4000);engine.Tick(time.AddSeconds(4),4000);
  Check(!engine.Armed&&fake.Captures==0,"An apply arriving after a silent lease gap cannot restart automatic mode");
  fake=new FakePlatform();engine=Engine(fake);command=AutoCommand();engine.Apply(command,time,0);var disabled=AutoCommand(command.sessionId,time.AddMilliseconds(1));disabled.enabled=false;engine.Apply(disabled,time.AddMilliseconds(1),1);engine.Apply(AutoCommand(command.sessionId,time.AddMilliseconds(2)),time.AddMilliseconds(2),2);engine.Tick(time.AddMilliseconds(2),2);
  Check(!engine.Armed&&fake.Captures==0,"Disabling automatic intent is terminal for that session");

  fake=new FakePlatform();engine=Engine(fake);command=AutoCommand();engine.Apply(command,time,0);engine.Tick(time,0);var proof=Proof(engine,command.sessionId,time,time.AddMilliseconds(1));proof.startMode="automatic";engine.Apply(proof,time.AddMilliseconds(1),1);
  Check(engine.Armed&&engine.Active&&Field(engine,"completedAttemptId")==null,"Zero-click automatic acquisition cannot be completed by a marker");
  engine.Tick(time.AddMilliseconds(2),2);proof=Proof(engine,command.sessionId,time.AddMilliseconds(1),time.AddMilliseconds(3));proof.startMode="automatic";engine.Apply(proof,time.AddMilliseconds(3),3);
  Check(engine.Active&&Field(engine,"completedAttemptId")==null,"An automatic marker captured before the first click is ignored");
  proof=Proof(engine,command.sessionId,time.AddMilliseconds(4),time.AddMilliseconds(5));proof.startMode="automatic";proof.entryGamePid=124;engine.Apply(proof,time.AddMilliseconds(5),5);Check(engine.Active,"Automatic marker must match the acquired process");
  string completed=(string)Field(engine,"attemptId");proof=Proof(engine,command.sessionId,time.AddMilliseconds(6),time.AddMilliseconds(7));proof.startMode="automatic";engine.Apply(proof,time.AddMilliseconds(7),7);
  Check(!engine.Active&&!engine.Armed&&(string)Field(engine,"completedAttemptId")==completed,"Fresh post-click DESPLEGANDO proof completes automatic selection");
  int total=fake.Clicks;engine.Apply(AutoCommand(command.sessionId,time.AddMilliseconds(20)),time.AddMilliseconds(20),20);engine.Tick(time.AddMilliseconds(20),20);
  Check(!engine.Armed&&fake.Clicks==total,"Automatic deployment completion remains stopped after renewed leases");
  Reject(c=>c.startMode="random","Unknown start mode is rejected");Reject(c=>{c.startMode="automatic";c.calibrateTeam="blue";},"Automatic mode cannot request F9 calibration");
 }
 static TeamClickerCommand AnyCommand(string session=null,DateTime? now=null){var command=AutoCommand(session,now);command.selectedTeam="any";return command;}
 static void ContextPauseTests(){
  foreach(var change in new Action<FakePlatform>[] {p=>p.Frame=null,p=>p.Frame.Pid++,p=>p.Frame.Window++,p=>p.Frame.Width++,p=>p.Modifiers=true}){
   var fake=new FakePlatform();var engine=Engine(fake);var command=AutoCommand();engine.Apply(command,time,0);engine.Tick(time,0);engine.Tick(time.AddMilliseconds(1),1);string attempt=(string)Field(engine,"attemptId");
   change(fake);engine.Tick(time.AddMilliseconds(21),21);int captures=fake.Captures;
   Check(engine.Active&&engine.Armed&&!engine.Running&&(bool)Field(engine,"waitingForSelector")&&(bool)Field(engine,"pausedForContext")&&fake.Clicks==1,"Automatic context loss pauses without inputs or terminal cancellation");
   Check((string)Field(engine,"attemptId")==attempt&&Field(engine,"automaticStoppedSessionId")==null&&Convert.ToInt32(Field(engine,"gamePid"))==123&&Convert.ToInt64(Field(engine,"gameWindow"))==456,"Pause preserves attempt UUID and original process/window binding");
   engine.Tick(time.AddMilliseconds(30),30);Check(fake.Captures==captures&&fake.Clicks==1,"Wrong foreground/PID/window/size/modifiers cannot capture or click while paused");
   fake.Frame=new TeamClickerFrame{Pid=123,Window=456,Width=1920,Height=1080};fake.Modifiers=false;fake.FailCapture=true;engine.Tick(time.AddMilliseconds(40),40);Check(!engine.Running&&fake.Clicks==1&&fake.Captures==captures+1,"Return requires fresh selector recognition instead of reusing old coordinates");
   fake.FailCapture=false;fake.StaleCapture=true;engine.Tick(time.AddMilliseconds(200),200);Check(!engine.Running&&fake.Clicks==1&&(bool)Field(engine,"pausedForContext"),"An old target receipt cannot resume a paused automatic attempt");
   fake.StaleCapture=false;engine.Tick(time.AddMilliseconds(400),400);Check(engine.Running&&engine.Active&&engine.Armed&&fake.Clicks==1&&!(bool)Field(engine,"pausedForContext"),"Fresh same-window selector reacquisition permits resuming");
   engine.Tick(time.AddMilliseconds(401),401);Check(fake.Clicks==2&&engine.Count==2&&(string)Field(engine,"attemptId")==attempt,"Only after fresh reacquisition does the same attempt resume clicking");
  }
  foreach(string stop in new[]{"f8","disabled","changed","lease"}){
   var fake=new FakePlatform();var engine=Engine(fake);var command=AutoCommand();engine.Apply(command,time,0);engine.Tick(time,0);engine.Tick(time.AddMilliseconds(1),1);fake.Frame=null;engine.Tick(time.AddMilliseconds(21),21);
   if(stop=="f8")engine.EmergencyStop();else if(stop=="lease")engine.Tick(time.AddMilliseconds(4000),4000);else{var update=AutoCommand(command.sessionId,time.AddMilliseconds(22));if(stop=="disabled")update.enabled=false;else update.selectedTeam="green";engine.Apply(update,time.AddMilliseconds(22),22);}
   int at=stop=="lease"?4001:30;fake.Frame=new TeamClickerFrame{Pid=123,Window=456,Width=1920,Height=1080};engine.Apply(AutoCommand(command.sessionId,time.AddMilliseconds(at)),time.AddMilliseconds(at),at);engine.Tick(time.AddMilliseconds(at),at);
   Check(!engine.Active&&!engine.Armed&&fake.Clicks==1,"Paused attempt never rearms after F8, disable, configuration change or expired lease: "+stop);
  }
  var held=new FakePlatform();var pulse=Engine(held);var action=AutoCommand();pulse.Apply(action,time,0);pulse.Tick(time,0);string id=(string)Field(pulse,"attemptId");held.AfterDown=()=>{throw new TeamClickerContextPauseException("Focus changed during pulse");};pulse.Tick(time.AddMilliseconds(1),1);
  Check(held.Buttons.SequenceEqual(new[]{true,false})&&pulse.Active&&pulse.Armed&&!pulse.Running&&pulse.Count==0,"Focus interruption during the15ms pulse always releases up and pauses instead of cancelling");
  held.AfterDown=null;pulse.Tick(time.AddMilliseconds(2),2);Check(pulse.Running&&held.Captures==2&&held.Clicks==1,"An interrupted pulse must reacquire before any new click");pulse.Tick(time.AddMilliseconds(3),3);Check(pulse.Count==1&&held.Clicks==2&&(string)Field(pulse,"attemptId")==id,"Fresh reacquisition resumes the original interrupted attempt");
  foreach(string fatal in new[]{"Windows rejected SendInput","Wardogs has higher integrity"}){held=new FakePlatform();pulse=Engine(held);action=AutoCommand();pulse.Apply(action,time,0);pulse.Tick(time,0);held.AfterDown=()=>{throw new InvalidOperationException(fatal);};pulse.Tick(time.AddMilliseconds(1),1);Check(!pulse.Active&&!pulse.Armed&&held.Buttons.SequenceEqual(new[]{true,false}),"Only typed context interruption pauses; input/integrity failures remain terminal");}
  held=new FakePlatform();pulse=Engine(held);action=AutoCommand();pulse.Apply(action,time,0);pulse.Tick(time,0);pulse.Tick(time.AddMilliseconds(1),1);held.Frame=null;pulse.Tick(time.AddMilliseconds(2),2);var proof=Proof(pulse,action.sessionId,time.AddMilliseconds(3),time.AddMilliseconds(4));proof.startMode="automatic";pulse.Apply(proof,time.AddMilliseconds(4),4);Check(!pulse.Active&&!pulse.Armed&&Field(pulse,"completedAttemptId")!=null&&held.Clicks==1,"Fresh bound DESPLEGANDO can complete the same post-click attempt while context is paused");
  held=new FakePlatform();pulse=Engine(held);action=AutoCommand();pulse.Apply(action,time,0);pulse.Tick(time,0);held.Frame=null;pulse.Tick(time.AddMilliseconds(1),1);proof=Proof(pulse,action.sessionId,time.AddMilliseconds(2),time.AddMilliseconds(3));proof.startMode="automatic";pulse.Apply(proof,time.AddMilliseconds(3),3);Check(pulse.Active&&pulse.Armed&&Field(pulse,"completedAttemptId")==null&&held.Clicks==0,"Manual deployment before the first completed own click cannot invent a confirmation");
  held=new FakePlatform();pulse=new TeamClickerEngine(held,null,()=>0,maximum=>0);action=AnyCommand();pulse.Apply(action,time,0);pulse.Tick(time,0);pulse.Tick(time.AddMilliseconds(1),1);held.Frame=null;pulse.Tick(time.AddMilliseconds(2),2);held.Frame=new TeamClickerFrame{Pid=123,Window=456,Width=1920,Height=1080};pulse.Tick(time.AddMilliseconds(3),3);Check(pulse.Running&&held.AnyCaptures==2&&held.Clicks==1,"Any-team mode refreshes all selector candidates after context returns");pulse.Tick(time.AddMilliseconds(4),4);Check(held.Clicks==2,"Any-team resumes only after its fresh shared selector scan");
  held=new FakePlatform{AvailableTeams=new[]{"blue"}};pulse=new TeamClickerEngine(held,null,()=>0,maximum=>0);action=AnyCommand();pulse.Apply(action,time,0);pulse.Tick(time,0);pulse.Tick(time.AddMilliseconds(1),1);held.AvailableTeams=new[]{"green"};held.AfterDown=()=>{throw new TeamClickerContextPauseException("Context changed after new-color down");};pulse.Tick(time.AddMilliseconds(21),21);Check(pulse.Active&&pulse.Armed&&!pulse.Running&&Field(pulse,"actualTeam")==null&&pulse.Count==1,"An interrupted any-team pulse cannot inherit the previously clicked color as a new deployment proof");pulse.Apply(AnyProof(pulse,action.sessionId,22,23,"blue"),time.AddMilliseconds(23),23);Check(Field(pulse,"completedAttemptId")==null&&pulse.Active,"Old-color DESPLEGANDO is not attributed after a partially delivered any-team pulse");
 }
 static TeamClickerCommand AnyProof(TeamClickerEngine engine,string session,int capturedMs,int observedMs,string team){var proof=Proof(engine,session,time.AddMilliseconds(capturedMs),time.AddMilliseconds(observedMs));proof.startMode="automatic";proof.selectedTeam="any";proof.entryActualTeam=team;return proof;}
 static void AnyTeamTests(){
  Check(TeamClickerCommand.IsSelection("any")&&!TeamClickerCommand.IsTeam("any"),"Any is a request, never an actual faction");
  AnyCommand().Validate(time);Check(true,"Automatic any command is valid");
  Reject(c=>{c.selectedTeam="any";c.calibrateTeam="any";},"Any cannot be saved as a fixed-team calibration");
  Reject(c=>c.entryActualTeam="any","Any cannot be an actual-team receipt");
  Reject(c=>c.entryActualTeam="orange","Unknown actual-team receipt rejected");
  RejectProof(c=>c.entryActualTeam="red","A fixed-blue proof cannot claim red");
  var fake=new FakePlatform{AvailableTeams=new string[0]};int randomCalls=0;
  var engine=new TeamClickerEngine(fake,null,()=>0,maximum=>{randomCalls++;return maximum-1;});var command=AnyCommand();engine.Apply(command,time,0);engine.Tick(time,0);
  string attempt=(string)Field(engine,"attemptId");
  Check(engine.Active&&engine.Running&&fake.AnyCaptures==1&&fake.Captures==0&&fake.Clicks==0,"Any acquires all candidates in one scan without clicking or picking a closed team");
  Check((string)Field(engine,"selectedTeam")=="any"&&(string)Field(engine,"requestedTeam")=="any"&&Field(engine,"actualTeam")==null,"Requested and actual team remain distinct before clicking");
  engine.Apply(AnyProof(engine,command.sessionId,0,1,"green"),time.AddMilliseconds(1),1);
  Check(engine.Active&&Field(engine,"completedAttemptId")==null,"Zero-click any proof cannot complete");
  engine.Tick(time.AddMilliseconds(1),1);engine.Tick(time.AddMilliseconds(20),20);
  Check(fake.Clicks==0&&fake.AvailabilityReads==1&&randomCalls==0&&engine.Active,"All closed teams wait with interval limiting, no random closed choice");
  fake.AvailableTeams=new[]{"blue","green"};engine.Tick(time.AddMilliseconds(21),21);
  Check(fake.Clicks==1&&fake.ClickedX.Last()==500&&(string)Field(engine,"actualTeam")=="green"&&randomCalls==1,"Random selection uses only currently available candidates");
  engine.Tick(time.AddMilliseconds(41),41);Check(fake.Clicks==2&&fake.ClickedX.Last()==500&&randomCalls==1,"Chosen color continues while available without unnecessary random switching");
  fake.AvailableTeams=new[]{"blue"};engine.Tick(time.AddMilliseconds(61),61);
  Check(fake.Clicks==3&&fake.ClickedX.Last()==100&&(string)Field(engine,"actualTeam")=="blue"&&(string)Field(engine,"attemptId")==attempt,"Closing chosen color switches to another available team within the same attempt");
  Check(fake.AnyCaptures==1&&fake.Captures==0&&fake.PatchCalls==0,"Any reuses structural acquisition instead of three full scans per click");
  fake.AvailableTeams=new string[0];engine.Tick(time.AddMilliseconds(81),81);
  Check(fake.Clicks==3&&engine.Active&&engine.Armed&&(string)Field(engine,"actualTeam")=="blue","Selector disappearance or no available logos pauses clicks while retaining proof intent");
  engine.Apply(AnyProof(engine,command.sessionId,82,83,null),time.AddMilliseconds(83),83);Check(engine.Active,"Any proof requires an actual color");
  engine.Apply(AnyProof(engine,command.sessionId,40,84,"blue"),time.AddMilliseconds(84),84);Check(engine.Active&&Field(engine,"completedAttemptId")==null,"Capture from before the latest color switch cannot prove the new color");
  engine.Apply(AnyProof(engine,command.sessionId,84,85,"green"),time.AddMilliseconds(85),85);Check(engine.Active&&Field(engine,"completedAttemptId")==null,"Stale chosen-color receipt cannot acknowledge a switched attempt");
  engine.Apply(AnyProof(engine,command.sessionId,86,87,"blue"),time.AddMilliseconds(87),87);
  Check(!engine.Active&&!engine.Armed&&(string)Field(engine,"completedAttemptId")==attempt&&(string)Field(engine,"completedActualTeam")=="blue"&&(string)Field(engine,"actualTeam")=="blue"&&(string)Field(engine,"requestedTeam")=="any","Any receipt preserves requested any and actual entered color");
  engine.Apply(AnyCommand(command.sessionId,time.AddMilliseconds(90)),time.AddMilliseconds(90),90);engine.Tick(time.AddMilliseconds(100),100);Check(fake.Clicks==3&&!engine.Armed,"Completed any intent cannot resume via renewal");
  var fresh=AnyCommand(null,time.AddMilliseconds(110));engine.Apply(fresh,time.AddMilliseconds(110),110);Check(engine.Armed&&Field(engine,"actualTeam")==null&&Field(engine,"completedActualTeam")==null,"New any session clears the previous actual-team proof");
  engine.Apply(AnyCommand(command.sessionId,time.AddMilliseconds(120)),time.AddMilliseconds(120),120);Check(!engine.Armed&&(string)Field(engine,"completedActualTeam")=="blue","Completed old session retains its own actual-team receipt");

  fake=new FakePlatform();engine=new TeamClickerEngine(fake,null,()=>0,maximum=>0);command=AnyCommand();engine.Apply(command,time,0);engine.Tick(time,0);fake.OnAvailable=()=>engine.EmergencyStop();engine.Tick(time.AddMilliseconds(1),1);
  Check(!engine.Armed&&!engine.Active&&fake.Clicks==0&&Field(engine,"actualTeam")==null,"F8 during a shared availability read cannot be undone by its return");
  fake.OnAvailable=null;engine.Apply(AnyCommand(command.sessionId,time.AddMilliseconds(2)),time.AddMilliseconds(2),2);engine.Tick(time.AddMilliseconds(2),2);Check(!engine.Armed&&fake.Clicks==0,"Same-session renewal cannot undo any-mode F8");
  fake=new FakePlatform();engine=new TeamClickerEngine(fake,null,()=>0,maximum=>0);command=AnyCommand();engine.Apply(command,time,0);fake.OnCapture=()=>{throw new TeamClickerOperatorStopException();};engine.Tick(time,0);
  Check(!engine.Armed&&fake.Clicks==0&&(string)Field(engine,"operatorStoppedSessionId")==command.sessionId,"A native F8 observed during acquisition is terminal, not a retry");
  fake=new FakePlatform();engine=new TeamClickerEngine(fake,null,()=>0,maximum=>0);command=AnyCommand();engine.Apply(command,time,0);engine.Tick(time,0);fake.OnAvailable=()=>{throw new TeamClickerOperatorStopException();};engine.Tick(time.AddMilliseconds(1),1);
  Check(!engine.Armed&&fake.Clicks==0&&(string)Field(engine,"operatorStoppedSessionId")==command.sessionId,"A native F8 observed during availability read is terminal");
  foreach(var change in new Action<FakePlatform>[] {p=>p.Frame=null,p=>p.Frame.Window++,p=>p.Frame.Pid++,p=>p.Frame.Width++,p=>p.Modifiers=true,p=>p.Alive=false}){
   fake=new FakePlatform();engine=new TeamClickerEngine(fake,null,()=>0,maximum=>0);command=AnyCommand();engine.Apply(command,time,0);engine.Tick(time,0);var current=fake;fake.OnAvailable=()=>change(current);engine.Tick(time.AddMilliseconds(1),1);
   Check(fake.Clicks==0&&(fake.Alive?engine.Active&&engine.Armed&&!engine.Running:( !engine.Active&&!engine.Armed)),"Availability read pauses changed context but owner loss is terminal before clicking");
  }
  double elapsed=0;fake=new FakePlatform();engine=new TeamClickerEngine(fake,null,()=>elapsed,maximum=>0);command=AnyCommand();engine.Apply(command,time,0);engine.Tick(time,0);fake.OnAvailable=()=>elapsed+=4000;engine.Tick(time.AddMilliseconds(1),1);
  Check(!engine.Armed&&!engine.Active&&fake.Clicks==0,"Lease expiry during availability read forbids any click");
  fake=new FakePlatform{FailClick=true};engine=new TeamClickerEngine(fake,null,()=>0,maximum=>0);command=AnyCommand();engine.Apply(command,time,0);engine.Tick(time,0);engine.Tick(time.AddMilliseconds(1),1);Check(!engine.Armed&&Field(engine,"actualTeam")==null&&engine.Count==0,"Rejected input never claims an actual entered color");
 }
 static void ValidationTests(){
  Reject(c=>c.intervalMs=19,"Interval lower bound");Reject(c=>c.intervalMs=2001,"Interval upper bound");Reject(c=>c.toggleKey="F8","Stop key cannot become toggle");Reject(c=>c.captureKey="F7","Movement key cannot capture");Reject(c=>c.selectedTeam="unknown","Unknown team rejected");Reject(c=>c.calibrateTeam="red","Recognition target must match selected team");Reject(c=>c.expiresAt=time.ToString("o"),"Expired lease rejected");Reject(c=>c.expiresAt=time.AddSeconds(6).ToString("o"),"Unbounded lease rejected");Reject(c=>c.id="x","Invalid command ID rejected");Reject(c=>c.servicePid=0,"Missing owner rejected");Reject(c=>c.issuedAt=time.AddSeconds(2).ToString("o"),"Future command rejected");Reject(c=>c.expiresAt="2026-10-31T11:00:00+01:00","Non-UTC date rejected");
  var invalid=Target();invalid.x=1920;Check(!invalid.Valid(),"Out-of-client coordinate rejected");invalid=Target();invalid.signature=new int[0];Check(!invalid.Valid(),"Missing signature rejected");invalid=Target();invalid.patchLeft=1910;Check(!invalid.Valid(),"Patch outside client rejected");
  foreach(int logo in new[]{0x4fb0e6,0xff4a32,0x0cce58}){
   int total=logo==0x4fb0e6?12:logo==0xff4a32?20:35;int[] expected=Enumerable.Repeat(logo,total).Concat(Enumerable.Repeat(0x161616,45-total)).ToArray();
   Check(TeamClickerPatch.Matches(expected,(int[])expected.Clone()),"Diagnostic patch accepts same logo");
   Check(!TeamClickerPatch.Matches(expected,Enumerable.Repeat(0x161616,45).ToArray()),"Diagnostic patch rejects removed saturated logo despite dark majority");
  }
  Check(!TeamClickerPatch.Matches(new int[45],new int[45]),"Dark-only patch is not a logo diagnostic");
  Check(!TeamClickerPatch.Matches(new int[45],new int[1]),"Malformed diagnostic patch rejected");
 }
 static object TimerSample(Action wait,Func<string> mode){
  var clock=System.Diagnostics.Stopwatch.StartNew();DateTime started=DateTime.UtcNow;
  var fake=new FakePlatform();var engine=Engine(fake,false,()=>clock.Elapsed.TotalMilliseconds);var command=Command(null,started);
  engine.Apply(command,started,0);engine.Toggle(started,0);var clicks=new List<double>();int previous=0;
  while(clock.Elapsed.TotalMilliseconds<900){double mono=clock.Elapsed.TotalMilliseconds;engine.Tick(started.AddMilliseconds(mono),mono);if(engine.Count!=previous){clicks.Add(clock.Elapsed.TotalMilliseconds);previous=engine.Count;}wait();}
  engine.Stop("Fin de la sonda sin entradas nativas.");
  var intervals=clicks.Skip(1).Select((value,index)=>value-clicks[index]).OrderBy(value=>value).ToArray();
  object distribution=intervals.Length==0?null:new{minimum=intervals.First(),median=intervals.Length%2==1?intervals[intervals.Length/2]:(intervals[intervals.Length/2-1]+intervals[intervals.Length/2])*.5,maximum=intervals.Last(),samples=intervals.Length};
  return new{waitMode=mode(),durationMs=clock.Elapsed.TotalMilliseconds,configuredClickIntervalMs=20,clickCount=clicks.Count,intervalsMs=distribution};
 }
 static int TimerProbe(){
  object baseline=TimerSample(()=>System.Threading.Thread.Sleep(2),()=>"thread_sleep_2ms");object precise;string error;
  using(var waiter=new TeamClickerWaiter()){precise=TimerSample(()=>waiter.Delay(2),()=>waiter.Mode);error=waiter.Error;}
  Console.WriteLine(new JavaScriptSerializer().Serialize(new{format="wardogs-team-clicker-timer-probe-v1",at=DateTime.UtcNow.ToString("o"),nativeInputsAllowed=false,keyboardOrMouseOrHotkeysUsed=false,platform="FakePlatform",samples=new[]{baseline,precise},timerError=error}));return 0;
 }
 static int Main(string[] args){if(args.Length==2&&args[0]=="--image")return Probe(args[1]);if(args.Length==1&&args[0]=="--timer-probe")return TimerProbe();try{
  EngineTests();AutomaticTests();ConfirmationTests();AnyTeamTests();ContextPauseTests();ValidationTests();ButtonPulseTests();HotkeyTests();LogoTests();checks+=TeamClickerSelectorFrameTests.Run();checks+=TeamClickerWaiterTests.Run();
  Console.WriteLine("Team clicker: "+checks+" checks passed; no native input or hotkey calls invoked.");return 0;
 }catch(Exception error){Console.Error.WriteLine(error);return 1;}}
}
