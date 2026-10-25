import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYields, parseTags, brandOf, parseGoogleTable, convert } from '../importers/rappi.js';
import { createEngine } from '../engine/engine.js';
import { jsonSource } from '../sources/json.js';

const y = (name, description = '', category = 'Populares', rest = '') => parseYields({ name, description, category }, rest);

test('parser: casos reales de nuggets, sushi, empanadas y pizza', () => {
  assert.deepEqual(y('McNuggets X10 Mediano'), { nuggets: 10 });
  assert.deepEqual(y('Cajita Mostaza Nuggets', '5 Bocaditos de pollo rebozados'), { nuggets: 5 });
  assert.deepEqual(y('Tabla summer (24 Piezas)', '8 Rolls con salmon cocido 8 rolls kanikama'), { sushi: 24 });
  assert.deepEqual(y('Combinado 18 piezas', '', 'Populares', 'Bunka Sushi - Palermo'), { sushi: 18 });
  assert.deepEqual(y('Nuevo Recoleta 40 full salmón', '40 piezas. 8 roll ny phila'), { sushi: 40 });
  assert.deepEqual(y('Tabla mixtas kukenan', '10 Roll de kanikama, 10 roll de vegetales, 5 roll de langostinos'), { sushi: 25 });
  assert.deepEqual(y('Combo promo 15 pz', 'salmón, philadelphia roll'), { sushi: 15 });
  assert.deepEqual(y('Docena de Empanadas'), { empanadas: 12 });
  assert.deepEqual(y('Media Doc Congeladas', 'Media docena de empanadas'), { empanadas: 6 });
  assert.deepEqual(y('Empanada de Pollo'), { empanadas: 1 });
  assert.deepEqual(y('Pizza fugazzeta', 'Pizza de cebolla; 6 porciones.'), { pizza: 6 });
  assert.deepEqual(y('Pizza de jamón', '', 'Pizzas Grandes'), { pizza: 8 });
  assert.deepEqual(y('Combo Pizza Muzzarella+2 Empanadas'), { pizza: 8, empanadas: 2 });
});

test('parser: "doble" es medallón, no dos hamburguesas; bebidas y salsas no cuentan', () => {
  assert.deepEqual(y('Cheeseburger Smash Burger Doble & Papas'), { hamburguesa: 1 });
  assert.deepEqual(y('2 Milanesas clásicas + guarnición'), { milanesa: 2 });
  assert.deepEqual(y('Coca-Cola 500ml', '', 'Bebidas'), {});
  assert.deepEqual(y('Salsa para nuggets'), {});
  assert.deepEqual(y('Tequeños de queso', '6 unidades. Empanaditas soufflé'), {});
});

test('parser: la sección del menú manda y el rubro del local no alcanza', () => {
  assert.deepEqual(y('Cheeseburger', 'Carne molida con panceta y cheddar', 'Empanadas'), { empanadas: 1 });
  assert.deepEqual(y('Napolitana', 'Muzzarella, tomate y ajo', 'Pizzas Grandes'), { pizza: 8 });
  assert.deepEqual(y('Palitos Chinos X2', '', 'Populares', 'Gato Japonés Sushi - Palermo'), {});
  assert.deepEqual(y('Aros de Cebolla 6 Unidades', '', 'Entradas', 'Ruskaa Sushi - Palermo'), {});
  assert.deepEqual(y('Miga jamon y queso', 'Miga de jamón y queso.', 'Sandwiches y Hamburguesas'), {});
  assert.deepEqual(y('Cheeseburger', 'Empanada rellena con carne picada', 'Menu'), { empanadas: 1 });
});

test('parser: trampas de nombres', () => {
  assert.deepEqual(y('4 Quesos', '', 'Pizzas'), { pizza: 8 });
  assert.deepEqual(y('Bastones de mozzarella x13', 'Bastones empanados'), {});
  assert.deepEqual(y('Milanesa pollo fugazzeta'), { milanesa: 1 });
  assert.deepEqual(y('Fainá', '', 'Pizzas'), {});
  assert.deepEqual(y('Pan de pizza', '', 'Pizzas'), {});
  assert.deepEqual(y('Porción Fuga Rellena', '', 'Pizzas'), { pizza: 1 });
  assert.deepEqual(y('Triple Hamburguesa Con Queso', 'Tres medallones de carne con cheddar'), { hamburguesa: 1 });
  assert.deepEqual(y('Roll New Mila', '5 piezas de roll con milanesa'), { sushi: 5 });
  assert.deepEqual(y('Caramel Macchiato Crunch Rolls (28u)'), {});
  assert.deepEqual(y('Cheeseburger', 'Masa hecha a base de harina de maíz precocido, rellena de carne'), {});
  assert.deepEqual(y('Pepperoni', 'Pizza individual de 25 cm de muzzarella', 'Pizzas'), { pizza: 4 });
  assert.deepEqual(y('Calabaza Suprema', 'Calabaza suave con queso', 'SUPER EMPANADAZAS'), { empanadas: 1 });
  assert.deepEqual(y('Ravioles chinos', 'Ravioles de cerdo al vapor'), {});
  assert.deepEqual(y('Arroz Pilaf', 'Arroz con fideos dorados'), {});
  assert.deepEqual(y('Pastelito de Pizza', '', 'Pizzas'), {});
  assert.deepEqual(y('Empanadas de Carne', 'Se calculan 6 empanadas por persona', 'Empanadas'), { empanadas: 1 });
});

test('convert: un precio "desde" no se usa para medir', () => {
  const p = (id, name, price) => ({ product_id: id, name, description: '', category: 'Pizzas', price_ars: price, original_price_ars: price });
  const cat = convert({ restaurants: [{ restaurant: 'P', rating: 4.5, products: [
    p('1', 'Muzzarella grande', 12000), p('2', 'Napolitana grande', 14000), p('3', 'Pizza grande mitad y mitad', 499),
  ]}]}, { minPrice: 100 });
  assert.deepEqual(cat.items.find(i => i.name.includes('mitad')).yields, {});
  assert.deepEqual(cat.items.find(i => i.name.includes('Muzz')).yields, { pizza: 8 });
});

test('tags, marcas y tabla de Google', () => {
  assert.ok(parseTags({ name: 'Triple bacon', description: 'cheddar' }).includes('cerdo'));
  assert.equal(brandOf("McDonald's - Almagro"), 'mcdonalds');
  assert.equal(brandOf('Burger King Turbo - Balvanera'), 'burgerking');
  const g = parseGoogleTable("| [La Payada - Cabrera](https://x) | 4,9 | 4,7 | 35 | 51 |\n| [McDonald's - Almagro](u) | 4,6 | 3,8 | 19.301 | 133 |");
  assert.deepEqual(g['la payada - cabrera'], { googleRating: 4.7, googleReviews: 35 });
  assert.equal(g["mcdonald's - almagro"].googleReviews, 19301);
});

const scrape = {
  source: 'Rappi', delivery_address: 'X',
  restaurants: [
    { restaurant: "McDonald's - Almagro", url: 'https://www.rappi.com.ar/restaurantes/1-mc', rating: 4.6, products: [
      { product_id: '1', name: 'McNuggets x10', description: '', category: 'Populares', price_ars: 9000, original_price_ars: 9000, discount: null },
      { product_id: '1', name: 'McNuggets x10', description: '', category: 'Nuggets', price_ars: 9000, original_price_ars: 9000, discount: null },
      { product_id: '2', name: 'McNuggets x20', description: '', category: 'Ofertas Pro', price_ars: 12000, original_price_ars: 16000, discount: '-25%' },
    ]},
    { restaurant: 'Nugget Bar - Palermo', url: 'https://www.rappi.com.ar/restaurantes/2-nb', rating: 5, products: [
      { product_id: '9', name: 'Nuggets x 24', description: '', category: 'Populares', price_ars: 11000, original_price_ars: 11000, discount: null },
    ]},
  ],
};

test('convert + motor: deduplica, marca franquicia, descuento, y usa el link real', async () => {
  const cat = convert(scrape, { preferences: { must_have: [{ restaurant: 'Nugget Bar', closest_current_rappi_matches: [{ name: 'Nuggets x 24' }] }] } });
  assert.equal(cat.items.length, 3);                       // el x10 repetido en dos secciones cuenta una vez
  assert.deepEqual(cat.suggestedFavorites, ['nugget-bar-palermo:9']);

  const e = createEngine({ source: jsonSource(async () => structuredClone(cat)) });
  await e.load();
  assert.deepEqual(e.getState().favorites, ['nugget-bar-palermo:9']);
  e.toggleFavorite('nugget-bar-palermo:9');
  await e.load();                                          // un favorito sugerido que el usuario sacó no vuelve
  assert.deepEqual(e.getState().favorites, []);

  // bestia = 20 nuggets: la x20 con descuento (12000) le gana a dos x10 (18000)
  const opts = e.recommend({ hunger: 'bestia', categories: ['nuggets'], ricoWeight: 0, limit: 10 }).options;
  const mc = opts.find(o => o.restaurant.brand === 'mcdonalds');
  assert.ok(mc.badges.includes('franquicia-barata') && mc.badges.includes('descuento'));
  assert.equal(mc.orderUrl, 'https://www.rappi.com.ar/restaurantes/1-mc');
  assert.equal(e.rankings().bestSellers[0].salesRank, 1);

  e.hideItem(mc.lines[0].itemId);                          // "esto está mal"
  const after = e.recommend({ hunger: 'bestia', categories: ['nuggets'], ricoWeight: 0, limit: 10 }).options;
  assert.ok(!after.some(o => o.lines.some(l => l.itemId === mc.lines[0].itemId)));
});

test('parser: el nombre le gana a la sección cuando dice otra comida medible', () => {
  assert.deepEqual(y('Empanada de Carne', '', 'Pizzas'), { empanadas: 1 });
  assert.deepEqual(y('Canastita pizzita', '', 'Pizzas'), {});
  assert.deepEqual(y('Matambre a la Pizza', 'Matambre de ternera con salsa y muzzarella'), {});
});

test('fotos: solo la del product_id exacto, nunca un placeholder del local', () => {
  const p = (id, name) => ({ product_id: id, name, description: '', category: 'Hamburguesas', price_ars: 9000, original_price_ars: 9000 });
  const url = 'https://www.rappi.com.ar/restaurantes/9-burger';
  const cat = convert({ restaurants: [{ restaurant: 'Burger - Palermo', url, rating: 4.5, products: [
    p('1', 'Cheeseburger'), p('2', 'Doble'), p('3', 'Triple'), p('4', 'Veggie'), p('5', 'Sin foto'),
  ]}]}, { pages: { [url]: { score: 4.1, reviews: 80, deliveryPrice: 990, eta: '25 min',
    products: { 1: 'cheese.png', 2: 'logo.png', 3: 'logo.png', 4: 'logo.png' } } } });
  const img = id => cat.items.find(i => i.id.endsWith(`:${id}`)).imageUrl;
  assert.equal(img('1'), 'https://images.rappi.com.ar/products/cheese.png?d=600x600&e=webp&q=80');
  assert.equal(img('2'), null);   // la misma foto en 3 productos distintos = genérica
  assert.equal(img('5'), null);   // sin foto propia no se inventa
  const r = cat.restaurants[0];
  assert.deepEqual([r.rappiScore, r.rappiReviews, r.deliveryFee, r.etaMin], [4.1, 80, 990, 25]);
});
