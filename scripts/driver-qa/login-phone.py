"""Use only ordinary ADB UI input on the QA login screen; no security bypass."""
import datetime,json,pathlib,re,subprocess,xml.etree.ElementTree as ET
base=pathlib.Path.home()/'DispatchPro-audit'
out=base/'comprehensive-qa-20261013'
adb=pathlib.Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe'
report={'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'package':'com.dispatchpro.driver.qa','credentialsPrinted':False,'securitySettingsChanged':False,'loginSubmitted':False}
def run(*args):return subprocess.run([str(adb),'-s','6cfa0f820135',*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=25)
def input_call(*args):
 result=run('shell','input',*args)
 if result.returncode or any(s in result.stdout+result.stderr for s in [b'INJECT_EVENTS',b'SecurityException']):raise PermissionError('ADB_INJECT_EVENTS_DENIED')
def tap(node):
 x1,y1,x2,y2=map(int,re.findall(r'\d+',node.get('bounds','')));input_call('tap',str((x1+x2)//2),str((y1+y2)//2))
try:
 top=run('shell','dumpsys','activity','activities').stdout.decode(errors='replace')
 assert any('com.dispatchpro.driver.qa/' in line for line in top.splitlines() if 'topResumedActivity=' in line or 'mResumedActivity:' in line),'QA not foreground'
 nodes=list(ET.parse(out/'private/qa-phone-screen.xml').iter('node'))
 edits=[n for n in nodes if n.get('class')=='android.widget.EditText']
 assert len(edits)==2 and sum(n.get('password')=='true' for n in edits)==1,'Expected QA login screen'
 user=next(n for n in edits if n.get('password')!='true');password=next(n for n in edits if n.get('password')=='true')
 button=next(n for n in nodes if n.get('text')=='دخول' and n.get('class')=='android.widget.Button')
 tap(user) # Stop before reading/type credentials if ordinary input is forbidden.
 account=json.loads((base/'driver-qa-env-20261012/private/test-accounts.private.json').read_text(encoding='utf-8'))['driver']
 secret=account['password'];assert re.fullmatch(r'[A-Za-z0-9._-]+',secret),'Manual entry needed for this password format'
 if user.get('text')!='qa.driver':
  input_call('keyevent','123')
  for _ in user.get('text',''):input_call('keyevent','67')
  input_call('text','qa.driver')
 tap(password);input_call('text',secret);input_call('keyevent','4');tap(button)
 report['loginSubmitted']=True;report['status']='SUBMITTED'
except PermissionError:
 report['status']='MANUAL_INPUT_REQUIRED';report['reason']='ADB_INJECT_EVENTS_DENIED'
except Exception as e:
 report['status']='STOPPED';report['reason']=type(e).__name__
finally:
 (out/'qa7-phone-login-attempt.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
