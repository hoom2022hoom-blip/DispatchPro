using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using DispatchPro.Api.Services;
namespace DispatchPro.Tests;
// Isolated test transport only: never registered by production Program.
public sealed class TestCustomerSms : ICustomerSmsSender{
 public static readonly ConcurrentDictionary<Guid,string> Codes=new();
 public bool Enabled=>true;
 public Task Send(Guid tenant,string phone,string code,Guid challenge,CancellationToken ct){Codes[challenge]=code;return Task.CompletedTask;}
}
public static class CustomerOtpTestSupport{
 private static readonly ConcurrentDictionary<Guid,bool> Registered=new();
 public static async Task<HttpResponseMessage> VerifiedRegistration(this HttpClient client,object input){
  var payload=System.Text.Json.JsonSerializer.SerializeToNode(input)!.AsObject();
  var account=payload["accountId"]!.GetValue<Guid>();
  if(Registered.ContainsKey(account))return await client.PostAsJsonAsync("/api/v1/customer-app/register",payload);
  var phone=CustomerPhone.Local(payload["phone"]!.GetValue<string>());
  var challenge=await client.PostAsJsonAsync("/api/v1/customer-app/otp/request",new{tenant=payload["tenant"]!.GetValue<string>(),phone,accountId=payload["accountId"]!.GetValue<Guid>()});challenge.EnsureSuccessStatusCode();
  var id=JsonNode.Parse(await challenge.Content.ReadAsStringAsync())!["challengeId"]!.GetValue<Guid>();
  var result=await client.PostAsJsonAsync("/api/v1/customer-app/otp/verify",new{tenant=payload["tenant"]!.GetValue<string>(),accountId=payload["accountId"]!.GetValue<Guid>(),challengeId=id,code=TestCustomerSms.Codes[id]});result.EnsureSuccessStatusCode();
  payload["verificationProof"]=JsonNode.Parse(await result.Content.ReadAsStringAsync())!["verificationProof"]!.GetValue<string>();
  var registered=await client.PostAsJsonAsync("/api/v1/customer-app/register",payload);if(registered.IsSuccessStatusCode)Registered[account]=true;return registered;
 }
}
