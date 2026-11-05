using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace WardogsSeeding {
 public sealed class TeamClickerSelectorSnapshot {
  public Dictionary<string,TeamClickerTarget> Targets;
  public Dictionary<string,Rectangle> Cards;
  public Rectangle HeaderBounds;
 }
 // Locates the three faction cards from their current outlines. Availability
 // colours are deliberately irrelevant: auto-balance may hide every logo.
 public static class TeamClickerSelectorFrame {
  sealed class Line {public int Left,Right,Y;public int Width {get{return Right-Left+1;}}}
  sealed class Card {public int Left,Right,Top,Bottom;public int Width {get{return Right-Left+1;}}public int Height {get{return Bottom-Top+1;}}}
  sealed class Pixels {
   public int Left,Top,Width,Height,Distance;public int[] Data;
   public int Get(int x,int y){return Data[(y-Top)*Width+x-Left];}
   public bool Contains(int x,int y){return x>=Left&&y>=Top&&x<Left+Width&&y<Top+Height;}
   // Auto-balance tints disabled cards. The strongest RGB channel can hide
   // their edge against the gray panel; compare perceptual brightness while
   // retaining the same contrast threshold and full three-card structure.
   static int Light(int rgb){return (((rgb>>16)&255)*3+((rgb>>8)&255)*6+(rgb&255))/10;}
   public bool Edge(int x,int y,bool horizontal){
    int dx=horizontal?0:Distance,dy=horizontal?Distance:0;
    if(!Contains(x-dx,y-dy)||!Contains(x+dx,y+dy))return false;
    int rgb=Get(x,y),r=(rgb>>16)&255,g=(rgb>>8)&255,b=rgb&255;
    int high=Math.Max(r,Math.Max(g,b)),low=Math.Min(r,Math.Min(g,b));
    if(high>225||high-low>115)return false;
    int before=Light(Get(x-dx,y-dy)),after=Light(Get(x+dx,y+dy));
    // Enabled cards have a bright thin outline. Disabled cards can instead
    // be a black fill with a dark edge against the lighter modal background.
    return high>=50&&low>=28&&Light(rgb)-Math.Max(before,after)>=10||Math.Abs(before-after)>=18;
   }
  }
  static Pixels Read(Bitmap image){
   var area=new Rectangle(image.Width/4,image.Height/4,image.Width/2,image.Height/2);
   var pixels=new Pixels{Left=area.Left,Top=area.Top,Width=area.Width,Height=area.Height,Distance=Math.Max(2,(int)Math.Round(image.Height/480d)),Data=new int[area.Width*area.Height]};
   var locked=image.LockBits(area,ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
   try{for(int y=0;y<area.Height;y++)Marshal.Copy(IntPtr.Add(locked.Scan0,y*locked.Stride),pixels.Data,y*area.Width,area.Width);}finally{image.UnlockBits(locked);}
   return pixels;
  }
  static List<Line> Lines(Pixels pixels,int height){
   var lines=new List<Line>();int minimum=Math.Max(24,(int)(height*.07)),tolerance=Math.Max(2,pixels.Distance);
   for(int y=pixels.Top+pixels.Distance;y<pixels.Top+pixels.Height-pixels.Distance;y++){
    int start=-1,last=-1,holes=0;
    for(int x=pixels.Left+pixels.Distance;x<=pixels.Left+pixels.Width-pixels.Distance;x++){
     bool hit=x<pixels.Left+pixels.Width-pixels.Distance&&pixels.Edge(x,y,true);
     if(hit){if(start<0)start=x;last=x;holes=0;}
     else if(start>=0&&++holes>tolerance){
      if(last-start+1>=minimum){
       bool merged=false;
       for(int i=lines.Count-1;i>=0&&y-lines[i].Y<=tolerance+1;i--){var line=lines[i];if(Math.Abs(start-line.Left)<=tolerance&&Math.Abs(last-line.Right)<=tolerance){merged=true;break;}}
       if(!merged)lines.Add(new Line{Left=start,Right=last,Y=y});
      }
      start=-1;last=-1;holes=0;
     }
    }
   }
   return lines;
  }
  static bool Vertical(Pixels pixels,int x,int top,int bottom){
   // Rounded corners shorten horizontal runs by a few pixels; look beside
   // their endpoints for the actual continuous vertical outline.
   int good=0,total=0,tolerance=Math.Max(2,pixels.Distance*2);
   for(int y=top+pixels.Distance*2;y<=bottom-pixels.Distance*2;y+=2){
    bool hit=false;for(int dx=-tolerance;dx<=tolerance;dx++)if(pixels.Edge(x+dx,y,false)){hit=true;break;}
    total++;if(hit)good++;
   }
   return total>=10&&good>=total*.82;
  }
  static bool Same(Card a,Card b,int tolerance){return Math.Abs(a.Left-b.Left)<=tolerance&&Math.Abs(a.Right-b.Right)<=tolerance&&Math.Abs(a.Top-b.Top)<=tolerance&&Math.Abs(a.Bottom-b.Bottom)<=tolerance;}
  static List<Card> Cards(Pixels pixels,List<Line> lines,int height){
   var cards=new List<Card>();int tolerance=Math.Max(3,pixels.Distance*2);
   foreach(var top in lines){
    if(top.Width<height*.08||top.Width>height*.19)continue;
    foreach(var bottom in lines){
     int tall=bottom.Y-top.Y+1;
     if(tall<top.Width*1.12||tall>top.Width*1.62||Math.Abs(top.Left-bottom.Left)>tolerance||Math.Abs(top.Right-bottom.Right)>tolerance)continue;
     var card=new Card{Left=(top.Left+bottom.Left)/2,Right=(top.Right+bottom.Right)/2,Top=top.Y,Bottom=bottom.Y};
     if(!Vertical(pixels,card.Left,card.Top,card.Bottom)||!Vertical(pixels,card.Right,card.Top,card.Bottom))continue;
     bool duplicate=false;foreach(var prior in cards)if(Same(prior,card,tolerance*2)){duplicate=true;break;}
     if(!duplicate)cards.Add(card);
    }
   }
   cards.Sort((a,b)=>a.Left.CompareTo(b.Left));return cards;
  }
  static bool HeaderInk(Pixels pixels,Line top,Line separator,int cardWidth){
   int count=0,left=Int32.MaxValue,right=0,total=0,margin=pixels.Distance*2;
   for(int y=top.Y+margin;y<separator.Y-margin;y+=2)for(int x=top.Left+margin;x<top.Right-margin;x+=2){
    int rgb=pixels.Get(x,y),r=(rgb>>16)&255,g=(rgb>>8)&255,b=rgb&255;total++;
    if(Math.Min(r,Math.Min(g,b))>=155&&Math.Max(r,Math.Max(g,b))-Math.Min(r,Math.Min(g,b))<=30){count++;left=Math.Min(left,x);right=Math.Max(right,x);}
   }
   return count>=Math.Max(15,cardWidth/4)&&count<total*.35&&right-left>=cardWidth*.8;
  }
  static bool Panel(Pixels pixels,List<Line> lines,Card first,Card last,out Rectangle headerBounds){
   headerBounds=Rectangle.Empty;
   int tolerance=Math.Max(3,pixels.Distance*2),width=first.Width;
   foreach(var top in lines){
    if(first.Top-top.Y<width*.25||first.Top-top.Y>width*.65||first.Left-top.Left<width*.03||first.Left-top.Left>width*.2||top.Right-last.Right<width*.03||top.Right-last.Right>width*.2)continue;
    foreach(var bottom in lines){
     if(bottom.Y-last.Bottom<width*.035||bottom.Y-last.Bottom>width*.2||Math.Abs(top.Left-bottom.Left)>tolerance||Math.Abs(top.Right-bottom.Right)>tolerance)continue;
     if(!Vertical(pixels,top.Left,top.Y,bottom.Y)||!Vertical(pixels,top.Right,top.Y,bottom.Y))continue;
     foreach(var separator in lines){
      if(Math.Abs(top.Left-separator.Left)>tolerance||Math.Abs(top.Right-separator.Right)>tolerance||first.Top-separator.Y<width*.035||first.Top-separator.Y>width*.20||separator.Y-top.Y<width*.15)continue;
      if(HeaderInk(pixels,top,separator,width)){headerBounds=Rectangle.FromLTRB(top.Left,top.Y,top.Right+1,separator.Y+1);return true;}
     }
    }
   }
   return false;
  }
  public static bool TryRecognize(Bitmap image,string team,DateTime now,out TeamClickerTarget target){Rectangle ignored;return TryRecognize(image,team,now,out target,out ignored);}
  public static bool TryRecognize(Bitmap image,string team,DateTime now,out TeamClickerTarget target,out Rectangle cardBounds){
   target=null;cardBounds=Rectangle.Empty;
   if(!TeamClickerCommand.IsTeam(team))return false;
   TeamClickerSelectorSnapshot snapshot;if(!TryRecognizeAll(image,now,out snapshot))return false;
   target=snapshot.Targets[team];cardBounds=snapshot.Cards[team];return true;
  }
  public static bool TryRecognizeAll(Bitmap image,DateTime now,out TeamClickerSelectorSnapshot snapshot){
   snapshot=null;
   if(image==null||now.Kind!=DateTimeKind.Utc||image.Width<640||image.Height<400||image.Width>8000||image.Height>8000)return false;
   try{
    var pixels=Read(image);var lines=Lines(pixels,image.Height);if(lines.Count>300)return false;
    var cards=Cards(pixels,lines,image.Height);if(cards.Count>40)return false;
    Card[] chosen=null;Card firstMatch=null,lastMatch=null;Rectangle header=Rectangle.Empty;int matches=0,tolerance=Math.Max(3,pixels.Distance*2);
    for(int a=0;a<cards.Count;a++)for(int b=a+1;b<cards.Count;b++)for(int c=b+1;c<cards.Count;c++){
     var first=cards[a];var middle=cards[b];var last=cards[c];
     if(Math.Abs(first.Top-middle.Top)>tolerance||Math.Abs(first.Top-last.Top)>tolerance||Math.Abs(first.Bottom-middle.Bottom)>tolerance||Math.Abs(first.Bottom-last.Bottom)>tolerance)continue;
     if(Math.Abs(first.Width-middle.Width)>tolerance*2||Math.Abs(first.Width-last.Width)>tolerance*2)continue;
     double gap1=middle.Left-first.Right-1,gap2=last.Left-middle.Right-1;
     if(gap1<first.Width*.03||gap1>first.Width*.25||gap2<first.Width*.03||gap2>first.Width*.25||Math.Abs(gap1-gap2)>tolerance*2)continue;
     double centerX=(first.Left+last.Right)*.5,centerY=(first.Top+first.Bottom)*.5;
     Rectangle candidateHeader;
     if(Math.Abs(centerX-image.Width*.5)>image.Width*.08||centerY<image.Height*.35||centerY>image.Height*.65||!Panel(pixels,lines,first,last,out candidateHeader))continue;
     if(firstMatch!=null&&Same(firstMatch,first,tolerance)&&Same(lastMatch,last,tolerance))continue;
     matches++;firstMatch=first;lastMatch=last;chosen=new[]{first,middle,last};header=candidateHeader;
    }
    if(matches!=1||chosen==null)return false;
    var result=new TeamClickerSelectorSnapshot{Targets=new Dictionary<string,TeamClickerTarget>(),Cards=new Dictionary<string,Rectangle>(),HeaderBounds=header};
    string[] teams={"blue","red","green"};
    for(int i=0;i<teams.Length;i++){
     Card card=chosen[i];int x=(card.Left+card.Right)/2,y=card.Top+(int)Math.Round(card.Width*.45);
     var value=new TeamClickerTarget{x=x,y=y,width=image.Width,height=image.Height,patchWidth=64,patchHeight=32,patchLeft=Math.Max(0,Math.Min(image.Width-64,x-32)),patchTop=Math.Max(0,Math.Min(image.Height-32,y-16)),capturedAt=now.ToString("o"),signature=new int[45]};
     for(int yy=0;yy<5;yy++)for(int xx=0;xx<9;xx++)value.signature[yy*9+xx]=image.GetPixel(value.patchLeft+2+xx*7,value.patchTop+2+yy*7).ToArgb()&0xffffff;
     if(!value.Valid())return false;result.Targets.Add(teams[i],value);result.Cards.Add(teams[i],new Rectangle(card.Left,card.Top,card.Width,card.Height));
    }
    snapshot=result;return true;
   }catch(ArgumentException){return false;}catch(ExternalException){return false;}
  }
 }
 // Reuses one structural acquisition. Per-click availability reads one small
 // shared region, including current header text proof; it never scans three
 // complete game frames or authorizes a HUD from old card coordinates.
 public sealed class TeamClickerAnySelector {
  sealed class Anchor {public int X,Y,Rgb;}
  readonly TeamClickerSelectorSnapshot snapshot;
  readonly List<Anchor> header=new List<Anchor>();
  public readonly Rectangle ReadBounds;
  static int Bright(Color color){return (color.R*3+color.G*6+color.B)/10;}
  public TeamClickerAnySelector(Bitmap full,TeamClickerSelectorSnapshot value){
   if(full==null||value==null||value.Targets==null||value.Targets.Count!=3||value.HeaderBounds.IsEmpty)throw new ArgumentException("No hay un selector completo para el modo aleatorio.");
   snapshot=value;Rectangle region=value.HeaderBounds;
   foreach(var target in value.Targets.Values){if(target==null||!target.Valid()||target.width!=full.Width||target.height!=full.Height)throw new ArgumentException("Tarjetas del selector no validas.");region=Rectangle.Union(region,new Rectangle(target.patchLeft,target.patchTop,64,32));}
   if(!new Rectangle(Point.Empty,full.Size).Contains(region))throw new ArgumentException("La region del selector no es valida.");
   ReadBounds=region;
   Rectangle ink=value.HeaderBounds;ink.Inflate(-Math.Max(3,full.Height/480),-Math.Max(3,full.Height/480));
   int step=Math.Max(1,(int)Math.Sqrt(Math.Max(1,ink.Width*ink.Height)/6000d));
   for(int y=ink.Top+1;y<ink.Bottom-1;y+=step)for(int x=ink.Left+1;x<ink.Right-1;x+=step){
    Color color=full.GetPixel(x,y);int bright=Bright(color);if(bright<130)continue;
    int contrast=Math.Max(Math.Max(Math.Abs(bright-Bright(full.GetPixel(x-1,y))),Math.Abs(bright-Bright(full.GetPixel(x+1,y)))),Math.Max(Math.Abs(bright-Bright(full.GetPixel(x,y-1))),Math.Abs(bright-Bright(full.GetPixel(x,y+1)))));
    if(contrast>=24)header.Add(new Anchor{X=x-region.Left,Y=y-region.Top,Rgb=color.ToArgb()&0xffffff});
   }
   if(header.Count<12)throw new ArgumentException("No se puede verificar el texto del selector.");
  }
  public Dictionary<string,TeamClickerTarget> Available(Bitmap current,DateTime now){
   var result=new Dictionary<string,TeamClickerTarget>();
   if(current==null||now.Kind!=DateTimeKind.Utc||current.Width!=ReadBounds.Width||current.Height!=ReadBounds.Height)return result;
   int matching=0;
   foreach(var anchor in header){Color color=current.GetPixel(anchor.X,anchor.Y);int r=(anchor.Rgb>>16)&255,g=(anchor.Rgb>>8)&255,b=anchor.Rgb&255;if(Math.Abs(color.R-r)<=48&&Math.Abs(color.G-g)<=48&&Math.Abs(color.B-b)<=48)matching++;}
   if(matching<header.Count*.78)return result;
   foreach(string team in new[]{"blue","red","green"}){
    TeamClickerTarget prior=snapshot.Targets[team];int[] signature=new int[45];int available=0;
    byte wanted=(byte)(team=="blue"?1:team=="red"?2:3);
    for(int y=0;y<5;y++)for(int x=0;x<9;x++){
     int rgb=current.GetPixel(prior.patchLeft-ReadBounds.Left+2+x*7,prior.patchTop-ReadBounds.Top+2+y*7).ToArgb()&0xffffff;
     signature[y*9+x]=rgb;if(TeamClickerPatch.LogoColor(rgb)==wanted)available++;
    }
    if(available<3)continue;
    result.Add(team,new TeamClickerTarget{x=prior.x,y=prior.y,width=prior.width,height=prior.height,patchLeft=prior.patchLeft,patchTop=prior.patchTop,patchWidth=64,patchHeight=32,capturedAt=now.ToString("o"),signature=signature});
   }
   return result;
  }
 }
}
