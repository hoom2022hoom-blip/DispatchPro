using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using System.Collections.Generic;

// Windows x64 Npcap ABI: timeval uses two 32-bit longs, even on x64.
class NpcapCapture {
    [StructLayout(LayoutKind.Sequential)] internal struct Device { public IntPtr next, name, description, addresses; public uint flags; }
    [StructLayout(LayoutKind.Sequential)] internal struct Header { public int seconds, microseconds; public uint captured, original; }
    [StructLayout(LayoutKind.Sequential)] internal struct Program { public uint length; public IntPtr instructions; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool SetDllDirectory(string path);
    [DllImport("wpcap.dll", CallingConvention=CallingConvention.Cdecl)] static extern int pcap_findalldevs(out IntPtr devices, StringBuilder error);
    [DllImport("wpcap.dll", CallingConvention=CallingConvention.Cdecl)] static extern void pcap_freealldevs(IntPtr devices);
    [DllImport("wpcap.dll", CallingConvention=CallingConvention.Cdecl, CharSet=CharSet.Ansi)] static extern IntPtr pcap_open_live(string device, int snaplen, int promisc, int timeout, StringBuilder error);
    [DllImport("wpcap.dll", CallingConvention=CallingConvention.Cdecl)] static extern int pcap_datalink(IntPtr handle);
    [DllImport("wpcap.dll", CallingConvention=CallingConvention.Cdecl, CharSet=CharSet.Ansi)] static extern int pcap_compile(IntPtr handle, out Program program, string filter, int optimize, uint mask);
    [DllImport("wpcap.dll", CallingConvention=CallingConvention.Cdecl)] static extern int pcap_setfilter(IntPtr handle, ref Program program);
    [DllImport("wpcap.dll", CallingConvention=CallingConvention.Cdecl)] static extern void pcap_freecode(ref Program program);
    [DllImport("wpcap.dll", CallingConvention=CallingConvention.Cdecl)] static extern int pcap_setnonblock(IntPtr handle, int enabled, StringBuilder error);
    [DllImport("wpcap.dll", CallingConvention=CallingConvention.Cdecl)] static extern int pcap_next_ex(IntPtr handle, out IntPtr header, out IntPtr bytes);
    [DllImport("wpcap.dll", CallingConvention=CallingConvention.Cdecl)] static extern IntPtr pcap_geterr(IntPtr handle);
    [DllImport("wpcap.dll", CallingConvention=CallingConvention.Cdecl)] static extern void pcap_close(IntPtr handle);
    const string Filter = "udp port 3520 and src host 192.168.0.90";
    readonly Action<string> status, packet;
    readonly Action<byte[],string,string> caller;
    readonly List<Thread> workers = new List<Thread>();
    volatile bool stopping;
    Thread coordinator;
    public NpcapCapture(Action<string> status, Action<string> packet, Action<byte[],string,string> caller=null) { this.status=status; this.packet=packet; this.caller=caller; }
    public void Start() { coordinator=new Thread(Run); coordinator.IsBackground=true; coordinator.Start(); }
    public void Stop() { stopping=true; if(coordinator!=null) coordinator.Join(1000); lock(workers) { foreach(var thread in workers) thread.Join(1000); } }
    void Run() {
        IntPtr devices=IntPtr.Zero;
        try {
            string directory=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"Npcap");
            if(!File.Exists(Path.Combine(directory,"wpcap.dll"))) {
                status("CAPTURE UNAVAILABLE: Install Npcap from https://npcap.com/ then restart. UDP fallback remains active."); return;
            }
            if(!SetDllDirectory(directory)) throw new InvalidOperationException("Cannot select the system Npcap DLL directory.");
            var error=new StringBuilder(256);
            if(pcap_findalldevs(out devices,error)!=0) throw new InvalidOperationException(error.ToString());
            int count=0;
            for(IntPtr current=devices;current!=IntPtr.Zero && !stopping;) {
                var device=(Device)Marshal.PtrToStructure(current,typeof(Device));
                current=device.next;
                string name=Marshal.PtrToStringAnsi(device.name);
                string description=Marshal.PtrToStringAnsi(device.description) ?? name;
                if((device.flags & 1)!=0 || name==null || name.IndexOf("Loopback",StringComparison.OrdinalIgnoreCase)>=0) continue;
                var thread=new Thread(()=>Capture(name,description)); thread.IsBackground=true;
                lock(workers) workers.Add(thread);
                thread.Start(); count++;
            }
            if(count==0) status("CAPTURE UNAVAILABLE: Npcap found no non-loopback adapters. UDP fallback remains active.");
        } catch(Exception ex) { status("CAPTURE ERROR: "+ex.Message+" | Check Npcap installation; if access is restricted, run this EXE as administrator. UDP fallback remains active."); }
        finally { if(devices!=IntPtr.Zero) pcap_freealldevs(devices); }
    }
    void Capture(string name,string description) {
        IntPtr handle=IntPtr.Zero;
        try {
            var error=new StringBuilder(256);
            // Passive capture: do not enable promiscuous mode or modify interface configuration.
            handle=pcap_open_live(name,262144,0,100,error);
            if(handle==IntPtr.Zero) throw new InvalidOperationException(error.ToString());
            if(error.Length>0) status("CAPTURE WARNING ["+description+"]: "+error);
            if(pcap_datalink(handle)!=1) { status("CAPTURE SKIPPED (not Ethernet link type): "+description); return; }
            Program program;
            if(pcap_compile(handle,out program,Filter,1,0xffffffff)!=0) throw new InvalidOperationException(Marshal.PtrToStringAnsi(pcap_geterr(handle)));
            try { if(pcap_setfilter(handle,ref program)!=0) throw new InvalidOperationException(Marshal.PtrToStringAnsi(pcap_geterr(handle))); }
            finally { pcap_freecode(ref program); }
            if(pcap_setnonblock(handle,1,error)!=0) throw new InvalidOperationException(error.ToString());
            status("CAPTURE READY ["+description+"] "+name+" | "+Filter+" | passive Ethernet capture; no IP/network changes");
            while(!stopping) {
                IntPtr headerPointer, data;
                int result=pcap_next_ex(handle,out headerPointer,out data);
                if(result==0) { Thread.Sleep(20); continue; }
                if(result<0) throw new InvalidOperationException(Marshal.PtrToStringAnsi(pcap_geterr(handle)));
                var header=(Header)Marshal.PtrToStructure(headerPointer,typeof(Header));
                if(header.captured>262144) throw new InvalidOperationException("Unexpected capture length");
                var bytes=new byte[(int)header.captured]; Marshal.Copy(data,bytes,0,bytes.Length);
                string record=Decode(bytes,header.original,header.seconds,header.microseconds,description+" | "+name);
                if(record!=null) {
                    packet(record);
                    byte[] payload=CompletePayload(bytes);
                    if(payload!=null && caller!=null) caller(payload,"192.168.0.90",new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc).AddSeconds(header.seconds).AddTicks((long)header.microseconds*10).ToString("o"));
                }
            }
        } catch(Exception ex) { status("CAPTURE ERROR ["+description+"]: "+ex.Message+" | Npcap may require Run as administrator. UDP fallback is independent."); }
        finally { if(handle!=IntPtr.Zero) pcap_close(handle); }
    }
    static int U16(byte[] bytes,int offset) { return (bytes[offset]<<8)|bytes[offset+1]; }
    internal static byte[] CompletePayload(byte[] frame) {
        if(frame.Length<14) return null;
        int ip=14,type=U16(frame,12);
        while(type==0x8100 || type==0x88a8) { if(frame.Length<ip+4) return null; type=U16(frame,ip+2); ip+=4; }
        if(type!=0x0800 || frame.Length<ip+20 || (frame[ip]>>4)!=4 || frame[ip+9]!=17) return null;
        int length=(frame[ip]&15)*4,total=U16(frame,ip+2);
        if(length<20 || total<length+8 || (U16(frame,ip+6)&0x3fff)!=0 || frame.Length<ip+total) return null;
        int udp=ip+length, udpLength=U16(frame,udp+4);
        if(udpLength<8 || udpLength>total-length) return null;
        var payload=new byte[udpLength-8]; Buffer.BlockCopy(frame,udp+8,payload,0,payload.Length); return payload;
    }
    static string Ip(byte[] bytes,int offset) { return bytes[offset]+"."+bytes[offset+1]+"."+bytes[offset+2]+"."+bytes[offset+3]; }
    static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace('-',' '); }
    static string Escape(string value) {
        var text=new StringBuilder();
        foreach(char ch in value) {
            if(ch=='\\') text.Append("\\\\"); else if(ch=='\"') text.Append("\\\"");
            else if(char.IsControl(ch)) text.Append("\\u"+((int)ch).ToString("x4")); else text.Append(ch);
        }
        return text.ToString();
    }
    internal static string Decode(byte[] frame,uint original,int seconds,int microseconds,string adapter) {
        if(frame.Length<14) return null;
        int ip=14, type=U16(frame,12);
        while(type==0x8100 || type==0x88a8) { if(frame.Length<ip+4) return null; type=U16(frame,ip+2); ip+=4; }
        if(type!=0x0800 || frame.Length<ip+20 || (frame[ip]>>4)!=4 || frame[ip+9]!=17) return null;
        int headerLength=(frame[ip]&15)*4, total=U16(frame,ip+2), fragments=U16(frame,ip+6);
        if(headerLength<20 || total<headerLength+8 || (fragments&0x1fff)!=0 || frame.Length<ip+headerLength+8) return null;
        string source=Ip(frame,ip+12), destination=Ip(frame,ip+16);
        int udp=ip+headerLength, sourcePort=U16(frame,udp), destinationPort=U16(frame,udp+2), udpLength=U16(frame,udp+4);
        if(source!="192.168.0.90" || (sourcePort!=3520 && destinationPort!=3520) || udpLength<8) return null;
        int available=Math.Max(0,Math.Min(frame.Length,ip+total)-(udp+8));
        var payload=new byte[Math.Min(available,udpLength-8)]; Buffer.BlockCopy(frame,udp+8,payload,0,payload.Length);
        bool valid=true; try { new UTF8Encoding(false,true).GetString(payload); } catch(DecoderFallbackException) { valid=false; }
        var ascii=new StringBuilder(); foreach(byte b in payload) { if(b>=32 && b<=126) ascii.Append((char)b); else ascii.Append("\\x"+b.ToString("x2")); }
        DateTime timestamp=new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc).AddSeconds(seconds).AddTicks((long)microseconds*10);
        return "========== NPCAP ETHERNET PACKET ==========\nAdapter: "+adapter+
            "\nTimestamp: "+timestamp.ToString("o")+"\nSource IP: "+source+"\nDestination IP: "+destination+
            "\nSource Port: "+sourcePort+"\nDestination Port: "+destinationPort+
            "\nPacket Length (wire frame): "+original+" bytes\nCaptured Frame Length: "+frame.Length+
            " bytes\nUDP Payload Length: "+payload.Length+" bytes (declared "+(udpLength-8)+")"+
            "\nTruncated/fragmented: "+(original>frame.Length || payload.Length<udpLength-8 || (fragments&0x2000)!=0)+
            "\nRaw Frame HEX: "+Hex(frame)+"\nRaw Payload HEX: "+Hex(payload)+
            "\nRaw Payload UTF-8 ("+(valid?"valid":"invalid sequences replaced; HEX is exact")+"): \""+Escape(Encoding.UTF8.GetString(payload))+"\""+
            "\nRaw Payload ASCII (non-printable/high bytes escaped): "+ascii+"\n========== END PACKET ==========\n";
    }
}
