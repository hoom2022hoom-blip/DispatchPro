import hashlib,json,os,pathlib,re,subprocess,sys,zipfile

config=json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
out=pathlib.Path(config['out'])
version=config.get('qaVersionName','5.1.6-qa.2')
version_code=config.get('qaVersionCode',1)
apk=out/config.get('qaApkName','NM-Driver-QA-5.1.6-qa.2-vc1.apk')
installed=pathlib.Path(config['root']).parent/'DispatchPro-audit/2026-10-12/private/installed-5.1.5-private.apk'
tools=pathlib.Path(os.environ['LOCALAPPDATA'])/'Android/Sdk/build-tools/36.0.0'
env=dict(os.environ,JAVA_HOME=r'C:\Program Files\Android\Android Studio\jbr')
def run(program,*args):
    return subprocess.check_output([str(program),*map(str,args)],env=env,text=True,encoding='utf-8')
badging=run(tools/'aapt2.exe','dump','badging',apk)
manifest=run(tools/'aapt2.exe','dump','xmltree','--file','AndroidManifest.xml',apk)
qa_cert=run(tools/'apksigner.bat','verify','--print-certs',apk)
production_cert=run(tools/'apksigner.bat','verify','--print-certs',installed)
digest=lambda data:hashlib.sha256(data).hexdigest()
cert=lambda text:next(line.split(': ',1)[1] for line in text.splitlines() if 'certificate SHA-256 digest:' in line)
checks=[]
def check(name,condition):
    if not condition:raise AssertionError(name)
    checks.append(dict(name=name,passed=True))
check('Separate package, version and code',f"name='com.dispatchpro.driver.qa' versionCode='{version_code}' versionName='{version}'" in badging)
check('Recognizable QA launcher label',"application-label:'NM DRIVER QA — اختبار'" in badging)
check('Distinct APK signing certificate',cert(qa_cert)!=cert(production_cert))
if config.get('previousQaApk'):
    import re
    previous=pathlib.Path(config['previousQaApk'])
    old_badging=run(tools/'aapt2.exe','dump','badging',previous)
    old_cert=run(tools/'apksigner.bat','verify','--print-certs',previous)
    old_code=int(re.search(r"versionCode='(\d+)'",old_badging).group(1))
    check('Upgrade preserves QA signing identity and increases code',
          "name='com.dispatchpro.driver.qa'" in old_badging and cert(qa_cert)==cert(old_cert) and version_code>old_code)
check('No shared UID','sharedUserId' not in manifest)
check('Independent signature PTT permission','com.dispatchpro.driver.qa.permission.EXTERNAL_PTT_OWNER' in manifest and '"com.dispatchpro.permission.EXTERNAL_PTT_OWNER"' not in manifest)
check('Operational Firebase init/registration absent',all(name not in manifest for name in ['FirebaseInitProvider','DriverMessagingService','DriverPushRegistrationJob']))
check('Backup disabled; no cleartext transport','allowBackup(0x01010280)=false' in manifest and 'usesCleartextTraffic(0x010104ec)=false' in manifest)
with zipfile.ZipFile(apk) as archive:
    if config.get('qaTlsRes'):
        resources=run(tools/'aapt2.exe','dump','resources',apk)
        def resource(name):
            found=re.search(r'resource (0x[0-9a-f]+) '+re.escape(name)+r'\s+\(\) \(file\) (\S+)',resources)
            if not found:raise AssertionError('Missing QA resource: '+name)
            return found.groups()
        network_id,network_path=resource('xml/qa_local_network')
        ca_id,ca_path=resource('raw/qa_local_ca')
        network=run(tools/'aapt2.exe','dump','xmltree','--file',network_path,apk)
        check('Manifest selects scoped QA network security config',
              re.search(r'networkSecurityConfig\([^)]*\)=@'+network_id+r'\b',manifest) is not None)
        check('QA trust covers localhost without subdomains or cleartext',
              "T: 'localhost'" in network and network.count('E: domain (')==1 and 'includeSubdomains=false' in network
              and network.count('cleartextTrafficPermitted=false')==2 and 'cleartextTrafficPermitted=true' not in network
              and ('src=@'+ca_id) not in network.split('E: domain-config')[0]
              and ('src=@'+ca_id) in network.split('E: domain-config')[1])
        bundled_ca=archive.read(ca_path)
        check('APK bundles the expected public QA CA',bundled_ca==(pathlib.Path(config['qaTlsRes'])/'raw/qa_local_ca.pem').read_bytes())
        check('Private TLS keys never included in APK',all(b'PRIVATE KEY' not in archive.read(n) for n in archive.namelist() if not n.endswith('.dex')))
    native=b''.join(archive.read(name) for name in archive.namelist() if name.endswith('.dex'))
    check('Native endpoints include the QA HTTPS origin',config['publicOrigin'].encode() in native)
    check('Operational dispatch origins absent from native code',all(origin.encode() not in native for origin in ['https://api.nablustaxi.com','https://office.nablustaxi.com']))
    for name in ['app.js','app.css','index.html']:
        check('Staged QA asset included: '+name,digest(archive.read('assets/'+name))==digest((pathlib.Path(config['qaAssets'])/name).read_bytes()))
    javascript=archive.read('assets/app.js')
    check('Bundled WebView has no unresolved process.env',re.search(rb'\bprocess\.env\b',javascript) is None)
    check('Operational dispatch origins absent from WebView code',all(origin.encode() not in javascript for origin in ['https://api.nablustaxi.com','https://office.nablustaxi.com']))
report=dict(status='PASS',checks=checks,package='com.dispatchpro.driver.qa',version=version,versionCode=version_code,
            apk=str(apk),apkSha256=digest(apk.read_bytes()),bytes=apk.stat().st_size,qaCertificateSha256=cert(qa_cert),
            installedCertificateSha256=cert(production_cert),installedApkSha256=digest(installed.read_bytes()),
            installationPerformed=False,physicalDeviceVerified=False)
(out/'apk-isolation-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(dict(status='PASS',checks=len(checks),package=report['package'],bytes=report['bytes'],sha256=report['apkSha256'])))
