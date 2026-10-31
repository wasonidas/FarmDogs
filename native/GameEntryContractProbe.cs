// TEST ONLY. Entry point selected explicitly by /main:GameEntryContractProbe.
// Validates the producer's original JSON using the production C# policy. It
// never instantiates a platform, captures a screen, or invokes native input.
using System;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
internal static class GameEntryContractProbe
{
 public static int Main(string[] args)
 {
  var json=new JavaScriptSerializer{MaxJsonLength=65536};
  try
  {
   if(args.Length!=3)throw new ArgumentException("commandFile dataDirectory fakeUtcNow required");
   string commandFile=Path.GetFullPath(args[0]),directory=Path.GetFullPath(args[1]);
   if(!String.Equals(Path.GetDirectoryName(commandFile),directory,StringComparison.OrdinalIgnoreCase)||(File.GetAttributes(directory)&FileAttributes.ReparsePoint)!=0)throw new ArgumentException("Command must belong to the test data directory");
   var file=new FileInfo(commandFile);if(!file.Exists||file.Length<2||file.Length>65536||(file.Attributes&FileAttributes.ReparsePoint)!=0)throw new ArgumentException("Invalid test command file");
   var command=json.Deserialize<EntryAction>(File.ReadAllText(commandFile,new UTF8Encoding(false,true)));
   GameEntryPolicy.Validate(command,commandFile,GameEntryPolicy.Time(args[2]));
   Console.WriteLine(json.Serialize(new{valid=true,id=command.id,control=command.control,kind=command.kind}));return 0;
  }
  catch(EntryFailure error){Console.WriteLine(json.Serialize(new{valid=false,status=error.Status,reason=error.Reason}));return 1;}
  catch(Exception error){Console.WriteLine(json.Serialize(new{valid=false,status="probe_error",reason=error.Message}));return 2;}
 }
}
