using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace WardogsSeeding {
 public sealed class ControllerForm : Form {
  readonly MovementPolicy plan = new MovementPolicy();
  readonly AutomaticCadence automaticCadence = new AutomaticCadence();
  readonly Stopwatch clock = Stopwatch.StartNew();
  readonly NumericUpDown interval = new NumericUpDown(), hold = new NumericUpDown(), duration = new NumericUpDown();
  readonly ComboBox directions = new ComboBox();
  readonly DateTimePicker start = new DateTimePicker();
  readonly CheckBox scheduled = new CheckBox(), deployed = new CheckBox();
  readonly Label status = new Label(), detail = new Label();
  readonly Button arm = new Button(), test = new Button(), stop = new Button();
  readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
  readonly JavaScriptSerializer json = new JavaScriptSerializer();
  readonly string dataDir, eventsPath, statePath,appRoot;
  readonly DateTime? hardStop;
  readonly TimeZoneInfo madrid = TimeZoneInfo.FindSystemTimeZoneById("Romance Standard Time");
  readonly EventWaitHandle showRequest;
  CancellationTokenSource cancel;
  int gamePid, testCount, pulseHold, firstKey, secondKey;
  bool busy, singleStep, closing, hotkeysReady;
  string sessionId, lastKey, lastError;
  DateTime lastWrite = DateTime.MinValue;
  string autoSessionId, autoOperatorStopped, lastCommandId;
  DateTime autoLease;
  double autoLeaseMono;
  int autoCount;

  public ControllerForm(string root, DateTime? until, EventWaitHandle openRequest) {
   showRequest = openRequest;
   appRoot=Path.GetFullPath(root);hardStop = until; dataDir = Path.Combine(root, "data");
   Directory.CreateDirectory(dataDir);
   eventsPath = Path.Combine(dataDir, "movement-events.jsonl"); statePath = Path.Combine(dataDir, "movement-state.json");
   Text = "Wardogs - Control de movimiento"; ClientSize = new Size(600, 475);
   FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
   StartPosition = FormStartPosition.CenterScreen; Font = new Font("Segoe UI", 10);
   AddLabel("Movimiento de prueba", 20, 16, 550, 29).Font = new Font("Segoe UI", 16, FontStyle.Bold);
   AddLabel("F7: un paso de prueba. F8: detener. El seeding se inicia desde la app.", 20, 53, 560, 39);
   AddLabel("Intervalo (segundos)", 20, 104, 230, 25); ConfigureNumber(interval, "Intervalo en segundos", 260, 102, 5, 300, 60);
   AddLabel("Duracion de tecla (ms)", 20, 141, 230, 25); ConfigureNumber(hold, "Duracion de tecla en milisegundos", 260, 139, 100, 2000, 500);
   AddLabel("Duracion de sesion (min)", 20, 178, 230, 25); ConfigureNumber(duration, "Duracion de sesion en minutos", 260, 176, 1, 720, 25);
   AddLabel("Direcciones", 20, 215, 230, 25);
   directions.SetBounds(260, 213, 310, 29); directions.DropDownStyle = ComboBoxStyle.DropDownList;
   directions.Items.AddRange(new object[] { "A / D - lateral", "W / S - delante y atras" }); directions.SelectedIndex = 0; directions.AccessibleName = "Direcciones"; Controls.Add(directions);
   scheduled.Text = "Programar inicio (Madrid)"; scheduled.SetBounds(20, 254, 240, 27); Controls.Add(scheduled);
   start.Format = DateTimePickerFormat.Custom; start.CustomFormat = "dd/MM/yyyy HH:mm"; start.Value = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, madrid).AddMinutes(5); start.SetBounds(260, 251, 310, 29); start.AccessibleName = "Hora de inicio Madrid"; Controls.Add(start);
   deployed.Text = "Personaje desplegado en zona segura; chat y menus cerrados"; deployed.SetBounds(20, 290, 560, 27); Controls.Add(deployed);
   arm.Text = "Preparar sesion"; arm.SetBounds(20, 329, 175, 36); arm.Click += delegate { Arm(false); }; Controls.Add(arm);
   test.Text = "Probar un paso (F7)"; test.SetBounds(205, 329, 180, 36); test.Click += delegate { Arm(true); }; Controls.Add(test);
   stop.Text = "Detener (F8)"; stop.SetBounds(395, 329, 175, 36); stop.Click += delegate { OperatorStop("Detenido por el usuario"); }; Controls.Add(stop);
   status.SetBounds(20, 378, 560, 25); status.Font = new Font(Font, FontStyle.Bold); Controls.Add(status);
   detail.SetBounds(20, 405, 560, 32); detail.Font = new Font("Segoe UI", 8); Controls.Add(detail);
   AddLabel(hardStop.HasValue ? "Limite de hoy (Madrid): " + TimeZoneInfo.ConvertTimeFromUtc(hardStop.Value, madrid).ToString("dd/MM/yyyy HH:mm:ss") : "Sin limite especial de hoy; se aplica la duracion de sesion elegida.", 20, 445, 560, 24).Font = new Font("Segoe UI", 8);
   timer.Interval = 100; timer.Tick += OnTick; timer.Start();
   FormClosing += delegate { closing = true; Stop("Controlador cerrado"); timer.Stop(); };
   Write("opened", null); UpdateStatus();
  }
  Label AddLabel(string text, int x, int y, int width, int height) { Label label = new Label(); label.Text = text; label.SetBounds(x,y,width,height); Controls.Add(label); return label; }
  void ConfigureNumber(NumericUpDown control, string name, int x, int y, int min, int max, int value) { control.SetBounds(x,y,150,29); control.Minimum=min; control.Maximum=max; control.Value=value; control.AccessibleName=name; Controls.Add(control); }
  protected override void OnHandleCreated(EventArgs e) {
   base.OnHandleCreated(e);
   bool step = KeyboardInput.RegisterHotKey(Handle, 7, 0x4000, 0x76);
   bool toggle = KeyboardInput.RegisterHotKey(Handle, 8, 0x4000, 0x77);
   hotkeysReady = step && toggle;
  }
  protected override void OnHandleDestroyed(EventArgs e) { KeyboardInput.UnregisterHotKey(Handle,7); KeyboardInput.UnregisterHotKey(Handle,8); base.OnHandleDestroyed(e); }
  protected override void WndProc(ref Message m) {
   if (m.Msg == 0x0312) {
    if (m.WParam.ToInt32() == 8) OperatorStop("Detenido con F8");
    else if (m.WParam.ToInt32() == 7 && !plan.Armed && !busy && KeyboardInput.ForegroundIs(KeyboardInput.FindGame())) Arm(true);
   }
   base.WndProc(ref m);
  }
  void Arm(bool one) {
   if (busy || plan.Armed) return;
   try {
    if (!hotkeysReady) throw new InvalidOperationException("F7/F8 no disponibles.");
    if (!deployed.Checked) throw new InvalidOperationException("Confirma el despliegue y cierra el chat antes de empezar.");
    gamePid = KeyboardInput.FindGame(); if (gamePid == 0) throw new InvalidOperationException("Abre una unica instancia de Wardogs.");
    autoSessionId=null;automaticCadence.Select(null);autoCount=0;
    DateTime now = DateTime.UtcNow, when = now;
    if (scheduled.Checked && !one) {
     DateTime local = DateTime.SpecifyKind(start.Value, DateTimeKind.Unspecified);
     if (madrid.IsInvalidTime(local) || madrid.IsAmbiguousTime(local)) throw new InvalidOperationException("Hora de Madrid inexistente o repetida; elige otra.");
     when = TimeZoneInfo.ConvertTimeToUtc(local, madrid);
     if (when <= now) throw new InvalidOperationException("El inicio programado debe estar en el futuro.");
    }
    pulseHold = (int)hold.Value; singleStep = one;
    firstKey = directions.SelectedIndex == 0 ? 0x41 : 0x57; secondKey = directions.SelectedIndex == 0 ? 0x44 : 0x53;
    plan.Arm(now, when, TimeSpan.FromMinutes(one ? 1 : (double)duration.Value), TimeSpan.FromSeconds((double)interval.Value), clock.Elapsed.TotalMilliseconds, hardStop);
    sessionId = Guid.NewGuid().ToString(); lastError = null; cancel = new CancellationTokenSource();
    Write(one ? "step_armed" : "armed", null); UpdateStatus();
   } catch (Exception error) { Stop(error.Message); lastError = error.Message; UpdateStatus(); }
  }
  void Stop(string reason) {
   plan.Stop(reason); if (cancel != null) cancel.Cancel();
   try { KeyboardInput.Release(); } catch (Exception error) { lastError = "No se pudo confirmar la liberacion: " + error.Message; }
   try { Write("stopped", reason); } catch (Exception error) { lastError = "Error de registro: " + error.Message; }
   if (!closing) UpdateStatus();
  }
  void OperatorStop(string reason) { if(autoSessionId!=null)autoOperatorStopped=autoSessionId;Stop(reason); }
  void SelectAutomaticSession(string id) { automaticCadence.Select(id);autoSessionId=id;autoCount=automaticCadence.CompletedCount; }
  void ReadAutomaticCommand() {
   string file=Path.Combine(dataDir,"movement-command.json");if(!File.Exists(file))return;
   string text;using(var stream=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)){if(stream.Length>8192)throw new InvalidOperationException("Orden automatica demasiado grande.");using(var input=new StreamReader(stream))text=input.ReadToEnd();}
   var command=json.Deserialize<AutomaticCommand>(text);if(command==null||command.id==lastCommandId)return;
   try{command.Validate(DateTime.UtcNow);}catch(ArgumentException){lastCommandId=command.id;if(autoSessionId!=null&&plan.Armed)Stop("Orden automatica no vigente");return;}
   lastCommandId=command.id;
   if(command.kind=="stop"){
    if(command.sessionId==autoSessionId){if(command.cancelled)autoOperatorStopped=autoSessionId;Stop(command.reason??"Esperando una nueva comprobacion.");}
    return;
   }
   if(command.sessionId==autoOperatorStopped)return;
   if(command.kind=="watch"){
    if(!plan.Armed&&!busy){SelectAutomaticSession(command.sessionId);lastError=null;Write("auto_waiting",command.reason??"Esperando inicio de partida");}return;
   }
   if(plan.Armed){if(autoSessionId==command.sessionId){autoLease=command.LeaseUtc;autoLeaseMono=clock.Elapsed.TotalMilliseconds+(autoLease-DateTime.UtcNow).TotalMilliseconds;}return;}
   if(busy||!KeyboardInput.ForegroundIs(command.gamePid)||KeyboardInput.FindGame()!=command.gamePid||KeyboardInput.ModifiersDown())return;
   DateTime now=DateTime.UtcNow;DateTime limit=command.EndUtc;if(hardStop.HasValue&&hardStop.Value<limit)limit=hardStop.Value;
   if(limit<=now.AddMilliseconds(command.holdMs+100))return;
   SelectAutomaticSession(command.sessionId);autoLease=command.LeaseUtc;autoLeaseMono=clock.Elapsed.TotalMilliseconds+(autoLease-DateTime.UtcNow).TotalMilliseconds;gamePid=command.gamePid;pulseHold=command.holdMs;singleStep=false;
   firstKey=command.directions=="AD"?0x41:0x57;secondKey=command.directions=="AD"?0x44:0x53;
   plan.Arm(now,now,TimeSpan.FromMinutes(Math.Max(1,(limit-now).TotalMinutes)),TimeSpan.FromSeconds(command.intervalSeconds),clock.Elapsed.TotalMilliseconds,limit);
   plan.RestoreCadence(automaticCadence.CompletedCount,automaticCadence.NextDue(clock.Elapsed.TotalMilliseconds,plan.IntervalMs));
   sessionId=Guid.NewGuid().ToString();lastError=null;cancel=new CancellationTokenSource();Write("auto_armed",null);
  }
  async void OnTick(object sender, EventArgs args) {
   if (closing) return;
   if(AppShutdown.Requested(appRoot,dataDir,DateTime.UtcNow)){Close();return;}
   try{ReadAutomaticCommand();if(autoSessionId!=null&&plan.Armed&&(DateTime.UtcNow>=autoLease||clock.Elapsed.TotalMilliseconds>=autoLeaseMono))Stop("Esperando datos recientes del automatismo");}
   catch(Exception error){lastError=error.Message;Stop(error.Message);return;}
   if(busy)return;
   string pulsePlanId=null;
   try {
    if (showRequest.WaitOne(0)) {
     if (plan.Armed) Stop("Detenido para revisar los ajustes");
     Show(); WindowState = FormWindowState.Normal; Activate(); Write("shown", null);
    }
    bool wasArmed = plan.Armed;
    string decision = plan.Decide(DateTime.UtcNow, clock.Elapsed.TotalMilliseconds, KeyboardInput.ForegroundIs(gamePid), KeyboardInput.IsGame(gamePid));
    if (wasArmed && !plan.Armed) { Stop(plan.Reason); return; }
    if (decision == "pulse") {
     if ((plan.EndUtc - DateTime.UtcNow).TotalMilliseconds < pulseHold + 100) { Stop("Fin de la duracion elegida"); return; }
     if (KeyboardInput.ModifiersDown()) { Stop("Modificador de teclado pulsado"); return; }
     busy = true;
     pulsePlanId=sessionId;
     var attempt=autoSessionId==null?null:automaticCadence.Begin(clock.Elapsed.TotalMilliseconds,plan.IntervalMs,firstKey,secondKey);
     if(autoSessionId!=null&&attempt==null)return;
     int key = attempt!=null?attempt.Key:singleStep ? (testCount % 2 == 0 ? firstKey : secondKey) : (plan.Count % 2 == 0 ? firstKey : secondKey);
     lastKey = ((char)key).ToString();
     bool completed=false,belongs=attempt==null;
     try { Write("key_down_requested", null);await KeyboardInput.Hold(gamePid, key, pulseHold, cancel.Token);completed=true; }
     finally {
      if(attempt!=null){belongs=automaticCadence.Finish(attempt,clock.Elapsed.TotalMilliseconds,completed);if(belongs)autoCount=automaticCadence.CompletedCount;}
     }
     if(!belongs||pulsePlanId!=sessionId)return;
     if(attempt==null||plan.Armed)plan.Complete(clock.Elapsed.TotalMilliseconds); if (singleStep) testCount++;
     Write("key_released", null);
     if (singleStep) Stop("Paso de prueba terminado");
    }
    if ((DateTime.UtcNow - lastWrite).TotalSeconds >= 1) Write("heartbeat", null);
   } catch (OperationCanceledException) { if ((pulsePlanId==null||pulsePlanId==sessionId)&&plan.Armed) Stop("Pulsacion cancelada"); }
   catch (Exception error) { if(pulsePlanId==null||pulsePlanId==sessionId){lastError = error.Message; Stop(error.Message);} }
   finally { busy = false; if (!closing) UpdateStatus(); }
  }
  void UpdateStatus() {
   arm.Enabled = hotkeysReady && !plan.Armed && !busy; test.Enabled = hotkeysReady && !plan.Armed && !busy;
   status.Text = lastError ?? (plan.Armed ? plan.Reason : (plan.Reason ?? "Detenido - esperando configuracion"));
   status.ForeColor = lastError != null ? Color.Firebrick : plan.Armed ? Color.DarkGreen : Color.DimGray;
   string end = plan.EndUtc == default(DateTime) ? "--:--" : TimeZoneInfo.ConvertTimeFromUtc(plan.EndUtc, madrid).ToString("HH:mm:ss");
   detail.Text = "Pulsaciones: " + plan.Count + " | Tecla: " + (lastKey ?? "-") + " | Fin Madrid: " + end;
  }
  void Write(string kind, string reason) {
   var row = new Dictionary<string,object>();
   row["at"] = DateTime.UtcNow.ToString("o"); row["event"] = kind; row["pid"] = Process.GetCurrentProcess().Id;
   row["sessionId"] = sessionId; row["armed"] = plan.Armed; row["busy"] = busy;
   row["autoSessionId"]=autoSessionId;row["autoOperatorStopped"]=autoOperatorStopped;row["autoCount"]=autoCount;
   row["autoAttemptCount"]=automaticCadence.AttemptCount;row["autoLastPulseFinishedMono"]=automaticCadence.LastFinishedMono;
   row["gamePid"] = gamePid; row["gameForeground"] = KeyboardInput.ForegroundIs(gamePid);
   row["count"] = plan.Count; row["lastKey"] = lastKey; row["holdMs"] = pulseHold;
   row["intervalMs"] = plan.IntervalMs; row["singleStep"] = singleStep;
   row["startUtc"] = plan.StartUtc == default(DateTime) ? null : plan.StartUtc.ToString("o");
   row["endUtc"] = plan.EndUtc == default(DateTime) ? null : plan.EndUtc.ToString("o");
   row["reason"] = reason ?? plan.Reason; row["error"] = lastError; row["inputStructBytes"] = KeyboardInput.InputSize;
   row["hardStopUtc"] = hardStop.HasValue ? hardStop.Value.ToString("o") : null;
   string text = json.Serialize(row); string temporary = statePath + ".tmp";
   File.WriteAllText(temporary, text, new UTF8Encoding(false));
   bool saved = false;
   for (int i=0; i<5 && !saved; i++) {
    try { if (File.Exists(statePath)) File.Replace(temporary,statePath,null); else File.Move(temporary,statePath); saved=true; }
    catch (IOException) { if (i==4) throw; Thread.Sleep(10*(i+1)); }
   }
   if (kind != "heartbeat") File.AppendAllText(eventsPath,text+Environment.NewLine,new UTF8Encoding(false));
   lastWrite = DateTime.UtcNow;
  }
 }

 public static class Program {
  const string OpenEvent = "Local\\WardogsSeedingControllerOpen";
  [STAThread] public static void Main(string[] args) {
   bool background=Array.IndexOf(args,"--background")>=0;
   bool created; using (Mutex mutex = new Mutex(true,"Local\\WardogsSeedingController",out created)) {
    if (!created) {
     if(background)return;
     for (int attempt=0; attempt<3; attempt++) {
      try { using (EventWaitHandle signal=EventWaitHandle.OpenExisting(OpenEvent)) { signal.Set(); return; } }
      catch (WaitHandleCannotBeOpenedException) { Thread.Sleep(50); }
     }
     MessageBox.Show("El controlador ya se esta abriendo. Seleccionalo en la barra de tareas.","Wardogs - Control de movimiento"); return;
    }
    using (EventWaitHandle openRequest = new EventWaitHandle(false, EventResetMode.AutoReset, OpenEvent)) {
    string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,".."));
    Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
    try {
     DateTime? hardStop=RunDeadline.Read(Path.Combine(root,"data","movement-run.json"), DateTime.UtcNow);
     for (int i=0; i<args.Length; i++) if (args[i]=="--until-utc" && i+1<args.Length) {
      DateTime requested=DateTime.Parse(args[++i],CultureInfo.InvariantCulture,DateTimeStyles.AdjustToUniversal|DateTimeStyles.AssumeUniversal);
      if (!hardStop.HasValue || requested < hardStop.Value) hardStop=requested;
     }
     var form=new ControllerForm(root,hardStop,openRequest);
     if(background){var handle=form.Handle;var context=new ApplicationContext();form.FormClosed+=(s,e)=>context.ExitThread();Application.Run(context);}else Application.Run(form);
    } catch (Exception error) { if(!background)MessageBox.Show("No se pudo abrir el controlador: " + error.Message,"Wardogs - Control de movimiento",MessageBoxButtons.OK,MessageBoxIcon.Error); }
    finally { KeyboardInput.Release(); }
    }
   }
  }
 }
}
