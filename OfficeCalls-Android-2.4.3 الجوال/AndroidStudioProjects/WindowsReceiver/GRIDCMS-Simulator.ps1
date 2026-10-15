Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = "GRIDCMS Test Simulator"
$form.Size = New-Object System.Drawing.Size(700, 430)
$form.StartPosition = "CenterScreen"
$form.BackColor = [System.Drawing.Color]::White
$form.Font = New-Object System.Drawing.Font("Segoe UI", 11)

$title = New-Object System.Windows.Forms.Label
$title.Text = "GRIDCMS / WHOZZ CALLING SIMULATOR"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(24, 20)
$form.Controls.Add($title)

$status = New-Object System.Windows.Forms.Label
$status.Text = "Listening for Whozz Calling records on UDP port 3520..."
$status.AutoSize = $true
$status.ForeColor = [System.Drawing.Color]::DarkGreen
$status.Location = New-Object System.Drawing.Point(27, 68)
$form.Controls.Add($status)

$caption = New-Object System.Windows.Forms.Label
$caption.Text = "RECEIVED PHONE NUMBER"
$caption.AutoSize = $true
$caption.Location = New-Object System.Drawing.Point(27, 118)
$form.Controls.Add($caption)

$phone = New-Object System.Windows.Forms.Label
$phone.Text = "Waiting..."
$phone.Font = New-Object System.Drawing.Font("Segoe UI", 28, [System.Drawing.FontStyle]::Bold)
$phone.TextAlign = "MiddleCenter"
$phone.BorderStyle = "FixedSingle"
$phone.BackColor = [System.Drawing.Color]::FromArgb(235, 248, 238)
$phone.Location = New-Object System.Drawing.Point(30, 150)
$phone.Size = New-Object System.Drawing.Size(630, 90)
$form.Controls.Add($phone)

$rawCaption = New-Object System.Windows.Forms.Label
$rawCaption.Text = "RAW DEVICE RECORD"
$rawCaption.AutoSize = $true
$rawCaption.Location = New-Object System.Drawing.Point(27, 270)
$form.Controls.Add($rawCaption)

$raw = New-Object System.Windows.Forms.TextBox
$raw.ReadOnly = $true
$raw.Multiline = $true
$raw.Location = New-Object System.Drawing.Point(30, 300)
$raw.Size = New-Object System.Drawing.Size(630, 48)
$form.Controls.Add($raw)

try {
    $udp = New-Object System.Net.Sockets.UdpClient(3520)
    $udp.Client.Blocking = $false
} catch {
    [System.Windows.Forms.MessageBox]::Show("UDP port 3520 is already in use. Close GRIDCMS or another caller-ID program, then try again.", "GRIDCMS Simulator")
    exit 1
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 100
$timer.Add_Tick({
    try {
        while ($udp.Available -gt 0) {
            $remote = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
            $bytes = $udp.Receive([ref]$remote)
            # Real Ethernet Link packets contain a 21-byte binary prefix followed by 62 ASCII bytes.
            if ($bytes.Length -eq 83) {
                $record = [System.Text.Encoding]::ASCII.GetString($bytes, 21, 62)
            } else {
                $record = [System.Text.Encoding]::ASCII.GetString($bytes).TrimEnd("`r", "`n")
            }
            $raw.Text = $record
            if ($record -match '^\d{2} [IO] [ES] \d{4} [GB] .\d \d{2}/\d{2} \d{2}:\d{2} [AP]M (.{15})(.{15})$') {
                $receivedPhone = $matches[2].Trim()
                $phone.Text = $receivedPhone
                $status.Text = "Success: record received exactly as GRIDCMS expects"
                $status.ForeColor = [System.Drawing.Color]::DarkGreen
                [System.Media.SystemSounds]::Asterisk.Play()
            } else {
                $phone.Text = "Invalid record format"
                $status.Text = "A UDP packet arrived, but its format was not valid"
                $status.ForeColor = [System.Drawing.Color]::DarkRed
            }
        }
    } catch [System.Net.Sockets.SocketException] {
        if ($_.Exception.SocketErrorCode -ne [System.Net.Sockets.SocketError]::WouldBlock) {
            $status.Text = $_.Exception.Message
        }
    }
})
$timer.Start()

$form.Add_FormClosing({
    $timer.Stop()
    $udp.Close()
})
[void]$form.ShowDialog()
