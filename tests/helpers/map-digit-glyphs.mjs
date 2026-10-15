// Original 5x7 bitmap digits for QA cluster counts. No font files or provider data.
const patterns=['01110/10001/10011/10101/11001/10001/01110','00100/01100/00100/00100/00100/00100/01110','01110/10001/00001/00010/00100/01000/11111','11110/00001/00001/01110/00001/00001/11110','00010/00110/01010/10010/11111/00010/00010','11111/10000/10000/11110/00001/00001/11110','01110/10000/10000/11110/10001/10001/01110','11111/00001/00010/00100/01000/01000/01000','01110/10001/10001/01110/10001/10001/01110','01110/10001/10001/01111/00001/00001/01110'];
const varint=n=>{const bytes=[];do{let byte=n&127;n>>>=7;if(n)byte|=128;bytes.push(byte);}while(n);return bytes;};
const field=(tag,n)=>[...varint(tag*8),...varint(n)];
const message=(tag,bytes)=>[...varint(tag*8+2),...varint(bytes.length),...bytes];
export function digitGlyphs(){
 const glyphs=patterns.flatMap((pattern,i)=>{
  // MapLibre expects signed-distance glyph pixels at a nominal 24 px size.
  const width=21,height=27,mask=new Uint8Array(width*height),bitmap=new Uint8Array(width*height);
  pattern.split('/').forEach((row,y)=>[...row].forEach((pixel,x)=>{if(pixel==='1')for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++)mask[(3+y*3+dy)*width+3+x*3+dx]=1;}));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const inside=mask[y*width+x];let distance=4;for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=width||ny>=height)continue;if(mask[ny*width+nx]!==inside)distance=Math.min(distance,Math.hypot(dx,dy));}bitmap[y*width+x]=Math.max(0,Math.min(255,192+(inside?1:-1)*(distance-.5)*32));}
  return message(3,[...field(1,48+i),...message(2,bitmap),...field(3,15),...field(4,21),...field(5,0),...field(6,42),...field(7,18)]);
 });
 return new Uint8Array(message(1,glyphs));
}
