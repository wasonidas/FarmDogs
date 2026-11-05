using System;
using System.Threading;

// The second launcher instance already signals an AutoReset event. Waiting for
// that event avoids waking the UI periodically when no instance asks to show it.
internal sealed class DesktopWakeSignal : IDisposable {
 readonly object gate=new object();
 readonly Action<Action> post;
 readonly Action wake;
 RegisteredWaitHandle subscription;
 bool disposed,pending;
 internal DesktopWakeSignal(WaitHandle signal,Action<Action> postToOwner,Action onWake){
  if(signal==null)throw new ArgumentNullException("signal");
  if(postToOwner==null)throw new ArgumentNullException("postToOwner");
  if(onWake==null)throw new ArgumentNullException("onWake");
  post=postToOwner;wake=onWake;
  subscription=ThreadPool.RegisterWaitForSingleObject(signal,OnSignal,null,Timeout.Infinite,false);
 }
 void OnSignal(object ignored,bool timedOut){
  if(timedOut)return;
  lock(gate){if(disposed||pending)return;pending=true;}
  try{
   post(delegate{
    lock(gate){pending=false;if(disposed)return;}
    wake();
   });
  }catch{lock(gate){pending=false;}}
 }
 public void Dispose(){
  RegisteredWaitHandle own;
  lock(gate){if(disposed)return;disposed=true;pending=false;own=subscription;subscription=null;}
  if(own!=null)own.Unregister(null);
 }
}
