using System;
internal static class DesktopProtocolTests
{
    private static int count;
    private static void Check(bool condition){if(!condition)throw new Exception("Fallo de política de origen.");count++;}
    public static int Main()
    {
        Check(DesktopProtocol.IsLocal("http://127.0.0.1:24243/mini"));
        foreach(var u in new[]{"https://127.0.0.1:24243/mini","http://localhost:24243/mini","http://127.0.0.1:24244/mini","http://127.0.0.1.evil/mini","http://u:p@127.0.0.1:24243/mini"})Check(!DesktopProtocol.IsLocal(u));
        Check(DesktopProtocol.IsAccount("https://wardogsspain.com/mi-cuenta/"));
        foreach(var u in new[]{"https://wardogsspain.com.evil/mi-cuenta","https://wardogsspain.com/otro","https://api.wardogsspain.com/mi-cuenta","http://wardogsspain.com/mi-cuenta","https://u:p@wardogsspain.com/mi-cuenta"})Check(!DesktopProtocol.IsAccount(u));
        Check(DesktopProtocol.IsLoginNavigation("https://steamcommunity.com/openid/login"));
        Check(DesktopProtocol.IsLoginNavigation("https://login.steampowered.com/login"));
        foreach(var u in new[]{"https://steamcommunity.com.evil/login","https://evilsteamcommunity.com/login","javascript:alert(1)","https://steamcommunity.com:444/login","https://u:p@steamcommunity.com/login"})Check(!DesktopProtocol.IsLoginNavigation(u));
        Console.WriteLine(count+" comprobaciones de origen de escritorio correctas.");return 0;
    }
}
