import pathlib,re,json,collections,datetime
root=pathlib.Path.cwd();out=root.parent/'DispatchPro-audit/stuck-trip-20261012'
log=root/'artifacts/windows-autostart/backend.stdout.log'
report={'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'serverLog':str(log),'productionDatabaseAccessed':False}
if log.exists():
 text=log.read_text(encoding='utf-8',errors='replace')
 report['serverLogBytes']=log.stat().st_size
 report['endpointCompletionStatuses']=dict(collections.Counter(re.findall(r'Request finished[^\n]*\bPUT\b[^\n]*/rides/[0-9a-f-]+/status\s*-\s*(\d{3})',text)))
 report['errorKinds']=dict(collections.Counter(re.findall(r'\b(?:[A-Z][A-Za-z]+\.)*[A-Z][A-Za-z]*(?:Exception|Error)\b',text)))
 report['fareRequiredMentions']=text.count('FINAL_FARE_REQUIRED')
 report['hasHttpRequestLogging']='Request finished' in text
 # Keep relevant stack locations only; never emit request bodies, names or numbers.
 report['stackLocations']=list(dict.fromkeys(re.findall(r'at (DispatchPro\.Api\.[A-Za-z0-9_.<>]+)',text)))[-12:]
 raw=out/'private/server-log-relevant.txt'
 raw.write_text('\n'.join(line for line in text.splitlines() if '/status' in line or 'Exception' in line or 'FINAL_FARE' in line),encoding='utf-8')
current=(out/'private/logcat-current.txt').read_text(encoding='utf-8',errors='replace')
report['androidConsoleErrorKinds']=dict(collections.Counter(re.findall(r'Uncaught (TypeError|ReferenceError|Error)',current)))
app=[]
for line in current.splitlines():
 if not re.search(r'\s29086\s',line) and 'NablusDriverRuntime' not in line:continue
 line=re.sub(r'https?://[^\s\"]+','[URL]',line)
 line=re.sub(r'Bearer\s+\S+','[TOKEN]',line)
 line=re.sub(r'eyJ[A-Za-z0-9_.-]+','[TOKEN]',line)
 line=re.sub(r'(?<![0-9])[+]?[0-9]{8,}(?![0-9])','[LONG_NUMBER]',line)
 line=re.sub(r'[a-f0-9]{8}-[a-f0-9-]{27,}','[ID]',line)
 if len(line)<700 and ('chromium' in line or 'NablusDriverRuntime' in line):app.append(line)
report['androidAppConsole']=app
crash=(out/'private/logcat-crash.txt').read_text(encoding='utf-8',errors='replace')
report['androidHistoricCrashBlocks']=crash.count('Process: com.dispatchpro.driver,')
report['androidCrashSignatures']={x:crash.count(x) for x in ['invalid device type 8','ForegroundServiceDidNotStartInTimeException','CallStyle']}
(out/'logs-summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
