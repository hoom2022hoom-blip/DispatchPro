// Inject into the dedicated QA office context BEFORE loading the station.
// Passive/on-demand: no timers, microphone, candidate addresses, SDP or signaling.
(()=>{
 if(location.origin!=='https://localhost:9443'||globalThis.__qaIceRead)return;
 const Native=globalThis.RTCPeerConnection,connections=[];
 globalThis.RTCPeerConnection=new Proxy(Native,{construct(target,args,newTarget){
  const pc=Reflect.construct(target,args,newTarget);connections.push(pc);
  while(connections.length>64)connections.shift();return pc;
 }});
 globalThis.__qaIceRead=async()=>Promise.all(connections.map(async(pc,index)=>{
  const row={index,state:pc.connectionState,ice:pc.iceConnectionState};
  if(pc.connectionState==='closed')return row;
  try{
   const stats=await pc.getStats();let pair;
   for(const s of stats.values())if(s.type==='transport'&&s.selectedCandidatePairId)pair=stats.get(s.selectedCandidatePairId);
   if(!pair)for(const s of stats.values())if(s.type==='candidate-pair'&&s.nominated&&s.state==='succeeded')pair=s;
   if(pair){row.localType=stats.get(pair.localCandidateId)?.candidateType;row.remoteType=stats.get(pair.remoteCandidateId)?.candidateType;row.protocol=stats.get(pair.localCandidateId)?.protocol;row.roundTripSeconds=pair.currentRoundTripTime;row.bytesSent=pair.bytesSent;row.bytesReceived=pair.bytesReceived;}
   row.inboundAudio=[...stats.values()].filter(s=>s.type==='inbound-rtp'&&(s.kind==='audio'||s.mediaType==='audio')).map(s=>({packetsReceived:s.packetsReceived,packetsLost:s.packetsLost,jitter:s.jitter,bytesReceived:s.bytesReceived}));
  }catch{row.statsUnavailable=true;}
  return row;
 }));
})();
