# Rico y Barato

Te dice qué pedir según cuánta hambre tenés, cuánta plata tenés y si querés algo rico o barato.
Toma los menús reales de Rappi (y los precios de PedidosYa) de los locales que entregan en Billinghurst 1292 (Recoleta, CABA).

- **Publicada:** https://ggonzalospineli-ops.github.io/rico-y-barato/ (GitHub Pages; se publica sola con cada `git push` a `main`)
- **Repo:** https://github.com/ggonzalospineli-ops/rico-y-barato (público, con los datos scrapeados: decisión tomada a sabiendas)
- **Pensada para:** Galaxy Tab S10 Ultra (924×1480 vertical, 1480×924 horizontal), celular y compu.

## Correr y probar

```
npm test                       # node --test "tests/*.test.js"  (74 tests)
npx serve -l 4180 .            # y abrir http://localhost:4180/ui/
npm start                      # alternativa: server.mjs (necesario para la voz de ElevenLabs con clave del servidor)
```

Con el service worker la primera recarga puede mostrar la versión anterior: **recargar dos veces**.
En Node 24, `node --test tests/` falla (toma la carpeta como archivo): usar el patrón entre comillas.

## Cómo está armado

| Carpeta | Qué hay |
|---|---|
| `engine/` | Toda la lógica, sin DOM. `engine.js` (recomendaciones, pedidos, gastos, favoritos, bloqueos), `planner.js` (combinación más barata para cubrir el hambre), `scoring.js`, `taste.js` (aprende de los ❤️), `hours.js` (abierto ahora), `intent.js` (entiende frases), `nutrition.js` (calorías y qué tan sano), `group.js` (pedido grupal), `split.js` (dividir la cuenta), `shuffle.js` (Decidí por mí) |
| `ui/` | La app: `app.js` (vistas), `styles.css` + `features.css`, `assistant.js` (Mila), `ai.js` (IA local / Claude), `persist.js` (guardado con respaldo), `sw.js` (offline) |
| `importers/rappi.js` | Convierte el scrapeo al catálogo: qué rinde cada producto, categorías, fotos, horarios |
| `tools/` | Descarga, importación, publicación diaria, PedidosYa, IA, agente de voz |
| `data/` | `rappi-catalog.json` (lo que lee la app), `rappi-pages.json`, `prices/` (historial), `pedidosya/`, `other-apps.json`, `extra-photos.json`, `home.json` |
| `tests/` | Motor, importador, funciones, nutrición, pedido grupal |

`CONTRATO-UI.md` describe la API del motor. La UI la mantiene Claude en este proyecto.

## Qué hace la app

- **Inicio:** hambre (picoteo → modo bestia), qué pinta (15 categorías: nuggets, sushi, hamburguesas, empanadas, pizza, milanesa, pollo frito, pastas, tacos, wraps, carnes, ensaladas, sándwiches, tartas, wok/bowls), plata, cuántos son, barra barato ↔ rico (continua), **¿cuándo?** (ahora / almuerzo / merienda / cena / otra hora), **que llegue en** y **distancia**.
- **Resultados:** "20 de N opciones" + Ver más, tarjetas o mapa rico × barato, locales cerrados ocultos con "Ver igual". Las tarjetas y las tiras que no cambian se reusan (sin parpadeo de fotos).
- **💪 Fitness:** calorías estimadas y puntaje de qué tan sano (0-100, con motivos), máximo de kcal por persona, peso y objetivo → % del día. Siempre "estimado": Rappi no da información nutricional.
- **Fichas:** de un plan (qué pedís, cuánto rinde, reputación, calorías) y de cada producto del menú completo (foto, descripción, precio por unidad, historial, cantidad, agregar al pedido). Botón 🚫 en el menú de un local para no verlo más (se restaura en Ajustes).
- **Decidí por mí:** mazo de cartas mezclado con preferencia por el puntaje, un plan por local.
- **👥 Pedido grupal:** desde el menú de un local; el pedido viaja en el link (`#grupo=...`), cada uno suma lo suyo y reenvía. Cada uno paga lo suyo + parte igual del envío.
- **Pedidos:** lista, "Ya lo pedí", dividir la cuenta, ticket o carga a mano, **resumen de gastos** (por semana, por comida, ahorro contra el precio típico de la zona).
- **Mila (botón rojo):** asistente por voz. Con IA local corriendo usa Mila; si no (por ejemplo en la tablet), el agente de ElevenLabs, que consulta las opciones reales con la herramienta `buscar_opciones`.
- **Comparación con PedidosYa:** en tarjetas y fichas, "💸 $X más barato en PedidosYa" con sucursal y fecha.
- **Ajustes:** apetito por comida, "no como", categorías, ocultos, locales bloqueados, IA.

## Datos de Rappi

Rappi no tiene API pública. El scrapeo base es de Gonzalo (553 locales, ~27.500 productos) en
`C:\Users\gonza\Documents\Brainrot 2\rappi_todos_productos_billinghurst_1292.json` (+ `reputacion_*.md` de Google y `preferencias_comida_usuario.json`).

1. `tools/fetch-rappi-pages.mjs <scrapeo>` baja la página de cada local (1 por segundo, caché en `.cache/pages/`) → `data/rappi-pages.json`: fotos y nombres por producto, precios del día, envío, demora, rating, horarios. Opciones: `--max-age-hours N` (vuelve a pedir las de más de N horas), `--refresh <texto>` (fuerza las URL que lo contengan).
2. `tools/import-rappi.mjs <scrapeo> --google ... --prefs ...` genera `data/rappi-catalog.json`.

Cosas importantes que aprendimos de Rappi:
- **De noche muestra menús incompletos** (locales cerrados sin menú, McDonald's con menos productos). Por eso la descarga **mezcla** lo nuevo con lo conocido en vez de reemplazarlo, y conviene correrla de día.
- **Horarios:** `scheduleData` trae un solo tramo por día (a veces solo el de madrugada, "00:00-03:30"); los tramos completos (`schedules`) vienen solo para el día consultado. La descarga los junta día a día en `weekSchedules`. Un día con solo el tramo de madrugada queda "sin confirmar" y la app lo muestra abierto.
- **Fotos:** en las cadenas el id de la página no es el del menú → se cruza por nombre (exacto o parecido con los mismos números; un "doble" nunca toma la foto de un "simple"), después con otra sucursal de la marca, y por último `data/extra-photos.json` (fotos oficiales de marca). Una foto en 3+ productos de **familias** distintas es genérica y se descarta. Nunca fotos de búsquedas de imágenes.
- **Cantidades:** Rappi no dice cuánto rinde cada producto; `importers/rappi.js` lo deduce. Las categorías amplias (carnes, ensaladas, wok, sándwiches, tartas, wraps, tacos) solo salen del nombre o la sección, nunca de la descripción. Cada error nuevo → un caso en `tests/importer.test.js`.
- El envío es "aprox.": Rappi lo calcula para su ubicación por defecto y sin sesión no acepta otra.

### Actualización diaria automática

Tarea de Windows **"Rico y Barato - actualizar"**, todos los días a las 12:30 (si la compu estaba apagada, al prenderla).
Corre `tools/publicar.ps1`: `git pull` → `tools/actualizar.ps1` (descarga + importación + tests) → si cambió `data/`, commit "Datos de Rappi del AAAA-MM-DD" y push.

- Log: `.cache\publicar.log`
- Crear o recrear la tarea: `powershell -ExecutionPolicy Bypass -File tools\programar.ps1`
- Sacarla: `schtasks /Delete /TN "Rico y Barato - actualizar" /F`
- `publicar.ps1` no hace nada si hay cambios de código sin commitear fuera de `data/`.

## PedidosYa (comparación de precios)

PedidosYa no deja bajar sus páginas por HTTP (403 + desafío anti-bot). Se releva **desde Chrome, a ritmo de persona y de día**
(cerrados solo muestran promos). **Si aparece "confirmá que sos un humano", se frena: no se resuelve ni se esquiva.**

Estado: 14 cadenas + 165 locales cercanos → **3.919 productos** del catálogo con precio de PedidosYa (190 locales).

Para actualizarlo (lo hace Claude con la extensión de Chrome):
1. `node tools/pedidosya-receiver.mjs` — receptor en `127.0.0.1:4190` (solo acepta `pedidosya.com.ar`). Sirve el extractor (`tools/pedidosya-scrape.js`), la lista de locales y una espera por red (Chrome frena los `setTimeout` en pestañas en segundo plano).
2. En PedidosYa con la dirección Billinghurst 1292 cargada, "Ver más resultados" hasta el final → índice en `.cache/pedidosya-cerca.json` (1.546 locales).
3. Cruce por nombre (sin sucursal ni "Turbo") con los locales de Rappi → `.cache/pedidosya-lista.json` (166 páginas).
4. En la pestaña de PedidosYa: `const m = await import('http://127.0.0.1:4190/scrape.js'); m.runAll(lista, { pausa: 4000 })` — abre cada menú en un marco de la misma pestaña, uno por vez, y guarda `data/pedidosya/cerca-*.json`.
5. `node tools/import-pedidosya.mjs` → `data/other-apps.json`; después `tools/import-rappi.mjs` para regenerar el catálogo.

Reglas del cruce: mismo nombre exacto (sin "40% OFF"/"2x1"), marca sin signos ("che sushi." = "che sushi"), el local cercano gana a la sucursal de cadena, y si un precio casi duplica al otro (×1,8) se descarta: es otra porción con el mismo nombre (pasó con Che Sushi). No entra en la actualización automática.

## IA y voz

- **IA local (gratis, solo en esta compu):** `powershell -ExecutionPolicy Bypass -File tools\ia-local.ps1` arranca Ollama portable (`F:\ollama\bin`, modelos en `F:\ollama\models`) con `gemma3:12b`. La app la detecta sola (Ajustes → IA). Se usa para "Pedir hablando", leer tickets y Mila.
- **Claude:** opción en Ajustes con la clave de cada usuario en su navegador.
- **Agente de voz ElevenLabs** (lo que usa la tablet): id en `ui/voice-agent.json`. La clave va en `.env` (`ELEVEN_API_KEY=...`, ignorado por git). `node tools/update-agent-tools.mjs` crea/actualiza la herramienta de cliente `buscar_opciones` y el prompt del agente. La app responde esa herramienta con el motor real, así el agente no inventa locales ni precios. Se cobra por minuto en ElevenLabs.
- **Mila con voz ElevenLabs desde el servidor:** `powershell -ExecutionPolicy Bypass -File tools\voz-elevenlabs.ps1` (pide la clave oculta; `server.mjs`).

## Guardado de ajustes

Todo vive en el navegador de cada aparato (`localStorage`, claves `ryb:*`) con copia de respaldo en IndexedDB (`ui/persist.js`): si el navegador borra el guardado, se restaura al abrir. Se pide almacenamiento persistente y, si el navegador no guarda (incógnito, "borrar datos al salir"), la app avisa.
Ojo: todas las páginas de `ggonzalospineli-ops.github.io` (Rico y Barato, Otra Escena, Bolsa Mayor) comparten ese almacenamiento.

## Decisiones tomadas

- Avisos de precio por producto: hechos y **sacados** a pedido (el motor conserva `watchPrice`/`watchedItems`).
- Mr Tasty: no se puso ningún aviso de "carne en mal estado" porque no hay fuente que lo confirme; el usuario puede ocultarlo con 🚫. Si aparece una nota o registro oficial, se puede mostrar un aviso citando la fuente.
- Sin fotos de búsquedas de internet; sin esquivar desafíos anti-bot.
- Botón "Ctrl K · Comandos y atajos" sacado de la barra lateral (el atajo sigue andando).

## Pendiente / ideas

- Scroll que "a veces no anda" en la tablet: no reproducido. Se bajó mucho el trabajo al mover la barra; si vuelve, anotar dónde estaba el dedo (barra, tira horizontal, después de cerrar una ficha, asistente abierto).
- Los 1.362 locales de PedidosYa que no están en Rappi podrían sumarse como locales nuevos (solo precios de PedidosYa); son ~1.360 menús, varias horas.
- 24 locales con horario "sin confirmar" se completan solos con la actualización diaria durante la semana.
- Calorías: son estimaciones por reglas; se pueden afinar con más ingredientes o con una tabla por cadena.
- ~500 productos sin foto porque el local nunca la subió a Rappi.
