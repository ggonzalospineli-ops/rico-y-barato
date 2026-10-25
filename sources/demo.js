// Fuente de datos de ejemplo. Toda fuente expone la misma forma:
//   load(): Promise<{ restaurants, items }>   (formato de data/catalog.js)
//   orderUrl(restaurant): string | null       (adónde mandar al usuario a pedir)
// Para sumar Google Places, menús oficiales o una captura personal, se escribe otra
// fuente con esta forma (o se combinan con mergeSources) y el motor no cambia.

import { restaurants, items } from '../data/catalog.js';

export function demoSource() {
  return {
    async load() { return structuredClone({ restaurants, items }); },
    orderUrl: rappiSearchUrl,
  };
}

// Link a la búsqueda de Rappi Argentina. Formato SIN VERIFICAR: confirmarlo a mano antes de publicar.
export function rappiSearchUrl(restaurant) {
  return `https://www.rappi.com.ar/search?query=${encodeURIComponent(restaurant.name)}`;
}

// Combina fuentes: la de más a la derecha pisa campos de la anterior (ej: ratings de Google).
export function mergeSources(base, ...overlays) {
  return {
    async load() {
      const data = await base.load();
      for (const o of overlays) {
        const extra = await o.load();
        const byId = Object.fromEntries(data.restaurants.map(r => [r.id, r]));
        for (const r of extra.restaurants || []) byId[r.id] ? Object.assign(byId[r.id], r) : data.restaurants.push(r);
        data.items.push(...(extra.items || []));
      }
      return data;
    },
    orderUrl: base.orderUrl,
  };
}
