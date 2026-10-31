using System;
using System.Collections.Generic;
using System.Globalization;
using System.Net;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

// These intentionally tiny stand-ins keep this executable independent of a browser,
// the real WebView2 runtime, the live observer service and every remote API.
namespace Microsoft.Web.WebView2.Core
{
    public sealed class CoreWebView2
    {
        public string Source { get; set; }
        public readonly List<string> Scripts = new List<string>();
        public Exception ScriptError;
        public Task<string> ExecuteScriptAsync(string script)
        {
            Scripts.Add(script);
            if(ScriptError==null)return Task.FromResult("null");
            var failed=new TaskCompletionSource<string>();failed.SetException(ScriptError);return failed.Task;
        }
    }
    public sealed class CoreWebView2WebMessageReceivedEventArgs
    {
        public string Source { get; set; }
        public string WebMessageAsJson { get; set; }
    }
}

internal static class RewardBridgeTests
{
    private const string Reader="22222222-2222-4222-8222-222222222222";
    private const string Owner="76561190000000001";
    private const string ApiSource="https://api.wardogsspain.com/api/cuenta/retos";
    private const string LocalToken="fixture-local-token-never-injected";
    private static int checks,scenarios;
    private static void Check(bool value,string text){if(!value)throw new Exception(text);checks++;}

    private sealed class Call
    {
        public string Method,Path,Token;
        public Dictionary<string,object> Body;
    }
    private sealed class FakeHttp : HttpMessageHandler
    {
        public readonly List<Call> Calls=new List<Call>();
        public Action<Call> AfterPost;
        public string FailRoute;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancel)
        {
            // HttpClient has no real transport behind this handler. Reject any code
            // that accidentally attempts to use it for the website or another host.
            Check(request.RequestUri.GetLeftPart(UriPartial.Authority)==DesktopProtocol.LocalBase,"La prueba intentó acceder a otro origen.");
            string method=request.Method.Method,path=request.RequestUri.AbsolutePath;
            var call=new Call {Method=method,Path=path};Calls.Add(call);
            if(method=="GET")
            {
                Check(path=="/api/state","GET local inesperado.");
                return Response(new {token=LocalToken,appId="wardogs-seeding-local-v1"});
            }
            Check(method=="POST","Método HTTP local inesperado.");
            IEnumerable<string> tokens;
            if(request.Headers.TryGetValues("X-Session-Token",out tokens))foreach(string token in tokens)call.Token=token;
            Check(call.Token==LocalToken,"No conservó la autorización solo en la petición local.");
            call.Body=DesktopProtocol.Object(DesktopProtocol.Json.DeserializeObject(await request.Content.ReadAsStringAsync()));
            Check(call.Body!=null,"DTO local inválido.");
            Check(path=="/api/rewards/observe"||path=="/api/rewards/next"||path=="/api/rewards/disconnect","Se llamó a un servicio distinto del lector de premios.");
            if(AfterPost!=null)AfterPost(call);
            if(path==FailRoute)throw new HttpRequestException("Fallo de transporte simulado.");
            return path=="/api/rewards/next"?Response(new {command=(object)null}):Response(new {ok=true});
        }
        private static HttpResponseMessage Response(object value)
        {return new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(DesktopProtocol.Json.Serialize(value))};}
        public int Count(string method,string path){int count=0;foreach(var call in Calls)if(call.Method==method&&call.Path==path)count++;return count;}
        public Call LastPost(string path){for(int i=Calls.Count-1;i>=0;i--)if(Calls[i].Method=="POST"&&Calls[i].Path==path)return Calls[i];return null;}
    }
    private sealed class Fixture : IDisposable
    {
        public readonly FakeHttp Handler=new FakeHttp();
        public readonly Microsoft.Web.WebView2.Core.CoreWebView2 Core=new Microsoft.Web.WebView2.Core.CoreWebView2 {Source=DesktopProtocol.AccountUrl};
        public readonly List<string> Reports=new List<string>();
        public readonly HttpClient Client;
        public readonly RewardBridge Bridge;
        public bool Ready=true,HasCore=true;
        public Fixture(string root)
        {
            Client=new HttpClient(Handler);
            Bridge=new RewardBridge(Client,root,Reader,()=>HasCore?Core:null,()=>Ready,value=>Reports.Add(value));
        }
        public async Task<string> Read()
        {
            await Bridge.ReadAsync();
            Check(Core.Scripts.Count>0,"No produjo la lectura simulada.");
            string script=Core.Scripts[Core.Scripts.Count-1];
            var match=Regex.Match(script,"const id=(\"[^\"]+\")");
            Check(match.Success,"No se pudo extraer el nonce del script real.");
            string id=DesktopProtocol.Json.Deserialize<string>(match.Groups[1].Value);Guid parsed;
            Check(Guid.TryParse(id,out parsed),"Nonce inválido.");
            Check(!script.Contains(LocalToken),"Se filtró el token local al navegador.");
            Check(script.Contains("credentials:'include'")&&script.Contains("cache:'no-store'"),"La lectura no usa la sesión existente y caché desactivada.");
            return id;
        }
        public Dictionary<string,object> Observation(string nonce)
        {
            return new Dictionary<string,object>{{"kind","reward_observation"},{"id",nonce},{"readerId",Reader},{"source",ApiSource},{"accountId",Owner},
                {"data",new Dictionary<string,object>{{"activos",true},{"semana","2026-10-26"},{"anterior",null},{"hitos",new object[0]}}}};
        }
        public Task<bool> Handle(Dictionary<string,object> value,string source)
        {return Bridge.HandleAsync(new Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs {Source=source,WebMessageAsJson=DesktopProtocol.Json.Serialize(value)});}
        public Task<bool> Handle(Dictionary<string,object> value){return Handle(value,DesktopProtocol.AccountUrl);}
        public void Dispose(){Client.Dispose();}
    }
    private static async Task ValidObservation(string root)
    {
        using(var f=new Fixture(root))
        {
            DateTime before=DateTime.UtcNow;string nonce=await f.Read();
            Check(f.Handler.Calls.Count==0,"La lectura inició peticiones nativas antes del mensaje autorizado.");
            Check(await f.Handle(f.Observation(nonce)),"No reconoció la observación propia.");
            Check(f.Handler.Count("POST","/api/rewards/observe")==1&&f.Handler.Count("POST","/api/rewards/next")==1,"Faltó observe o next.");
            Check(f.Handler.Count("GET","/api/state")==2,"No obtuvo la autorización local para ambas llamadas.");
            var observation=f.Handler.LastPost("/api/rewards/observe").Body;
            Check(DesktopProtocol.Text(observation,"readerId")==Reader&&DesktopProtocol.Text(observation,"accountId")==Owner,"Cambió el lector o la cuenta de la observación.");
            Check(DesktopProtocol.Text(observation,"source")==ApiSource&&DesktopProtocol.Object(observation["data"])!=null,"Se perdió la fuente o el cuerpo de retos.");
            string timestamp=DesktopProtocol.Text(observation,"observedAt");DateTime parsed;
            Check(Regex.IsMatch(timestamp,"^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"),"Regresión: observedAt debe usar ISO UTC con exactamente tres decimales.");
            Check(DateTime.TryParseExact(timestamp,"yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture,DateTimeStyles.AssumeUniversal|DateTimeStyles.AdjustToUniversal,out parsed)&&parsed>=before.AddMilliseconds(-1)&&parsed<=DateTime.UtcNow,"observedAt no refleja el momento real de recepción.");
            Check(f.Handler.Calls[1].Path=="/api/rewards/observe"&&f.Handler.Calls[3].Path=="/api/rewards/next","No respetó observe antes de next.");
            int scripts=f.Core.Scripts.Count;await f.Bridge.ReadAsync();
            Check(f.Core.Scripts.Count==scripts,"Repitió la lectura antes del intervalo de sondeo.");
        }
        scenarios++;
    }
    private static async Task UnavailableRead(string root)
    {
        using(var f=new Fixture(root))
        {
            f.Ready=false;await f.Bridge.ReadAsync();f.Ready=true;
            f.Core.Source="https://wardogsspain.com/servidores";await f.Bridge.ReadAsync();
            f.Core.Source=DesktopProtocol.AccountUrl;f.HasCore=false;await f.Bridge.ReadAsync();
            Check(f.Core.Scripts.Count==0&&f.Handler.Calls.Count==0,"Leyó con sesión no disponible, fuente ajena o navegador ausente.");
        }
        scenarios++;
    }
    private static async Task RejectUnboundMessages(string root)
    {
        using(var f=new Fixture(root))
        {
            string nonce=await f.Read();
            Check(await f.Handle(f.Observation(nonce),"https://wardogsspain.com.evil/mi-cuenta"),"No reconoció como propio el tipo de mensaje.");
            var wrong=f.Observation(nonce);wrong["id"]=Guid.NewGuid().ToString("D");await f.Handle(wrong);
            wrong=f.Observation(nonce);wrong["readerId"]=Guid.NewGuid().ToString("D");await f.Handle(wrong);
            wrong=f.Observation(nonce);wrong["source"]="https://api.wardogsspain.com/api/cuenta/vip";await f.Handle(wrong);
            wrong=f.Observation(nonce);wrong["accountId"]="invalido";await f.Handle(wrong);
            wrong=f.Observation(nonce);wrong["data"]="no es un objeto";await f.Handle(wrong);
            f.Ready=false;await f.Handle(f.Observation(nonce));f.Ready=true;
            f.Core.Source="https://wardogsspain.com/";await f.Handle(f.Observation(nonce));f.Core.Source=DesktopProtocol.AccountUrl;
            Check(f.Handler.Calls.Count==0,"Una fuente, nonce, cuenta, lector o disponibilidad inválidos llegaron al servicio local.");
            await f.Handle(f.Observation(nonce));
            Check(f.Handler.Count("POST","/api/rewards/observe")==1,"Los mensajes inválidos inutilizaron la observación válida pendiente.");
        }
        scenarios++;
    }
    private static async Task IgnoreUnrelatedAndMalformed(string root)
    {
        using(var f=new Fixture(root))
        {
            string nonce=await f.Read();var message=f.Observation(nonce);message["kind"]="vip_observation";
            Check(!await f.Handle(message),"Interceptó mensajes de otro lector.");
            Check(!await f.Bridge.HandleAsync(new Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs {Source=DesktopProtocol.AccountUrl,WebMessageAsJson="{"}),"Aceptó JSON mal formado.");
            Check(!await f.Bridge.HandleAsync(new Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs {Source=DesktopProtocol.AccountUrl,WebMessageAsJson=new string('x',131073)}),"Aceptó un mensaje por encima del límite.");
            Check(f.Handler.Calls.Count==0,"Un mensaje ajeno o mal formado produjo peticiones.");
        }
        scenarios++;
    }
    private static void ScopedAbort(Fixture f)
    {
        string script=f.Core.Scripts[f.Core.Scripts.Count-1];
        Check(script.Contains(Reader)&&script.Contains("__wardogsRewardReadState")&&script.Contains("__wardogsRewardExecutionState"),"La cancelación no se limita al lector de premios propio.");
        Check(script.Contains("reads[id].abort()")&&script.Contains("active.controller.abort()"),"No abortó ambas operaciones propias.");
        Check(!script.Contains("fetch(")&&!script.Contains("localStorage")&&!script.Contains("cookie")&&!script.Contains("__wardogsVip"),"La cancelación intentó mutaciones remotas o tocar otra sesión.");
    }
    private static async Task CancelInvalidatesNonce(string root)
    {
        using(var f=new Fixture(root))
        {
            string old=await f.Read();await f.Bridge.CancelAsync();ScopedAbort(f);
            await f.Handle(f.Observation(old));Check(f.Handler.Calls.Count==0,"La cancelación no invalidó el nonce o produjo una petición local innecesaria.");
            string fresh=await f.Read();Check(fresh!=old,"Una lectura nueva reutilizó el nonce cancelado.");
        }
        scenarios++;
    }
    private static async Task DisconnectOnlyRewards(string root)
    {
        using(var f=new Fixture(root))
        {
            string old=await f.Read();await f.Bridge.DisconnectAsync();ScopedAbort(f);
            Check(f.Handler.Count("POST","/api/rewards/disconnect")==1&&f.Handler.Count("POST","/api/rewards/observe")==0&&f.Handler.Count("POST","/api/rewards/next")==0,"La desconexión modificó lectores ajenos.");
            Check(DesktopProtocol.Text(f.Handler.LastPost("/api/rewards/disconnect").Body,"readerId")==Reader,"Revocó un lector distinto.");
            int requests=f.Handler.Calls.Count;await f.Handle(f.Observation(old));Check(f.Handler.Calls.Count==requests,"Aceptó una observación posterior a desconectar.");
        }
        scenarios++;
    }
    private static async Task AvailabilityChangeAfterObserve(string root)
    {
        foreach(bool navigation in new[]{false,true})using(var f=new Fixture(root))
        {
            string nonce=await f.Read();
            f.Handler.AfterPost=call=>{if(call.Path=="/api/rewards/observe"){if(navigation)f.Core.Source="https://wardogsspain.com/";else f.Ready=false;}};
            await f.Handle(f.Observation(nonce));
            Check(f.Handler.Count("POST","/api/rewards/observe")==1&&f.Handler.Count("POST","/api/rewards/next")==0,"Continuó buscando una ejecución tras perder la sesión o navegar.");
        }
        scenarios+=2;
    }
    private static async Task ReadErrorsStayScoped(string root)
    {
        using(var f=new Fixture(root))
        {
            string nonce=await f.Read();var error=f.Observation(nonce);error["kind"]="reward_observation_error";error["httpStatus"]=429;
            await f.Handle(error);ScopedAbort(f);
            Check(f.Handler.Count("POST","/api/rewards/disconnect")==1&&f.Handler.Count("POST","/api/rewards/observe")==0,"Un error remoto no revocó exclusivamente premios.");
            int scripts=f.Core.Scripts.Count;await f.Bridge.ReadAsync();Check(f.Core.Scripts.Count==scripts,"No respetó la espera tras limitarse las consultas.");
        }
        using(var f=new Fixture(root))
        {
            f.Core.ScriptError=new InvalidOperationException("Fallo simulado del navegador.");await f.Bridge.ReadAsync();
            Check(f.Handler.Count("POST","/api/rewards/disconnect")==1&&f.Reports.Count==1,"Un fallo de script no cerró y notificó el lector de premios.");
        }
        using(var f=new Fixture(root))
        {
            string nonce=await f.Read();f.Handler.FailRoute="/api/rewards/observe";await f.Handle(f.Observation(nonce));
            Check(f.Handler.Count("POST","/api/rewards/next")==0&&f.Handler.Count("POST","/api/rewards/disconnect")==1,"Un fallo local permitió continuar hacia una ejecución.");
        }
        scenarios+=3;
    }
    public static int Main(string[] args)
    {
        try
        {
            if(args.Length!=1)throw new Exception("Falta la raíz del proyecto para la prueba.");
            Run(args[0]).GetAwaiter().GetResult();
            Console.WriteLine(scenarios+" escenarios y "+checks+" comprobaciones del puente de premios correctos; sin navegador, red real ni cobros.");return 0;
        }
        catch(Exception error){Console.Error.WriteLine(error.ToString());return 1;}
    }
    private static async Task Run(string root)
    {
        await ValidObservation(root);await UnavailableRead(root);await RejectUnboundMessages(root);await IgnoreUnrelatedAndMalformed(root);
        await CancelInvalidatesNonce(root);await DisconnectOnlyRewards(root);await AvailabilityChangeAfterObserve(root);await ReadErrorsStayScoped(root);
    }
}
