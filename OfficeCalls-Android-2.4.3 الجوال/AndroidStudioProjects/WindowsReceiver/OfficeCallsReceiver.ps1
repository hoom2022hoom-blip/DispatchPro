param([int]$Port = 5050)
# Office Calls Receiver 2.5 - eventId deduplication, WhatsApp marker and Caller ID broadcast

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = "Office Calls - WhatsApp Business"
$form.Size = New-Object System.Drawing.Size(760, 560)
$form.StartPosition = "CenterScreen"
$form.BackColor = [System.Drawing.Color]::FromArgb(245, 247, 250)
$form.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$logPath = Join-Path $PSScriptRoot "OfficeCalls-error.log"
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
$status.Text = "Starting receiver..."
$status.AutoSize = $true
$status.ForeColor = [System.Drawing.Color]::DarkGreen
$status.Location = New-Object System.Drawing.Point(29, 62)
$form.Controls.Add($status)

$callerCaption = New-Object System.Windows.Forms.Label
$callerCaption.Text = "CURRENT CALLER"
$callerCaption.AutoSize = $true
$callerCaption.Location = New-Object System.Drawing.Point(29, 108)
$form.Controls.Add($callerCaption)

$caller = New-Object System.Windows.Forms.Label
$caller.Text = "Waiting for a WhatsApp Business call"
$caller.Font = New-Object System.Drawing.Font("Segoe UI", 25, [System.Drawing.FontStyle]::Bold)
$caller.TextAlign = "MiddleCenter"
$caller.BackColor = [System.Drawing.Color]::White
$caller.BorderStyle = "FixedSingle"
$caller.Location = New-Object System.Drawing.Point(30, 138)
$caller.Size = New-Object System.Drawing.Size(680, 105)
$form.Controls.Add($caller)

$historyCaption = New-Object System.Windows.Forms.Label
$historyCaption.Text = "CALL HISTORY"
$historyCaption.AutoSize = $true
$historyCaption.Location = New-Object System.Drawing.Point(29, 270)
$form.Controls.Add($historyCaption)

$history = New-Object System.Windows.Forms.ListView
$history.View = "Details"
$history.FullRowSelect = $true
$history.GridLines = $true
$history.Location = New-Object System.Drawing.Point(30, 298)
$history.Size = New-Object System.Drawing.Size(680, 170)
[void]$history.Columns.Add("Time", 85)
[void]$history.Columns.Add("W", 45)
[void]$history.Columns.Add("Caller / number", 285)
[void]$history.Columns.Add("Device", 235)
$form.Controls.Add($history)

$tip = New-Object System.Windows.Forms.NotifyIcon
$tip.Icon = [System.Drawing.SystemIcons]::Information
$tip.Text = "Office Calls Receiver"
$tip.Visible = $true

$trayMenu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $trayMenu.Items.Add("Open Office Calls")
$exitItem = $trayMenu.Items.Add("Exit")
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
    if ($digits.StartsWith("00970") -or $digits.StartsWith("00972")) {
        $digits = $digits.Substring(5)
    } elseif ($digits.StartsWith("970") -or $digits.StartsWith("972")) {
        $digits = $digits.Substring(3)
    }
    if ($digits.Length -eq 9 -and -not $digits.StartsWith("0")) {
        $digits = "0" + $digits
    }
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
    if ($digits.Length -gt 15) { $digits = $digits.Substring(0, 15) }
    $dashed = Format-WhozzPhone $digits
    if ($dashed.Length -gt 15) { $dashed = $dashed.Substring(0, 15) }

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
        Write-OfficeCallsLog ("GRIDCMS UDP SENT: $Phone -> 255.255.255.255:3520 ($($bytes.Length) bytes)")
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

try {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $Port)
    $listener.Start(200)
    $addresses = (Get-LocalIPv4) -join "  /  "
    if ([string]::IsNullOrWhiteSpace($addresses)) { $addresses = "IP address not found" }
    $status.Text = "Ready - Phone IP setting: $addresses   Port: $Port"
} catch {
    Write-OfficeCallsLog ("START ERROR: " + $_.Exception.ToString())
    [System.Windows.Forms.MessageBox]::Show("Could not start receiver on port $Port.`r`n$($_.Exception.Message)", "Office Calls")
    $tip.Dispose()
    exit 1
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 150
$timer.Add_Tick({
    try {
        while ($listener.Pending()) {
            $client = $listener.AcceptTcpClient()
            $client.ReceiveTimeout = 2500
            try {
                $reader = New-Object System.IO.StreamReader($client.GetStream(), [System.Text.Encoding]::UTF8)
                $line = $reader.ReadLine()
                if (-not [string]::IsNullOrWhiteSpace($line)) {
                    $data = $line | ConvertFrom-Json
                    $eventId = [string]$data.eventId
                    if ([string]::IsNullOrWhiteSpace($eventId)) {
                        # توافق احتياطي مع مرسل قديم؛ النسخة الحالية من Android ترسل eventId دائمًا.
                        $eventId = "legacy-" + [Guid]::NewGuid().ToString()
                    }
                    $alreadyProcessed = Test-ProcessedEvent $eventId
                    if ($alreadyProcessed) {
                        Write-OfficeCallsLog ("DUPLICATE EVENT IGNORED: $eventId")
                        $ackWriter = [System.IO.StreamWriter]::new($client.GetStream(), [System.Text.UTF8Encoding]::new($false), 1024, $true)
                        $ackWriter.AutoFlush = $true
                        $ackWriter.WriteLine("OK $eventId")
                        continue
                    }
                    $rawNumber = [string]$data.number
                    if ([string]::IsNullOrWhiteSpace($rawNumber) -and ([string]$data.caller -match '[0-9]')) {
                        $rawNumber = [string]$data.caller
                    }
                    $localPhone = Convert-ToLocalPhone $rawNumber
                    $display = $localPhone
                    if ([string]::IsNullOrWhiteSpace($display)) { $display = [string]$data.caller }
                    if ([string]::IsNullOrWhiteSpace($display)) { $display = [string]$data.displayName }
                    if ([string]::IsNullOrWhiteSpace($display)) { $display = "Unknown WhatsApp caller" }
                    $caller.Text = $display
                    $item = New-Object System.Windows.Forms.ListViewItem((Get-Date).ToString("HH:mm:ss"))
                    [void]$item.SubItems.Add("W")
                    [void]$item.SubItems.Add($display)
                    [void]$item.SubItems.Add([string]$data.device)
                    $history.Items.Insert(0, $item)
                    while ($history.Items.Count -gt 100) { $history.Items.RemoveAt($history.Items.Count - 1) }

                    if (-not [string]::IsNullOrWhiteSpace($localPhone)) {
                        Send-ToGridCMS $localPhone
                        $status.Text = "Sent to GRIDCMS: $localPhone"
                    }
                    Register-ProcessedEvent $eventId
                    Write-OfficeCallsLog ("EVENT PROCESSED ONCE: $eventId / $localPhone")
                    $ackWriter = [System.IO.StreamWriter]::new($client.GetStream(), [System.Text.UTF8Encoding]::new($false), 1024, $true)
                    $ackWriter.AutoFlush = $true
                    $ackWriter.WriteLine("OK $eventId")
                    $tip.BalloonTipTitle = "Office Calls 2.5 - W"
                    $tip.BalloonTipText = "Sent to GRIDCMS: $display"
                    $tip.ShowBalloonTip(1500)
                    # Keep running quietly in the notification area without covering GRIDCMS.
                }
            } finally {
                $client.Close()
            }
        }
    } catch {
        Write-OfficeCallsLog ("RECEIVER ERROR: " + $_.Exception.ToString())
        $status.Text = "Receiver error: $($_.Exception.Message)"
        $status.ForeColor = [System.Drawing.Color]::DarkRed
    }
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
    $listener.Stop()
    $tip.Visible = $false
    $tip.Dispose()
})

$form.Add_Shown({
    # Keep the modal message loop alive: minimize invisibly instead of calling Hide().
    $form.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
    $form.ShowInTaskbar = $false
    $tip.BalloonTipTitle = "Office Calls"
    $tip.BalloonTipText = "Receiver 2.5 is running in the background - W = WhatsApp"
    $tip.ShowBalloonTip(2500)
})

try {
    [void]$form.ShowDialog()
} catch {
    Write-OfficeCallsLog ("FATAL ERROR: " + $_.Exception.ToString())
    [System.Windows.Forms.MessageBox]::Show("Office Calls stopped unexpectedly.`r`nSee OfficeCalls-error.log in the program folder.", "Office Calls")
}
