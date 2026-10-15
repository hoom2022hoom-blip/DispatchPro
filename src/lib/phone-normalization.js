/** Normalize Palestinian local/international phones, including Arabic digits. */
export function normalizePhone(phone) {
  const digits = phone.replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c<='٩'?0x660:0x6f0))).replace(/\D/g, '').replace(/^00/, '');
  return /^(970|972)\d{8,9}$/.test(digits) ? `0${digits.slice(3)}` : digits;
}
