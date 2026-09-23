<#
.SYNOPSIS
    Compiles En Croissant from source.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RepoRoot = $PSScriptRoot
Set-Location $RepoRoot

# Ensure Rust/Cargo and newly installed tools are in PATH
$cargoBin = "$env:USERPROFILE\.cargo\bin"
if ((Test-Path $cargoBin) -and ($env:PATH -notlike "*$cargoBin*")) {
    $env:PATH = "$cargoBin;$env:PATH"
}

Write-Host "==> Compiling En Croissant..." -ForegroundColor Cyan

# Check if pnpm is available
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    # Try refreshing PATH from registry
    $env:PATH = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    if ((Test-Path $cargoBin) -and ($env:PATH -notlike "*$cargoBin*")) {
        $env:PATH = "$cargoBin;$env:PATH"
    }
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "Error: 'pnpm' command was not found in PATH." -ForegroundColor Red
    exit 1
}

# Run the build (frontend Vite + backend Rust release)
pnpm build

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[x] Build failed with exit code $LASTEXITCODE." -ForegroundColor Red
    exit $LASTEXITCODE
}

$exePath = Join-Path $RepoRoot "src-tauri\target\release\en-croissant.exe"
if (Test-Path $exePath) {
    Write-Host "`n[+] Build successful!" -ForegroundColor Green
    Write-Host "    Executable: $exePath" -ForegroundColor Gray
} else {
    Write-Host "`n[!] Build command completed, but $exePath was not found." -ForegroundColor Yellow
}

