using System;
using System.Net;
using System.IO;
using System.Threading.Tasks;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

public sealed class OfficeCallsUiReader {
    private readonly string url,token,pin;
    private volatile bool busy;
    private string result;
    private string pairResult;
    private volatile bool pairBusy;
    private readonly object gate = new object();
    public OfficeCallsUiReader(int port,string credential,string fingerprint) {
        url="https://127.0.0.1:"+port+"/history";token=credential;pin=fingerprint;
    }
    public void Poll() {
        if(busy)return;busy=true;
        Task.Run((Action)(() => {
            try {
                var req=(HttpWebRequest)WebRequest.Create(url);
                req.Proxy=null;req.AllowAutoRedirect=false;req.Timeout=1200;req.ReadWriteTimeout=1200;
                req.Headers["Authorization"]="Bearer "+token;
                req.ServerCertificateValidationCallback=(sender,cert,chain,error)=> {
                    using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(cert.GetRawCertData())).Replace("-","").ToLowerInvariant()==pin;
                };
                using(var response=req.GetResponse())using(var reader=new StreamReader(response.GetResponseStream())) {
                    var body=reader.ReadToEnd();lock(gate)result=body;
                }
            }catch {lock(gate)result="{\"error\":\"RECEIVER_UNAVAILABLE\"}";}
            finally {busy=false;}
        }));
    }
    public string Take() {lock(gate){var value=result;result=null;return value;}}
    public void BeginPair(string host) {
        if(pairBusy)return;pairBusy=true;
        Task.Run((Action)(()=> {
            try {
                var req=(HttpWebRequest)WebRequest.Create(url.Replace("/history","/pairing/start?host=")+Uri.EscapeDataString(host));
                req.Method="POST";req.ContentLength=0;req.Proxy=null;req.AllowAutoRedirect=false;req.Timeout=5000;req.ReadWriteTimeout=5000;
                req.Headers["Authorization"]="Bearer "+token;
                req.ServerCertificateValidationCallback=(sender,cert,chain,error)=>{using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(cert.GetRawCertData())).Replace("-","").ToLowerInvariant()==pin;};
                using(var response=req.GetResponse())using(var reader=new StreamReader(response.GetResponseStream())){lock(gate)pairResult=reader.ReadToEnd();}
            }catch {lock(gate)pairResult="{\"error\":\"PAIRING_UNAVAILABLE\"}";}
            finally{pairBusy=false;}
        }));
    }
    public string TakePair(){lock(gate){var value=pairResult;pairResult=null;return value;}}
}
