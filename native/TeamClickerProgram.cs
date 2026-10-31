using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace WardogsSeeding {
 public static class TeamClickerProgram {
  static readonly JavaScriptSerializer json=new JavaScriptSerializer {MaxJsonLength=128*1024};
  static string Read(string file) {using(var stream=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)){if(stream.Length>128*1024)throw new InvalidOperationException("Archivo de autoclic demasiado grande.");using(var reader=new StreamReader(stream))return reader.ReadToEnd();}}
  static void Write(string file,object value) {
   string temp=file+".tmp";File.WriteAllText(temp,json.Serialize(value),new UTF8Encoding(false));
   for(int i=0;;i++){try{if(File.Exists(file))File.Replace(temp,file,null);else File.Move(temp,file);return;}catch(IOException){if(i>=3)throw;Thread.Sleep(5);}}
  }
  static object State(TeamClickerEngine engine,TeamClickerHotkeyGate hotkeys,TeamClickerWaiter waiter,DateTime now,int received,string lastKey,string lastAt){
   var value=engine.View(now,Process.GetCurrentProcess().Id);
   var row=new Dictionary<string,object>();
   foreach(var property in value.GetType().GetProperties())row[property.Name]=property.GetValue(value,null);
   row["hotkeysReady"]=hotkeys.Ready;row["toggleHotkeyRegistered"]=hotkeys.ToggleRegistered;row["captureHotkeyRegistered"]=hotkeys.CaptureRegistered;
   row["captureHotkeyRequested"]=engine.CaptureRequested;
   row["hotkeyMessagesReceived"]=received;row["lastHotkey"]=lastKey;row["lastHotkeyAt"]=lastAt;
   row["waitMode"]=waiter.Mode;row["waitError"]=waiter.Error;
   return row;
  }
  [STAThread] public static int Main(string[] args) {
   string root=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,".."));
   for(int i=0;i<args.Length;i++)if(args[i]=="--root"&&i+1<args.Length)root=Path.GetFullPath(args[++i]);
   string mutexName;using(var sha=SHA256.Create())mutexName="Local\\WardogsTeamClicker-"+BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(root.ToUpperInvariant()))).Replace("-","").Substring(0,24);
   bool created;using(var mutex=new Mutex(true,mutexName,out created)) {
    if(!created)return 0;
    if(!TeamClickerNative.SetProcessDPIAware())return 2;
    string dir=Path.Combine(root,"data");Directory.CreateDirectory(dir);
    string commandPath=Path.Combine(dir,"team-clicker-command.json"),statePath=Path.Combine(dir,"team-clicker-state.json"),targetPath=Path.Combine(dir,"team-clicker-targets.json");
    var saved=new Dictionary<string,TeamClickerTarget>();
    try{if(File.Exists(targetPath)){var payload=json.Deserialize<TargetFile>(Read(targetPath));if(payload!=null&&payload.format=="wardogs-team-clicker-targets-v1"&&payload.targets!=null)saved=payload.targets;}}catch{}
    var platform=new TeamClickerNative();var engine=new TeamClickerEngine(platform,saved);var clock=Stopwatch.StartNew();
    var stopKeys=new TeamClickerKeyEdges(false,false,TeamClickerNative.KeyDown(0x77));
    var hotkeys=new TeamClickerHotkeyGate(new TeamClickerHotkeyMessages());
    var waiter=new TeamClickerWaiter();
    double nextRead=0,nextWrite=0,lastLoop=0;string lastId=null,lastReason=null,sessionId=null,lastHotkey=null,lastHotkeyAt=null;int servicePid=0,hotkeyMessages=0;bool exit=false;
    try {
     while(!exit) {
      double mono=clock.Elapsed.TotalMilliseconds;DateTime now=DateTime.UtcNow;
      // A suspended message loop must not dispatch an activation queued before it.
      if(mono-lastLoop>1000)hotkeys.Update(null,false,false,false);
      lastLoop=mono;
      if(mono>=nextRead) {
       nextRead=mono+50;
       try {
        var command=json.Deserialize<TeamClickerCommand>(Read(commandPath));
        if(command==null)throw new InvalidOperationException("Falta la orden del autoclic.");
        if(command.id!=lastId){engine.Apply(command,now,mono);lastId=command.id;servicePid=command.servicePid;sessionId=command.sessionId;}
       }catch(Exception error){engine.Fail(error.Message);}
       if(servicePid>0&&!platform.ServiceAlive(servicePid)){engine.Fail("La app se ha cerrado.");exit=true;}
       if(servicePid==0&&mono>10000)exit=true;
      }
      bool stopHeld=TeamClickerNative.KeyDown(0x77);
      hotkeys.Update(sessionId,!exit&&engine.RequiresHotkeys&&engine.Armed&&!stopHeld&&platform.ForegroundGame()!=null,engine.RequiresHotkeys&&TeamClickerNative.KeyDown(0x75),engine.RequiresHotkeys&&TeamClickerNative.KeyDown(0x78),engine.CaptureRequested);
      if(hotkeys.Error!=null)engine.Fail(hotkeys.Error);
      // F8 remains observed, not registered or swallowed, so movement also sees it.
      if(stopKeys.Read(false,false,stopHeld)==8||(stopHeld&&engine.Armed)){engine.EmergencyStop();hotkeys.Update(sessionId,false,false,false);}
      int messageId;uint virtualKey;
      for(int pending=0;pending<32&&TeamClickerHotkeyMessages.TryRead(out messageId,out virtualKey);pending++) {
       // Revalidate immediately before dispatch: stale focus/session messages are inert.
       hotkeys.Update(sessionId,!exit&&engine.RequiresHotkeys&&engine.Armed&&!TeamClickerNative.KeyDown(0x77)&&platform.ForegroundGame()!=null,engine.RequiresHotkeys&&TeamClickerNative.KeyDown(0x75),engine.RequiresHotkeys&&TeamClickerNative.KeyDown(0x78),engine.CaptureRequested);
       if(hotkeys.Error!=null)engine.Fail(hotkeys.Error);
       int action=hotkeys.Action(messageId,virtualKey);
       if(action==0)continue;
       hotkeyMessages++;lastHotkey=action==6?"F6":"F9";lastHotkeyAt=DateTime.UtcNow.ToString("o");
       if(action==9)engine.Capture(DateTime.UtcNow,clock.Elapsed.TotalMilliseconds);
       else engine.Toggle(DateTime.UtcNow,clock.Elapsed.TotalMilliseconds);
      }
      if(engine.TargetsChanged){try{Write(targetPath,new TargetFile{format="wardogs-team-clicker-targets-v1",targets=engine.Targets});engine.TargetsSaved();}catch(Exception error){engine.Fail("No se pudo guardar el equipo reconocido: "+error.Message);}}
      engine.Tick(now,clock.Elapsed.TotalMilliseconds);
      if(mono>=nextWrite||lastReason!=engine.Reason){Write(statePath,State(engine,hotkeys,waiter,DateTime.UtcNow,hotkeyMessages,lastHotkey,lastHotkeyAt));nextWrite=mono+250;lastReason=engine.Reason;}
      if(!exit)waiter.Delay(2);
     }
    }catch(Exception error){engine.Fail(error.Message);}
    finally {try{hotkeys.Dispose();}finally{waiter.Dispose();}engine.Fail("Controlador de autoclic cerrado.");try{Write(statePath,State(engine,hotkeys,waiter,DateTime.UtcNow,hotkeyMessages,lastHotkey,lastHotkeyAt));}catch{}}
    return 0;
   }
  }
  public sealed class TargetFile {public string format;public Dictionary<string,TeamClickerTarget> targets;}
 }
}
