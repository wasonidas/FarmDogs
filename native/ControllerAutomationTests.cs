using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace WardogsSeeding {
 // Test double: this assembly contains no SendInput or hotkey registration calls.
 public static class KeyboardInput {
  public static readonly System.Collections.Generic.List<int> Keys=new System.Collections.Generic.List<int>();
  public static int Held,MaxHeld,Holds;public static int InputSize {get{return 40;}}
  public static bool RegisterHotKey(IntPtr h,int id,uint m,uint k){return false;}
  public static bool UnregisterHotKey(IntPtr h,int id){return true;}
  public static int FindGame(){return 1234;}public static bool ForegroundIs(int p){return p==1234;}public static bool IsGame(int p){return p==1234;}public static bool ModifiersDown(){return false;}
  public static void Release(){}
  public static async Task Hold(int pid,int vk,int milliseconds,CancellationToken token){Keys.Add(vk);Holds++;Held++;MaxHeld=Math.Max(MaxHeld,Held);try{await Task.Delay(milliseconds,token);}finally{Held--;}}
 }
 public static class ControllerAutomationTests {
  [STAThread] public static int Main(){
   var root=Path.Combine(Path.GetTempPath(),"wardogs-controller-test-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Path.Combine(root,"data"));
   string id=Guid.NewGuid().ToString("D"),report=null;int stage=0;Exception failure=null;var json=new JavaScriptSerializer();
   var context=new ApplicationContext();var signal=new EventWaitHandle(false,EventResetMode.AutoReset);
   var form=new ControllerForm(root,DateTime.UtcNow.AddSeconds(30),signal);var handle=form.Handle;
   var clock=Stopwatch.StartNew();var timer=new System.Windows.Forms.Timer {Interval=50};
   Action<string,int,bool> send=(kind,lease,cancelled)=>{var now=DateTime.UtcNow;var cmd=new AutomaticCommand {format="wardogs-automatic-movement-v1",id=Guid.NewGuid().ToString("D"),sessionId=id,kind=kind,issuedAt=now.ToString("o"),expiresAt=now.AddMilliseconds(lease).ToString("o"),endAt=now.AddSeconds(20).ToString("o"),capturedAt=now.ToString("o"),frameId=Guid.NewGuid().ToString("D"),scene="gameplay_hud",gamePid=1234,holdMs=2000,intervalSeconds=5,directions="AD",cancelled=cancelled};File.WriteAllText(Path.Combine(root,"data","movement-command.json"),json.Serialize(cmd));};
   Action<bool,string> check=(ok,message)=>{if(!ok)throw new Exception(message);};
   timer.Tick+=(s,e)=>{try{
    long elapsed=clock.ElapsedMilliseconds;
    if(stage==0){send("start",3000,false);stage=1;}
    else if(stage==1&&elapsed>500){check(KeyboardInput.Holds==1&&KeyboardInput.MaxHeld==1,"Se solaparon pulsaciones mientras el temporizador estaba ocupado.");send("stop",0,false);stage=2;}
    else if(stage==2&&elapsed>800){check(KeyboardInput.Held==0,"La parada no canceló la pulsación.");send("start",700,false);stage=3;}
    else if(stage==3&&elapsed>1900){check(KeyboardInput.Held==0,"La concesión vencida no detuvo la pulsación.");var leaseState=json.DeserializeObject(File.ReadAllText(Path.Combine(root,"data","movement-state.json"))) as System.Collections.Generic.Dictionary<string,object>;check(!(bool)leaseState["armed"],"La concesión vencida no detuvo el plan en espera.");send("start",3000,false);stage=4;}
    else if(stage==4&&elapsed>2300){form.GetType().GetMethod("OperatorStop",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(form,new object[]{"Parada de prueba"});stage=5;}
    else if(stage==5&&elapsed>2600){check(KeyboardInput.Held==0,"La parada manual no soltó la tecla.");send("start",3000,false);stage=6;}
    // Earlier this expected three holds in 3.3 seconds with a five-second interval,
    // inadvertently encoding the resume burst. Only the first partial hold is valid.
    else if(stage==6&&elapsed>3300){check(KeyboardInput.Holds==1&&KeyboardInput.MaxHeld==1,"Se reanudó antes del intervalo o tras una parada manual.");var state=json.DeserializeObject(File.ReadAllText(Path.Combine(root,"data","movement-state.json"))) as System.Collections.Generic.Dictionary<string,object>;check((string)state["autoOperatorStopped"]==id,"No se conservó la cancelación de sesión.");id=Guid.NewGuid().ToString("D");send("start",3000,false);stage=7;}
    else if(stage==7&&elapsed>3900){check(KeyboardInput.Holds==2&&KeyboardInput.Keys[1]==0x41&&KeyboardInput.Held==1,"Una sesión nueva no reinició su dirección y cadencia.");send("stop",0,true);stage=8;}
    else if(stage==8&&elapsed>4300){check(KeyboardInput.Held==0&&KeyboardInput.MaxHeld==1,"La cancelación de la sesión nueva no soltó la tecla.");var state=json.DeserializeObject(File.ReadAllText(Path.Combine(root,"data","movement-state.json"))) as System.Collections.Generic.Dictionary<string,object>;check((string)state["autoOperatorStopped"]==id&&Convert.ToInt32(state["autoCount"])==0&&Convert.ToInt32(state["autoAttemptCount"])==1,"La sesión nueva heredó contadores o perdió su cancelación.");report="Control automático: inicio sin hotkeys, pausa sin ráfaga, concesión vencida, F8 y nueva sesión comprobados; ninguna entrada nativa.";context.ExitThread();}
    if(elapsed>6000)throw new TimeoutException("Prueba de controlador sin terminar.");
   }catch(Exception error){failure=error;context.ExitThread();}};
   timer.Start();Application.Run(context);timer.Dispose();form.Dispose();signal.Dispose();
   var parent=Path.GetDirectoryName(Path.GetFullPath(root));if(parent==Path.GetTempPath().TrimEnd(Path.DirectorySeparatorChar)&&Path.GetFileName(root).StartsWith("wardogs-controller-test-"))Directory.Delete(root,true);
   if(failure!=null){Console.Error.WriteLine(failure.Message);return 1;}Console.WriteLine(report);return 0;
  }
 }
}
