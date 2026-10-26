# Actualización diaria automática: baja Rappi, regenera el catálogo, corre los tests y, si cambiaron
# los datos, los commitea y los sube a GitHub (GitHub Pages publica solo). Deja todo en .cache\publicar.log.
#
#   powershell -ExecutionPolicy Bypass -File tools\publicar.ps1
#
# Tarea programada (todos los días a las 12:30; la crea tools\programar.ps1):
#   schtasks /Query /TN "Rico y Barato - actualizar"

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
New-Item -ItemType Directory -Force .cache | Out-Null
$log = Join-Path $root '.cache\publicar.log'
function Log($msg) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Out-File -Append -Encoding utf8 $log }

try {
  Log 'Inicio'
  # Si hay cambios de código sin commitear, no se toca nada: la publicación es solo de datos.
  $dirty = git status --porcelain -- . ':!data' ':!.cache'
  if ($dirty) { throw "Hay cambios sin commitear fuera de data/: $($dirty -join ', ')" }
  git pull --ff-only --quiet
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo traer lo último de GitHub (git pull)' }

  & (Join-Path $PSScriptRoot 'actualizar.ps1') *>&1 | Out-File -Append -Encoding utf8 $log

  git add data
  git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) { Log 'Sin cambios en los datos'; exit 0 }
  git commit --quiet -m "Datos de Rappi del $(Get-Date -Format 'yyyy-MM-dd')"
  git push --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Falló el push' }
  Log 'Publicado'
} catch {
  Log "ERROR: $_"
  exit 1
}
