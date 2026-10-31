using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;

internal static class AppUpdaterTests
{
 private static int checks;
 private static void Check(bool value,string reason){if(!value)throw new Exception(reason);checks++;}
 private static void Reject(Action action,string reason){bool rejected=false;try{action();}catch{rejected=true;}Check(rejected,reason);}
 private sealed class Fixture : IDisposable
 {
  public readonly string Base,Root,Stage;public readonly UpdatePlan Plan;
  public Fixture()
  {
   Base=Path.Combine(Path.GetTempPath(),"farmdogs-updater-test-"+Guid.NewGuid().ToString("N"));Root=Path.Combine(Base,"app");string id=Guid.NewGuid().ToString("D");Stage=Path.Combine(Base,"updates",id);Directory.CreateDirectory(Root);Directory.CreateDirectory(Stage);
   Plan=new UpdatePlan {format="farmdogs-update-plan-v1",id=id,root=Root,stage=Stage,archive=Path.Combine(Stage,"FarmDogs-portable.zip"),sha256=new string('0',64),version="0.4.0",verificationFile=Path.Combine(Stage,"verified.json"),resultFile=Path.Combine(Stage,"result.json"),processes=new UpdateProcess[0]};
   var installed=new Dictionary<string,string>{{"FarmDogs.exe","launcher-old"},{"bin/FarmDogsApp.exe","desktop-old"},{"bin/runtime/node.exe","runtime-old"},{"bin/runtime/LICENSE","runtime-license-old"},{"src/server.cjs","server-old"},{"public/mini.html","html-old"},{"LICENSE","app-license-old"}};
   var files=new List<UpdateFile>();foreach(var item in installed){string target=Path.Combine(Root,item.Key.Replace('/',Path.DirectorySeparatorChar));Directory.CreateDirectory(Path.GetDirectoryName(target));File.WriteAllText(target,item.Value,new UTF8Encoding(false));files.Add(new UpdateFile{path=item.Key,sha256=AppUpdater.Sha(target)});}
   File.WriteAllText(Path.Combine(Root,"manifest.json"),AppUpdater.Json.Serialize(new UpdateManifest{format="wardogs-portable-v1",application="FarmDogs",version="0.3.0",platform="win32-x64",privateDataIncluded=false,files=files.ToArray()}),new UTF8Encoding(false));
  }
  public Dictionary<string,string> Payload()
  {
   var payload=new Dictionary<string,string>{{"FarmDogs.exe","launcher-new"},{"bin/FarmDogsApp.exe","desktop-new"},{"bin/FarmDogsUpdater.exe","updater-fixture"},{"bin/runtime/node.exe","runtime-fixture"},{"bin/runtime/LICENSE","runtime-license"},{"src/server.cjs","require('./domain.cjs'); const version=require('../package.json').version;"},{"src/domain.cjs","module.exports=require('./nested/helper');"},{"src/nested/helper.js","module.exports={};"},{"package.json","{\"name\":\"farmdogs\",\"version\":\"0.4.0\"}"},{"public/mini.html","html-new"},{"LICENSE","app-license"}};
   foreach(string relative in new[]{"bin/WardogsMovement.exe","bin/WardogsTeamClicker.exe","bin/WardogsEntry.exe","bin/WardogsImageText.exe","bin/movement-capabilities.json","bin/team-clicker-capabilities.json","bin/entry-capabilities.json","bin/Microsoft.Web.WebView2.Core.dll","bin/Microsoft.Web.WebView2.WinForms.dll","bin/WebView2Loader.dll","bin/runtime/runtime.json","public/mini.js","public/mini.css","public/attention.js","public/attention.css","public/account-import.js","public/reward-execution.js"})payload[relative]="inert fixture";
   return payload;
  }
  public void Archive(Dictionary<string,string> payload=null,Action<ZipArchive> extra=null,Action<UpdateManifest> alter=null)
  {
   payload=payload??Payload();string source=Path.Combine(Base,"payload-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(source);var files=new List<UpdateFile>();
   foreach(var item in payload){string target=Path.Combine(source,item.Key.Replace('/',Path.DirectorySeparatorChar));Directory.CreateDirectory(Path.GetDirectoryName(target));File.WriteAllText(target,item.Value,new UTF8Encoding(false));files.Add(new UpdateFile {path=item.Key,sha256=AppUpdater.Sha(target)});}
   var manifest=new UpdateManifest {format="wardogs-portable-v1",application="FarmDogs",version="0.4.0",platform="win32-x64",privateDataIncluded=false,files=files.ToArray()};if(alter!=null)alter(manifest);
   if(File.Exists(Plan.archive))File.Delete(Plan.archive);
   using(var archive=ZipFile.Open(Plan.archive,ZipArchiveMode.Create))
   {
    foreach(var item in payload)using(var writer=new StreamWriter(archive.CreateEntry("FarmDogs/"+item.Key).Open(),new UTF8Encoding(false)))writer.Write(item.Value);
    using(var writer=new StreamWriter(archive.CreateEntry("FarmDogs/manifest.json").Open(),new UTF8Encoding(false)))writer.Write(AppUpdater.Json.Serialize(manifest));
    if(extra!=null)extra(archive);
   }
   Plan.sha256=AppUpdater.Sha(Plan.archive);
  }
  public void Dispose(){string parent=Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;string actual=Path.GetFullPath(Base);if(!actual.StartsWith(parent,StringComparison.OrdinalIgnoreCase)||!Path.GetFileName(actual).StartsWith("farmdogs-updater-test-"))throw new Exception("Unsafe test cleanup.");Directory.Delete(actual,true);}
 }
 public static int Main()
 {
  try
  {
   Check(AppUpdater.CompareVersion("0.4.0","0.3.99")>0,"Numeric version ordering failed.");Check(AppUpdater.CompareVersion("1.0.0","1.0.0")==0,"Equal version changed.");Check(AppUpdater.CompareVersion("0.4.0","0.10.0")<0,"Lexical version comparison.");
   foreach(string value in new[]{"0.4.0-beta","v0.4.0","01.4.0","1.2","999999999.0.0"})Reject(()=>AppUpdater.CompareVersion(value,"0.3.0"),"Invalid version accepted.");
   foreach(string value in new[]{"../data/a","data/account.json","src/../data/a","bin\\evil.exe","bin/a:stream","/FarmDogs.exe","bin/CON.txt","bin/aux.exe","public/a.","profiles/steam.json","src/cookies/private.txt","research/image.png","bin//x"})Reject(()=>AppUpdater.Relative(value),"Unsafe relative path accepted.");
   Check(AppUpdater.Relative("src/server.cjs")=="src/server.cjs","Legitimate source path rejected.");
   using(var f=new Fixture())
   {
    f.Archive();var result=AppUpdater.VerifyAndExtract(f.Plan);Check(result.Files.Length==f.Payload().Count,"Payload count changed.");Check(File.ReadAllText(Path.Combine(result.Directory,"src","server.cjs"))==f.Payload()["src/server.cjs"],"Source content changed.");Check(!Directory.Exists(Path.Combine(result.Directory,"data")),"Private data created.");
    f.Plan.sha256=new string('0',64);Reject(()=>AppUpdater.VerifyAndExtract(f.Plan),"Untrusted outer hash accepted.");
   }
   foreach(string name in new[]{"FarmDogs/../escape.txt","other/extra.txt","FarmDogs/data/account.json","FarmDogs/bin\\evil.exe","FarmDogs/bin/a:secret","FarmDogs/src/../../outside.txt","FarmDogs/README.md"})using(var f=new Fixture())
   {
    f.Archive(null,archive=>{using(var writer=new StreamWriter(archive.CreateEntry(name).Open()))writer.Write("unexpected");});Reject(()=>AppUpdater.VerifyAndExtract(f.Plan),"Unexpected ZIP member accepted: "+name);
   }
   using(var f=new Fixture()){f.Archive(null,archive=>{archive.CreateEntry("FarmDogs/src/server.cjs");});Reject(()=>AppUpdater.VerifyAndExtract(f.Plan),"Duplicate ZIP entry accepted.");}
   using(var f=new Fixture()){f.Archive(null,archive=>{var link=archive.CreateEntry("FarmDogs/bin/link.exe");link.ExternalAttributes=unchecked((int)0xA1FF0000);});Reject(()=>AppUpdater.VerifyAndExtract(f.Plan),"Symlink entry accepted.");}
   using(var f=new Fixture()){f.Archive(null,null,manifest=>manifest.files[0].sha256=new string('0',64));Reject(()=>AppUpdater.VerifyAndExtract(f.Plan),"Per-file checksum mismatch accepted.");}
   using(var f=new Fixture()){f.Archive(null,null,manifest=>manifest.privateDataIncluded=true);Reject(()=>AppUpdater.VerifyAndExtract(f.Plan),"Private manifest accepted.");}
   using(var f=new Fixture()){f.Archive(null,null,manifest=>manifest.version="0.5.0");Reject(()=>AppUpdater.VerifyAndExtract(f.Plan),"Manifest version mismatch accepted.");}
   using(var f=new Fixture()){var payload=f.Payload();payload.Remove("bin/runtime/node.exe");f.Archive(payload);Reject(()=>AppUpdater.VerifyAndExtract(f.Plan),"Missing runtime accepted.");}
   using(var f=new Fixture())
   {
    f.Archive();var package=AppUpdater.VerifyAndExtract(f.Plan);Directory.CreateDirectory(Path.Combine(f.Root,"data","webview-profile"));File.WriteAllText(Path.Combine(f.Root,"data","webview-profile","session.txt"),"preserve-private");File.WriteAllText(Path.Combine(f.Root,"FarmDogs.exe"),"launcher-old");
    AppUpdater.InstallFiles(f.Plan,package,null);Check(File.ReadAllText(Path.Combine(f.Root,"FarmDogs.exe"))=="launcher-new","Launcher not installed.");Check(File.Exists(Path.Combine(f.Root,"manifest.json")),"Manifest not installed last.");Check(File.ReadAllText(Path.Combine(f.Root,"data","webview-profile","session.txt"))=="preserve-private","Private data changed.");
    Reject(()=>AppUpdater.InstallFiles(f.Plan,package,null),"Equal-version reinstall was accepted.");
   }
   using(var f=new Fixture())
   {
    f.Archive();var package=AppUpdater.VerifyAndExtract(f.Plan);File.WriteAllText(Path.Combine(f.Root,"FarmDogs.exe"),"launcher-old");Directory.CreateDirectory(Path.Combine(f.Root,"data"));File.WriteAllText(Path.Combine(f.Root,"data","settings.json"),"preserve");
    Reject(()=>AppUpdater.InstallFiles(f.Plan,package,(index,relative)=>{if(index==2)throw new IOException("fixture locked file");}),"Injected copy failure was accepted.");
    Check(File.ReadAllText(Path.Combine(f.Root,"FarmDogs.exe"))=="launcher-old","Rollback did not restore launcher.");Check(File.ReadAllText(Path.Combine(f.Root,"bin","FarmDogsApp.exe"))=="desktop-old","Rollback did not restore desktop.");Check(!File.Exists(Path.Combine(f.Root,"bin","FarmDogsUpdater.exe")),"Rollback did not remove newly created file.");Check(File.ReadAllText(Path.Combine(f.Root,"data","settings.json"))=="preserve","Rollback changed private settings.");Check(File.ReadAllText(Path.Combine(f.Stage,"rollback.json")).Contains("\"restored\":true"),"Rollback completion missing.");
   }
   using(var f=new Fixture())
   {
    f.Archive();f.Plan.processes=new[]{new UpdateProcess {pid=1,executablePath=Path.Combine(f.Base,"Steam.exe")}};Reject(()=>AppUpdater.WaitForOwnProcesses(f.Plan,1),"External process was accepted.");
    f.Plan.archive=Path.Combine(f.Root,"other.zip");Reject(()=>AppUpdater.ValidatePlan(f.Plan,false),"Archive outside stage accepted.");
   }
   using(var f=new Fixture())
   {
    var node=new UpdateProcess{pid=100,executablePath=Path.Combine(f.Root,"bin","runtime","node.exe")};var gui=new UpdateProcess{pid=101,executablePath=Path.Combine(f.Root,"bin","FarmDogsApp.exe")};var outsider=new UpdateProcess{pid=102,executablePath=Path.Combine(f.Base,"other","bin","runtime","node.exe")};var game=new UpdateProcess{pid=103,executablePath=Path.Combine(f.Root,"bin","Wardogs.exe")};
    f.Plan.processes=new[]{node};var waited=new List<int>();AppUpdater.WaitForOwnProcesses(f.Plan,1000,()=>new[]{node,gui,outsider,game},(process,remaining)=>{Check(remaining>0,"Wait timeout not bounded.");waited.Add(process.pid);});
    Check(waited.SequenceEqual(new[]{100,101}),"Positive own Node/GUI identities or root isolation failed.");
    Check(AppUpdater.ManagedPath(f.Root,Path.Combine(f.Root,"WardogsSeeding.exe")),"Legacy process alias was passed through the package catalog.");
    Check(AppUpdater.ManagedPath(f.Root,Path.Combine(f.Root,"bin","FarmDogsApp.previous-123.exe")),"Previous desktop alias was rejected.");
    Check(!AppUpdater.ManagedPath(f.Root,outsider.executablePath)&&!AppUpdater.ManagedPath(f.Root,game.executablePath),"Another root or the game was considered managed.");
   }
   foreach(string missing in new[]{"src/domain.cjs","src/nested/helper.js","package.json","public/mini.js","bin/WardogsEntry.exe","bin/entry-capabilities.json","bin/Microsoft.Web.WebView2.Core.dll"})using(var f=new Fixture())
   {
    var payload=f.Payload();payload.Remove(missing);f.Archive(payload);Reject(()=>AppUpdater.VerifyAndExtract(f.Plan),"Incomplete runtime package was accepted: "+missing);Check(File.ReadAllText(Path.Combine(f.Root,"FarmDogs.exe"))=="launcher-old","Rejected package changed the installation.");
   }
   using(var f=new Fixture())
   {
    var payload=f.Payload();payload["package.json"]="{\"version\":\"0.3.0\"}";f.Archive(payload);Reject(()=>AppUpdater.VerifyAndExtract(f.Plan),"Mismatching package.json version was accepted.");
   }
   using(var f=new Fixture())
   {
    var payload=f.Payload();payload["src/domain.cjs"]="require('../../escape.js');";f.Archive(payload);Reject(()=>AppUpdater.VerifyAndExtract(f.Plan),"A source dependency outside the package was accepted.");
   }
   foreach(string kind in new[]{"git-directory","git-file","package-only","empty"})using(var f=new Fixture())
   {
    f.Archive();var package=AppUpdater.VerifyAndExtract(f.Plan);string original=File.ReadAllText(Path.Combine(f.Root,"manifest.json"));
    if(kind=="git-directory")Directory.CreateDirectory(Path.Combine(f.Root,".git"));
    if(kind=="git-file")File.WriteAllText(Path.Combine(f.Root,".git"),"gitdir: inert-fixture");
    if(kind=="package-only"){File.Delete(Path.Combine(f.Root,"manifest.json"));File.WriteAllText(Path.Combine(f.Root,"package.json"),"{\"version\":\"0.3.0\"}");}
    if(kind=="empty"){f.Plan.root=Path.Combine(f.Base,"empty");Directory.CreateDirectory(f.Plan.root);}
    Reject(()=>AppUpdater.InstallFiles(f.Plan,package,null),"A development or non-portable root was installed: "+kind);
    Check(File.ReadAllText(Path.Combine(f.Root,"FarmDogs.exe"))=="launcher-old","A rejected development install changed files.");
    Check(!File.Exists(Path.Combine(f.Stage,"journal.json")),"A rejected root started a transaction.");
    if(kind=="git-directory"||kind=="git-file")Check(File.ReadAllText(Path.Combine(f.Root,"manifest.json"))==original,"A rejected root changed its manifest.");
    if(kind=="empty")Check(Directory.GetFileSystemEntries(f.Plan.root).Length==0,"An empty rejected root was populated.");
   }
   using(var f=new Fixture())
   {
    f.Archive();var package=AppUpdater.VerifyAndExtract(f.Plan);AppUpdater.InstalledPortable(f.Root,"0.4.0");File.WriteAllText(Path.Combine(f.Root,".git"),"gitdir: appeared-after-shutdown");Reject(()=>AppUpdater.InstallFiles(f.Plan,package,null),"Portable status was not rechecked after cooperative shutdown.");Check(File.ReadAllText(Path.Combine(f.Root,"FarmDogs.exe"))=="launcher-old","Late development marker changed the installation.");
   }
   using(var f=new Fixture())
   {
    var payload=f.Payload();string repository=Directory.GetCurrentDirectory();
    foreach(string directory in new[]{"src","public"})foreach(string source in Directory.GetFiles(Path.Combine(repository,directory)))if(new[]{".cjs",".js",".html",".css"}.Contains(Path.GetExtension(source)))payload[directory+"/"+Path.GetFileName(source)]=File.ReadAllText(source,Encoding.UTF8);
    f.Archive(payload);var package=AppUpdater.VerifyAndExtract(f.Plan);AppUpdater.InstallFiles(f.Plan,package,null);Check(File.ReadAllText(Path.Combine(f.Root,"src","server.cjs"))==payload["src/server.cjs"],"Current full source package was not installed.");Check(File.Exists(Path.Combine(f.Root,"src","domain.cjs")),"A live source dependency was removed.");Check(AppUpdater.InstalledPortable(f.Root,"0.4.1").version=="0.4.0","Installed full package could not be validated again.");
   }
   Console.WriteLine(checks+" comprobaciones del actualizador; ZIP, rutas, hashes y rollback aislados, sin GUI, red, procesos cerrados ni código descargado ejecutado.");return 0;
  }
  catch(Exception error){Console.Error.WriteLine(error.ToString());return 1;}
 }
}
