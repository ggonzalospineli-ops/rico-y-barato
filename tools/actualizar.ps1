# Actualiza precios, horarios y fotos de Rappi y regenera el catálogo.
# Cada corrida suma un día al historial de precios (data/prices/AAAA-MM-DD.json).
#
#   powershell -ExecutionPolicy Bypass -File tools\actualizar.ps1
#
# Conviene correrlo de día: de noche Rappi no muestra el menú de los locales cerrados y algunos
# muestran uno reducido. Para que corra solo y publique, ver tools\publicar.ps1.

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$scrape = 'C:\Users\gonza\Documents\Brainrot 2\rappi_todos_productos_billinghurst_1292.json'
$google = 'C:\Users\gonza\Documents\Brainrot 2\reputacion_restaurantes_billinghurst_1292.md'
$prefs  = 'C:\Users\gonza\Documents\Brainrot 2\preferencias_comida_usuario.json'

Set-Location $root
# Las páginas de más de 20 horas se vuelven a pedir. No se borran: lo nuevo se mezcla con lo
# conocido, así un local cerrado no pierde sus fotos.
node tools/fetch-rappi-pages.mjs $scrape --max-age-hours 20
if ($LASTEXITCODE -ne 0) { throw 'Falló la descarga de páginas' }
node tools/import-rappi.mjs $scrape --google $google --prefs $prefs
if ($LASTEXITCODE -ne 0) { throw 'Falló la importación' }
# Node 24 toma una carpeta como archivo de test: se le pasa el patrón.
node --test "tests/*.test.js"
if ($LASTEXITCODE -ne 0) { throw 'Fallaron los tests' }
