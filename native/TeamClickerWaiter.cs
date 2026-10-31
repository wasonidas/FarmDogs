using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace WardogsSeeding {
 public interface ITeamClickerWaitApi {
  IntPtr CreateHighResolution();
  bool Schedule(IntPtr timer,long relativeDueTime);
  uint Wait(IntPtr timer,uint timeoutMs);
  void Close(IntPtr timer);
  void Sleep(int milliseconds);
 }
 // An unnamed, process-owned timer changes no system timer-resolution setting.
 // Any unsupported API or timer failure selects a permanent Sleep fallback.
 public sealed class TeamClickerWaiter : IDisposable {
  readonly ITeamClickerWaitApi api;
  IntPtr timer;
  bool disposed;
  public string Mode {get;private set;}
  public string Error {get;private set;}
  public TeamClickerWaiter(ITeamClickerWaitApi implementation=null){
   api=implementation??new TeamClickerWaitNative();
   try{timer=api.CreateHighResolution();if(timer==IntPtr.Zero)Fallback("Windows no ha creado el temporizador de alta resolucion.");else Mode="high_resolution_waitable_timer";}
   catch(Exception error){Fallback(error.Message);}
  }
  void Fallback(string message){
   Error=message;Mode="thread_sleep_fallback";
   IntPtr old=timer;timer=IntPtr.Zero;if(old!=IntPtr.Zero)try{api.Close(old);}catch{}
  }
  public void Delay(int milliseconds){
   if(disposed)throw new ObjectDisposedException("TeamClickerWaiter");
   if(milliseconds<1||milliseconds>1000)throw new ArgumentOutOfRangeException("milliseconds");
   if(timer!=IntPtr.Zero){
    try{
     // Negative values are relative intervals in units of 100 nanoseconds.
     if(!api.Schedule(timer,-10000L*milliseconds))Fallback("No se pudo programar el temporizador de alta resolucion.");
     else {uint result=api.Wait(timer,(uint)(milliseconds+25));if(result==0)return;Fallback("La espera del temporizador no termino correctamente ("+result+").");}
    }catch(Exception error){Fallback(error.Message);}
   }
   api.Sleep(milliseconds);
  }
  public void Dispose(){if(disposed)return;disposed=true;IntPtr old=timer;timer=IntPtr.Zero;if(old!=IntPtr.Zero)api.Close(old);}
 }
 public sealed class TeamClickerWaitNative : ITeamClickerWaitApi {
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,ExactSpelling=true,SetLastError=true)] static extern IntPtr CreateWaitableTimerExW(IntPtr attributes,string name,uint flags,uint access);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetWaitableTimer(IntPtr timer,ref long dueTime,int period,IntPtr completion,IntPtr argument,bool resume);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  public IntPtr CreateHighResolution(){return CreateWaitableTimerExW(IntPtr.Zero,null,0x2,0x00100002);}
  public bool Schedule(IntPtr timer,long relativeDueTime){return SetWaitableTimer(timer,ref relativeDueTime,0,IntPtr.Zero,IntPtr.Zero,false);}
  public uint Wait(IntPtr timer,uint timeoutMs){return WaitForSingleObject(timer,timeoutMs);}
  public void Close(IntPtr timer){CloseHandle(timer);}
  public void Sleep(int milliseconds){Thread.Sleep(milliseconds);}
 }
}
