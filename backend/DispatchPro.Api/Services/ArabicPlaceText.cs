using System.Text.RegularExpressions;
namespace DispatchPro.Api.Services;
public static class ArabicPlaceText
{
    public static bool Valid(string? value, bool required = false) =>
        (string.IsNullOrWhiteSpace(value) ? !required : Regex.IsMatch(value, "[\u0621-\u063a\u0641-\u064a]") && !Regex.IsMatch(value, "[A-Za-z\u00c0-\u024f]"));
}
