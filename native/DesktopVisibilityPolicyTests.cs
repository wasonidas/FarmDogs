using System;

internal static class DesktopVisibilityPolicyTests {
 static int checks;
 static void Check(bool condition,string text){checks++;if(!condition)throw new Exception(text);}
 public static int Main(){
  try{
   var policy=new DesktopVisibilityPolicy();bool current;
   Check(policy.Change(true,false,false,out current)&&current,"A normal visible host is active.");
   Check(!policy.Change(true,false,false,out current),"A resize without visibility change sends no duplicate.");
   Check(policy.Change(true,true,false,out current)&&!current,"Minimized host is inactive even if Form.Visible remains true.");
   Check(!policy.Change(true,true,false,out current),"Repeated minimized callbacks send no duplicate.");
   Check(!policy.Change(false,true,false,out current),"Hide while already minimized remains one inactive state.");
   Check(policy.Change(true,false,false,out current)&&current,"Restoring wakes the page immediately.");
   Check(policy.Change(false,false,false,out current)&&!current,"A hidden non-minimized host is inactive.");
   Check(policy.Change(false,false,true,out current)&&!current,"A fresh ready document receives the current hidden state.");
   Check(policy.Change(true,false,true,out current)&&current,"A fresh visible document receives its current state.");
   Check(!policy.Change(true,false,false,out current),"The forced handshake does not create recurring updates.");
   Console.WriteLine("Desktop visibility: "+checks+" checks passed; no windows or game opened.");return 0;
  }catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
 }
}
