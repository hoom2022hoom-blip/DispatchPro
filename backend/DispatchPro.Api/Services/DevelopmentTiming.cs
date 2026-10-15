namespace DispatchPro.Api.Services;
// Request-local, development-only marks. No identities, coordinates, text or credentials.
public sealed class DevelopmentTiming{
 private readonly System.Diagnostics.Stopwatch clock=System.Diagnostics.Stopwatch.StartNew();
 private readonly Dictionary<string,double> marks=new();
 public bool Enabled {get;set;}
 public void Mark(string stage){if(Enabled)marks[stage]=clock.Elapsed.TotalMilliseconds;}
 public string Header()=>string.Join(",",marks.Select(m=>m.Key+";dur="+m.Value.ToString("F2",System.Globalization.CultureInfo.InvariantCulture)));
}
