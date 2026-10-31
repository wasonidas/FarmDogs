using System;
using System.Collections.Generic;

internal static class ForegroundAlertTests
{
    private static int checks;
    private static void Check(bool value,string message){checks++;if(!value)throw new Exception(message);}
    private static readonly DateTime Now=new DateTime(2026,10,31,12,0,0,DateTimeKind.Utc);
    private const string Session="11111111-1111-4111-8111-111111111111";
    private static Dictionary<string,object> Obj(params object[] values){var result=new Dictionary<string,object>();for(int i=0;i<values.Length;i+=2)result[(string)values[i]]=values[i+1];return result;}
    private static Dictionary<string,object> State(){return Obj("appId","wardogs-seeding-local-v1","now",Now.ToString("o"));}
    private static Dictionary<string,object> Moving(string status){return Obj("id",Session,"status",status,"endAt",Now.AddMinutes(5).ToString("o"),"purpose","break");}
    public static void Main()
    {
        var state=State();state["autoSeeding"]=Moving("waiting_game");
        var requirement=ForegroundAlertPolicy.FromState(state,Now);
        Check(requirement!=null&&requirement.Key=="movement:"+Session,"movimiento espera foco");
        Check(requirement.Detail.Contains("anti-AFK"),"propósito independiente");
        var serialized=new System.Web.Script.Serialization.JavaScriptSerializer();
        var roundtrip=serialized.DeserializeObject(serialized.Serialize(state)) as Dictionary<string,object>;
        Check(ForegroundAlertPolicy.FromState(roundtrip,Now)!=null,"contrato JSON del servicio");
        state["appId"]="otra-app";Check(ForegroundAlertPolicy.FromState(state,Now)==null,"identidad del servicio");state["appId"]="wardogs-seeding-local-v1";
        foreach(var status in new[]{"waiting_match","waiting_source","waiting_presence","waiting_controller","cancelled","expired","interrupted","error"}){state["autoSeeding"]=Moving(status);Check(ForegroundAlertPolicy.FromState(state,Now)==null,"no alarmar por "+status);}
        foreach(var status in new[]{"starting_movement","moving"}){state["autoSeeding"]=Moving(status);Check(ForegroundAlertPolicy.FromState(state,Now)!=null,"foco necesario "+status);}
        state["movement"]=Obj("autoOperatorStopped",Session);Check(ForegroundAlertPolicy.FromState(state,Now)==null,"F8 inmediato");state.Remove("movement");
        state["now"]=Now.AddSeconds(-4).ToString("o");Check(ForegroundAlertPolicy.FromState(state,Now)==null,"API antigua");
        state["now"]=Now.AddMilliseconds(1).ToString("o");Check(ForegroundAlertPolicy.FromState(state,Now)==null,"API futura");
        state["now"]=Now.ToString("o");((Dictionary<string,object>)state["autoSeeding"])["endAt"]=Now.ToString("o");Check(ForegroundAlertPolicy.FromState(state,Now)==null,"duración vencida");
        state["autoSeeding"]=null;state["teamClicker"]=Obj("enabled",true,"sessionId",Session);Check(ForegroundAlertPolicy.FromState(state,Now).Key=="team:"+Session,"espera selector");
        state["teamClicker"]=Obj("enabled",true,"sessionId","inválida");Check(ForegroundAlertPolicy.FromState(state,Now)==null,"sin UUID no hay aviso");
        var reason="Autoclic detenido: Wardogs ha perdido el foco o ha cambiado su ventana.";
        state["teamClicker"]=Obj("enabled",false,"sessionId",Session,"reason",reason);state["events"]=new object[]{Obj("kind","team_clicker_stopped","reason",reason,"at",Now.AddSeconds(-1).ToString("o"))};
        var terminal=ForegroundAlertPolicy.FromState(state,Now);Check(terminal!=null&&terminal.Once&&terminal.Title.Contains("DETENIDA"),"cancelación rápida no pierde aviso");
        roundtrip=serialized.DeserializeObject(serialized.Serialize(state)) as Dictionary<string,object>;Check(ForegroundAlertPolicy.FromState(roundtrip,Now).Once,"evento terminal del JSON real");
        state["events"]=new object[]{Obj("kind","team_clicker_stopped","reason",reason,"at",Now.AddSeconds(-11).ToString("o"))};Check(ForegroundAlertPolicy.FromState(state,Now)==null,"parada antigua no alarma");
        state["events"]=new object[]{Obj("kind","team_clicker_stopped","reason","Otra razón","at",Now.ToString("o"))};Check(ForegroundAlertPolicy.FromState(state,Now)==null,"evento distinto no prueba foco");
        var policy=new ForegroundAlertPolicy();
        Check(!policy.Update(requirement,false,true,0).Active,"debounce inicial");
        Check(!policy.Update(requirement,false,true,1199).Active,"debounce incompleto");
        var shown=policy.Update(requirement,false,true,1200);Check(shown.Active&&shown.PlaySound,"aviso grande y un sonido");
        shown=policy.Update(requirement,false,true,9000);Check(shown.Active&&!shown.PlaySound,"sin repetir sonido");
        Check(!policy.Update(requirement,true,true,9100).Active,"juego delante oculta aunque HUD falte");
        Check(!policy.Update(requirement,false,true,9200).Active,"nuevo episodio espera");
        shown=policy.Update(requirement,false,true,10400);Check(shown.Active&&!shown.PlaySound,"cooldown evita bombardeo");
        policy.Dismiss();Check(!policy.Update(requirement,false,true,12000).Active,"entendido no reaparece");
        Check(!policy.Update(null,false,true,13000).Active,"stop limpia");
        Check(!policy.Update(requirement,false,true,14000).Active,"nuevo episodio tras stop");
        shown=policy.Update(requirement,false,true,18000);Check(shown.Active&&shown.PlaySound,"cooldown cumplido");
        Check(!policy.Update(requirement,null,true,18100).Active,"foco desconocido no alarma");
        var muted=new ForegroundAlertPolicy();muted.Update(requirement,false,false,0);shown=muted.Update(requirement,false,false,1200);Check(shown.Active&&!shown.PlaySound,"silenciado conserva visual");
        Check(!muted.Update(requirement,false,true,1300).PlaySound,"habilitar sonido no dispara duplicado");
        Check(!muted.Update(requirement,false,true,-1).Active,"reloj hacia atrás no alarma");
        var once=new ForegroundAlertPolicy();once.Update(terminal,false,true,0);Check(once.Update(terminal,false,true,1200).PlaySound,"parada terminal avisa una vez");
        once.Update(terminal,true,true,2000);once.Update(terminal,false,true,16000);Check(!once.Update(terminal,false,true,18000).Active,"mismo UUID terminal no repite aunque recupere y pierda foco");
        Console.WriteLine(checks+" comprobaciones de avisos de foco; sin ventanas, audio, procesos ni entradas nativas.");
    }
}
