export function driverConnectionLabel(connected:boolean,online:boolean) {
  return !online?'انقطع الإنترنت':connected?'متصل بالمكتب':'جارٍ إعادة الاتصال بالمكتب';
}
