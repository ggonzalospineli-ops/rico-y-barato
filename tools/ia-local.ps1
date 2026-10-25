# Arranca la IA local (Ollama) para Rico y Barato.
#
#   powershell -ExecutionPolicy Bypass -File tools\ia-local.ps1
#
# - Los modelos se guardan en F:\ollama\models (C: está lleno), solo para este proceso: no cambia
#   variables de entorno de Windows.
# - OLLAMA_ORIGINS deja que la app le hable desde localhost y desde la página publicada en GitHub Pages
#   (el navegador igual tiene que estar en ESTA compu: Ollama escucha solo en 127.0.0.1).
# - La primera vez baja el modelo (~8 GB).

param(
  [string]$Ollama = 'F:\ollama\bin\ollama.exe',   # versión portable v0.40.3 (la de F:\Descargas es vieja para gemma3)
  [string]$Model = 'gemma3:12b',
  [string]$Models = 'F:\ollama\models'
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Ollama)) { $found = Get-Command ollama -ErrorAction SilentlyContinue; if ($found) { $Ollama = $found.Source } else { throw "No encuentro ollama.exe ($Ollama)" } }
New-Item -ItemType Directory -Force $Models | Out-Null

$env:OLLAMA_MODELS = $Models
$env:OLLAMA_ORIGINS = 'http://localhost:*,http://127.0.0.1:*,https://ggonzalospineli-ops.github.io'
$env:OLLAMA_KEEP_ALIVE = '30m'   # el modelo queda cargado en la GPU media hora después del último uso

$running = $false
try { Invoke-RestMethod http://127.0.0.1:11434/api/version -TimeoutSec 2 | Out-Null; $running = $true } catch {}
if ($running) {
  Write-Host 'Ya hay un Ollama corriendo. Si arrancó sin este script, cerralo y volvé a correr este para que use F:\ollama y deje entrar a la app.'
} else {
  Start-Process -FilePath $Ollama -ArgumentList 'serve' -WindowStyle Minimized
  for ($i = 0; $i -lt 30 -and -not $running; $i++) {
    Start-Sleep -Milliseconds 500
    try { Invoke-RestMethod http://127.0.0.1:11434/api/version -TimeoutSec 2 | Out-Null; $running = $true } catch {}
  }
  if (-not $running) { throw 'Ollama no arrancó' }
}

$have = (& $Ollama list) -match [regex]::Escape($Model)
if (-not $have) { Write-Host "Bajando $Model (una sola vez)..."; & $Ollama pull $Model }
Write-Host "Listo: IA local en http://127.0.0.1:11434 con $Model. En la app: Ajustes → IA → Local."
