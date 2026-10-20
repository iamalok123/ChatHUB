$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$venvPython = Join-Path $PSScriptRoot "backend/.venv/Scripts/python.exe"
$requirements = Join-Path $PSScriptRoot "backend/requirements.txt"
$marker = Join-Path $PSScriptRoot "backend/.venv/.requirements-hash"

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot ".env"))) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot ".env.example") -Destination (Join-Path $PSScriptRoot ".env")
    Write-Host "Created .env from .env.example. Add GEMINI_API_KEY for live mode; mock mode works without it."
}

Get-Content -LiteralPath (Join-Path $PSScriptRoot ".env") | ForEach-Object {
    if ($_ -match "^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$") {
        $name = $matches[1]
        $value = $matches[2].Trim()
        Set-Item -Path "Env:$name" -Value $value
    }
}

$backendPort = if ($env:BACKEND_PORT) { [int]$env:BACKEND_PORT } else { 8000 }
$frontendPort = if ($env:FRONTEND_PORT) { [int]$env:FRONTEND_PORT } else { 5173 }

if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Host "Creating Python 3.12 virtual environment..."
    py -3.12 -m venv (Join-Path $PSScriptRoot "backend/.venv")
}

$currentHash = (Get-FileHash -LiteralPath $requirements -Algorithm SHA256).Hash
$previousHash = if (Test-Path -LiteralPath $marker) { Get-Content -LiteralPath $marker -Raw } else { "" }
if ($currentHash.Trim() -ne $previousHash.Trim()) {
    Write-Host "Installing backend dependencies..."
    & $venvPython -m pip install --disable-pip-version-check -r $requirements
    Set-Content -LiteralPath $marker -Value $currentHash
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "frontend/node_modules"))) {
    Write-Host "Installing frontend dependencies..."
    npm --prefix frontend install
}

New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot "data") | Out-Null

Write-Host "Starting ChatHUB backend on http://127.0.0.1:$backendPort ..."
$backend = Start-Process -FilePath $venvPython `
    -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$backendPort", "--app-dir", "backend") `
    -WorkingDirectory $PSScriptRoot `
    -NoNewWindow -PassThru

try {
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$backendPort/api/health" -TimeoutSec 2
            if ($health.status -eq "ok") {
                $ready = $true
                Write-Host "Backend ready ($($health.llm_mode) mode)."
                break
            }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $ready) {
        throw "Backend did not become healthy. Check the output above."
    }

    Write-Host "Starting ChatHUB UI on http://127.0.0.1:$frontendPort ..."
    Write-Host "Press Ctrl+C to stop both servers."
    & npm --prefix frontend run dev
}
finally {
    if ($backend -and -not $backend.HasExited) {
        Write-Host "Stopping backend..."
        Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
    }
}
