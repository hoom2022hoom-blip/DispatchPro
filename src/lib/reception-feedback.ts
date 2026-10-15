/** Preserve diagnostics while presenting actionable reception messages. */
export function receptionError(failure: unknown): string {
  const message = failure instanceof Error ? failure.message : String(failure ?? '');
  const status = typeof failure === 'object' && failure !== null && 'status' in failure ? failure.status : undefined;
  if (status !== 400 && !/يرجى تحديد (موقع الانطلاق|وجهة الرحلة)/.test(message)) console.error('[reception]', failure);
  if (/409|conflict|stale|version|تغيّر|تغير/i.test(message)) return 'تغيّرت بيانات الطلب. راجع حالته الحالية ثم حاول مجددًا.';
  if (status === 403 || /403|forbidden|ليس لديك صلاحية|لا تملك صلاحية/i.test(message)) return 'ليس لديك صلاحية للوصول إلى هذه الصفحة';
  if(status===401&&typeof failure==='object'&&failure!==null&&'sessionInvalid' in failure&&failure.sessionInvalid===false)return message;
  if (/بيانات الدخول أو معرف المكتب غير صحيحة/.test(message)) return message;
  if (status === 401 || /401|unauthorized|انتهت جلسة|سجّل الدخول/i.test(message)) return 'انتهت الجلسة. سجّل الدخول مجددًا.';
  if (/404|not found/i.test(message)) return 'لم يعد الطلب متاحًا. حدّث القائمة ثم حاول مجددًا.';
  if (/network|fetch|timeout|502|503|504/i.test(message)) return 'تعذر الاتصال بالمكتب. تحقق من الاتصال ثم أعد المحاولة.';
  if (/[\u0600-\u06ff]/.test(message) && !/API|Exception|stack|SQL|version/i.test(message)) return message;
  return 'تعذر إتمام العملية. حاول مجددًا؛ وإذا تكرر الخطأ تواصل مع الدعم.';
}
