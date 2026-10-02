// GLP-1 glyphs (Rehab Test v3, 2026-09-30). One stroke weight, round caps, a 24 pt box,
// drawn in currentColor, in the spirit of the SF Symbols named beside each. No emoji.
const P = (d, extra = '') => `<svg class="g1-g" viewBox="0 0 24 24" aria-hidden="true"${extra}>${d}</svg>`;

export const G = {
  // flame (a craving)
  crave: P('<path d="M12 21c-3.6 0-6-2.4-6-5.6 0-3.3 2.6-5 3.4-8.4.9 1.6 2.1 2.4 2.1 2.4S12.6 6 14.2 3c.5 3.2 3.8 5.8 3.8 10.4 0 4.3-2.4 7.6-6 7.6z"/><path d="M12 21c-1.5 0-2.6-1.1-2.6-2.6 0-1.8 1.6-2.6 2.2-4.3 1.4 1.2 3 2.3 3 4.3 0 1.5-1.1 2.6-2.6 2.6z"/>'),
  // waveform (nausea)
  nausea: P('<path d="M3 12c1.5-3 3-3 4.5 0s3 3 4.5 0 3-3 4.5 0 3 3 4.5 0"/><path d="M3 17c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0" opacity=".5"/>'),
  // bolt (headache)
  headache: P('<path d="M13.5 2.5L5.5 13.5h6l-1 8 8-11h-6z"/>'),
  // moon.zzz (tired or a nap)
  tired: P('<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/><path d="M14.5 3.5h4l-4 4h4"/>'),
  // fork.knife (ate)
  ate: P('<path d="M7 3v7.5M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 10.5V21"/><path d="M17 21V3c-2.2 1.4-3.2 4-3.2 7.2 0 1.5.9 2.3 3.2 2.3"/>'),
  more: P('<circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/>', ' data-fill="1"'),
  // settled by
  water: P('<path d="M12 3.5c3.2 4 5.5 7 5.5 10a5.5 5.5 0 0 1-11 0c0-3 2.3-6 5.5-10z"/>'),
  drink: P('<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M9 3.5c-.8 1 .8 2 0 3M12.5 3.5c-.8 1 .8 2 0 3"/>'),
  shake: P('<path d="M8.5 7.5h7l-1 13h-5z"/><path d="M8 7.5h8M11 7.5l1.5-4.5h3"/>'),
  food: P('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/>'),
  passed: P('<path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" stroke-dasharray="2.5 3"/><path d="M12 3.5a8.5 8.5 0 0 0-8.5 8.5"/>'),
  none: P('<circle cx="12" cy="12" r="8.5"/><path d="M6 18L18 6"/>'),
  // parts of the day
  wake: P('<path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 5v3M5.2 10.2l2 1.6M18.8 10.2l-2 1.6"/>'),
  am: P('<circle cx="12" cy="12" r="4.5"/><path d="M12 4v.5M12 19.5v.5M4 12h.5M19.5 12h.5M6.3 6.3l.3.3M17.4 17.4l.3.3M6.3 17.7l.3-.3M17.4 6.6l.3-.3"/>'),
  pm: P('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>'),
  eve: P('<path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 11V6M9.5 8.5L12 11l2.5-2.5"/>'),
  night: P('<path d="M18.5 14.5A7.5 7.5 0 0 1 9.5 5.5a7.5 7.5 0 1 0 9 9z"/>'),
  shot: P('<path d="M14.5 3.5l6 6M17.5 6.5l-9 9-3-3 9-9M8.5 15.5l-5 5M9 9l2 2M11.5 6.5l2 2"/>'),
  info: P('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.2"/>'),
  chevron: P('<path d="M7 10l5 5 5-5"/>'),
  up: P('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down: P('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  flat: P('<path d="M5 12h14"/>'),
  scale: P('<rect x="3.5" y="4" width="17" height="16" rx="4"/><path d="M8.5 9.5a5 5 0 0 1 7 0L12 12"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  minus: P('<path d="M5 12h14"/>'),
  check: P('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  // round 3 (2026-09-30): the shot day card and the pen runway
  // pen (an injector pen, side on)
  pen: P('<rect x="3" y="9.5" width="14" height="5" rx="2.5"/><path d="M17 12h2.5M19.5 10.5v3M7.5 9.5v5"/>'),
  // cross.case (a clinic visit)
  clinic: P('<rect x="3.5" y="7" width="17" height="12.5" rx="3"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M12 10.5v5.5M9.2 13.2h5.6"/>'),
  // dumbbell (the tendon loading)
  load: P('<path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10"/>'),
  // moon (time asleep)
  sleep: P('<path d="M18.5 14.5A7.5 7.5 0 0 1 9.5 5.5a7.5 7.5 0 1 0 9 9z"/>'),
  // a torso outline with one zone (the rested site)
  site: P('<path d="M7 4c0 3-1.5 5-1.5 8.5S7 20 7 20h10s1.5-4 1.5-7.5S17 7 17 4"/><circle cx="12" cy="12.5" r="2.4"/>'),
  left: P('<path d="M15 6l-6 6 6 6"/>'),
  right: P('<path d="M9 6l6 6-6 6"/>'),
  calendar: P('<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
};
