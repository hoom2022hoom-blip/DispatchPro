using System.Text.RegularExpressions;
namespace DispatchPro.Api.Services;

// Customer phone policy only: other channels and the general OTP provider are unchanged.
public static partial class CustomerPhone
{
    public static string Clean(string? input)
    {
        var value = new string((input ?? "").Trim().Select(c => c is >= '٠' and <= '٩' ? (char)('0' + c - '٠') : c is >= '۰' and <= '۹' ? (char)('0' + c - '۰') : c).ToArray());
        value = Regex.Replace(value, @"[\s()\-]", "");
        return value.StartsWith("00") ? "+" + value[2..] : value;
    }
    [GeneratedRegex(@"^(?:0|\+?97[02])((?:5[0-9]{8})|(?:9[0-9]{7}))$")]
    private static partial Regex Mobile();
    public static string Local(string? input)
    {
        var match = Mobile().Match(Clean(input));
        if (!match.Success) throw new ArgumentException("أدخل رقمًا فلسطينيًا صحيحًا مثل 0592081197");
        return "0" + match.Groups[1].Value;
    }
    public static string[] Variants(string input)
    {
        var tail = Local(input)[1..];
        return ["0" + tail, "+970" + tail, "970" + tail, "+972" + tail, "972" + tail];
    }
    public static string Display(string input) => Mobile().IsMatch(Clean(input)) ? Local(input) : input;
    public static string SmsInternational(string input)
    {
        var local = Local(input);
        if (!Regex.IsMatch(local, @"^05[69][0-9]{7}$")) throw new ArgumentException("أدخل رقم جوال فلسطينيًا يبدأ بـ 059 أو 056");
        return "+970" + local[1..];
    }
    public static string SearchKey(string input) => Mobile().IsMatch(Clean(input)) ? Local(input)[1..] : Regex.Replace(Regex.Replace(Clean(input), @"[^0-9+]", ""), @"^(00970|00972|\+?970|\+?972|0)", "");
}
