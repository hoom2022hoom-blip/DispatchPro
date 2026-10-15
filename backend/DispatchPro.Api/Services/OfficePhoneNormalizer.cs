using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
namespace DispatchPro.Api.Services;

// Candidate-only normalization. Never strip arbitrary notification text into digits.
public static class OfficePhoneNormalizer
{
    public static string Normalize(string? value)
    {
        if (value is null || value.Length > 160) return "";
        var text = value.Normalize(NormalizationForm.FormKC);
        var formatted = new StringBuilder();
        foreach (var c in text)
        {
            var category = CharUnicodeInfo.GetUnicodeCategory(c);
            if (category == UnicodeCategory.Format) continue;
            if (category == UnicodeCategory.DecimalDigitNumber) formatted.Append((int)char.GetNumericValue(c));
            else if (category == UnicodeCategory.DashPunctuation) formatted.Append('-');
            else formatted.Append(c);
        }
        text = formatted.ToString().Trim();
        if (text.StartsWith("tel:", StringComparison.OrdinalIgnoreCase)) text = text[4..];
        if (text.Any(c => !char.IsAsciiDigit(c) && c is not ('+' or '(' or ')' or '-') && !char.IsWhiteSpace(c))) return "";
        if (text.Count(c => c == '+') > 1 || (text.Contains('+') && !text.StartsWith('+'))) return "";
        var digits = new string(text.Where(char.IsAsciiDigit).ToArray());
        // Android/Windows own country-metadata parsing and national display. The API retains
        // their explicit international identity instead of collapsing different countries.
        if (text.StartsWith('+') || digits.StartsWith("00")) {
            var body = digits.StartsWith("00") ? digits[2..] : digits;
            return Regex.IsMatch(body, @"^[1-9]\d{6,14}$") ? "+" + body : "";
        }
        // An unknown local country is never guessed. Do not infer a country from 05 or bare 970/972.
        return Regex.IsMatch(digits, @"^\d{4,17}$") && digits.Any(c => c != '0') ? digits : "";
    }
}
