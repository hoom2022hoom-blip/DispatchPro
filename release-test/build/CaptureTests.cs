using System;
using System.Text;
using System.Runtime.InteropServices;

class CaptureTests {
    static void Check(bool condition,string message) { if(!condition) throw new Exception(message); }
    static void U16(byte[] b,int i,int value) { b[i]=(byte)(value>>8); b[i+1]=(byte)value; }
    static byte[] Frame(byte[] payload,int options=0) {
        var b=new byte[14+20+options+8+payload.Length];
        for(int i=0;i<6;i++) b[i]=255;
        U16(b,12,0x0800); b[14]=(byte)(0x45+options/4); U16(b,16,b.Length-14);
        b[22]=64; b[23]=17;
        b[26]=192; b[27]=168; b[28]=0; b[29]=90;
        for(int i=30;i<34;i++) b[i]=255;
        int udp=34+options; U16(b,udp,3520); U16(b,udp+2,3520); U16(b,udp+4,8+payload.Length);
        Buffer.BlockCopy(payload,0,b,udp+8,payload.Length); return b;
    }
    static string Decode(byte[] b) { return NpcapCapture.Decode(b,(uint)b.Length,1700000000,123456,"Fixture Ethernet"); }
    static void Main() {
        Check(Marshal.SizeOf(typeof(NpcapCapture.Header))==16,"Windows pcap header ABI");
        Check(Marshal.SizeOf(typeof(NpcapCapture.Program))==16,"Windows x64 BPF ABI");
        Check(Marshal.OffsetOf(typeof(NpcapCapture.Device),"flags").ToInt32()==32,"Windows x64 interface ABI");
        byte[] payload={0,255,65,10,13,49,50,51};
        var frame=Frame(payload); string record=Decode(frame);
        Check(BitConverter.ToString(NpcapCapture.CompletePayload(frame))==BitConverter.ToString(payload),"Capture-to-parser payload preserved");
        foreach(string field in new[]{"Source IP: 192.168.0.90","Destination IP: 255.255.255.255","Source Port: 3520","Destination Port: 3520","Raw Payload HEX: 00 FF 41 0A 0D 31 32 33","invalid sequences replaced","Raw Payload ASCII","Raw Frame HEX:","Truncated/fragmented: False","Timestamp:"}) Check(record.Contains(field),field);
        Check(Decode(Frame(Encoding.UTF8.GetBytes("رقم"),4)).Contains("رقم"),"IPv4 options and Unicode");
        Check(Decode(Frame(new byte[0])).Contains("UDP Payload Length: 0 bytes"),"Empty payload");
        frame[29]=91; Check(Decode(frame)==null,"Reject unrelated source"); frame[29]=90;
        U16(frame,34,7); Check(Decode(frame)!=null,"Destination port alone matches");
        U16(frame,36,7); Check(Decode(frame)==null,"Reject unrelated ports");
        frame=Frame(payload); U16(frame,36,8); Check(Decode(frame)!=null,"Source port alone matches");
        frame=Frame(payload); U16(frame,20,1); Check(Decode(frame)==null,"Non-first fragment has no UDP header");
        frame=Frame(payload); U16(frame,20,0x2000); Check(Decode(frame).Contains("Truncated/fragmented: True"),"First fragment flagged");
        Check(NpcapCapture.CompletePayload(frame)==null,"Fragment cannot create caller event");
        frame=Frame(payload); Array.Resize(ref frame,frame.Length-2); Check(Decode(frame).Contains("Truncated/fragmented: True"),"Truncation visible");
        Check(NpcapCapture.CompletePayload(frame)==null,"Truncated capture cannot create caller event");
        frame=Frame(payload); var vlan=new byte[frame.Length+4]; Buffer.BlockCopy(frame,0,vlan,0,12); U16(vlan,12,0x8100); Buffer.BlockCopy(frame,12,vlan,16,frame.Length-12); Check(Decode(vlan)!=null,"VLAN decoder safe");
        for(int length=0;length<42;length++) Check(Decode(new byte[length])==null,"Short frame safe");
        var large=new byte[60000]; for(int i=0;i<large.Length;i++) large[i]=0xab;
        Check(Decode(Frame(large)).Contains("Raw Payload HEX: "+BitConverter.ToString(large).Replace('-',' ')),"Full payload not truncated");
        Console.WriteLine("PASS: broadcast Ethernet fixture, exact payload, ABI, filtering, options, Unicode, empty/large packets, fragmentation and truncation.");
    }
}
