"""Read-only Android capture. Raw content stays in a private audit directory."""
import subprocess,pathlib,json,xml.etree.ElementTree as ET,datetime,re
adb=pathlib.Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe'
out=pathlib.Path.home()/'DispatchPro-audit/stuck-trip-20261012'
private=out/'private'
def run(*args,timeout=25):
    return subprocess.run([str(adb),'-s','6cfa0f820135',*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
report={'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mutationsAttempted':False,'ui':[]}
pid=run('shell','pidof','com.dispatchpro.driver').stdout.decode().strip()
report['pid']=pid
for name,args in [('screen.png',('exec-out','screencap','-p')),('logcat-current.txt',('logcat','-d','-v','threadtime','-t','6000')),('logcat-crash.txt',('logcat','-b','crash','-d','-v','threadtime'))]:
    p=run(*args);(private/name).write_bytes(p.stdout);report[name]={'exitCode':p.returncode,'bytes':len(p.stdout)}
p=run('shell','uiautomator','dump','/sdcard/dispatchpro-diagnostic.xml')
if p.returncode==0:
    xml=run('exec-out','cat','/sdcard/dispatchpro-diagnostic.xml').stdout
    (private/'screen.xml').write_bytes(xml)
    allowed=['إنهاء الرحلة','بدء الرحلة','في الطريق إلى الزبون','وصلت للزبون','تأكيد وإنهاء الرحلة','أدخل المبلغ الذي تم تحصيله من الزبون','السعر لم يحدد بعد','متصل بالمكتب','جارٍ إعادة الاتصال بالمكتب','انقطع الإنترنت','مشغول','متاح','عام','خاص','الإعدادات','إعدادات السائق','غير متصل']
    for n in ET.fromstring(xml).iter('node'):
        text=n.get('text','');desc=n.get('content-desc','')
        if text in allowed or desc in allowed:
            report['ui'].append({k:n.get(k) for k in ['text','content-desc','enabled','clickable','bounds','class']})
else: report['uiDumpError']=p.stderr.decode(errors='replace')[-150:]
raw=(private/'logcat-current.txt').read_text(encoding='utf-8',errors='replace')
app_lines=[line for line in raw.splitlines() if pid and re.search(r'\s'+re.escape(pid)+r'\s',line)]
report['appLogLines']=len(app_lines)
report['signals']={key:sum(key.lower() in s.lower() for s in app_lines) for key in ['FINAL_FARE_REQUIRED','transition-start','transition-http','transition-committed','Exception','chromium','409','403','401','timeout']}
(out/'android-readonly-summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
