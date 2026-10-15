using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public sealed class OfficeCallsProcessJob : IDisposable {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr CreateJobObject(IntPtr security,string name);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool SetInformationJobObject(IntPtr job,int kind,IntPtr info,uint length);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
 [StructLayout(LayoutKind.Sequential)]struct Basic {public long ProcessTime,JobTime;public uint Flags;public UIntPtr Min,Max;public uint Active;public UIntPtr Affinity;public uint Priority,Scheduling;}
 [StructLayout(LayoutKind.Sequential)]struct Io {public ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes;}
 [StructLayout(LayoutKind.Sequential)]struct Extended {public Basic Basic;public Io Io;public UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob;}
 private IntPtr handle;
 public OfficeCallsProcessJob(Process process) {
  handle=CreateJobObject(IntPtr.Zero,null);if(handle==IntPtr.Zero)throw new System.ComponentModel.Win32Exception();
  var value=new Extended();value.Basic.Flags=0x2000;
  var ptr=Marshal.AllocHGlobal(Marshal.SizeOf(value));
  try{Marshal.StructureToPtr(value,ptr,false);if(!SetInformationJobObject(handle,9,ptr,(uint)Marshal.SizeOf(value))||!AssignProcessToJobObject(handle,process.Handle))throw new System.ComponentModel.Win32Exception();}
  catch{Dispose();throw;}finally{Marshal.FreeHGlobal(ptr);}
 }
 public void Dispose(){if(handle!=IntPtr.Zero){CloseHandle(handle);handle=IntPtr.Zero;}GC.SuppressFinalize(this);}
 ~OfficeCallsProcessJob(){Dispose();}
}
