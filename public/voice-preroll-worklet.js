// Volatile, per-press FIFO. No recording storage and no output before commit.
registerProcessor('ptt-preroll',class extends AudioWorkletProcessor {
 constructor(){super();this.samples=new Float32Array(sampleRate*4);this.reset();this.port.onmessage=({data:d})=>{
  if(d.type==='reset'){this.reset();this.id=d.id;return;}if(d.id!==this.id)return;
  if(d.type==='commit'){this.committed=true;return;}
  if(d.type==='stop'){this.ended=true;if(!d.drain)this.reset();return;}
  if(d.type==='push'&&!this.ended)this.append(d.values);
 };}
 reset(){this.samples.fill(0);this.read=0;this.write=0;this.count=0;this.id=null;this.committed=false;this.ended=false;this.first=false;}
 append(values){if(values.length>this.samples.length-this.count){this.port.postMessage({type:'overflow',id:this.id});this.reset();return;}for(const v of values){this.samples[this.write]=v;this.write=(this.write+1)%this.samples.length;}this.count+=values.length;if(!this.first&&values.length){this.first=true;this.port.postMessage({type:'first-frame',id:this.id});}}
 process(inputs,outputs){const out=outputs[0]?.[0];if(!out)return true;
  if(!this.ended&&this.id&&inputs[0]?.[0]?.length)this.append(inputs[0][0]);
  out.fill(0);if(this.committed)for(let i=0;i<out.length&&this.count;i++){out[i]=this.samples[this.read];this.samples[this.read]=0;this.read=(this.read+1)%this.samples.length;this.count--;}
  if(this.ended&&!this.count&&this.id){this.port.postMessage({type:'drained',id:this.id});this.reset();}return true;
 }
});
