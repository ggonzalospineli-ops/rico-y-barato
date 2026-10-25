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
npm start                # y abrir http://localhost:4173/ui/
```

`npm start` usa el servidor local incluido. Es necesario para que la voz de ElevenLabs funcione sin exponer la clave secreta en el navegador.

## Voz argentina de Mila (ElevenLabs)

1. En ElevenLabs, agregá a **My Voices** una voz femenina argentina y copiá su Voice ID.
2. Iniciá la app con el lanzador seguro (la clave se pide oculta y solo vive mientras el servidor está abierto):

```powershell
powershell -ExecutionPolicy Bypass -File tools\voz-elevenlabs.ps1
```

El Voice ID es opcional: si lo dejás vacío, Mila consulta las voces femeninas de la cuenta y prioriza automáticamente
las que tengan etiquetas como `Argentina`, `Argentinian` o `Rioplatense`. La voz se puede escuchar y cambiar desde
el panel de Mila. Si ElevenLabs falla o no está configurado, vuelve a la voz femenina del navegador.

La clave nunca se envía al frontend ni se guarda en `localStorage`. En un despliegue real, definí
`ELEVENLABS_API_KEY` y opcionalmente `ELEVENLABS_VOICE_ID` como secretos del servidor.

## Actualizar precios (historial)

`tools/actualizar.ps1` vuelve a bajar las páginas de Rappi (precios, horarios, fotos), guarda la foto de precios
del día en `data/prices/` y regenera el catálogo. Corriéndolo una vez por semana se arma el historial que usan
"📉 Bajas", las alertas de favoritos y el aviso de "tachado inflado". El script trae comentado el comando
`schtasks` para que corra solo los domingos.

## Funciones que dependen de datos

| Función | De dónde sale | Límite |
|---|---|---|
| Abierto ahora | `scheduleData` de la página de cada local | Sin horario, se asume abierto |
| Distancia | ubicación del local + `data/home.json` | Envío: Rappi lo calcula para su ubicación por defecto (sin sesión no acepta otra), por eso dice "aprox." |
| Bajas de precio | `data/prices/*.json` | Hacen falta al menos dos días relevados |
| Otras apps | `data/other-apps.json` | Solo marca "más barato" si `same: true` (mismo producto exacto) |
| Pedir hablando | `engine/intent.js` (local) | Con clave propia de Anthropic en Ajustes, Claude interpreta frases libres |
| Foto del ticket | Claude con visión (`ui/ai.js`) | Sin clave, se carga a mano |

## IA local (para demos, sin costo)

La IA corre en la compu con [Ollama](https://github.com/ollama/ollama) y el modelo `gemma3:12b` (lee texto e imágenes):

```
powershell -ExecutionPolicy Bypass -File tools\ia-local.ps1
```

Arranca Ollama (portable, en `F:\ollama\bin`) con los modelos en `F:\ollama\models` y deja entrar a la app desde
`localhost` y desde GitHub Pages. La app la detecta sola (Ajustes → IA → Automático) y la usa para "Pedir hablando"
y para leer tickets. Solo funciona en esta compu: Ollama escucha en `127.0.0.1`.

Para que la usen otros hace falta un servidor: o uno propio con GPU corriendo el mismo Ollama, o la API de Claude
detrás de un backend que guarde la clave (hoy la opción "Claude" de Ajustes usa la clave de cada usuario desde su navegador).
