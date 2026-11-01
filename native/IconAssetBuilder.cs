using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

// Build-time format conversion of the existing FarmDogs PNG; no new artwork.
internal static class IconAssetBuilder
{
    private static readonly int[] Sizes={16,24,32,48,64,128,256};
    public static int Main(string[] args)
    {
        try
        {
            if(args.Length!=2)throw new ArgumentException("PNG de origen e ICO de destino requeridos.");
            var source=new FileInfo(args[0]);if(!source.Exists||source.Length>16*1024*1024)throw new InvalidOperationException("PNG no válido.");
            var frames=new List<byte[]>();
            using(var image=Image.FromFile(source.FullName))
            {
                if(image.Width<1||image.Height<1||image.Width>4096||image.Height>4096)throw new InvalidOperationException("Dimensiones de marca no válidas.");
                foreach(int size in Sizes)using(var bitmap=new Bitmap(size,size,PixelFormat.Format32bppArgb))
                {
                    using(var graphics=Graphics.FromImage(bitmap)){graphics.Clear(Color.Transparent);graphics.CompositingQuality=CompositingQuality.HighQuality;graphics.InterpolationMode=InterpolationMode.HighQualityBicubic;graphics.PixelOffsetMode=PixelOffsetMode.HighQuality;graphics.DrawImage(image,new Rectangle(0,0,size,size));}
                    using(var bytes=new MemoryStream()){bitmap.Save(bytes,ImageFormat.Png);frames.Add(bytes.ToArray());}
                }
            }
            string destination=Path.GetFullPath(args[1]);Directory.CreateDirectory(Path.GetDirectoryName(destination));
            using(var writer=new BinaryWriter(File.Create(destination)))
            {
                writer.Write((ushort)0);writer.Write((ushort)1);writer.Write((ushort)Sizes.Length);uint offset=(uint)(6+16*Sizes.Length);
                for(int i=0;i<Sizes.Length;i++){writer.Write((byte)(Sizes[i]==256?0:Sizes[i]));writer.Write((byte)(Sizes[i]==256?0:Sizes[i]));writer.Write((byte)0);writer.Write((byte)0);writer.Write((ushort)1);writer.Write((ushort)32);writer.Write((uint)frames[i].Length);writer.Write(offset);offset+=(uint)frames[i].Length;}
                foreach(var bytes in frames)writer.Write(bytes);
            }
            return 0;
        }
        catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
    }
}
