<#
PowerShell helper to authenticate Vercel, Supabase, and GitHub CLI using browser login.
Use this when Chrome is already signed in to the desired account.
#>

Set-StrictMode -Version Latest

function Test-CommandExists {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Run-Login {
    param(
        [string]$Name,
        [string]$Command,
        [string]$Args
    )

    Write-Host "`n=== $Name CLI login ===" -ForegroundColor Cyan
    Write-Host "Command: $Command $Args" -ForegroundColor White
    Write-Host "If Chrome is already signed in with the correct account, use that browser window when prompted." -ForegroundColor Yellow

    try {
        & $Command $Args
    } catch {
        Write-Host "Failed to execute $Name login. Make sure the $Name CLI is installed and available on PATH." -ForegroundColor Red
        throw
    }
}

$cliTools = @{
    'Vercel' = 'vercel'
    'Supabase' = 'supabase'
    'GitHub CLI' = 'gh'
}

foreach ($tool in $cliTools.GetEnumerator()) {
    if (-not (Test-CommandExists $tool.Value)) {
        Write-Host "ERROR: $($tool.Key) CLI not found: $($tool.Value)" -ForegroundColor Red
        Write-Host "Install it before running this script." -ForegroundColor Red
        exit 1
    }
}

Write-Host "Using Chrome browser login for CLI authentication." -ForegroundColor Green
Write-Host "If Chrome is not your default browser, make sure the web auth flow opens Chrome or use your default browser session." -ForegroundColor Green

# Ensure browser env var is set for Node-based CLIs that respect BROWSER
$env:BROWSER = 'chrome'

Run-Login -Name 'Vercel' -Command 'vercel' -Args 'login'
Run-Login -Name 'Supabase' -Command 'supabase' -Args 'login'
Run-Login -Name 'GitHub' -Command 'gh' -Args 'auth login --web'

Write-Host "`n✅ All requested CLI login flows have been launched." -ForegroundColor Green
Write-Host "Complete the browser prompts in Chrome to finish authentication." -ForegroundColor Green
