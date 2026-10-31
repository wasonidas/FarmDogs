using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace WardogsSeeding {
 // Recognizes the complete blue/red/green selector layout in a passive frame.
 // No cursor coordinate, old calibration, or guessed button position is used.
 public static class TeamClickerLogoDetector {
  sealed class Blob {
   public byte Color;public int Left,Top,Right,Bottom,Count;
   public int Width {get{return Right-Left+1;}}public int Height {get{return Bottom-Top+1;}}
   public double X {get{return (Left+Right)*.5;}}public double Y {get{return (Top+Bottom)*.5;}}
  }
  static bool Near(Blob a,Blob b,int gap){
   int dx=Math.Max(0,Math.Max(a.Left-b.Right,b.Left-a.Right)-1),dy=Math.Max(0,Math.Max(a.Top-b.Bottom,b.Top-a.Bottom)-1);
   return a.Color==b.Color&&dx<=gap&&dy<=gap;
  }
  static bool Layout(Blob blue,Blob red,Blob green,int step,int width,int height){
   if(!(blue.X<red.X&&red.X<green.X))return false;
   double smallest=Math.Min(blue.Height,Math.Min(red.Height,green.Height)),largest=Math.Max(blue.Height,Math.Max(red.Height,green.Height));
   if(smallest/largest<.65)return false;
   double yMin=Math.Min(blue.Y,Math.Min(red.Y,green.Y)),yMax=Math.Max(blue.Y,Math.Max(red.Y,green.Y));
   if(yMax-yMin>largest*.25)return false;
   double left=red.X-blue.X,right=green.X-red.X;
   if(left/right<.73||left/right>1.37||left/largest<1.25||right/largest<1.25||left/largest>3.5||right/largest>3.5)return false;
   double span=(green.Right-blue.Left+1)*step,centerX=(blue.X+red.X+green.X)/3*step+width*.2,centerY=(blue.Y+red.Y+green.Y)/3*step+height*.2;
   return span>=width*.12&&span<=width*.65&&Math.Abs(centerX-width*.5)<=width*.16&&Math.Abs(centerY-height*.5)<=height*.14;
  }
  public static TeamClickerTarget Recognize(Bitmap image,string team,DateTime now){Rectangle ignored;return Recognize(image,team,now,out ignored);}
  public static TeamClickerTarget Recognize(Bitmap image,string team,DateTime now,out Rectangle logoBounds){
   logoBounds=Rectangle.Empty;
   if(image==null||!TeamClickerCommand.IsTeam(team)||image.Width<320||image.Height<200||image.Width>8000||image.Height>8000)throw new InvalidOperationException("La imagen del selector no es valida.");
   int w=image.Width,h=image.Height,step=Math.Max(1,Math.Min(w,h)/720);
   var region=new Rectangle((int)(w*.2),(int)(h*.2),(int)(w*.6),(int)(h*.6));
   int gw=(region.Width+step-1)/step,gh=(region.Height+step-1)/step;
   var colors=new byte[gw*gh];var row=new int[region.Width];
   var locked=image.LockBits(region,ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
   try{for(int gy=0;gy<gh;gy++){
    Marshal.Copy(IntPtr.Add(locked.Scan0,gy*step*locked.Stride),row,0,row.Length);
    for(int gx=0;gx<gw;gx++)colors[gy*gw+gx]=TeamClickerPatch.LogoColor(row[Math.Min(region.Width-1,gx*step)]);
   }}finally{image.UnlockBits(locked);}
   var unseen=(byte[])colors.Clone();var queue=new int[colors.Length];var blobs=new List<Blob>();
   for(int index=0;index<unseen.Length;index++){
    byte color=unseen[index];if(color==0)continue;
    int head=0,tail=0;queue[tail++]=index;unseen[index]=0;
    var blob=new Blob{Color=color,Left=gw,Top=gh,Right=0,Bottom=0};
    while(head<tail){int current=queue[head++],x=current%gw,y=current/gw;blob.Count++;blob.Left=Math.Min(blob.Left,x);blob.Right=Math.Max(blob.Right,x);blob.Top=Math.Min(blob.Top,y);blob.Bottom=Math.Max(blob.Bottom,y);
     for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){int xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=gw||yy>=gh)continue;int next=yy*gw+xx;if(unseen[next]!=color)continue;unseen[next]=0;queue[tail++]=next;}
    }
    if(blob.Count>=3)blobs.Add(blob);
   }
   if(blobs.Count>300)throw new InvalidOperationException("Demasiadas marcas de color; no se reconoce un selector unico.");
   int merge=Math.Max(2,(int)Math.Ceiling(h*.012/step));
   bool changed=true;while(changed){changed=false;for(int a=0;a<blobs.Count&&!changed;a++)for(int b=a+1;b<blobs.Count;b++)if(Near(blobs[a],blobs[b],merge)){
    var first=blobs[a];var other=blobs[b];first.Left=Math.Min(first.Left,other.Left);first.Top=Math.Min(first.Top,other.Top);first.Right=Math.Max(first.Right,other.Right);first.Bottom=Math.Max(first.Bottom,other.Bottom);first.Count+=other.Count;blobs.RemoveAt(b);changed=true;break;
   }}
   var candidates=new List<Blob>();foreach(var blob in blobs){double density=blob.Count/(double)(blob.Width*blob.Height),aspect=blob.Width/(double)blob.Height;
    if(blob.Height*step>=h*.035&&blob.Height*step<=h*.16&&aspect>=.6&&aspect<=1.8&&density>=.12&&density<=.92)candidates.Add(blob);
   }
   Blob chosen=null;int matches=0;
   foreach(var blue in candidates)if(blue.Color==1)foreach(var red in candidates)if(red.Color==2)foreach(var green in candidates)if(green.Color==3&&Layout(blue,red,green,step,w,h)){
    matches++;chosen=team=="blue"?blue:team=="red"?red:green;
   }
   if(matches!=1||chosen==null)throw new InvalidOperationException(matches>1?"Hay varios selectores posibles. No se enviaran clics.":"No se reconoce el selector completo azul, rojo y verde. Abre Seleccionar faccion.");
   // Use a real saturated logo pixel nearest its centre, never the dark margin.
   int pickX=-1,pickY=-1;double distance=Double.MaxValue;
   for(int yy=chosen.Top;yy<=chosen.Bottom;yy++)for(int xx=chosen.Left;xx<=chosen.Right;xx++)if(colors[yy*gw+xx]==chosen.Color){double d=(xx-chosen.X)*(xx-chosen.X)+(yy-chosen.Y)*(yy-chosen.Y);if(d<distance){distance=d;pickX=xx;pickY=yy;}}
   if(pickX<0)throw new InvalidOperationException("No hay un punto de color verificable para ese equipo.");
   int targetX=region.Left+pickX*step,targetY=region.Top+pickY*step;
   logoBounds=new Rectangle(region.Left+chosen.Left*step,region.Top+chosen.Top*step,chosen.Width*step,chosen.Height*step);
   var target=new TeamClickerTarget{x=targetX,y=targetY,width=w,height=h,patchWidth=64,patchHeight=32,patchLeft=Math.Max(0,Math.Min(w-64,targetX-32)),patchTop=Math.Max(0,Math.Min(h-32,targetY-16)),capturedAt=now.ToString("o"),signature=new int[45]};
   for(int yy=0;yy<5;yy++)for(int xx=0;xx<9;xx++)target.signature[yy*9+xx]=image.GetPixel(target.patchLeft+2+xx*7,target.patchTop+2+yy*7).ToArgb()&0xffffff;
   if(!target.Valid())throw new InvalidOperationException("El punto reconocido no es valido.");
   return target;
  }
 }
}
