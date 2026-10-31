using System;
using System.Drawing;

internal sealed class EntryControlPanel {public int x,y,width,height;}
internal sealed class EntryControlState
{
    public bool enabled;
    public string reason;
    public double amberRatio,minimumQuadrantRatio;
    public int sampleCount;
    public EntryControlPanel panel;
}
// Pixel evidence for the actual filled control, independent from OCR labels.
// Text, borders and a gray/white panel alone never establish readiness.
internal static class EntryControlVisual
{
    internal static Rectangle MainDeployBounds(int width,int height)
    {
        if(width<320||height<200)throw new ArgumentException("Unsupported control geometry.");
        int x=(int)Math.Floor(width*.026),y=(int)Math.Floor(height*.684),w=(int)Math.Ceiling(width*.183),h=(int)Math.Ceiling(height*.112);
        return new Rectangle(x,y,Math.Min(w,width-x),Math.Min(h,height-y));
    }
    private static EntryControlPanel Panel(Rectangle value){return new EntryControlPanel {x=value.X,y=value.Y,width=value.Width,height=value.Height};}
    internal static EntryControlState NotMainMenu(int width,int height)
    {return new EntryControlState {enabled=false,reason="not_main_menu",panel=Panel(width>=320&&height>=200?MainDeployBounds(width,height):Rectangle.Empty)};}
    private static bool Amber(Color value)
    {
        return value.R>=95&&value.G>=65&&value.B<=140&&value.R-value.G>=8&&value.G-value.B>=20&&value.R-value.B>=45&&value.G>=value.R*.45&&value.G<=value.R*.94;
    }
    internal static EntryControlState MainDeploy(Bitmap original)
    {
        Rectangle panel=MainDeployBounds(original.Width,original.Height);
        using(var patch=original.Clone(panel,original.PixelFormat))return MainDeployPanel(patch,panel);
    }
    internal static EntryControlState MainDeployPanel(Bitmap patch,Rectangle panel)
    {
        const int columns=20,rows=10;
        int samples=0,amber=0;var quadrantSamples=new int[4];var quadrantAmber=new int[4];
        for(int row=0;row<rows;row++)for(int column=0;column<columns;column++)
        {
            // The inset ignores the control's thin amber outline. Sampling all
            // four quadrants requires fill beyond the title and cursor.
            int x=Math.Min(patch.Width-1,(int)Math.Floor(patch.Width*(.10+.80*(column+.5)/columns)));
            int y=Math.Min(patch.Height-1,(int)Math.Floor(patch.Height*(.12+.76*(row+.5)/rows)));
            int quadrant=(row>=rows/2?2:0)+(column>=columns/2?1:0);bool matches=Amber(patch.GetPixel(x,y));
            samples++;quadrantSamples[quadrant]++;if(matches){amber++;quadrantAmber[quadrant]++;}
        }
        double ratio=amber/(double)samples,minimum=1;for(int quadrant=0;quadrant<4;quadrant++)minimum=Math.Min(minimum,quadrantAmber[quadrant]/(double)quadrantSamples[quadrant]);
        bool enabled=ratio>=.60&&minimum>=.42;
        return new EntryControlState {enabled=enabled,reason=enabled?"amber_fill_ready":"waiting_for_amber_fill",amberRatio=ratio,minimumQuadrantRatio=minimum,sampleCount=samples,panel=Panel(panel)};
    }
}
