# MeshForge Windows setup. Launched by setup_windows.bat. Plain ASCII on purpose (PowerShell 5.1).
# 'Continue' on purpose: in PS 5.1, 'Stop' turns any stderr text from py/pip/git into a fatal error.
# Every native command is checked via $LASTEXITCODE instead.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'   # makes Invoke-WebRequest much faster on PS 5.1
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root
$TripoSHA = '107cefdc244c39106fa830359024f6a2f1c78871'   # TripoSR commit tested on Linux
$TripoDir = Join-Path $Root 'third_party\TripoSR'
$Venv     = Join-Path $Root '.venv'
$VPy      = Join-Path $Venv 'Scripts\python.exe'
$Marker   = Join-Path $Venv 'meshforge_setup_ok.txt'
$Constr   = Join-Path $Root 'windows-constraints.txt'

function Step($n, $msg) { Write-Host ''; Write-Host "[$n/8] $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "      OK: $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "      NOTE: $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host ''; Write-Host "SETUP STOPPED: $msg" -ForegroundColor Red; Write-Host 'See WINDOWS.md > Troubleshooting. Run diagnose_windows.bat and send diagnose.txt.'; exit 1 }
function Run($exe, [string[]]$argv, $what) {
    & $exe @argv
    if ($LASTEXITCODE -ne 0) { Fail "$what failed (exit code $LASTEXITCODE). Scroll up for the first red error line." }
}
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Has-Winget { return [bool](Get-Command winget -ErrorAction SilentlyContinue) }

Write-Host '=============================================' -ForegroundColor Cyan
Write-Host ' MeshForge setup for Windows' -ForegroundColor Cyan
Write-Host " Folder: $Root"
Write-Host ' Needs internet, ~8 GB free disk, 15-40 minutes.'
Write-Host '=============================================' -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath (Join-Path $Root 'meshforge\server.py'))) {
    Fail 'meshforge\server.py not found. Extract the WHOLE zip first (right-click > Extract All), then run setup_windows.bat from the extracted folder.'
}

# ---------- 1. Python 3.10-3.12 ----------
Step 1 'Looking for Python 3.11 / 3.12 / 3.10'
function Find-Python {
    foreach ($v in @('3.11', '3.12', '3.10')) {
        if (Get-Command py -ErrorAction SilentlyContinue) {
            $p = & py "-$v" -c "import sys; print(sys.executable)" 2>$null
            if ($LASTEXITCODE -eq 0 -and $p) { return $p.Trim() }
        }
        $nv = $v.Replace('.', '')
        foreach ($c in @("$env:LOCALAPPDATA\Programs\Python\Python$nv\python.exe", "$env:ProgramFiles\Python$nv\python.exe")) {
            if (Test-Path -LiteralPath $c) { return $c }
        }
    }
    return $null
}
$Py = Find-Python
if (-not $Py) {
    Warn 'No suitable Python found (3.13+ is skipped on purpose: some 3D wheels are missing for it).'
    if (Has-Winget) {
        Write-Host '      Installing Python 3.11 with winget (accept any prompts)...'
        & winget install -e --id Python.Python.3.11 --scope user --accept-package-agreements --accept-source-agreements
        Refresh-Path
        $Py = Find-Python
    }
    if (-not $Py) {
        Fail ('Could not install Python automatically. Install Python 3.11 from https://www.python.org/downloads/release/python-3119/ ' +
              '("Windows installer (64-bit)"), tick "Add python.exe to PATH", then run setup_windows.bat again.')
    }
}
$PyVer = & $Py -c "import sys; print('%d.%d' % sys.version_info[:2])"
Ok "Python $PyVer at $Py"

# ---------- 2. TripoSR source ----------
Step 2 'Getting TripoSR source code'
if (Test-Path -LiteralPath (Join-Path $TripoDir 'tsr\system.py')) {
    Ok 'already present'
} else {
    if (Test-Path -LiteralPath $TripoDir) { Remove-Item -LiteralPath $TripoDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path (Join-Path $Root 'third_party') | Out-Null
    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git -and (Has-Winget)) {
        Write-Host '      Git not found, installing with winget...'
        & winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements
        Refresh-Path
        $git = Get-Command git -ErrorAction SilentlyContinue
        if (-not $git -and (Test-Path "$env:ProgramFiles\Git\cmd\git.exe")) { $git = Get-Item "$env:ProgramFiles\Git\cmd\git.exe" }
    }
    $got = $false
    if ($git) {
        $g = if ($git.Source) { $git.Source } else { $git.FullName }
        & $g clone https://github.com/VAST-AI-Research/TripoSR.git "$TripoDir"
        if ($LASTEXITCODE -eq 0) {
            & $g -C "$TripoDir" checkout -q $TripoSHA
            if ($LASTEXITCODE -ne 0) { Warn 'tested commit not found, using latest TripoSR' }
            $got = $true
        } else { Warn 'git clone failed, trying ZIP download' }
    }
    if (-not $got) {
        $zip = Join-Path $env:TEMP 'meshforge_triposr.zip'
        $tmp = Join-Path $env:TEMP 'meshforge_triposr_x'
        if (Test-Path -LiteralPath $TripoDir) { Remove-Item -LiteralPath $TripoDir -Recurse -Force }
        try {
            $ErrorActionPreference = 'Stop'
            Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/VAST-AI-Research/TripoSR/archive/$TripoSHA.zip" -OutFile $zip
            if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
            Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
            $inner = Get-ChildItem -LiteralPath $tmp -Directory | Select-Object -First 1
            Move-Item -LiteralPath $inner.FullName -Destination $TripoDir
            Remove-Item -LiteralPath $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
        } catch { Fail "Could not download TripoSR: $($_.Exception.Message)" }
        $ErrorActionPreference = 'Continue'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $TripoDir 'tsr\system.py'))) { Fail 'TripoSR download looks incomplete.' }
    Ok 'TripoSR ready'
}

# ---------- 3. venv ----------
Step 3 'Creating the private Python environment (.venv)'
if (-not (Test-Path -LiteralPath $VPy)) { Run $Py @('-m', 'venv', $Venv) 'Creating .venv' }
Run $VPy @('-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel') 'Upgrading pip'
Ok '.venv ready'

# ---------- 4. PyTorch ----------
$HasNv = [bool](Get-Command nvidia-smi -ErrorAction SilentlyContinue)
if ($HasNv) {
    Step 4 'Installing PyTorch with CUDA 12.1 (about 2.5 GB download, be patient)'
    & nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader
    Run $VPy @('-m', 'pip', 'install', 'torch==2.5.1', 'torchvision==0.20.1', '--index-url', 'https://download.pytorch.org/whl/cu121') 'Installing CUDA PyTorch'
} else {
    Step 4 'Installing PyTorch (CPU only - nvidia-smi was not found, so no NVIDIA GPU/driver detected)'
    Warn 'Generation will be slow (~30-60 s). Install/update the NVIDIA driver and re-run setup to use the GPU.'
    Run $VPy @('-m', 'pip', 'install', 'torch==2.5.1', 'torchvision==0.20.1', '--index-url', 'https://download.pytorch.org/whl/cpu') 'Installing CPU PyTorch'
}

# ---------- 5. requirements ----------
Step 5 'Installing MeshForge + TripoSR packages'
Run $VPy @('-m', 'pip', 'install', '-r', (Join-Path $Root 'requirements.txt'), '-c', $Constr) 'Installing requirements.txt'

# ---------- 6. rembg / onnxruntime ----------
Step 6 'Installing background remover (rembg + onnxruntime)'
$ortOk = $false
if ($HasNv) {
    & $VPy -m pip install 'rembg[gpu]' onnxruntime-gpu -c $Constr
    if ($LASTEXITCODE -eq 0) { $ortOk = $true; Ok 'GPU onnxruntime installed' } else { Warn 'GPU onnxruntime failed, using CPU version (fine, background removal is quick)' }
}
if (-not $ortOk) {
    & $VPy -m pip uninstall -y onnxruntime-gpu 2>$null | Out-Null
    Run $VPy @('-m', 'pip', 'install', 'rembg[cpu]', 'onnxruntime', '-c', $Constr) 'Installing rembg (CPU)'
}
# ORT memory-arena settings (enable_cpu_mem_arena/enable_mem_pattern = False) are applied in
# meshforge\preprocess.py at runtime, identical on Windows and Linux; nothing to configure here.

# ---------- 7. torchmcubes ----------
Step 7 'Installing marching-cubes helper (torchmcubes shim)'
# The real torchmcubes is a C++/CUDA extension built from source; on Windows that needs
# Visual Studio Build Tools + the CUDA toolkit and usually fails. The shim gives TripoSR the same
# function using scikit-image instead, with identical results and ~1 s extra per model.
$Site = (& $VPy -c "import sysconfig; print(sysconfig.get_paths()['purelib'])").Trim()
Copy-Item -LiteralPath (Join-Path $Root 'torchmcubes_shim.py') -Destination (Join-Path $Site 'torchmcubes.py') -Force
Ok "shim copied to $Site"

# ---------- 8. self-test ----------
Step 8 'Checking everything imports'
$env:PYTHONUTF8 = '1'
$check = "import sys; sys.path.insert(0, r'$TripoDir'); import torch, torchmcubes, rembg, onnxruntime, trimesh, skimage, fastapi, uvicorn, tsr.system; " +
         "print('torch', torch.__version__, '| CUDA available:', torch.cuda.is_available(), '|', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"
Run $VPy @('-c', $check) 'Import self-test'
if ($HasNv) {
    $cuda = (& $VPy -c "import torch; print(torch.cuda.is_available())").Trim()
    if ($cuda -ne 'True') { Warn 'PyTorch cannot see the GPU. Update the NVIDIA driver (WINDOWS.md, step 2). The app will still run on CPU.' }
}
"setup ok $(Get-Date -Format s) python $PyVer" | Out-File -LiteralPath $Marker -Encoding ascii

Write-Host ''
Write-Host '=============================================' -ForegroundColor Green
Write-Host ' Setup finished. Now double-click run_windows.bat' -ForegroundColor Green
Write-Host ' (The first generation also downloads the ~1.7 GB TripoSR model once.)'
Write-Host '=============================================' -ForegroundColor Green
exit 0
