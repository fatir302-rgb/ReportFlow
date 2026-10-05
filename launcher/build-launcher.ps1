$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$webRoot = Join-Path $repoRoot "web"
$source = Join-Path $PSScriptRoot "ReportFlowLauncher.cs"
$output = Join-Path $repoRoot "ReportFlow.exe"
$iconBuilder = Join-Path $PSScriptRoot "build-icon.mjs"
$icon = Join-Path $PSScriptRoot "assets\reportflow.ico"
$compiler = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (-not (Test-Path -LiteralPath $compiler)) {
  $compiler = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path -LiteralPath $compiler)) {
  throw "The Windows C# compiler was not found. Enable .NET Framework 4.x and try again."
}

& node $iconBuilder
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $icon)) {
  throw "The ReportFlow icon build failed."
}

Push-Location $webRoot
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "The ReportFlow production build failed." }
} finally {
  Pop-Location
}

& $compiler /nologo /target:winexe /optimize+ "/out:$output" "/win32icon:$icon" /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll $source
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $output)) {
  throw "The ReportFlow launcher compilation failed."
}

Write-Host "Created $output"
