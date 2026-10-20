// Icons for the audio path panels (bit-perfect, outputs, timers, ambient mixer).
import { registerIcons } from '../../../core/icons.js';

registerIcons({
  hires: '<path d="M3 12h2l2-6 3 12 3-9 2 5 2-2h4"/>',
  outputs: '<path d="M4 9.5v5M8 7v10"/><path d="M13 8a4 4 0 0 1 0 8M16 5a8 8 0 0 1 0 14"/>',
  wave: '<path d="M2.5 9c2.4 0 2.4-2 4.8-2s2.4 2 4.7 2 2.4-2 4.7-2 2.4 2 4.8 2M2.5 15c2.4 0 2.4-2 4.8-2s2.4 2 4.7 2 2.4-2 4.7-2 2.4 2 4.8 2"/>',
  workout: '<path d="M6.5 7v10M3.5 9.5v5M17.5 7v10M20.5 9.5v5M6.5 12h11"/>',
  focus: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5"/>',
});
