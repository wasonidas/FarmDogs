using System;

namespace WardogsSeeding {
 public sealed class MovementPolicy {
  public bool Armed { get; private set; }
  public DateTime StartUtc { get; private set; }
  public DateTime EndUtc { get; private set; }
  public int Count { get; private set; }
  public double NextDueMono { get; private set; }
  public string Reason { get; private set; }
  public double IntervalMs { get; private set; }
  private bool entered;
  private double startMono;
  private double endMono;

  public void Arm(DateTime now, DateTime start, TimeSpan duration, TimeSpan interval, double mono, DateTime? hardStop) {
   if (duration.TotalMinutes < 1 || duration.TotalMinutes > 720 || interval.TotalSeconds < 5 || interval.TotalSeconds > 300) throw new ArgumentException("Duracion o intervalo fuera de rango.");
   if (start < now.AddMinutes(-1)) throw new ArgumentException("La hora de inicio ya paso.");
   DateTime end = start.Add(duration);
   if (hardStop.HasValue && hardStop.Value < end) end = hardStop.Value;
   if (end <= now || end <= start) throw new ArgumentException("El limite termina antes del inicio.");
   StartUtc = start; EndUtc = end; IntervalMs = interval.TotalMilliseconds;
   Count = 0; entered = false; Armed = true; Reason = "Esperando juego";
   NextDueMono = mono; startMono = mono; endMono = mono + (end - now).TotalMilliseconds;
  }

  public string Decide(DateTime now, double mono, bool foregroundGame, bool gameAlive) {
   if (!Armed) return "stopped";
   if (now >= EndUtc || mono >= endMono || mono < startMono) { Stop("Limite de tiempo"); return "stopped"; }
   if (!gameAlive) { Stop("Juego cerrado"); return "stopped"; }
   if (now < StartUtc) { Reason = "Programado"; return "waiting"; }
   if (!entered && now > StartUtc.AddMinutes(1)) { Stop("Inicio perdido: no hubo foco del juego"); return "stopped"; }
   if (!foregroundGame) {
    if (entered) { Stop("Perdida de foco: vuelve a armar para continuar"); return "stopped"; }
    Reason = "Vuelve al juego para empezar"; return "waiting";
   }
   entered = true;
   if (mono < NextDueMono) { Reason = "En marcha"; return "waiting"; }
   Reason = "Pulsacion"; return "pulse";
  }

  public void Complete(double mono) { Count++; NextDueMono = mono + IntervalMs; Reason = "En marcha"; }
  public void RestoreCadence(int completedCount, double nextDueMono) {
   if (!Armed || completedCount < 0 || Double.IsNaN(nextDueMono) || Double.IsInfinity(nextDueMono)) throw new ArgumentException("Cadencia automatica no valida.");
   Count = completedCount; NextDueMono = Math.Max(startMono,nextDueMono);
  }
  public void Stop(string reason) { Armed = false; Reason = reason; }
 }

 // The automatic session survives short OCR/focus pauses. A requested direction is
 // consumed before awaiting the keyboard; a canceled partial hold must not repeat it.
 public sealed class AutomaticPulseAttempt {
  internal readonly long Epoch;
  internal readonly string Session;
  public int Key { get; private set; }
  internal AutomaticPulseAttempt(long epoch,string session,int key) { Epoch=epoch;Session=session;Key=key; }
 }
 public sealed class AutomaticCadence {
  public string SessionId { get; private set; }
  public int CompletedCount { get; private set; }
  public int AttemptCount { get; private set; }
  public double? LastFinishedMono { get; private set; }
  long epoch;
  AutomaticPulseAttempt pending;
  public void Select(string session) {
   if(SessionId==session)return;
   SessionId=session;epoch++;CompletedCount=0;AttemptCount=0;LastFinishedMono=null;pending=null;
  }
  public double NextDue(double mono,double intervalMs) {
   if(Double.IsNaN(mono)||Double.IsInfinity(mono)||Double.IsNaN(intervalMs)||Double.IsInfinity(intervalMs)||intervalMs<5000||intervalMs>300000)throw new ArgumentException("Cadencia automatica fuera de rango.");
   return LastFinishedMono.HasValue?LastFinishedMono.Value+intervalMs:mono;
  }
  public AutomaticPulseAttempt Begin(double mono,double intervalMs,int firstKey,int secondKey) {
   if(SessionId==null||pending!=null||mono<NextDue(mono,intervalMs))return null;
   pending=new AutomaticPulseAttempt(epoch,SessionId,AttemptCount%2==0?firstKey:secondKey);AttemptCount++;return pending;
  }
  public bool Finish(AutomaticPulseAttempt attempt,double mono,bool completed) {
   if(attempt==null||attempt!=pending||attempt.Epoch!=epoch||attempt.Session!=SessionId)return false;
   if(Double.IsNaN(mono)||Double.IsInfinity(mono))throw new ArgumentException("Tiempo de liberacion no valido.");
   pending=null;LastFinishedMono=mono;if(completed)CompletedCount++;return true;
  }
 }

 public static class PulseTiming {
  public static int NextDelay(int durationMs, long elapsedMs) {
   if (durationMs < 100 || durationMs > 2000 || elapsedMs < 0) throw new ArgumentOutOfRangeException();
   if (elapsedMs >= durationMs) return 0;
   return (int)Math.Min(20L, durationMs - elapsedMs);
  }
 }
}
