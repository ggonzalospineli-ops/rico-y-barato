// Catálogo de EJEMPLO. Precios en ARS inventados; los locales con demo:true son ficticios.
// Las marcas reales (las 4 grandes) están para probar la lógica de "franquicia barata",
// pero sus precios tampoco son reales. Reemplazar por una fuente real (ver sources/).
//
// yields: cuántas unidades de cada categoría rinde el producto. Un combo puede rendir
// varias categorías ({ hamburguesa: 1, papas: 1 }).

export const CATEGORIES = {
  nuggets:     { label: 'Nuggets',      unit: 'piezas' },
  sushi:       { label: 'Sushi',        unit: 'piezas' },
  hamburguesa: { label: 'Hamburguesas', unit: 'unidades' },
  empanadas:   { label: 'Empanadas',    unit: 'unidades' },
  pizza:       { label: 'Pizza',        unit: 'porciones' },
  milanesa:    { label: 'Milanesa',     unit: 'unidades' },
  pollo:       { label: 'Pollo frito',  unit: 'presas' },
  pasta:       { label: 'Pastas',       unit: 'porciones' },
};

export const BIG_FOUR = ['mcdonalds', 'burgerking', 'kfc', 'mostaza'];

export const restaurants = [
  { id: 'mcdonalds',  brand: 'mcdonalds',  name: "McDonald's",            chain: true,  tags: ['fast-food', 'pollo', 'carne'], rappiRating: 4.3, googleRating: 4.0, googleReviews: 5200, deliveryFee: 900,  etaMin: 25 },
  { id: 'burgerking', brand: 'burgerking', name: 'Burger King',           chain: true,  tags: ['fast-food', 'carne', 'pollo'], rappiRating: 4.2, googleRating: 4.1, googleReviews: 3900, deliveryFee: 900,  etaMin: 30 },
  { id: 'kfc',        brand: 'kfc',        name: 'KFC',                   chain: true,  tags: ['fast-food', 'pollo', 'frito'], rappiRating: 4.1, googleRating: 3.9, googleReviews: 2700, deliveryFee: 1100, etaMin: 30 },
  { id: 'mostaza',    brand: 'mostaza',    name: 'Mostaza',               chain: true,  tags: ['fast-food', 'carne', 'pollo'], rappiRating: 4.2, googleRating: 4.0, googleReviews: 3100, deliveryFee: 700,  etaMin: 25 },
  { id: 'sushipop',   name: 'Sushi Pop',             chain: true,  tags: ['japonesa', 'pescado'],         rappiRating: 4.4, googleRating: 4.2, googleReviews: 1800, deliveryFee: 1200, etaMin: 40 },
  { id: 'kansai',     name: 'Kansai Sushi Bar',      chain: false, demo: true, tags: ['japonesa', 'pescado', 'artesanal'], rappiRating: 4.8, googleRating: 4.7, googleReviews: 320,  deliveryFee: 1000, etaMin: 45 },
  { id: 'ninja',      name: 'Ninja Rolls',           chain: false, demo: true, tags: ['japonesa', 'pescado'],              rappiRating: 3.9, googleRating: 3.8, googleReviews: 2100, deliveryFee: 600,  etaMin: 35 },
  { id: 'ernesto',    name: 'Bodegón Don Ernesto',   chain: false, demo: true, tags: ['bodegon', 'casera', 'carne', 'pasta'], rappiRating: 4.7, googleRating: 4.6, googleReviews: 890, deliveryFee: 800, etaMin: 40 },
  { id: 'lacuadra',   name: 'La Cuadra Empanadas',   chain: false, demo: true, tags: ['casera', 'horno', 'carne'],        rappiRating: 4.5, googleRating: 4.5, googleReviews: 640,  deliveryFee: 500,  etaMin: 30 },
  { id: 'fortin',     name: 'Pizzería El Fortín',    chain: false, demo: true, tags: ['pizza', 'horno', 'lacteos'],       rappiRating: 4.4, googleRating: 4.4, googleReviews: 1500, deliveryFee: 700,  etaMin: 35 },
  { id: 'gaucho',     name: 'Pollos El Gaucho',      chain: false, demo: true, tags: ['pollo', 'casera', 'frito'],        rappiRating: 4.6, googleRating: 4.6, googleReviews: 410,  deliveryFee: 600,  etaMin: 35 },
  { id: 'ladob',      name: 'Lado B Burgers',        chain: false, demo: true, tags: ['carne', 'artesanal'],              rappiRating: 4.8, googleRating: 4.8, googleReviews: 210,  deliveryFee: 900,  etaMin: 40 },
];

export const items = [
  // McDonald's
  { id: 'mc-nug4',   restaurantId: 'mcdonalds', name: 'McNuggets x4',          price: 4200,  yields: { nuggets: 4 },  tags: ['pollo', 'frito'], salesRank: 40 },
  { id: 'mc-nug10',  restaurantId: 'mcdonalds', name: 'McNuggets x10',         price: 8900,  yields: { nuggets: 10 }, tags: ['pollo', 'frito'], salesRank: 6 },
  { id: 'mc-nug20',  restaurantId: 'mcdonalds', name: 'McNuggets x20',         price: 15900, yields: { nuggets: 20 }, tags: ['pollo', 'frito'], salesRank: 9 },
  { id: 'mc-cbo',    restaurantId: 'mcdonalds', name: 'Cuarto de Libra',       price: 7900,  yields: { hamburguesa: 1 }, tags: ['carne', 'lacteos'], salesRank: 3 },
  { id: 'mc-dobcbo', restaurantId: 'mcdonalds', name: 'Doble Cuarto de Libra', price: 10400, yields: { hamburguesa: 1 }, tags: ['carne', 'lacteos'], salesRank: 12 },
  { id: 'mc-cheese', restaurantId: 'mcdonalds', name: 'Cheeseburger',          price: 3900,  yields: { hamburguesa: 1 }, tags: ['carne', 'lacteos'], salesRank: 20 },
  // Burger King
  { id: 'bk-nug6',   restaurantId: 'burgerking', name: 'King Nuggets x6',      price: 5200,  yields: { nuggets: 6 },  tags: ['pollo', 'frito'], salesRank: 35 },
  { id: 'bk-nug20',  restaurantId: 'burgerking', name: 'King Nuggets x20',     price: 14200, yields: { nuggets: 20 }, tags: ['pollo', 'frito'], salesRank: 18 },
  { id: 'bk-whop',   restaurantId: 'burgerking', name: 'Whopper',              price: 8600,  yields: { hamburguesa: 1 }, tags: ['carne'], salesRank: 4 },
  { id: 'bk-stack',  restaurantId: 'burgerking', name: 'Stacker Triple',       price: 11900, yields: { hamburguesa: 1 }, tags: ['carne', 'lacteos'], salesRank: 22 },
  { id: 'bk-cheese', restaurantId: 'burgerking', name: 'Cheeseburger',         price: 3500,  yields: { hamburguesa: 1 }, tags: ['carne', 'lacteos'], salesRank: 30 },
  // KFC
  { id: 'kfc-b8',    restaurantId: 'kfc', name: 'Bucket 8 presas',             price: 17500, yields: { pollo: 8 },   tags: ['pollo', 'frito'], salesRank: 8 },
  { id: 'kfc-b3',    restaurantId: 'kfc', name: '3 presas',                    price: 7900,  yields: { pollo: 3 },   tags: ['pollo', 'frito'], salesRank: 25 },
  { id: 'kfc-pop',   restaurantId: 'kfc', name: 'Popcorn Chicken grande (≈18)', price: 7400, yields: { nuggets: 18 }, tags: ['pollo', 'frito'], salesRank: 28 },
  // Mostaza
  { id: 'mo-nug8',   restaurantId: 'mostaza', name: 'Nuggets x8',              price: 5600,  yields: { nuggets: 8 },  tags: ['pollo', 'frito'], salesRank: 33 },
  { id: 'mo-dob',    restaurantId: 'mostaza', name: 'Mostaza Doble',           price: 7600,  yields: { hamburguesa: 1 }, tags: ['carne', 'lacteos'], salesRank: 14 },
  { id: 'mo-simple', restaurantId: 'mostaza', name: 'Hamburguesa Simple',      price: 3200,  yields: { hamburguesa: 1 }, tags: ['carne'], salesRank: 26 },
  // Sushi Pop
  { id: 'sp-15',     restaurantId: 'sushipop', name: 'Combo 15 piezas',        price: 13900, yields: { sushi: 15 }, tags: ['pescado', 'lacteos'], salesRank: 11 },
  { id: 'sp-30',     restaurantId: 'sushipop', name: 'Combo 30 piezas',        price: 24900, yields: { sushi: 30 }, tags: ['pescado', 'lacteos'], salesRank: 7 },
  { id: 'sp-45',     restaurantId: 'sushipop', name: 'Combo 45 piezas',        price: 34900, yields: { sushi: 45 }, tags: ['pescado', 'lacteos'], salesRank: 19 },
  // Kansai (joya oculta)
  { id: 'ka-10',     restaurantId: 'kansai', name: 'Degustación 10 piezas',    price: 9800,  yields: { sushi: 10 }, tags: ['pescado'], salesRank: 45 },
  { id: 'ka-20',     restaurantId: 'kansai', name: 'Barco 20 piezas',          price: 17200, yields: { sushi: 20 }, tags: ['pescado', 'lacteos'], salesRank: 31 },
  { id: 'ka-40',     restaurantId: 'kansai', name: 'Barco 40 piezas',          price: 29900, yields: { sushi: 40 }, tags: ['pescado', 'lacteos'], salesRank: 38 },
  // Ninja Rolls (barato pero flojo)
  { id: 'ni-30',     restaurantId: 'ninja', name: 'Promo 30 piezas',           price: 16900, yields: { sushi: 30 }, tags: ['pescado', 'lacteos'], salesRank: 15 },
  { id: 'ni-50',     restaurantId: 'ninja', name: 'Promo 50 piezas',           price: 25500, yields: { sushi: 50 }, tags: ['pescado', 'lacteos'], salesRank: 27 },
  // Bodegón
  { id: 'er-mila',   restaurantId: 'ernesto', name: 'Milanesa napolitana XL con papas', price: 14500, yields: { milanesa: 1 }, tags: ['carne', 'lacteos', 'casera'], salesRank: 10 },
  { id: 'er-milac',  restaurantId: 'ernesto', name: 'Milanesa de pollo con puré',       price: 11800, yields: { milanesa: 1 }, tags: ['pollo', 'casera'], salesRank: 21 },
  { id: 'er-rav',    restaurantId: 'ernesto', name: 'Ravioles caseros con tuco',        price: 9900,  yields: { pasta: 1 },    tags: ['pasta', 'casera', 'tacc'], salesRank: 24 },
  // Empanadas
  { id: 'cu-1',      restaurantId: 'lacuadra', name: 'Empanada (unidad)',      price: 1500,  yields: { empanadas: 1 },  tags: ['carne', 'horno', 'tacc'], salesRank: 50 },
  { id: 'cu-6',      restaurantId: 'lacuadra', name: 'Media docena',           price: 8100,  yields: { empanadas: 6 },  tags: ['carne', 'horno', 'tacc'], salesRank: 16 },
  { id: 'cu-12',     restaurantId: 'lacuadra', name: 'Docena',                 price: 14900, yields: { empanadas: 12 }, tags: ['carne', 'horno', 'tacc'], salesRank: 5 },
  // Pizza
  { id: 'fo-muzzg',  restaurantId: 'fortin', name: 'Muzzarella grande (8 porc.)', price: 11500, yields: { pizza: 8 }, tags: ['lacteos', 'horno', 'tacc', 'vegetariano'], salesRank: 2 },
  { id: 'fo-muzzc',  restaurantId: 'fortin', name: 'Muzzarella chica (6 porc.)',  price: 9200,  yields: { pizza: 6 }, tags: ['lacteos', 'horno', 'tacc', 'vegetariano'], salesRank: 29 },
  { id: 'fo-fug',    restaurantId: 'fortin', name: 'Fugazzeta rellena (8 porc.)', price: 15900, yields: { pizza: 8 }, tags: ['lacteos', 'horno', 'tacc', 'vegetariano'], salesRank: 13 },
  // Pollos El Gaucho
  { id: 'ga-nug12',  restaurantId: 'gaucho', name: 'Nuggets caseros x12',      price: 6500,  yields: { nuggets: 12 }, tags: ['pollo', 'frito', 'casera'], salesRank: 23 },
  { id: 'ga-nug24',  restaurantId: 'gaucho', name: 'Nuggets caseros x24',      price: 11900, yields: { nuggets: 24 }, tags: ['pollo', 'frito', 'casera'], salesRank: 17 },
  { id: 'ga-pollo',  restaurantId: 'gaucho', name: 'Pollo entero frito (8 presas)', price: 14900, yields: { pollo: 8 }, tags: ['pollo', 'frito', 'casera'], salesRank: 32 },
  // Lado B
  { id: 'lb-clas',   restaurantId: 'ladob', name: 'Clásica doble smash',       price: 9800,  yields: { hamburguesa: 1 }, tags: ['carne', 'lacteos', 'artesanal'], salesRank: 34 },
  { id: 'lb-trip',   restaurantId: 'ladob', name: 'Triple bacon smash',        price: 12900, yields: { hamburguesa: 1 }, tags: ['carne', 'cerdo', 'lacteos', 'artesanal'], salesRank: 37 },
];
