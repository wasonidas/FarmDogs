using System;
using System.Collections.Generic;
using System.Linq;

internal static class InputIntegrityTests
{
    private static int checks;
    private static void Check(bool condition,string description){if(!condition)throw new Exception(description);checks++;}
    private sealed class FakeNative:IInputIntegrityNative
    {
        internal int? OwnRid=0x2000,TargetRid=0x3000;
        internal bool OwnDenied,GameDenied,OwnTokenDenied,GameTokenDenied,ThrowOnTargetOpen,ThrowOnToken,ThrowOnRead,ThrowOnClose,ClosedBefore,ClosedAfter,WrongPid,ChangedCreation;
        internal int Opens,TokenOpens,Reads,GameIdentityReads;
        internal List<IntPtr> Opened=new List<IntPtr>(),Closed=new List<IntPtr>();
        public int CurrentProcessId{get{return 10;}}
        public IntPtr OpenQueryProcess(int pid)
        {
            Opens++;if(pid==20&&ThrowOnTargetOpen)throw new Exception("synthetic open failure");
            if(pid==10&&OwnDenied||pid==20&&GameDenied)return IntPtr.Zero;
            IntPtr handle=new IntPtr(pid);Opened.Add(handle);return handle;
        }
        public bool TryReadIdentity(IntPtr process,out int pid,out long created)
        {
            pid=process.ToInt32();created=pid==10?100:200;
            if(pid==20){GameIdentityReads++;if(WrongPid)pid=21;if(ChangedCreation&&GameIdentityReads>1)created=201;if(ClosedBefore||ClosedAfter&&GameIdentityReads>1)return false;}
            return true;
        }
        public IntPtr OpenQueryToken(IntPtr process)
        {
            TokenOpens++;if(ThrowOnToken&&process.ToInt32()==20)throw new Exception("synthetic token failure");
            if(process.ToInt32()==10&&OwnTokenDenied||process.ToInt32()==20&&GameTokenDenied)return IntPtr.Zero;
            IntPtr handle=new IntPtr(process.ToInt32()+100);Opened.Add(handle);return handle;
        }
        public int? ReadIntegrityRid(IntPtr token){Reads++;if(ThrowOnRead)throw new Exception("synthetic read failure");return token.ToInt32()==110?OwnRid:TargetRid;}
        public void Close(IntPtr handle){Closed.Add(handle);if(ThrowOnClose)throw new Exception("synthetic close failure");}
        internal void AllClosed(){Check(Opened.Count==Closed.Count&&Opened.All(h=>Closed.Count(c=>c==h)==1),"An owned process/token handle was leaked or closed twice.");}
    }
    private static InputIntegrityAssessment Run(FakeNative native,long? expected=null)
    {var result=InputIntegrity.Assess(20,expected,native);native.AllClosed();return result;}
    public static int Main()
    {
        try
        {
            foreach(var pair in new[]{new[]{0x2000,0x3000},new[]{0,0x1000},new[]{0x3000,0x4000}})
            {var result=InputIntegrity.Compare(pair[0],pair[1]);Check(result.Status=="requires_elevation","A verified higher target was not diagnosed.");Check(result.OwnRid==pair[0]&&result.TargetRid==pair[1],"Observed RIDs were not preserved.");}
            foreach(var pair in new[]{new[]{0x2000,0x2000},new[]{0x3000,0x2000},new[]{0,0},new[]{0x4000,0x3000}})
                Check(InputIntegrity.Compare(pair[0],pair[1]).Status=="compatible","Equal/lower integrity incorrectly requested elevation.");
            Check(InputIntegrity.Compare(null,0x3000).Status=="unknown","Unknown sender requested elevation.");
            Check(InputIntegrity.Compare(0x2000,null).Status=="unknown","Unknown target requested elevation.");
            Check(InputIntegrity.Compare(-1,0x3000).Status=="unknown","Invalid sender RID requested elevation.");
            Check(InputIntegrity.Compare(0x2000,-1).Status=="unknown","Invalid target RID requested elevation.");
            Check(InputIntegrity.Compare(0x2000,0x2000).Reason.Contains("no confirma"),"Compatible was stated as proof of accepted game input.");
            var native=new FakeNative();var good=Run(native,200);
            Check(good.Status=="requires_elevation"&&good.GameStartedAtFileTimeUtc==200,"Successful assessment lost target identity.");
            Check(native.TokenOpens==2&&native.Reads==2&&native.GameIdentityReads==2,"Both tokens and before/after identity were not checked.");
            native=new FakeNative{TargetRid=0x2000};Check(Run(native).Status=="compatible","Native equal-integrity path requested elevation.");
            foreach(var fake in new[]{new FakeNative{OwnDenied=true},new FakeNative{GameDenied=true},new FakeNative{OwnTokenDenied=true},new FakeNative{GameTokenDenied=true},new FakeNative{ThrowOnTargetOpen=true},new FakeNative{ThrowOnToken=true},new FakeNative{ThrowOnRead=true},new FakeNative{ClosedBefore=true},new FakeNative{ClosedAfter=true},new FakeNative{WrongPid=true},new FakeNative{ChangedCreation=true},new FakeNative{OwnRid=null},new FakeNative{TargetRid=null}})
                Check(Run(fake).Status=="unknown","Failure or changed process identity inferred elevation.");
            native=new FakeNative();Check(Run(native,201).Status=="unknown"&&native.TokenOpens==0,"Reused/mismatched PID creation time reached token assessment.");
            native=new FakeNative{ThrowOnClose=true};Check(Run(native).Status=="requires_elevation","Cleanup exceptions skipped the remaining handles or changed diagnosis.");
            native=new FakeNative();Check(InputIntegrity.Assess(0,null,native).Status=="unknown"&&native.Opens==0,"Invalid PID queried a process.");
            Check(InputIntegrity.Assess(-1,null,native).Status=="unknown"&&native.Opens==0,"Negative PID queried a process.");
            Check(InputIntegrity.Assess(20,0,native).Status=="unknown"&&native.Opens==0,"Invalid expected creation time queried a process.");
            Check(InputIntegrity.Assess(20,null,null).Status=="unknown","Null platform did not fail closed.");
            Console.WriteLine(checks+" input integrity checks passed; fake process/token metadata only, no game, input, UAC or privilege changes.");return 0;
        }
        catch(Exception error){Console.Error.WriteLine(error);return 1;}
    }
}
