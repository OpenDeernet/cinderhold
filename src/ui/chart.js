import { fmtTime, h } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 420;
const H = 120;
const PAD = { l: 4, r: 4, t: 8, b: 16 };

const SERIES = [
  { key: 'lives', name: 'Lives', color: '#ff6a5a' },
  { key: 'gold', name: 'Gold', color: '#ffc35a' },
  { key: 'enemies', name: 'Enemies', color: '#9fb6ff' },
];

function svg(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// Each series is scaled to its own maximum: the chart shows shape (when the
// Hold took hits, when gold piled up), not absolute values.
export function battleChart(timeline) {
  if (!timeline || timeline.length < 2) return null;
  const t0 = timeline[0].t;
  const t1 = timeline.at(-1).t;
  const span = Math.max(1, t1 - t0);
  const x = (t) => PAD.l + ((t - t0) / span) * (W - PAD.l - PAD.r);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Battle timeline' });

  // Faint bands for each wave.
  let prevWave = timeline[0].wave;
  for (const p of timeline) {
    if (p.wave !== prevWave) {
      root.appendChild(svg('line', { x1: x(p.t), x2: x(p.t), y1: PAD.t, y2: H - PAD.b, class: 'chart-wave' }));
      prevWave = p.wave;
    }
  }

  for (const s of SERIES) {
    const max = Math.max(1, ...timeline.map((p) => p[s.key]));
    const y = (v) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
    const d = timeline.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join('');
    root.appendChild(svg('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  }

  const label = (text, xPos, anchor) => {
    const t = svg('text', { x: xPos, y: H - 3, 'text-anchor': anchor, class: 'chart-axis' });
    t.textContent = text;
    root.appendChild(t);
  };
  label('0:00', PAD.l, 'start');
  label(fmtTime(span), W - PAD.r, 'end');

  return h('div.chart-wrap',
    root,
    h('div.chart-legend', SERIES.map((s) => h('span', h('i', { style: { background: s.color } }), s.name))),
  );
}
