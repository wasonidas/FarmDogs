using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// Passive app component: never activates a window and never sends input.
internal sealed class GameFrame
{
    public string Path;
    public string CapturedAt;
    public string CaptureFinishedAt;
    public string FrameId;
    public int Pid;
    public long Window;
}
internal static class GameFrameCapture
{
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr window, ref Point point);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    public static GameFrame Capture(string outputDirectory)
    {
        // This affects only this helper's coordinate interpretation.
        if (!SetProcessDPIAware()) throw new InvalidOperationException("No se pudo establecer la escala del lector.");
        var window = GetForegroundWindow();
        uint pid; GetWindowThreadProcessId(window, out pid);
        if (window == IntPtr.Zero || pid == 0 || Process.GetProcessById((int)pid).ProcessName != "WardogsClient-Win64-Shipping")
            throw new InvalidOperationException("game_not_foreground");
        Rect client; var origin = new Point();
        if (!GetClientRect(window, out client) || !ClientToScreen(window, ref origin)) throw new InvalidOperationException("game_bounds_unavailable");
        var bounds = new Rectangle(origin.X, origin.Y, client.Right-client.Left, client.Bottom-client.Top);
        if (bounds.Width < 320 || bounds.Height < 200 || bounds.Width > 2600 || bounds.Height > 2600 || !Array.Exists(Screen.AllScreens, screen => screen.Bounds.Contains(bounds)))
            throw new InvalidOperationException("unsupported_game_bounds");
        var frame = new GameFrame { CapturedAt=DateTime.UtcNow.ToString("o"), Pid=(int)pid, Window=window.ToInt64(), FrameId=Guid.NewGuid().ToString("D") };
        var timer = Stopwatch.StartNew();
        using (var bitmap = new Bitmap(bounds.Width,bounds.Height,PixelFormat.Format32bppArgb))
        using (var graphics = Graphics.FromImage(bitmap))
        {
            graphics.CopyFromScreen(bounds.Location,System.Drawing.Point.Empty,bounds.Size,CopyPixelOperation.SourceCopy);
            uint afterPid; GetWindowThreadProcessId(GetForegroundWindow(),out afterPid);
            Rect afterClient; var afterOrigin = new Point();
            if (GetForegroundWindow()!=window || afterPid!=pid || !GetClientRect(window,out afterClient) || !ClientToScreen(window,ref afterOrigin) ||
                afterOrigin.X!=origin.X || afterOrigin.Y!=origin.Y || afterClient.Right!=client.Right || afterClient.Bottom!=client.Bottom || timer.ElapsedMilliseconds>2000)
                throw new InvalidOperationException("game_changed_during_capture");
            frame.CaptureFinishedAt=DateTime.UtcNow.ToString("o");
            frame.Path=System.IO.Path.Combine(outputDirectory,"game-frame-"+frame.FrameId+".png");
            bitmap.Save(frame.Path,ImageFormat.Png);
        }
        return frame;
    }
}
