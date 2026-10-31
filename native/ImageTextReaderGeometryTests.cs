using System;

internal static class ImageTextReaderGeometryTests
{
    private static int count;
    private static void Near(double value,double expected){if(Math.Abs(value-expected)>.000001)throw new Exception("Coordenada OCR incorrecta: "+value+" frente a "+expected);count++;}
    private static void Point(double[] point,double x,double y){Near(point[0],x);Near(point[1],y);}
    private static void Reject(Action operation){bool rejected=false;try{operation();}catch(ArgumentException){rejected=true;}if(!rejected)throw new Exception("Se acepto una transformacion no valida.");count++;}
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
            Console.WriteLine(count+" comprobaciones de geometria OCR correctas; sin capturas, entradas ni red.");return 0;
        }
        catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
    }
}
