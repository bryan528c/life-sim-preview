import { COUNTRIES } from '../src/game/world.mjs';

/**
 * Independent procedural Canvas2D artwork. No source-game pixels, SVG, external
 * assets or model calls. Seeded appearance is fictional, never inferred from a
 * country or ethnicity. Rendering does not consume or modify a game's RNG.
 */
export const PIXEL_ART_META = Object.freeze({ source: 'procedural-canvas', synthetic: true, originalArtwork: true, referenceArtworkCopied: false, sceneWidth: 192, sceneHeight: 60, portraitWidth: 128, portraitHeight: 160 });
const SKINS = [ ['#e6bd96','#c18f6b'], ['#cf9b72','#ac7653'], ['#ae7953','#86593f'], ['#865c43','#644735'], ['#bc8969','#95654f'] ];
const SHIRTS = [ ['#63889c','#466474'], ['#a66f79','#7e515e'], ['#7d9676','#5c7556'], ['#bf9563','#967147'], ['#8a80a8','#655d83'], ['#5f9b98','#427a79'] ];
const HAIR = ['#443e3b','#5a493d','#302f30','#79634a'];
const LINE = '#43545a';
const DEFAULT = Object.freeze({ age: 0, seed: 4, gender: 'nonbinary', city: 'urban', household: 'middle', status: 'alive' });
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

function hash(value) {
  let n = 2166136261;
  for (const char of String(value)) n = Math.imul(n ^ char.charCodeAt(0), 16777619) >>> 0;
  return n;
}
function appearance(seed, key = 'self', age = 0, gender) {
  const n = hash(`${seed}:${key}`);
  return { skin: SKINS[n % SKINS.length], shirt: SHIRTS[(n >>> 4) % SHIRTS.length], hair: age >= 65 ? '#c4c4b5' : HAIR[(n >>> 8) % HAIR.length], style: gender === 'female' ? 1 : gender === 'male' ? 0 : (n >>> 12) % 3, n };
}

/** List living family without recorded absence; never infer where relatives live. */
export function describeScene(input = DEFAULT) {
  const s = input || DEFAULT, all = [], seen = new Set();
  const add = (p, role, index) => {
    if (!p || p.alive !== true || p.absent === true || p.separated === true ||
      /^(former_|late_)/.test(p.relation || '') ||
      finite(p.assignment?.yearsLeft) > 0 || finite(p.awayUntil) > finite(s.age)) return;
    const id = p.id ?? `${role}-${index}`;
    if (seen.has(id)) return;
    seen.add(id);
    all.push({ id, role, age: Math.max(0, finite(p.age)), gender: p.gender, name: typeof p.name === 'string' ? p.name : '', appearanceKey: `${role}:${String(id).split(':person:').at(-1)}` });
  };
  for (const [i, p] of (s.family?.parents || []).entries()) add(p, 'parent', i);
  if (s.status !== 'ended') all.push({ id: s.lifeId ?? 'self', role: 'self', age: Math.max(0, finite(s.age)), gender: s.gender, name: s.name || '', appearanceKey: 'self' });
  for (const [i, p] of (s.family?.partners || []).entries()) if (p.relation === 'spouse' && !p.separated) add(p, 'partner', i);
  const relationship = s.family?.relationship;
  if (relationship && !relationship.separated && !['former_partner','former_spouse','late_partner','late_spouse'].includes(relationship.relation)) add(relationship, 'partner', 'current');
  const visit = (children, depth = 0) => {
    if (!Array.isArray(children) || depth > 6) return;
    children.forEach((p, i) => { add(p, depth ? 'descendant' : 'child', `${depth}-${i}`); if (p && Array.isArray(p.children)) visit(p.children, depth + 1); });
  };
  visit(s.family?.children);
  // Eight readable figures fit the 192-pixel composition. Overflow is explicit,
  // not replaced by imaginary figures or silently described as a whole family.
  const people = all.slice(0, 8), omittedCount = Math.max(0, all.length - people.length);
  const selfPresent = people.some(p => p.role === 'self');
  const familyCount = all.filter(p => p.role !== 'self').length;
  const label = `${s.city === 'rural' ? '농촌' : '도시'}의 독자 제작 픽셀 풍경. ${selfPresent ? `${finite(s.age)}세 인물과 ` : ''}살아 있는 가까운 가족 ${familyCount}명${omittedCount ? ` 중 ${people.filter(p => p.role !== 'self').length}명 표시, ${omittedCount}명 생략` : ''}. ${s.status === 'ended' ? '삶을 마친 주인공은 현재 풍경에 표시하지 않습니다. ' : ''}부재·이별·파견 중으로 기록된 가족을 제외한 상징 장면이며 실제 동거 위치를 뜻하지 않습니다.`;
  return { source: PIXEL_ART_META.source, synthetic: true, people, totalPeople: all.length, omittedCount, label };
}

function prepare(canvas, width, height) {
  if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('Canvas2D 대상이 필요합니다.');
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas2D를 사용할 수 없습니다.');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  return ctx;
}
function painter(ctx, scale = 1) {
  return (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(Math.round(x * scale), Math.round(y * scale), Math.round(w * scale), Math.round(h * scale)); };
}
// Integer scanlines give round silhouettes while retaining crisp pixel edges.
// No antialiased paths, copied sprite masks or game RNG calls are involved.
function oval(r, x, y, w, h, color) {
  for (let row = 0; row < h; row++) {
    const dy = (row + 0.5 - h / 2) / (h / 2);
    const inset = Math.max(0, Math.round(w / 2 * (1 - Math.sqrt(1 - dy * dy))));
    r(x + inset, y + row, w - inset * 2, 1, color);
  }
}
function cloud(r, x, y, w) {
  r(x + 2, y + 5, w - 3, 1, '#d9ebeb');
  oval(r, x + 4, y, 9, 6, '#f7fbf7'); oval(r, x + w - 12, y + 1, 10, 5, '#f7fbf7');
  r(x + 1, y + 3, w - 1, 2, '#f7fbf7'); r(x + 6, y, 3, 1, '#ffffff');
}
function tree(r, x, y, n = 0) {
  r(x + 4, y + 7, 2, 8, '#89866f'); r(x + 3, y + 9, 1, 2, '#89866f');
  oval(r, x, y + 3, 11, 8, '#6f967a'); oval(r, x + 2, y, 7, 9, '#7aa485');
  oval(r, x + 1, y + 2, 6, 5, '#8db491'); r(x + 3, y + 1, 3, 1, '#a0bf9b');
  r(x + 8, y + 7, 2, 2, '#60876f'); if (n % 2) r(x + 2, y + 8, 2, 1, '#a3bf94');
}
function urban(r, s, n) {
  const past = finite(s.year, 2026) < 1980;
  for (let i = 0; i < 10; i++) {
    const x = 42 + i * 17, h = 9 + ((n >>> (i % 5)) + i * 7) % (past ? 13 : 22);
    r(x, 47 - h, 13, h, i % 2 ? '#a2c4cc' : '#b4cfd3'); r(x, 47 - h, 13, 1, '#9dbfc7');
    if (!past && i % 3 === 0) r(x + 5, 44 - h, 3, 3, '#a2c4cc');
    for (let row = 0; row < h - 3; row += 5) for (let col = 0; col < 10; col += 4) r(x + 2 + col, 49 - h + row, 2, 2, '#c4dce0');
  }
  const tall = s.household === 'high', middle = s.household === 'middle';
  const roof = tall || middle ? 8 : 15, rows = tall ? 6 : 5, windowPitch = middle ? 6 : 5;
  r(4, roof + 2, 31, 46 - roof, '#6e8589');
  r(5, roof + 3, 29, 44 - roof, '#d5d7c9');
  r(6, roof + 1, 27, 2, '#84999a'); r(9, roof, 7, 1, '#84999a'); r(26, roof, 4, 1, '#84999a');
  r(7, roof + 4, 25, 1, '#eef0df');
  for (let row = 0; row < rows; row++) for (let col = 0; col < 4; col++) {
    const x = 7 + col * 6, y = roof + 6 + row * windowPitch;
    if (y > 40) continue;
    r(x, y, 4, 3, '#93b2bc'); r(x, y, 1, 3, '#738c98'); r(x, y + 3, 4, 1, '#f1e8d6');
    r(x + 2, y, 1, 2, '#d0dfd9'); r(x, y - 1, 4, 1, '#bbc3b4');
    if ((row + col + n) % 4 === 0) r(x + 2, y + 1, 2, 2, '#d9cfa2');
  }
  r(16, 41, 7, 7, '#6b7980'); r(18, 42, 3, 5, '#b5d9d9');
  r(21, 44, 1, 1, '#e2ddbc'); r(15, 40, 9, 1, '#a6b6ac');
  r(8, 46, 5, 2, '#9aa68d'); r(9, 45, 3, 1, '#6f947b');
  r(29, roof - 2, 2, 3, '#778d90'); r(28, roof - 2, 4, 1, '#91a3a0');
  r(35, 45, 3, 3, '#bec5bc');
  tree(r, 43, 33, n); tree(r, 181, 32, n + 1);
  r(68, 24, 1, 23, '#87999a'); r(65, 25, 7, 1, '#87999a'); r(64, 26, 3, 1, '#e6e9d1');
  r(67, 26, 1, 5, '#a0b6b6'); r(69, 30, 35, 1, '#a3bfc2'); r(104, 29, 41, 1, '#a3bfc2');
  r(58, 44, 6, 3, '#a5b4a0'); r(59, 42, 4, 2, '#779d7b'); r(60, 42, 1, 1, '#d5b99d');
}
function rural(r, s, n) {
  r(0, 26, 192, 22, '#bbd1aa');
  for (let i = 0; i < 8; i++) { const x = i * 27, h = 3 + (i * 7 + n) % 9; r(x, 27 - h, 20, h + 3, '#b6cbaa'); r(x + 6, 24 - h, 9, 4, '#b6cbaa'); }
  r(0, 34, 192, 14, '#a7bd8e'); r(0, 40, 192, 2, '#c4ce9a');
  for (let x = 48; x < 190; x += 8) r(x, 42, 1, 5, '#869d71');
  const wall = s.household === 'low' ? '#c8c4aa' : '#e1d9bd';
  r(8, 29, 29, 19, '#778477'); r(9, 30, 27, 17, wall);
  for (let y = 0; y < 8; y++) r(6 + y * 2, 29 - y, 33 - y * 4, 1, y % 2 ? '#997e6e' : '#a48a75');
  r(8, 29, 29, 2, '#846d61'); r(12, 34, 6, 6, '#829da2'); r(13, 35, 4, 4, '#b7d1cf');
  r(25, 36, 7, 11, '#8b8870'); r(26, 37, 5, 9, '#a7b7a0'); r(29, 41, 1, 1, '#647b78');
  r(36, 37, 5, 10, '#d3ccb0'); r(12, 40, 6, 1, '#ded9be'); r(14, 35, 1, 5, '#d9decc');
  r(11, 42, 8, 3, '#b8ae87'); r(12, 41, 6, 1, '#729b79');
  r(23, 46, 11, 2, '#aca790'); r(10, 28, 25, 1, '#c2a485');
  for (let x = 67; x < 148; x += 12) { r(x, 37, 7, 1, '#d0c493'); r(x + 2, 35, 1, 3, '#91a575'); r(x + 4, 36, 1, 2, '#91a575'); }
  tree(r, 44, 33, n); tree(r, 175, 31, n + 1);
  r(164, 40, 2, 8, '#958e70'); r(163, 38, 4, 3, '#a4bdb2');
}

function isStudying(s) {
  return s.status !== 'ended' && !s.flags?.educationOnLeave && !s.flags?.educationPaused &&
    (Boolean(s.education?.program) || (s.age >= 6 && s.age < 18 && Boolean(s.education?.level) && s.education.level !== 'none'));
}
function bench(r, x, y) {
  r(x + 1, y, 13, 1, '#8f9280'); r(x + 1, y + 2, 13, 1, '#b3af91');
  r(x, y + 4, 15, 1, '#8f9280'); r(x + 2, y + 5, 1, 3, '#687d77'); r(x + 12, y + 5, 1, 3, '#687d77');
}
function lifePlace(r, s) {
  // This is a symbolic setting, not a claim that a named school or workplace
  // exists. A school/bag only appears when the supplied state records study.
  if (isStudying(s)) {
    r(154, 34, 31, 14, '#7f948d'); r(155, 35, 29, 12, '#e1dcca');
    for (let row = 0; row < 7; row++) r(151 + row * 2, 34 - row, 37 - row * 4, 1, row % 2 ? '#6d9691' : '#80aaa2');
    r(153, 34, 33, 1, '#5f837e'); r(169, 29, 2, 2, '#e5e6d0'); r(169, 29, 1, 1, '#5b7778');
    for (const x of [158, 177]) { r(x, 37, 5, 4, '#a6b7b2'); r(x + 1, 38, 3, 2, '#b9d5d7'); r(x, 41, 5, 1, '#c2ad89'); }
    r(167, 40, 6, 7, '#aa9678'); r(168, 41, 4, 6, '#d7c7a5'); r(171, 43, 1, 1, '#718482');
    r(164, 47, 12, 1, '#aab3a4'); r(183, 26, 1, 8, '#8ca19d'); r(184, 26, 4, 2, '#ab7984');
  } else if (s.status !== 'ended' && s.age >= 2 && s.age < 6) {
    // An unoccupied play area; never add invented friends or siblings.
    r(154, 46, 23, 2, '#d6c4a0'); r(156, 47, 19, 1, '#c5b08a');
    r(155, 35, 1, 11, '#9e9381'); r(167, 35, 1, 11, '#9e9381'); r(154, 34, 15, 1, '#859b91');
    r(159, 35, 1, 8, '#afac91'); r(164, 35, 1, 8, '#afac91'); r(158, 43, 8, 1, '#a98170');
    oval(r, 173, 44, 4, 4, '#bd917c'); r(174, 44, 1, 2, '#e4c79c');
  } else if (s.status !== 'ended' && s.career?.jobId && !s.career.retired) {
    r(155, 35, 28, 13, '#7c9693'); r(156, 36, 26, 11, '#d7d6c0');
    r(154, 34, 30, 3, '#759d96'); for (let x = 156; x < 184; x += 5) r(x, 35, 2, 2, '#a5c1b3');
    r(158, 39, 13, 6, '#9bb5b9'); r(159, 40, 11, 1, '#d0e0d8'); r(164, 39, 1, 6, '#becfc4');
    r(175, 39, 5, 8, '#a0aca0'); r(178, 43, 1, 1, '#e8dfbd'); r(160, 32, 16, 2, '#b7bda5');
  } else {
    bench(r, 160, 40); r(178, 44, 5, 4, '#a3a88d'); r(177, 43, 7, 2, '#8c9f82');
    r(179, 41, 1, 3, '#79a08b'); r(181, 42, 1, 2, '#bb8e94');
  }
}

function personSprite(r, x, baseline, p, seed, state) {
  const a = appearance(seed, p.appearanceKey, p.age, p.gender), skin = a.skin[0], shade = a.skin[1];
  if (p.age < 2) {
    const y = baseline - 11;
    oval(r, x, y + 5, 12, 6, '#7d9690'); oval(r, x + 1, y + 5, 10, 5, '#b6cdbb');
    oval(r, x + 2, y, 8, 8, a.hair); oval(r, x + 2, y + 1, 8, 7, shade); oval(r, x + 3, y + 1, 6, 6, skin);
    r(x + 4, y + 1, 3, 1, a.hair); r(x + 4, y + 3, 1, 1, LINE); r(x + 7, y + 3, 1, 1, LINE);
    r(x + 5, y + 5, 2, 1, '#a27061'); r(x + 2, y + 7, 8, 1, '#d9e3ce');
    r(x + 5, y + 8, 3, 1, '#87aaa3'); r(x + 2, y + 10, 8, 1, '#758e86');
    return;
  }
  const child = p.age < 13, youth = p.age < 18, elder = p.age >= 75;
  const height = p.age < 6 ? 14 : child ? 16 : youth ? 20 : elder ? 20 : 22, y = baseline - height;
  const headH = child ? 8 : 10, headW = child ? 9 : 11, hx = x + (child ? 2 : 1), bodyY = y + headH - 1;
  const bodyH = height - headH - 2;
  // Shoulders slope into arms; a short waist and separated shoes avoid a block torso.
  r(x + 4, bodyY, 5, 1, LINE); r(x + 2, bodyY + 1, 9, 2, LINE);
  r(x + 1, bodyY + 3, 11, Math.max(1, bodyH - 3), LINE);
  r(x + 3, bodyY + 1, 7, bodyH - 1, a.shirt[0]); r(x + 8, bodyY + 2, 2, bodyH - 2, a.shirt[1]);
  r(x + 2, bodyY + 2, 2, Math.max(1, bodyH - 3), a.shirt[0]); r(x + 10, bodyY + 2, 1, Math.max(1, bodyH - 3), a.shirt[1]);
  r(x + 1, bodyY + bodyH - 2, 2, 2, skin); r(x + 10, bodyY + bodyH - 2, 2, 2, shade);
  r(x + 3, baseline - 4, 3, 3, '#60747e'); r(x + 7, baseline - 4, 3, 3, '#60747e');
  r(x + 3, baseline - 4, 1, 2, '#7b8b8e'); r(x + 2, baseline - 1, 4, 1, LINE); r(x + 7, baseline - 1, 4, 1, LINE);
  oval(r, hx, y, headW, headH, a.hair);
  r(hx, y + 4, 1, 3, shade); r(hx + headW - 1, y + 4, 1, 3, shade);
  oval(r, hx + 1, y + 2, headW - 2, headH - 2, shade);
  oval(r, hx + 1, y + 2, headW - 3, headH - 3, skin);
  r(hx + 2, y + 1, headW - 4, 2, a.hair); r(hx + 1, y + 3, 2, 1, a.hair);
  if (a.style === 1) { r(hx, y + 3, 1, headH - 2, a.hair); r(hx + headW - 1, y + 3, 1, headH - 2, a.hair); }
  else if (a.style === 2) { r(hx + 3, y, 3, 1, a.hair); r(hx + 2, y + 2, 2, 2, a.hair); }
  const eyeY = y + (child ? 4 : 5);
  r(hx + 2, eyeY, 1, 1, LINE); r(hx + headW - 3, eyeY, 1, 1, LINE);
  r(hx + Math.floor(headW / 2), eyeY + 1, 1, 1, shade);
  r(hx + Math.floor(headW / 2) - 1, eyeY + 2, 2, 1, '#9f6d5b');
  if (elder) { r(hx + 1, eyeY - 1, headW - 2, 1, '#8e9991'); r(hx + 1, eyeY, 1, 2, '#aab7b1'); r(hx + headW - 2, eyeY, 1, 2, '#aab7b1'); }
  r(x + 5, bodyY + 1, 3, 1, '#dedfca'); r(x + 6, bodyY + 2, 1, Math.max(1, bodyH - 3), a.shirt[1]);
  if (!child) { r(x + 8, bodyY + 3, 1, 1, '#c4c6b6'); r(x + 6, bodyY + 4, 1, 1, '#d8d8c4'); }
  if (p.role === 'self' && isStudying(state)) { r(x, bodyY + 1, 2, 4, '#a8815d'); r(x + 1, bodyY + 2, 1, 3, '#c4ab7d'); r(x + 3, bodyY + 1, 1, bodyH - 1, '#bcaa85'); }
  if (p.role === 'self' && state.career?.jobId && !state.career.retired && state.age >= 18) { r(x + 6, bodyY + 2, 1, 3, '#58647c'); r(x + 12, baseline - 5, 3, 4, '#9b8970'); r(x + 13, baseline - 6, 1, 1, '#796e5e'); }
  if (elder) { r(x + 13, baseline - 7, 1, 7, '#88765e'); r(x + 12, baseline - 7, 2, 1, '#88765e'); }
}

/** Draw at the source scene's small pixel-grid dimensions, without copied art. */
export function drawScene(canvas, input = DEFAULT) {
  const s = input || DEFAULT, ctx = prepare(canvas, 192, 60), r = painter(ctx), seed = finite(s.seed, 4), n = hash(`${seed}:landscape`);
  r(0, 0, 192, 60, '#acd8e0'); r(0, 17, 192, 12, '#b7dce1'); r(0, 29, 192, 19, '#c7e0dc');
  cloud(r, 60 + n % 8, 7, 18); cloud(r, 108 + n % 13, 3, 22); cloud(r, 151, 12, 25);
  if (s.city === 'rural') rural(r, s, n); else urban(r, s, n);
  lifePlace(r, s);
  r(0, 47, 192, 6, '#cfcec0'); r(0, 48, 192, 1, '#e8e6d6'); r(0, 52, 192, 1, '#999e99');
  for (let x = 39; x < 151; x += 8) { r(x, 43, 1, 5, '#8caaa4'); r(x + 1, 44, 7, 1, '#a5bdb4'); }
  for (let x = 4; x < 192; x += 19) { r(x, 50, 8, 1, '#c3c5b7'); r(x + 5, 49, 1, 1, '#e5e0ca'); }
  r(0, 53, 192, 7, '#858e90'); r(0, 53, 192, 1, '#727e82');
  for (let x = 5; x < 192; x += 15) r(x, 57, 7, 1, '#d4d7cf');
  const detail = describeScene(s);
  // Keep the young three-person family together; larger groups and extended
  // props (such as an elder's cane) retain their existing spacing.
  const compactFamily = s.status !== 'ended' && finite(s.age) < 13 && detail.totalPeople === 3 &&
    detail.people.filter(p => p.role === 'parent').length === 2 &&
    detail.people.some(p => p.role === 'self') && detail.people.every(p => p.age < 75);
  const spacing = compactFamily ? 13 : 15, center = compactFamily ? 110 : 117;
  const width = detail.people.length * spacing, left = Math.round(center - width / 2);
  for (const [i, p] of detail.people.entries()) {
    const x = left + i * spacing;
    oval(r, x, 48, 14, 3, '#acb7a9');
    personSprite(r, x, 49, p, seed, s);
  }
  // Empty seats are part of the setting, never stand-ins for deceased people.
  if (!detail.people.length) bench(r, 109, 41);
  canvas.setAttribute?.('role', 'img'); canvas.setAttribute?.('aria-label', detail.label);
  return detail;
}

/** A life-record portrait remains available after death; it is not a live actor. */
export function drawPortrait(canvas, input = DEFAULT) {
  const s = input || DEFAULT, ctx = prepare(canvas, 128, 160), r = painter(ctx, 4), age = Math.max(0, finite(s.age)), a = appearance(finite(s.seed, 4), 'self', age, s.gender);
  r(0, 0, 32, 40, '#acd4da'); r(0, 25, 32, 15, '#bccfc9');
  for (let y = 2; y < 39; y += 4) for (let x = 1; x < 32; x += 4) if ((x + y + a.n) % 3) r(x, y, 1, 1, '#c6e2df');
  r(0, 0, 32, 1, '#8caeb7'); r(0, 39, 32, 1, '#78989b'); r(0, 0, 1, 40, '#8caeb7'); r(31, 0, 1, 40, '#8caeb7');
  const baby = age < 2, child = age < 13;
  const x = baby ? 6 : child ? 7 : 6, y = baby ? 10 : child ? 7 : 5, w = baby ? 20 : child ? 18 : 20, h = baby ? 18 : child ? 20 : 22;
  // Rounded shoulders / blanket are drawn behind the head, so the chin remains
  // visible at all ages. Stable seeded features survive growth and ageing.
  oval(r, 4, 26, 24, 22, LINE); oval(r, 5, 27, 22, 20, a.shirt[0]);
  r(22, 31, 4, 7, a.shirt[1]); r(6, 33, 1, 5, a.shirt[1]); r(24, 35, 2, 3, LINE);
  r(12, 25, 8, 5, a.skin[1]); r(13, 25, 6, 4, a.skin[0]);
  if (baby) { oval(r, 4, 8, 24, 29, '#7b9e9b'); oval(r, 5, 9, 22, 27, '#b8d0bf'); }
  oval(r, x, y, w, h, a.hair);
  if (a.style === 1 && !baby) { oval(r, x - 1, y + 6, 5, 18, a.hair); oval(r, x + w - 4, y + 6, 5, 18, a.hair); }
  oval(r, x - 1, y + 9, 4, 5, a.skin[1]); oval(r, x + w - 3, y + 9, 4, 5, a.skin[1]);
  oval(r, x + 1, y + 2, w - 2, h - 2, a.skin[1]); oval(r, x + 1, y + 2, w - 4, h - 4, a.skin[0]);
  if (baby) {
    r(x + 7, y + 1, 5, 1, a.hair); r(x + 8, y, 3, 1, a.hair); r(x + 8, y + 2, 2, 1, a.hair);
  } else {
    r(x + 5, y + 1, w - 10, 1, a.hair); r(x + 3, y + 2, w - 6, 2, a.hair);
    r(x + 1, y + 4, 4, 2, a.hair); r(x + 2, y + 3, 5, 2, a.hair); r(x + 1, y + 6, 2, 3, a.hair);
    r(x + w - 3, y + 4, 2, a.style === 1 ? 11 : 5, a.hair);
    if (a.style === 2) { r(x + 6, y + 3, 3, 3, a.hair); r(x + 8, y + 4, 2, 1, a.hair); }
    r(x + 4, y, 3, 1, a.hair);
  }
  const eyesY = y + (baby ? 8 : 10), eyeL = x + 4, eyeR = x + w - 7;
  r(eyeL, eyesY, 3, 2, '#e6ded0'); r(eyeR, eyesY, 3, 2, '#e6ded0');
  r(eyeL + 1, eyesY, 2, 2, '#424c4b'); r(eyeR + 1, eyesY, 2, 2, '#424c4b');
  r(eyeL + 1, eyesY, 1, 1, '#f0eee2'); r(eyeR + 1, eyesY, 1, 1, '#f0eee2');
  if (!baby) { r(eyeL, eyesY - 2, 3, 1, a.hair); r(eyeR, eyesY - 2, 3, 1, a.hair); }
  r(x + w / 2, eyesY + 2, 1, 2, a.skin[1]); r(x + w / 2 - 1, eyesY + 4, 3, 1, a.skin[1]);
  r(x + w / 2 - 2, eyesY + 6, 4, 1, '#9b6956'); r(x + w / 2 - 1, eyesY + 7, 2, 1, a.skin[1]);
  r(eyeL, eyesY + 3, 2, 1, '#c18d78'); r(eyeR + 1, eyesY + 3, 2, 1, a.skin[1]);
  if (age >= 60) {
    for (const eye of [eyeL, eyeR]) { r(eye - 1, eyesY - 1, 5, 1, '#7d8d8c'); r(eye - 1, eyesY + 2, 5, 1, '#7d8d8c'); r(eye - 1, eyesY, 1, 2, '#7d8d8c'); r(eye + 3, eyesY, 1, 2, '#7d8d8c'); }
    r(eyeL + 4, eyesY, eyeR - eyeL - 4, 1, '#7d8d8c'); r(x + 4, eyesY + 5, 2, 1, a.skin[1]);
  }
  if (baby) {
    r(7, 28, 18, 2, '#d4e1cd'); r(8, 30, 16, 2, '#a6c6bb'); r(10, 32, 14, 2, '#c9dcc6');
    r(11, 34, 12, 3, '#a6c6bb'); r(13, 37, 8, 1, '#d4e1cd');
  } else {
    r(10, 28, 3, 2, '#e4e4d2'); r(19, 28, 3, 2, '#e4e4d2'); r(12, 30, 3, 1, '#e4e4d2'); r(17, 30, 3, 1, '#e4e4d2');
    r(15, 31, 2, 7, a.shirt[1]); r(16, 32, 1, 1, '#dedcc3'); r(16, 35, 1, 1, '#dedcc3');
    r(20, 33, 3, 1, a.shirt[1]);
    if (isStudying(s)) { r(8, 30, 2, 8, '#b8a17a'); r(22, 30, 2, 8, '#9d895f'); }
  }
  r(2, 38, 28, 1, '#708d91');
  const label = `${age}세 ${s.status === 'ended' ? '회고 기록의 ' : ''}독자 제작 픽셀 인물 초상. 피부·머리 표현은 시드로 정한 가상 외형입니다.`;
  canvas.setAttribute?.('role', 'img'); canvas.setAttribute?.('aria-label', label);
  return { source: PIXEL_ART_META.source, synthetic: true, age, label, archival: s.status === 'ended' };
}

/** Render fresh canvases after the UI replaces its DOM. */
export function renderPixelScenes(root, state = DEFAULT) {
  if (!root?.querySelectorAll) return;
  for (const canvas of root.querySelectorAll('canvas[data-pixel-scene]')) drawScene(canvas, state);
  for (const canvas of root.querySelectorAll('canvas[data-pixel-portrait]')) drawPortrait(canvas, state);
}
function dataURL(draw, state) {
  // Node-only HTML rendering tests have no Canvas implementation. The actual
  // browser path always uses Canvas; no SVG or external-image fallback exists.
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas'); draw(canvas, state); return canvas.toDataURL('image/png');
}
export const sceneDataURL = state => dataURL(drawScene, state);
export const portraitDataURL = state => dataURL(drawPortrait, state);

// Authored silhouettes on an arbitrary 200×85 drawing grid. These outlines are
// decorative, not GIS coordinates, political borders or measured geography.
const LAND_SHAPES = [
  ['northAmerica', [[8,11],[16,5],[35,4],[44,11],[53,9],[60,17],[52,25],[42,29],[33,38],[27,35],[24,30],[15,29],[14,21],[9,20]]],
  ['northAmerica', [[33,34],[42,35],[49,44],[45,45],[37,39]]],
  ['northAmerica', [[48,4],[60,3],[65,7],[61,14],[53,16],[49,10]]],
  ['southAmerica', [[44,43],[55,42],[65,49],[64,58],[59,69],[53,79],[49,76],[48,66],[45,58],[41,48]]],
  ['europe', [[93,12],[103,8],[113,11],[115,17],[109,22],[100,24],[94,21],[88,24],[89,17]]],
  ['africa', [[96,26],[109,24],[119,30],[121,41],[115,48],[112,60],[105,69],[99,64],[96,53],[90,45],[88,33]]],
  ['africa', [[120,55],[122,54],[121,63],[119,65],[118,61]]],
  ['asia', [[112,11],[125,6],[143,6],[150,10],[164,8],[176,15],[184,16],[181,24],[169,29],[161,37],[157,47],[149,42],[145,34],[139,42],[133,44],[125,36],[121,26],[112,24]]],
  ['asia', [[153,46],[157,46],[160,51],[156,53],[153,50]]],
  ['asia', [[163,47],[173,49],[177,53],[171,54],[165,51]]],
  ['asia', [[178,29],[180,29],[178,37],[176,39],[176,35]]],
  ['oceania', [[164,57],[180,53],[186,58],[188,69],[178,73],[166,69],[162,61]]],
  ['oceania', [[194,70],[196,71],[193,77],[190,80],[189,78],[192,74]]],
];
function inside(x, y, polygon) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) result = !result;
  }
  return result;
}

/** Decorative world diagram. Selection highlights a broad region, never a pin. */
export function drawWorldMap(canvas, countryId = null) {
  const ctx = prepare(canvas, 640, 271), points = [];
  const selected = COUNTRIES.find(item => item.id === countryId), region = selected?.region ?? null;
  for (let y = 10; y < 261; y += 4) for (let x = 5; x < 635; x += 4) {
    const shape = LAND_SHAPES.find(([, polygon]) => inside(x / 3.2, y / (271 / 85), polygon));
    if (!shape) continue;
    points.push({ x, y, region: shape[0] });
    ctx.fillStyle = region === shape[0] ? '#8c1d3c' : '#c7d2ce';
    ctx.beginPath(); ctx.arc(x, y, 1.15, 0, Math.PI * 2); ctx.fill();
  }
  let decorativePointCount = 0;
  if (!countryId) {
    // Fixed decorative accents: no live births, measured density or users.
    const used = new Set();
    for (let i = 0; i < 42; i++) {
      const point = points[hash(`decorative-world-${i}`) % points.length];
      const key = `${point.x}:${point.y}`;
      if (used.has(key)) continue;
      used.add(key); decorativePointCount++;
      const radius = 3 + hash(`decorative-size-${i}`) % 5;
      ctx.fillStyle = '#8c1d3ca8'; ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill();
    }
  }
  const label = selected ? `${selected.name}의 대륙권을 넓게 강조한 세계 도식. 정확한 국가·도시 위치가 아닙니다.` : '독자 제작 점묘 세계 도식. 장식점은 가상이며 실시간 출생이나 온라인 이용자 수가 아닙니다.';
  canvas.setAttribute?.('role', 'img'); canvas.setAttribute?.('aria-label', label);
  return { source: 'authored-world-diagram', synthetic: true, width: 640, height: 271, countryId: selected?.id ?? null, highlightedRegion: region, marker: null, countryLocated: false, geographicCoordinates: false, liveData: false, decorativePointCount, label };
}
export const worldMapDataURL = countryId => dataURL(drawWorldMap, countryId);
