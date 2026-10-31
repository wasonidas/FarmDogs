// Shared by the WebView host and a test-only console probe. Building the script
// does not open a browser, read an account or perform a request.
internal static class AccountReadScript
{
    internal static string Build(string requestId)
    {
        var id=DesktopProtocol.Json.Serialize(requestId);
        return "(()=>{const id="+id+";const entries=[['vip','"+DesktopProtocol.VipUrl+"'],['sedeo','"+DesktopProtocol.SeedUrl+"'],['identity','"+DesktopProtocol.IdentityUrl+"']];for(const [endpoint,source] of entries){(async()=>{const c=new AbortController();const t=setTimeout(()=>c.abort(),15000);try{const r=await fetch(source,{credentials:'include',cache:'no-store',signal:c.signal});let data=await r.json();if(endpoint==='identity'){const me=data?.cuenta,team=me?.equipo;const cuenta=me?{steamId:me.steamId}:null;if(cuenta&&Object.hasOwn(me,'equipo'))cuenta.equipo=team===null?null:team&&typeof team==='object'?{slug:team.slug,tag:team.tag,nombre:team.nombre??team.name}:undefined;data={conectado:data?.conectado,cuenta};}window.chrome.webview.postMessage({kind:'account_part',id,endpoint,source,httpStatus:r.status,data});}catch{window.chrome.webview.postMessage({kind:'account_error',id,endpoint});}finally{clearTimeout(t);}})();}})();";
    }
}
