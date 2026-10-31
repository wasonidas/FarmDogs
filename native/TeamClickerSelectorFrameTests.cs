using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using WardogsSeeding;

public static class TeamClickerSelectorFrameTests {
 static int checks;
 static readonly DateTime Time=new DateTime(2026,10,31,10,0,0,DateTimeKind.Utc);
 static void Check(bool value,string message){checks++;if(!value)throw new Exception("Selector frame: "+message);}
 static Bitmap Selector(int width,int height,bool header=true,bool outer=true,bool third=true){
  var image=new Bitmap(width,height,PixelFormat.Format32bppArgb);float scale=height/1440f,left=width*.5f-306*scale,top=height*.5f-162*scale;
  using(var graphics=Graphics.FromImage(image))using(var border=new Pen(Color.FromArgb(145,145,145),Math.Max(1,scale)))using(var card=new Pen(Color.FromArgb(100,100,100),Math.Max(1,scale))){
   graphics.Clear(Color.FromArgb(25,25,25));
   if(outer){graphics.FillRectangle(Brushes.Black,left,top,612*scale,324*scale);graphics.DrawRectangle(border,left,top,612*scale,324*scale);graphics.DrawLine(card,left,top+54*scale,left+612*scale,top+54*scale);}
   for(int column=0;column<(third?3:2);column++)graphics.DrawRectangle(card,left+(16+200*column)*scale,top+72*scale,180*scale,236*scale);
   if(header)using(var font=new Font("Arial",26*scale,FontStyle.Regular,GraphicsUnit.Pixel)){graphics.TextRenderingHint=TextRenderingHint.AntiAliasGridFit;graphics.DrawString("// SELECCIONAR FACCIÓN",font,Brushes.LightGray,left+12*scale,top+8*scale);}
  }
  return image;
 }
 public static int Run(){
  checks=0;
  foreach(var size in new[]{new Size(1280,720),new Size(1920,1080),new Size(2560,1440),new Size(3440,1440)})using(var image=Selector(size.Width,size.Height)){
   TeamClickerTarget blue,red,green;
   Check(TeamClickerSelectorFrame.TryRecognize(image,"blue",Time,out blue),"blue card found without any availability colours at "+size);
   Check(TeamClickerSelectorFrame.TryRecognize(image,"red",Time,out red),"red card found with hidden logo at "+size);
   Check(TeamClickerSelectorFrame.TryRecognize(image,"green",Time,out green),"green card found with hidden logo at "+size);
   Check(blue.Valid()&&red.Valid()&&green.Valid()&&blue.x<red.x&&red.x<green.x,"current card order and valid targets");
   Check(Math.Abs(red.x-size.Width*.5)<=3&&Math.Abs(blue.y-red.y)<=3&&Math.Abs(red.y-green.y)<=3,"frame-derived aligned targets");
  }
  TeamClickerTarget target;
  using(var image=Selector(1920,1080,false))Check(!TeamClickerSelectorFrame.TryRecognize(image,"blue",Time,out target),"three rectangles without header text refused");
  using(var image=Selector(1920,1080,true,false))Check(!TeamClickerSelectorFrame.TryRecognize(image,"blue",Time,out target),"three rectangles without containing panel refused");
  using(var image=Selector(1920,1080,true,true,false))Check(!TeamClickerSelectorFrame.TryRecognize(image,"blue",Time,out target),"missing card refused");
  using(var image=new Bitmap(1920,1080,PixelFormat.Format32bppArgb))Check(!TeamClickerSelectorFrame.TryRecognize(image,"blue",Time,out target),"blank dark frame refused");
  using(var image=Selector(1920,1080)){
   Check(!TeamClickerSelectorFrame.TryRecognize(image,"orange",Time,out target),"invalid requested colour refused");
   Check(!TeamClickerSelectorFrame.TryRecognize(image,"blue",DateTime.SpecifyKind(Time,DateTimeKind.Local),out target),"non UTC capture refused");
  }
  foreach(var size in new[]{new Size(1280,720),new Size(1920,1080),new Size(2560,1440),new Size(3440,1440)})using(var image=Selector(size.Width,size.Height)){
   TeamClickerSelectorSnapshot snapshot;Check(TeamClickerSelectorFrame.TryRecognizeAll(image,Time,out snapshot),"one structural scan acquires all candidates "+size);
   Check(snapshot.Targets.Count==3&&snapshot.Cards.Count==3&&!snapshot.HeaderBounds.IsEmpty,"shared candidate set is complete");
   var proof=new TeamClickerAnySelector(image,snapshot);Check(proof.ReadBounds.Width*proof.ReadBounds.Height<size.Width*size.Height*.15,"per-click shared region is a small part of the frame");
   using(var region=image.Clone(proof.ReadBounds,PixelFormat.Format32bppArgb))Check(proof.Available(region,Time).Count==0,"all-gray cards wait without selecting a closed color");
   PaintAvailable(image,snapshot.Targets["blue"],Brushes.DeepSkyBlue);
   using(var region=image.Clone(proof.ReadBounds,PixelFormat.Format32bppArgb)){var choices=proof.Available(region,Time);Check(choices.Count==1&&choices.ContainsKey("blue"),"only currently blue available");}
   PaintAvailable(image,snapshot.Targets["green"],Brushes.LimeGreen);
   using(var region=image.Clone(proof.ReadBounds,PixelFormat.Format32bppArgb)){var choices=proof.Available(region,Time);Check(choices.Count==2&&choices.ContainsKey("blue")&&choices.ContainsKey("green"),"multiple currently available colors share one read");}
   PaintAvailable(image,snapshot.Targets["blue"],Brushes.Black);
   using(var region=image.Clone(proof.ReadBounds,PixelFormat.Format32bppArgb)){var choices=proof.Available(region,Time);Check(choices.Count==1&&choices.ContainsKey("green"),"closed chosen color is removed while another remains");}
   using(var graphics=Graphics.FromImage(image))graphics.FillRectangle(Brushes.Black,snapshot.HeaderBounds);
   using(var region=image.Clone(proof.ReadBounds,PixelFormat.Format32bppArgb))Check(proof.Available(region,Time).Count==0,"colored patch without current selector header cannot authorize HUD clicks");
  }
  return checks;
 }
 static void PaintAvailable(Bitmap image,TeamClickerTarget target,Brush brush){using(var graphics=Graphics.FromImage(image))graphics.FillRectangle(brush,target.x-26,target.y-14,52,28);}
 public static int RunEvidence(string directory){
  int began=checks;
  string positive=Path.Combine(directory,"game-frame-b677b759-b15b-4bdf-a78e-68cfdcfe46c2.png");
  using(var source=new Bitmap(positive))using(var image=Copy(source)){
   foreach(string team in new[]{"blue","red","green"}){TeamClickerTarget target;Check(TeamClickerSelectorFrame.TryRecognize(image,team,Time,out target),"actual selector "+team);Console.WriteLine("Actual selector "+team+": "+target.x+","+target.y);}
   // Pixel-only fixture derived from the same frame: availability colours are
   // removed in memory. This is a synthetic condition, not a live denial.
   for(int y=0;y<image.Height;y++)for(int x=0;x<image.Width;x++){var c=image.GetPixel(x,y);int gray=(c.R+c.G+c.B)/3;image.SetPixel(x,y,Color.FromArgb(gray,gray,gray));}
   foreach(string team in new[]{"blue","red","green"}){TeamClickerTarget target;Check(TeamClickerSelectorFrame.TryRecognize(image,team,Time,out target),"actual frame grayscale fixture "+team);}
  }
  foreach(string file in new[]{"game-frame-fc4e6349-5d72-4a6f-813b-10f8834d5c1b.png","game-frame-8023e7bb-1020-41e4-9d76-150a2b501ae8.png"})using(var source=new Bitmap(Path.Combine(directory,file)))using(var image=Copy(source))foreach(string team in new[]{"blue","red","green"}){TeamClickerTarget target;Check(!TeamClickerSelectorFrame.TryRecognize(image,team,Time,out target),"actual non-selector "+file+" "+team);}
  return checks-began;
 }
 public static int RunImageEvidence(string file,bool expected){
  int began=checks;
  using(var source=new Bitmap(file))using(var image=Copy(source))foreach(string team in new[]{"blue","red","green"}){
   TeamClickerTarget target;Rectangle bounds;bool found=TeamClickerSelectorFrame.TryRecognize(image,team,Time,out target,out bounds);
   Check(found==expected,"additional actual frame "+Path.GetFileName(file)+" "+team);
   if(found)Check(bounds.Contains(target.x,target.y)&&target.Valid(),"target lies inside its actual card "+team);
  }
  return checks-began;
 }
 static Bitmap Copy(Bitmap source){var image=new Bitmap(source.Width,source.Height,PixelFormat.Format32bppArgb);using(var graphics=Graphics.FromImage(image))graphics.DrawImageUnscaled(source,0,0);return image;}
}
