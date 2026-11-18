// Copia di strumenti/pennino/prova/polvere.mjs (sito/strumenti/copia_sprite.py): non modificare qui.
// Polvere a nuvola: sbuffi fatti di globi tondi a pixel (4 toni: bordo in luce, luce, medio, pancia in ombra)
// che nascono piccoli, si gonfiano scorrendo lungo il terreno, rallentano, si piegano col vento e si sciolgono a grana
// (retino ordinato 4×4, mai trasparenza liscia). Anelli bassi d'urto e onde di polvere per gli atterraggi pesanti.
// Pool fisso a strutture di array (nessuna allocazione nel ciclo); globi e anelli pre-disegnati per taglia e livello
// di retino, in cache (tele create al primo uso). La simulazione non tocca il DOM (si prova in Node).
// Misure pensate a H = 48 e scalate per s = H / 48; vento in H/s (vento.mjs).

export const RMAX = 16;              // raggio massimo di un globo (px)
export const LIVELLI = 5;            // retino: 0 pieno … 4 quasi sciolto
const COPRE = [16, 12, 8, 5, 2];     // celle accese su 16 per livello
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Luce del mondo (in alto a destra, come LUCE_BASE: azimut 54°, alzo 40°): x destra, y in giù. */
const LX = 0.59, LY = -0.81;

/** Tavolozze: [bordo in luce, luce, medio, ombra]. 0 = polvere della stanza, 1 = fumo, 2 = polvere scura (parete), 3 = fumo scuro, 4 = vapore. */
export const TAVOLOZZE = [
  [[226, 214, 196], [176, 160, 142], [128, 114, 104], [84, 74, 72]],
  [[236, 232, 226], [196, 190, 184], [150, 146, 146], [104, 100, 106]],
  [[186, 170, 150], [132, 118, 106], [94, 84, 80], [60, 54, 56]],
  [[118, 104, 98], [84, 74, 72], [60, 52, 52], [38, 32, 34]],      // (FXN) 3 = fumo scuro delle esplosioni e dei roghi
  [[255, 255, 255], [228, 238, 244], [188, 208, 220], [138, 164, 180]],   // (FXN) 4 = vapore
];

/** Tono (0..3) di un pixel di un globo di raggio r a (dx, dy) dal centro, illuminato dalla luce del mondo. */
export function tonoGlobo(dx, dy, r) {
  if (r <= 1) return dy < 0 ? 1 : 2;
  const d = Math.hypot(dx, dy), nx = dx / r, ny = dy / r, lam = nx * LX + ny * LY;
  if (ny > 0.6) return 3;                         // pancia sempre in ombra (poggia a terra)
  if (d > r - 1.25 && lam > 0.3) return 0;        // bordo in luce
  if (lam > 0.15) return 1;
  if (lam > -0.45) return 2;
  return 3;
}
/** Il pixel (x, y) della tela resta acceso al livello di retino lv? */
export const acceso = (x, y, lv) => BAYER[(y & 3) * 4 + (x & 3)] < COPRE[lv];

/** (Z) Sprite nuovi al più per fotogramma (oltre: la taglia vicina già in cache); i mancanti si preparano a riposo. */
export const SPRITE_PER_FOTOGRAMMA = 2;

export class Nuvole {
  /** tetto = globi vivi al più (proposta 224): oltre si ricicla il più vecchio (il più sciolto), niente picchi di disegno. */
  constructor(n = 512, nAnelli = 24, tetto = Math.min(n, 224)) {
    this.n = n; this.tetto = tetto; this.vivi = 0; this._nuovi = 0; this._prep = 0; this.budget = SPRITE_PER_FOTOGRAMMA;
    const F = (k) => new Float32Array(k);
    this.x = F(n); this.y = F(n); this.vx = F(n); this.vy = F(n); this.r0 = F(n); this.r1 = F(n);
    this.t = F(n); this.vita = F(n); this.rit = F(n); this.att = F(n); this.sale = F(n); this.vk = F(n); this.terra = F(n);
    this.pal = new Uint8Array(n); this.on = new Uint8Array(n);
    this.i = 0; this.attivi = 0;
    // anelli bassi (ellissi piatte che si allargano a terra)
    this.na = nAnelli; this.ax = F(nAnelli); this.ay = F(nAnelli); this.at = F(nAnelli); this.av = F(nAnelli);
    this.ar0 = F(nAnelli); this.ar1 = F(nAnelli); this.apal = new Uint8Array(nAnelli); this.aon = new Uint8Array(nAnelli); this.ai = 0;
    this.H = 48; this.vento = null;               // vento: oggetto con .in(xH) in H/s
    this.cache = new Map(); this.byte = 0; this.tavolozze = TAVOLOZZE.map((t) => t.map((c) => c.slice()));
  }
  get s() { return this.H / 48; }
  /** Cambia una tavolozza (es. colori della stanza): svuota gli sprite di quella tavolozza. */
  tavolozza(id, toni) {
    this.tavolozze[id] = toni.map((c) => c.slice());
    for (const [k, c] of this.cache) if (((k >> 12) & 15) === id) { this.byte -= c.width * c.height * 4; this.cache.delete(k); }
  }
  /**
   * Un globo. (x, y) = punto a terra (o centro, se terra = 0); r0 → r1 raggio in px; vita s; rit = ritardo prima di comparire;
   * att = frenata (1/s); sale = spinta in su (px/s²); vk = quanto lo porta il vento (0..1); terra = 1 se poggia sul terreno.
   */
  globo(x, y, vx, vy, r0, r1, vita, rit = 0, att = 3, sale = 0, vk = 0.6, pal = 0, terra = 1) {
    const n = this.n;
    let k = -1;
    if (this.vivi >= this.tetto) k = this.piuVecchio();      // (Z) tetto: si ricicla il globo più avanti nella sua vita
    else for (let j = 0; j < n; j++) { const q = (this.i + j) % n; if (!this.on[q]) { k = q; break; } }
    if (k < 0) k = this.i;                      // pool pieno: si ricicla
    this.i = (k + 1) % n;
    if (!this.on[k]) this.vivi++;
    this.on[k] = 1; this.x[k] = x; this.y[k] = y; this.vx[k] = vx; this.vy[k] = vy;
    this.r0[k] = Math.max(0.5, r0); this.r1[k] = Math.min(RMAX, Math.max(r0, r1)); this.t[k] = 0; this.vita[k] = vita; this.rit[k] = rit;
    this.att[k] = att; this.sale[k] = sale; this.vk[k] = vk; this.pal[k] = pal; this.terra[k] = terra;
    return k;
  }
  /** (FXN) Spinta radiale sui globi vivi entro raggio da (x, y) (esplosioni, schianti): px/s, cala col raggio. */
  spingi(x, y, raggio, forza = 1) {
    const v0 = 2.2 * this.H * forza, r2 = raggio * raggio;
    for (let k = 0; k < this.n; k++) {
      if (!this.on[k]) continue;
      const dx = this.x[k] - x, dy = this.y[k] - y, d2 = dx * dx + dy * dy;
      if (d2 >= r2 || d2 < 1) continue;
      const d = Math.sqrt(d2), f = v0 * (1 - d / raggio) / d;
      this.vx[k] += dx * f; this.vy[k] += dy * f * 0.5;
    }
  }
  /** (Z) Il globo vivo più avanti nella sua vita (il più sciolto), -1 se nessuno. */
  piuVecchio() {
    let k = -1, best = -Infinity;
    for (let q = 0; q < this.n; q++) {
      if (!this.on[q]) continue;
      const u = (this.t[q] - this.rit[q]) / this.vita[q];
      if (u > best) { best = u; k = q; }
    }
    return k;
  }
  anello(x, y, rx0, rx1, vita, pal = 0) {
    const k = this.ai; this.ai = (k + 1) % this.na;
    this.aon[k] = 1; this.ax[k] = x; this.ay[k] = y; this.at[k] = 0; this.av[k] = vita; this.ar0[k] = rx0; this.ar1[k] = rx1; this.apal[k] = pal;
  }
  /** Raggio attuale (px) del globo k: si gonfia in fretta e poi continua piano. */
  raggio(k) { const u = Math.min(1, Math.max(0, (this.t[k] - this.rit[k]) / this.vita[k])); return this.r0[k] + (this.r1[k] - this.r0[k]) * (1 - (1 - u) ** 2.4); }
  /** Livello di retino del globo k (0 pieno … 4). */
  livello(k) {
    const u = (this.t[k] - this.rit[k]) / this.vita[k];
    return u < 0.42 ? 0 : Math.min(LIVELLI - 1, 1 + Math.floor((u - 0.42) / 0.58 * (LIVELLI - 1)));
  }
  aggiorna(dt) {
    const H = this.H, V = this.vento;
    let n = 0;
    for (let k = 0; k < this.n; k++) {
      if (!this.on[k]) continue;
      const t = (this.t[k] += dt);
      if (t < this.rit[k]) { n++; continue; }
      const u = (t - this.rit[k]) / this.vita[k];
      if (u >= 1) { this.on[k] = 0; this.vivi--; continue; }
      n++;
      const f = Math.exp(-this.att[k] * dt);
      this.vx[k] *= f; this.vy[k] = this.vy[k] * f - this.sale[k] * dt;
      // il vento entra piano (uno sbuffo appena nato resta ai piedi) e piega di più i globi alti e grandi
      const w = V ? V.in(this.x[k] / H) * H * this.vk[k] * Math.min(1, u * 2.2) : 0;
      this.x[k] += (this.vx[k] + w) * dt; this.y[k] += this.vy[k] * dt;
    }
    for (let k = 0; k < this.na; k++) if (this.aon[k] && (this.at[k] += dt) >= this.av[k]) this.aon[k] = 0;
    this.attivi = n; this.vivi = n;
  }
  // ---- disegno (browser)
  _tela(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; this.byte += w * h * 4; return c; }
  /** Sprite del globo di raggio r, tavolozza p, livello di retino lv (cache). */
  sprite(r, p, lv, prepara = false) {
    const key = (p << 12) | (r << 4) | lv;
    let c = this.cache.get(key);
    if (c) return c;
    // (Z) oltre il budget del fotogramma: la taglia vicina già pronta (r ± 1, ± 2), altrimenti il globo salta un fotogramma
    if (!prepara && this._nuovi >= this.budget) {
      for (const d of [1, -1, 2, -2]) { const v = this.cache.get((p << 12) | ((r + d) << 4) | lv); if (v && r + d >= 1) return v; }
      return null;
    }
    this._nuovi++;
    const d = 2 * r + 1; c = this._tela(d, d);
    const x = c.getContext('2d'), T = this.tavolozze[p], img = x.createImageData(d, d), o = img.data;
    for (let j = 0; j < d; j++) for (let i = 0; i < d; i++) {
      const dx = i - r, dy = j - r;
      if (dx * dx + dy * dy > r * r + r * 0.6) continue;
      if (!acceso(i, j, lv)) continue;
      const col = T[tonoGlobo(dx, dy, r)], q = (j * d + i) * 4;
      o[q] = col[0]; o[q + 1] = col[1]; o[q + 2] = col[2]; o[q + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    this.cache.set(key, c);
    return c;
  }
  /** Sprite di un anello basso: ellisse piatta (rx, rx·0,22), bordo alto in luce, basso medio. */
  spriteAnello(rx, p, lv, prepara = false) {
    const key = (1 << 20) | (p << 12) | (rx << 3) | lv;
    let c = this.cache.get(key);
    if (c) return c;
    if (!prepara && this._nuovi >= this.budget) {
      for (const d of [4, -4, 8, -8, 1, -1]) { const v = this.cache.get((1 << 20) | (p << 12) | ((rx + d) << 3) | lv); if (v && rx + d >= 2) return v; }
      return null;
    }
    this._nuovi++;
    const ry = Math.max(1, Math.round(rx * 0.22)), w = 2 * rx + 1, h = 2 * ry + 1;
    c = this._tela(w, h);
    const x = c.getContext('2d'), T = this.tavolozze[p], img = x.createImageData(w, h), o = img.data;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const ex = (i - rx) / rx, ey = (j - ry) / ry, e = ex * ex + ey * ey, spess = 2.4 / Math.max(ry, 1);
      if (e > 1.05 || e < 1 - spess) continue;
      if (!acceso(i, j, lv)) continue;
      const col = T[j < ry ? 0 : Math.abs(ex) > 0.8 ? 1 : 2], q = (j * w + i) * 4;
      o[q] = col[0]; o[q + 1] = col[1]; o[q + 2] = col[2]; o[q + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    this.cache.set(key, c);
    return c;
  }
  /**
   * (Z) Prepara a riposo i prossimi sprite mancanti (globi della tavolozza 0 e 1, anelli della 0) entro msMax per
   * fotogramma, solo se il fotogramma non ne ha già creati. true finché ne restano.
   */
  preparaRiposo(msMax = 1) {
    if (this._prep < 0 || this._nuovi) return false;
    const G = RMAX * 2 * LIVELLI, A = 41 * LIVELLI, t0 = performance.now();   // globi: r 1..RMAX × 2 tavolozze; anelli: rx 2..16 e 20..120
    while (this._prep < G + A && performance.now() - t0 < msMax) {
      const i = this._prep++;
      if (i < G) { const lv = i % LIVELLI, r = 1 + ((i / LIVELLI | 0) % RMAX), p = (i / (LIVELLI * RMAX)) | 0; this.sprite(r, p, lv, true); }
      else { const j = i - G, lv = j % LIVELLI, q = (j / LIVELLI) | 0, rx = q < 15 ? q + 2 : 20 + (q - 15) * 4; this.spriteAnello(rx, 0, lv, true); }
    }
    if (this._prep >= G + A) this._prep = -1;
    return this._prep >= 0;
  }
  disegna(cx, camX, camY = 0) {
    this._nuovi = 0;
    const W = cx.canvas?.width ?? 1e9;     // (Z) fuori vista in orizzontale (con margine): non si disegna
    for (let k = 0; k < this.na; k++) {
      if (!this.aon[k]) continue;
      const u = this.at[k] / this.av[k], r0 = Math.max(2, Math.min(120, this.ar0[k] + (this.ar1[k] - this.ar0[k]) * (1 - (1 - u) ** 2)));
      const rx = r0 > 16 ? Math.round(r0 / 4) * 4 : Math.round(r0);        // (V2) raggi a passi di 4: meno sprite nuovi a metà raffica (picchi)
      const X = Math.round(this.ax[k] - camX);
      if (X + rx < -48 || X - rx > W + 48) continue;
      const lv = Math.min(LIVELLI - 1, Math.floor(u * LIVELLI)), c = this.spriteAnello(rx, this.apal[k], lv);
      if (c) cx.drawImage(c, X - (c.width >> 1), Math.round(this.ay[k] - camY) - (c.height >> 1) - 1);
    }
    for (let k = 0; k < this.n; k++) {
      if (!this.on[k] || this.t[k] < this.rit[k]) continue;
      const r = Math.max(1, Math.round(this.raggio(k))), X = Math.round(this.x[k] - camX);
      // i globi a terra poggiano: il centro sta sopra il punto d'appoggio di 0,6 r (la pancia tocca il suolo)
      const Y = Math.round((this.terra[k] ? this.y[k] - r * 0.6 : this.y[k]) - camY);
      if (X + r < -48 || X - r > W + 48) continue;
      const c = this.sprite(r, this.pal[k], this.livello(k));
      if (c) cx.drawImage(c, X - (c.width >> 1), Y - (c.height >> 1));
    }
    this.preparaRiposo();
  }
}

// ------------------------------------------------------------ emettitori (varianti della specifica)
const R = Math.random;
/**
 * (E2) Grappolo: un globo guida più grande e 2–4 globi più piccoli attorno, a grappolo irregolare (dietro, sopra, davanti),
 * con la stessa spinta ± poco: si legge come una nuvola sola, non come palle separate. Restituisce i globi emessi.
 */
export function grappolo(nv, x, y, vx, vy, rGuida, vita, pal = 0, n = 3 + ((R() * 3) | 0), sale = 8, vk = 0.55, terra = 1) {
  const s = nv.s, d = Math.sign(vx) || 1;
  nv.globo(x, y, vx, vy, Math.max(0.8 * s, rGuida * 0.3), rGuida, vita, R() * 0.02, 3.2, sale * s, vk, pal, terra);
  for (let j = 1; j < n; j++) {
    const f = 0.42 + R() * 0.38, r = rGuida * f;
    // posto attorno alla guida: dietro e in basso (j dispari), sopra-dietro, davanti e basso; mai sovrapposti esatti
    const ox = (j % 2 ? -d : d * 0.6) * rGuida * (0.55 + R() * 0.5), oy = (j === 2 ? -rGuida * (0.5 + R() * 0.35) : -R() * rGuida * 0.25);
    nv.globo(x + ox, y + (terra ? 0 : oy), vx * (0.75 + R() * 0.4), vy + (terra ? oy * 2 : 0), Math.max(0.6 * s, r * 0.3), r,
      vita * (0.75 + R() * 0.3), 0.01 + R() * 0.04, 3.2, (sale + (j === 2 ? 8 : 0)) * s, vk * (0.8 + R() * 0.5), pal, terra);
  }
  return n;
}
/** Sbuffo a terra: n globi verso dir (0 = tutte e due le direzioni), raccolti in grappoli. forza 0..1 regola velocità, taglia e durata. */
export function sbuffo(nv, x, y, dir, n, forza = 0.5, pal = 0) {
  // stesso numero di globi di prima (bilancio): divisi in grappoli da 2–5 (una guida e i suoi vicini), uno o più per lato
  const s = nv.s, lati = dir ? 1 : 2, tot = Math.max(n, 2 * lati), gruppi = Math.max(lati, Math.ceil(tot / 5));
  let fatti = 0;
  for (let i = 0; i < gruppi; i++) {
    const lato = dir || (i % 2 ? 1 : -1), v = (20 + R() * 40 + forza * 70) * s;
    const r1 = (3 + R() * 2.5 + forza * 4.5) * s, k = Math.max(2, Math.round((tot - fatti) / (gruppi - i)));
    fatti += grappolo(nv, x + lato * R() * 3 * s, y, lato * v, 0, r1, 0.4 + R() * 0.3 + forza * 0.35, pal, Math.min(5, k), 6 + R() * 10, 0.35 + R() * 0.4);
  }
}
/** (E2) Onda d'urto dello schianto: polvere che rotola fuori fino al raggio, più grande e più lunga con la caduta (caduta_H). */
export function urto(nv, x, y, raggio, caduta = 1) {
  const s = nv.s, f = Math.min(1, caduta / 2.4), passi = 2 + Math.round(f * 2);
  sbuffo(nv, x, y, 0, 5 + Math.round(f * 5), 0.7 + f * 0.3);
  for (const lato of [-1, 1]) for (let j = 1; j <= passi; j++) {
    const u = j / passi, r = (3.5 + 4 * f + u * 3) * s;
    grappolo(nv, x + lato * u * raggio * 0.25, y, lato * raggio * (1.6 + u * 1.2), 0, r, 0.45 + f * 0.25 + u * 0.1, 0, j === passi ? 3 : 2, 8, 0.6);
  }
  nv.globo(x, y, 0, -(25 + f * 25) * s, 3 * s, (7 + f * 5) * s, 0.6, 0, 2.5, (16 + f * 10) * s, 0.4, 0);
  nv.anello(x, y, 4 * s, raggio * 0.9, 0.4); nv.anello(x, y, 2 * s, raggio * 0.55, 0.28);
}
/** (E2) Esplosione radiale: colonna di polvere al centro che sale e si allarga, più polvere bassa che corre ai lati. */
export function colonna(nv, x, y, forza = 1) {
  const s = nv.s;
  // colonna stretta che sale in fretta (non resta davanti al corpo), allargandosi solo in alto
  for (let j = 0; j < 5; j++) nv.globo(x + (R() - 0.5) * 4 * s, y - j * 5 * s, (R() - 0.5) * 8 * s, -(70 + j * 26) * forza * s, (1 + j * 0.4) * s, (2.5 + j * 0.9) * forza * s,
    0.5 + j * 0.06, j * 0.02, 2.4, (20 + j * 6) * s, 0.35, 0, 0);
  sbuffo(nv, x, y, 0, 8, 1);
}
/** (E2) Capriola: polvere bassa a rotoli dove passa il corpo (globi schiacciati che rotolano piano in avanti). */
export function rotolo(nv, x, y, dir) {
  const s = nv.s;
  grappolo(nv, x - dir * 2 * s, y, dir * (6 + R() * 10) * s, 0, (2.4 + R() * 1.4) * s, 0.32 + R() * 0.12, 0, 3, 3, 0.45);
}
/** (E2) Raffica in giù: sbuffo di fumo/aria che resta in colonna sotto la bocca (frena presto, poco vento). */
export function fumoColonna(nv, x, y) {
  const s = nv.s;
  for (let i = 0; i < 3; i++) nv.globo(x + (R() - 0.5) * 4 * s, y + i * 3 * s, (R() - 0.5) * 6 * s, (30 + i * 25) * s, 1 * s, (2.5 + i * 0.8 + R()) * s,
    0.55 + R() * 0.25, i * 0.015, 7, -6 * s, 0.25, 1, 0);
}
/** Atterraggio: f 0..1 dalla velocità d'impatto. Sopra 0,55 è pesante: più globi grandi e anello basso. */
export function atterraggio(nv, x, y, f) {
  const s = nv.s, n = 4 + Math.round(f * 6);
  sbuffo(nv, x, y, 0, n, 0.25 + f * 0.75);
  nv.globo(x, y, 0, 0, 1.5 * s, (3 + f * 4) * s, 0.4 + f * 0.25, 0, 3, 10 * s, 0.5, 0);   // nuvoletta al centro
  if (f > 0.55) nv.anello(x, y, 4 * s, (18 + f * 14) * s, 0.32 + f * 0.1);
}
/** Impatto dello schianto: enorme, con onda di polvere che rotola fuori e due anelli. (Detriti: li aggiunge chi chiama.) */
export function schianto(nv, x, y) {
  const s = nv.s;
  sbuffo(nv, x, y, 0, 10, 1);
  for (const lato of [-1, 1]) for (let j = 1; j <= 7; j++) {
    nv.globo(x + lato * j * 6 * s, y, lato * (30 + j * 6) * s, 0, 1.5 * s, (4 + j * 0.8 + R() * 2) * s, 0.45 + j * 0.04, j * 0.03, 2.5, 8 * s, 0.6, 0);
  }
  nv.globo(x, y, 0, -30 * s, 3 * s, 10 * s, 0.6, 0, 2.5, 18 * s, 0.4, 0);
  nv.anello(x, y, 6 * s, 46 * s, 0.42); nv.anello(x, y, 3 * s, 30 * s, 0.3);
}
/** Partenza, frenata, inversione: sbuffo ai talloni (verso = dove va la polvere). */
export function talloni(nv, x, y, verso, n = 3, forza = 0.35) { sbuffo(nv, x, y, verso, n, forza); }
/** Scia bassa dello scatto o della scivolata: un globo piccolo e schiacciato dove passa il piede. */
export function scia(nv, x, y, dir, forza = 0.5) {
  const s = nv.s;
  nv.globo(x - dir * 2 * s, y, -dir * (8 + R() * 16) * s, 0, 0.8 * s, (2 + R() * 1.6 + forza * 1.6) * s, 0.28 + R() * 0.14, 0, 4, 4 * s, 0.5, 0);
}
/** Passo di corsa (piccolo), di cammino accovacciato (minimo). */
export function passo(nv, x, y, dir, piccolo = false) {
  const s = nv.s, n = piccolo ? 1 : 2;
  for (let i = 0; i < n; i++) nv.globo(x - dir * (1 + i * 2) * s, y, -dir * (10 + R() * 18) * s, 0, 0.6 * s, (piccolo ? 1.4 : 2 + R() * 1.4) * s, 0.26 + R() * 0.1, i * 0.02, 4, 5 * s, 0.4, 0);
}
/** Parete: polvere che si stacca e cade lungo il muro (lato = verso del muro). */
export function parete(nv, x, y, lato) {
  const s = nv.s;
  nv.globo(x + lato * R() * 1.5 * s, y, -lato * (4 + R() * 8) * s, (10 + R() * 20) * s, 0.6 * s, (1.6 + R() * 1.6) * s, 0.32, 0, 2, -30 * s, 0.25, 2, 0);
}
/** Rimbalzo del pogo (o sparo in giù): ventaglio di globi verso l'alto attorno al punto d'appoggio. */
export function rimbalzo(nv, x, y, pal = 0) {
  const s = nv.s;
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i / 5 - 0.5) * 2.4, v = (40 + R() * 30) * s;
    nv.globo(x, y, Math.cos(a) * v, Math.sin(a) * v * 0.6, 0.8 * s, (2 + R() * 2) * s, 0.32, 0, 5, 0, 0.5, pal, 0);
  }
}
/** Colpo della lama o del proiettile sul terreno: pochi globi bassi verso fuori. */
export function colpoTerra(nv, x, y, dir) { sbuffo(nv, x, y, dir, 3, 0.4, 0); sbuffo(nv, x, y, -dir, 1, 0.2, 0); }
/** Fumo della pistola: globi chiari che si gonfiano e salgono col vento. ux, uy = direzione della canna. */
export function fumoSparo(nv, x, y, ux, uy, n = 4) {
  const s = nv.s;
  for (let i = 0; i < n; i++) {
    const v = (10 + i * 12 + R() * 10) * s;
    nv.globo(x + ux * i * 2 * s, y + uy * i * 2 * s, ux * v + (R() - 0.5) * 8 * s, uy * v - 6 * s, 0.8 * s, (2 + i * 0.7 + R() * 1.5) * s,
      0.5 + R() * 0.35, i * 0.02, 3.5, 14 * s, 0.9, 1, 0);
  }
}
