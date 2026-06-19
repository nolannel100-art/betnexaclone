$ErrorActionPreference = 'Stop'

$url = 'https://github.com/cli/cli/releases/download/v2.95.0/gh_2.95.0_windows_amd64.msi'
$out = Join-Path $env:TEMP 'gh.msi'
Write-Host "Downloading GH MSI to $out..."
Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing

Write-Host "Running installer (may prompt for elevation)..."
Start-Process msiexec -ArgumentList @('/i', $out, '/qn') -Wait -Verb runAs

$exe = 'C:\Program Files\GitHub CLI\gh.exe'
if (Test-Path $exe) {
    Write-Host "Installed GH at $exe"
    & $exe --version
    Write-Host "Launching web auth (browser will open)..."
    & $exe auth login --web
} else {
    Write-Host "gh install did not place binary at expected path: $exe" -ForegroundColor Red
    Exit 1
}