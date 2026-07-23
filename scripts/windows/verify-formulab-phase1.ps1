<#
.SYNOPSIS
  Launches the packaged FormuLab desktop app and verifies it produces a
  real native window - nothing more, and it says so explicitly.

.DESCRIPTION
  This script verifies exactly two things, and labels each honestly:

    - "Launch verified"  - the process starts and stays running.
    - "Window verified"  - a real top-level window exists with a title
                            containing "FormuLab".

  It does NOT click anything inside the app, and does not claim to. See
  docs/TAURI_LIVE_VERIFICATION.md for what native mouse/keyboard-driven UI
  interaction was separately attempted (manually, in an interactive
  session) and its own honest limits. Automated UI interaction from this
  script is explicitly "Manual interaction required" - see the summary
  this script prints at the end.

.PARAMETER ExePath
  Path to ai4s-workbench.exe. Defaults to the debug build location.

.PARAMETER TimeoutSeconds
  How long to wait for the window to appear before failing.

.PARAMETER KeepOpen
  If set, leaves the app running after verification instead of closing it.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\verify-formulab-phase1.ps1
#>
param(
  [string]$ExePath = "$PSScriptRoot\..\..\apps\desktop\src-tauri\target\debug\ai4s-workbench.exe",
  [int]$TimeoutSeconds = 15,
  [switch]$KeepOpen
)

$ErrorActionPreference = "Stop"

$logDir = Join-Path $PSScriptRoot "verification-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $logDir "verify-$timestamp.log"

function Write-Log {
  param([string]$Message)
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
  Write-Output $line
  Add-Content -Path $logPath -Value $line
}

Write-Log "FormuLab Phase 1 native verification starting."
Write-Log "Executable: $ExePath"

if (-not (Test-Path $ExePath)) {
  Write-Log "FAIL: executable not found. Build it first:"
  Write-Log "  pnpm --filter @ai4s/desktop build"
  Write-Log "  pnpm --filter @ai4s/desktop exec tauri build --debug --no-bundle"
  exit 1
}
Write-Log "Level 1 - Launch verified: PENDING (executable located, not yet started)"

$resolvedExe = (Resolve-Path $ExePath).Path
$proc = $null
try {
  $proc = Start-Process -FilePath $resolvedExe -PassThru
} catch {
  Write-Log "FAIL: Start-Process threw: $($_.Exception.Message)"
  exit 1
}

Start-Sleep -Seconds 1
$stillRunning = $null -ne (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue)
if (-not $stillRunning) {
  Write-Log "FAIL: process exited immediately after launch (crash on startup)."
  exit 1
}
Write-Log "Level 1 - Launch verified: PASS (PID $($proc.Id) running)"

Write-Log "Level 2 - Window verified: PENDING (waiting up to $TimeoutSeconds s for a top-level window)"
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$windowTitle = $null
$windowHandle = [IntPtr]::Zero
while ((Get-Date) -lt $deadline) {
  $p = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
  if (-not $p) {
    Write-Log "FAIL: process exited while waiting for its window."
    exit 1
  }
  $p.Refresh()
  if ($p.MainWindowHandle -ne [IntPtr]::Zero -and $p.MainWindowTitle) {
    $windowTitle = $p.MainWindowTitle
    $windowHandle = $p.MainWindowHandle
    break
  }
  Start-Sleep -Milliseconds 300
}

if (-not $windowTitle) {
  Write-Log "FAIL: no top-level window appeared within $TimeoutSeconds s."
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  exit 1
}

if ($windowTitle -notmatch "FormuLab") {
  Write-Log "FAIL: window title '$windowTitle' does not contain 'FormuLab'."
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  exit 1
}

Write-Log "Level 2 - Window verified: PASS (title '$windowTitle', handle $windowHandle, PID $($proc.Id))"

if ($KeepOpen) {
  Write-Log "KeepOpen set - leaving the app running (PID $($proc.Id)). Close it manually when done."
} else {
  Start-Sleep -Seconds 1
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  $closed = $null -eq (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue)
  if ($closed) {
    Write-Log "Cleanly closed the app after verification (PID $($proc.Id))."
  } else {
    Write-Log "WARNING: app did not confirm closure; check for a lingering process."
  }
}

Write-Log ""
Write-Log "=== Summary ==="
Write-Log "Launch verified:                   PASS"
Write-Log "Window verified:                   PASS"
Write-Log "Automated UI interaction verified: NOT PERFORMED BY THIS SCRIPT"
Write-Log "Manual interaction required:       YES - see docs/APPROVAL_MANUAL_SMOKE_TEST.md"
Write-Log ""
Write-Log "This script proves the packaged app starts and shows a real window."
Write-Log "It does not prove any button, tab, or form inside FormuLab works."
Write-Log "Log written to: $logPath"

exit 0
