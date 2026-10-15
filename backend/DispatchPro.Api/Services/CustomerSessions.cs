using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;
namespace DispatchPro.Api.Services;
public sealed class CustomerSessions(TaxiDb db,TokenService tokens){
 public string Create(User user){var row=new AuditLog{ActorId=user.Id,EntityId=user.Id,Action="customer.session.created"};db.Add(row);return tokens.Issue(user,customerSessionId:row.Id.ToString());}
 public async Task<string> Login(User user){var token=Create(user);await db.SaveChangesAsync();return token;}
}
