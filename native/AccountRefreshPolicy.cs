using System;

// Host-clock scheduling only. Requests never supply account data or extend its freshness.
internal sealed class AccountRefreshPolicy
{
    private DateTime nextNormal=DateTime.MinValue,blockedUntil=DateTime.MinValue,lastStarted=DateTime.MinValue;
    private int blockedStatus;
    private bool requested;
    public void Request(bool returningFromSteam)
    {
        requested=true;
        // Only a real return through the Steam sign-in navigation may retry a
        // previous 401 early. A server/rate-limit failure always keeps its delay.
        if(returningFromSteam&&blockedStatus==401){blockedUntil=DateTime.MinValue;blockedStatus=0;}
    }
    public bool TryBegin(DateTime now,bool occupied)
    {
        if(occupied||now<blockedUntil||now<lastStarted.AddSeconds(5)||(!requested&&now<nextNormal))return false;
        requested=false;lastStarted=now;return true;
    }
    public void Success(DateTime now)
    {
        nextNormal=now.AddSeconds(30);blockedUntil=DateTime.MinValue;blockedStatus=0;
    }
    public void Failure(DateTime now,int status)
    {
        blockedStatus=status;blockedUntil=now.AddSeconds(status==429?120:30);nextNormal=blockedUntil;
    }
    public void Stop(){requested=false;}
}
