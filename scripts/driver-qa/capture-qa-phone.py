"""QA-only screen/log capture; raw content and GPS stay private."""
import subprocess,pathlib,json,xml.etree.ElementTree as ET,datetime,re,sys
adb=pathlib.Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe'
out=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else pathlib.Path.home()/'DispatchPro-audit/stuck-trip-20261012/resumed'
private=out/'private'
def run(*args):
 return subprocess.run([str(adb),'-s','6cfa0f820135',*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
report={'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'qaPackage':'com.dispatchpro.driver.qa','tripMutationsAttempted':False,'ui':[]}
pid=run('shell','pidof','com.dispatchpro.driver.qa').stdout.decode().strip()
report['running']=bool(pid)
if not pid:raise RuntimeError('QA not running; no original app capture')
top=run('shell','dumpsys','activity','activities').stdout.decode(errors='replace')
resumed=[line for line in top.splitlines() if 'mResumedActivity:' in line or 'topResumedActivity=' in line]
report['qaForeground']=any('com.dispatchpro.driver.qa/' in line for line in resumed)
logs_only='--logs-only' in sys.argv
if not report['qaForeground'] and not logs_only:raise RuntimeError('QA not in foreground; no other screen capture')
if not logs_only:
 p=run('exec-out','screencap','-p');(private/'qa-phone-screen.png').write_bytes(p.stdout)
 report['screenshotBytes']=len(p.stdout)
p=run('logcat','-d','--pid='+pid,'-t','2500','-v','threadtime');(private/'qa-phone-logcat.txt').write_bytes(p.stdout)
raw=p.stdout.decode(errors='replace')
report['logSignals']={key:raw.lower().count(key.lower()) for key in ['FATAL EXCEPTION','ANR','ReferenceError','process is not defined','invalid device type 8','shortToneUnavailable','SSLHandshakeException','transition-start','transition-http','transition-committed','render-failed']}
report['transportCodes']=re.findall(r'Transport code=([A-Z_]+)',raw)
report['authHttpStatuses']=re.findall(r'HTTP status=(\d+) operation=auth',raw)
if logs_only:
 report['screenshotCaptured']=False
 (out/'qa7-logcat-summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(report,ensure_ascii=False));sys.exit()
run('shell','uiautomator','dump','/sdcard/driver-qa-window.xml')
xml=run('exec-out','cat','/sdcard/driver-qa-window.xml').stdout
(private/'qa-phone-screen.xml').write_bytes(xml)
allowed=['اسم المستخدم','كلمة المرور','حفظ تسجيل الدخول','دخول','رمز المكتب','قبول','رفض','في الطريق إلى الزبون','وصلت للزبون','بدء الرحلة','إنهاء الرحلة','تأكيد وإنهاء الرحلة','أدخل المبلغ الذي تم تحصيله من الزبون','السعر لم يحدد بعد','متصل بالمكتب','جارٍ إعادة الاتصال بالمكتب','انقطع الإنترنت','متصل · متاح','مشغول','متاح','عام','خاص','مخشير عام','مخشير خاص','الإعدادات','إعدادات السائق','غير متصل','تعذر عرض واجهة الرحلة','إعادة جلب الحالة']
for n in ET.fromstring(xml).iter('node'):
 text=n.get('text','');desc=n.get('content-desc','')
 if text in allowed or desc in allowed:report['ui'].append({k:n.get(k) for k in ['text','content-desc','enabled','clickable','bounds','class']})
report['passwordFields']=sum(n.get('password')=='true' for n in ET.fromstring(xml).iter('node'))
(out/'qa-phone-readonly-summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
