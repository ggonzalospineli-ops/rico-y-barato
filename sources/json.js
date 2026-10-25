// Fuente para el catálogo que genera tools/import-rappi.mjs.
// read(): Promise<objeto ya parseado>. En el navegador:
//   jsonSource(() => fetch('../data/rappi-catalog.json').then(r => r.json()))

import { rappiSearchUrl } from './demo.js';

export function jsonSource(read) {
  return {
    load: read,
    orderUrl: r => r.url || rappiSearchUrl(r),
  };
}
