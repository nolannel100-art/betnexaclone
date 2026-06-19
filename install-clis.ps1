<#
Install GitHub CLI, Vercel CLI, and Supabase CLI on Windows.
Run this script from PowerShell as Administrator if needed.
#>

Set-StrictMode -Version Latest

function Test-CommandExists {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-WithWinget {
    param(
        [string]$Id,
        [string]$Name
    )

    Write-Host "Installing $Name via winget..." -ForegroundColor Cyan
    $args = @('install', '--id', $Id, '-e', '--accept-source-agreements', '--accept-package-agreements')
    $process = Start-Process -FilePath winget -ArgumentList $args -NoNewWindow -Wait -PassThru -ErrorAction SilentlyContinue
    if ($process.ExitCode -ne 0) {
        Write-Host "Failed to install $Name with winget (exit code $($process.ExitCode))." -ForegroundColor Red
        return $false
    }
    return $true
}

function Check-Installed {
    param(
        [string]$Exe,
        [string]$Name
    )

    if (Test-CommandExists $Exe) {
        Write-Host "$Name is already installed." -ForegroundColor Green
        return $true
    }
    Write-Host "$Name is not installed." -ForegroundColor Yellow
    return $false
}

Write-Host "Starting CLI installation helper..." -ForegroundColor Green

$wingetAvailable = Test-CommandExists 'winget'
$npmAvailable = Test-CommandExists 'npm'

if (-not $wingetAvailable -and -not $npmAvailable) {
    Write-Host "ERROR: Neither winget nor npm is available on PATH." -ForegroundColor Red
    Write-Host "Install winget or Node/npm and rerun this script." -ForegroundColor Red
    exit 1
}

$installedAny = $false

if (Test-CommandExists 'gh') {
    Write-Host "GitHub CLI already present." -ForegroundColor Green
    $installedAny = $true
}
if (Test-CommandExists 'vercel') {
    Write-Host "Vercel CLI already present." -ForegroundColor Green
    $installedAny = $true
}
if (Test-CommandExists 'supabase') {
    Write-Host "Supabase CLI already present." -ForegroundColor Green
    $installedAny = $true
}

if ($installedAny) {
    Write-Host "`nAlready installed CLIs will be skipped when possible." -ForegroundColor Green
}

if ($wingetAvailable) {
    if (-not (Test-CommandExists 'gh')) {
        if (-not (Install-WithWinget -Id 'GitHub.cli' -Name 'GitHub CLI')) {
            Write-Host "Try installing GitHub CLI from https://cli.github.com/manual/installation" -ForegroundColor Yellow
        }
    }
    if (-not (Test-CommandExists 'vercel')) {
        if (-not (Install-WithWinget -Id 'Vercel.Vercel' -Name 'Vercel CLI')) {
            Write-Host "Verify the Vercel package ID or install via npm: npm install -g vercel" -ForegroundColor Yellow
        }
    }
    if (-not (Test-CommandExists 'supabase')) {
        if (-not (Install-WithWinget -Id 'Supabase.supabase' -Name 'Supabase CLI')) {
            Write-Host "Verify the Supabase package ID or install via npm: npm install -g supabase" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "winget is not available; trying npm for Vercel and Supabase." -ForegroundColor Yellow
    if ($npmAvailable) {
        if (-not (Test-CommandExists 'vercel')) {
            Write-Host "Installing Vercel CLI via npm..." -ForegroundColor Cyan
            npm install -g vercel
        }
        if (-not (Test-CommandExists 'supabase')) {
            Write-Host "Installing Supabase CLI via npm..." -ForegroundColor Cyan
            npm install -g supabase
        }
        Write-Host "GitHub CLI must be installed separately if npm cannot install it." -ForegroundColor Yellow
    }
}

Write-Host "`nInstallation script complete." -ForegroundColor Green
Write-Host "Verify installed tools with:" -ForegroundColor Cyan
Write-Host "  gh --version" -ForegroundColor White
Write-Host "  vercel --version" -ForegroundColor White
Write-Host "  supabase --version" -ForegroundColor White
