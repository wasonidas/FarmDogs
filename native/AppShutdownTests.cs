using System;
using System.Collections.Generic;
internal static class AppShutdownTests
{
    private static int checks;
    private static void Check(bool value,string message){checks++;if(!value)throw new Exception(message);}
    private static Dictionary<string,object> Request(DateTime now){return new Dictionary<string,object>{{"format","farmdogs-app-shutdown-v1"},{"id","11111111-1111-4111-8111-111111111111"},{"root","C:\\Games\\FarmDogs"},{"servicePid",1234},{"issuedAt",now.ToString("o")},{"expiresAt",now.AddSeconds(5).ToString("o")}};}
    public static void Main()
    {
        var now=new DateTime(2026,10,31,17,0,0,DateTimeKind.Utc);var service=new Dictionary<string,object>{{"pid",1234},{"startedAt",now.AddMinutes(-1).ToString("o")}};var root="c:/games/FarmDogs/";
        Check(AppShutdown.ShouldClose(Request(now),service,root,now),"No reconoció el cierre propio confirmado.");
        foreach(var pair in new[]{new KeyValuePair<string,object>("format","other"),new KeyValuePair<string,object>("id","bad"),new KeyValuePair<string,object>("root","C:\\Other\\FarmDogs"),new KeyValuePair<string,object>("root","Games\\FarmDogs"),new KeyValuePair<string,object>("root","C:Games\\FarmDogs"),new KeyValuePair<string,object>("servicePid",0),new KeyValuePair<string,object>("servicePid",1235),new KeyValuePair<string,object>("issuedAt",now.AddMilliseconds(1).ToString("o")),new KeyValuePair<string,object>("expiresAt",now.ToString("o")),new KeyValuePair<string,object>("expiresAt",now.AddSeconds(6).ToString("o"))}){
            var request=Request(now);request[pair.Key]=pair.Value;Check(!AppShutdown.ShouldClose(request,service,root,now),"Admitió un cierre ajeno o fuera de plazo: "+pair.Key);
        }
        Check(!AppShutdown.ShouldClose(Request(now),new Dictionary<string,object>{{"pid",1235}},root,now),"La señal anterior cerró el servicio nuevo.");
        Check(!AppShutdown.ShouldClose(Request(now),new Dictionary<string,object>{{"pid",1234},{"startedAt",now.AddMilliseconds(1).ToString("o")}},root,now),"Un PID reciclado cerró la instancia nueva.");
        Check(!AppShutdown.ShouldClose(Request(now),service,root,now.AddSeconds(5)),"La señal vencida cerró la app.");
        Check(!AppShutdown.ShouldClose(null,service,root,now),"Sin señal no se cierra.");
        Check(!AppShutdown.ShouldClose(Request(now),null,root,now),"Sin servicio no se cierra.");
        Console.WriteLine(checks+" comprobaciones de cierre propio; sin ventanas, procesos ni entradas.");
    }
}
