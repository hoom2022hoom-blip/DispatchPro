using System.Text.RegularExpressions;
namespace DispatchPro.Api.Services;

// Customer phone policy only: other channels and the general OTP provider are unchanged.
public static partial class CustomerPhone
{
    [GeneratedRegex(@"^(?:0|\+?97[02])(5[0-9]{8})$")]
    private static partial Regex Mobile();
    public static string Local(string? input)
    {
        var match = Mobile().Match(input?.Trim() ?? "");
        if (!match.Success) throw new ArgumentException("أدخل رقمًا فلسطينيًا صحيحًا مثل 0592081197");
        return "0" + match.Groups[1].Value;
    }
    public static string[] Variants(string input)
    {
        var tail = Local(input)[1..];
        return ["0" + tail, "+970" + tail, "970" + tail, "+972" + tail, "972" + tail];
    }
    public static string Display(string input) => Mobile().IsMatch(input.Trim()) ? Local(input) : input;
    public static string SearchKey(string input) => Mobile().IsMatch(input.Trim()) ? Local(input)[1..] : Regex.Replace(Regex.Replace(input, @"[^0-9+]", ""), @"^(00970|00972|\+?970|\+?972|0)", "");
}
