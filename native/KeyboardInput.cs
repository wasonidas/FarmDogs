using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

namespace WardogsSeeding {
 public static class KeyboardInput {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct HARDWAREINPUT { public uint message; public ushort low, high; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mouse; [FieldOffset(0)] public KEYBDINPUT keyboard; [FieldOffset(0)] public HARDWAREINPUT hardware; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION data; }
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, INPUT[] input, int size);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint kind);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle, out uint pid);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool RegisterHotKey(IntPtr handle, int id, uint modifiers, uint key);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr handle, int id);
  static int held;
  static readonly object gate = new object();

  public static int InputSize { get { return Marshal.SizeOf(typeof(INPUT)); } }
  public static int ForegroundPid() {
   uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return (int)pid;
  }
  public static bool IsGame(int pid) {
   if (pid <= 0) return false;
   try { using (Process p = Process.GetProcessById(pid)) { return !p.HasExited && p.ProcessName == "WardogsClient-Win64-Shipping"; } } catch { return false; }
  }
  public static int FindGame() {
   Process[] found = Process.GetProcessesByName("WardogsClient-Win64-Shipping");
   try { return found.Length == 1 ? found[0].Id : 0; } finally { foreach (Process p in found) p.Dispose(); }
  }
  public static bool ForegroundIs(int pid) { return pid > 0 && ForegroundPid() == pid && IsGame(pid); }
  public static bool ModifiersDown() {
   return (GetAsyncKeyState(0x10) & 0x8000) != 0 || (GetAsyncKeyState(0x11) & 0x8000) != 0 || (GetAsyncKeyState(0x12) & 0x8000) != 0 || (GetAsyncKeyState(0x5B) & 0x8000) != 0 || (GetAsyncKeyState(0x5C) & 0x8000) != 0;
  }
  static void Send(int vk, bool up) {
   INPUT input = new INPUT(); input.type = 1;
   input.data.keyboard.scan = (ushort)MapVirtualKey((uint)vk, 0);
   input.data.keyboard.flags = 0x0008u | (up ? 0x0002u : 0u);
   if (SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT))) != 1) throw new InvalidOperationException("Windows no acepto la entrada (error " + Marshal.GetLastWin32Error() + ").");
  }
  public static void Release() {
   lock (gate) { if (held != 0) { int key = held; Send(key, true); held = 0; } }
  }
  public static async Task Hold(int pid, int vk, int milliseconds, CancellationToken cancel) {
   if (vk != 0x41 && vk != 0x44 && vk != 0x57 && vk != 0x53) throw new ArgumentException("Solo A/D/W/S.");
   if (milliseconds < 100 || milliseconds > 2000) throw new ArgumentException("Duracion de tecla fuera de rango.");
   if (!ForegroundIs(pid) || ModifiersDown()) throw new InvalidOperationException("Juego sin foco o modificador pulsado.");
   Stopwatch clock = Stopwatch.StartNew();
   try {
    cancel.ThrowIfCancellationRequested();
    lock (gate) { if (held != 0) throw new InvalidOperationException("Ya hay una tecla pulsada."); held = vk; Send(vk, false); }
    while (true) {
     cancel.ThrowIfCancellationRequested();
     if (!ForegroundIs(pid) || ModifiersDown()) throw new InvalidOperationException("Interrumpido por cambio de foco o teclado.");
     int delay = PulseTiming.NextDelay(milliseconds, clock.ElapsedMilliseconds);
     if (delay == 0) break;
     await Task.Delay(delay, cancel);
    }
   } finally { Release(); }
  }
 }
}
