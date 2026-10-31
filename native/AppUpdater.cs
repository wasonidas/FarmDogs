using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

internal sealed class UpdateProcess { public int pid; public string executablePath,startedAtUtc; }
internal sealed class UpdatePlan
{
 public string format,id,root,stage,archive,sha256,version,verificationFile,resultFile,workerSha256;
 public UpdateProcess[] processes;
}
internal sealed class UpdateFile { public string path,sha256; }
internal sealed class UpdateManifest
{
 public string format,application,version,platform;
 public bool privateDataIncluded;
 public UpdateFile[] files;
}
internal sealed class VerifiedUpdate { public string Directory,ManifestText,Version; public UpdateFile[] Files; }
internal sealed class SavedUpdateFile { public string Relative,Backup; public bool Existed; }

internal static class AppUpdater
{
 internal static readonly JavaScriptSerializer Json=new JavaScriptSerializer {MaxJsonLength=1048576};
 private static readonly Regex Version=new Regex(@"^(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})$",RegexOptions.CultureInvariant);
 private static readonly Regex Hash=new Regex(@"^[a-fA-F0-9]{64}$",RegexOptions.CultureInvariant);
 private static readonly HashSet<string> PrivateNames=new HashSet<string>(new[]{"data","cookies","profiles","profile","sessions","webview-profile","webview-selftest","research","planning",".git","node_modules"},StringComparer.OrdinalIgnoreCase);
 private static readonly HashSet<string> InstalledCore=new HashSet<string>(new[]{"FarmDogs.exe","bin/FarmDogsApp.exe","bin/runtime/node.exe","bin/runtime/LICENSE","src/server.cjs","public/mini.html","LICENSE"},StringComparer.OrdinalIgnoreCase);
 private static readonly HashSet<string> Core=new HashSet<string>(InstalledCore.Concat(new[]{"package.json","bin/FarmDogsUpdater.exe","bin/WardogsMovement.exe","bin/WardogsTeamClicker.exe","bin/WardogsEntry.exe","bin/WardogsImageText.exe","bin/movement-capabilities.json","bin/team-clicker-capabilities.json","bin/entry-capabilities.json","bin/Microsoft.Web.WebView2.Core.dll","bin/Microsoft.Web.WebView2.WinForms.dll","bin/WebView2Loader.dll","bin/runtime/runtime.json","public/mini.js","public/mini.css","public/attention.js","public/attention.css","public/account-import.js","public/reward-execution.js"}),StringComparer.OrdinalIgnoreCase);
 private static readonly Regex LocalRequire=new Regex(@"\brequire\s*\(\s*(['""])(?<request>\.{1,2}/[^'""\\\r\n]*)\1\s*\)",RegexOptions.CultureInvariant);
 private const long MaxArchive=128L*1024*1024,MaxExpanded=512L*1024*1024;

 [STAThread] public static int Main(string[] args)
 {
  UpdatePlan plan=null;bool validPlan=false;
  try
  {
   if(args.Length!=2||(args[0]!="--verify"&&args[0]!="--install"))throw new InvalidOperationException("Argumentos de actualización no válidos.");
   if(new FileInfo(args[1]).Length>65536)throw new InvalidOperationException("Plan demasiado grande.");
   plan=Json.Deserialize<UpdatePlan>(File.ReadAllText(args[1],Encoding.UTF8));ValidatePlan(plan,true);validPlan=true;
   if(args[0]=="--verify")
   {
    var package=VerifyAndExtract(plan);
    WriteJson(plan.verificationFile,new {verified=true,version=package.Version,packageDirectory=package.Directory,files=package.Files.Length+1});return 0;
   }
   string self=Assembly.GetExecutingAssembly().Location;
   if(!IsWithin(plan.stage,self)||!Hash.IsMatch(plan.workerSha256??"")||!String.Equals(Sha(self),plan.workerSha256,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("El instalador temporal no coincide con el plan.");
   InstalledPortable(plan.root,plan.version);
   WaitForOwnProcesses(plan,90000);
   var verified=VerifyAndExtract(plan);InstallFiles(plan,verified,null);
   WriteJson(plan.resultFile,new {success=true,status="installed",version=plan.version,at=DateTime.UtcNow.ToString("o")});
   try{Relaunch(plan.root);}catch(Exception error){WriteJson(plan.resultFile,new {success=true,status="installed_restart_failed",version=plan.version,error=Safe(error.Message)});}
   return 0;
  }
  catch(Exception error)
  {
   if(validPlan&&SafeReport(plan))try{WriteJson(plan.resultFile,new {success=false,status="error",error=Safe(error.Message),at=DateTime.UtcNow.ToString("o")});}catch{}
   if(validPlan&&args.Length==2&&args[0]=="--install")try
   {
    string rollback=Path.Combine(plan.stage,"rollback.json");
    if(File.Exists(rollback))
    {
     var value=Json.DeserializeObject(File.ReadAllText(rollback)) as Dictionary<string,object>;object restored;
     if(value!=null&&value.TryGetValue("restored",out restored)&&restored is bool&&(bool)restored)Relaunch(plan.root);
    }
   }catch{}
   return 1;
  }
 }
 private static string Safe(string value){return (value??"").Length>600?(value??"").Substring(0,600):value;}
 private static bool SafeReport(UpdatePlan plan){try{return IsWithin(plan.stage,plan.resultFile)&&!String.IsNullOrEmpty(plan.resultFile)&&Path.GetFileName(plan.resultFile)=="result.json";}catch{return false;}}
 internal static string Sha(string file){using(var input=File.OpenRead(file))using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(input)).Replace("-","").ToLowerInvariant();}
 internal static bool IsWithin(string root,string candidate){return Path.GetFullPath(candidate).StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase);}
 internal static void NoReparse(string value)
 {
  string current=Path.GetFullPath(value);
  for(;;)
  {
   if((File.Exists(current)||Directory.Exists(current))&&(File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new InvalidOperationException("No se admiten enlaces en las rutas de actualización.");
   string parent=Path.GetDirectoryName(current);if(String.IsNullOrEmpty(parent)||parent==current)break;current=parent;
  }
 }
 internal static string Relative(string value)
 {
  if(String.IsNullOrEmpty(value)||value.Length>200||value.IndexOf('\\')>=0||value.IndexOf(':')>=0||value.StartsWith("/",StringComparison.Ordinal)||!Regex.IsMatch(value,@"^[A-Za-z0-9_./-]+$"))throw new InvalidOperationException("Ruta de paquete no admitida.");
  string[] parts=value.Split('/');
  foreach(string part in parts)
  {
   if(part.Length==0||part=="."||part==".."||part.EndsWith(".",StringComparison.Ordinal)||PrivateNames.Contains(part)||Regex.IsMatch(part,@"^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)",RegexOptions.IgnoreCase))throw new InvalidOperationException("Ruta privada o no válida en el paquete.");
  }
  if(parts.Length==1)
  {
   if(!new[]{"FarmDogs.exe","LICENSE","README.md","LEEME.txt","manifest.json","package.json"}.Contains(value,StringComparer.OrdinalIgnoreCase))throw new InvalidOperationException("Archivo raíz no admitido.");
  }
  else if(!new[]{"bin","src","public","licenses"}.Contains(parts[0],StringComparer.OrdinalIgnoreCase))throw new InvalidOperationException("Carpeta de paquete no admitida.");
  return value;
 }
 internal static string Resolve(string root,string relative)
 {
  Relative(relative);string result=Path.GetFullPath(Path.Combine(root,relative.Replace('/',Path.DirectorySeparatorChar)));
  if(!IsWithin(root,result))throw new InvalidOperationException("Ruta fuera de la carpeta de aplicación.");NoReparse(result);return result;
 }
 internal static int CompareVersion(string left,string right)
 {
  if(!Version.IsMatch(left??"")||!Version.IsMatch(right??""))throw new InvalidOperationException("Versión de actualización no válida.");
  var a=left.Split('.').Select(Int32.Parse).ToArray();var b=right.Split('.').Select(Int32.Parse).ToArray();for(int i=0;i<3;i++){if(a[i]!=b[i])return a[i]>b[i]?1:-1;}return 0;
 }
 internal static void ValidatePlan(UpdatePlan plan,bool requireLocalStage)
 {
  Guid id;
  if(plan==null||plan.format!="farmdogs-update-plan-v1"||!Guid.TryParseExact(plan.id,"D",out id)||!Version.IsMatch(plan.version??"")||!Hash.IsMatch(plan.sha256??""))throw new InvalidOperationException("Plan de actualización no válido.");
  foreach(string value in new[]{plan.root,plan.stage,plan.archive,plan.verificationFile,plan.resultFile})if(String.IsNullOrEmpty(value)||!Path.IsPathRooted(value))throw new InvalidOperationException("Ruta absoluta requerida.");
  if(IsWithin(plan.root,plan.stage)||IsWithin(plan.stage,plan.root)||String.Equals(Path.GetFullPath(plan.root),Path.GetFullPath(plan.stage),StringComparison.OrdinalIgnoreCase)||Path.GetFileName(plan.stage)!=plan.id)throw new InvalidOperationException("La actualización debe prepararse fuera de FarmDogs.");
  if(requireLocalStage)
  {
   string expected=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"FarmDogs","updates");
   if(!String.Equals(Path.GetFullPath(Path.GetDirectoryName(plan.stage)),Path.GetFullPath(expected),StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Carpeta temporal de actualización no admitida.");
  }
  if(Path.GetFullPath(plan.archive)!=Path.Combine(Path.GetFullPath(plan.stage),"FarmDogs-portable.zip")||Path.GetFullPath(plan.verificationFile)!=Path.Combine(Path.GetFullPath(plan.stage),"verified.json")||Path.GetFullPath(plan.resultFile)!=Path.Combine(Path.GetFullPath(plan.stage),"result.json"))throw new InvalidOperationException("Archivos de plan fuera de su carpeta.");
  NoReparse(plan.root);NoReparse(plan.stage);NoReparse(plan.archive);
 }
 private static UpdateManifest ParseManifest(string text,string version)
 {
  if(text.Length>1048576)throw new InvalidOperationException("Manifiesto demasiado grande.");
  var manifest=Json.Deserialize<UpdateManifest>(text);
  if(manifest==null||manifest.format!="wardogs-portable-v1"||manifest.application!="FarmDogs"||manifest.platform!="win32-x64"||manifest.privateDataIncluded||CompareVersion(manifest.version,version)!=0||manifest.files==null||manifest.files.Length<Core.Count||manifest.files.Length>511)throw new InvalidOperationException("Manifiesto de FarmDogs no válido.");
  var names=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
  foreach(var item in manifest.files)if(item==null||Relative(item.path)=="manifest.json"||!Hash.IsMatch(item.sha256??"")||!names.Add(item.path))throw new InvalidOperationException("Archivo duplicado o sin suma en el manifiesto.");
  if(!Core.IsSubsetOf(names))throw new InvalidOperationException("Faltan archivos esenciales de FarmDogs.");return manifest;
 }
 internal static UpdateManifest InstalledPortable(string root,string newerVersion)
 {
  NoReparse(root);
  if(File.Exists(Path.Combine(root,".git"))||Directory.Exists(Path.Combine(root,".git")))throw new InvalidOperationException("No se actualiza una copia de desarrollo de FarmDogs.");
  string file=Path.Combine(root,"manifest.json");NoReparse(file);
  if(!File.Exists(file)||new FileInfo(file).Length>1048576)throw new InvalidOperationException("Solo se actualiza un portable instalado con manifiesto válido.");
  var manifest=Json.Deserialize<UpdateManifest>(File.ReadAllText(file,Encoding.UTF8));
  if(manifest==null||manifest.format!="wardogs-portable-v1"||manifest.application!="FarmDogs"||manifest.platform!="win32-x64"||manifest.privateDataIncluded||manifest.files==null||manifest.files.Length<InstalledCore.Count||manifest.files.Length>511||CompareVersion(newerVersion,manifest.version)<=0)throw new InvalidOperationException("El portable instalado no es válido o la versión ya no es más reciente.");
  var names=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
  foreach(var item in manifest.files)
  {
   if(item==null||Relative(item.path)=="manifest.json"||!Hash.IsMatch(item.sha256??"")||!names.Add(item.path))throw new InvalidOperationException("El manifiesto instalado no es válido.");
   string installed=Resolve(root,item.path);
   if(!File.Exists(installed)||!String.Equals(Sha(installed),item.sha256,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("El portable instalado tiene archivos incompletos o modificados.");
  }
  if(!InstalledCore.IsSubsetOf(names))throw new InvalidOperationException("El manifiesto instalado no contiene un portable completo.");
  return manifest;
 }
 private static void ValidateRuntimeFiles(string root,UpdateManifest manifest)
 {
  var catalog=manifest.files.ToDictionary(item=>item.path,item=>item,StringComparer.OrdinalIgnoreCase);
  foreach(var item in manifest.files)
  {
   string file=Resolve(root,item.path);
   if(!File.Exists(file)||!String.Equals(Sha(file),item.sha256,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Falta un archivo verificado del paquete.");
  }
  var metadata=Json.DeserializeObject(File.ReadAllText(Resolve(root,"package.json"),Encoding.UTF8)) as Dictionary<string,object>;object version;
  if(metadata==null||!metadata.TryGetValue("version",out version)||CompareVersion(version as string,manifest.version)!=0)throw new InvalidOperationException("La versión de package.json no coincide con el paquete.");
  var pending=new Queue<string>();var visited=new HashSet<string>(StringComparer.OrdinalIgnoreCase);pending.Enqueue("src/server.cjs");
  while(pending.Count>0)
  {
   string module=pending.Dequeue();if(!visited.Add(module)||!Regex.IsMatch(module,@"\.(?:cjs|js)$",RegexOptions.IgnoreCase))continue;
   string source=File.ReadAllText(Resolve(root,module),new UTF8Encoding(false,true));
   foreach(Match match in LocalRequire.Matches(source))
   {
    string target=Path.GetFullPath(Path.Combine(Path.GetDirectoryName(Resolve(root,module)),match.Groups["request"].Value.Replace('/',Path.DirectorySeparatorChar)));
    if(!IsWithin(root,target))throw new InvalidOperationException("Una dependencia sale de la carpeta del paquete.");
    string relative=target.Substring(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar).Length+1).Replace(Path.DirectorySeparatorChar,'/');
    string dependency=new[]{relative,relative+".js",relative+".json",relative+".node",relative+"/index.js",relative+"/index.json",relative+"/index.node"}.FirstOrDefault(candidate=>catalog.ContainsKey(candidate));
    if(dependency==null)throw new InvalidOperationException("Falta una dependencia local del servicio: "+relative);
    Relative(dependency);pending.Enqueue(dependency);
   }
  }
 }
 internal static VerifiedUpdate VerifyAndExtract(UpdatePlan plan)
 {
  ValidatePlan(plan,false);
  if(new FileInfo(plan.archive).Length>MaxArchive||!String.Equals(Sha(plan.archive),plan.sha256,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("El ZIP no coincide con SHA-256.");
  string unpack=Path.Combine(plan.stage,"unpacked-"+Guid.NewGuid().ToString("N")),output=Path.Combine(unpack,"FarmDogs");Directory.CreateDirectory(output);
  using(var archive=ZipFile.OpenRead(plan.archive))
  {
   var files=new Dictionary<string,ZipArchiveEntry>(StringComparer.OrdinalIgnoreCase);long expanded=0;
   if(archive.Entries.Count>1024)throw new InvalidOperationException("Demasiadas entradas en el ZIP.");
   foreach(var entry in archive.Entries)
   {
    if(!entry.FullName.StartsWith("FarmDogs/",StringComparison.Ordinal)||entry.FullName.IndexOf('\\')>=0||((entry.ExternalAttributes>>16)&0xF000)==0xA000||(entry.ExternalAttributes&(int)FileAttributes.ReparsePoint)!=0)throw new InvalidOperationException("Entrada ZIP no admitida.");
    if(entry.FullName.EndsWith("/",StringComparison.Ordinal))
    {
     string directory=entry.FullName.Substring(9).TrimEnd('/');if(directory.Length>0)Relative(directory+"/placeholder");continue;
    }
    string relative=Relative(entry.FullName.Substring(9));expanded+=entry.Length;
    if(entry.Length<0||entry.Length>256L*1024*1024||expanded>MaxExpanded||files.ContainsKey(relative))throw new InvalidOperationException("El ZIP es demasiado grande o tiene duplicados.");files.Add(relative,entry);
   }
   ZipArchiveEntry manifestEntry;if(!files.TryGetValue("manifest.json",out manifestEntry)||manifestEntry.Length>1048576)throw new InvalidOperationException("Falta manifiesto del paquete.");
   string manifestText;
   using(var input=manifestEntry.Open())using(var memory=new MemoryStream())
   {
    var buffer=new byte[8192];int got;while((got=input.Read(buffer,0,buffer.Length))>0){if(memory.Length+got>1048576)throw new InvalidOperationException("Manifiesto descomprimido demasiado grande.");memory.Write(buffer,0,got);}
    manifestText=new UTF8Encoding(false,true).GetString(memory.ToArray()).TrimStart('\uFEFF');
   }
   var manifest=ParseManifest(manifestText,plan.version);
   if(files.Count!=manifest.files.Length+1)throw new InvalidOperationException("El ZIP no coincide con el catálogo del manifiesto.");
   foreach(var item in manifest.files)
   {
    ZipArchiveEntry entry;if(!files.TryGetValue(item.path,out entry))throw new InvalidOperationException("Falta un archivo del manifiesto.");
    string destination=Resolve(output,item.path);Directory.CreateDirectory(Path.GetDirectoryName(destination));long count=0;
    using(var input=entry.Open())using(var target=new FileStream(destination,FileMode.CreateNew,FileAccess.Write,FileShare.None))
    {
     var buffer=new byte[65536];int got;while((got=input.Read(buffer,0,buffer.Length))>0){count+=got;if(count>entry.Length||count>256L*1024*1024)throw new InvalidOperationException("Contenido descomprimido demasiado grande.");target.Write(buffer,0,got);}
    }
    if(count!=entry.Length||!String.Equals(Sha(destination),item.sha256,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Un archivo no coincide con su suma del manifiesto.");
   }
   File.WriteAllText(Path.Combine(output,"manifest.json"),manifestText,new UTF8Encoding(false));
   ValidateRuntimeFiles(output,manifest);
   return new VerifiedUpdate {Directory=output,ManifestText=manifestText,Version=manifest.version,Files=manifest.files};
  }
 }
 internal static bool ManagedPath(string root,string executable)
 {
  if(String.IsNullOrEmpty(executable)||!Path.IsPathRooted(executable))return false;
  string fullRoot=Path.GetFullPath(root),fullExecutable=Path.GetFullPath(executable);
  var names=new[]{"FarmDogs.exe","WardogsSeeding.exe","bin/FarmDogsApp.exe","bin/FarmDogsUpdater.exe","bin/WardogsMovement.exe","bin/WardogsTeamClicker.exe","bin/WardogsImageText.exe","bin/FarmDogsEntry.exe","bin/FarmDogsGameEntry.exe","bin/WardogsGameEntry.exe","bin/WardogsEntry.exe","bin/runtime/node.exe"};
  bool known=names.Any(name=>String.Equals(Path.GetFullPath(Path.Combine(fullRoot,name.Replace('/',Path.DirectorySeparatorChar))),fullExecutable,StringComparison.OrdinalIgnoreCase));
  string directory=Path.GetDirectoryName(fullExecutable);
  if(!known)known=String.Equals(directory,Path.Combine(fullRoot,"bin"),StringComparison.OrdinalIgnoreCase)&&Regex.IsMatch(Path.GetFileName(fullExecutable),@"^FarmDogsApp\.previous-\d+\.exe$",RegexOptions.IgnoreCase);
  if(known){NoReparse(fullExecutable);return true;}return false;
 }
 internal static void WaitForOwnProcesses(UpdatePlan plan,int timeoutMs)
 {
  WaitForOwnProcesses(plan,timeoutMs,()=>DiscoverOwnProcesses(plan.root),WaitForOwnProcess);
 }
 private static UpdateProcess[] DiscoverOwnProcesses(string root)
 {
  var found=new List<UpdateProcess>();
  foreach(var process in Process.GetProcesses())using(process)try
  {
   if(process.Id==Process.GetCurrentProcess().Id)continue;
   string image=process.MainModule.FileName;
   if(ManagedPath(root,image))found.Add(new UpdateProcess {pid=process.Id,executablePath=image,startedAtUtc=process.StartTime.ToUniversalTime().ToString("o")});
  }catch{}
  return found.ToArray();
 }
 internal static void WaitForOwnProcesses(UpdatePlan plan,int timeoutMs,Func<UpdateProcess[]> discover,Action<UpdateProcess,int> wait)
 {
  var requested=plan.processes??new UpdateProcess[0];if(requested.Length==0||requested.Length>32)throw new InvalidOperationException("Falta la lista de procesos propios para actualizar.");
  foreach(var item in requested)if(item==null||item.pid<=0||item.pid==Process.GetCurrentProcess().Id||!ManagedPath(plan.root,item.executablePath))throw new InvalidOperationException("El plan contiene un proceso ajeno a FarmDogs.");
  var processes=new List<UpdateProcess>(requested);
  // Read process image paths only. Do not inspect memory, send input, or kill a
  // process. Different FarmDogs installations, Wardogs and Steam are excluded.
  foreach(var process in discover())
  {
   if(process!=null&&process.pid>0&&process.pid!=Process.GetCurrentProcess().Id&&!processes.Any(item=>item.pid==process.pid)&&ManagedPath(plan.root,process.executablePath))processes.Add(process);
  }
  var clock=Stopwatch.StartNew();
  foreach(var item in processes)
  {
   if(item==null||item.pid<=0||item.pid==Process.GetCurrentProcess().Id||!ManagedPath(plan.root,item.executablePath))throw new InvalidOperationException("El plan contiene un proceso ajeno a FarmDogs.");
   int remaining=timeoutMs-(int)clock.ElapsedMilliseconds;if(remaining<=0)throw new InvalidOperationException("FarmDogs no terminó de cerrarse. No se modificó la aplicación.");
   wait(item,remaining);
  }
 }
 private static void WaitForOwnProcess(UpdateProcess item,int remaining)
 {
   Process process;try{process=Process.GetProcessById(item.pid);}catch(ArgumentException){return;}
   using(process)
   {
    try
    {
     if(process.HasExited)return;
     if(!String.Equals(process.MainModule.FileName,item.executablePath,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("La identidad de un proceso ha cambiado.");
     DateTime expected;
     if(item.startedAtUtc!=null&&(!DateTime.TryParse(item.startedAtUtc,null,System.Globalization.DateTimeStyles.RoundtripKind,out expected)||Math.Abs((process.StartTime.ToUniversalTime()-expected.ToUniversalTime()).TotalMilliseconds)>1000))throw new InvalidOperationException("Un PID de FarmDogs se ha reutilizado.");
     if(!process.WaitForExit(remaining))throw new InvalidOperationException("FarmDogs no terminó de cerrarse. No se modificó la aplicación.");
    }
    catch{if(process.HasExited)return;throw;}
   }
 }
 private static void AtomicCopy(string source,string target,string id)
 {
  NoReparse(target);Directory.CreateDirectory(Path.GetDirectoryName(target));string temporary=target+".farmdogs-new-"+id;
  if(File.Exists(temporary))throw new IOException("Ya existe un archivo temporal de actualización.");
  try{File.Copy(source,temporary,false);if(File.Exists(target))File.Replace(temporary,target,null);else File.Move(temporary,target);}finally{if(File.Exists(temporary))File.Delete(temporary);}
 }
 internal static void InstallFiles(UpdatePlan plan,VerifiedUpdate package,Action<int,string> beforeWrite)
 {
  ValidatePlan(plan,false);var old=InstalledPortable(plan.root,plan.version);
  var incoming=ParseManifest(package.ManifestText,plan.version);ValidateRuntimeFiles(package.Directory,incoming);package.Files=incoming.files;
  var touched=new List<SavedUpdateFile>();string backup=Path.Combine(plan.stage,"backup-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(backup);
  var newPaths=new HashSet<string>(package.Files.Select(item=>item.path),StringComparer.OrdinalIgnoreCase);newPaths.Add("manifest.json");
  var removed=new List<string>();foreach(var file in old.files)if(!newPaths.Contains(file.path))removed.Add(file.path);
  try
  {
   var ordered=package.Files.Select(item=>item.path).Concat(removed).Concat(new[]{"manifest.json"}).ToArray();int index=0;
   foreach(string relative in ordered)
   {
    string target=Resolve(plan.root,relative),saved=Resolve(backup,relative);bool exists=File.Exists(target);
    if(exists){Directory.CreateDirectory(Path.GetDirectoryName(saved));File.Copy(target,saved,false);}
    touched.Add(new SavedUpdateFile {Relative=relative,Backup=saved,Existed=exists});WriteJson(Path.Combine(plan.stage,"journal.json"),new {format="farmdogs-update-journal-v1",backup=backup,files=touched.Select(item=>new {path=item.Relative,existed=item.Existed}).ToArray()});
    if(beforeWrite!=null)beforeWrite(index++,relative);
    if(removed.Contains(relative)){if(exists)File.Delete(target);}else AtomicCopy(Resolve(package.Directory,relative),target,plan.id);
   }
  }
  catch(Exception error)
  {
   var rollbackErrors=new List<string>();
   for(int i=touched.Count-1;i>=0;i--){var item=touched[i];try{string target=Resolve(plan.root,item.Relative);if(item.Existed)AtomicCopy(item.Backup,target,plan.id);else if(File.Exists(target))File.Delete(target);}catch(Exception failed){rollbackErrors.Add(Safe(failed.Message));}}
   WriteJson(Path.Combine(plan.stage,"rollback.json"),new {restored=rollbackErrors.Count==0,errors=rollbackErrors.ToArray()});
   throw new IOException(rollbackErrors.Count==0?"La actualización falló y se restauró la versión anterior: "+error.Message:"La actualización necesita restauración manual desde la copia de seguridad.",error);
  }
 }
 private static void WriteJson(string file,object value){NoReparse(file);File.WriteAllText(file,Json.Serialize(value),new UTF8Encoding(false));}
 private static void Relaunch(string root){Process.Start(new ProcessStartInfo(Resolve(root,"FarmDogs.exe")){WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true});}
}
