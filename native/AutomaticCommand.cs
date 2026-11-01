using System;
using System.Globalization;

namespace WardogsSeeding {
 public sealed class AutomaticCommand {
  public string format,id,sessionId,kind,issuedAt,expiresAt,endAt,frameId,capturedAt,scene,directions,reason;
  public int gamePid,holdMs,intervalSeconds;
  public bool cancelled;
  public DateTime LeaseUtc {get;private set;}
  public DateTime EndUtc {get;private set;}
  static DateTime Date(string value){DateTime d;if(!DateTime.TryParse(value,CultureInfo.InvariantCulture,DateTimeStyles.AdjustToUniversal|DateTimeStyles.AssumeUniversal,out d))throw new ArgumentException("Fecha automatica no valida.");return d;}
  // Cancellation identifies an already submitted session; a cold helper may
  // receive F8 after its original watch lease has expired, before adopting it.
  public string CancellationSessionId() {
   Guid g;if(format!="wardogs-automatic-movement-v1"||!Guid.TryParse(id,out g)||!Guid.TryParse(sessionId,out g)||(kind!="start"&&kind!="stop"&&kind!="watch"))throw new ArgumentException("Orden automatica no valida.");
   return sessionId;
  }
  public void Validate(DateTime now) {
   CancellationSessionId();Guid g;
   if(kind=="stop")return;
   var issued=Date(issuedAt);LeaseUtc=Date(expiresAt);EndUtc=Date(endAt);
   if(issued>now.AddSeconds(1)||now-issued>TimeSpan.FromSeconds(5)||LeaseUtc<=now||LeaseUtc>issued.AddSeconds(5)||EndUtc<=now||EndUtc>now.AddMinutes(720))throw new ArgumentException("Orden automatica fuera de plazo.");
   if(holdMs<100||holdMs>2000||intervalSeconds<5||intervalSeconds>300||(directions!="AD"&&directions!="WS"))throw new ArgumentException("Configuracion automatica no valida.");
   if(kind=="watch")return;
   var capture=Date(capturedAt);
   if(capture>now.AddSeconds(1)||now-capture>TimeSpan.FromSeconds(5)||!Guid.TryParse(frameId,out g)||scene!="gameplay_hud"||gamePid<=0)throw new ArgumentException("Pantalla automatica no vigente.");
  }
 }
}
