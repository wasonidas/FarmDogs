using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using WardogsSeeding;

// Test-only contract harness: applies the producer's unchanged JSON to the
// production state machine. No native platform, windows, timers or input exist.
internal static class TeamClickerStartupContractProbe {
 sealed class NoInputPlatform:ITeamClickerPlatform {
  public bool ServiceAlive(int pid){return pid>0;}
  public bool ModifiersDown(){return false;}
  public TeamClickerFrame ForegroundGame(){return null;}
  public TeamClickerTarget CaptureTarget(TeamClickerFrame frame,DateTime now,string team){throw new InvalidOperationException("The startup contract must never capture a window.");}
  public bool PatchMatches(TeamClickerFrame frame,TeamClickerTarget target){throw new InvalidOperationException("The startup contract must never sample a window.");}
  public void Click(TeamClickerFrame frame,TeamClickerTarget target){throw new InvalidOperationException("The startup contract must never send input.");}
 }
 static object Field(object value,string name){return value.GetType().GetProperty(name).GetValue(value,null);}
 public static int Main(string[] args){
  try{
   if(args.Length!=1)throw new ArgumentException("Expected one command-sequence JSON file.");
   string file=Path.GetFullPath(args[0]);var info=new FileInfo(file);
   if(!info.Exists||info.Length>1024*1024||(info.Attributes&FileAttributes.ReparsePoint)!=0)throw new ArgumentException("Invalid contract sequence file.");
   var json=new JavaScriptSerializer{MaxJsonLength=1024*1024};
   var commands=json.Deserialize<TeamClickerCommand[]>(File.ReadAllText(file,Encoding.UTF8).TrimStart('\uFEFF'));
   if(commands==null||commands.Length<1||commands.Length>64)throw new ArgumentException("Expected 1 to 64 producer commands.");
   var engine=new TeamClickerEngine(new NoInputPlatform(),null,()=>0);
   var steps=new List<object>();DateTime first=TeamClickerCommand.Utc(commands[0].issuedAt),previous=first;
   foreach(var command in commands){
    if(command==null)throw new ArgumentException("Missing producer command.");
    DateTime issued=TeamClickerCommand.Utc(command.issuedAt);
    if(issued<previous)throw new ArgumentException("Producer timestamps must be ordered.");
    engine.Apply(command,issued,(issued-first).TotalMilliseconds);previous=issued;
    object view=engine.View(issued,1);
    steps.Add(new{id=command.id,sessionId=command.sessionId,enabled=command.enabled,armed=engine.Armed,active=engine.Active,running=engine.Running,automaticStoppedSessionId=Field(view,"automaticStoppedSessionId"),reason=engine.Reason});
   }
   Console.WriteLine(json.Serialize(new{format="farmdogs-team-startup-contract-v1",nativeInputsAllowed=false,steps=steps}));return 0;
  }catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
 }
}
