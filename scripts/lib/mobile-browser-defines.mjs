// Standalone WebViews have no Node process object. Embed only this public map
// configuration; never copy process.env, dotenv files or server credentials.
export function mobileBrowserDefines(source=process.env){
 const publicEnv={NODE_ENV:'production'};
 for(const key of ['NEXT_PUBLIC_GOOGLE_MAPS_API_KEY','NEXT_PUBLIC_GOOGLE_MAPS_ROUTES','NEXT_PUBLIC_GOOGLE_MAPS_GEOCODING','NEXT_PUBLIC_MAPTILER_KEY','NEXT_PUBLIC_COPERNICUS_WMS_INSTANCE_ID','NEXT_PUBLIC_COPERNICUS_SENTINEL2_LAYER'])
  publicEnv[key]=typeof source[key]==='string'?source[key]:'';
 return {'process.env.NODE_ENV':'"production"','process.env':JSON.stringify(publicEnv)};
}
