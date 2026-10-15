export const toneChoices=[1,2,3,4];
/** @typedef {{orderTone:number,publicTone:number,privateTone:number,floorTone:number}} DriverTones */
export const defaultDriverTones={orderTone:1,publicTone:1,privateTone:2,floorTone:3};
export function driverTones() {try{return {...defaultDriverTones,...JSON.parse(localStorage.getItem('driver.alert.preferences')||'{}')};}catch{return defaultDriverTones;}}
/** @param {AudioContext} context @param {number} tone @param {number} [volume] @param {number} [noteSeconds] */
export function playDriverTone(context,tone,volume=.06,noteSeconds=.1){
 if(context.state!=='running')return;
 const patterns={1:[880],2:[660,990],3:[740,880,1040],4:[1040,780]};
 const notes=patterns[tone]??patterns[1];
 const duration=Math.max(.02,Math.min(.1,noteSeconds));
 notes.forEach((frequency,index)=>{const oscillator=context.createOscillator(),gain=context.createGain(),start=context.currentTime+index*duration;oscillator.type='sine';oscillator.frequency.value=frequency;gain.gain.setValueAtTime(.001,start);gain.gain.linearRampToValueAtTime(volume,start+.005);gain.gain.exponentialRampToValueAtTime(.001,start+duration*.9);oscillator.connect(gain);gain.connect(context.destination);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};oscillator.start(start);oscillator.stop(start+duration);});
}
/** @param {number} tone */
export function previewDriverTone(tone){const context=new AudioContext();void context.resume().then(()=>playDriverTone(context,tone));setTimeout(()=>void context.close(),700);}
