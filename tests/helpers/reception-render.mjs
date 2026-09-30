import {registerHooks} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import ts from 'typescript';
const react=JSON.stringify(import.meta.resolve('react'));
const rhf=JSON.stringify(import.meta.resolve('react-hook-form'));
export function receptionRenderHooks(){
 const stubs={
  '/components/ui/button':`export const Button='button';`,
  '/components/ui/input':`import React from ${react};export const Input=React.forwardRef((p,r)=>React.createElement('input',{...p,ref:r}));`,
  '/components/ui/textarea':`import React from ${react};export const Textarea=React.forwardRef((p,r)=>React.createElement('textarea',{...p,ref:r}));`,
  '/components/ui/checkbox':`export const Checkbox='input';`,
  '/components/ui/form':`export {FormProvider as Form,Controller as FormField} from ${rhf};export const FormControl='div',FormItem='div',FormLabel='label';export const FormMessage=()=>null;`,
  '/components/ui/popover':`export const Popover='div',PopoverContent='section',PopoverTrigger='div';`,
  '/components/responsive-dialog':`import React from ${react};export function ResponsiveDialog(p){return p.open?React.createElement('section',{'aria-label':p.title},p.children):null;}`,
  '/components/office-reception-table':`export const OfficeReceptionTable='reception-table';`,
  '/components/reception-footer':`export const ReceptionFooter=()=>null;`,
  '/components/office-workspace':`export const useOffice=()=>({});`,
  '/components/reception-edit-form':`export const ReceptionEditForm=()=>null;`,
  '/components/strict-mode-droppable':`export const StrictModeDroppable=p=>p.children({innerRef:()=>{},droppableProps:{},placeholder:null});`,
 };
 const stub=source=>({url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true});
 return registerHooks({resolve(s,c,next){
  if(s==='next/navigation')return stub(`const params=new URLSearchParams();export const useSearchParams=()=>params;`);
  if(s==='next/dynamic')return stub('export default ()=>()=>null;');
  if(s==='@hello-pangea/dnd')return stub(`export const DragDropContext=p=>p.children;export const Draggable=p=>p.children({innerRef:()=>{},draggableProps:{},dragHandleProps:{}});`);
  let url;
  if(s.startsWith('@/'))url=new URL('../../src/'+s.slice(2),import.meta.url);
  else if(s.startsWith('.')&&c.parentURL?.includes('/src/'))url=new URL(s,c.parentURL);
  if(url){for(const [key,source] of Object.entries(stubs))if(url.pathname.endsWith(key))return stub(source);for(const ext of ['','.ts','.tsx']){const candidate=new URL(url.href+ext);if(existsSync(candidate))return next(candidate.href,c);}}
  return next(s,c);
 },load(url,c,next){if(url.includes('/src/')&&url.endsWith('.tsx'))return{format:'module',source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true};return next(url,c);}});
}
