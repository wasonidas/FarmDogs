using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal sealed class DesktopCompactLayout
{
    internal Size ClientSize;internal Point Location;
}
internal static class DesktopAppearance
{
    internal const string IconResource="FarmDogs.AppIcon";
    internal static readonly Color Background=Color.FromArgb(15,18,19),Text=Color.FromArgb(208,216,219),Muted=Color.FromArgb(159,170,174);
    // workingArea and nonClient must be in the same DPI coordinate space. Using
    // the monitor's work area keeps the taskbar visible on small/secondary screens.
    internal static DesktopCompactLayout CompactLayout(Rectangle workingArea,Size nonClient)
    {
        if(workingArea.Width<1||workingArea.Height<1||nonClient.Width<0||nonClient.Height<0||workingArea.Width<=nonClient.Width||workingArea.Height<=nonClient.Height)throw new ArgumentOutOfRangeException("workingArea");
        int width=Math.Min(900,Math.Max(1,workingArea.Width-32-nonClient.Width));
        int height=Math.Min(680,Math.Max(1,workingArea.Height-32-nonClient.Height));
        return new DesktopCompactLayout {ClientSize=new Size(width,height),Location=new Point(workingArea.Left+(workingArea.Width-width-nonClient.Width)/2,workingArea.Top+(workingArea.Height-height-nonClient.Height)/2)};
    }
    internal static Icon LoadIcon()
    {
        using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream(IconResource))
        {
            if(stream==null)throw new InvalidOperationException("Falta el icono de FarmDogs en la aplicación.");
            using(var icon=new Icon(stream,new Size(32,32)))return (Icon)icon.Clone();
        }
    }
    [DllImport("dwmapi.dll")]private static extern int DwmSetWindowAttribute(IntPtr window,int attribute,ref int value,int size);
    internal static void DarkTitleBar(IntPtr window)
    {
        try{int enabled=1;if(DwmSetWindowAttribute(window,20,ref enabled,4)!=0)DwmSetWindowAttribute(window,19,ref enabled,4);}catch(DllNotFoundException){}catch(EntryPointNotFoundException){}
    }
}
internal sealed class DesktopToolbarRenderer : ToolStripSystemRenderer
{
    protected override void OnRenderToolStripBackground(ToolStripRenderEventArgs e){e.Graphics.Clear(DesktopAppearance.Background);}
    protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e){using(var pen=new Pen(Color.FromArgb(45,53,57)))e.Graphics.DrawLine(pen,0,e.ToolStrip.Height-1,e.ToolStrip.Width,e.ToolStrip.Height-1);}
    protected override void OnRenderButtonBackground(ToolStripItemRenderEventArgs e){if(e.Item.Selected||e.Item.Pressed)using(var brush=new SolidBrush(e.Item.Pressed?Color.FromArgb(54,61,65):Color.FromArgb(34,42,46)))e.Graphics.FillRectangle(brush,new Rectangle(Point.Empty,e.Item.Size));}
    protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e){using(var pen=new Pen(Color.FromArgb(53,62,67)))e.Graphics.DrawLine(pen,e.Item.Width/2,8,e.Item.Width/2,e.Item.Height-8);}
    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e){e.TextColor=e.Item.Enabled?e.Item.ForeColor:Color.FromArgb(100,111,115);e.TextFormat|=TextFormatFlags.EndEllipsis|TextFormatFlags.SingleLine;base.OnRenderItemText(e);}
}
