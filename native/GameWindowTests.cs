using System;

internal static class GameWindowTests
{
    private static int checks;
    private static void Check(bool value,string description){if(!value)throw new Exception(description);checks++;}
    private static GameWindowSnapshot Primary(long window=200,int pid=123){return new GameWindowSnapshot {Pid=pid,Window=window,ProcessName=GameWindowPolicy.GameProcessName,Visible=true,GeometryKnown=true,Width=2560,Height=1440,OriginX=0,OriginY=0};}
    private static GameWindowSnapshot Aux(){return new GameWindowSnapshot {Pid=123,Window=100,ProcessName=GameWindowPolicy.GameProcessName,Visible=false,GeometryKnown=true,Width=120,Height=0,OriginX=8,OriginY=31};}
    public static int Main()
    {
        try
        {
            var visible=Primary();var selected=GameWindowPolicy.Resolve(visible,null,null);Check(selected!=null&&selected.Window==200&&!selected.ResolvedFromAuxiliary,"Direct visible foreground lost");
            selected=GameWindowPolicy.Resolve(Aux(),null,new[]{visible});Check(selected!=null&&selected.Window==200&&selected.ForegroundWindow==100&&selected.ResolvedFromAuxiliary,"Invisible tiny game auxiliary not resolved");
            Check(selected.Pid==123&&selected.Width==2560&&selected.Height==1440&&selected.OriginX==0,"Canonical geometry changed");
            var browser=Aux();browser.ProcessName="brave";Check(GameWindowPolicy.Resolve(browser,visible,new[]{visible})==null,"Another foreground app became game");
            var unknown=Aux();unknown.GeometryKnown=false;Check(GameWindowPolicy.Resolve(unknown,null,new[]{visible})==null,"Unknown foreground geometry was accepted");
            Check(GameWindowPolicy.Resolve(Aux(),null,new[]{Primary(200,999)})==null,"Different game PID accepted");
            Check(GameWindowPolicy.Resolve(Aux(),null,new[]{Primary(200),Primary(300)})==null,"Ambiguous main game accepted");
            selected=GameWindowPolicy.Resolve(Aux(),Primary(300),new[]{Primary(200),Primary(300)});Check(selected!=null&&selected.Window==300,"Verified root owner not preferred");
            selected=GameWindowPolicy.Resolve(Aux(),null,new[]{Primary(200),Primary(200)});Check(selected!=null&&selected.Window==200,"Duplicate enumeration row became ambiguity");
            var minimized=Primary();minimized.Minimized=true;Check(GameWindowPolicy.Resolve(minimized,Primary(300),new[]{Primary(300)})==null,"Minimized real foreground looked through");
            var modal=Primary(400);modal.Width=700;modal.Height=400;selected=GameWindowPolicy.Resolve(modal,Primary(),new[]{Primary()});Check(selected!=null&&selected.Window==400&&!selected.ResolvedFromAuxiliary,"Visible large modal replaced by main");
            var hidden=Primary();hidden.Visible=false;Check(GameWindowPolicy.Resolve(Aux(),null,new[]{hidden})==null,"Hidden main captured");
            var tiny=Aux();tiny.Visible=true;selected=GameWindowPolicy.Resolve(tiny,null,new[]{Primary()});Check(selected!=null&&selected.Window==200,"Zero-height visible auxiliary not resolved");
            tiny.Height=30;Check(GameWindowPolicy.Resolve(tiny,Primary(),new[]{Primary()})==null,"Visible small dialog was looked through");
            Check(GameWindowPolicy.Resolve(null,Primary(),new[]{Primary()})==null,"Missing foreground accepted");
            var wrong=Primary();wrong.ProcessName="OtherGame";Check(GameWindowPolicy.Resolve(Aux(),wrong,new[]{wrong})==null,"Wrong process name accepted");
            var noWindow=Aux();noWindow.Window=0;Check(GameWindowPolicy.Resolve(noWindow,Primary(),new[]{Primary()})==null,"Invalid raw foreground handle accepted");
            Console.WriteLine(checks+" game window resolution checks passed; metadata fixtures only, no windows, capture or input.");return 0;
        }
        catch(Exception error){Console.Error.WriteLine(error);return 1;}
    }
}
