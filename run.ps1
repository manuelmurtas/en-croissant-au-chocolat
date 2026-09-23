<#
.SYNOPSIS
    Runs the compiled En Croissant application.
.PARAMETER Dev
    Optional switch to run in development mode (pnpm dev with hot reload).
#>
[CmdletBinding()]
param(
    [switch]$Dev
)

$RepoRoot = $PSScriptRoot
Set-Location $RepoRoot

# Refresh PATH if needed
$cargoBin = "$env:USERPROFILE\.cargo\bin"
if ((Test-Path $cargoBin) -and ($env:PATH -notlike "*$cargoBin*")) {
    $env:PATH = "$cargoBin;$env:PATH"
}

if ($Dev) {
    Write-Host "==> Launching En Croissant in dev mode (hot reload)..." -ForegroundColor Cyan
    pnpm dev
    exit $LASTEXITCODE
}

$exePath = Join-Path $RepoRoot "src-tauri\target\release\en-croissant.exe"

if (-not (Test-Path $exePath)) {
    Write-Host "[x] Executable not found at:" -ForegroundColor Red
    Write-Host "    $exePath" -ForegroundColor Yellow
    Write-Host "`nPlease compile the project first using .\compile.ps1 or run .\compile-and-run.ps1" -ForegroundColor Cyan
    exit 1
}

Write-Host "==> Starting En Croissant ($exePath)..." -ForegroundColor Green
Start-Process -FilePath $exePath

