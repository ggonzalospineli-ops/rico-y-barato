# Actualiza precios, horarios y fotos de Rappi y regenera el catálogo.
# Correrlo una vez por semana suma un día al historial de precios (data/prices/AAAA-MM-DD.json).
#
#   powershell -ExecutionPolicy Bypass -File tools\actualizar.ps1
#
# Para que corra solo todos los domingos a las 11 (crea una tarea programada de Windows):
#   schtasks /Create /SC WEEKLY /D SUN /ST 11:00 /TN "Rico y Barato - precios" /TR "powershell -ExecutionPolicy Bypass -File \"$PSScriptRoot\actualizar.ps1\""

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$scrape = 'C:\Users\gonza\Documents\Brainrot 2\rappi_todos_productos_billinghurst_1292.json'
$google = 'C:\Users\gonza\Documents\Brainrot 2\reputacion_restaurantes_billinghurst_1292.md'
$prefs  = 'C:\Users\gonza\Documents\Brainrot 2\preferencias_comida_usuario.json'

Set-Location $root
# Las páginas de la semana anterior se vuelven a pedir: la caché vale por día.
Get-ChildItem .cache\pages -Filter *.json -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt (Get-Date).Date } | Remove-Item -Confirm:$false

node tools/fetch-rappi-pages.mjs $scrape
if ($LASTEXITCODE -ne 0) { throw 'Falló la descarga de páginas' }
node tools/import-rappi.mjs $scrape --google $google --prefs $prefs
if ($LASTEXITCODE -ne 0) { throw 'Falló la importación' }
node --test tests/
