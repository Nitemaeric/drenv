#Requires -Version 5.1

<#
.SYNOPSIS
    drenv - The DragonRuby version manager installer for Windows.

.DESCRIPTION
    Downloads the latest drenv release for Windows and installs it to
    $env:USERPROFILE\.drenv\bin. It also adds the directory to your
    user PATH so you can run 'drenv' from any terminal.

.USAGE
    # Recommended (from PowerShell or Windows Terminal)
    irm https://drenv.org/install.ps1 | iex

    # Or directly from GitHub
    irm https://raw.githubusercontent.com/Nitemaeric/drenv/main/install.ps1 | iex

    # macOS / Linux alternative:
    #   curl -fsSL drenv.org/install.sh | bash

.LINK
    https://github.com/Nitemaeric/drenv
#>

$ErrorActionPreference = 'Stop'

$Repo = "Nitemaeric/drenv"
$InstallDir = "$env:USERPROFILE\.drenv\bin"
$ExeName = "drenv.exe"

function Write-Header {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

Write-Header "Installing drenv for Windows..."

# Only support 64-bit Windows for now
if (-not [Environment]::Is64BitOperatingSystem) {
    Write-Error "drenv only supports 64-bit versions of Windows at this time."
    exit 1
}

$Asset = "x86_64-pc-windows-msvc.drenv.exe"
$DownloadUrl = "https://github.com/$Repo/releases/latest/download/$Asset"

Write-Header "Downloading $Asset..."

# Ensure install directory exists
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

try {
    Invoke-WebRequest `
        -Uri $DownloadUrl `
        -OutFile "$InstallDir\$ExeName" `
        -UseBasicParsing `
        -ErrorAction Stop
} catch {
    Write-Error "Failed to download drenv: $_"
    exit 1
}

# Update User PATH if necessary
$CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($CurrentPath -notlike "*$InstallDir*") {
    $NewPath = "$CurrentPath;$InstallDir".TrimStart(';')
    [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
    Write-Host "`n==> Added $InstallDir to your user PATH." -ForegroundColor Green
    Write-Host "    You will need to restart your terminal (or open a new one) for the change to take effect." -ForegroundColor Yellow
} else {
    Write-Host "`n==> $InstallDir is already in your PATH." -ForegroundColor Green
}

Write-Host "`n==> drenv has been installed successfully!" -ForegroundColor Green
Write-Host "    Location: $InstallDir\$ExeName`n" -ForegroundColor White
Write-Host "Run 'drenv --help' to get started.`n" -ForegroundColor Cyan
