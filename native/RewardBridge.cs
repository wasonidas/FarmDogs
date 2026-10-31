using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

// Reads rewards and executes only a locally authorised, expiring previous-week claim.
// The website receives no local-session token and no cookie/token APIs are used.
internal sealed class RewardBridge
{
    private const string Source="https://api.wardogsspain.com/api/cuenta/retos";
    private readonly HttpClient http;
    private readonly string root,readerId;
    private readonly Func<CoreWebView2> getCore;
    private readonly Func<bool> ready;
    private readonly Action<string> status;
    private string nonce,phase,commandId,accountId;
    private DateTime since,nextRead=DateTime.MinValue;
    private int generation;
    private bool handling;
    public string BeginClose(){generation++;string previous=commandId;Reset();return previous;}
    public async Task AbortForCloseAsync(){await AbortBrowserAsync();}

    public RewardBridge(HttpClient client,string appRoot,string id,Func<CoreWebView2> core,Func<bool> isReady,Action<string> report)
    {
        http=client;root=Path.GetFullPath(appRoot);readerId=id;getCore=core;ready=isReady;status=report;
    }
    private CoreWebView2 AccountCore()
    {
        try{var current=getCore();return ready()&&current!=null&&DesktopProtocol.IsAccount(current.Source)?current:null;}catch{return null;}
    }
    private bool Current(int epoch){return generation==epoch&&AccountCore()!=null;}
    private static bool GuidValue(string value){Guid result;return Guid.TryParse(value,out result);}
    private static DateTime Date(string value){DateTime result;if(!DateTime.TryParse(value,CultureInfo.InvariantCulture,DateTimeStyles.AssumeUniversal|DateTimeStyles.AdjustToUniversal,out result))return DateTime.MinValue;return result;}
    private void Report(string message){try{status(message);}catch{}}
    private void Reset(){nonce=null;phase=null;commandId=null;accountId=null;}
    private bool Recent(){var elapsed=DateTime.UtcNow-since;return elapsed>=TimeSpan.FromSeconds(-1)&&elapsed<=TimeSpan.FromSeconds(20);}

    public async Task ReadAsync()
    {
        var core=AccountCore();if(core==null||handling||DateTime.UtcNow<nextRead)return;
        if(nonce!=null){if(Recent())return;await CancelAsync();core=AccountCore();if(core==null)return;}
        nonce=Guid.NewGuid().ToString("D");phase="observation";since=DateTime.UtcNow;
        string id=DesktopProtocol.Json.Serialize(nonce),reader=DesktopProtocol.Json.Serialize(readerId);
        string script="(()=>{const id="+id+",reader="+reader+";const key='__wardogsRewardReadState';const all=window[key]||(window[key]=Object.create(null));if(all[reader])all[reader].abort();const c=new AbortController();all[reader]=c;const timer=setTimeout(()=>c.abort(),8000);(async()=>{try{const parts=await Promise.all(['https://api.wardogsspain.com/api/cuenta/yo','"+Source+"'].map(async url=>{const r=await fetch(url,{credentials:'include',cache:'no-store',signal:c.signal});let data=null;try{data=await r.json();}catch{}return {status:r.status,data};}));const me=parts[0],rewards=parts[1];if(me.status!==200||rewards.status!==200||!me.data||me.data.conectado!==true||!me.data.cuenta||!/^\\d{17}$/.test(me.data.cuenta.steamId||'')||!rewards.data){window.chrome.webview.postMessage({kind:'reward_observation_error',id,readerId:reader,httpStatus:me.status!==200?me.status:rewards.status});return;}window.chrome.webview.postMessage({kind:'reward_observation',id,readerId:reader,source:'"+Source+"',accountId:me.data.cuenta.steamId,data:rewards.data});}catch{window.chrome.webview.postMessage({kind:'reward_observation_error',id,readerId:reader});}finally{clearTimeout(timer);if(all[reader]===c)delete all[reader];}})();})()";
        bool failed=false;try{await core.ExecuteScriptAsync(script);}catch{failed=true;}
        if(failed){await DisconnectAsync();Report("No se pudo consultar el plazo de los premios.");}
    }

    public async Task<bool> HandleAsync(CoreWebView2WebMessageReceivedEventArgs args)
    {
        Dictionary<string,object> message;
        try{if(args.WebMessageAsJson.Length>131072)return false;message=DesktopProtocol.Object(DesktopProtocol.Json.DeserializeObject(args.WebMessageAsJson));}catch{return false;}
        string kind=DesktopProtocol.Text(message,"kind");
        if(kind!="reward_observation"&&kind!="reward_observation_error"&&kind!="reward_result")return false;
        if((handling&&kind!="reward_result")||AccountCore()==null||!DesktopProtocol.IsAccount(args.Source)||nonce==null||!Recent()||DesktopProtocol.Text(message,"id")!=nonce||DesktopProtocol.Text(message,"readerId")!=readerId)return true;
        int epoch=generation;bool failed=false;handling=true;
        try
        {
            if(kind=="reward_observation_error")
            {
                object code;nextRead=DateTime.UtcNow.AddSeconds(message.TryGetValue("httpStatus",out code)&&code is int&&(int)code==429?120:30);
                await DisconnectAsync();Report("Premios sin lectura reciente. El VIP y sedeo conservan su lector.");return true;
            }
            if(kind=="reward_result")
            {
                if(phase!="execution"||DesktopProtocol.Text(message,"commandId")!=commandId)return true;
                string value=DesktopProtocol.Text(message,"status");
                if(value!="success"&&value!="already_claimed"&&value!="skipped"&&value!="error"&&value!="uncertain")return true;
                string finishedId=commandId;Reset();nextRead=DateTime.UtcNow.AddSeconds(25);
                await SendResult(finishedId,value);Report(value=="success"?"Premio próximo a vencer cobrado y confirmado.":value=="uncertain"?"Cobro con resultado incierto; no se repetirá automáticamente.":"Comprobación de premios finalizada.");return true;
            }
            if(phase!="observation"||DesktopProtocol.Text(message,"source")!=Source)return true;
            string owner=DesktopProtocol.Text(message,"accountId");object data;
            if(owner==null||owner.Length!=17||!System.Text.RegularExpressions.Regex.IsMatch(owner,"^\\d{17}$")||!message.TryGetValue("data",out data)||DesktopProtocol.Object(data)==null)return true;
            accountId=owner;
            await DesktopProtocol.PostLocal(http,"/api/rewards/observe",new {readerId=readerId,accountId=owner,observedAt=DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture),source=Source,data=data});
            if(!Current(epoch))return true;
            var next=await DesktopProtocol.PostLocal(http,"/api/rewards/next",new {readerId=readerId});
            if(!Current(epoch))return true;
            object raw;var offered=next!=null&&next.TryGetValue("command",out raw)?DesktopProtocol.Object(raw):null;
            if(offered==null){Reset();nextRead=DateTime.UtcNow.AddSeconds(25);return true;}
            string offeredId=DesktopProtocol.Text(offered,"id");
            if(!GuidValue(offeredId)||DesktopProtocol.Text(offered,"readerId")!=readerId||DesktopProtocol.Text(offered,"accountId")!=owner){Reset();return true;}
            commandId=offeredId;phase="authorizing";
            var permit=await DesktopProtocol.PostLocal(http,"/api/rewards/authorize",new {readerId=readerId,commandId=offeredId});
            if(!Current(epoch))return true;
            var command=permit!=null&&permit.TryGetValue("command",out raw)?DesktopProtocol.Object(raw):null;
            if(command==null){Reset();return true;}
            if(DesktopProtocol.Text(command,"id")!=offeredId||DesktopProtocol.Text(command,"readerId")!=readerId||DesktopProtocol.Text(command,"accountId")!=owner){await SendResult(offeredId,"skipped");Reset();return true;}
            DateTime now=DateTime.UtcNow,expires=Date(DesktopProtocol.Text(command,"expiresAt")),issued=Date(DesktopProtocol.Text(command,"issuedAt"));
            if(expires<=now||issued>now.AddSeconds(1)||issued==DateTime.MinValue||expires<=issued||expires-issued>TimeSpan.FromSeconds(20)){await SendResult(offeredId,"skipped");Reset();return true;}
            var core=AccountCore();if(core==null){await SendResult(offeredId,"skipped");Reset();return true;}
            string executable=File.ReadAllText(Path.Combine(root,"public","reward-execution.js"));
            if(executable.Length>32768)throw new InvalidOperationException("Componente de cobro demasiado grande.");
            // A new nonce separates the remote observation from the authorised execution.
            nonce=Guid.NewGuid().ToString("D");since=DateTime.UtcNow;phase="execution";
            string valueCommand=DesktopProtocol.Json.Serialize(command),valueNonce=DesktopProtocol.Json.Serialize(nonce),valueReader=DesktopProtocol.Json.Serialize(readerId),valueId=DesktopProtocol.Json.Serialize(offeredId);
            string execute="(()=>{const id="+valueNonce+",readerId="+valueReader+",commandId="+valueId+";Promise.resolve(("+executable+")("+valueCommand+")).then(result=>window.chrome.webview.postMessage({kind:'reward_result',id,readerId,commandId,status:result&&result.status||'uncertain'})).catch(()=>window.chrome.webview.postMessage({kind:'reward_result',id,readerId,commandId,status:'uncertain'}));})()";
            await core.ExecuteScriptAsync(execute);return true;
        }
        catch{failed=true;}
        finally{handling=false;}
        if(failed)
        {
            string uncertain=commandId;Reset();if(uncertain!=null)await SendResult(uncertain,"uncertain");
            try{await DesktopProtocol.PostLocal(http,"/api/rewards/disconnect",new {readerId=readerId});}catch{}
            nextRead=DateTime.UtcNow.AddSeconds(30);Report("No se pudo actualizar el lector de premios; no se repetirá un cobro incierto.");
        }
        return true;
    }
    private async Task SendResult(string id,string outcome)
    {
        if(id==null)return;try{await DesktopProtocol.PostLocal(http,"/api/rewards/result",new {readerId=readerId,commandId=id,status=outcome});}catch{}
    }
    public async Task CancelAsync()
    {
        generation++;string previous=commandId;Reset();
        await AbortBrowserAsync();
        if(previous!=null)await SendResult(previous,"uncertain");
    }
    private async Task AbortBrowserAsync()
    {
        try
        {
            var core=getCore();if(core!=null&&DesktopProtocol.IsAccount(core.Source))
            {
                string reader=DesktopProtocol.Json.Serialize(readerId);
                await core.ExecuteScriptAsync("(()=>{const id="+reader+";const reads=window.__wardogsRewardReadState;if(reads&&reads[id]){reads[id].abort();delete reads[id];}const state=window.__wardogsRewardExecutionState;const active=state&&state.active&&state.active[id];if(active)active.controller.abort();})()");
            }
        }
        catch{}
    }
    public async Task DisconnectAsync()
    {
        await CancelAsync();try{await DesktopProtocol.PostLocal(http,"/api/rewards/disconnect",new {readerId=readerId});}catch{}
    }
}
