using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

// Read-only token metadata. No input, elevation, privilege adjustment or memory reads.
// SendInput is restricted to equal/lower integrity targets (UIPI):
// https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput
// Query rights and handle ownership:
// https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-openprocesstoken
// https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-gettokeninformation
internal sealed class InputIntegrityAssessment
{
    public string Status,Reason;
    public int? OwnRid,TargetRid;
    public long? GameStartedAtFileTimeUtc;
}
internal interface IInputIntegrityNative
{
    int CurrentProcessId {get;}
    IntPtr OpenQueryProcess(int pid);
    bool TryReadIdentity(IntPtr process,out int pid,out long createdAtFileTimeUtc);
    IntPtr OpenQueryToken(IntPtr process);
    int? ReadIntegrityRid(IntPtr token);
    void Close(IntPtr handle);
}
internal static class InputIntegrity
{
    internal static InputIntegrityAssessment Assess(int gamePid)
    {return Assess(gamePid,null,new InputIntegrityWindows());}
    internal static InputIntegrityAssessment Assess(int gamePid,long? expectedCreationFileTimeUtc)
    {return Assess(gamePid,expectedCreationFileTimeUtc,new InputIntegrityWindows());}
    internal static InputIntegrityAssessment Compare(int? ownRid,int? targetRid)
    {
        if(!ownRid.HasValue||!targetRid.HasValue||ownRid.Value<0||targetRid.Value<0)
            return Unknown("No se pudo comprobar el nivel de permisos; no se solicitará elevación.",ownRid,targetRid);
        bool higher=targetRid.Value>ownRid.Value;
        return new InputIntegrityAssessment{Status=higher?"requires_elevation":"compatible",OwnRid=ownRid,TargetRid=targetRid,
            Reason=higher?"Wardogs tiene un nivel de permisos superior al controlador. Reabre FarmDogs con el mismo nivel para enviar clics y teclas.":"No se detecta una diferencia de integridad que bloquee las entradas; esto no confirma que el juego las haya recibido."};
    }
    private static InputIntegrityAssessment Unknown(string reason,int? ownRid=null,int? targetRid=null)
    {return new InputIntegrityAssessment{Status="unknown",Reason=reason,OwnRid=ownRid,TargetRid=targetRid};}
    internal static InputIntegrityAssessment Assess(int gamePid,long? expectedCreationFileTimeUtc,IInputIntegrityNative native)
    {
        if(gamePid<=0||native==null||expectedCreationFileTimeUtc.HasValue&&expectedCreationFileTimeUtc.Value<=0)
            return Unknown("No hay una identidad de juego válida para comprobar permisos.");
        IntPtr ownProcess=IntPtr.Zero,targetProcess=IntPtr.Zero,ownToken=IntPtr.Zero,targetToken=IntPtr.Zero;
        int? ownRid=null,targetRid=null;
        try
        {
            int ownPid=native.CurrentProcessId;
            if(ownPid<=0)return Unknown("No se pudo identificar el controlador para comprobar permisos.");
            ownProcess=native.OpenQueryProcess(ownPid);targetProcess=native.OpenQueryProcess(gamePid);
            if(ownProcess==IntPtr.Zero||targetProcess==IntPtr.Zero)return Unknown("No se pudieron consultar los permisos del controlador y del juego; no se solicitará elevación.");
            int readOwnPid,readGamePid;long ownCreated,gameCreated;
            if(!native.TryReadIdentity(ownProcess,out readOwnPid,out ownCreated)||readOwnPid!=ownPid||ownCreated<=0||
                !native.TryReadIdentity(targetProcess,out readGamePid,out gameCreated)||readGamePid!=gamePid||gameCreated<=0||
                expectedCreationFileTimeUtc.HasValue&&expectedCreationFileTimeUtc.Value!=gameCreated)
                return Unknown("El juego se ha cerrado o su identidad ha cambiado; vuelve a iniciar la acción.");
            ownToken=native.OpenQueryToken(ownProcess);targetToken=native.OpenQueryToken(targetProcess);
            if(ownToken==IntPtr.Zero||targetToken==IntPtr.Zero)return Unknown("Windows no permitió consultar ambos niveles de integridad; no se solicitará elevación.");
            ownRid=native.ReadIntegrityRid(ownToken);targetRid=native.ReadIntegrityRid(targetToken);
            int finalOwnPid,finalGamePid;long finalOwnCreated,finalGameCreated;
            if(!native.TryReadIdentity(ownProcess,out finalOwnPid,out finalOwnCreated)||finalOwnPid!=ownPid||finalOwnCreated!=ownCreated||
                !native.TryReadIdentity(targetProcess,out finalGamePid,out finalGameCreated)||finalGamePid!=gamePid||finalGameCreated!=gameCreated)
                return Unknown("El juego se ha cerrado o su identidad ha cambiado durante la comprobación; no se solicitará elevación.");
            var assessment=Compare(ownRid,targetRid);assessment.GameStartedAtFileTimeUtc=gameCreated;return assessment;
        }
        catch{return Unknown("No se pudo completar la comprobación de permisos; no se solicitará elevación.");}
        finally
        {
            // Every owned handle is released on success, denial and exceptions.
            Close(native,targetToken);Close(native,ownToken);Close(native,targetProcess);Close(native,ownProcess);
        }
    }
    private static void Close(IInputIntegrityNative native,IntPtr handle)
    {if(handle!=IntPtr.Zero)try{native.Close(handle);}catch{}}
}
internal sealed class InputIntegrityWindows:IInputIntegrityNative
{
    private const uint QueryLimitedInformation=0x1000,TokenQuery=0x0008;
    private const int TokenIntegrityLevel=25,InsufficientBuffer=122;
    [StructLayout(LayoutKind.Sequential)] private struct NativeFileTime{internal uint Low,High;internal long Value{get{return ((long)High<<32)|Low;}}}
    [DllImport("kernel32.dll",SetLastError=true)] private static extern IntPtr OpenProcess(uint access,[MarshalAs(UnmanagedType.Bool)]bool inherit,int pid);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern uint GetProcessId(IntPtr process);
    [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool GetProcessTimes(IntPtr process,out NativeFileTime creation,out NativeFileTime exit,out NativeFileTime kernel,out NativeFileTime user);
    [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool GetExitCodeProcess(IntPtr process,out uint exitCode);
    [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
    [DllImport("advapi32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool GetTokenInformation(IntPtr token,int information,IntPtr buffer,int length,out int returnedLength);
    [DllImport("advapi32.dll")] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool IsValidSid(IntPtr sid);
    [DllImport("advapi32.dll")] private static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
    [DllImport("advapi32.dll")] private static extern IntPtr GetSidSubAuthority(IntPtr sid,uint index);
    [DllImport("advapi32.dll")] private static extern IntPtr GetSidIdentifierAuthority(IntPtr sid);
    public int CurrentProcessId{get{using(var process=Process.GetCurrentProcess())return process.Id;}}
    public IntPtr OpenQueryProcess(int pid){return OpenProcess(QueryLimitedInformation,false,pid);}
    public bool TryReadIdentity(IntPtr process,out int pid,out long createdAtFileTimeUtc)
    {
        pid=0;createdAtFileTimeUtc=0;uint exitCode;NativeFileTime creation,exit,kernel,user;
        uint found=GetProcessId(process);
        if(found==0||found>Int32.MaxValue||!GetExitCodeProcess(process,out exitCode)||exitCode!=259||!GetProcessTimes(process,out creation,out exit,out kernel,out user))return false;
        // Exit FILETIME is undefined for running processes; only creation is used.
        pid=(int)found;createdAtFileTimeUtc=creation.Value;return createdAtFileTimeUtc>0;
    }
    public IntPtr OpenQueryToken(IntPtr process){IntPtr token;return OpenProcessToken(process,TokenQuery,out token)?token:IntPtr.Zero;}
    public int? ReadIntegrityRid(IntPtr token)
    {
        int required;
        if(GetTokenInformation(token,TokenIntegrityLevel,IntPtr.Zero,0,out required)||Marshal.GetLastWin32Error()!=InsufficientBuffer||required<IntPtr.Size+4||required>65536)return null;
        IntPtr buffer=Marshal.AllocHGlobal(required);
        try
        {
            int written;if(!GetTokenInformation(token,TokenIntegrityLevel,buffer,required,out written)||written<IntPtr.Size+4||written>required)return null;
            IntPtr sid=Marshal.ReadIntPtr(buffer);
            // TOKEN_MANDATORY_LABEL contains an integrity SID S-1-16-RID.
            long start=buffer.ToInt64(),end=start+written,position=sid.ToInt64();
            if(position<start||position>end-12||!IsValidSid(sid))return null;
            IntPtr count=GetSidSubAuthorityCount(sid),authority=GetSidIdentifierAuthority(sid);
            if(count==IntPtr.Zero||authority==IntPtr.Zero||Marshal.ReadByte(count)!=1)return null;
            for(int i=0;i<6;i++)if(Marshal.ReadByte(authority,i)!=(i==5?16:0))return null;
            IntPtr ridPointer=GetSidSubAuthority(sid,0);if(ridPointer==IntPtr.Zero)return null;
            int rid=Marshal.ReadInt32(ridPointer);return rid<0?(int?)null:rid;
        }
        finally{Marshal.FreeHGlobal(buffer);}
    }
    public void Close(IntPtr handle){CloseHandle(handle);}
}
