(function (root, factory) {
  const api = factory();
  root.ArabicPlaces = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ArabicPlaces = api;
})(globalThis, function () {
  function normalizeArabicSearch(text) {
    return String(text || '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي')
      .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g, '')
      .replace(/\s+/g, ' ').trim();
  }
  function isArabicText(text, required = false) {
    const value = String(text || '').trim();
    return (!required && !value || /[\u0621-\u063a\u0641-\u064a]/.test(value)) && !/\p{Script=Latin}/u.test(value);
  }
  function isArabicPlace(place) {
    return isArabicText(place.name || place.label, true) &&
      ['addressText', 'area', 'neighborhood', 'category'].every(key => isArabicText(place[key]));
  }
  function matchesSuggestedPlace(place, query) {
    const needle = normalizeArabicSearch(query);
    if (/\p{Script=Latin}/u.test(needle) || !isArabicPlace(place)) return false;
    return normalizeArabicSearch([place.name || place.label, place.addressText, place.area, place.neighborhood, place.category].filter(Boolean).join(' ')).includes(needle);
  }
  return { normalizeArabicSearch, isArabicText, isArabicPlace, matchesSuggestedPlace };
});
