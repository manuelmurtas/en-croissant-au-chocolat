<#
.SYNOPSIS
    Compiles En Croissant and launches the compiled executable.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RepoRoot = $PSScriptRoot

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   Step 1: Compiling En Croissant         " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

& "$RepoRoot\compile.ps1"

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[x] Compilation failed. Run aborted." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "`n==========================================" -ForegroundColor Green
Write-Host "   Step 2: Launching Application          " -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green

& "$RepoRoot\run.ps1"

