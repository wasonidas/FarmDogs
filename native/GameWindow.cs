using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

internal sealed class GameWindowSnapshot
{
    internal int Pid,Width,Height,OriginX,OriginY;
    internal long Window;
    internal string ProcessName;
    internal bool Visible,Minimized,GeometryKnown;
}
internal sealed class GameWindowTarget
{
    internal int Pid,Width,Height,OriginX,OriginY;
    internal long Window,ForegroundWindow;
    internal bool ResolvedFromAuxiliary;
}
// Pure choice policy. It never makes another app count as the foreground game.
internal static class GameWindowPolicy
{
    internal const string GameProcessName="WardogsClient-Win64-Shipping";
    private static bool Game(GameWindowSnapshot value){return value!=null&&value.Pid>0&&value.Window>0&&value.ProcessName==GameProcessName&&value.GeometryKnown&&value.Width>=0&&value.Height>=0;}
    private static bool Renderable(GameWindowSnapshot value,int pid){return Game(value)&&value.Pid==pid&&value.Visible&&!value.Minimized&&value.Width>=320&&value.Height>=200;}
    private static GameWindowTarget Target(GameWindowSnapshot value,GameWindowSnapshot foreground)
    {
        return new GameWindowTarget {Pid=value.Pid,Window=value.Window,Width=value.Width,Height=value.Height,OriginX=value.OriginX,OriginY=value.OriginY,ForegroundWindow=foreground.Window,ResolvedFromAuxiliary=value.Window!=foreground.Window};
    }
    internal static GameWindowTarget Resolve(GameWindowSnapshot foreground,GameWindowSnapshot rootOwner,IEnumerable<GameWindowSnapshot> windows)
    {
        if(!Game(foreground))return null;
        if(Renderable(foreground,foreground.Pid))return Target(foreground,foreground);
        // Never look through a visible surface with any client area, including
        // small dialogs. Fallback is only for invisible or zero-area helpers.
        if(foreground.Visible&&foreground.Width>0&&foreground.Height>0)return null;
        if(Renderable(rootOwner,foreground.Pid))return Target(rootOwner,foreground);
        GameWindowSnapshot selected=null;var seen=new HashSet<long>();
        if(windows!=null)foreach(var candidate in windows)
        {
            if(!Renderable(candidate,foreground.Pid)||!seen.Add(candidate.Window))continue;
            if(selected!=null)return null;selected=candidate;
        }
        return selected==null?null:Target(selected,foreground);
    }
}
// Reads window metadata only: no capture, focus changes, input, registry or hooks.
internal static class GameWindowResolver
{
    [StructLayout(LayoutKind.Sequential)] private struct RECT {public int Left,Top,Right,Bottom;}
    [StructLayout(LayoutKind.Sequential)] private struct POINT {public int X,Y;}
    private delegate bool EnumCallback(IntPtr window,IntPtr value);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr window,out RECT bounds);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr window,ref POINT origin);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window,uint flags);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumCallback callback,IntPtr value);
    private static GameWindowSnapshot Read(IntPtr window)
    {
        if(window==IntPtr.Zero)return null;
        try
        {
            uint pid=0;if(GetWindowThreadProcessId(window,out pid)==0||pid==0)return null;
            string processName;using(var process=Process.GetProcessById((int)pid)){if(process.HasExited)return null;processName=process.ProcessName;}
            RECT client;var origin=new POINT();bool geometry=GetClientRect(window,out client)&&ClientToScreen(window,ref origin);
            return new GameWindowSnapshot {Pid=(int)pid,Window=window.ToInt64(),ProcessName=processName,Visible=IsWindowVisible(window),Minimized=IsIconic(window),GeometryKnown=geometry,Width=client.Right-client.Left,Height=client.Bottom-client.Top,OriginX=origin.X,OriginY=origin.Y};
        }catch{return null;}
    }
    internal static GameWindowTarget ResolveForeground()
    {
        IntPtr raw=GetForegroundWindow();var foreground=Read(raw);
        if(foreground==null||foreground.ProcessName!=GameWindowPolicy.GameProcessName)return null;
        var owner=Read(GetAncestor(raw,3));
        if(foreground.Visible&&foreground.Width>0&&foreground.Height>0||owner!=null&&owner.Window!=foreground.Window)
        {
            var direct=GameWindowPolicy.Resolve(foreground,owner,null);if(direct!=null)return direct;
            if(foreground.Visible&&foreground.Width>0&&foreground.Height>0)return null;
        }
        var candidates=new List<GameWindowSnapshot>();
        if(!EnumWindows((window,unused)=>{uint pid=0;if(GetWindowThreadProcessId(window,out pid)!=0&&pid==foreground.Pid){var candidate=Read(window);if(candidate!=null)candidates.Add(candidate);}return true;},IntPtr.Zero))return null;
        // The user may change apps during enumeration. Require the same raw
        // foreground handle before publishing the canonical game target.
        if(GetForegroundWindow()!=raw)return null;
        return GameWindowPolicy.Resolve(foreground,owner,candidates);
    }
}
