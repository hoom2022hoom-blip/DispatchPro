using System.Net;
using System.Text.Json;
using DispatchPro.Api.Services;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace DispatchPro.Tests;
public sealed class CustomerSmsAdapterTests
{
    private sealed class Capture : HttpMessageHandler
    {
        public int Calls; public string? Body, Authentication; public Uri? Uri;
        public HttpStatusCode Status=HttpStatusCode.Created;
        public string Payload="{\"sid\":\"SM11111111111111111111111111111111\",\"status\":\"queued\"}";
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
        {
            Calls++;Uri=request.RequestUri;Authentication=request.Headers.Authorization?.Scheme;
            Body=await request.Content!.ReadAsStringAsync(ct);
            return new HttpResponseMessage(Status){Content=new StringContent(Payload)};
        }
    }
    private static IConfiguration Config(bool enabled=true) => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> {
        ["CustomerSms:Enabled"]=enabled.ToString(),["CustomerSms:Provider"]="Twilio",
        ["CustomerSms:Twilio:AccountSid"]="AC11111111111111111111111111111111",
        ["CustomerSms:Twilio:AuthToken"]="test-only-secret",["CustomerSms:Twilio:From"]="NMTAXI"
    }).Build();
    [Theory]
    [InlineData("0591234567","+970591234567")]
    [InlineData("0561234567","+970561234567")]
    [InlineData("+970591234567","+970591234567")]
    [InlineData("٠٥٦١٢٣٤٥٦٧","+970561234567")]
    public async Task SendsNormalizedMobileThroughDocumentedApi(string phone,string expected)
    {
        using var handler=new Capture();using var http=new HttpClient(handler);
        var sender=new TwilioCustomerSms(http,Config());Assert.True(sender.Enabled);
        await sender.Send(Guid.NewGuid(),phone,"123456",Guid.NewGuid(),default);
        Assert.Equal(1,handler.Calls);Assert.Equal("api.twilio.com",handler.Uri!.Host);
        Assert.EndsWith("/Messages.json",handler.Uri.AbsolutePath);Assert.Equal("Basic",handler.Authentication);
        Assert.Contains("To="+System.Uri.EscapeDataString(expected),handler.Body);
        Assert.Contains("123456",handler.Body);
    }
    [Theory]
    [InlineData("092081197")][InlineData("0551234567")][InlineData("+15551234567")]
    public async Task RejectsNonPalestinianMobilesBeforeSending(string phone)
    {
        using var handler=new Capture();using var http=new HttpClient(handler);var sender=new TwilioCustomerSms(http,Config());
        await Assert.ThrowsAsync<ArgumentException>(()=>sender.Send(Guid.NewGuid(),phone,"123456",Guid.NewGuid(),default));Assert.Equal(0,handler.Calls);
    }
    [Theory]
    [InlineData(400,"{\"code\":21408}")]
    [InlineData(201,"{\"sid\":\"SM11111111111111111111111111111111\",\"status\":\"failed\"}")]
    [InlineData(201,"{}")]
    public async Task RejectedAndAmbiguousSendsAreNeverRetried(int status,string payload)
    {
        using var handler=new Capture{Status=(HttpStatusCode)status,Payload=payload};using var http=new HttpClient(handler);
        await Assert.ThrowsAsync<InvalidOperationException>(()=>new TwilioCustomerSms(http,Config()).Send(Guid.NewGuid(),"0591234567","123456",Guid.NewGuid(),default));Assert.Equal(1,handler.Calls);
    }
    [Fact] public async Task DisabledAdapterNeverSends()
    {
        using var handler=new Capture();using var http=new HttpClient(handler);var sender=new TwilioCustomerSms(http,Config(false));Assert.False(sender.Enabled);
        await Assert.ThrowsAsync<InvalidOperationException>(()=>sender.Send(Guid.NewGuid(),"0591234567","123456",Guid.NewGuid(),default));Assert.Equal(0,handler.Calls);
    }
}
