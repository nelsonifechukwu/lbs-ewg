# bin\setup.ps1 — bootstrap LBS on Windows (PowerShell).
#
# Sets up the app (Python venv, npm deps). Data protection layers are macOS-
# only and are NOT installed here. To actually run the app you also need a
# bash shell — Git Bash (ships with Git for Windows) or WSL2.
#
# Idempotent. Re-run any time.

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

function Log  ($m) { Write-Host "[setup] $m" -ForegroundColor Cyan }
function Warn ($m) { Write-Host "[warn ] $m" -ForegroundColor Yellow }
function Err  ($m) { Write-Host "[error] $m" -ForegroundColor Red }

# ---------- Python ----------
Log "Looking for Python 3.10+..."
$python = $null
foreach ($cand in @("python3.13", "python3.12", "python3.11", "python3.10", "py", "python")) {
    if (Get-Command $cand -ErrorAction SilentlyContinue) {
        try {
            $ver = & $cand -c "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')" 2>$null
        } catch { continue }
        if ($ver -match "^3\.(1\d|[2-9]\d)$") {
            $python = $cand
            break
        }
    }
}
if (-not $python) {
    Err "Python 3.10+ not found. Install from https://www.python.org/downloads/"
    exit 1
}
Log "  using $python"

# ---------- Node ----------
Log "Looking for Node..."
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Err "Node not found. Install from https://nodejs.org/"
    exit 1
}
Log "  using node $(node --version)"

# ---------- Backend ----------
Log "Setting up backend venv..."
if (-not (Test-Path "backend/.venv")) {
    & $python -m venv "backend/.venv"
}
& "backend/.venv/Scripts/pip.exe" install --upgrade pip --quiet
& "backend/.venv/Scripts/pip.exe" install -r "backend/requirements.txt" --quiet
Log "  backend/.venv ready"

# ---------- Frontend ----------
Log "Installing frontend deps..."
Push-Location "frontend"
npm install --silent
Pop-Location
Log "  frontend/node_modules ready"

# ---------- Notes ----------
Warn ""
Warn "Data protection (launchd hooks + iCloud sync) is macOS-only and was NOT installed."
Warn "Windows equivalents if you want them:"
Warn "  - hourly backups:    Task Scheduler running bin\backup via Git Bash/WSL"
Warn "  - cross-machine sync: OneDrive/Dropbox on backend\lbs.db (use a symlink: mklink)"

Log ""
Log "Setup complete."
Log "Start the app with:  bash bin/dev   (Git Bash or WSL required — bin/dev is a bash script)"
