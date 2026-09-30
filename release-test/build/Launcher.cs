using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using System.Drawing;
using System.Threading;

class Launcher : Form {
    Process child;
    NpcapCapture capture;
    readonly object rawLock = new object();
    readonly object inputLock = new object();
    Label callerLabel = new Label { Text = "Caller Number: waiting...", Dock = DockStyle.Top, Height = 75, Font = new Font("Segoe UI", 16, FontStyle.Bold) };
    System.Text.StringBuilder udpRecord;
    TextBox log = new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Both, WordWrap = false, MaxLength = int.MaxValue, Dock = DockStyle.Fill, Font = new Font("Consolas", 10) };
    bool closing;
    string root = AppDomain.CurrentDomain.BaseDirectory;
    Launcher() {
        Text = "DispatchPro - LANDLINE ICALL DEBUG - Ethernet + UDP"; Width = 1100; Height = 700;
        Controls.Add(log);
        Controls.Add(callerLabel);
        var label = new Label { Text = "NPCAP Ethernet: source 192.168.0.90, UDP port 3520 | UDP fallback: all sources\r\nRaw packets saved to icall-raw.log beside EXE | Look for CAPTURE READY, then ring one landline.", Dock = DockStyle.Top, Height = 48 };
        Controls.Add(label);
        Shown += Start;
        FormClosing += (s,e) => { closing = true; if(capture!=null) capture.Stop(); if(child != null) { try { if(!child.HasExited) { child.Kill(); child.WaitForExit(3000); } } catch {} child.Dispose(); } };
    }
    void Append(string value) { if (value == null || closing) return; try { BeginInvoke((Action)(() => { log.AppendText(value.Replace("\r\n","\n").Replace("\n",Environment.NewLine) + Environment.NewLine); try { File.AppendAllText(Path.Combine(root,"data","launcher.log"), value + Environment.NewLine); } catch {} })); } catch(InvalidOperationException) {} }
    void Raw(string value) {
        lock(rawLock) {
            try { File.AppendAllText(Path.Combine(root,"icall-raw.log"),value+Environment.NewLine,System.Text.Encoding.UTF8); }
            catch(Exception ex) { Append("RAW LOG WRITE FAILED: "+ex.Message); }
            Append(value);
        }
    }
    void Start(object sender, EventArgs args) {
        try {
            Directory.CreateDirectory(Path.Combine(root,"data"));
            Raw("DEBUG SESSION "+DateTime.UtcNow.ToString("o")+" | Ethernet capture + UDP fallback");
            var info = new ProcessStartInfo(Path.Combine(root,"runtime","node.exe"), "\"" + Path.Combine(root,"app","icall-debug.mjs") + "\"");
            info.WorkingDirectory = root; info.UseShellExecute = false; info.CreateNoWindow = true;
            info.RedirectStandardOutput = true; info.RedirectStandardError = true;
            info.RedirectStandardInput = true;
            info.StandardOutputEncoding = System.Text.Encoding.UTF8; info.StandardErrorEncoding = System.Text.Encoding.UTF8;
            info.EnvironmentVariables["DISPATCHPRO_LOCAL_DATA_DIR"] = Path.Combine(root,"data");
            info.EnvironmentVariables.Remove("DISPATCHPRO_CALL_TOKEN");
            info.EnvironmentVariables.Remove("NODE_OPTIONS");
            info.EnvironmentVariables["DISPATCHPRO_LAUNCHER_PID"] = Process.GetCurrentProcess().Id.ToString();
            info.EnvironmentVariables["DISPATCHPRO_RAW_LOG_OWNER"] = "launcher";
            child = new Process { StartInfo = info, EnableRaisingEvents = true };
            child.OutputDataReceived += (s,e) => {
                if(e.Data==null) return;
                if(e.Data.StartsWith("CALLER\t")) {
                    string[] fields=e.Data.Split('\t');
                    if(fields.Length==4) {
                        string display="Caller Number: "+fields[1]+"\r\nTimestamp: "+fields[2]+" | Source IP: "+fields[3];
                        Raw(display);
                        if(!closing) { try { BeginInvoke((Action)(()=>callerLabel.Text=display)); } catch(InvalidOperationException) {} }
                    }
                    return;
                }
                if(e.Data=="========== UDP PACKET ==========") udpRecord=new System.Text.StringBuilder();
                if(udpRecord!=null) {
                    udpRecord.AppendLine(e.Data);
                    if(e.Data=="========== END PACKET ==========") { Raw(udpRecord.ToString()); udpRecord=null; }
                } else Append(e.Data);
            };
            child.ErrorDataReceived += (s,e) => Append(e.Data);
            child.Exited += (s,e) => Append("Receiver stopped. Check messages above. Close this window before restarting.");
            child.Start(); child.BeginOutputReadLine(); child.BeginErrorReadLine();
            capture=new NpcapCapture(Append,Raw,(payload,source,timestamp)=> {
                lock(inputLock) {
                    try { child.StandardInput.WriteLine("{\"hex\":\""+BitConverter.ToString(payload).Replace("-","")+"\",\"sourceIp\":\""+source+"\",\"timestamp\":\""+timestamp+"\"}"); child.StandardInput.Flush(); }
                    catch(Exception ex) { Append("CALLER PIPE ERROR: "+ex.Message); }
                }
            });
            capture.Start();
        } catch(Exception ex) { Append(ex.Message); }
    }
    [STAThread] static void Main() {
        bool created;
        using(var mutex = new Mutex(true,"Local\\DispatchProIcallReleaseTest",out created)) {
            if(!created) { MessageBox.Show("The test receiver is already running."); return; }
            Application.EnableVisualStyles(); Application.Run(new Launcher());
        }
    }
}
