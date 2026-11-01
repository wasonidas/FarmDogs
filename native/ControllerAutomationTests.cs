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
  public static bool HotkeysAvailable=true;
  public static bool RegisterHotKey(IntPtr h,int id,uint m,uint k){return HotkeysAvailable;}
  public static bool UnregisterHotKey(IntPtr h,int id){return true;}
  public static int FindGame(){return 1234;}public static bool ForegroundIs(int p){return p==1234;}public static bool IsGame(int p){return p==1234;}public static bool ModifiersDown(){return false;}
  public static void Release(){}
  public static async Task Hold(int pid,int vk,int milliseconds,CancellationToken token){Keys.Add(vk);Holds++;Held++;MaxHeld=Math.Max(MaxHeld,Held);try{await Task.Delay(milliseconds,token);}finally{Held--;}}
 }
 public static class ControllerAutomationTests {
  static int cancellationChecks;
  static void CheckCancellation(bool ok,string message){cancellationChecks++;if(!ok)throw new Exception(message);}
  static readonly BindingFlags Private=BindingFlags.Instance|BindingFlags.NonPublic;
  static void Invoke(ControllerForm form,string name,params object[] args){form.GetType().GetMethod(name,Private).Invoke(form,args);}
  static bool Armed(ControllerForm form){return ((MovementPolicy)form.GetType().GetField("plan",Private).GetValue(form)).Armed;}
  static void CancellationCase(Action<ControllerForm,string,JavaScriptSerializer> test){
   var root=Path.Combine(Path.GetTempPath(),"wardogs-controller-cancel-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Path.Combine(root,"data"));
   var signal=new EventWaitHandle(false,EventResetMode.AutoReset);ControllerForm form=null;
   try{form=new ControllerForm(root,DateTime.UtcNow.AddSeconds(30),signal);var handle=form.Handle;test(form,Path.Combine(root,"data","movement-command.json"),new JavaScriptSerializer());}
   finally{if(form!=null){Invoke(form,"Stop","Fin del caso de cancelacion");var timer=(System.Windows.Forms.Timer)form.GetType().GetField("timer",Private).GetValue(form);timer.Stop();timer.Dispose();form.Dispose();}signal.Dispose();var parent=Path.GetDirectoryName(Path.GetFullPath(root));if(parent!=Path.GetTempPath().TrimEnd(Path.DirectorySeparatorChar)||!Path.GetFileName(root).StartsWith("wardogs-controller-cancel-"))throw new Exception("Ruta temporal no valida");Directory.Delete(root,true);}
  }
  static void Submit(string file,JavaScriptSerializer json,string id,string kind,int age=0){var now=DateTime.UtcNow.AddMilliseconds(-age);File.WriteAllText(file,json.Serialize(new AutomaticCommand {format="wardogs-automatic-movement-v1",id=Guid.NewGuid().ToString("D"),sessionId=id,kind=kind,issuedAt=now.ToString("o"),expiresAt=now.AddSeconds(3).ToString("o"),endAt=DateTime.UtcNow.AddSeconds(20).ToString("o"),capturedAt=DateTime.UtcNow.ToString("o"),frameId=Guid.NewGuid().ToString("D"),scene="gameplay_hud",gamePid=1234,holdMs=2000,intervalSeconds=5,directions="AD"}));}
  static void PreflightCancellation(){
   CancellationCase((form,file,json)=>{var pending=Guid.NewGuid().ToString("D");Submit(file,json,pending,"watch");Invoke(form,"OperatorStop","F8 antes del primer comando");CheckCancellation(form.GetType().GetField("autoSessionId",Private).GetValue(form)==null,"La prueba ya habia adoptado el UUID pendiente");CheckCancellation((string)form.GetType().GetField("autoOperatorStopped",Private).GetValue(form)==pending,"F8 temprano no publico el UUID pendiente");Submit(file,json,pending,"start");Invoke(form,"ReadAutomaticCommand");CheckCancellation(!Armed(form),"F8 temprano permitio armar el primer start");Submit(file,json,pending,"watch");Invoke(form,"ReadAutomaticCommand");CheckCancellation(!Armed(form),"Un watch renovo la sesion cancelada");Submit(file,json,Guid.NewGuid().ToString("D"),"start");Invoke(form,"ReadAutomaticCommand");CheckCancellation(Armed(form),"Una nueva activacion explicita no pudo armar");});
   CancellationCase((form,file,json)=>{string old=Guid.NewGuid().ToString("D"),pending=Guid.NewGuid().ToString("D");Submit(file,json,old,"start");Invoke(form,"ReadAutomaticCommand");CheckCancellation(Armed(form),"No se preparo la sesion anterior");Submit(file,json,pending,"watch");Invoke(form,"OperatorStop","F8 entre dos sesiones");CheckCancellation(!Armed(form),"La parada no desarmo la sesion actual");CheckCancellation((string)form.GetType().GetField("autoOperatorStopped",Private).GetValue(form)==pending,"La app no puede observar la cancelacion pendiente");foreach(var id in new[]{old,pending}){Submit(file,json,id,"start");Invoke(form,"ReadAutomaticCommand");CheckCancellation(!Armed(form),"Se perdio una de las dos cancelaciones");}});
   CancellationCase((form,file,json)=>{var pending=Guid.NewGuid().ToString("D");Submit(file,json,pending,"watch",16000);Invoke(form,"OperatorStop","F8 tras arranque frio");Submit(file,json,pending,"start");Invoke(form,"ReadAutomaticCommand");CheckCancellation(!Armed(form),"La lease vencida impidio cancelar la sesion pendiente");});
   foreach(var malformed in new[]{"{", "null", "{\"format\":\"wardogs-automatic-movement-v1\",\"id\":\"bad\",\"sessionId\":\"bad\",\"kind\":\"watch\"}"})CancellationCase((form,file,json)=>{File.WriteAllText(file,malformed);Invoke(form,"OperatorStop","F8 con orden ilegible");for(var attempt=0;attempt<2;attempt++){Submit(file,json,Guid.NewGuid().ToString("D"),"start");Invoke(form,"ReadAutomaticCommand");CheckCancellation(!Armed(form),"La orden corregida borro la parada no resuelta");}CheckCancellation(((string)form.GetType().GetField("lastError",Private).GetValue(form)).Contains("vuelve a abrir FarmDogs"),"El fallo cerrado no explica como recuperarse");((CheckBox)form.GetType().GetField("deployed",Private).GetValue(form)).Checked=true;CheckCancellation((bool)form.GetType().GetField("hotkeysReady",Private).GetValue(form),"El caso manual no tiene hotkeys fake listas");Invoke(form,"Arm",false);CheckCancellation(!Armed(form),"La activacion manual sorteo la parada no resuelta");});
   CancellationCase((form,file,json)=>{Directory.CreateDirectory(file);Invoke(form,"OperatorStop","F8 con error de lectura");Directory.Delete(file);Submit(file,json,Guid.NewGuid().ToString("D"),"start");Invoke(form,"ReadAutomaticCommand");CheckCancellation(!Armed(form),"Un fallo I/O de la parada dejo rearmar");});
   CancellationCase((form,file,json)=>{Submit(file,json,Guid.NewGuid().ToString("D"),"watch");using(var locked=new FileStream(file,FileMode.Open,FileAccess.ReadWrite,FileShare.None))Invoke(form,"OperatorStop","F8 con archivo bloqueado");Submit(file,json,Guid.NewGuid().ToString("D"),"start");Invoke(form,"ReadAutomaticCommand");CheckCancellation(!Armed(form),"Un error de acceso se trato como archivo ausente");});
   CancellationCase((form,file,json)=>{Invoke(form,"OperatorStop","F8 sin sesion pendiente");Submit(file,json,Guid.NewGuid().ToString("D"),"start");Invoke(form,"ReadAutomaticCommand");CheckCancellation(Armed(form),"F8 estando idle bloqueo un inicio explicito posterior");});
   KeyboardInput.HotkeysAvailable=false;
   try{CancellationCase((form,file,json)=>{foreach(var kind in new[]{"watch","start"}){Submit(file,json,Guid.NewGuid().ToString("D"),kind);Invoke(form,"ReadAutomaticCommand");CheckCancellation(!Armed(form),"El inicio automatico sorteo el fallo de registro F8");CheckCancellation(((string)form.GetType().GetField("lastError",Private).GetValue(form)).Contains("F7/F8 no disponibles"),"El fallo de hotkey no aparece en el estado");}});}finally{KeyboardInput.HotkeysAvailable=true;}
   CheckCancellation(KeyboardInput.Holds==0,"Las pruebas de cancelacion ejecutaron una pulsacion");
   Console.WriteLine(cancellationChecks+" comprobaciones de F8 temprano/cancelacion pendiente, sin entradas nativas ni ventanas visibles.");
  }
  [STAThread] public static int Main(){
   try{PreflightCancellation();}catch(Exception error){Console.Error.WriteLine(error.InnerException==null?error.Message:error.InnerException.Message);return 1;}
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
