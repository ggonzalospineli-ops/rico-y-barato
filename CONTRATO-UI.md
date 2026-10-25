# Rico y Barato: contrato del motor para la UI

La UI **no toca** `engine/`, `sources/` ni `data/`. Todo pasa por el objeto que devuelve
`createEngine()`. La UI actual está en `ui/app.js` y es la referencia de uso.

## Arranque

```js
import { createEngine } from '../engine/engine.js';
import { jsonSource } from '../sources/json.js';

// data/rappi-catalog.json lo genera tools/import-rappi.mjs (ver README). ~8.6 MB.
// Sin ese archivo, usar demoSource() de '../sources/demo.js'.
const source = jsonSource(() => fetch('../data/rappi-catalog.json').then(r => r.json()));
const engine = createEngine({ source, storage: {
  get: k => JSON.parse(localStorage.getItem('ryb:' + k) || 'null') ?? undefined,
  set: (k, v) => localStorage.setItem('ryb:' + k, JSON.stringify(v)),
}});
await engine.load();           // obligatorio antes de recommend/rankings/menu
engine.on(({ type, state }) => { /* re-render */ });
```

Hay que servir el proyecto por HTTP (módulos ES): `npx serve .` desde la raíz y abrir `/ui/`.

## Eventos (`engine.on`)

`type` ∈ `catalog | profile | favorites | hidden | budget | cart | orders | reset`. Cada evento ya se
persistió cuando llega. Después de `profile`, `favorites`, `hidden` o `budget`, **volver a llamar a
`recommend()`** porque cambian los resultados.

## Pantallas y llamadas

| Pantalla | Llamadas |
|---|---|
| **Inicio / "¿Qué como?"** | `hungerLevels()`, `categories()`, `recommend({...})`, `budgetSummary()`, `hideItem(itemId)` |
| **Más vendidos / Mejor puntuados** | `rankings({ limit })` → `{ bestSellers, topRated, hiddenGems }` |
| **Local** | `menu(restaurantId)`, `toggleFavorite(itemId)` |
| **Carrito / Gastos** | `getState().cart`, `getState().orders`, `addToCart(plan)`, `removeFromCart(id)`, `confirmOrder(id)`, `budgetSummary()` |
| **Ajustes: qué como** | `setAppetite(cat, {normal, max})`, `setEnabledCategories([...])`, `setExcludedTags([...])`, `setMonthlyBudget(n)` |
| **Ajustes: mi gusto (IA)** | `tasteProfile()` → `{ headline, insights[], suggestedRicoWeight? }` |
| **Ajustes: ocultos** | `getState().hiddenItems`, `unhideItem(itemId)` |

### `recommend({ hunger, money, categories, ricoWeight, limit, people, map })`

- `hunger`: `poco | normal | mucho | bestia`. Define la cantidad objetivo según el apetito del usuario
  (`poco` = 60 % de normal, `mucho` = punto medio, `bestia` = máximo).
- `money`: plata que tiene para este pedido. Se recorta además al restante del mes si hay tope.
- `categories`: opcional; sin esto usa las habilitadas en ajustes.
- `ricoWeight`: 0 = solo barato, 1 = solo rico. **Es el slider principal de la app.**
- `people`: "somos N"; la cantidad objetivo se multiplica por N.
- `map: true`: agrega `all` con todos los planes que entran en la plata (para el mapa Rico × Barato).

Devuelve `{ target: {cat: n}, available, options: Plan[], overBudget: Plan[] }`.
`overBudget` son hasta 5 opciones que se pasan por poco (`overBudgetBy` en ARS), para mostrar
"con $X más podrías…".

### `Plan`

```
id, category, variant: 'completo' | 'un-poco-menos', target, quantity, unit,
restaurant: { id, name, brand, chain, demo, address, url, googleRating, googleReviews, rappiRating,
              etaMin, deliveryFee, quality, hiddenGem },
lines: [{ itemId, name, qty, price, originalPrice, discount }], subtotal, deliveryFee, total, unitCost,
scores: { rico, barato, total }   // 0..1
badges: ('punto-dulce' | 'joya-oculta' | 'franquicia-barata' | 'mas-vendido' | 'descuento' | 'favorito')[]
orderUrl                          // link real del local en Rappi; abrir en pestaña nueva; NO es checkout
```

- `punto-dulce` = frontera de Pareto por categoría: no hay otra opción más rica y más barata por unidad a la vez.
- `mas-vendido` = está entre los 3 primeros de "Populares" **de ese local**, no de toda la zona.
- `descuento`: `originalPrice` es el precio tachado y `discount` el texto de Rappi ("-35%"). Ambos pueden ser `null`.
- Con datos reales **pueden ser `null`**: `rappiRating` (44 locales), `googleRating`/`googleReviews`
  (casi todos), `deliveryFee`, `etaMin` y `address`. Mostrar "—", nunca `null`, `NaN` ni "0 estrellas".
  Con `deliveryFee` en `null`, el `total` **no incluye envío**: aclararlo ("+ envío").
- `joya-oculta` necesita reseñas de Google, así que con los datos actuales casi no aparece.

`quantity` puede superar `target` (no venden 27 nuggets) o, en `un-poco-menos`, quedar por debajo
(≥ 80 %) a cambio de ahorrar 15 % o más. Mostrarlo: "28 nuggets (pediste 27)".

## Restricciones que rompen si se ignoran

1. **La app no compra.** `orderUrl` lleva al local y el usuario paga ahí. Después la UI pregunta
   "¿Lo pediste?" y recién entonces llama `confirmOrder`. Carrito = "por gastar", pedidos = "gastado".
2. Pasar a `addToCart` el `Plan` tal cual vino de `recommend`. `confirmOrder` usa `plan.id`.
3. `remaining` y `remainingAfterCart` son `Infinity` si no hay tope mensual (`monthly === 0`):
   mostrar "sin tope", no "∞" ni NaN.
4. Locales con `restaurant.demo === true` son ficticios: mostrar un chip "demo" mientras existan.
5. `setAppetite` tira error si `normal <= 0` o `max < normal`: validar el form antes.
6. **Cada línea de un plan necesita un botón "esto está mal"** → `hideItem(itemId)`. Las cantidades se
   deducen del texto de Rappi y una parte chica sale mal (una "4 Quesos" contada como pizza entera
   cuando es individual). Sin ese botón, los errores quedan arriba de todo en "barato".
7. `rankings().bestSellers` trae solo productos de "Populares"; los items traen `description`,
   `section`, `originalPrice` y `discount` además de lo anterior.
8. Montos en ARS enteros. Formatear con `Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })`.

## Tags que sirven para exclusiones

`cerdo`, `lacteos`, `tacc` (tiene gluten), `pescado`, `frito`, `carne`. `vegetariano` está marcado en
productos aptos, pero hoy no hay un filtro "solo vegetariano" (habría que sumarlo al motor).

## Brief visual (pedido del usuario)

Rojo y amarillo, estilo bien marcado de app de comida (tipo Rappi/McDonald's/PedidosYa): tarjetas
grandes con badges, el slider **Rico ↔ Barato** y el selector de hambre como protagonistas, barra de
gasto del mes siempre visible. Secciones: ¿Qué como?, Más vendidos, Mejor puntuados (con Joyas
ocultas), Carrito/Gastos, Ajustes (qué como + mi gusto).

## Agregado: horario, calificación, precios, cuenta, ticket

- `recommend({ ..., openOnly = true, at, exclude })`: sin locales cerrados en `at` (por defecto ahora); devuelve
  `closed` (cuántos se saltearon). `exclude`: etiquetas a sacar solo para este pedido (no toca el perfil).
- Cada `restaurant` trae `open: { known, open, label, closesAt?, opensAt?, closingSoon? }` y `distanceKm`.
- Insignias nuevas: `bajo-precio`, `tachado-inflado`, `mas-barato-en-otra`, `no-te-gusto`, `cierra-pronto`.
- Líneas e items: `priceChange { from, to, pct, since }`, `priceHistory [[fecha, precio]]`, `inflatedOriginal`, `otherApps`.
- `rateOrder(orderId, 'up'|'down')`, `pendingRatings({ minutes })`, `skipRating(id)`: 👍 suma a favoritos, 👎 resta
  0,25 en "rico" y saca de favoritos (`state.disliked`).
- `addExternalOrder({ restaurantId?, restaurantName, total, deliveryFee?, tip?, lines?, at?, source })`.
- `priceAlerts({ minPct })` (favoritos que bajaron), `priceDrops({ limit, minPct })`, `priceTracking()`.
- `engine/split.js`: `splitBill({ subtotal, deliveryFee, tipPct, people:[{name, units}] })` → reparto que suma exacto.
- `engine/intent.js`: `parseIntent(texto)` → `{ people, money, hunger, category, exclude, ricoWeight, understood, unknown }`.
