// Fonts ship with the app (web/vendor/fonts, fetched once by tools/fetch-fonts.py): nothing is requested from
// Google Fonts at run time, so opening the app never sends this device's address to Google.
// fontCss('Lexend:wght@400;600') or fontCss('Be+Vietnam+Pro') → URL of the local stylesheet, or null for a
// family that does not ship (an imported skin's custom font): the CSS fallback stack applies then.
const SLUGS = {
  'JetBrains Mono': 'jetbrains-mono', 'Be Vietnam Pro': 'be-vietnam-pro', 'Literata': 'literata',
  'Plus Jakarta Sans': 'plus-jakarta-sans', 'Lexend': 'lexend', 'Inter Tight': 'inter-tight', 'Fraunces': 'fraunces',
  'Manrope': 'manrope', 'Lora': 'lora', 'Merriweather': 'merriweather', 'Noto Serif': 'noto-serif',
  'IBM Plex Mono': 'ibm-plex-mono', 'Atkinson Hyperlegible': 'atkinson-hyperlegible',
};
export const familyOf = (spec) => String(spec || '').split(':')[0].replace(/\+/g, ' ').trim();
export function fontCss(spec) {
  const slug = SLUGS[familyOf(spec)];
  return slug ? new URL(`../../vendor/fonts/${slug}.css`, import.meta.url).href : null;
}
export const shippedFamilies = () => Object.keys(SLUGS);
