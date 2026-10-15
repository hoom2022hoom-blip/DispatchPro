"""Read QA-only process metrics and permissions, without resetting any counters."""
import datetime,json,pathlib,re,subprocess
out=pathlib.Path.home()/'DispatchPro-audit/comprehensive-qa-20261013'
private=out/'private'
adb=pathlib.Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe'
package='com.dispatchpro.driver.qa'
def read(name,*args):
 p=subprocess.run([str(adb),'-s','6cfa0f820135','shell',*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
 (private/('qa7-'+name+'.txt')).write_bytes(p.stdout+p.stderr)
 return p.stdout.decode(errors='replace')
report={'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'package':package,'readOnly':True,'countersReset':False,'settingsChanged':False,'audioOrTripActions':False}
pid=read('pid','pidof',package).strip();report['running']=bool(pid)
if not pid:raise RuntimeError('QA process not running')
report['pid']=pid
memory=read('memory','dumpsys','meminfo',package)
for name,regex in [('totalPssKb',r'TOTAL PSS:\s*(\d+)'),('totalRssKb',r'TOTAL RSS:\s*(\d+)'),('totalSwapPssKb',r'TOTAL SWAP PSS:\s*(\d+)')]:
 match=re.search(regex,memory);report[name]=int(match.group(1)) if match else None
cpu=read('cpu','dumpsys','cpuinfo')
match=next((re.search(r'(\d+(?:\.\d+)?)%\s+'+re.escape(pid)+'/'+re.escape(package)+r'(?::|\s)',s) for s in cpu.splitlines() if pid+'/'+package in s),None)
report['cpuPercentInSystemSamplingWindow']=float(match.group(1)) if match else None
report['cpuNote']='null means the process was not listed; not proof of zero CPU'
graphics=read('graphics','dumpsys','gfxinfo',package)
for name,regex in [('renderedFrames',r'Total frames rendered:\s*(\d+)'),('jankyFrames',r'Janky frames:\s*(\d+)')]:
 match=re.search(regex,graphics);report[name]=int(match.group(1)) if match else None
pkg=read('package','dumpsys','package',package)
report['permissionGrants']={p:(re.search(re.escape(p)+r': granted=(true|false)',pkg).group(1)=='true' if re.search(re.escape(p)+r': granted=(true|false)',pkg) else None) for p in ['android.permission.ACCESS_FINE_LOCATION','android.permission.ACCESS_COARSE_LOCATION','android.permission.ACCESS_BACKGROUND_LOCATION','android.permission.POST_NOTIFICATIONS','android.permission.RECORD_AUDIO']}
services=read('services','dumpsys','activity','services',package)
report['foregroundServiceListed']='isForeground=true' in services
report['callAudioServiceListed']='CallAudioService' in services
report['driverForegroundServiceListed']='DriverForegroundService' in services
# Battery totals are historical and model-estimated; no before/after experiment.
uid=re.search(r'\buserId=(\d+)',pkg)
if uid:
 battery=read('battery','dumpsys','batterystats',package)
 tag='u0a'+str(int(uid.group(1))-10000)
 match=re.search(r'UID '+re.escape(tag)+r':\s*([\d.]+)',battery)
 report['historicalEstimatedUidMah']=float(match.group(1)) if match else None
report['batteryImprovementMeasured']=False;report['movingGpsMeasured']=False;report['longDozeTested']=False
(out/'qa7-phone-resources.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
