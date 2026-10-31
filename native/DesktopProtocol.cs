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
}
