# Rico y Barato

Te dice qué pedir según cuánto comés, cuánta hambre tenés y cuánta plata tenés.
La lógica está en `engine/`; la UI está en `ui/` (`app.js` + `styles.css`) y solo habla con el motor según `CONTRATO-UI.md`.

## Datos

Rappi no tiene API pública. El catálogo sale de un scrapeo personal de Rappi (uso propio, no
para distribuir) convertido con:

```
node tools/import-rappi.mjs "<carpeta>/rappi_todos_productos_billinghurst_1292.json" \
  --google "<carpeta>/reputacion_restaurantes_billinghurst_1292.md" \
  --prefs  "<carpeta>/preferencias_comida_usuario.json"
```

Antes, opcional pero recomendado: `node tools/fetch-rappi-pages.mjs "<carpeta>/rappi_todos_productos_billinghurst_1292.json"`
baja la página de cada local (una por segundo, reanudable) y guarda en `data/rappi-pages.json` la foto de cada
producto por `product_id`, envío, demora, logo, portada y rating con cantidad de reseñas. El importador la usa sola.

Genera `data/rappi-catalog.json` e imprime cuántos productos pudo medir por categoría y cuáles
descartó por precio implausible. Rappi no dice cuánto rinde cada producto: `importers/rappi.js` lo
deduce del nombre, la descripción y la sección del menú ("x10", "24 piezas", "media docena",
"grande"). Si aparece un error nuevo, sumar el caso a `tests/importer.test.js` antes de tocar las reglas.

`data/catalog.js` es un catálogo de ejemplo con precios inventados (lo usan los tests).

## Correr

```
npm test                 # node --test
npx serve -l 4173 .      # y abrir http://localhost:4173/ui/
```
