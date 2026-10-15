import type {VoiceStatus} from './voice-client';

// Presentation only: an outstanding request is never a granted floor.
export function radioPresentation(status:VoiceStatus){
 if(!status.connected)return {phase:'offline',title:'المخشير غير متصل',name:undefined,channel:undefined};
 const floor=status.talking??status.state?.floors.find(f=>f.channel!=='public')??status.state?.floors.find(f=>f.channel==='public');
 if(status.talking)return {phase:'talking',title:status.talking.channel==='public'?'أنت تتحدث للجميع':'أنت تتحدث على الخاص',name:status.talking.name,channel:status.talking.channel};
 if(status.pending&&floor&&status.state?.self?.id&&floor.speaker===status.state.self.id)return {phase:'granted',title:'تم منح الموجة',name:floor.name,channel:floor.channel};
 if(status.pending)return {phase:'requesting',title:status.message||'جارٍ طلب الموجة…',name:floor?.name,channel:floor?.channel};
 if(floor)return {phase:'busy',title:floor.audioStarted?'الموجة مشغولة · يتحدث الآن':'الموجة محجوزة · تجهيز الصوت',name:floor.name,channel:floor.channel};
 return {phase:status.connected?'idle':'offline',title:status.connected?'الموجة متاحة':'المخشير غير متصل',name:undefined,channel:undefined};
}
