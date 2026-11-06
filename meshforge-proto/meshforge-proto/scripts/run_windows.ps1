# MeshForge launcher. Started by run_windows.bat. Plain ASCII on purpose (PowerShell 5.1).
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root
$VPy = Join-Path $Root '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $VPy) -or -not (Test-Path -LiteralPath (Join-Path $Root '.venv\meshforge_setup_ok.txt'))) {
    Write-Host 'MeshForge is not set up yet (or setup did not finish).' -ForegroundColor Red
    Write-Host 'Double-click setup_windows.bat first, wait for "Setup finished", then run this again.'
    exit 1
}
$Port = 8000
if ($env:MESHFORGE_PORT) { $Port = [int]$env:MESHFORGE_PORT }
$l = $null
try { $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port); $l.Start(); $l.Stop() }
catch {
    Write-Host "Port $Port is already in use. MeshForge may already be running in another window -" -ForegroundColor Yellow
    Write-Host "opening http://127.0.0.1:$Port . If that page doesn't load, close the other program or see WINDOWS.md (Port in use)."
    Start-Process "http://127.0.0.1:$Port"
    exit 1
}
$env:MESHFORGE_PORT = "$Port"
$env:MESHFORGE_OPEN_BROWSER = '1'
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
# Keep the downloaded AI models inside this folder, so deleting the folder uninstalls everything.
$env:HF_HOME = Join-Path $Root 'models\huggingface'
$env:U2NET_HOME = Join-Path $Root 'models\u2net'
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = '1'
$env:TRIPOSR_DIR = Join-Path $Root 'third_party\TripoSR'
Write-Host "MeshForge is starting on http://127.0.0.1:$Port (your browser opens in a moment)." -ForegroundColor Green
Write-Host 'Keep this window open while you use it. Close it or press Ctrl+C to stop.'
& $VPy -m meshforge.server
exit $LASTEXITCODE
