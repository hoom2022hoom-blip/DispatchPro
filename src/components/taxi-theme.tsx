"use client";
import {useEffect,useState} from 'react';
export function useTaxiTheme(defaultMode='system'){
 const [mode,setMode]=useState(defaultMode);
 useEffect(()=>{try{setMode(localStorage.getItem('dispatchpro.theme')||defaultMode);}catch{}},[defaultMode]);
 useEffect(()=>{if(typeof matchMedia==='undefined')return;const query=matchMedia('(prefers-color-scheme: dark)');const apply=()=>{document.documentElement.dataset.taxiTheme=mode==='system'?(query.matches?'dark':'light'):mode;};apply();query.addEventListener('change',apply);return()=>query.removeEventListener('change',apply);},[mode]);
 return {mode,setMode};
}
export function TaxiTheme({defaultMode='system'}:{defaultMode?:string}={}){
 const {mode,setMode}=useTaxiTheme(defaultMode);
 return <label className="taxi-theme-control">المظهر <select aria-label="المظهر" value={mode} onChange={e=>{setMode(e.target.value);try{localStorage.setItem('dispatchpro.theme',e.target.value);}catch{}}}><option value="light">نهاري</option><option value="dark">ليلي</option><option value="system">حسب الجهاز</option></select></label>;
}
