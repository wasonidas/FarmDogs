using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace WardogsSeeding {
 public sealed class TeamClickerNative : ITeamClickerPlatform,ITeamClickerAnyPlatform,ITeamClickerButtonInput,ITeamClickerMousePlatform,IDisposable {
  readonly UserMouseActivity mouseActivity=new UserMouseActivity();
  public void ConfigureMousePause(MousePauseSettings settings,bool enabled){mouseActivity.Configure(settings,enabled);}
  public MousePauseSnapshot MousePause(DateTime now){return mouseActivity.View(now);}
  public long MouseRevision{get{return mouseActivity.Revision;}}
  public void Dispose(){mouseActivity.Dispose();}
  int integrityPid;string integrityStatus;
  void CheckIntegrity(TeamClickerFrame frame){if(frame==null||frame.Pid<=0)return;if(integrityPid!=frame.Pid){integrityStatus=InputIntegrity.Assess(frame.Pid).Status;integrityPid=frame.Pid;}if(integrityStatus=="requires_elevation")throw new InvalidOperationException("Wardogs esta abierto con permisos superiores. Cierra FarmDogs por completo y vuelve a abrirla como administrador, o abre ambos con permisos normales.");}
  TeamClickerAnySelector anySelector;
  TeamClickerFrame anyFrame;
  [StructLayout(LayoutKind.Sequential)] struct RECT {public int Left,Top,Right,Bottom;}
  [StructLayout(LayoutKind.Sequential)] struct POINT {public int X,Y;public POINT(int x,int y){X=x;Y=y;}}
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT {public int dx,dy;public uint mouseData,flags,time;public UIntPtr extra;}
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT {public ushort vk,scan;public uint flags,time;public UIntPtr extra;}
  [StructLayout(LayoutKind.Explicit)] struct UNION {[FieldOffset(0)] public MOUSEINPUT mouse;[FieldOffset(0)] public KEYBDINPUT keyboard;}
  [StructLayout(LayoutKind.Sequential)] struct INPUT {public uint type;public UNION data;}
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h,out RECT rect);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h,ref POINT p);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint n,INPUT[] inputs,int size);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static bool KeyDown(int key) {return (GetAsyncKeyState(key)&(key==0x77?0x8001:0x8000))!=0;}
  static void CheckStop(){if(KeyDown(0x77))throw new TeamClickerOperatorStopException();}
  public bool ModifiersDown(){return KeyDown(0x10)||KeyDown(0x11)||KeyDown(0x12)||KeyDown(0x5b)||KeyDown(0x5c);}
  public bool ServiceAlive(int pid) {try{using(var p=Process.GetProcessById(pid))return !p.HasExited;}catch{return false;}}
  public TeamClickerFrame ForegroundGame() {
   try {
    var game=GameWindowResolver.ResolveForeground();if(game==null||game.Width>8000||game.Height>8000)return null;
    return new TeamClickerFrame {Pid=game.Pid,Window=game.Window,Width=game.Width,Height=game.Height};
   }catch{return null;}
  }
  bool Same(TeamClickerFrame frame) {
   var current=ForegroundGame();return current!=null&&frame!=null&&current.Pid==frame.Pid&&current.Window==frame.Window&&current.Width==frame.Width&&current.Height==frame.Height;
  }
  POINT Origin(TeamClickerFrame frame) {POINT origin=new POINT();if(!Same(frame)||!ClientToScreen(new IntPtr(frame.Window),ref origin))throw new TeamClickerContextPauseException("Wardogs ha perdido el foco.");return origin;}
  bool PointBelongs(TeamClickerFrame frame,POINT point) {
   uint pid;var hit=WindowFromPoint(point);GetWindowThreadProcessId(hit,out pid);return hit!=IntPtr.Zero&&pid==frame.Pid&&Same(frame);
  }
  public TeamClickerTarget CaptureTarget(TeamClickerFrame frame,DateTime now,string selectedTeam) {
   POINT origin=Origin(frame);var timer=Stopwatch.StartNew();
   using(var bitmap=new Bitmap(frame.Width,frame.Height,PixelFormat.Format32bppArgb)){
    using(var graphics=Graphics.FromImage(bitmap))graphics.CopyFromScreen(origin.X,origin.Y,0,0,new Size(frame.Width,frame.Height),CopyPixelOperation.SourceCopy);
    POINT copied=Origin(frame);if(copied.X!=origin.X||copied.Y!=origin.Y)throw new InvalidOperationException("La ventana ha cambiado durante el reconocimiento.");
    TeamClickerTarget target;
    if(!TeamClickerSelectorFrame.TryRecognize(bitmap,selectedTeam,now,out target))throw new InvalidOperationException("No se reconocen las tarjetas del selector de faccion actual.");
    POINT after=Origin(frame);
    if(after.X!=origin.X||after.Y!=origin.Y||timer.ElapsedMilliseconds>2000||!PointBelongs(frame,new POINT(origin.X+target.x,origin.Y+target.y)))throw new InvalidOperationException("No se puede verificar el selector actual.");
    return target;
   }
  }
  public Dictionary<string,TeamClickerTarget> CaptureAnyTargets(TeamClickerFrame frame,DateTime now){
   anySelector=null;anyFrame=null;POINT origin=Origin(frame);var timer=Stopwatch.StartNew();
   using(var bitmap=new Bitmap(frame.Width,frame.Height,PixelFormat.Format32bppArgb)){
    using(var graphics=Graphics.FromImage(bitmap))graphics.CopyFromScreen(origin.X,origin.Y,0,0,new Size(frame.Width,frame.Height),CopyPixelOperation.SourceCopy);
    POINT copied=Origin(frame);if(copied.X!=origin.X||copied.Y!=origin.Y)throw new InvalidOperationException("La ventana ha cambiado durante el reconocimiento.");
    TeamClickerSelectorSnapshot snapshot;
    if(!TeamClickerSelectorFrame.TryRecognizeAll(bitmap,now,out snapshot))throw new InvalidOperationException("No se reconocen las tres tarjetas del selector actual.");
    var selector=new TeamClickerAnySelector(bitmap,snapshot);POINT after=Origin(frame);
    CheckStop();if(after.X!=origin.X||after.Y!=origin.Y||timer.ElapsedMilliseconds>2000)throw new InvalidOperationException("No se puede verificar el selector actual.");
    foreach(var target in snapshot.Targets.Values)if(!PointBelongs(frame,new POINT(origin.X+target.x,origin.Y+target.y)))throw new InvalidOperationException("El selector esta tapado por otra ventana.");
    anySelector=selector;anyFrame=new TeamClickerFrame{Pid=frame.Pid,Window=frame.Window,Width=frame.Width,Height=frame.Height};return snapshot.Targets;
   }
  }
  public Dictionary<string,TeamClickerTarget> AvailableTargets(TeamClickerFrame frame,DateTime now){
   if(anySelector==null||anyFrame==null||frame==null||anyFrame.Pid!=frame.Pid||anyFrame.Window!=frame.Window||anyFrame.Width!=frame.Width||anyFrame.Height!=frame.Height)throw new InvalidOperationException("Falta la adquisicion actual del selector aleatorio.");
   CheckStop();POINT origin=Origin(frame);var timer=Stopwatch.StartNew();Rectangle region=anySelector.ReadBounds;
   using(var bitmap=new Bitmap(region.Width,region.Height,PixelFormat.Format32bppArgb)){
    using(var graphics=Graphics.FromImage(bitmap))graphics.CopyFromScreen(origin.X+region.Left,origin.Y+region.Top,0,0,region.Size,CopyPixelOperation.SourceCopy);
    POINT copied=Origin(frame);CheckStop();if(copied.X!=origin.X||copied.Y!=origin.Y||timer.ElapsedMilliseconds>2000)throw new InvalidOperationException("El selector ha cambiado de ventana.");
    var available=anySelector.Available(bitmap,now);
    foreach(var target in available.Values)if(!PointBelongs(frame,new POINT(origin.X+target.x,origin.Y+target.y)))throw new InvalidOperationException("El equipo disponible esta tapado por otra ventana.");
    return available;
   }
  }
  int[] Sample(TeamClickerFrame frame,TeamClickerTarget target) {
   POINT origin=Origin(frame);int[] pixels=new int[45];
   if(!PointBelongs(frame,new POINT(origin.X+target.x,origin.Y+target.y)))throw new InvalidOperationException("El boton esta tapado por otra ventana.");
   using(var bitmap=new Bitmap(64,32,PixelFormat.Format32bppArgb))using(var graphics=Graphics.FromImage(bitmap)) {
    graphics.CopyFromScreen(origin.X+target.patchLeft,origin.Y+target.patchTop,0,0,new Size(64,32),CopyPixelOperation.SourceCopy);
    for(int y=0;y<5;y++)for(int x=0;x<9;x++)pixels[y*9+x]=bitmap.GetPixel(2+x*7,2+y*7).ToArgb()&0xffffff;
   }
   POINT after=Origin(frame);if(after.X!=origin.X||after.Y!=origin.Y)throw new InvalidOperationException("La ventana del juego se ha movido.");return pixels;
  }
  public bool PatchMatches(TeamClickerFrame frame,TeamClickerTarget target){return target.Valid()&&TeamClickerPatch.Matches(target.signature,Sample(frame,target));}
  static void Mouse(uint flags) {
   INPUT input=new INPUT();input.type=0;input.data.mouse.flags=flags;input.data.mouse.extra=FarmDogsInputMarker.Value;
   if(SendInput(1,new[]{input},Marshal.SizeOf(typeof(INPUT)))!=1)throw new InvalidOperationException("Windows no ha aceptado el clic ("+Marshal.GetLastWin32Error()+").");
  }
  public void Button(bool down){Mouse(down?0x0002u:0x0004u);}
  public void Click(TeamClickerFrame frame,TeamClickerTarget target) {
   CheckStop();CheckIntegrity(frame);
   if(mouseActivity.Paused)throw new TeamClickerContextPauseException("Pausado mientras usas el raton.");
   POINT origin=Origin(frame),point=new POINT(origin.X+target.x,origin.Y+target.y);
   if(ModifiersDown()||!PointBelongs(frame,point))throw new TeamClickerContextPauseException("El juego no esta listo para recibir el clic.");
   int left=GetSystemMetrics(76),top=GetSystemMetrics(77),width=GetSystemMetrics(78),height=GetSystemMetrics(79);
   if(width<=1||height<=1)throw new InvalidOperationException("El escritorio no tiene una geometria valida.");
   INPUT movement=new INPUT();movement.type=0;movement.data.mouse.dx=(int)Math.Round((point.X-left)*65535d/(width-1));movement.data.mouse.dy=(int)Math.Round((point.Y-top)*65535d/(height-1));movement.data.mouse.flags=0x0001u|0x8000u|0x4000u;movement.data.mouse.extra=FarmDogsInputMarker.Value;
   if(SendInput(1,new[]{movement},Marshal.SizeOf(typeof(INPUT)))!=1)throw new InvalidOperationException("No se pudo situar el cursor sobre el equipo.");
   POINT actual;if(!GetCursorPos(out actual)||Math.Abs(actual.X-point.X)>1||Math.Abs(actual.Y-point.Y)>1)throw new TeamClickerContextPauseException("El cursor se ha movido antes del clic.");
   if(mouseActivity.Paused)throw new TeamClickerContextPauseException("Pausado mientras usas el raton.");
   CheckStop();if(ModifiersDown()||!PointBelongs(frame,point))throw new TeamClickerContextPauseException("El juego ha perdido el foco antes del clic.");
   // Always attempt button-up, including a rejected/partial down or focus change.
   TeamClickerButton.Click(this,()=>{
    // A real down/up pulse must span a game input sample; zero-duration pairs
    // can be accepted by Windows without being observed by the game.
    System.Threading.Thread.Sleep(15);
    CheckStop();
    if(mouseActivity.Paused)throw new TeamClickerContextPauseException("Pausado mientras usas el raton.");
    if(ModifiersDown()||!Same(frame)||!PointBelongs(frame,point))throw new TeamClickerContextPauseException("El juego ha perdido el foco durante el clic.");
    POINT after=Origin(frame);if(after.X!=origin.X||after.Y!=origin.Y)throw new TeamClickerContextPauseException("La ventana ha cambiado durante el clic.");
   });
  }
 }
}
