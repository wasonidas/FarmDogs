using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

internal static class DesktopProtocol
{
    public const string LocalBase = "http://127.0.0.1:24243";
    public const string AccountUrl = "https://wardogsspain.com/mi-cuenta";
    public const string VipUrl = "https://api.wardogsspain.com/api/cuenta/vip";
    public const string SeedUrl = "https://api.wardogsspain.com/api/cuenta/sedeo";
    public const string IdentityUrl = "https://api.wardogsspain.com/api/cuenta/yo";
    public static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength=131072 };
    public static bool IsLocal(string value)
    {
        Uri u; return Uri.TryCreate(value,UriKind.Absolute,out u) && u.Scheme=="http" && u.Host=="127.0.0.1" && u.Port==24243 && u.UserInfo.Length==0;
    }
    public static bool IsAccount(string value)
    {
        Uri u;return Uri.TryCreate(value,UriKind.Absolute,out u) && u.Scheme=="https" && u.Host=="wardogsspain.com" && u.IsDefaultPort && u.UserInfo.Length==0 && u.AbsolutePath.TrimEnd('/')=="/mi-cuenta";
    }
    public static bool IsLoginNavigation(string value)
    {
        Uri u;if(!Uri.TryCreate(value,UriKind.Absolute,out u)||u.Scheme!="https"||!u.IsDefaultPort||u.UserInfo.Length!=0)return false;
        var h=u.IdnHost.ToLowerInvariant();return h=="wardogsspain.com"||h=="api.wardogsspain.com"||h=="steamcommunity.com"||h.EndsWith(".steamcommunity.com")||h=="steampowered.com"||h.EndsWith(".steampowered.com");
    }
    public static Dictionary<string,object> Object(object value) { return value as Dictionary<string,object>; }
    public static string Text(Dictionary<string,object> value,string key)
    {
        object result;return value!=null&&value.TryGetValue(key,out result)?result as string:null;
    }
    public static async Task<Dictionary<string,object>> PostLocal(HttpClient client,string route,object value)
    {
        var state=Object(Json.DeserializeObject(await client.GetStringAsync(LocalBase+"/api/state")));
        var token=Text(state,"token");if(String.IsNullOrEmpty(token))throw new InvalidOperationException("No responde el servicio local.");
        using(var request=new HttpRequestMessage(HttpMethod.Post,LocalBase+route))
        {
            request.Headers.Add("X-Session-Token",token);
            request.Content=new StringContent(Json.Serialize(value),Encoding.UTF8,"application/json");
            using(var response=await client.SendAsync(request))
            {
                var body=Object(Json.DeserializeObject(await response.Content.ReadAsStringAsync()));
                if(!response.IsSuccessStatusCode)throw new InvalidOperationException(Text(body,"error")??"No se pudo guardar la lectura.");
                return body;
            }
        }
    }
    public static async Task StopOwnJob(HttpClient client,string root,string kind,string ownerId)
    {
        Guid parsed;if((kind!="scheduled"&&kind!="activity")||!Guid.TryParseExact(ownerId,"D",out parsed))throw new InvalidOperationException("Tarea de parada no valida.");
        var parser=new JavaScriptSerializer {MaxJsonLength=524288};Dictionary<string,object> state;
        using(var response=await client.GetAsync(LocalBase+"/api/state"))
        {
            response.EnsureSuccessStatusCode();state=Object(parser.DeserializeObject(await response.Content.ReadAsStringAsync()));
        }
        if(Text(state,"appId")!="wardogs-seeding-local-v1"||!SameInstallation(Text(state,"installationRoot"),root))throw new InvalidOperationException("La parada no pertenece a esta instalacion.");
        object raw;var capabilities=state.TryGetValue("capabilities",out raw)?Object(raw):null;
        if(capabilities==null||!capabilities.TryGetValue("deferredEntryFocus",out raw)||!(raw is bool)||!(bool)raw)throw new InvalidOperationException("El servicio no admite la parada vinculada a esta tarea.");
        var job=state.TryGetValue(kind=="scheduled"?"opening":"activity",out raw)?Object(raw):null;
        if(Text(job,"id")!=ownerId)return; // A replacement job must never receive this stop.
        if(Text(job,"initialFocus")!="desktop")throw new InvalidOperationException("La tarea no autorizo el permiso de esta ventana.");
        var token=Text(state,"token");if(String.IsNullOrEmpty(token))throw new InvalidOperationException("No responde el servicio local.");
        using(var request=new HttpRequestMessage(HttpMethod.Post,LocalBase+(kind=="scheduled"?"/api/opening/cancel":"/api/activity/stop")))
        {
            request.Headers.Add("X-Session-Token",token);request.Content=new StringContent(Json.Serialize(new{expectedJobId=ownerId}),Encoding.UTF8,"application/json");
            using(var response=await client.SendAsync(request)){response.EnsureSuccessStatusCode();}
        }
    }
    private static bool SameInstallation(string actual,string expected)
    {
        try{return !String.IsNullOrEmpty(actual)&&System.IO.Path.IsPathRooted(actual)&&System.IO.Path.IsPathRooted(expected)&&String.Equals(System.IO.Path.GetFullPath(actual).TrimEnd('\\','/'),System.IO.Path.GetFullPath(expected).TrimEnd('\\','/'),StringComparison.OrdinalIgnoreCase);}catch{return false;}
    }
}
