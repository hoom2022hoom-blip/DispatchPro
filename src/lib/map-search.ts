// Local matching only: normalization never sends a query to a map provider.
export function normalizeMapSearch(value:string){
 return value.normalize('NFKC').toLowerCase().replace(/[\u0640\u064B-\u065F\u0670]/g,'').replace(/[أإآٱ]/g,'ا').replace(/[ىی]/g,'ي').replace(/ک/g,'ك').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x660)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x6f0)).replace(/\s+/g,' ').trim();
}
const compact=(value:string)=>value.replace(/[\s\-_/()+،,]/g,'');
export function mapSearchIndex(values:string[]){const fields=values.map(normalizeMapSearch);return {fields,compactFields:fields.map(compact)};}
let lastQuery:string|undefined,lastTerms:{plain:string;compact:string}[]=[];
export function matchesMapSearchIndex(index:ReturnType<typeof mapSearchIndex>,query:string){
 if(query!==lastQuery){lastQuery=query;lastTerms=normalizeMapSearch(query).split(' ').filter(Boolean).map(plain=>({plain,compact:compact(plain)}));}
 return lastTerms.every(term=>index.fields.some((field,i)=>field.includes(term.plain)||!!term.compact&&index.compactFields[i].includes(term.compact)));
}
export function matchesMapSearch(values:string[],query:string){
 return matchesMapSearchIndex(mapSearchIndex(values),query);
}
