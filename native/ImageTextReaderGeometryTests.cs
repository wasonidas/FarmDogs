using System;
using System.Collections.Generic;
using System.Linq;

internal static class ImageTextReaderGeometryTests
{
    private static int count;
    private static void Near(double value,double expected){if(Math.Abs(value-expected)>.000001)throw new Exception("Coordenada OCR incorrecta: "+value+" frente a "+expected);count++;}
    private static void Point(double[] point,double x,double y){Near(point[0],x);Near(point[1],y);}
    private static void Reject(Action operation){bool rejected=false;try{operation();}catch(ArgumentException){rejected=true;}if(!rejected)throw new Exception("Se acepto una transformacion no valida.");count++;}
    private static void Check(bool condition,string reason){if(!condition)throw new Exception(reason);count++;}
    private static ImageTextReader.ReadLine Line(string text,string pass,double x,double y,double width,double height)
    {return new ImageTextReader.ReadLine{text=text,pass=pass,words=new[]{new ImageTextReader.ReadWord{text=text,x=x,y=y,width=width,height=height}}};}
    private static void MergeChecks()
    {
        var fists=Line("FISTS","full_frame",2470,1214,44,18);var badHands=Line("STS","hud_hands_detail",2484,1210,29,19);
        var lines=new List<ImageTextReader.ReadLine>{fists};
        ImageTextReader.MergeRegion(lines,new[]{badHands},2464,1200,56,42,2560,1440);
        Check(lines.Contains(fists),"Un recorte STS elimino FISTS literal del mismo frame.");
        var punctuation=Line("FISTS!","hud_hands_detail",2471,1214,44,18);
        ImageTextReader.MergeRegion(lines,new[]{punctuation},2464,1200,56,42,2560,1440);
        Check(lines.Contains(fists),"Una lectura no literal con el mismo texto normalizado elimino FISTS.");
        var validHands=Line("FISTS","hud_hands_ink",2471,1214,43,18);
        ImageTextReader.MergeRegion(lines,new[]{validHands},2464,1200,56,42,2560,1440);
        Check(!lines.Contains(fists)&&lines.Count(line=>line.text=="FISTS")==1,"La sustitucion valida de manos produjo evidencia duplicada.");
        var compass=Line("042NE","full_frame",1245,38,70,20);var badCompass=Line(";ozt2","hud_compass",1240,28,44,33);
        lines=new List<ImageTextReader.ReadLine>{compass};
        ImageTextReader.MergeRegion(lines,new[]{badCompass},1241,28,77,39,2560,1440);
        Check(lines.Contains(compass),"Un recorte de brujula no valido elimino 042NE literal.");
        var validCompass=Line("042 NE","hud_compass_text",1246,38,69,20);
        ImageTextReader.MergeRegion(lines,new[]{validCompass},1241,28,77,39,2560,1440);
        Check(!lines.Contains(compass)&&lines.Count(line=>ImageTextReader.IsCompassReading(line.text))==1,"La brujula regional valida se conto dos veces.");
        var health=Line("100","full_frame",2440,1362,30,18);var badHealth=Line("roo","hud_health_tight",2439,1357,31,20);
        lines=new List<ImageTextReader.ReadLine>{health};
        ImageTextReader.MergeRegion(lines,new[]{badHealth},2440,1357,35,25,2560,1440);
        Check(lines.Contains(health),"Un recorte de salud no numerico elimino 100 literal.");
        var symbolHealth=new ImageTextReader.ReadLine{text="* 100",pass="hud_health_ink",words=new[]{new ImageTextReader.ReadWord{text="*",x=2418,y=1361,width=13,height=18},new ImageTextReader.ReadWord{text="100",x=2441,y=1362,width=29,height=18}}};
        ImageTextReader.MergeRegion(lines,new[]{symbolHealth},2420,1356,60,32,2560,1440);
        Check(!lines.Contains(health)&&lines.Contains(symbolHealth),"La deduplicacion de salud no uso las coordenadas de la palabra numerica.");
        var background=Line("texture","full_frame",1245,38,60,20);
        lines=new List<ImageTextReader.ReadLine>{background};
        ImageTextReader.MergeRegion(lines,new[]{badCompass},1241,28,77,39,2560,1440);
        Check(!lines.Contains(background)&&lines.Contains(badCompass),"La fusion dejo de sustituir texto sin ancla HUD.");
        var distantCompass=Line("075 E","full_frame",1100,38,60,20);
        lines=new List<ImageTextReader.ReadLine>{distantCompass};
        ImageTextReader.MergeRegion(lines,new[]{validCompass},1000,28,400,39,2560,1440);
        Check(lines.Contains(distantCompass)&&lines.Contains(validCompass),"La fusion oculto dos anclas espaciales distintas; deben seguir siendo ambiguas.");
    }
    public static int Main()
    {
        try
        {
            var raw=OcrGeometry.MapRectangle(30,40,20,10,0,0,0,1,0,100,100);
            Point(raw[0],30,40);Point(raw[1],50,40);Point(raw[2],50,50);Point(raw[3],30,50);
            var region=OcrGeometry.MapRectangle(62,92,60,30,0,200,300,3,32,364,364);
            Point(region[0],210,320);Point(region[1],230,320);Point(region[2],230,330);Point(region[3],210,330);
            // In screen coordinates a positive quarter turn maps the point to the
            // right of centre downwards, not upwards. This catches the original
            // mistake of treating a deskewed box as a raw screenshot rectangle.
            var rotated=OcrGeometry.MapRectangle(100,50,10,20,90,0,0,1,0,200,100);
            Point(rotated[0],100,50);Point(rotated[1],100,60);Point(rotated[2],80,60);Point(rotated[3],80,50);
            var combined=OcrGeometry.MapRectangle(100,100,20,10,90,1000,500,2,10,200,200);
            Point(combined[0],1045,545);Point(combined[1],1045,555);Point(combined[2],1040,555);Point(combined[3],1040,545);
            Reject(()=>OcrGeometry.MapRectangle(0,0,10,10,0,0,0,0,0,100,100));
            Reject(()=>OcrGeometry.MapRectangle(0,0,10,10,Double.NaN,0,0,1,0,100,100));
            Reject(()=>OcrGeometry.MapRectangle(0,0,10,10,0,0,0,1,0,0,100));
            foreach(var direction in new[]{"N","NE","E","SE","S","SW","W","NW"})foreach(int heading in new[]{0,1,9,64,99,100,270,359})foreach(var separator in new[]{""," "})
            {
                string label=heading.ToString("000")+separator+direction;
                if(!ImageTextReader.IsCompassReading(label)||!ImageTextReader.IsCompassReading("| "+label))throw new Exception("Brújula literal rechazada: "+label);
                count+=2;
            }
            foreach(var label in new[]{null,"","064","NE","-1NE","360NE","999NE","0064NE","64.0NE","064NN","064EE","064WW","064SS","064EN","064ES","064WS","064SN","064NNE","064NEWS","064N E","O64NE","064 NE EXTRA","EXTRA 064NE","1 0 064NE","064NE 075E"})
            {
                if(ImageTextReader.IsCompassReading(label))throw new Exception("Brújula no válida aceptada: "+label);
                count++;
            }
            MergeChecks();
            Console.WriteLine(count+" comprobaciones de geometria, brújula y fusion OCR correctas; sin capturas, entradas ni red.");return 0;
        }
        catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
    }
}
