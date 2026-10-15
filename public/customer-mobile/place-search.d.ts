export type SearchablePlace = {name?:string;label?:string;addressText?:string;area?:string;neighborhood?:string;category?:string};
export function normalizeArabicSearch(text:string):string;
export function isArabicText(text:string,required?:boolean):boolean;
export function isArabicPlace(place:SearchablePlace):boolean;
export function matchesSuggestedPlace(place:SearchablePlace,query:string):boolean;
declare global {
 var ArabicPlaces: {normalizeArabicSearch:typeof normalizeArabicSearch;isArabicText:typeof isArabicText;isArabicPlace:typeof isArabicPlace;matchesSuggestedPlace:typeof matchesSuggestedPlace};
}
