using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Web.Script.Serialization;

namespace WardogsSeeding {
 public static class RunDeadline {
  public static DateTime? Read(string path, DateTime nowUtc) {
   return File.Exists(path) ? Parse(File.ReadAllText(path), nowUtc) : (DateTime?)null;
  }

  public static DateTime? Parse(string text, DateTime nowUtc) {
   var data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(text);
   if (data == null || !data.ContainsKey("format") || !data.ContainsKey("dayMadrid") || !data.ContainsKey("stopAtUtc") ||
       data["format"] as string != "wardogs-movement-run-v1") throw new ArgumentException("Limite de sesion no valido.");
   DateTime day, until;
   if (!DateTime.TryParseExact(data["dayMadrid"] as string, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out day) ||
       !DateTime.TryParseExact(data["stopAtUtc"] as string, new string[] { "yyyy-MM-dd'T'HH:mm:ss'Z'", "yyyy-MM-dd'T'HH:mm:ss.fff'Z'" },
         CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out until))
    throw new ArgumentException("Fecha del limite de sesion no valida.");
   TimeZoneInfo madrid = TimeZoneInfo.FindSystemTimeZoneById("Romance Standard Time");
   if (TimeZoneInfo.ConvertTimeFromUtc(until, madrid).Date != day.Date) throw new ArgumentException("El limite no corresponde a su dia de Madrid.");
   return TimeZoneInfo.ConvertTimeFromUtc(nowUtc, madrid).Date == day.Date ? until : (DateTime?)null;
  }
 }
}
