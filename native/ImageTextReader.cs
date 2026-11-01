using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
using System.Diagnostics;
using System.Collections.Generic;
using Windows.Foundation;
using Windows.Storage;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage.Streams;

// Pixel geometry follows WinRT OCR's documented clockwise TextAngle transform.
// Kept separate from recognition so direction, scale and padding are testable.
internal static class OcrGeometry
{
    internal static double[][] MapRectangle(double left,double top,double width,double height,double angle,uint x,uint y,uint scale,uint padding,uint inputWidth,uint inputHeight)
    {
        if(scale==0||inputWidth==0||inputHeight==0||width<=0||height<=0||Double.IsNaN(angle)||Double.IsInfinity(angle))throw new ArgumentException("Transformacion OCR no valida.");
        double radians=angle*Math.PI/180,cos=Math.Cos(radians),sin=Math.Sin(radians),cx=inputWidth/2.0,cy=inputHeight/2.0;
        double[][] corners={new[]{left,top},new[]{left+width,top},new[]{left+width,top+height},new[]{left,top+height}};
        return corners.Select(point=>new[]{x+(cx+(point[0]-cx)*cos-(point[1]-cy)*sin-padding)/scale,y+(cy+(point[0]-cx)*sin+(point[1]-cy)*cos-padding)/scale}).ToArray();
    }
}

// Offline image analysis. No capture, input, language installation, or fresh-frame claim.
internal static class ImageTextReader
{
    internal sealed class ReadWord
    {
        public string text;
        public double x,y,width,height;
        public double[][] polygon;
    }
    internal sealed class ReadLine
    {
        public string text,pass;
        public ReadWord[] words;
    }
    private sealed class ReadPass
    {
        public string name,text,language,preprocessing,interpolation;
        public uint x,y,width,height,scale,padding;
        public double? textAngle;
        public int lineCount;
    }
    public static int Main(string[] args)
    {
        try
        {
            if (args.Length != 2 || !String.Equals(Path.GetExtension(args[1]), ".json", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Uso: WardogsImageText.exe imagen|--foreground-game salida.json");
            GameFrame frame = null;
            if (args[0] == "--foreground-game")
            {
                try { frame = GameFrameCapture.Capture(Path.GetDirectoryName(Path.GetFullPath(args[1]))); }
                catch (Exception error)
                {
                    File.WriteAllText(Path.GetFullPath(args[1]),new JavaScriptSerializer().Serialize(new { format="wardogs-game-screen-unavailable-v1",at=DateTime.UtcNow.ToString("o"),reason=error.Message }),new UTF8Encoding(false));
                    return 0;
                }
            }
            ReadImage(frame==null?args[0]:frame.Path, args[1], frame).GetAwaiter().GetResult();
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
    private static async Task ReadImage(string imagePath, string outputPath, GameFrame frame)
    {
        var fileInfo = new FileInfo(Path.GetFullPath(imagePath));
        if (!fileInfo.Exists || fileInfo.Length > 20 * 1024 * 1024) throw new ArgumentException("Se requiere una imagen de hasta 20 MB.");
        if (String.Equals(fileInfo.FullName, Path.GetFullPath(outputPath), StringComparison.OrdinalIgnoreCase) || !String.Equals(Path.GetExtension(outputPath), ".json", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("La salida debe ser un archivo JSON distinto de la imagen.");
        var engine = OcrEngine.TryCreateFromUserProfileLanguages();
        if (engine == null) throw new InvalidOperationException("No hay un reconocedor OCR disponible para los idiomas actuales.");
        var english=OcrEngine.AvailableRecognizerLanguages.FirstOrDefault(language=>String.Equals(language.LanguageTag,"en-US",StringComparison.OrdinalIgnoreCase));
        var handsEngine=english==null?engine:(OcrEngine.TryCreateFromLanguage(english)??engine);
        var imageFile = await AwaitOperation(StorageFile.GetFileFromPathAsync(fileInfo.FullName));
        using (var stream = await AwaitOperation(imageFile.OpenAsync(FileAccessMode.Read)))
        {
            var decoder = await AwaitOperation(BitmapDecoder.CreateAsync(stream));
            if (decoder.PixelWidth > OcrEngine.MaxImageDimension || decoder.PixelHeight > OcrEngine.MaxImageDimension)
                throw new ArgumentException("La imagen supera el limite OCR; no se escala implicitamente.");
            using (var bitmap = await AwaitOperation(decoder.GetSoftwareBitmapAsync()))
            {
                var result = await AwaitOperation(engine.RecognizeAsync(bitmap));
                var lines = ConvertLines(result,"full_frame",0,0,1,0,decoder.PixelWidth,decoder.PixelHeight).ToList();
                var passes = new List<ReadPass> {new ReadPass {name="full_frame",x=0,y=0,width=decoder.PixelWidth,height=decoder.PixelHeight,scale=1,text=result.Text,language=engine.RecognizerLanguage.LanguageTag,textAngle=result.TextAngle,lineCount=result.Lines.Count}};
                // Small HUD labels are easily missed when OCR deskews an entire 3D
                // scene. Read bounded regions separately, without rotating the raw
                // frame, and map every recognised box back to original pixels.
                // Keep modal and warmup text independently visible even when the
                // full-frame recognizer returns no lines for the 3D scene.
                await AddRegion(engine,decoder,lines,passes,"central_context",.30,.15,.40,.70,2);
                bool mainMenu=lines.Any(line=>new[]{"JUGAR","PLAY"}.Any(label=>String.Equals(line.text.Trim(),label,StringComparison.OrdinalIgnoreCase))&&line.words.Any(word=>word.y<decoder.PixelHeight*.12))&&
                    lines.Any(line=>new[]{"NAVEGADOR DEL SERVIDOR","SERVER BROWSER"}.Any(label=>String.Equals(line.text.Trim(),label,StringComparison.OrdinalIgnoreCase))&&line.words.Any(word=>word.x<decoder.PixelWidth*.4&&word.y>decoder.PixelHeight*.60&&word.y<decoder.PixelHeight*.9));
                EntryControlState mainDeploy=EntryControlVisual.NotMainMenu((int)decoder.PixelWidth,(int)decoder.PixelHeight);
                if(mainMenu)
                {
                    using(var original=new System.Drawing.Bitmap(fileInfo.FullName))mainDeploy=EntryControlVisual.MainDeploy(original);
                    await AddRegion(engine,decoder,lines,passes,"main_deploy_control",.025,.68,.19,.12,4,24);
                    if(!lines.Any(line=>line.pass=="main_deploy_control"&&new[]{"DESPLEGAR","DEPLOY"}.Any(label=>String.Equals(line.text.Trim(),label,StringComparison.OrdinalIgnoreCase))))
                        await AddRegion(engine,decoder,lines,passes,"main_deploy_title",.055,.714,.12,.033,5,24,true);
                }
                // The broad modal pass can omit the small '#02' prefix while
                // retaining the community name. Read the complete name row at
                // higher scale; no number is inferred from the selected server.
                if(lines.Any(line=>line.text.IndexOf("UNIRSE AL SERVIDOR DEL JUEGO",StringComparison.OrdinalIgnoreCase)>=0||line.text.IndexOf("JOIN GAME SERVER",StringComparison.OrdinalIgnoreCase)>=0))
                    await AddRegion(engine,decoder,lines,passes,"join_server_name",.305,.45,.185,.025,4,24);
                // Category titles can be gray. The full-frame/central pass
                // may read only the description below the Community card.
                bool categories=lines.Any(line=>new[]{"DESPLEGAR","DEPLOY"}.Any(label=>String.Equals(line.text.Trim(),label,StringComparison.OrdinalIgnoreCase))&&line.words.Any(word=>word.y<decoder.PixelHeight*.12))&&
                    lines.Any(line=>new[]{"OFICIAL","OFFICIAL"}.Any(label=>String.Equals(line.text.Trim(),label,StringComparison.OrdinalIgnoreCase))&&line.words.Any(word=>word.y>decoder.PixelHeight*.55&&word.y<decoder.PixelHeight*.92));
                if(categories)
                {
                    await AddRegion(engine,decoder,lines,passes,"category_community",.405,.725,.14,.032,4,24);
                    if(!lines.Any(line=>line.pass=="category_community"&&String.Equals(line.text.Trim(),"COMUNIDAD",StringComparison.OrdinalIgnoreCase)))
                        await AddRegion(engine,decoder,lines,passes,"category_community_gray",.405,.725,.14,.032,4,24,false,false,true);
                }
                await AddRegion(engine,decoder,lines,passes,"warmup_context",.30,.15,.40,.15,2);
                await AddRegion(engine,decoder,lines,passes,"hud_compass",.485,.020,.030,.027,3);
                await AddRegion(handsEngine,decoder,lines,passes,"hud_hands",.90,.80,.095,.095,3);
                if(!HasHandsReading(lines))await AddRegion(handsEngine,decoder,lines,passes,"hud_hands_detail",.9625,.834,.0215,.029,5,32);
                if(!HasHandsReading(lines))await AddRegion(handsEngine,decoder,lines,passes,"hud_hands_ink",2468d/2560,1211d/1440,50d/2560,20d/1440,6,32,inverseLuminanceThreshold:150);
                if(!HasHandsReading(lines))await AddRegion(handsEngine,decoder,lines,passes,"hud_hands_tight",2468d/2560,1210d/1440,50d/2560,20d/1440,8,32);
                if(!HasHandsReading(lines))await AddRegion(handsEngine,decoder,lines,passes,"hud_hands_pixels",.94,.825,.055,.045,4,0,false,true);
                if(!HasHandsReading(lines))await AddRegion(handsEngine,decoder,lines,passes,"hud_hands_contrast",.9625,.834,.0215,.029,4,32,true);
                await AddRegion(engine,decoder,lines,passes,"hud_health",.9525,.938,.0195,.032,3,32);
                if(!lines.Any(line=>line.pass.StartsWith("hud_health",StringComparison.Ordinal)&&System.Text.RegularExpressions.Regex.IsMatch(line.text.Trim(),"^\\d{1,3}$")))
                    await AddRegion(engine,decoder,lines,passes,"hud_health_pixels",.9525,.938,.0195,.032,4,32,false,true);
                if(!HasHealthReading(lines,decoder.PixelWidth,decoder.PixelHeight))await AddRegion(engine,decoder,lines,passes,"hud_health_tight",2440d/2560,1357d/1440,35d/2560,25d/1440,6,32);
                if(!HasHealthReading(lines,decoder.PixelWidth,decoder.PixelHeight))await AddRegion(engine,decoder,lines,passes,"hud_health_ink",2420d/2560,1356d/1440,60d/2560,32d/1440,4,32,inverseLuminanceThreshold:170);
                if(!HasHealthReading(lines,decoder.PixelWidth,decoder.PixelHeight))await AddRegion(engine,decoder,lines,passes,"hud_health_ink_detail",2420d/2560,1356d/1440,60d/2560,32d/1440,10,32,inverseLuminanceThreshold:150);
                // Read the characters inside the outlined compass box. Including
                // its border can turn a valid label into a rotated OCR fragment.
                if(!HasCompassReading(lines,decoder.PixelWidth,decoder.PixelHeight)&&HasHandsReading(lines)&&HasHealthReading(lines,decoder.PixelWidth,decoder.PixelHeight))
                    await AddRegion(engine,decoder,lines,passes,"hud_compass_text",1245d/2560,37d/1440,72d/2560,21d/1440,8,32);
                if(!HasCompassReading(lines,decoder.PixelWidth,decoder.PixelHeight)&&HasHandsReading(lines)&&HasHealthReading(lines,decoder.PixelWidth,decoder.PixelHeight))
                    await AddRegion(engine,decoder,lines,passes,"hud_compass_text_detail",1244d/2560,36d/1440,75d/2560,23d/1440,6,32);
                // Sunlight can wash out the outlined compass. Keep three HUD
                // anchors: read the complete lower-left CONTROL label only when
                // hands and health are already visible and compass OCR failed.
                if(!HasCompassReading(lines,decoder.PixelWidth,decoder.PixelHeight)&&HasHandsReading(lines)&&HasHealthReading(lines,decoder.PixelWidth,decoder.PixelHeight))
                    await AddRegion(engine,decoder,lines,passes,"hud_control",.015,.944,.14,.035,5,32,false,true);
                string digest;
                using (var hasher = SHA256.Create())
                using (var file = File.OpenRead(fileInfo.FullName)) digest = BitConverter.ToString(hasher.ComputeHash(file)).Replace("-", "").ToLowerInvariant();
                var report = new {
                    format = "wardogs-image-text-v1", analyzedAt = DateTime.UtcNow.ToString("o"),
                    source = new { path = fileInfo.FullName, bytes = fileInfo.Length, sha256 = digest, fileLastWriteAt = fileInfo.LastWriteTimeUtc.ToString("o"), capturedAt = frame==null?null:frame.CapturedAt, captureFinishedAt=frame==null?null:frame.CaptureFinishedAt, kind=frame==null?"file":"foreground_game",frameId=frame==null?null:frame.FrameId,gamePid=frame==null?(int?)null:frame.Pid,window=frame==null?(long?)null:frame.Window,captureMethod=frame==null?"file_decode":"foreground_client_screen_copy",occlusionVerified=false },
                    language = engine.RecognizerLanguage.LanguageTag, width = decoder.PixelWidth, height = decoder.PixelHeight,
                    textAngle = result.TextAngle, text = String.Join(" ",lines.Select(line=>line.text)),
                    lines = lines.ToArray(), ocrPasses=passes.ToArray(), wordCoordinateSpace="original_image_pixels",
                    controls = new {mainDeploy=mainDeploy},
                    captureFreshnessVerified = false
                };
                File.WriteAllText(Path.GetFullPath(outputPath), new JavaScriptSerializer().Serialize(report), new UTF8Encoding(false));
            }
        }
    }
    private static IEnumerable<ReadLine> ConvertLines(OcrResult result,string pass,uint x,uint y,uint scale,uint padding,uint inputWidth,uint inputHeight)
    {
        return result.Lines.Select(line=>new ReadLine {
            text=line.Text,pass=pass,words=line.Words.Select(word=>MapWord(word,result.TextAngle??0,x,y,scale,padding,inputWidth,inputHeight)).ToArray()
        });
    }
    private static ReadWord MapWord(OcrWord word,double angle,uint x,uint y,uint scale,uint padding,uint inputWidth,uint inputHeight)
    {
        // WinRT BoundingRect is in the deskewed image, not the original image,
        // whenever TextAngle is nonzero. Rotate its four corners clockwise around
        // the input centre before undoing ROI padding and scale (Microsoft OCR sample).
        var bounds=word.BoundingRect;
        var polygon=OcrGeometry.MapRectangle(bounds.X,bounds.Y,bounds.Width,bounds.Height,angle,x,y,scale,padding,inputWidth,inputHeight);
        double left=polygon.Min(point=>point[0]),top=polygon.Min(point=>point[1]);
        return new ReadWord {text=word.Text,x=left,y=top,width=polygon.Max(point=>point[0])-left,height=polygon.Max(point=>point[1])-top,polygon=polygon};
    }
    private static bool HasHandsReading(List<ReadLine> lines)
    {return lines.Any(line=>line.pass.StartsWith("hud_hands",StringComparison.Ordinal)&&new[]{"FISTS","PUÑOS","PUNOS"}.Any(label=>String.Equals(line.text.Trim(),label,StringComparison.OrdinalIgnoreCase)));}
    internal static bool IsCompassReading(string text)
    {
        if(String.IsNullOrWhiteSpace(text))return false;
        var heading=System.Text.RegularExpressions.Regex.Match(text.Trim(),"^\\|?\\s*([0-9]{1,3})\\s*(?:N|NE|E|SE|S|SW|W|NW)$",System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        return heading.Success&&Int32.Parse(heading.Groups[1].Value)<=359;
    }
    private static bool HasCompassReading(List<ReadLine> lines,uint width,uint height)
    {return lines.Any(line=>IsCompassReading(line.text)&&line.words.Length>0&&line.words.Min(word=>word.x)>width*.25&&line.words.Min(word=>word.x)<width*.75&&line.words.Min(word=>word.y)<height*.08);}
    private static bool HasHealthReading(List<ReadLine> lines,uint width,uint height)
    {return lines.Any(line=>line.words.Any(word=>System.Text.RegularExpressions.Regex.IsMatch(word.text,"^[0-9]{1,3}$")&&Int32.Parse(word.text)>0&&Int32.Parse(word.text)<=100&&word.x>width*.90&&word.y>height*.90));}
    private static async Task AddRegion(OcrEngine engine,BitmapDecoder decoder,List<ReadLine> lines,List<ReadPass> passes,string name,double left,double top,double width,double height,uint scale,uint padding=0,bool contrast=false,bool nearest=false,bool grayText=false,int inverseLuminanceThreshold=0)
    {
        uint x=(uint)Math.Floor(decoder.PixelWidth*left),y=(uint)Math.Floor(decoder.PixelHeight*top);
        uint w=Math.Min((uint)Math.Ceiling(decoder.PixelWidth*width),decoder.PixelWidth-x),h=Math.Min((uint)Math.Ceiling(decoder.PixelHeight*height),decoder.PixelHeight-y);
        if(w<8||h<8||w*scale>OcrEngine.MaxImageDimension||h*scale>OcrEngine.MaxImageDimension)return;
        // BitmapTransform crops after scaling: Bounds therefore uses scaled pixel
        // coordinates. No screenshot is rewritten or emitted as a new capture.
        var transform=new BitmapTransform {
            ScaledWidth=decoder.PixelWidth*scale,ScaledHeight=decoder.PixelHeight*scale,
            Bounds=new BitmapBounds {X=x*scale,Y=y*scale,Width=w*scale,Height=h*scale},
            InterpolationMode=nearest?BitmapInterpolationMode.NearestNeighbor:BitmapInterpolationMode.Cubic
        };
        using(var crop=await AwaitOperation(decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8,BitmapAlphaMode.Premultiplied,transform,ExifOrientationMode.IgnoreExifOrientation,ColorManagementMode.DoNotColorManage)))
        {
            if(crop.PixelWidth!=w*scale||crop.PixelHeight!=h*scale)throw new InvalidOperationException("La region OCR no conserva la transformacion esperada.");
            OcrResult result;
            if(padding>0||contrast||grayText||inverseLuminanceThreshold>0){using(var padded=PadBitmap(crop,padding,contrast,grayText,inverseLuminanceThreshold))result=await AwaitOperation(engine.RecognizeAsync(padded));}
            else result=await AwaitOperation(engine.RecognizeAsync(crop));
            passes.Add(new ReadPass {name=name,x=x,y=y,width=w,height=h,scale=scale,padding=padding,text=result.Text,language=engine.RecognizerLanguage.LanguageTag,preprocessing=inverseLuminanceThreshold>0?"luma_threshold_"+inverseLuminanceThreshold+"_inverted":grayText?"gray_text_threshold_min80_max170_chroma35":contrast?"white_text_threshold_min150_max175_chroma60":null,interpolation=nearest?"nearest_neighbor":"cubic",textAngle=result.TextAngle,lineCount=result.Lines.Count});
            var local=ConvertLines(result,name,x,y,scale,padding,(uint)crop.PixelWidth+padding*2,(uint)crop.PixelHeight+padding*2).ToArray();
            MergeRegion(lines,local,x,y,w,h,decoder.PixelWidth,decoder.PixelHeight);
        }
    }
    private sealed class HudAnchor
    {
        public string kind;
        public double x,y,width,height;
    }
    private static HudAnchor FindHudAnchor(ReadLine line,uint width,uint height)
    {
        if(line==null||String.IsNullOrWhiteSpace(line.text)||line.words==null||line.words.Length==0||line.words.Length>300)return null;
        if(line.words.Any(word=>word==null||Double.IsNaN(word.x)||Double.IsNaN(word.y)||Double.IsNaN(word.width)||Double.IsNaN(word.height)||Double.IsInfinity(word.x)||Double.IsInfinity(word.y)||Double.IsInfinity(word.width)||Double.IsInfinity(word.height)||word.x<0||word.y<0||word.width<=0||word.height<=0||word.x+word.width>width+1||word.y+word.height>height+1))return null;
        double x=line.words.Min(word=>word.x),y=line.words.Min(word=>word.y),right=line.words.Max(word=>word.x+word.width),bottom=line.words.Max(word=>word.y+word.height);
        string text=line.text.Trim(),kind=null;
        if(new[]{"FISTS","PUÑOS","PUNOS"}.Any(label=>String.Equals(text,label,StringComparison.OrdinalIgnoreCase))&&x>width*.85&&y>height*.78)kind="hands";
        else if(IsCompassReading(text)&&x>width*.25&&x<width*.75&&y<height*.08)kind="compass";
        else if(System.Text.RegularExpressions.Regex.IsMatch(text,"^CONTROL:\\s*(?:LONESTAR|VALKYRA|MANTICORE)$",System.Text.RegularExpressions.RegexOptions.IgnoreCase)&&x>width*.01&&right<width*.25&&y>height*.92&&bottom<height*.99)kind="control";
        else
        {
            var health=line.words.Where(word=>System.Text.RegularExpressions.Regex.IsMatch(word.text??"","^[0-9]{1,3}$")&&Int32.Parse(word.text)>0&&Int32.Parse(word.text)<=100&&word.x>width*.90&&word.y>height*.90).ToArray();
            if(health.Length!=1)return null;
            kind="health";x=health[0].x;y=health[0].y;right=x+health[0].width;bottom=y+health[0].height;
        }
        return new HudAnchor{kind=kind,x=x,y=y,width=right-x,height=bottom-y};
    }
    private static bool SameHudAnchor(HudAnchor first,HudAnchor second)
    {
        if(first==null||second==null||first.kind!=second.kind)return false;
        double overlap=Math.Max(0,Math.Min(first.x+first.width,second.x+second.width)-Math.Max(first.x,second.x))*Math.Max(0,Math.Min(first.y+first.height,second.y+second.height)-Math.Max(first.y,second.y));
        return overlap>=Math.Min(first.width*first.height,second.width*second.height)*.25||
            Math.Abs(first.x+first.width/2-second.x-second.width/2)<Math.Max(8,Math.Min(first.width,second.width)*.35)&&Math.Abs(first.y+first.height/2-second.y-second.height/2)<Math.Max(8,Math.Min(first.height,second.height)*.7);
    }
    internal static void MergeRegion(List<ReadLine> lines,ReadLine[] local,uint x,uint y,uint width,uint height,uint imageWidth,uint imageHeight)
    {
        // A failed crop must not erase a literal, correctly placed HUD anchor
        // already read from these same pixels. A valid replacement at the same
        // anchor still supersedes the earlier pass, avoiding duplicate evidence.
        if(local.Length>0)lines.RemoveAll(line=>
        {
            var anchor=FindHudAnchor(line,imageWidth,imageHeight);
            if(anchor!=null)return local.Any(other=>SameHudAnchor(anchor,FindHudAnchor(other,imageWidth,imageHeight)));
            return line.words.Length>0&&((line.pass=="full_frame"&&line.words.All(word=>word.x>=x&&word.y>=y&&word.x+word.width<=x+width&&word.y+word.height<=y+height))||local.Any(other=>SameReading(line,other)));
        });
        lines.AddRange(local);
    }
    private static bool SameReading(ReadLine first,ReadLine second)
    {
        string a=new String(first.text.Where(Char.IsLetterOrDigit).Select(Char.ToUpperInvariant).ToArray()),b=new String(second.text.Where(Char.IsLetterOrDigit).Select(Char.ToUpperInvariant).ToArray());
        if(a.Length==0||a!=b||first.words.Length==0||second.words.Length==0)return false;
        double ax=first.words.Min(word=>word.x),ay=first.words.Min(word=>word.y),ar=first.words.Max(word=>word.x+word.width),ab=first.words.Max(word=>word.y+word.height);
        double bx=second.words.Min(word=>word.x),by=second.words.Min(word=>word.y),br=second.words.Max(word=>word.x+word.width),bb=second.words.Max(word=>word.y+word.height);
        return Math.Abs((ax+ar-bx-br)/2)<Math.Max(8,Math.Min(ar-ax,br-bx)*.35)&&Math.Abs((ay+ab-by-bb)/2)<Math.Max(8,Math.Min(ab-ay,bb-by)*.7);
    }
    private static SoftwareBitmap PadBitmap(SoftwareBitmap source,uint padding,bool contrast,bool grayText=false,int inverseLuminanceThreshold=0)
    {
        int width=source.PixelWidth,height=source.PixelHeight,margin=(int)padding;
        int targetWidth=width+margin*2,targetHeight=height+margin*2;
        var buffer=new Windows.Storage.Streams.Buffer((uint)(width*height*4));source.CopyToBuffer(buffer);
        byte[] pixels=new byte[buffer.Length];using(var reader=DataReader.FromBuffer(buffer))reader.ReadBytes(pixels);
        if(contrast||grayText||inverseLuminanceThreshold>0)for(int i=0;i<pixels.Length;i+=4)
        {
            int min=Math.Min(pixels[i],Math.Min(pixels[i+1],pixels[i+2])),max=Math.Max(pixels[i],Math.Max(pixels[i+1],pixels[i+2]));
            int luma=(pixels[i]+pixels[i+1]*6+pixels[i+2]*3)/10;
            byte value=inverseLuminanceThreshold>0?(byte)(luma>=inverseLuminanceThreshold?0:255):(byte)((grayText?min>=80&&max<=170&&max-min<=35:min>=150&&max>=175&&max-min<=60)?255:0);
            pixels[i]=value;pixels[i+1]=value;pixels[i+2]=value;pixels[i+3]=255;
        }
        byte[] padded=new byte[targetWidth*targetHeight*4];
        for(int i=0;i<padded.Length;i+=4){if(inverseLuminanceThreshold>0)padded[i]=padded[i+1]=padded[i+2]=255;padded[i+3]=255;}
        for(int row=0;row<height;row++)System.Buffer.BlockCopy(pixels,row*width*4,padded,((row+margin)*targetWidth+margin)*4,width*4);
        using(var writer=new DataWriter())
        {
            writer.WriteBytes(padded);
            return SoftwareBitmap.CreateCopyFromBuffer(writer.DetachBuffer(),BitmapPixelFormat.Bgra8,targetWidth,targetHeight,BitmapAlphaMode.Premultiplied);
        }
    }
    private static async Task<T> AwaitOperation<T>(IAsyncOperation<T> operation)
    {
        var timer = Stopwatch.StartNew();
        try
        {
            while (operation.Status == AsyncStatus.Started)
            {
                if (timer.ElapsedMilliseconds > 15000) { operation.Cancel(); throw new TimeoutException("La lectura de imagen supero 15 segundos."); }
                await Task.Delay(25);
            }
            if (operation.Status != AsyncStatus.Completed) throw new InvalidOperationException("No se pudo leer la imagen: " + operation.ErrorCode);
            return operation.GetResults();
        }
        finally { if (operation.Status != AsyncStatus.Started) operation.Close(); }
    }
}
