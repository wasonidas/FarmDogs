using System;

internal static class AccountRefreshPolicyTests
{
    private static int count;
    private static readonly DateTime Start=new DateTime(2026,11,2,10,0,0,DateTimeKind.Utc);
    private static void Check(bool value,string reason){count++;if(!value)throw new Exception(reason);}
    public static int Main()
    {
        var normal=new AccountRefreshPolicy();Check(normal.TryBegin(Start,false),"First read denied.");normal.Success(Start.AddSeconds(1));
        Check(!normal.TryBegin(Start.AddSeconds(30),false),"Normal read sent early.");Check(normal.TryBegin(Start.AddSeconds(35),false),"Normal 30±5s cadence missed.");
        var active=new AccountRefreshPolicy();active.TryBegin(Start,false);active.Success(Start.AddSeconds(1));active.Request(false);
        Check(!active.TryBegin(Start.AddSeconds(4),false),"Tab refresh bypassed minimum interval.");Check(active.TryBegin(Start.AddSeconds(5),false),"Queued foreground refresh not consumed.");
        for(int i=0;i<50;i++)active.Request(false);Check(!active.TryBegin(Start.AddSeconds(6),false),"Repeated activation flooded reads.");Check(!active.TryBegin(Start.AddSeconds(10),true),"Pending/importing read duplicated.");Check(active.TryBegin(Start.AddSeconds(10),false),"Pending refresh was lost.");Check(!active.TryBegin(Start.AddSeconds(11),false),"Coalesced request ran twice.");
        foreach(int status in new[]{429,500,0})
        {
            var blocked=new AccountRefreshPolicy();blocked.TryBegin(Start,false);blocked.Failure(Start.AddSeconds(1),status);blocked.Request(false);blocked.Stop();blocked.Request(false);blocked.Request(true);
            int delay=status==429?120:30;Check(!blocked.TryBegin(Start.AddSeconds(delay),false),"Refresh bypassed error cooldown.");Check(blocked.TryBegin(Start.AddSeconds(delay+1),false),"Read did not resume after cooldown.");
        }
        var auth=new AccountRefreshPolicy();auth.TryBegin(Start,false);auth.Failure(Start.AddSeconds(1),401);auth.Request(false);Check(!auth.TryBegin(Start.AddSeconds(6),false),"Foreground bypassed 401.");auth.Request(true);Check(auth.TryBegin(Start.AddSeconds(6),false),"Steam return did not permit immediate fresh read.");
        var stopped=new AccountRefreshPolicy();stopped.TryBegin(Start,false);stopped.Success(Start.AddSeconds(1));stopped.Request(false);stopped.Stop();Check(!stopped.TryBegin(Start.AddSeconds(6),false),"Stop left an immediate refresh queued.");
        Console.WriteLine("Account refresh policy: "+count+" checks passed.");return 0;
    }
}
