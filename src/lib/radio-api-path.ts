// Keep authentication/renewal on the existing server and scope GPS to RADIO.
export function radioPath(path:string){
 return path.replace(/^\/api\/reception\/auth\/driver-(login|refresh|logout)$/,'/api/reception/auth/radio-$1')
  .replace(/^\/api\/reception\/driver\/(me|location)(?=$|\?)/,'/api/reception/radio/$1');
}
