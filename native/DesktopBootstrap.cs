using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class DesktopBootstrap
{
    private const string AppId="wardogs-seeding-local-v1";
    private const string BaseUrl="http://127.0.0.1:24243";
    private static readonly JavaScriptSerializer Json=new JavaScriptSerializer {MaxJsonLength=1048576};
    private const string StartScript="const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');const root=process.argv[1],port=process.argv[2],data=path.join(root,'data');fs.mkdirSync(data,{recursive:true});const o=fs.openSync(path.join(data,'service-launch.log'),'a'),e=fs.openSync(path.join(data,'service-launch-error.log'),'a');const p=spawn(process.execPath,[path.join(root,'src','server.cjs')],{cwd:root,windowsHide:true,detached:true,stdio:['ignore',o,e],env:{...process.env,WARDOGS_DATA_DIR:data,WARDOGS_PORT:port,NODE_OPTIONS:''}});p.once('error',()=>{console.error('No se pudo iniciar el servicio local.');process.exitCode=1;});p.once('spawn',()=>{p.unref();fs.closeSync(o);fs.closeSync(e);});";

    [STAThread] public static int Main(string[] args)
    {
        string root=Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory),report=null;
        bool probe=args.Length==2&&args[0]=="--probe",selfTest=args.Length==2&&args[0]=="--self-test";
        if(probe||selfTest)report=Path.GetFullPath(args[1]);
        try
        {
            if(args.Length!=0&&!probe&&!selfTest)throw new InvalidOperationException("Argumentos no válidos.");
            string node=Path.Combine(root,"bin","runtime","node.exe"),app=Path.Combine(root,"bin","FarmDogsApp.exe");
            if(!File.Exists(node)||!File.Exists(app)||!File.Exists(Path.Combine(root,"src","server.cjs"))||!File.Exists(Path.Combine(root,"bin","runtime","LICENSE")))
                throw new InvalidOperationException("Faltan archivos de la aplicación. Conserva FarmDogs.exe junto a las carpetas bin, src y public.");
            string version=NodeVersion(node,root);
            if(probe){WriteReport(report,new {success=true,nodeVersion=version,bundledRuntime=true,appPresent=true,serviceSourcePresent=true,windowShown=false});return 0;}
            bool started;
            using(var mutex=new Mutex(false,"Local\\WardogsSeedingBootstrap"))
            {
                bool owns=false;
                try
                {
                    try{owns=mutex.WaitOne(15000);}catch(AbandonedMutexException){owns=true;}
                    if(!owns)throw new InvalidOperationException("Otra apertura sigue en curso. Espera un momento y vuelve a abrir la app.");
                    started=EnsureObserver(root,node,BaseUrl).GetAwaiter().GetResult();
                }
                finally{if(owns)mutex.ReleaseMutex();}
            }
            if(selfTest){WriteReport(report,new {success=true,nodeVersion=version,bundledRuntime=true,serviceStarted=started,serviceIdentity=AppId,windowShown=false,accountWindowCreated=false});return 0;}
            using(var gui=Process.Start(new ProcessStartInfo(app){WorkingDirectory=root,UseShellExecute=false})){}
            return 0;
        }
        catch(Exception error)
        {
            try{Directory.CreateDirectory(Path.Combine(root,"data"));File.AppendAllText(Path.Combine(root,"data","desktop-launch-error.log"),DateTime.UtcNow.ToString("o")+" "+error.Message+Environment.NewLine);}catch{}
            if(report!=null){try{WriteReport(report,new {success=false,error=error.Message,windowShown=false});}catch{}}
            else MessageBox.Show("No se pudo abrir FarmDogs.\n"+error.Message,"FarmDogs",MessageBoxButtons.OK,MessageBoxIcon.Information);
            return 1;
        }
    }

    private static void WriteReport(string file,object value){File.WriteAllText(file,Json.Serialize(value),new UTF8Encoding(false));}
    internal static string QuoteArgument(string value)
    {
        var result=new StringBuilder("\"");int slashes=0;
        foreach(char c in value)
        {
            if(c=='\\'){slashes++;continue;}
            if(c=='\"'){result.Append('\\',slashes*2+1);result.Append(c);slashes=0;continue;}
            result.Append('\\',slashes);slashes=0;result.Append(c);
        }
        result.Append('\\',slashes*2);result.Append('"');return result.ToString();
    }
    private static string NodeVersion(string node,string root)
    {
        using(var process=new Process())
        {
            process.StartInfo=new ProcessStartInfo(node,"--version"){WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
            process.StartInfo.EnvironmentVariables["NODE_OPTIONS"]="";process.Start();
            if(!process.WaitForExit(5000)){process.Kill();throw new InvalidOperationException("Node portable no responde.");}
            string version=process.StandardOutput.ReadToEnd().Trim();
            int major;string[] pieces=version.TrimStart('v').Split('.');
            if(process.ExitCode!=0||pieces.Length<3||!Int32.TryParse(pieces[0],out major)||major<24)throw new InvalidOperationException("El runtime incluido no es Node.js 24 o posterior.");
            return version;
        }
    }
    private static bool Refused(Exception error)
    {
        for(Exception current=error;current!=null;current=current.InnerException){var socket=current as SocketException;if(socket!=null&&socket.SocketErrorCode==SocketError.ConnectionRefused)return true;}
        return false;
    }
    internal static async Task<bool> ProbeService(HttpClient client,string baseUrl)
    {
        HttpResponseMessage response;
        try{response=await client.GetAsync(baseUrl+"/api/state").ConfigureAwait(false);}
        catch(HttpRequestException error){if(Refused(error))return false;throw new InvalidOperationException("No se puede comprobar el servicio local; no se inicia otro.");}
        catch(TaskCanceledException){throw new InvalidOperationException("El servicio local no responde a tiempo; no se inicia otro.");}
        using(response)
        {
            if(!response.IsSuccessStatusCode)throw new InvalidOperationException("El puerto local responde con otro estado. Revisa el servicio existente.");
            if(response.Content.Headers.ContentLength.HasValue&&response.Content.Headers.ContentLength.Value>1048576)throw new InvalidOperationException("La respuesta local no es válida.");
            string body=await response.Content.ReadAsStringAsync().ConfigureAwait(false);if(body.Length>1048576)throw new InvalidOperationException("La respuesta local es demasiado grande.");
            Dictionary<string,object> state;try{state=Json.DeserializeObject(body) as Dictionary<string,object>;}catch{throw new InvalidOperationException("El puerto local no responde como FarmDogs.");}
            object value;if(state==null||!state.TryGetValue("appId",out value)||(value as string)!=AppId)throw new InvalidOperationException("El puerto local está ocupado por otro servicio o una versión anterior.");
            return true;
        }
    }
    internal static async Task<bool> EnsureObserver(string root,string node,string baseUrl)
    {
        var address=new Uri(baseUrl);if(address.Scheme!="http"||address.Host!="127.0.0.1"||address.UserInfo.Length!=0||address.AbsolutePath!="/")throw new InvalidOperationException("Solo se admite el servicio local.");
        // Allow a cold local service and Windows connection refusal to finish.
        // A timeout remains an uncertain port; only ConnectionRefused permits starting.
        using(var client=new HttpClient(new HttpClientHandler {UseProxy=false,UseCookies=false,AllowAutoRedirect=false}) {Timeout=TimeSpan.FromMilliseconds(5000),MaxResponseContentBufferSize=1048576})
        {
            return await EnsureCore(()=>ProbeService(client,baseUrl),()=>StartObserver(root,node,address.Port),10000,()=>Task.Delay(200)).ConfigureAwait(false);
        }
    }
    private static void StartObserver(string root,string node,int port)
    {
        using(var starter=new Process())
        {
            starter.StartInfo=new ProcessStartInfo(node,"-e "+QuoteArgument(StartScript)+" "+QuoteArgument(root)+" "+port){WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,RedirectStandardError=true,RedirectStandardOutput=true};
            starter.StartInfo.EnvironmentVariables["NODE_OPTIONS"]="";starter.Start();
            if(!starter.WaitForExit(5000)){starter.Kill();throw new InvalidOperationException("No terminó la preparación del servicio local.");}
            if(starter.ExitCode!=0)throw new InvalidOperationException("No se pudo iniciar el servicio local. Consulta data/service-launch-error.log.");
        }
    }
    internal static async Task<bool> EnsureCore(Func<Task<bool>> probe,Action start,int timeoutMs,Func<Task> sleep)
    {
        if(await probe().ConfigureAwait(false))return false;
        start();var wait=Stopwatch.StartNew();
        while(wait.ElapsedMilliseconds<timeoutMs){await sleep().ConfigureAwait(false);if(await probe().ConfigureAwait(false))return true;}
        throw new InvalidOperationException("El servicio no terminó de abrirse. Consulta data/service-launch-error.log.");
    }
}
