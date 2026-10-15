"""Read-only acceptance baseline. Never opens apps or resets gfxinfo counters."""
import datetime, ipaddress, json, pathlib, re, subprocess, sys

out = pathlib.Path.home() / 'DispatchPro-audit/comprehensive-qa-20261013'
private = out / 'private'
adb = pathlib.Path.home() / 'AppData/Local/Android/Sdk/platform-tools/adb.exe'
serial, package = '6cfa0f820135', 'com.dispatchpro.driver.qa'

def read(name, *args):
    p = subprocess.run([str(adb), '-s', serial, *args], capture_output=True, timeout=20)
    (private / ('field-' + name + '.txt')).write_bytes(p.stdout + p.stderr)
    return p.stdout.decode(errors='replace').strip()

def graphics(text):
    patterns = {'sinceNs': r'Stats since:\s*(\d+)', 'frames': r'Total frames rendered:\s*(\d+)', 'janky': r'Janky frames:\s*(\d+)'}
    return {k: int(m.group(1)) if (m := re.search(v, text)) else None for k, v in patterns.items()}

state = read('device', 'get-state')
if state != 'device':
    (out / 'field-phone-readiness.json').write_text(json.dumps({'atUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'device': state or 'not available', 'readOnly': True, 'phoneMeasurementsTaken': False, 'settingsChanged': False, 'appsOpened': False}, indent=2), encoding='utf-8')
    raise RuntimeError('Authorized QA phone is required; no action taken')
pid = read('pid', 'shell', 'pidof', package)
old = graphics((private / 'qa7-graphics.txt').read_text(errors='replace'))
current = graphics(read('graphics', 'shell', 'dumpsys', 'gfxinfo', package))
prior = json.loads((out / 'qa7-phone-resources.json').read_text())
comparable = bool(pid) and pid == prior['pid'] and current['sinceNs'] == old['sinceNs']
delta = {k: current[k] - old[k] for k in ('frames', 'janky')} if comparable and all(current[k] is not None and old[k] is not None for k in ('frames', 'janky')) else None
window = None
baseline_path = out / 'field-frame-baseline.json'
if '--start-window' in sys.argv:
    baseline_path.write_text(json.dumps({'atUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'pid': pid, 'graphics': current}, indent=2), encoding='utf-8')
if '--finish-window' in sys.argv:
    baseline = json.loads(baseline_path.read_text())
    compatible = bool(pid) and pid == baseline['pid'] and current['sinceNs'] == baseline['graphics']['sinceNs'] and current['sinceNs'] is not None
    d = {k: current[k] - baseline['graphics'][k] for k in ('frames', 'janky')} if compatible and all(current[k] is not None and baseline['graphics'][k] is not None for k in ('frames', 'janky')) else None
    window = {'startedAtUtc': baseline['atUtc'], 'sameProcessAndEpoch': compatible, 'delta': d,
              'jankPercent': 100 * d['janky'] / d['frames'] if d and d['frames'] > 0 and d['janky'] >= 0 else None,
              'note': 'Zero new frames or changed PID/epoch is inconclusive; record the activity scenario separately.'}
phone_network = read('network', 'shell', 'ip', '-o', '-4', 'addr', 'show')
pc = subprocess.run(['powershell', '-NoProfile', '-Command', 'Get-NetIPAddress -AddressFamily IPv4 | Select-Object IPAddress,PrefixLength,InterfaceAlias | ConvertTo-Json -Compress'], capture_output=True, timeout=20)
(private / 'field-pc-network.json').write_bytes(pc.stdout)
addresses = json.loads(pc.stdout.decode(errors='replace'))
if isinstance(addresses, dict): addresses = [addresses]
phone = [ipaddress.ip_interface(value) for value in re.findall(r'\binet\s+([0-9.]+/\d+)', phone_network) if not value.startswith('127.')]
pcnets = [ipaddress.ip_interface(str(a['IPAddress']) + '/' + str(a['PrefixLength'])) for a in addresses if not str(a['IPAddress']).startswith('127.')]
same_subnet = any(a.ip in b.network and b.ip in a.network for a in phone for b in pcnets)
location = read('location', 'shell', 'cmd', 'location', 'is-location-enabled')
reverse = read('reverse', 'reverse', '--list')
report = {'atUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'device': state, 'package': package, 'pid': pid or None, 'readOnly': True,
          'usb9443ReversePresent': 'tcp:9443 tcp:9443' in reverse, 'systemLocationEnabled': True if location == 'true' else False if location == 'false' else None,
          'networkAddressesDisclosed': False, 'phoneIpv4Observed': bool(phone), 'sameIpv4SubnetObserved': same_subnet if phone else None,
          'sameSubnetProvesMedia': False, 'graphics': current, 'previousGraphics': old, 'sameProcessAndCounterEpoch': comparable, 'graphicsDelta': delta,
          'acceptanceWindow': window,
          'graphicsNote': 'No controlled foreground-use interval; cumulative deltas do not establish recurring jank during use.',
          'settingsChanged': False, 'appsOpened': False, 'audioOrTripActions': False}
(out / 'field-phone-readiness.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
