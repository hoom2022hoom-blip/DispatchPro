"""Install only the approved QA.7 update; never uninstall or clear app data."""
import datetime, hashlib, json, os, pathlib, re, subprocess, sys

root=pathlib.Path(__file__).resolve().parents[2]
out=root.parent/'DispatchPro-audit/comprehensive-qa-20261013'
private=out/'private'
adb=pathlib.Path(os.environ['LOCALAPPDATA'])/'Android/Sdk/platform-tools/adb.exe'
build_tools=adb.parent.parent/'build-tools/36.0.0'
apk=out/'NM-Driver-QA-5.1.6-qa.7-vc6.apk'
serial='6cfa0f820135'
package='com.dispatchpro.driver.qa'
report={'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'package':package,'uninstallPerformed':False,'clearDataPerformed':False,'originalPackageTargeted':False,'audioTestsStarted':False}
env=dict(os.environ,JAVA_HOME=r'C:\Program Files\Android\Android Studio\jbr')

def run(program,*args,timeout=60):
 return subprocess.run([str(program),*map(str,args)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
def adb_run(*args,timeout=60):return run(adb,'-s',serial,*args,timeout=timeout)
def text(result):return result.stdout.decode('utf-8',errors='replace').strip()
def metadata(pkg):
 data=text(adb_run('shell','dumpsys','package',pkg))
 return [line.strip() for line in data.splitlines() if re.search(r'versionCode=|versionName=|firstInstallTime=|lastUpdateTime=',line)]
def certificate(file):
 r=run(build_tools/'apksigner.bat','verify','--print-certs',file)
 assert r.returncode==0,'APK signature verification failed'
 return re.search(r'certificate SHA-256 digest: (\S+)',text(r)).group(1)

try:
 assert text(adb_run('get-state'))=='device','ADB is not authorized/ready'
 badging=text(run(build_tools/'aapt2.exe','dump','badging',apk))
 assert "name='com.dispatchpro.driver.qa' versionCode='6' versionName='5.1.6-qa.7'" in badging,'Unapproved package/version'
 assert hashlib.sha256(apk.read_bytes()).hexdigest()=='68c9bf9c78251f8cc00b29478a730c2209b271400d72eaa3b400a788c2c237d5','APK changed since approval'
 before=metadata(package);original=metadata('com.dispatchpro.driver')
 assert any('versionCode=5 ' in s for s in before),'Expected installed QA.6; stop rather than guessing'
 report['qaBefore']=before;report['originalBefore']=original
 remote=text(adb_run('shell','pm','path',package)).splitlines()
 assert len(remote)==1 and remote[0].startswith('package:/data/app/') and '/com.dispatchpro.driver.qa-' in remote[0],'Unexpected installed QA path'
 installed=private/'qa6-installed-before-update.apk'
 assert adb_run('pull',remote[0][len('package:'):],installed).returncode==0,'Could not preserve installed QA APK'
 assert certificate(installed)==certificate(apk),'QA signing identities differ; update refused'
 report['installedSigningIdentityMatches']=True
 (out/'qa7-install-before.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 result=adb_run('install','-r','--no-streaming',apk,timeout=90)
 (private/'qa7-install.log').write_bytes(result.stdout+result.stderr)
 report['installerExitCode']=result.returncode
 report['installed']=result.returncode==0 and 'Success' in text(result)
 report['userRestricted']=b'INSTALL_FAILED_USER_RESTRICTED' in result.stdout+result.stderr
 report['qaAfter']=metadata(package)
 report['originalMetadataUnchanged']=metadata('com.dispatchpro.driver')==original
 assert report['originalMetadataUnchanged'],'Original metadata changed unexpectedly; stop'
 if report['installed']:
  assert any('versionName=5.1.6-qa.7' in s for s in report['qaAfter'])
  assert [s for s in before if 'firstInstallTime=' in s]==[s for s in report['qaAfter'] if 'firstInstallTime=' in s],'First install time changed'
  report['firstInstallTimePreserved']=True
  report['status']='PASS'
 else:report['status']='BLOCKED'
except Exception as e:
 report['status']='FAIL';report['error']=str(e)
finally:
 (out/'qa7-install-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({k:v for k,v in report.items() if k not in ['qaBefore','qaAfter','originalBefore']},ensure_ascii=False))
sys.exit(0 if report.get('installed') else 1)
