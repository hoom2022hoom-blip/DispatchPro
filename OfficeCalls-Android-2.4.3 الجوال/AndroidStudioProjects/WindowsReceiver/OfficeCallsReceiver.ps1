param([int]$Port = 5051, [switch]$SmokeTest, [switch]$PairingSmokeTest, [string]$StateDirectory)
# OfficeCalls Professional 3.2.5 — persistent local receiver, TLS, tray UI

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$created=$false
$mutex=[Threading.Mutex]::new($true,'Local\OfficeCallsProfessionalReceiver',[ref]$created)
if(-not $created){$mutex.Dispose();exit 0}
$config=& (Join-Path $PSScriptRoot 'Initialize-LocalReceiver.ps1') -Port $Port -StateDirectory $StateDirectory
$stateDirectory=$config.directory
$configPath=Join-Path $stateDirectory 'receiver.json'
$secretBytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $stateDirectory 'credentials.dpapi')),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
$secrets=[Text.Encoding]::UTF8.GetString($secretBytes) | ConvertFrom-Json
Add-Type -Path (Join-Path $PSScriptRoot 'ReceiverUiReader.cs')
Add-Type -Path (Join-Path $PSScriptRoot 'ReceiverProcessJob.cs')
$nodePath=Join-Path $PSScriptRoot 'runtime/node.exe'
if(-not (Test-Path -LiteralPath $nodePath)){$nodePath=(Get-Command node.exe -ErrorAction Stop).Source}
$entry=Join-Path $PSScriptRoot 'scripts/officecalls-agent/local-start.mjs'
if(-not(Test-Path -LiteralPath $entry)){$entry=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../scripts/officecalls-agent/local-start.mjs'))}
function Start-LocalWorker {
 if($script:workerJob){$script:workerJob.Dispose()}
 $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=$nodePath;$psi.Arguments='"'+$entry+'" "'+$configPath+'"'
 $psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.WindowStyle='Hidden';$psi.RedirectStandardInput=$true
 $script:worker=[Diagnostics.Process]::Start($psi)
 try{$script:workerJob=[OfficeCallsProcessJob]::new($script:worker)}catch{if(-not $script:worker.HasExited){$script:worker.Kill()};throw}
 $script:worker.StandardInput.Write(($secrets | ConvertTo-Json -Compress));$script:worker.StandardInput.Close()
 $script:reader=[OfficeCallsUiReader]::new([int]$config.port,[string]$secrets.token,[string]$config.pin)
}
Start-LocalWorker
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = "OfficeCalls Professional 3.2.5 — مكالمات المكتب"
$form.Size = New-Object System.Drawing.Size(780, 660)
$form.StartPosition = "CenterScreen"
$form.BackColor = [System.Drawing.Color]::FromArgb(245, 247, 250)
$form.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$logPath = Join-Path $stateDirectory "OfficeCalls-error.log"
$script:processedEvents = @{}
$script:processedOrder = [System.Collections.Generic.Queue[string]]::new()
$script:eventRetention = [TimeSpan]::FromMinutes(10)

function Remove-ExpiredEvents {
    $cutoff = [DateTime]::UtcNow.Subtract($script:eventRetention)
    @($script:processedEvents.Keys) | ForEach-Object {
        if ($script:processedEvents[$_] -lt $cutoff) {
            $script:processedEvents.Remove($_)
        }
    }
}

function Test-ProcessedEvent([string]$EventId) {
    if ([string]::IsNullOrWhiteSpace($EventId)) { return $false }
    Remove-ExpiredEvents
    return $script:processedEvents.ContainsKey($EventId)
}

function Register-ProcessedEvent([string]$EventId) {
    if ([string]::IsNullOrWhiteSpace($EventId)) { return }
    if (-not $script:processedEvents.ContainsKey($EventId)) {
        $script:processedEvents[$EventId] = [DateTime]::UtcNow
        $script:processedOrder.Enqueue($EventId)
    }
    # الاحتفاظ بالمعرفات القديمة محدود زمنيًا وعدديًا؛ لا يوجد أي حظر حسب رقم الهاتف.
    while ($script:processedOrder.Count -gt 2000) {
        $oldId = $script:processedOrder.Dequeue()
        $script:processedEvents.Remove($oldId)
    }
}

function Write-OfficeCallsLog([string]$Message) {
    try {
        Add-Content -LiteralPath $logPath -Encoding UTF8 -Value ("{0}  {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message)
    } catch { }
}

$title = New-Object System.Windows.Forms.Label
$title.Text = "OFFICE CALLS"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 20, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(25, 18)
$form.Controls.Add($title)

$status = New-Object System.Windows.Forms.Label
$status.Text = "جارٍ تشغيل المستقبِل المحلي المشفّر…"
$status.AutoSize = $true
$status.MaximumSize = New-Object System.Drawing.Size(690, 44)
$status.ForeColor = [System.Drawing.Color]::DarkGreen
$status.Location = New-Object System.Drawing.Point(29, 62)
$form.Controls.Add($status)

$callerCaption = New-Object System.Windows.Forms.Label
$callerCaption.Text = "آخر مكالمة"
$callerCaption.AutoSize = $true
$callerCaption.Location = New-Object System.Drawing.Point(29, 108)
$form.Controls.Add($callerCaption)

$caller = New-Object System.Windows.Forms.Label
$caller.Text = "بانتظار مكالمة واتساب أو بزنس"
$caller.Font = New-Object System.Drawing.Font("Segoe UI", 25, [System.Drawing.FontStyle]::Bold)
$caller.TextAlign = "MiddleCenter"
$caller.BackColor = [System.Drawing.Color]::White
$caller.BorderStyle = "FixedSingle"
$caller.Location = New-Object System.Drawing.Point(30, 138)
$caller.Size = New-Object System.Drawing.Size(680, 105)
$form.Controls.Add($caller)

$historyCaption = New-Object System.Windows.Forms.Label
$historyCaption.Text = "سجل المكالمات — W واتساب / WB بزنس"
$historyCaption.AutoSize = $true
$historyCaption.Location = New-Object System.Drawing.Point(29, 270)
$form.Controls.Add($historyCaption)

$history = New-Object System.Windows.Forms.ListView
$history.View = "Details"
$history.FullRowSelect = $true
$history.GridLines = $true
$history.Location = New-Object System.Drawing.Point(30, 330)
$history.Size = New-Object System.Drawing.Size(680, 200)
[void]$history.Columns.Add("التاريخ والوقت — فلسطين", 180)
[void]$history.Columns.Add("المصدر", 65)
[void]$history.Columns.Add("الرقم / الاسم", 190)
[void]$history.Columns.Add("GRIDCMS", 125)
[void]$history.Columns.Add("DispatchPro", 120)
$form.Controls.Add($history)

$tip = New-Object System.Windows.Forms.NotifyIcon
$tip.Icon = [System.Drawing.SystemIcons]::Information
$tip.Text = "Office Calls Receiver"
$tip.Visible = $true

$trayMenu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $trayMenu.Items.Add("فتح مكالمات المكتب")
$exitItem = $trayMenu.Items.Add("خروج")
$tip.ContextMenuStrip = $trayMenu
$script:allowExit = $false

$openWindow = {
    $form.ShowInTaskbar = $true
    $form.WindowState = [System.Windows.Forms.FormWindowState]::Normal
    $form.Show()
    $form.Activate()
}
$openItem.Add_Click($openWindow)
$tip.Add_DoubleClick($openWindow)
$exitItem.Add_Click({
    $script:allowExit = $true
    $form.Close()
})

function Convert-ToLocalPhone([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
    $digits = $Value -replace '[^0-9]', ''
    # Worker supplies metadata-derived national display. Never strip an unverified country code here.
    if ($Value.Trim().StartsWith('+') -or $Value.Trim().StartsWith('00')) { return $Value }
    return $digits
}

function Format-WhozzPhone([string]$Phone) {
    $digits = $Phone -replace '[^0-9]', ''
    if ($digits.Length -eq 10) {
        return $digits.Substring(0, 3) + "-" + $digits.Substring(3, 3) + "-" + $digits.Substring(6, 4)
    }
    if ($digits.Length -eq 9) {
        return $digits.Substring(0, 3) + "-" + $digits.Substring(3, 3) + "-" + $digits.Substring(6, 3)
    }
    return $digits
}

function New-WhozzCallingPayload([string]$Phone) {
    # Exact 21-byte prefix captured from the real Caller ID device (192.168.0.90).
    [byte[]]$header = @(
        0x5E, 0x5E, 0x3C, 0x55, 0x3E, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
        0x3C, 0x53, 0x3E, 0x17, 0x00, 0x16, 0x07, 0x18, 0x60, 0x24
    )

    $digits = $Phone -replace '[^0-9]', ''
    if ($Phone -notmatch '^\d{4,15}$') { throw 'GRID_PHONE_UNREPRESENTABLE' }
    $dashed = Format-WhozzPhone $digits
    if ($dashed.Length -gt 15) { throw 'GRID_PHONE_TOO_LONG' }

    $stamp = (Get-Date).ToString("MM/dd hh:mm tt", [System.Globalization.CultureInfo]::InvariantCulture).ToUpperInvariant()
    # 04 is the dedicated valid line for WhatsApp calls. GRIDCMS displays it as L=4.
    # The real device/protocol supports lines 1 through 4 only.
    # It stays a valid two-digit line field; letters here would invalidate the device protocol.
    $record = "04 I S 0000 G B1 $stamp " + $dashed.PadRight(15, ' ') + $digits.PadRight(15, ' ')
    [byte[]]$recordBytes = [System.Text.Encoding]::ASCII.GetBytes($record)
    if ($recordBytes.Length -ne 62) {
        throw "Unexpected Caller ID record length: $($recordBytes.Length), expected 62."
    }

    [byte[]]$payload = New-Object byte[] ($header.Length + $recordBytes.Length)
    [System.Array]::Copy($header, 0, $payload, 0, $header.Length)
    [System.Array]::Copy($recordBytes, 0, $payload, $header.Length, $recordBytes.Length)
    return $payload
}

function Send-ToGridCMS([string]$Phone) {
    if ([string]::IsNullOrWhiteSpace($Phone)) { return }
    [byte[]]$bytes = New-WhozzCallingPayload $Phone
    $udp = New-Object System.Net.Sockets.UdpClient
    try {
        $udp.EnableBroadcast = $true
        # Exact destination captured from the real Caller ID device.
        # Send exactly one packet because duplicate packets can terminate older GRIDCMS builds.
        $destination = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Broadcast, 3520)
        [void]$udp.Send($bytes, $bytes.Length, $destination)
        Write-OfficeCallsLog ("GRIDCMS UDP SENT: ***$($Phone.Substring([Math]::Max(0,$Phone.Length-3))) -> 255.255.255.255:3520 ($($bytes.Length) bytes)")
    } finally {
        $udp.Close()
    }
}

function Get-LocalIPv4 {
    try {
        return [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
            Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and -not $_.IPAddressToString.StartsWith("127.") } |
            ForEach-Object { $_.IPAddressToString }
    } catch { return @() }
}

$addresses=@(Get-LocalIPv4 | Where-Object {$_ -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'})
$status.Text="IP: $($addresses -join ' / ')  HTTPS: $($config.port)"
$pairButton=New-Object Windows.Forms.Button
$pairButton.Text='إعدادات الاتصال والاقتران';$pairButton.Location=New-Object Drawing.Point(30,282);$pairButton.Size=New-Object Drawing.Size(300,38)
$form.Controls.Add($pairButton)
. (Join-Path $PSScriptRoot 'PairingDialog.ps1')
. (Join-Path $PSScriptRoot 'AdvancedReceiverSettings.ps1')
$pairButton.Add_Click({Show-OfficePairingDialog})
$form.RightToLeft=[Windows.Forms.RightToLeft]::Yes
$caller.RightToLeft=[Windows.Forms.RightToLeft]::No
$history.RightToLeftLayout=$true
$script:shownSequence=-1
$script:lastNotified=''
function Get-DeliveryText([string]$value){
 switch($value){
  'UDP_SENT'{'أُرسل؛ العرض غير مؤكد'}
  'UDP_UNCERTAIN'{'إرسال غير مؤكد'}
  'GRID_BLOCKED'{'تعذر تمثيل الرقم بأمان؛ محفوظ كاملًا'}
  'PENDING'{'بانتظار الإرسال'}
  'NUMBER_UNAVAILABLE'{'الرقم غير متاح'}
  'DELIVERED'{'أكد الموقع'}
  'HISTORY_ONLY'{'سجل قديم'}
  'DISABLED'{'معطل'}
  'NOT_CONFIGURED'{'غير مهيأ'}
  'RETRYING'{'ينتظر إعادة الاتصال'}
  'READY'{'جاهز'}
  'EXISTING_CALLER_ID_PATH'{'مسار الأرضي القائم'}
  'EXISTING_INBOX_ONLY'{'متابعة صندوق الأرضي'}
  'EXISTING_CAPTURE_OBSERVED'{'التقاط سابق قائم'}
  'EXISTING_CAPTURE_OR_PORT_OCCUPIED'{'المنفذ مشغول؛ تحقق من الالتقاط'}
  'CAPTURE_PROCESS_RUNNING_UNVERIFIED'{'الالتقاط يعمل؛ بانتظار تحقق مكالمة'}
  'CAPTURE_STOPPED'{'توقف الالتقاط'}
  default{if($value){$value}else{'غير مهيأ'}}
 }
}
$timer=New-Object Windows.Forms.Timer;$timer.Interval=500
$timer.Add_Tick({
 try {
  if($script:worker.HasExited){$status.Text='توقف المستقبِل — راجع تعارض المنفذ أو السجل';$status.ForeColor=[Drawing.Color]::DarkRed;return}
  $snapshot=$script:reader.Take();$script:reader.Poll()
  if(-not $snapshot){return};$response=$snapshot | ConvertFrom-Json
  if($response.error){$status.Text='غير متصل — جارٍ انتظار المستقبِل';return}
  $events=@($response.events)
  foreach($line in @($response.landline)){
   if(-not $line.event){continue}
   $events+= [pscustomobject]@{event=[pscustomobject]@{eventId=$line.event.eventId;timestamp=([DateTimeOffset]::Parse($line.event.timestamp).ToUnixTimeMilliseconds());number=$line.event.phone;package='LANDLINE_ICALL';device='Caller ID';displayName=''};grid='EXISTING_CALLER_ID_PATH';dispatch=$line.dispatch;sequence=0}
  }
  $events=@($events | Sort-Object {$_.event.timestamp} -Descending | Select-Object -First 200)
  $sequence=[string](($events | Measure-Object -Property sequence -Maximum).Maximum)+':'+[string]$events.Count+':'+[string]$events[0].event.eventId
  $status.ForeColor=[Drawing.Color]::DarkGreen
  $recent=@($response.devices | Where-Object {([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-[long]$_.lastSeen) -lt 60000}).Count
  $site=if($response.bridge.configured){Get-DeliveryText ([string]$response.bridge.dispatch)}else{'غير مهيأ'}
  $captureText=Get-DeliveryText ([string]$response.bridge.capture)
  $status.Text="المستقبل يعمل • هواتف ظهرت آخر دقيقة: $recent • الموقع: $site • الأرضي: $captureText"
  if($sequence -eq $script:shownSequence){return};$script:shownSequence=$sequence
  $history.BeginUpdate();$history.Items.Clear()
  foreach($row in $events){
   $e=$row.event;$display=$(if($e.number){$e.number}else{'الرقم غير متاح'})+$(if($e.displayName){' — '+$e.displayName}else{''})
   # Local Receiver uses IANA Asia/Hebron, independent of the Windows desktop timezone.
   $time=[string]$row.callTime
   if(-not $time){$time=[TimeZoneInfo]::ConvertTime([DateTimeOffset]::FromUnixTimeMilliseconds([long]$e.timestamp),[TimeZoneInfo]::FindSystemTimeZoneById('West Bank Standard Time')).ToString('yyyy-MM-dd HH:mm:ss',[Globalization.CultureInfo]::InvariantCulture)}
   $item=New-Object Windows.Forms.ListViewItem($time);[void]$item.SubItems.Add($(if($e.package -eq 'LANDLINE_ICALL'){'أرضي'}elseif($e.package -eq 'com.whatsapp.w4b'){'WB'}else{'W'}));[void]$item.SubItems.Add($display)
   [void]$item.SubItems.Add((Get-DeliveryText ([string]$row.grid)));[void]$item.SubItems.Add((Get-DeliveryText ([string]$row.dispatch)));$item.ToolTipText='eventId='+$e.eventId+'; deviceId='+$e.deviceId+'; source='+$e.resolutionSource+'; reason='+$e.failureReason+'; phone='+$e.device+'; GRIDCMS='+$row.grid+'; DispatchPro='+$row.dispatch
   [void]$history.Items.Add($item)
  }
  $history.EndUpdate();$history.ShowItemToolTips=$true
  if($events.Count -gt 0){$e=$events[0].event;$caller.Text=if($e.number){$e.number}else{'مكالمة واتساب — الرقم غير متاح'}
   $callerCaption.Text='آخر مكالمة — '+[char]0x2066+[string]$events[0].callTime+[char]0x2069+' — بتوقيت فلسطين'
   $script:lastNotified=$e.eventId}
 }catch{$status.Text='تعذر تحديث العرض — الاستقبال يعمل بالخلفية';Write-OfficeCallsLog ('UI_ERROR: '+$_.Exception.GetType().Name)}
})
$timer.Start()

$form.Add_FormClosing({
    param($sender, $e)
    if (-not $script:allowExit) {
        $e.Cancel = $true
        $form.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
        $form.ShowInTaskbar = $false
        return
    }
    $timer.Stop()
    if(-not $script:worker.HasExited){$script:worker.Kill()}
    if($script:workerJob){$script:workerJob.Dispose()}
    $mutex.ReleaseMutex();$mutex.Dispose()
    $tip.Visible = $false
    $tip.Dispose()
})

$form.Add_Shown({
    # Keep the modal message loop alive: minimize invisibly instead of calling Hide().
    $form.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
    $form.ShowInTaskbar = $false
    $tip.BalloonTipTitle = "Office Calls"
    $tip.BalloonTipText = "مستقبِل 3.2.5 يعمل بالخلفية — W واتساب / WB بزنس"
    $tip.ShowBalloonTip(2500)
})

try {
    if($SmokeTest){$form.Opacity=0;$form.Show();$end=[DateTime]::UtcNow.AddSeconds(5);while([DateTime]::UtcNow -lt $end){[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 50};if($script:worker.HasExited){throw "WORKER_EXITED"};if($PairingSmokeTest){Show-OfficePairingDialog};$script:allowExit=$true;$form.Close();Write-Output "UI_SMOKE_PASS"}else{[void]$form.ShowDialog()}
} catch {
    Write-OfficeCallsLog ("FATAL ERROR: " + $_.Exception.ToString())
    [System.Windows.Forms.MessageBox]::Show("Office Calls stopped unexpectedly.`r`nSee OfficeCalls-error.log in the program folder.", "Office Calls")
}
