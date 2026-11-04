// Deck generator: node gen.mjs <content.mjs> <outRoot>
// Writes <outRoot>/project/deck.json and <outRoot>/project/slides/<id>.html
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , contentPath, outRoot] = process.argv;
const deck = (await import(pathToFileURL(path.resolve(contentPath)).href)).default;
const LOGO_DARK = process.env.LOGO_DARK ?? ''; // /_blob/<id> of the on-dark logo
const LOGO_LIGHT = process.env.LOGO_LIGHT ?? '';

const C = {
  navy: '#06113C',
  navy2: '#0E1D5A',
  orange: '#FF8A32',
  canvas: '#ECECEC',
  paper: '#FAFAF8',
  white: '#FFFFFF',
  muted: '#4A5270',
  line: '#D5D7DE',
  today: '#FFF4E8',
  warnBg: '#FFF1CC',
  warn: '#7A4A00',
  infoBg: '#E3ECFB',
  info: '#1D4FA8',
  okBg: '#E6F4EA',
  ok: '#146C2E',
  onNavyMuted: '#B9C0DA',
};
const BODY = "'Golos Text', Arial, sans-serif";
const SLAB = "'Bitter', Georgia, serif";

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
// **bold** and `path` (shown as bold navy) inside text
const rich = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`(.+?)`/g, '<b>$1</b>');

let pageNo = 0;
const footer = (dark) =>
  `<p style="position:absolute;left:128px;bottom:64px;width:1400px;font-size:24px;color:${dark ? C.onNavyMuted : C.muted}">${esc(deck.footer)} · ${pageNo}</p>`;
const notes = (n) => (n ? `<aside>${esc(n).slice(0, 3990)}</aside>` : '');
const section = (id, bg, inner, opts = {}) =>
  `<section id="${id}"${opts.transition ? ` data-transition="${opts.transition}"` : ''} style="background:${bg};color:${opts.color ?? C.navy};font-family:${BODY};padding:${opts.padding ?? '128px 128px 160px'};display:flex;flex-direction:column;gap:${opts.gap ?? 40}px;justify-content:${opts.justify ?? 'flex-start'}">\n${inner}\n</section>\n`;

const h2 = (t, color = C.navy) =>
  `<h2 style="font-size:64px;font-weight:700;line-height:1.1;color:${color}">${rich(t)}</h2>`;

function cover(s) {
  const logo = LOGO_DARK
    ? `<img src="${LOGO_DARK}" alt="Sodiq School" style="width:460px;height:74px;object-fit:contain">`
    : '';
  return section(
    s.id,
    C.navy,
    `<div style="position:absolute;left:0;top:0;width:1920px;height:24px;background:${C.orange}"></div>
${logo}
<div style="display:flex;flex-direction:column;gap:28px">
<p style="font-size:32px;font-weight:600;color:${C.orange}">${rich(s.kicker ?? 'Tutorial')}</p>
<h1 style="font-family:${SLAB};font-size:112px;font-weight:700;line-height:1.05;color:${C.white}">${rich(s.title)}</h1>
<p style="font-size:36px;line-height:1.35;color:${C.onNavyMuted};width:1400px">${rich(s.sub ?? '')}</p>
</div>
<p style="font-size:28px;color:${C.onNavyMuted}">${rich(s.meta ?? '')}</p>
${notes(s.notes)}`,
    { color: C.white, justify: 'space-between', padding: '128px' },
  );
}

function divider(s) {
  return section(
    s.id,
    C.navy,
    `<p style="font-size:40px;font-weight:600;color:${C.orange}">${rich(s.num ?? '')}</p>
<h2 style="font-family:${SLAB};font-size:96px;font-weight:700;line-height:1.08;color:${C.white};width:1500px">${rich(s.title)}</h2>
<p style="font-size:36px;line-height:1.4;color:${C.onNavyMuted};width:1400px">${rich(s.sub ?? '')}</p>
${footer(true)}
${notes(s.notes)}`,
    { color: C.white, justify: 'center', gap: 32, transition: 'fade' },
  );
}

const card = (title, body, opts = {}) =>
  `<div style="flex:${opts.flex ?? 1};display:flex;flex-direction:column;gap:14px;background:${opts.bg ?? C.white};padding:28px 32px;border-radius:16px${opts.border === false ? '' : `;border:1px solid ${C.line}`}">
<h3 style="font-size:28px;font-weight:700;color:${opts.titleColor ?? C.muted}">${rich(title)}</h3>
${body}
</div>`;
const list = (items, size = 28) =>
  `<ul style="display:flex;flex-direction:column;gap:10px;font-size:${size}px;line-height:1.35;padding-left:32px">${items
    .map((i) => `<li>${rich(i)}</li>`)
    .join('')}</ul>`;
const para = (t, size = 28) => `<p style="font-size:${size}px;line-height:1.4">${rich(t)}</p>`;
const bodyOf = (v, size) => (Array.isArray(v) ? list(v, size) : para(v, size));

// A feature slide: title, what, steps (click path), camera (what to show), roles, time
function feature(s) {
  const left = [
    s.what ? card('What it does', bodyOf(s.what, 26)) : '',
    s.steps ? card('How: click by click', bodyOf(s.steps, 24)) : '',
  ].join('\n');
  const rightParts = [];
  if (s.show) rightParts.push(card('Show on camera', bodyOf(s.show, 24), { bg: C.today, border: false }));
  if (s.time) rightParts.push(card('Time', bodyOf(s.time, 24), { bg: C.warnBg, border: false, titleColor: C.warn }));
  if (s.who) rightParts.push(card('Who', bodyOf(s.who, 24), { bg: C.infoBg, border: false, titleColor: C.info }));
  return section(
    s.id,
    C.canvas,
    `${h2(s.title)}
<div style="display:flex;gap:32px;flex:1">
<div style="flex:1.25;display:flex;flex-direction:column;gap:24px">${left}</div>
<div style="flex:1;display:flex;flex-direction:column;gap:24px">${rightParts.join('\n')}</div>
</div>
${footer(false)}
${notes(s.notes)}`,
  );
}

function table(s) {
  const size = s.size ?? 24;
  const head = `<tr>${s.head.map((h) => `<th style="text-align:left;padding:12px 16px;background:${C.navy};color:${C.white};font-size:${size}px;font-weight:600">${rich(h)}</th>`).join('')}</tr>`;
  const rows = s.rows
    .map(
      (r, i) =>
        `<tr>${r
          .map(
            (c, j) =>
              `<td style="padding:10px 16px;font-size:${size}px;line-height:1.3;background:${i % 2 ? '#F6F6F6' : C.white};border-bottom:1px solid ${C.line}${j === 0 ? ';font-weight:600' : ''}">${rich(c)}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('\n');
  return section(
    s.id,
    C.canvas,
    `${h2(s.title)}
${s.lead ? para(s.lead, 28) : ''}
<table style="width:1664px;border-collapse:collapse">${head}
${rows}</table>
${footer(false)}
${notes(s.notes)}`,
    { gap: 28 },
  );
}

// Two or three cards side by side
function cards(s) {
  const n = s.cards.length;
  return section(
    s.id,
    C.canvas,
    `${h2(s.title)}
${s.lead ? para(s.lead, 30) : ''}
<div style="display:flex;gap:28px;flex:1">
${s.cards.map((c) => card(c.title, bodyOf(c.body, c.size ?? (n > 2 ? 25 : 27)), { bg: c.tone === 'today' ? C.today : c.tone === 'warn' ? C.warnBg : c.tone === 'info' ? C.infoBg : c.tone === 'ok' ? C.okBg : C.white, border: !c.tone, titleColor: c.tone === 'warn' ? C.warn : c.tone === 'info' ? C.info : c.tone === 'ok' ? C.ok : C.muted })).join('\n')}
</div>
${footer(false)}
${notes(s.notes)}`,
  );
}

function statement(s) {
  return section(
    s.id,
    C.orange,
    `<h2 style="font-family:${SLAB};font-size:80px;font-weight:700;line-height:1.12;color:${C.navy};width:1560px">${rich(s.title)}</h2>
${s.sub ? `<p style="font-size:36px;line-height:1.4;color:${C.navy};width:1450px">${rich(s.sub)}</p>` : ''}
${footer(false).replace(C.muted, C.navy)}
${notes(s.notes)}`,
    { justify: 'center', gap: 36, transition: 'fade' },
  );
}

const render = { cover, divider, feature, table, cards, statement };

const outSlides = path.join(outRoot, 'project', 'slides');
fs.rmSync(path.join(outRoot, 'project'), { recursive: true, force: true });
fs.mkdirSync(outSlides, { recursive: true });
const order = [];
const sections = {};
const seen = new Set();
deck.slides.forEach((s, i) => {
  pageNo = i + 1;
  if (!s.id) s.id = `s${String(i + 1).padStart(3, '0')}`;
  if (seen.has(s.id)) throw new Error(`duplicate id ${s.id}`);
  seen.add(s.id);
  const fn = render[s.kind];
  if (!fn) throw new Error(`unknown kind ${s.kind} in ${s.id}`);
  fs.writeFileSync(path.join(outSlides, `${s.id}.html`), fn(s));
  order.push(s.id);
  if (s.kind === 'cover' || s.kind === 'divider') {
    sections[`k${Object.keys(sections).length + 1}`] = {
      description: (s.section ?? s.title).replace(/\*\*/g, ''),
      start: s.id,
    };
  }
});
const index = {
  v: 4,
  createdOnFiles: { v: 1, at: new Date().toISOString() },
  lists: 'css',
  title: deck.title,
  order,
  sections,
  cover: order[0],
  faces: {
    'golos-text': {
      family: 'Golos Text',
      href: 'https://fonts.googleapis.com/css2?family=Golos+Text:wght@400..900&display=swap',
    },
    bitter: {
      family: 'Bitter',
      href: 'https://fonts.googleapis.com/css2?family=Bitter:wght@400..800&display=swap',
    },
  },
  designSystems: [],
};
fs.writeFileSync(path.join(outRoot, 'project', 'deck.json'), JSON.stringify(index, null, 2));
const files = Object.fromEntries(
  order.map((id) => [`project/slides/${id}.html`, `project/slides/${id}.html`]),
);
fs.writeFileSync(path.join(outRoot, 'files.json'), JSON.stringify(files));
console.log(`${deck.title}: ${order.length} slides`);
