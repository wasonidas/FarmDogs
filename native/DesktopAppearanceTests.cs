using System;
using System.Drawing;
using System.IO;

internal static class DesktopAppearanceTests
{
    private static int checks;
    private static void Check(bool value,string name){checks++;if(!value)throw new Exception(name);}
    public static int Main(string[] args)
    {
        try
        {
            var chrome=new Size(16,39);
            foreach(var area in new[]{new Rectangle(0,0,1920,1040),new Rectangle(-1280,0,1280,720),new Rectangle(1920,-900,900,1600),new Rectangle(0,0,800,560),new Rectangle(0,0,600,400),new Rectangle(0,0,200,150)})
            {
                var layout=DesktopAppearance.CompactLayout(area,chrome);var outer=new Rectangle(layout.Location,new Size(layout.ClientSize.Width+chrome.Width,layout.ClientSize.Height+chrome.Height));
                Check(layout.ClientSize.Width<=900&&layout.ClientSize.Height<=680,"compact upper bound");Check(layout.ClientSize.Width>0&&layout.ClientSize.Height>0,"positive client area");Check(area.Contains(outer),"visible in monitor work area");Check(Math.Abs((outer.Left-area.Left)-(area.Right-outer.Right))<=1,"horizontal centering");Check(Math.Abs((outer.Top-area.Top)-(area.Bottom-outer.Bottom))<=1,"vertical centering");
            }
            var normal=DesktopAppearance.CompactLayout(new Rectangle(0,0,1920,1040),chrome);Check(normal.ClientSize==new Size(900,680),"normal compact dimensions");
            foreach(var area in new[]{Rectangle.Empty,new Rectangle(0,0,16,39)}){bool rejected=false;try{DesktopAppearance.CompactLayout(area,chrome);}catch(ArgumentOutOfRangeException){rejected=true;}Check(rejected,"unusable monitor bounds rejected");}
            using(var icon=DesktopAppearance.LoadIcon()){Check(icon.Width==32&&icon.Height==32,"embedded small native icon");using(var bitmap=icon.ToBitmap()){bool transparent=false,visible=false;for(int y=0;y<bitmap.Height;y++)for(int x=0;x<bitmap.Width;x++){var pixel=bitmap.GetPixel(x,y);transparent|=pixel.A<255;visible|=pixel.A>0;}Check(transparent&&visible,"brand icon retains alpha and visible pixels");}}
            using(var stream=typeof(DesktopAppearanceTests).Assembly.GetManifestResourceStream(DesktopAppearance.IconResource))using(var bytes=new BinaryReader(stream)){Check(bytes.ReadUInt16()==0&&bytes.ReadUInt16()==1,"ICO resource format");Check(bytes.ReadUInt16()==7,"DPI icon frames");}
            Console.WriteLine("Desktop appearance: "+checks+" checks passed; no windows opened.");return 0;
        }
        catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
    }
}
