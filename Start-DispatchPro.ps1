param([switch]$NoWatch)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$apiUrl = 'http://127.0.0.1:9010'
$webUrl = 'http://127.0.0.1:9005'
$apiProject = Join-Path $root 'backend\DispatchPro.Api'
$logDir = Join-Path $root '.dispatchpro-local\logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$apiOut = Join-Path $logDir 'api.stdout.log'
$apiErr = Join-Path $logDir 'api.stderr.log'
$webOut = Join-Path $logDir 'web.stdout.log'
$webErr = Join-Path $logDir 'web.stderr.log'

# Match the existing Node launcher: import ignored local settings into this process only.
foreach ($envFile in @((Join-Path $root '.env'), (Join-Path $root '.env.local'))) {
    if (Test-Path -LiteralPath $envFile) {
        foreach ($line in Get-Content -LiteralPath $envFile) {
            if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
                $name = $Matches[1]; $value = $Matches[2]
                if ($value.Length -ge 2 -and (($value[0] -eq '"' -and $value[-1] -eq '"') -or ($value[0] -eq "'" -and $value[-1] -eq "'"))) { $value = $value.Substring(1, $value.Length - 2) }
                if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) { [Environment]::SetEnvironmentVariable($name, $value, 'Process') }
            }
        }
    }
}
$env:ASPNETCORE_URLS = $apiUrl
$env:DISPATCHPRO_API_URL = $apiUrl

function Get-ListeningPids([int]$port) {
    $found = @()
    foreach ($line in (& netstat.exe -ano -p tcp)) {
        if ($line -match "^\s*TCP\s+\S+:$port\s+\S+\s+LISTENING\s+(\d+)\s*$") { $found += [int]$Matches[1] }
    }
    return @($found | Select-Object -Unique)
}
function Get-HttpStatus([string]$url, [string]$method = 'GET', [string]$body = '') {
    try {
        $params = @{ Uri = $url; Method = $method; TimeoutSec = 3; UseBasicParsing = $true }
        if ($method -ne 'GET') { $params.ContentType = 'application/json'; $params.Body = $body }
        $response = Invoke-WebRequest @params
        return [int]$response.StatusCode
    } catch {
        if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        return 0
    }
}
function Test-ProxyRoute {
    # Empty credentials must be rejected by ASP.NET (401), proving Next did not return its own route-unavailable 404.
    $status = Get-HttpStatus "$webUrl/api/reception/auth/login" 'POST' '{}'
    return ($status -ne 0 -and $status -ne 404 -and $status -ne 503)
}
function Test-ApiOperational {
    if ((Get-HttpStatus "$apiUrl/health/live") -ne 200) { return $false }
    # Login with a unique nonexistent tenant is read-only. ASP.NET returns 401 after its tenant DB query;
    # a database failure instead returns a server error. No account or database data is changed.
    $probe = '{"tenant":"launcher-probe-' + [guid]::NewGuid().ToString('N') + '","username":"launcher-probe","password":"read-only-probe"}'
    return ((Get-HttpStatus "$apiUrl/api/v1/auth/login" 'POST' $probe) -eq 401)
}
function Wait-ApiReady([int]$seconds, [System.Diagnostics.Process]$process) {
    $until = (Get-Date).AddSeconds($seconds)
    do {
        if ($process -and $process.HasExited) { return $false }
        if ((Get-HttpStatus "$apiUrl/health/ready") -eq 200 -or (Test-ApiOperational)) { return $true }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $until)
    return $false
}
function Start-ApiProcess {
    $arguments = "run --no-launch-profile --project `"$apiProject`""
    return Start-Process -FilePath 'dotnet.exe' -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr -PassThru
}

Write-Host 'DispatchPro startup: PostgreSQL is not started or modified; API readiness validates its existing database.' -ForegroundColor Cyan
$apiPids = Get-ListeningPids 9010
$apiProcess = $null
$startedApi = $false
if ($apiPids.Count -gt 0) {
    if (-not (Test-ApiOperational)) { throw 'Port 9010 is occupied, but the existing API/database login route is not operational. No second API was started. Check .dispatchpro-local\logs\api.stderr.log and PostgreSQL availability.' }
    if ((Get-HttpStatus "$apiUrl/health/ready") -ne 200) { Write-Host 'Warning: strict /health/ready is 503; live API and its database-backed login query work. No database changes were attempted.' -ForegroundColor Yellow }
    Write-Host 'Existing API detected and operational on 127.0.0.1:9010; reusing it.' -ForegroundColor Green
} else {
    if (-not (Test-Path -LiteralPath $apiProject)) { throw "API project not found: $apiProject" }
    $apiProcess = Start-ApiProcess; $startedApi = $true
    if (-not (Wait-ApiReady 120 $apiProcess)) { Get-Content -LiteralPath $apiErr -Tail 30 -ErrorAction SilentlyContinue; throw 'ASP.NET API failed its /health/ready check. Frontend was not started.' }
    if ((Get-HttpStatus "$apiUrl/health/ready") -ne 200) { Write-Host 'Warning: strict /health/ready remains 503; database-backed login query succeeded. No database changes were attempted.' -ForegroundColor Yellow }
    Write-Host 'ASP.NET API process and database-backed login route are ready on 127.0.0.1:9010.' -ForegroundColor Green
}

$webPids = Get-ListeningPids 9005
if ($webPids.Count -gt 0) {
    if ((Get-HttpStatus "$webUrl/office/reception") -ne 200 -or -not (Test-ProxyRoute)) { throw 'Port 9005 is occupied by a frontend whose Reception proxy does not reach the API; no second frontend was started.' }
    Write-Host 'Existing Next.js frontend detected; Reception proxy reaches the API.' -ForegroundColor Green
} else {
    $webProcess = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run','dev') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $webOut -RedirectStandardError $webErr -PassThru
    $until = (Get-Date).AddSeconds(120); $webReady = $false
    do {
        if ($webProcess.HasExited) { Get-Content -LiteralPath $webErr -Tail 30 -ErrorAction SilentlyContinue; throw 'Next.js exited before the frontend became ready.' }
        if ((Get-HttpStatus "$webUrl/office/reception") -eq 200 -and (Test-ProxyRoute)) { $webReady = $true; break }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $until)
    if (-not $webReady) { Get-Content -LiteralPath $webErr -Tail 30 -ErrorAction SilentlyContinue; throw 'Frontend or Reception API proxy did not become ready. Inspect .dispatchpro-local\logs.' }
    Write-Host 'Next.js frontend is ready on 127.0.0.1:9005 and Reception proxy is connected.' -ForegroundColor Green
}

Start-Process "$webUrl/office/reception"
Write-Host 'Open: http://127.0.0.1:9005/office/reception' -ForegroundColor Cyan
if ($startedApi -and -not $NoWatch) {
    Write-Host 'Monitoring the API started by this launcher. One restart is allowed if its process exits.' -ForegroundColor DarkGray
    $restarted = $false
    while ($true) {
        Start-Sleep -Seconds 5
        if ($apiProcess.HasExited) {
            if (-not $restarted -and (Get-ListeningPids 9010).Count -eq 0) {
                Add-Content -LiteralPath $apiErr -Value "[$(Get-Date -Format o)] API process exited; performing the single automatic restart."
                $apiProcess = Start-ApiProcess; $restarted = $true
                if (Wait-ApiReady 120 $apiProcess) { Write-Host 'API restarted and ready.' -ForegroundColor Green; continue }
            }
            Add-Content -LiteralPath $apiErr -Value "[$(Get-Date -Format o)] API restart unavailable or failed; frontend will show API connection errors."
            Write-Host 'API stopped or failed readiness. Review .dispatchpro-local\logs\api.stderr.log; Reception requests will show a connection error.' -ForegroundColor Red
            break
        }
    }
}
