using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

internal static class DesktopBootstrapTests
{
    private static int checks;
    private static void Check(bool value,string text){if(!value)throw new Exception(text);checks++;}
    private static void Reject(Action action,string text){bool rejected=false;try{action();}catch{rejected=true;}Check(rejected,text);}
    private sealed class FakeHttp : HttpMessageHandler
    {
        internal string Body="{\"appId\":\"wardogs-seeding-local-v1\"}";internal HttpStatusCode Status=HttpStatusCode.OK;internal Exception Error;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancellation)
        {if(Error!=null)throw Error;return Task.FromResult(new HttpResponseMessage(Status){Content=new StringContent(Body)});}
    }
    public static int Main(string[] args)
    {
        try
        {
            int starts=0,requests=0;
            bool reused=DesktopBootstrap.EnsureCore(()=>Task.FromResult(true),()=>starts++,100,()=>Task.FromResult(0)).GetAwaiter().GetResult();Check(!reused&&starts==0,"No reutilizó el servicio existente.");
            bool started=DesktopBootstrap.EnsureCore(()=>Task.FromResult(++requests>=3),()=>starts++,100,()=>Task.FromResult(0)).GetAwaiter().GetResult();Check(started&&starts==1&&requests==3,"No esperó identidad tras un único arranque.");
            Reject(()=>DesktopBootstrap.EnsureCore(()=>{throw new InvalidOperationException("timeout");},()=>starts++,100,()=>Task.FromResult(0)).GetAwaiter().GetResult(),"Un puerto incierto no se rechazó.");Check(starts==1,"Se abrió otro servicio sobre un puerto incierto.");
            using(var handler=new FakeHttp())using(var client=new HttpClient(handler))
            {
                Check(DesktopBootstrap.ProbeService(client,"http://fixture").GetAwaiter().GetResult(),"Identidad propia rechazada.");
                handler.Body=new JavaScriptSerializer().Serialize(new {appId="wardogs-seeding-local-v1",installationRoot="C:\\Games\\FarmDogs"});
                Check(DesktopBootstrap.ProbeService(client,"http://fixture","c:/games/FarmDogs/").GetAwaiter().GetResult(),"Ruta propia normalizada rechazada.");
                Reject(()=>DesktopBootstrap.ProbeService(client,"http://fixture","C:\\Other\\FarmDogs").GetAwaiter().GetResult(),"Se reutilizó otra instalación.");
                handler.Body="{\"appId\":\"wardogs-seeding-local-v1\"}";Reject(()=>DesktopBootstrap.ProbeService(client,"http://fixture","C:\\Games\\FarmDogs").GetAwaiter().GetResult(),"Se aceptó un servicio sin instalación.");
                Check(!DesktopBootstrap.SameRoot("C:\\Games\\FarmDogs","relative"),"Una ruta relativa se confundió con la instalación.");
                Check(!DesktopBootstrap.SameRoot("C:\\Games\\FarmDogs","C:Games\\FarmDogs"),"Una ruta relativa a unidad se confundió con la instalación.");
                handler.Body="{\"appId\":\"other\"}";Reject(()=>DesktopBootstrap.ProbeService(client,"http://fixture").GetAwaiter().GetResult(),"Servicio ajeno aceptado.");
                handler.Body="not-json";Reject(()=>DesktopBootstrap.ProbeService(client,"http://fixture").GetAwaiter().GetResult(),"JSON inválido aceptado.");
                handler.Status=HttpStatusCode.Redirect;Reject(()=>DesktopBootstrap.ProbeService(client,"http://fixture").GetAwaiter().GetResult(),"Redirección aceptada.");
                handler.Error=new TaskCanceledException();Reject(()=>DesktopBootstrap.ProbeService(client,"http://fixture").GetAwaiter().GetResult(),"Tiempo agotado confundido con puerto libre.");
                handler.Error=new HttpRequestException("refused",new SocketException(10061));Check(!DesktopBootstrap.ProbeService(client,"http://fixture").GetAwaiter().GetResult(),"Conexión rechazada no detectada.");
            }
            if(args.Length!=1)throw new Exception("Falta el runtime de prueba.");
            string[] values={"C:\\ruta con espacios\\","texto \"entre comillas\"","$() y `texto`",""};
            string script="process.stdout.write(JSON.stringify(process.argv.slice(1)))",arguments="-e "+DesktopBootstrap.QuoteArgument(script);
            foreach(string value in values)arguments+=" "+DesktopBootstrap.QuoteArgument(value);
            using(var p=Process.Start(new ProcessStartInfo(args[0],arguments){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true}))
            {
                string output=p.StandardOutput.ReadToEnd();if(!p.WaitForExit(5000))throw new Exception("Runtime de argumentos sin terminar.");
                var parsed=new JavaScriptSerializer().Deserialize<string[]>(output);Check(parsed.Length==values.Length,"Cambió la cantidad de argumentos.");for(int i=0;i<values.Length;i++)Check(parsed[i]==values[i],"Argumento alterado.");
            }
            IsolatedStartup(args[0]);
            Console.WriteLine(checks+" comprobaciones del ejecutable de apertura; sin GUI, Steam ni entradas de juego.");return 0;
        }
        catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
    }
    private static void IsolatedStartup(string node)
    {
        string root=Path.Combine(Path.GetTempPath(),"wardogs-bootstrap-test-"+Guid.NewGuid().ToString("N")+" space");
        var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();int port=((IPEndPoint)listener.LocalEndpoint).Port;listener.Stop();
        string url="http://127.0.0.1:"+port;bool started=false;
        Directory.CreateDirectory(Path.Combine(root,"src"));
        // A real loopback response slower than 1500ms must survive a cold start.
        File.WriteAllText(Path.Combine(root,"src","server.cjs"),"const http=require('node:http');let cold=true;const server=http.createServer((q,r)=>{const reply=()=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify({appId:'wardogs-seeding-local-v1',installationRoot:process.cwd()}));if(q.url==='/test-stop')server.close(()=>process.exit(0));};if(q.url==='/api/state'&&cold){cold=false;setTimeout(reply,2000);}else reply();});server.listen(Number(process.env.WARDOGS_PORT),'127.0.0.1');");
        try
        {
            started=DesktopBootstrap.EnsureObserver(root,node,url).GetAwaiter().GetResult();Check(started,"No inició el servicio aislado.");
            Check(!DesktopBootstrap.EnsureObserver(root,node,url).GetAwaiter().GetResult(),"No reutilizó el servicio aislado.");
            Check(File.Exists(Path.Combine(root,"data","service-launch.log")),"No preparó el registro del servicio.");
        }
        finally
        {
            if(started)
            {
                using(var client=new HttpClient(new HttpClientHandler {UseProxy=false}) {Timeout=TimeSpan.FromSeconds(2)})client.GetStringAsync(url+"/test-stop").GetAwaiter().GetResult();
                Thread.Sleep(100);
            }
            string actual=Path.GetFullPath(root),parent=Path.GetDirectoryName(actual);
            if(parent!=Path.GetTempPath().TrimEnd(Path.DirectorySeparatorChar)||!Path.GetFileName(actual).StartsWith("wardogs-bootstrap-test-"))throw new Exception("Ruta de limpieza no válida.");
            for(int i=0;i<10;i++){try{Directory.Delete(actual,true);break;}catch(IOException){if(i==9)throw;Thread.Sleep(20);}}
        }
    }
}
