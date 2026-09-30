param([string]$Phone = "0599000000")

Add-Type -AssemblyName System.Windows.Forms

$digits = $Phone -replace '[^0-9]', ''
if ($digits.Length -eq 10) {
    $dashed = $digits.Substring(0, 3) + "-" + $digits.Substring(3, 3) + "-" + $digits.Substring(6, 4)
} elseif ($digits.Length -eq 9) {
    $dashed = $digits.Substring(0, 3) + "-" + $digits.Substring(3, 3) + "-" + $digits.Substring(6, 3)
} else {
    $dashed = $digits
}

[byte[]]$header = @(
    0x5E, 0x5E, 0x3C, 0x55, 0x3E, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
    0x3C, 0x53, 0x3E, 0x17, 0x00, 0x16, 0x07, 0x18, 0x60, 0x24
)
$stamp = (Get-Date).ToString("MM/dd hh:mm tt", [System.Globalization.CultureInfo]::InvariantCulture).ToUpperInvariant()
$record = "02 I S 0000 G B1 $stamp " + $dashed.PadRight(15, ' ') + $digits.PadRight(15, ' ')
[byte[]]$recordBytes = [System.Text.Encoding]::ASCII.GetBytes($record)
[byte[]]$bytes = New-Object byte[] ($header.Length + $recordBytes.Length)
[System.Array]::Copy($header, 0, $bytes, 0, $header.Length)
[System.Array]::Copy($recordBytes, 0, $bytes, $header.Length, $recordBytes.Length)

$udp = New-Object System.Net.Sockets.UdpClient
try {
    $udp.EnableBroadcast = $true
    $destination = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Broadcast, 3520)
    [void]$udp.Send($bytes, $bytes.Length, $destination)
} finally {
    $udp.Close()
}

[System.Windows.Forms.MessageBox]::Show("Test number $digits was broadcast to GRIDCMS once.", "Office Calls")
