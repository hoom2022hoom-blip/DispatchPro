"use client";
import { useEffect, useState } from 'react';
import { receptionTime } from '@/lib/reception-display';

export function ReceptionFooter({ total }: { total: number }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []);
  return <footer dir="rtl" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-card px-3 py-1 text-xs">
    <strong>إجمالي الطلبات: {total}</strong>
    <span>الوقت الحالي: <bdi>{now ? receptionTime(now) : '—'}</bdi></span>
    <span>التاريخ الحالي: <bdi>{now?.toLocaleDateString('ar-PS', { timeZone: 'Asia/Jerusalem' }) ?? '—'}</bdi></span>
  </footer>;
}
