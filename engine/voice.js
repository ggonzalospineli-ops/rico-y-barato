const FEMALE = /\b(?:female|woman|mujer|femenin[ao]?|elena|laura|sof[ií]a|paulina|sabina|m[oó]nica|helena|valentina|camila|julieta|mila)\b/;
const MALE = /\b(?:male|man|hombre|masculin[ao]?|raul|jorge|diego|pablo|andres|andrés)\b/;
const ARGENTINE = /argentin|rioplatense|porteñ|porten|buenos aires|es[-_ ]?ar/;

export function voiceText(voice) {
  return `${voice?.name || ''} ${voice?.lang || ''} ${Object.values(voice?.labels || {}).join(' ')}`.toLowerCase();
}

export function isArgentineVoice(voice) {
  return ARGENTINE.test(voiceText(voice));
}

export function isFemaleVoice(voice) {
  const text = voiceText(voice);
  if (MALE.test(text)) return false;
  return FEMALE.test(text);
}

export function voiceScore(voice) {
  const text = voiceText(voice);
  let score = isArgentineVoice(voice) ? 200 : /latin|latam|es[-_ ]?419/.test(text) ? 90 : /spanish|español|es[-_]/.test(text) ? 55 : 0;
  if (isFemaleVoice(voice)) score += 80;
  if (/natural|neural|conversational|warm|cálid|calid/.test(text)) score += 12;
  return score;
}

export function rankFemaleVoices(voices, preferredId = '') {
  return (voices || [])
    .filter(v => v?.voice_id === preferredId || v?.id === preferredId || isFemaleVoice(v))
    .sort((a, b) => {
      const aId = a.voice_id || a.id;
      const bId = b.voice_id || b.id;
      if (aId === preferredId) return -1;
      if (bId === preferredId) return 1;
      return voiceScore(b) - voiceScore(a) || String(a.name || '').localeCompare(String(b.name || ''));
    });
}
