using System;
using System.Runtime.InteropServices;

namespace WardogsSeeding {
 public interface ITeamClickerHotkeyRegistration {
  bool Register(int id,uint modifiers,uint virtualKey);
  void Unregister(int id);
 }
 // Pure lifetime gate. Each registration uses a fresh ID so a queued message
 // from a previous focus/session epoch cannot act on the current session.
 public sealed class TeamClickerHotkeyGate : IDisposable {
  public const uint NoRepeat=0x4000,ToggleKey=0x75,CaptureKey=0x78;
  readonly ITeamClickerHotkeyRegistration platform;
  string session;
  bool eligible,disposed,captureRequested;
  int toggleId,captureId,nextId=0x100;
  string error;
  public TeamClickerHotkeyGate(ITeamClickerHotkeyRegistration registration){platform=registration;}
  public bool ToggleRegistered {get{return toggleId!=0;}}
  public bool CaptureRegistered {get{return captureId!=0;}}
  public bool Ready {get{return ToggleRegistered&&(!captureRequested||CaptureRegistered);}}
  public string Error {get{return error;}}
  public int ToggleId {get{return toggleId;}}
  public int CaptureId {get{return captureId;}}
  void Release(){if(toggleId!=0){platform.Unregister(toggleId);toggleId=0;}if(captureId!=0){platform.Unregister(captureId);captureId=0;}}
  int Register(uint key){
   if(nextId>0xbfff){error="Reabre la app para renovar las teclas del autoclic.";return 0;}
   int id=nextId++;
   if(platform.Register(id,NoRepeat,key))return id;
   error=key==ToggleKey?"La tecla F6 esta ocupada. Libera F6 y vuelve a prepararla en la app.":"La tecla F9 esta ocupada. Libera F9 y vuelve a solicitar la comprobacion sin clic.";return 0;
  }
  public void Update(string nextSession,bool canRegister,bool toggleHeld,bool captureHeld,bool requireCapture=false){
   if(disposed)return;
   canRegister=canRegister&&!String.IsNullOrEmpty(nextSession);
   bool nextCapture=canRegister&&requireCapture;
   // Entering or leaving the optional F9 check starts a new registration epoch.
   // Messages queued in the previous mode cannot act on the current mode.
   if(!canRegister||!eligible||nextSession!=session||nextCapture!=captureRequested){Release();session=canRegister?nextSession:null;eligible=canRegister;captureRequested=nextCapture;error=null;}
   if(!eligible||error!=null)return;
   // A key already down when eligibility begins must first be released.
   // A short subsequent key is delivered by WM_HOTKEY, not level polling.
   if(toggleId==0&&!toggleHeld)toggleId=Register(ToggleKey);
   if(error==null&&captureRequested&&captureId==0&&!captureHeld)captureId=Register(CaptureKey);
   if(error!=null)Release();
  }
  public int Action(int id,uint virtualKey){
   if(disposed||!eligible||error!=null)return 0;
   if(id==toggleId&&toggleId!=0&&virtualKey==ToggleKey)return 6;
   if(id==captureId&&captureId!=0&&virtualKey==CaptureKey)return 9;
   return 0;
  }
  public void Dispose(){if(disposed)return;Release();session=null;eligible=false;captureRequested=false;disposed=true;}
 }
 // Thread hotkeys use the helper's existing polling loop as a message pump.
 // This class is never constructed or called by policy tests.
 public sealed class TeamClickerHotkeyMessages : ITeamClickerHotkeyRegistration {
  const uint HotkeyMessage=0x0312;
  [StructLayout(LayoutKind.Sequential)] struct POINT {public int x,y;}
  [StructLayout(LayoutKind.Sequential)] struct MSG {public IntPtr window;public uint message;public UIntPtr wParam;public IntPtr lParam;public uint time;public POINT point;public uint reserved;}
  [DllImport("user32.dll",SetLastError=true)] static extern bool RegisterHotKey(IntPtr window,int id,uint modifiers,uint key);
  [DllImport("user32.dll",SetLastError=true)] static extern bool UnregisterHotKey(IntPtr window,int id);
  [DllImport("user32.dll",EntryPoint="PeekMessageW")] static extern bool PeekMessage(out MSG value,IntPtr window,uint minimum,uint maximum,uint remove);
  public bool Register(int id,uint modifiers,uint virtualKey){return RegisterHotKey(IntPtr.Zero,id,modifiers,virtualKey);}
  public void Unregister(int id){UnregisterHotKey(IntPtr.Zero,id);}
  public static bool TryRead(out int id,out uint virtualKey){
   MSG message;id=0;virtualKey=0;
   if(!PeekMessage(out message,IntPtr.Zero,HotkeyMessage,HotkeyMessage,1))return false;
   if(message.message==HotkeyMessage&&message.wParam.ToUInt64()<=Int32.MaxValue){id=(int)message.wParam.ToUInt64();virtualKey=(uint)((message.lParam.ToInt64()>>16)&0xffff);}
   return true;
  }
 }
}
