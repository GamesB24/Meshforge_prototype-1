# Writes diagnose.txt. Started by diagnose_windows.bat.
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root
$VPy = Join-Path $Root '.venv\Scripts\python.exe'
$env:PYTHONUTF8 = '1'
if (Test-Path -LiteralPath $VPy) {
    & $VPy (Join-Path $Root 'scripts\diagnose.py')
} else {
    $lines = @('MeshForge diagnose: .venv not found - setup_windows.bat has not finished.')
    $lines += 'py launcher: ' + ((& py --list 2>&1) -join ' ; ')
    $lines += 'nvidia-smi: ' + ((& nvidia-smi 2>&1) -join "`r`n")
    $lines | Out-File -LiteralPath (Join-Path $Root 'diagnose.txt') -Encoding utf8
    $lines | ForEach-Object { Write-Host $_ }
}
Write-Host ''
Write-Host "Send this file: $(Join-Path $Root 'diagnose.txt')" -ForegroundColor Green
