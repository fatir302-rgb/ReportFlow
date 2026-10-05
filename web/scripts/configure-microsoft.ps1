$ErrorActionPreference = "Stop"

$envPath = Join-Path (Get-Location) ".env.local"
$tempPath = "$envPath.reportflow-tmp"

if (-not (Test-Path -LiteralPath $envPath)) {
    throw ".env.local is missing"
}

$secureSecret = Read-Host "Paste the Microsoft client secret VALUE" -AsSecureString
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
try {
    $clientSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
}

if ([string]::IsNullOrWhiteSpace($clientSecret) -or $clientSecret.Length -lt 8) {
    throw "The client secret value is missing or unexpectedly short"
}

$lines = [IO.File]::ReadAllLines($envPath)
$secretUpdated = $false
$bypassUpdated = $false
for ($index = 0; $index -lt $lines.Length; $index++) {
    if ($lines[$index].StartsWith("AUTH_MICROSOFT_ENTRA_ID_SECRET=")) {
        $lines[$index] = "AUTH_MICROSOFT_ENTRA_ID_SECRET=$clientSecret"
        $secretUpdated = $true
    }
    if ($lines[$index].StartsWith("DEV_BYPASS_AUTH=")) {
        $lines[$index] = "DEV_BYPASS_AUTH=false"
        $bypassUpdated = $true
    }
}

if (-not $secretUpdated -or -not $bypassUpdated) {
    throw "Required Microsoft authentication settings are missing from .env.local"
}

$utf8WithoutBom = New-Object Text.UTF8Encoding($false)
try {
    [IO.File]::WriteAllLines($tempPath, $lines, $utf8WithoutBom)
    Copy-Item -LiteralPath $tempPath -Destination $envPath -Force
} finally {
    if (Test-Path -LiteralPath $tempPath) {
        Remove-Item -LiteralPath $tempPath -Force
    }
    $clientSecret = $null
}

Write-Host "Microsoft sign-in configuration saved. Restart ReportFlow before testing login."
