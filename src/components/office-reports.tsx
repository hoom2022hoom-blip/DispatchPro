"use client";
import type {OfficeData} from '@/lib/office';
import {OfficeHistoryReport} from './office-history-report';
import {OfficeOrderReport} from './office-order-report';
export function OfficeReports({data}:{data:OfficeData}){return <main dir="rtl" className="space-y-5 p-5"><OfficeHistoryReport data={data}/><OfficeOrderReport today={data.today} drivers={data.drivers}/></main>;}
