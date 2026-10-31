using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

// Cooperative close of this installation only. This file is written after the
// updater worker has started; it never closes a game, another root, or a PID.
internal static class AppShutdown
{
    private static object Value(Dictionary<string,object> data,string key){object value;return data!=null&&data.TryGetValue(key,out value)?value:null;}
    internal static bool SameRoot(string left,string right)
    {
        try
        {
            if(!Absolute(left)||!Absolute(right))return false;
            return String.Equals(Path.GetFullPath(left).Replace('/','\\').TrimEnd('\\'),Path.GetFullPath(right).Replace('/','\\').TrimEnd('\\'),StringComparison.OrdinalIgnoreCase);
        }
        catch{return false;}
    }
    private static bool Absolute(string value)
    {
        if(String.IsNullOrWhiteSpace(value))return false;
        var text=value.Replace('/','\\');return text.StartsWith("\\\\",StringComparison.Ordinal)||(text.Length>=3&&Char.IsLetter(text[0])&&text[1]==':'&&text[2]=='\\');
    }
    private static bool Utc(object text,out DateTime value)
    {
        var source=text as string;value=DateTime.MinValue;
        return source!=null&&source.EndsWith("Z",StringComparison.Ordinal)&&DateTime.TryParse(source,CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind,out value)&&value.Kind==DateTimeKind.Utc;
    }
    internal static bool ShouldClose(Dictionary<string,object> request,Dictionary<string,object> service,string root,DateTime now)
    {
        Guid id;DateTime issued,expires,serviceStarted;
        var pid=Value(request,"servicePid");var servicePid=Value(service,"pid");
        return Value(request,"format") as string=="farmdogs-app-shutdown-v1"&&Guid.TryParse(Value(request,"id") as string,out id)&&
            SameRoot(root,Value(request,"root") as string)&&pid is int&&(int)pid>0&&servicePid is int&&(int)pid==(int)servicePid&&
            Utc(Value(request,"issuedAt"),out issued)&&Utc(Value(request,"expiresAt"),out expires)&&Utc(Value(service,"startedAt"),out serviceStarted)&&serviceStarted<=issued&&issued<=now&&now<expires&&expires>issued&&(expires-issued).TotalMilliseconds<=5000;
    }
    private static Dictionary<string,object> Read(string file)
    {
        using(var stream=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete))
        {
            if(stream.Length>8192)return null;
            using(var input=new StreamReader(stream,Encoding.UTF8))return new JavaScriptSerializer{MaxJsonLength=8192}.DeserializeObject(input.ReadToEnd()) as Dictionary<string,object>;
        }
    }
    internal static bool Requested(string root,string dataDir,DateTime now)
    {
        try{return ShouldClose(Read(Path.Combine(dataDir,"app-shutdown.json")),Read(Path.Combine(dataDir,"service.json")),root,now);}
        catch{return false;}
    }
}
