using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace WardogsSeeding {
 public sealed class MousePauseSettings {
  public bool enabled=true;public int resumeAfterSeconds=3;
  public void Validate(){if(resumeAfterSeconds<1||resumeAfterSeconds>30)throw new ArgumentException("La pausa por raton debe estar entre 1 y 30 segundos.");}
  public static MousePauseSettings Normalize(MousePauseSettings value){value=value??new MousePauseSettings();value.Validate();return new MousePauseSettings{enabled=value.enabled,resumeAfterSeconds=value.resumeAfterSeconds};}
 }
 public sealed class MousePauseSnapshot {
  public string kind="mouse",resumeAt;public bool active,buttonsDown;public int remainingMs;public long revision;
 }
 public sealed class UserMousePauseException:OperationCanceledException {public UserMousePauseException():base("Pausado mientras usas el raton.") {}}
 // This marker distinguishes our inputs only. Other injected/remote mouse input
 // is deliberately treated as user activity. It is not a permission or secret.
 public static class FarmDogsInputMarker {public static readonly UIntPtr Value=new UIntPtr(0xFAD06A11u);}
 public sealed class MouseActivityPolicy {
  readonly object gate=new object();double? lastActivity;int buttons;bool hasPosition;int x,y;long revision;
  public long Revision{get{lock(gate){return revision;}}}
  public void Reset(){lock(gate){lastActivity=null;buttons=0;hasPosition=false;x=y=0;revision=0;}}
  public void Restart(){lock(gate){lastActivity=null;buttons=0;hasPosition=false;x=y=0;revision++;}}
  public void InitializePosition(int px,int py){lock(gate){hasPosition=true;x=px;y=py;}}
  public void Observe(int message,int px,int py,uint mouseData,UIntPtr extra,double mono){
   lock(gate){
    bool moved=!hasPosition||px!=x||py!=y;hasPosition=true;x=px;y=py;
    if(extra==FarmDogsInputMarker.Value)return;
    bool relevant=message==0x200?moved:message==0x201||message==0x202||message==0x204||message==0x205||message==0x207||message==0x208||message==0x20a||message==0x20e||message==0x20b||message==0x20c;
    if(!relevant||Double.IsNaN(mono)||Double.IsInfinity(mono))return;
    int bit=message==0x201||message==0x202?1:message==0x204||message==0x205?2:message==0x207||message==0x208?4:message==0x20b||message==0x20c?((mouseData>>16)==1?8:16):0;
    if(message==0x201||message==0x204||message==0x207||message==0x20b)buttons|=bit;
    if(message==0x202||message==0x205||message==0x208||message==0x20c)buttons&=~bit;
    lastActivity=mono;revision++;
   }
  }
  public MousePauseSnapshot View(MousePauseSettings settings,DateTime now,double mono){
   settings=MousePauseSettings.Normalize(settings);
   lock(gate){int wait=settings.resumeAfterSeconds*1000;double remaining=lastActivity.HasValue?wait-(mono-lastActivity.Value):0;
    bool active=settings.enabled&&(buttons!=0||lastActivity.HasValue&&(remaining>0||mono<lastActivity.Value));
    int ms=active?(int)Math.Min(wait,Math.Max(0,remaining)):0;
    return new MousePauseSnapshot{active=active,buttonsDown=settings.enabled&&buttons!=0,remainingMs=buttons!=0&&active?wait:ms,resumeAt=active&&buttons==0?now.AddMilliseconds(ms).ToString("o"):null,revision=revision};
   }
  }
 }
 // Event-only OS listener: no game memory, input suppression, logging or IO.
 // The callback only updates its in-memory policy and immediately passes on.
 public sealed class UserMouseActivity:IDisposable {
  [StructLayout(LayoutKind.Sequential)] struct POINT{public int X,Y;}
  [StructLayout(LayoutKind.Sequential)] struct EVENT{public POINT point;public uint mouseData,flags,time;public UIntPtr extra;}
  [StructLayout(LayoutKind.Sequential)] struct MSG{public IntPtr hwnd;public uint message;public UIntPtr wParam;public IntPtr lParam;public uint time;public POINT point;}
  delegate IntPtr Hook(int code,IntPtr message,IntPtr data);
  [DllImport("user32.dll",SetLastError=true)]static extern IntPtr SetWindowsHookEx(int type,Hook callback,IntPtr module,uint thread);
  [DllImport("user32.dll")]static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")]static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
  [DllImport("user32.dll")]static extern int GetMessage(out MSG message,IntPtr window,uint min,uint max);
  [DllImport("user32.dll")]static extern bool PeekMessage(out MSG message,IntPtr window,uint min,uint max,uint remove);
  [DllImport("user32.dll")]static extern bool PostThreadMessage(uint thread,uint message,UIntPtr wParam,IntPtr lParam);
  [DllImport("user32.dll")]static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")]static extern bool GetCursorPos(out POINT point);
  [DllImport("kernel32.dll")]static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern IntPtr GetModuleHandle(string module);
  readonly MouseActivityPolicy policy=new MouseActivityPolicy();readonly Stopwatch clock=Stopwatch.StartNew();readonly object gate=new object();
  MousePauseSettings settings=new MousePauseSettings();Thread thread;Hook callback;IntPtr hook;uint threadId;volatile bool available,stopping;bool disposed,observing;
  public bool Available{get{return available;}}
  public long Revision{get{return policy.Revision;}}
  public void Configure(MousePauseSettings value,bool enabled){
   value=MousePauseSettings.Normalize(value);lock(gate){if(disposed)return;settings=value;observing=enabled&&value.enabled;if(!observing){Stop();return;}if(thread!=null){if(!available)throw new InvalidOperationException("El observador del raton no esta disponible.");return;}
    policy.Restart();stopping=false;var ready=new ManualResetEvent(false);thread=new Thread(()=>Run(ready)){IsBackground=true,Name="FarmDogs mouse activity"};thread.Start();if(!ready.WaitOne(1000)||!available){Stop();ready.Dispose();throw new InvalidOperationException("No se pudo preparar la pausa por raton.");}ready.Dispose();
   }
  }
  void Run(ManualResetEvent ready){
   try{threadId=GetCurrentThreadId();MSG message;PeekMessage(out message,IntPtr.Zero,0,0,0);callback=OnMouse;hook=SetWindowsHookEx(14,callback,GetModuleHandle(null),0);available=hook!=IntPtr.Zero;if(available){POINT point;if(GetCursorPos(out point)){policy.InitializePosition(point.X,point.Y);int[] keys={1,2,4,5,6},messages={0x201,0x204,0x207,0x20b,0x20b};for(int i=0;i<keys.Length;i++)if((GetAsyncKeyState(keys[i])&0x8000)!=0)policy.Observe(messages[i],point.X,point.Y,i>=3?(uint)(i-2)<<16:0,UIntPtr.Zero,clock.Elapsed.TotalMilliseconds);}}ready.Set();if(!available)return;while(!stopping){int result=GetMessage(out message,IntPtr.Zero,0,0);if(result<=0)break;}}
   catch{available=false;try{ready.Set();}catch{}}
   finally{available=false;if(hook!=IntPtr.Zero){UnhookWindowsHookEx(hook);hook=IntPtr.Zero;}}
  }
  IntPtr OnMouse(int code,IntPtr message,IntPtr data){try{if(code>=0&&!stopping){var input=(EVENT)Marshal.PtrToStructure(data,typeof(EVENT));policy.Observe(message.ToInt32(),input.point.X,input.point.Y,input.mouseData,input.extra,clock.Elapsed.TotalMilliseconds);}}catch{}return CallNextHookEx(hook,code,message,data);}
  public MousePauseSnapshot View(DateTime now){lock(gate){if(!observing||disposed)return new MousePauseSnapshot{revision=policy.Revision};if(!available)throw new InvalidOperationException("El observador del raton dejo de responder.");return policy.View(settings,now,clock.Elapsed.TotalMilliseconds);}}
  public bool Paused{get{return View(DateTime.UtcNow).active;}}
  void Stop(){stopping=true;if(threadId!=0)PostThreadMessage(threadId,0x12,UIntPtr.Zero,IntPtr.Zero);var previous=thread;bool ended=previous==null||previous==Thread.CurrentThread||previous.Join(1000);if(ended){thread=null;threadId=0;}available=false;}
  public void Dispose(){lock(gate){if(disposed)return;disposed=true;Stop();}}
 }
}
