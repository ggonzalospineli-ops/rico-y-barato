// Horarios de Rappi (scheduleData de la página del local):
//   [{ day: 'Lunes', time: { openTime: '11:00', closeTime: '23:30' } }, ...]
// Un cierre menor o igual a la apertura cruza la medianoche ("20:00-02:00" del viernes sigue
// abierto el sábado a la 1). Sin horario conocido se asume abierto: no escondemos un local por falta de datos.

const DAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const toMin = hhmm => { const [h, m] = (hhmm || '0:0').split(':').map(Number); return h * 60 + (m || 0); };

function windowsFor(schedule, dayIndex) {
  return (schedule || [])
    .filter(s => norm(s.day) === DAYS[dayIndex] && s.time)
    .map(s => {
      const open = toMin(s.time.openTime);
      let close = toMin(s.time.closeTime);
      if (close === 23 * 60 + 59) close = 24 * 60;      // "23:59" = hasta el final del día
      if (close <= open) close += 24 * 60;               // cruza la medianoche
      return { open, close };
    });
}

// { known, open, closesAt, opensAt, label } para el momento `date`.
export function openStatus(schedule, date = new Date()) {
  if (!schedule?.length) return { known: false, open: true, label: 'Horario sin datos' };
  const day = date.getDay();
  const minute = date.getHours() * 60 + date.getMinutes();
  // Hoy, o una franja de ayer que cruzó la medianoche.
  const today = windowsFor(schedule, day).find(w => minute >= w.open && minute < w.close);
  const yesterday = windowsFor(schedule, (day + 6) % 7).find(w => w.close > 24 * 60 && minute < w.close - 24 * 60);
  if (today || yesterday) {
    const closeMin = today ? today.close : yesterday.close - 24 * 60;
    const left = closeMin - minute;
    return { known: true, open: true, closesAt: hhmm(closeMin), closingSoon: left <= 45,
      label: closeMin >= 24 * 60 && today?.close === 24 * 60 ? 'Abierto todo el día' : `Abierto hasta las ${hhmm(closeMin)}` };
  }
  // Próxima apertura en los próximos 7 días.
  for (let d = 0; d < 7; d++) {
    const w = windowsFor(schedule, (day + d) % 7).filter(x => d > 0 || x.open > minute).sort((a, b) => a.open - b.open)[0];
    if (w) {
      const when = d === 0 ? `hoy a las ${hhmm(w.open)}` : d === 1 ? `mañana a las ${hhmm(w.open)}` : `el ${DAYS[(day + d) % 7]} a las ${hhmm(w.open)}`;
      return { known: true, open: false, opensAt: when, label: `Cerrado · abre ${when}` };
    }
  }
  return { known: true, open: false, label: 'Cerrado esta semana' };
}

function hhmm(min) {
  const m = ((min % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Distancia en km entre dos [lat, lng] (haversine).
export function distanceKm([lat1, lng1], [lat2, lng2]) {
  const R = 6371, rad = x => (x * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
