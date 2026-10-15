// Emulate MapLibre's imperative source API, including incremental removals/updates.
let activeMap;
export function mockFleetMap(options={}){
 if(activeMap)return activeMap;
 if(globalThis.window&&!globalThis.window.matchMedia)globalThis.window.matchMedia=()=>({matches:true});
 if(!globalThis.cancelAnimationFrame)globalThis.cancelAnimationFrame=()=>{};
 const sources=new Map(),events=new Map();
 const map={getSource(id){if(!sources.has(id))sources.set(id,{features:new Map(),updateData(diff){if(diff.removeAll)this.features.clear();for(const id of diff.remove??[])this.features.delete(id);for(const f of diff.add??[])this.features.set(f.id,structuredClone(f));for(const update of diff.update??[]){const f=this.features.get(update.id);if(!f)continue;if(update.newGeometry)f.geometry=structuredClone(update.newGeometry);for(const {key,value} of update.addOrUpdateProperties??[])f.properties[key]=value;}}});return sources.get(id);},on(name,fn){events.set(name,fn);},off(name){events.delete(name);}};
 return activeMap={getCanvas:()=>({clientWidth:780,clientHeight:620}),project:()=>({x:390,y:310}),...options,getMap:()=>map};
}
export function sourceData(view,id){
 const map=view.root.findAll(node=>['driver-map','final-map','search-map'].includes(node.type))[0];
 const source=map.instance.getMap().getSource(id);
 return {type:'FeatureCollection',features:[...source.features.values()]};
}
