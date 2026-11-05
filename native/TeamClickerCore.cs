using System;
using System.Collections.Generic;
using System.Globalization;
using System.Diagnostics;

namespace WardogsSeeding {
 public sealed class TeamClickerCommand {
  public string format,id,sessionId,issuedAt,expiresAt,selectedTeam,toggleKey,captureKey,calibrateTeam,startMode;
  public string entryAttemptId,entryCapturedAt,entryActualTeam;
  public int intervalMs,servicePid,entryGamePid;
  public long entryGameWindow;
  public bool enabled;
  public MousePauseSettings mousePause;
  public string StartMode {get{return startMode??"hotkey";}}
  public DateTime ExpiresUtc {get{return Utc(expiresAt);}}
  internal static DateTime Utc(string text){
   DateTime value;
   if(String.IsNullOrEmpty(text)||!text.EndsWith("Z",StringComparison.Ordinal)||!DateTime.TryParse(text,CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind,out value)||value.Kind!=DateTimeKind.Utc)
    throw new ArgumentException("La concesion del autoclic no tiene una fecha UTC valida.");
   return value;
  }
  public static bool IsTeam(string value){return value=="blue"||value=="red"||value=="green";}
  public static bool IsSelection(string value){return IsTeam(value)||value=="any";}
  public void Validate(DateTime now){
   MousePauseSettings.Normalize(mousePause);
   Guid command,session;
   if(format!="wardogs-team-clicker-command-v1"||!Guid.TryParse(id,out command)||!Guid.TryParse(sessionId,out session)||servicePid<=0)throw new ArgumentException("Orden de autoclic no valida.");
   DateTime issued=Utc(issuedAt),expires=ExpiresUtc;
   if(issued>now.AddSeconds(1)||expires<=now||expires<=issued||(expires-issued).TotalSeconds>5||now-issued>TimeSpan.FromSeconds(5))throw new ArgumentException("La concesion del autoclic ha vencido.");
   if(!IsSelection(selectedTeam)||intervalMs<20||intervalMs>2000||toggleKey!="F6"||captureKey!="F9"||(calibrateTeam!=null&&(!IsTeam(calibrateTeam)||calibrateTeam!=selectedTeam))||(StartMode!="hotkey"&&StartMode!="automatic")||(StartMode=="automatic"&&calibrateTeam!=null)||(entryActualTeam!=null&&!IsTeam(entryActualTeam)))throw new ArgumentException("Ajustes de autoclic no validos.");
  }
 }
 public sealed class TeamClickerTarget {
  public int x,y,width,height,patchLeft,patchTop,patchWidth,patchHeight;
  public string capturedAt;
  public int[] signature;
  public bool Valid(){
   DateTime captured;
   return width>=320&&height>=200&&width<=8000&&height<=8000&&x>=0&&y>=0&&x<width&&y<height&&patchWidth==64&&patchHeight==32&&patchLeft>=0&&patchTop>=0&&patchLeft+patchWidth<=width&&patchTop+patchHeight<=height&&signature!=null&&signature.Length==45&&DateTime.TryParse(capturedAt,CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind,out captured)&&captured.Kind==DateTimeKind.Utc;
  }
  public object PublicView(){return new{configured=true,x=x,y=y,width=width,height=height,capturedAt=capturedAt};}
 }
 public sealed class TeamClickerFrame {public int Pid,Width,Height;public long Window;}
 public interface ITeamClickerPlatform {
  bool ServiceAlive(int pid);
  bool ModifiersDown();
  TeamClickerFrame ForegroundGame();
  // Acquire the requested team's card from a verified selector structure,
  // even when its colored logo is hidden. No color gates the subsequent loop.
  TeamClickerTarget CaptureTarget(TeamClickerFrame frame,DateTime now,string selectedTeam);
  bool PatchMatches(TeamClickerFrame frame,TeamClickerTarget target);
  void Click(TeamClickerFrame frame,TeamClickerTarget target);
 }
 public interface ITeamClickerButtonInput {void Button(bool down);}
 public interface ITeamClickerMousePlatform {void ConfigureMousePause(MousePauseSettings settings,bool enabled);MousePauseSnapshot MousePause(DateTime now);long MouseRevision {get;}}
 public sealed class TeamClickerOperatorStopException:InvalidOperationException {public TeamClickerOperatorStopException():base("Detenido con F8.") {}}
 public sealed class TeamClickerContextPauseException:InvalidOperationException {public TeamClickerContextPauseException(string message):base(message) {}}
 public interface ITeamClickerAnyPlatform {
  Dictionary<string,TeamClickerTarget> CaptureAnyTargets(TeamClickerFrame frame,DateTime now);
  Dictionary<string,TeamClickerTarget> AvailableTargets(TeamClickerFrame frame,DateTime now);
 }
 public static class TeamClickerButton {public static void Click(ITeamClickerButtonInput input,Action afterDown=null){try{input.Button(true);if(afterDown!=null)afterDown();}finally{input.Button(false);}}}
 public sealed class TeamClickerKeyEdges {
  bool toggle,capture,stop;
  public TeamClickerKeyEdges(bool toggleHeld,bool captureHeld,bool stopHeld){toggle=toggleHeld;capture=captureHeld;stop=stopHeld;}
  public int Read(bool toggleDown,bool captureDown,bool stopDown){int action=stopDown&&!stop?8:captureDown&&!capture?9:toggleDown&&!toggle?6:0;toggle=toggleDown;capture=captureDown;stop=stopDown;return action;}
 }
 public static class TeamClickerPatch {
  public static byte LogoColor(int rgb){
   int r=(rgb>>16)&255,g=(rgb>>8)&255,b=rgb&255;
   if(b>=145&&g>=85&&r<=155&&b-r>=60&&b-g>=12)return 1;
   if(r>=155&&g<=130&&b<=130&&r-g>=65&&r-b>=65)return 2;
   if(g>=140&&r<=120&&b<=165&&g-r>=65&&g-b>=30)return 3;
   return 0;
  }
  public static bool Matches(int[] expected,int[] actual){
   if(expected==null||actual==null||expected.Length!=45||actual.Length!=expected.Length)return false;
   int close=0,colored=0,persistent=0;
   for(int i=0;i<expected.Length;i++){
    byte logo=LogoColor(expected[i]);if(logo!=0){colored++;if(LogoColor(actual[i])==logo)persistent++;}
    int r=Math.Abs(((expected[i]>>16)&255)-((actual[i]>>16)&255)),g=Math.Abs(((expected[i]>>8)&255)-((actual[i]>>8)&255)),b=Math.Abs((expected[i]&255)-(actual[i]&255));
    if(r<=64&&g<=64&&b<=64&&r+g+b<=105)close++;
   }
   return close>=32&&colored>=3&&persistent>=Math.Max(3,(int)Math.Ceiling(colored*.6));
  }
 }
 public sealed class TeamClickerEngine {
  const int RecognitionIntervalMs=150;
  readonly ITeamClickerPlatform platform;
  readonly Dictionary<string,TeamClickerTarget> targets;
  readonly Dictionary<string,string> completed=new Dictionary<string,string>();
  readonly Dictionary<string,string> completedTeams=new Dictionary<string,string>();
  readonly Dictionary<string,string> automaticStops=new Dictionary<string,string>();
  readonly Func<double> elapsedNow;
  readonly Func<int,int> chooseIndex;
  TeamClickerCommand command;
  TeamClickerFrame attemptFrame;
  double leaseMono,nextClickMono,nextRecognitionMono,lastMono;
  DateTime attemptStartedUtc,firstClickUtc,actualTeamSinceUtc;
  bool armed,active,running,waitingForSelector,targetsChanged,pausedForContext,pausedForMouse;
  string reason="Autoclic desactivado.",error,operatorStoppedSessionId,attemptId,actualTeam;
  int count;
  long controlEpoch;
  public TeamClickerEngine(ITeamClickerPlatform native,Dictionary<string,TeamClickerTarget> saved,Func<double> measureElapsed=null,Func<int,int> chooseAvailable=null){
   platform=native;elapsedNow=measureElapsed??(()=>Stopwatch.GetTimestamp()*1000d/Stopwatch.Frequency);targets=new Dictionary<string,TeamClickerTarget>();
   var random=new Random();chooseIndex=chooseAvailable??(maximum=>random.Next(maximum));
   if(saved!=null)foreach(var item in saved)if(TeamClickerCommand.IsTeam(item.Key)&&item.Value!=null&&item.Value.Valid())targets[item.Key]=item.Value;
  }
  public bool Running {get{return running;}}
  public bool Active {get{return active;}}
  public bool Armed {get{return armed;}}
  bool Automatic {get{return command!=null&&command.StartMode=="automatic";}}
  public bool RequiresHotkeys {get{return command!=null&&!Automatic;}}
  public bool AutomaticWaiting {get{return Automatic&&armed&&!active;}}
  public bool CaptureRequested {get{return RequiresHotkeys&&command.calibrateTeam!=null;}}
  public string Reason {get{return reason;}}
  public int Count {get{return count;}}
  public bool TargetsChanged {get{return targetsChanged;}}
  public Dictionary<string,TeamClickerTarget> Targets {get{return targets;}}
  public void TargetsSaved(){targetsChanged=false;}
  public void Stop(string message){controlEpoch++;active=false;running=false;waitingForSelector=false;pausedForContext=false;pausedForMouse=false;attemptFrame=null;reason=message;}
  MousePauseSnapshot MouseState(DateTime now){var source=platform as ITeamClickerMousePlatform;return source==null?new MousePauseSnapshot():source.MousePause(now);}
  long MouseVersion(){var source=platform as ITeamClickerMousePlatform;return source==null?0:source.MouseRevision;}
  bool MouseChanged(long before,DateTime now,double mono){if(MouseVersion()==before)return MousePaused(now,mono);pausedForMouse=true;if(active)ContextChanged("El raton se movio durante el reconocimiento.",mono);else{running=false;waitingForSelector=true;reason="El raton se movio durante el reconocimiento; esperando una captura nueva.";}return true;}
  bool MousePaused(DateTime now,double mono){
   var pause=MouseState(now);if(!pause.active)return false;
   pausedForMouse=true;if(active)ContextChanged("Pausado mientras usas el raton.",mono);else{running=false;waitingForSelector=true;reason="Pausado mientras usas el raton. Se reanudara al soltarlo.";}return true;
  }
  void CancelAutomatic(string message){if(Automatic)automaticStops[command.sessionId]=message;armed=false;Stop(message);}
  void StopAttempt(string message){if(Automatic)CancelAutomatic(message);else Stop(message);}
  void ContextChanged(string message,double mono){
   if(!Automatic){StopAttempt(message);return;}
   if(!pausedForContext){controlEpoch++;nextRecognitionMono=mono;}
   pausedForContext=true;running=false;waitingForSelector=true;error=null;reason=message+" Se reconocera de nuevo el selector al volver a la misma ventana de Wardogs.";
  }
  public void Fail(string message){if(Automatic)CancelAutomatic(message);else{armed=false;Stop(message);}error=message;}
  public void EmergencyStop(){operatorStoppedSessionId=command==null?null:command.sessionId;string message="Detenido con F8. Activa de nuevo el autoclic en la app.";if(Automatic)CancelAutomatic(message);else{armed=false;Stop(message);}}
  bool Lease(DateTime now,double mono){
   if(command==null||!armed)return false;
   if(mono<lastMono||mono>=leaseMono||now>=command.ExpiresUtc||!platform.ServiceAlive(command.servicePid)){if(Automatic)CancelAutomatic("La app no responde o la concesion del autoclic ha vencido.");else{armed=false;Stop("La app no responde o la concesion del autoclic ha vencido.");}return false;}
   lastMono=mono;return true;
  }
  static bool SameFrame(TeamClickerFrame first,TeamClickerFrame second){return first!=null&&second!=null&&first.Pid==second.Pid&&first.Window==second.Window&&first.Width==second.Width&&first.Height==second.Height;}
  static bool ValidAnyTargets(Dictionary<string,TeamClickerTarget> values,TeamClickerFrame frame){
   if(values==null||values.Count!=3)return false;
   foreach(string team in new[]{"blue","red","green"}){TeamClickerTarget value;if(!values.TryGetValue(team,out value)||value==null||!value.Valid()||value.width!=frame.Width||value.height!=frame.Height)return false;}return true;
  }
  static bool FreshTarget(TeamClickerTarget value,DateTime began,DateTime ended){DateTime captured;return value!=null&&DateTime.TryParse(value.capturedAt,CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind,out captured)&&captured.Kind==DateTimeKind.Utc&&captured>=began&&captured<=ended;}
  static bool FreshTargets(string team,TeamClickerTarget target,Dictionary<string,TeamClickerTarget> all,DateTime began,DateTime ended){if(team!="any")return FreshTarget(target,began,ended);if(all==null)return false;foreach(var value in all.Values)if(!FreshTarget(value,began,ended))return false;return true;}
  ITeamClickerAnyPlatform AnyPlatform {get{var native=platform as ITeamClickerAnyPlatform;if(native==null)throw new InvalidOperationException("Este controlador no admite equipo aleatorio.");return native;}}
  void SaveTargets(string team,TeamClickerTarget target,Dictionary<string,TeamClickerTarget> all){
   if(team=="any")foreach(var item in all)targets[item.Key]=item.Value;else targets[team]=target;
   targetsChanged=true;
  }
  bool ConfirmEntry(TeamClickerCommand value,DateTime now){
   if(!active||attemptFrame==null||count<1||String.IsNullOrEmpty(attemptId)||value.entryAttemptId!=attemptId||value.entryGamePid!=attemptFrame.Pid||value.entryGameWindow!=attemptFrame.Window)return false;
   DateTime captured;try{captured=TeamClickerCommand.Utc(value.entryCapturedAt);}catch{return false;}
   double age=(now-captured).TotalMilliseconds;
   if(captured<attemptStartedUtc||captured<firstClickUtc||age<0||age>5000)return false;
   if(!TeamClickerCommand.IsTeam(actualTeam)||(value.selectedTeam=="any"&&(value.entryActualTeam!=actualTeam||captured<actualTeamSinceUtc))||(value.entryActualTeam!=null&&value.entryActualTeam!=actualTeam))return false;
   completed[value.sessionId]=attemptId;completedTeams[value.sessionId]=actualTeam;armed=false;error=null;Stop("Entrada confirmada en el juego. Autoclic terminado.");return true;
  }
  public void Apply(TeamClickerCommand value,DateTime now,double mono){
   try{value.Validate(now);}catch(Exception ex){Fail(ex.Message);return;}
   if(command!=null&&armed&&(mono<lastMono||mono>=leaseMono||now>=command.ExpiresUtc||!platform.ServiceAlive(command.servicePid))){if(Automatic)CancelAutomatic("La concesion anterior vencio. Activa de nuevo la seleccion en la app.");else{armed=false;Stop("La concesion anterior vencio. Pulsa F6 para iniciar de nuevo.");}}
   if(command!=null&&value.id==command.id)return;
   bool newSession=command==null||value.sessionId!=command.sessionId;
   bool changed=newSession||value.enabled!=command.enabled||value.selectedTeam!=command.selectedTeam||value.intervalMs!=command.intervalMs||value.calibrateTeam!=command.calibrateTeam||value.servicePid!=command.servicePid||value.StartMode!=command.StartMode;
   if(changed&&Automatic&&!newSession)CancelAutomatic("Seleccion detenida o modificada. Activa una nueva espera desde la app.");
   if(changed)Stop(value.StartMode=="automatic"?"Esperando el selector de facciones de Wardogs.":"Preparado: F6 inicia y detiene; F8 detiene todo.");
   if(newSession){count=0;attemptId=null;actualTeam=null;attemptStartedUtc=DateTime.MinValue;firstClickUtc=DateTime.MinValue;}
   command=value;leaseMono=mono+Math.Min(5000,(value.ExpiresUtc-now).TotalMilliseconds);lastMono=mono;error=null;
   armed=value.enabled&&value.sessionId!=operatorStoppedSessionId&&!completed.ContainsKey(value.sessionId)&&!automaticStops.ContainsKey(value.sessionId);
   var mouse=platform as ITeamClickerMousePlatform;if(mouse!=null)mouse.ConfigureMousePause(value.mousePause,armed&&Automatic);
   if(!armed){Stop(completed.ContainsKey(value.sessionId)?"Entrada confirmada en el juego. Autoclic terminado.":value.sessionId==operatorStoppedSessionId?"Detenido con F8. Activa de nuevo el autoclic en la app.":automaticStops.ContainsKey(value.sessionId)?automaticStops[value.sessionId]:"Autoclic desactivado.");return;}
   if(ConfirmEntry(value,now))return;
   if(!active&&value.calibrateTeam!=null)reason="Abre Seleccionar faccion y pulsa F9 para reconocer el equipo sin clicar.";
   if(Automatic&&!active){waitingForSelector=true;if(changed)nextRecognitionMono=mono;}
  }
  public void Capture(DateTime now,double mono){
   if(!Lease(now,mono)||command.calibrateTeam==null)return;
   Stop("Reconociendo el selector de faccion.");
   try{
    if(platform.ModifiersDown())throw new InvalidOperationException("Suelta Ctrl, Alt y Mayus antes de reconocer el equipo.");
    var frame=platform.ForegroundGame();if(frame==null)throw new InvalidOperationException("Pon Wardogs delante y abre Seleccionar faccion.");
    var target=platform.CaptureTarget(frame,now,command.selectedTeam);if(target==null||!target.Valid())throw new InvalidOperationException("El equipo reconocido no es valido.");
    targets[command.calibrateTeam]=target;targetsChanged=true;reason="Equipo reconocido. F6 comprobara de nuevo el selector antes de clicar.";error=null;
   }catch(Exception ex){Stop(ex.Message);error=ex.Message;}
  }
  void RecognizeForAttempt(DateTime now,double mono){
   if(MousePaused(now,mono))return;
   string expectedSession=command.sessionId,expectedAttempt=attemptId,expectedTeam=command.selectedTeam;
   long expectedEpoch=controlEpoch,mouseBefore=MouseVersion();bool needsFresh=pausedForContext;
   double began=elapsedNow();TeamClickerTarget target=null;Dictionary<string,TeamClickerTarget> all=null;string unavailable=null;
   try{if(expectedTeam=="any")all=AnyPlatform.CaptureAnyTargets(attemptFrame,now);else target=platform.CaptureTarget(attemptFrame,now,expectedTeam);}catch(TeamClickerOperatorStopException){EmergencyStop();return;}catch(Exception ex){unavailable=ex.Message;}
   double elapsed=elapsedNow()-began;
   if(Double.IsNaN(elapsed)||Double.IsInfinity(elapsed)||elapsed<0){Fail("El reloj del reconocimiento no es valido.");return;}
   if(!active||!armed||controlEpoch!=expectedEpoch||command.sessionId!=expectedSession||attemptId!=expectedAttempt||command.selectedTeam!=expectedTeam)return;
   if(!Lease(now.AddMilliseconds(elapsed),mono+elapsed))return;
   if(MouseChanged(mouseBefore,now.AddMilliseconds(elapsed),mono+elapsed))return;
   if(!SameFrame(platform.ForegroundGame(),attemptFrame)){ContextChanged("Wardogs ha perdido el foco o ha cambiado su ventana.",mono+elapsed);return;}
   if(platform.ModifiersDown()){ContextChanged("Esperando que sueltes las teclas modificadoras.",mono+elapsed);return;}
   bool verified=expectedTeam=="any"?ValidAnyTargets(all,attemptFrame):target!=null&&target.Valid()&&target.width==attemptFrame.Width&&target.height==attemptFrame.Height;
   if(needsFresh&&!FreshTargets(expectedTeam,target,all,now,now.AddMilliseconds(elapsed)))verified=false;
   // Only initial acquisition waits for structural proof. Once acquired, the
   // click loop continues through a hidden/disabled color until positive entry.
   if(!verified){
    running=false;waitingForSelector=true;nextRecognitionMono=mono+elapsed+RecognitionIntervalMs;error=null;
    reason="Esperando poder reconocer las tarjetas del selector."+(String.IsNullOrEmpty(unavailable)?"":" "+unavailable);return;
   }
   SaveTargets(expectedTeam,target,all);running=true;waitingForSelector=false;pausedForContext=false;error=null;
   nextClickMono=mono+elapsed;reason="Tarjeta reconocida. Intentando entrar hasta detectar DESPLEGANDO.";
  }
  public void Toggle(DateTime now,double mono){
   if(Automatic)return;
   if(active){Stop("Autoclic detenido con F6.");return;}
   if(!Lease(now,mono))return;
   try{
    if(command.calibrateTeam!=null)throw new InvalidOperationException("Espera a que termine el reconocimiento antes de usar F6.");
    if(platform.ModifiersDown())throw new InvalidOperationException("Suelta Ctrl, Alt y Mayus antes de iniciar.");
    var frame=platform.ForegroundGame();if(frame==null)throw new InvalidOperationException("Pon Wardogs en primer plano para iniciar el autoclic.");
    attemptFrame=new TeamClickerFrame{Pid=frame.Pid,Window=frame.Window,Width=frame.Width,Height=frame.Height};
    attemptId=Guid.NewGuid().ToString("D");attemptStartedUtc=now;firstClickUtc=DateTime.MinValue;actualTeam=null;count=0;active=true;running=false;waitingForSelector=true;error=null;
    nextRecognitionMono=mono;RecognizeForAttempt(now,mono);
   }catch(Exception ex){Stop(ex.Message);error=ex.Message;}
  }
  void AcquireAutomatically(DateTime now,double mono){
   if(mono<nextRecognitionMono)return;
   nextRecognitionMono=mono+RecognitionIntervalMs;waitingForSelector=true;
   if(platform.ModifiersDown()){reason="Esperando el selector; suelta las teclas modificadoras.";return;}
   var frame=platform.ForegroundGame();
   if(frame==null||frame.Pid<=0||frame.Window<=0||frame.Width<320||frame.Width>8000||frame.Height<200||frame.Height>8000){reason="Esperando Wardogs en primer plano y el selector de facciones.";return;}
   var candidate=new TeamClickerFrame{Pid=frame.Pid,Window=frame.Window,Width=frame.Width,Height=frame.Height};
   string expectedSession=command.sessionId,expectedTeam=command.selectedTeam;long expectedEpoch=controlEpoch,mouseBefore=MouseVersion();
   double began=elapsedNow();TeamClickerTarget target=null;Dictionary<string,TeamClickerTarget> all=null;string unavailable=null;
   try{if(expectedTeam=="any")all=AnyPlatform.CaptureAnyTargets(candidate,now);else target=platform.CaptureTarget(candidate,now,expectedTeam);}catch(TeamClickerOperatorStopException){EmergencyStop();return;}catch(Exception ex){unavailable=ex.Message;}
   double elapsed=elapsedNow()-began;
   if(Double.IsNaN(elapsed)||Double.IsInfinity(elapsed)||elapsed<0){Fail("El reloj del reconocimiento no es valido.");return;}
   if(!Automatic||!armed||active||controlEpoch!=expectedEpoch||command.sessionId!=expectedSession||command.selectedTeam!=expectedTeam)return;
   if(!Lease(now.AddMilliseconds(elapsed),mono+elapsed))return;
   if(MouseChanged(mouseBefore,now.AddMilliseconds(elapsed),mono+elapsed))return;
   nextRecognitionMono=mono+elapsed+RecognitionIntervalMs;
   // A menu or a foreground change before acquisition is still a waiting
   // state. No target or attempt is carried over from that candidate.
   if(!SameFrame(platform.ForegroundGame(),candidate)||platform.ModifiersDown()){reason="Esperando un selector estable de Wardogs.";return;}
   bool verified=expectedTeam=="any"?ValidAnyTargets(all,candidate):target!=null&&target.Valid()&&target.width==candidate.Width&&target.height==candidate.Height;
   if(!verified){error=null;reason="Esperando reconocer las tarjetas del selector."+(String.IsNullOrEmpty(unavailable)?"":" "+unavailable);return;}
   attemptFrame=candidate;attemptId=Guid.NewGuid().ToString("D");attemptStartedUtc=now.AddMilliseconds(elapsed);firstClickUtc=DateTime.MinValue;actualTeam=null;count=0;
   SaveTargets(expectedTeam,target,all);active=true;running=true;waitingForSelector=false;error=null;
   nextClickMono=mono+elapsed;reason="Equipo reconocido. Intentando entrar hasta detectar DESPLEGANDO.";
  }
  public void Tick(DateTime now,double mono){
   if(!Lease(now,mono)){var mouse=platform as ITeamClickerMousePlatform;if(mouse!=null)mouse.ConfigureMousePause(command==null?null:command.mousePause,false);return;}
   try{
    if(Automatic&&MousePaused(now,mono))return;
    if(pausedForMouse){pausedForMouse=false;nextRecognitionMono=mono;}
    if(Automatic&&!active){AcquireAutomatically(now,mono);return;}
    if(!active)return;
    if(platform.ModifiersDown()){ContextChanged("Esperando que sueltes las teclas modificadoras.",mono);return;}
    var frame=platform.ForegroundGame();
    if(!SameFrame(frame,attemptFrame)){ContextChanged("Wardogs ha perdido el foco o ha cambiado su ventana.",mono);return;}
    if(waitingForSelector||!running){if(mono>=nextRecognitionMono)RecognizeForAttempt(now,mono);return;}
    if(mono<nextClickMono)return;
    string team=command.selectedTeam;TeamClickerTarget target;
    if(team=="any"){
     long epoch=controlEpoch,mouseBefore=MouseVersion();string session=command.sessionId,attempt=attemptId;double began=elapsedNow();
     var available=AnyPlatform.AvailableTargets(frame,now);double elapsed=elapsedNow()-began;
     if(Double.IsNaN(elapsed)||Double.IsInfinity(elapsed)||elapsed<0){Fail("El reloj del reconocimiento no es valido.");return;}
     if(!active||!armed||controlEpoch!=epoch||command.sessionId!=session||attemptId!=attempt)return;
     if(!Lease(now.AddMilliseconds(elapsed),mono+elapsed))return;
     if(MouseChanged(mouseBefore,now.AddMilliseconds(elapsed),mono+elapsed))return;
     if(!SameFrame(platform.ForegroundGame(),attemptFrame)||platform.ModifiersDown()){ContextChanged("Wardogs ha perdido el foco o hay una tecla modificadora.",mono+elapsed);return;}
     var choices=new List<string>();
     foreach(string color in new[]{"blue","red","green"}){TeamClickerTarget value;if(available!=null&&available.TryGetValue(color,out value)&&value!=null&&value.Valid()&&value.width==frame.Width&&value.height==frame.Height)choices.Add(color);}
     nextClickMono=mono+elapsed+command.intervalMs;
     if(choices.Count==0){reason="Esperando un equipo disponible o la confirmacion DESPLEGANDO. No se envian clics fuera del selector.";return;}
     if(actualTeam!=null&&choices.Contains(actualTeam))team=actualTeam;
     else {int pick=chooseIndex(choices.Count);if(pick<0||pick>=choices.Count)throw new InvalidOperationException("La seleccion aleatoria no es valida.");team=choices[pick];}
     target=available[team];targets[team]=target;now=now.AddMilliseconds(elapsed);
    }else {target=targets[team];nextClickMono=mono+command.intervalMs;}
    platform.Click(frame,target);if(actualTeam!=team)actualTeamSinceUtc=now;actualTeam=team;if(count==0)firstClickUtc=now;count++;reason=Automatic?"Intentando entrar al equipo "+team+". Esperando DESPLEGANDO.":"Autoclic activo. F6 o F8 para detener.";
   }catch(TeamClickerOperatorStopException){EmergencyStop();}catch(TeamClickerContextPauseException ex){if(Automatic&&command.selectedTeam=="any")actualTeam=null;ContextChanged(ex.Message,mono);}catch(Exception ex){StopAttempt(ex.Message);error=ex.Message;}
  }
  public object View(DateTime now,int pid){
   var points=new Dictionary<string,object>();foreach(string team in new[]{"blue","red","green"})points[team]=targets.ContainsKey(team)?targets[team].PublicView():new{configured=false};
   string done=null,completedTeam=null,automaticStop=null;if(command!=null){completed.TryGetValue(command.sessionId,out done);completedTeams.TryGetValue(command.sessionId,out completedTeam);automaticStops.TryGetValue(command.sessionId,out automaticStop);}
   return new{format="wardogs-team-clicker-state-v1",at=now.ToString("o"),pid=pid,sessionId=command==null?null:command.sessionId,startMode=command==null?"hotkey":command.StartMode,automaticWaiting=AutomaticWaiting,requiresHotkeys=RequiresHotkeys,armed=armed,active=active,running=running,waitingForSelector=waitingForSelector,pausedForContext=pausedForContext,userPause=MouseState(now),attemptId=attemptId,attemptStartedAt=attemptId==null?null:attemptStartedUtc.ToString("o"),completedAttemptId=done,selectedTeam=command==null?"blue":command.selectedTeam,requestedTeam=command==null?null:command.selectedTeam,actualTeam=done==null?actualTeam:completedTeam,completedActualTeam=completedTeam,intervalMs=command==null?20:command.intervalMs,toggleKey=Automatic?null:"F6",captureKey=Automatic?null:"F9",reason=reason,error=error,count=count,gamePid=active&&attemptFrame!=null?attemptFrame.Pid:0,gameWindow=active&&attemptFrame!=null?attemptFrame.Window:0L,endAt=(string)null,operatorStoppedSessionId=operatorStoppedSessionId,automaticStoppedSessionId=automaticStop==null?null:command.sessionId,automaticStopReason=automaticStop,targets=points};
  }
 }
}
