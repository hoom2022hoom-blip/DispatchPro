using System.Text.Json;
namespace DispatchPro.Tests;
internal static class LocalLatency{
 private static readonly object Gate=new();
 public static void Record(string name,double milliseconds){
  var path=Environment.GetEnvironmentVariable("DISPATCH_TEST_LATENCY_REPORT");if(string.IsNullOrEmpty(path))return;
  lock(Gate){var rows=File.Exists(path)?JsonSerializer.Deserialize<Dictionary<string,double>>(File.ReadAllText(path))!:new Dictionary<string,double>();rows[name]=Math.Round(milliseconds,2);File.WriteAllText(path,JsonSerializer.Serialize(rows,new JsonSerializerOptions{WriteIndented=true}));}
 }
}
