"use client";
import {Component,type ReactNode} from 'react';
import {driverTrace} from '@/lib/driver-runtime-diagnostics.js';
export class DriverErrorBoundary extends Component<{children:ReactNode;onRecover?:()=>void},{failed:boolean;kind:string}>{
 state={failed:false,kind:''};
 static getDerivedStateFromError(error:Error){return {failed:true,kind:(error.name??'Error').replace(/[^A-Za-z0-9]/g,'').slice(0,40)};}
 componentDidCatch(error:Error){driverTrace('render-failed',{kind:error.name,stack:error.stack});}
 recover=()=>{this.props.onRecover?.();this.setState({failed:false});};
 render(){return this.state.failed?<main dir="rtl" className="driver-recovery" role="alert"><h1>تعذر عرض واجهة الرحلة</h1><p>أعد جلب حالة الرحلة من المكتب قبل متابعة الإجراءات.</p>{this.state.kind&&<p>نوع خطأ الواجهة: <bdi>{this.state.kind}</bdi></p>}<button onClick={this.recover}>إعادة جلب الحالة</button><button onClick={this.recover}>العودة</button></main>:this.props.children;}
}
