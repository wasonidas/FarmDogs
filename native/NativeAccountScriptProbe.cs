using System;
using System.Text;

// TEST ONLY: emits the production script. It has no WebView, native input,
// account profile or network execution path.
internal static class NativeAccountScriptProbe
{
    public static int Main(string[] args)
    {
        Guid id;
        if(args.Length!=1||!Guid.TryParseExact(args[0],"D",out id))return 2;
        Console.OutputEncoding=new UTF8Encoding(false);
        Console.Write(AccountReadScript.Build(args[0]));
        return 0;
    }
}
