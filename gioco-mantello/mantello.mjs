// Copia di strumenti/pennino/prova/mantello.mjs (sito/strumenti/copia_sprite.py): non modificare qui.
// Mantello: telo generico appeso a N punti nominati (mantelli, stendardi, code, per A, nemici e boss).
// Simulazione: maglia di colonne × righe, Verlet a passo fisso 1/120 s, vincoli di lunghezza (colonne rigide, righe che
// si possono piegare ma non schiacciare), piega fra righe alterne, attrito dell'aria anisotropo (la stoffa prende l'aria
// di piatto: si gonfia e fa vela), onde che corrono dal collo all'orlo, collisione con capsule del corpo e sfere dei doni,
// suolo con attrito, limite di lunghezza finale. Nessuna allocazione nel ciclo (Float32Array preallocati).
// Disegno: Pittore riempie una tela piccola a pixel netti (triangoli → etichette di tono → colori), contorno di 1 px,
// orlo strappato a denti, pieghe come bande che seguono le colonne, rovescio (fodera) più scuro, luce toon e lampi,
// e un secondo strato «davanti» con il solo lembo che copre le parti permesse dall'atlas delle parti.
// Niente DOM: si prova in Node.

export const PASSO = 1 / 120;

/** Valori di riserva se stoffa.json non si legge (stessi del file). */
export const MANTELLO_BASE = Object.freeze({
  agganci: [{ punto: 'nuca', dietro_H: 0.03, giu_H: 0.05 }, { punto: 'spalla_f', dietro_H: 0.05, giu_H: 0.01 }, { punto: 'spalla_n', dietro_H: 0.0, giu_H: 0.01 }],
  capsule: [['collo', 'vita', 0.105, 'dietro'], ['vita', 'anca', 0.115, 'dietro'], ['anca_n', 'ginocchio_n', 0.06], ['anca_f', 'ginocchio_f', 0.06]],
  colonne: 5, righe: 8, aderenza: 0.8, lunghezza_H: 0.58, accorcia_davanti_H: 0.04, forma: 0.35, larghezza_H: 0.16, allarga: 1.5, rigidita: 0.5, peso: 1, aria: 1,
  gravita_H: 17, smorzamento: 0.993, sventolio: 1, strappi: { denti: 2, profondita: 0.55, seme: 7 }, lembi: 1, taglio: 0.4,
  copertura: { quanto: 0.3, corpo: ['busto', 'mantellina', 'orlo_giacca', 'bacino', 'coscia_n', 'coscia_f', 'stinco_n', 'stinco_f', 'stivale_n', 'stivale_f', 'braccio_f', 'avambraccio_f', 'mano_f', 'fodero', 'fondina'], copre: ['braccio_n', 'avambraccio_n', 'mano_n', 'pistola'], mai_coprire: ['cappuccio_testa', 'visore', 'spada'] },
  colore: 'cremisi',
  colori: { cremisi: { luce: '#d8423e', base: '#a0202e', ombra: '#62122a', rovescio: '#40101f', rovescio_ombra: '#2a0a17', contorno: '#0b0a0d' } },
  livello: 1, livelli: [], moduli: { agganci: {}, finto: null },
});

/** Valori del livello: base sovrascritta dalla voce `livelli[n]` (strappi, ricamo, fodera uniti per campo). */
export function risolviLivello(base, livello) {
  const L = (base.livelli || [])[livello] || {};
  const o = { ...base, ...L };
  for (const k of ['strappi', 'copertura']) o[k] = { ...(base[k] || {}), ...(L[k] || {}) };
  o.livello = livello; o.nome_livello = L.nome || String(livello);
  return o;
}

/** Maschera di bit delle parti (nomi o indici) con la tabella parti_indici {indice: nome} della clip. */
export function maschera(indici, nomi) {
  let m = 0;
  for (const n of nomi || []) {
    if (Number.isInteger(n)) { if (n > 0 && n < 32) m |= 1 << n; continue; }
    for (const k in indici || {}) if (indici[k] === n && +k < 32) m |= 1 << +k;
  }
  return m >>> 0;
}

/** '#rrggbb' → [r, g, b] (una volta, fuori dal ciclo). */
export function rgb(c) {
  if (Array.isArray(c)) return c;
  const s = String(c || '#000').replace('#', ''), v = parseInt(s.length === 3 ? s.split('').map((x) => x + x).join('') : s, 16) || 0;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const imp = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;          // RGBA little-endian
function hash(i) { let x = (i * 374761393) ^ 0x5bd1e995; x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; }

export class Telo {
  constructor(maxC = 8, maxR = 12, maxCap = 8, maxCer = 4, maxK = 8) {
    const n = maxC * maxR;
    this.maxC = maxC; this.maxR = maxR; this.C = 0; this.R = 0; this.H = 48;
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.px = new Float32Array(n); this.py = new Float32Array(n);
    this.dvx = new Float32Array(n); this.dvy = new Float32Array(n); this.coda = 0; this.bx = 0; this.by = 0; this.bxP = 0; this.byP = 0; this.amxP = 0; this.amyP = 0; this.vRel = 3.6; this.aRel = 2.4;   // tetti (px/f, px/f² a 60 Hz) con margine sotto 4 e 3
    this.ax = new Float32Array(maxC); this.ay = new Float32Array(maxC); this.axP = new Float32Array(maxC); this.ayP = new Float32Array(maxC);       // riga d'aggancio
    this.kx = new Float32Array(maxK); this.ky = new Float32Array(maxK); this.nk = 0;   // spezzata dei punti nominati
    this.sv = new Float32Array(maxC); this.sh = new Float32Array(maxR);        // riposo: segmento di colonna, larghezza di riga
    this.cap = new Float32Array(maxCap * 6); this.nCap = 0; this.maxCap = maxCap;   // ax, ay, bx, by, raggio, solo dietro (1: il telo resta sul dorso)
    this.cer = new Float32Array(maxCer * 4); this.nCer = 0; this.maxCer = maxCer;   // x, y, r, buco (1) | solo riserva (0)
    this.taglio = 0; this.rT = 99; this.pronta = false; this.t = 0; this.fase = 1.3;
    this.ondaT = 9; this.ondaA = 0; this.ivx = 0; this.ivy = 0;
    this.giuX = 0; this.giuY = 1; this.rigide = 2; this.giroT = 0; this.dietroPrima = 0;   // dorso (collo → bacino) per le righe cucite
    // coreografia: forma bersaglio (angoli lungo il telo), forza 0..1, sistema di riferimento; punti bersaglio calcolati a ogni passo
    this.bers = { k: 0, a0: 0, a1: 0, a2: 0, apertura: 0, modo: 0, bx: 0, by: 0, davanti: false, guida: 0 };
    this.tx = new Float32Array(n); this.ty = new Float32Array(n); this.lato = 1;
    this.denti = 2; this.prof = 0.5; this.seme = 7;
    this.pavimento = { on: false, x0: 0, passo: 1, n: 0, y: new Float32Array(33) };   // (ORCH) profilo del suolo sotto il telo (pendenze): quota per colonna, non una sola
    this.aderenza = 0.8; this.fw = 0; this.kf = 0; this.g = 0; this.kt = 0; this.kn = 0; this.sm = 0.993; this.fl = 1; this.rig = 0.5;
    this.gvx = 0; this.gvy = 1;   // (GAL-1) gravità apparente nel sistema del corpo, in unità di g (fuori dalla galleria (0, 1))
  }
  /** par: colonne, righe, lunghezza_H, accorcia_davanti_H, larghezza_H, allarga, rigidita, peso, aria, gravita_H, smorzamento, sventolio, lembi, taglio, strappi. */
  configura(par, H) {
    const C = Math.max(2, Math.min(this.maxC, par.colonne | 0 || 5)), R = Math.max(3, Math.min(this.maxR, par.righe | 0 || 8));
    if (C !== this.C || R !== this.R) this.pronta = false;
    this.C = C; this.R = R; this.H = H;
    const L = par.lunghezza_H * H, acc = (par.accorcia_davanti_H || 0) * H, W = par.larghezza_H * H, al = par.allarga ?? 1.5;
    for (let c = 0; c < C; c++) this.sv[c] = Math.max(1, (L - acc * c / (C - 1)) / (R - 1));
    for (let r = 0; r < R; r++) this.sh[r] = W / (C - 1) * (1 + (al - 1) * r / (R - 1));
    const peso = Math.max(0.2, par.peso ?? 1), aria = (par.aria ?? 1) / Math.sqrt(peso);
    this.rig = Math.max(0, Math.min(1, par.rigidita ?? 0.5));
    this.g = (par.gravita_H ?? 17) * H * (0.75 + 0.25 * peso);
    this.kt = 1.0 * aria; this.kn = 4.6 * aria;
    this.sm = Math.min(0.999, par.smorzamento ?? 0.986) - 0.004 * (1 - this.rig); this.rigide = par.righe_rigide ?? 1;
    this.fl = par.sventolio ?? 1; this.aderenza = Math.max(0, Math.min(0.95, par.aderenza ?? 0.8));
    this.fw = (par.forma ?? 1) * W * 0.75; this.kf = 220 + 260 * this.rig;
    const n = Math.max(1, par.lembi | 0 || 1);
    this.taglio = 0;
    for (let k = 1; k < n; k++) this.taglio |= 1 << Math.min(C - 2, Math.max(0, Math.floor(k * (C - 1) / n)));
    this.rT = n > 1 ? Math.round((R - 1) * (1 - (par.taglio ?? 0.4))) : 99;
    const st = par.strappi || {};
    this.denti = Math.max(0, Math.min(4, st.denti ?? 2)); this.prof = st.profondita ?? 0.5; this.seme = st.seme ?? 7;
  }
  /** Distribuisce le C ancore lungo la spezzata kx/ky per lunghezza d'arco. */
  distribuisci() {
    const C = this.C, nk = this.nk, kx = this.kx, ky = this.ky;
    if (nk < 2) { for (let c = 0; c < C; c++) { this.ax[c] = kx[0]; this.ay[c] = ky[0]; } return; }
    let tot = 0; for (let k = 1; k < nk; k++) tot += Math.hypot(kx[k] - kx[k - 1], ky[k] - ky[k - 1]);
    let k = 1, fatto = 0, l = Math.hypot(kx[1] - kx[0], ky[1] - ky[0]);
    for (let c = 0; c < C; c++) {
      const s = tot * c / (C - 1);
      while (k < nk - 1 && fatto + l < s) { fatto += l; k++; l = Math.hypot(kx[k] - kx[k - 1], ky[k] - ky[k - 1]); }
      const u = l > 1e-6 ? Math.max(0, Math.min(1, (s - fatto) / l)) : 1;
      this.ax[c] = kx[k - 1] + (kx[k] - kx[k - 1]) * u; this.ay[c] = ky[k - 1] + (ky[k] - ky[k - 1]) * u;
    }
  }
  /** Telo appeso fermo, un poco staccato verso `dietro` (-1 | 1). */
  posa(dietro) {
    const C = this.C, R = this.R;
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const i = r * C + c, s = this.sv[c] * r;
      this.x[i] = this.px[i] = this.ax[c] + dietro * s * 0.2; this.y[i] = this.py[i] = this.ay[c] + s * 0.97;
    }
    this.pronta = true; this.nodoT = 0; this.appesoT = 0; this.ricuciT = 0;
    // (ORCH) 17/11: in posa il corpo è fermo. Senza questo, un salto del corpo (nuova stanza, rinascita, teletrasporto) nello
    // stesso passo di un cambio di verso passava come velocità dell'aggancio: il telo appena posato veniva lanciato di 3 H.
    this.bxP = this.bx; this.byP = this.by;
  }
  /** Velocità aggiunta (px/s) che cresce verso l'orlo: frustate, scatti, onde d'aria. */
  spingi(vx, vy) {
    // filtro passa-basso: la spinta non arriva in un passo, si sviluppa in ~4 fotogrammi (niente strattoni)
    const m = 12 * this.H, k = Math.min(1, m / (Math.hypot(vx, vy) || 1));
    this.ivx += vx * k; this.ivy += vy * k;
  }
  /** Onda che scende dal collo all'orlo (atterraggio): ampiezza 0..2. */
  onda(a) { this.ondaT = 0; this.ondaA = Math.min(2, a); }
  sano() { for (let i = 0, n = this.C * this.R; i < n; i++) if (!Number.isFinite(this.x[i]) || !Number.isFinite(this.y[i])) return false; return true; }

  /** Un passo fisso. vento px/s (x); suolo quota del pavimento (1e9 = nessuno); dietro = verso del dorso (-1 | 1). */
  passo(vento, suolo, dietro) {
    const C = this.C, R = this.R, x = this.x, y = this.y, px = this.px, py = this.py, dt = PASSO, H = this.H;
    this.t += dt;
    if (!this.pronta || !Number.isFinite(x[C]) || Math.abs(x[0] - this.ax[0]) + Math.abs(y[0] - this.ay[0]) > H) this.posa(dietro);
    const B = this.bers, kb = B.k > 0.01 ? B.k : 0, TX = this.tx, TY = this.ty, gd = kb ? Math.min(0.45, (B.guida || 0) * kb) : 0;
    if (kb) this._bersagli(dietro);
    if (dietro !== this.dietroPrima) {
      // cambio di verso: il telo NON si specchia e non salta: passa dietro il busto (capsule sospese, disegno dietro lo
      // sprite) con velocità e accelerazione col tetto. Un nuovo cambio durante la transizione la accorcia, non la riparte.
      if (this.dietroPrima && this.pronta) {
        this.giroT = this.giroT > 0 ? Math.max(this.giroT, 0.12) : 0.25;
        // l'aggancio che salta (specchio) non trascina il telo: si tiene solo la velocità che l'aggancio aveva (il corpo continua a muoversi)
        for (let c = 0; c < C; c++) { x[c] = this.ax[c] - (this.bx - this.bxP); y[c] = this.ay[c] - (this.by - this.byP); }
      }
      this.dietroPrima = dietro;
    }
    if (this.giroT > 0) { this.giroT -= dt; this.coda = 0.3; } else if (this.coda > 0) this.coda -= dt;
    this.bxP = this.bx; this.byP = this.by;
    this.lato = (B.davanti && kb > 0.2) || this.giroT > 0 ? 0 : 1;
    const sm = this.sm, g = this.g, kt = this.kt, kn = this.kn, fl = this.fl * (1 - 0.85 * kb), t = this.t, fw = this.fw * (1 - kb), kf = this.kf;
    if (this.ondaA > 0) { this.ondaT += dt; if (this.ondaT > 0.9) this.ondaA = 0; }
    const oA = this.ondaA * g * 1.1, oT = this.ondaT / 0.6;
    const iq = 0.11, iax = this.ivx * iq / dt, iay = this.ivy * iq / dt; this.ivx -= this.ivx * iq; this.ivy -= this.ivy * iq;
    const amax = 55 * H, vmax = 13 * H * dt;
    for (let c = 0; c < C; c++) { this.axP[c] = x[c]; this.ayP[c] = y[c]; x[c] = px[c] = this.ax[c]; y[c] = py[c] = this.ay[c]; }
    for (let r = 1; r < R; r++) {
      const f = r / (R - 1);
      for (let c = 0; c < C; c++) {
        const i = r * C + c, j = i - C;
        const vx = (x[i] - px[i]) * sm, vy = (y[i] - py[i]) * sm;
        let tx = x[i] - x[j], ty = y[i] - y[j]; const tl = Math.hypot(tx, ty) || 1e-6; tx /= tl; ty /= tl;
        const nx = -ty, ny = tx;
        const wrx = vento - vx / dt, wry = -vy / dt, wn = wrx * nx + wry * ny;
        let axx = g * this.gvx + kt * wrx + kn * wn * nx, ayy = g * this.gvy + kt * wry + kn * wn * ny;
        // onde che corrono dal collo all'orlo: crescono con l'aria relativa e verso l'orlo
        // un'onda sola, lunga e lenta (alla Dracula): frequenza bassa, lunghezza d'onda pari al telo
        const rel = Math.min(8 * H, Math.hypot(wrx, wry));
        const s = Math.sin(t * (4.2 + rel / H * 0.7) - r * 0.5 - c * 0.15 + this.fase) * rel * fl * (0.25 + f) * 0.7;
        axx += nx * s; ayy += ny * s;
        axx += dietro * g * 0.03 * (1 - f);                        // il telo resta staccato dal dorso
        // forma: le colonne di dietro stanno più indietro (il telo gira attorno al dorso e si apre verso l'orlo); solo spinta indietro
        const tg = this.ax[c] + dietro * (fw * (1 - c / (C - 1)) * (0.6 + 0.4 * f) + 0.02 * H), sc = (tg - x[i]) * dietro;
        if (sc > 0) axx += dietro * sc * kf;
        if (oA) { const u = oT - f, e = Math.exp(-u * u * 28) * oA; axx += nx * e; ayy += ny * e; }
        axx += iax * f; ayy += iay * f;
        if (kb) {                      // molla quasi critica verso la forma (curva morbida, niente rimbalzi); l'orlo arriva per ultimo
          const w = kb * 520 * (1 - 0.5 * f), cd = 1.7 * Math.sqrt(w);
          axx += w * (TX[i] - x[i]) - cd * vx / dt; ayy += w * (TY[i] - y[i]) - cd * vy / dt;
        }
        const am = Math.hypot(axx, ayy); if (am > amax) { axx *= amax / am; ayy *= amax / am; }   // tetto all'accelerazione
        px[i] = x[i]; py[i] = y[i];
        let nvx = vx + axx * dt * dt, nvy = vy + ayy * dt * dt; const vm = Math.hypot(nvx, nvy);
        if (vm > vmax) { nvx *= vmax / vm; nvy *= vmax / vm; }                                   // tetto alla velocità
        if (r <= this.rigide) {        // righe cucite: si muovono con le spalle (velocità dell'aggancio), la forma la fanno vincoli e capsule
          const q = 0.5, avx = this.ax[c] - this.axP[c], avy = this.ay[c] - this.ayP[c];
          nvx += (avx - nvx) * q; nvy += (avy - nvy) * q;
        }
        x[i] += nvx; y[i] += nvy;
        if (gd) {                      // guida cinematica (giri): il telo è portato sulla forma, l'orlo un poco in ritardo
          const q = gd * (1 - 0.45 * f), ex = (TX[i] - x[i]) * q, ey = (TY[i] - y[i]) * q;
          x[i] += ex; y[i] += ey; px[i] += ex * 0.6; py[i] += ey * 0.6;
        }
      }
    }
    const rig = this.rig, kp = 0.03 + rig * 0.2, tg = this.taglio, rT = this.rT, sv = this.sv, sh = this.sh;
    for (let it = 0; it < 4; it++) {
      for (let c = 0; c < C; c++) {                               // colonne: lunghezza
        const seg = sv[c];
        for (let r = 1; r < R; r++) {
          const i = r * C + c, j = i - C, dx = x[i] - x[j], dy = y[i] - y[j], d = Math.hypot(dx, dy) || 1e-6, k = (d - seg) / d;
          if (r === 1) { x[i] -= dx * k; y[i] -= dy * k; }
          else { x[i] -= dx * k * 0.5; y[i] -= dy * k * 0.5; x[j] += dx * k * 0.5; y[j] += dy * k * 0.5; }
        }
        for (let r = 2; r < R; r++) {                              // piega: le righe alterne non si avvicinano troppo
          const i = r * C + c, j = i - 2 * C, dx = x[i] - x[j], dy = y[i] - y[j], d = Math.hypot(dx, dy) || 1e-6, L = seg * 1.85;
          if (d < L) { const k = (d - L) / d * kp; x[i] -= dx * k; y[i] -= dy * k; if (r > 2) { x[j] += dx * k; y[j] += dy * k; } }
        }
      }
      for (let r = 1; r < R; r++) {                                // righe: tese fino al riposo, piegabili, mai schiacciate
        const rest = sh[r], min = rest * 0.5;
        for (let c = 0; c < C - 1; c++) {
          if (r >= rT && (tg >>> c) & 1) continue;                 // lembi separati verso l'orlo
          const i = r * C + c, j = i + 1, dx = x[j] - x[i], dy = y[j] - y[i], d = Math.hypot(dx, dy) || 1e-6;
          let k = 0;
          if (d > rest) k = (d - rest) / d * 0.5; else if (d < min) k = (d - min) / d * 0.5; else k = (d - rest) / d * 0.04 * rig;
          x[i] += dx * k; y[i] += dy * k; x[j] -= dx * k; y[j] -= dy * k;
        }
      }
      if (it & 1) this._urti(dietro);
    }
    // limite di lunghezza: dall'alto in giù, il figlio non si allontana oltre il 6%
    for (let c = 0; c < C; c++) for (let r = 1; r < R; r++) {
      const i = r * C + c, j = i - C, dx = x[i] - x[j], dy = y[i] - y[j], d = Math.hypot(dx, dy), L = sv[c] * 1.06;
      if (d > L) { x[i] = x[j] + dx / d * L; y[i] = y[j] + dy / d * L; }
    }
    // tetto finale, dopo vincoli, guida e capsule: velocità relativa all'aggancio ≤ 4 px/fotogramma e accelerazione ≤ 3 px/f²
    // (a 60 Hz; per passo da 1/120 s: 2 px e 0,75 px). Così niente scosse dell'orlo nei cambi rapidi di verso.
    let amx = 0, amy = 0; for (let c = 0; c < C; c++) { amx += this.ax[c] - this.axP[c]; amy += this.ay[c] - this.ayP[c]; } amx /= C; amy /= C; this.amxP = amx; this.amyP = amy;
    const giro = this.giroT > 0 || this.coda > 0, VM = (giro ? this.vRel : 9) * dt * 60, AM = (giro ? this.aRel : 7) * dt * dt * 3600, dvx = this.dvx, dvy = this.dvy;
    for (let i = C, n = C * R; i < n; i++) {
      let rx = x[i] - px[i] - amx, ry = y[i] - py[i] - amy;
      let ex = rx - dvx[i], ey = ry - dvy[i]; const e = Math.hypot(ex, ey);
      if (e > AM) { ex *= AM / e; ey *= AM / e; rx = dvx[i] + ex; ry = dvy[i] + ey; }
      const v = Math.hypot(rx, ry); if (v > VM) { rx *= VM / v; ry *= VM / v; }
      x[i] = px[i] + amx + rx; y[i] = py[i] + amy + ry; dvx[i] = rx; dvy[i] = ry;
    }
    this._urti(dietro);
    // (ORCH) Carlo: «il mantello appena nato e fermo non è nella posa classica». Dopo una caduta o una capriola l'orlo poteva
    // restare annodato sopra la metà del telo (piega stabile fra dorso e righe alte) e non scendere più. A corpo fermo, senza
    // vento forte né spinte, un orlo più alto della riga che lo precede, o un telo finito davanti al corpo, per mezzo secondo non è una posa: il telo si riposa da capo.
    {
      let orlo = 0, sopra = 0, lato = 0; const r0 = (R - 1) * C, r1 = (R - 2) * C;
      for (let c = 0; c < C; c++) { orlo += y[r0 + c]; sopra += y[r1 + c]; }
      for (let r = 2; r < R; r++) for (let c = 0; c < C; c++) lato += (x[r * C + c] - this.ax[c]) * dietro;   // < 0: il telo è passato davanti al corpo
      // (ORCH) 16/11: la soglia era −1,5 px: con un filo di vento verso il viso il telo fermo sta 4–5 px «avanti» (misurato nel
      // gioco: vento 40–56 px/s) e veniva rimesso in posa ogni mezzo secondo, per sempre: da lì il movimento non più fluido.
      // «Davanti» ora vuol dire davvero oltre il corpo: più di 0,22 H, e ancora di più se il vento spinge da quella parte.
      const davanti = lato / ((R - 2) * C) < -(0.22 * H + Math.max(0, -vento * dietro) * 0.08) && !(B.davanti && kb > 0.2);
      const fermo = Math.abs(amx) + Math.abs(amy) < 0.25 && kb <= 0.3 && Math.abs(this.ivx) + Math.abs(this.ivy) < 0.5 && Math.abs(vento) < 1.5 * H && this.giroT <= 0 && !(this.ondaA > 0);
      let cala = 0, lungo = 0; for (let c = 0; c < C; c++) { cala += y[r0 + c] - this.ay[c]; lungo += this.sv[c] * (R - 1); }   // quanto scende l'orlo sotto l'aggancio
      // (GAL-1) con la gravità apparente non verso i piedi (vento in su, al muro) l'orlo in alto è la posa giusta: niente riposo forzato
      const storto = R >= 5 && this.gvy > 0.5 && (orlo < sopra - C || davanti || cala < 0.7 * lungo);
      if (!storto) this.nodoT = 0; else if (fermo) this.nodoT = (this.nodoT || 0) + dt;   // il respiro muove appena gli agganci: il conto non riparte, si ferma soltanto
      // (ORCH) Carlo 16/11: «alcune volte rimane un po' dietro la testa, appeso». L'orlo sopra l'aggancio non è una posa nemmeno in
      // corsa (in corsa il telo sta al più in orizzontale): vale anche a corpo in movimento, purché non si stia salendo o cadendo.
      const appeso = R >= 5 && this.gvy > 0.5 && cala < -0.1 * lungo && Math.abs(amy) < 0.25 && this.giroT <= 0 && !(this.ondaA > 0);
      this.appesoT = appeso ? (this.appesoT || 0) + dt : 0;
      // «…ritorna alla posizione, però non ha un movimento fluido come prima»: niente più salto alla posa di riposo; il telo ci
      // scivola in un terzo di secondo (ricuciT), poi la simulazione riprende da lì.
      if ((this.nodoT > 0.5 || this.appesoT > 0.35) && !(this.ricuciT > 0)) { this.nodoT = 0; this.appesoT = 0; this.nodi = (this.nodi || 0) + 1; this.ricuciT = 0.33; }
      if (this.ricuciT > 0) {
        this.ricuciT -= dt; this.nodoT = 0; this.appesoT = 0;
        const k = 1 - Math.exp(-dt * 13);
        for (let r = 1; r < R; r++) for (let c = 0; c < C; c++) {
          const i = r * C + c, sl = this.sv[c] * r, tx = this.ax[c] + dietro * sl * 0.2, ty = this.ay[c] + sl * 0.97;
          const nx = x[i] + (tx - x[i]) * k, ny = y[i] + (ty - y[i]) * k;
          px[i] = nx - (x[i] - px[i]) * 0.5; py[i] = ny - (y[i] - py[i]) * 0.5; x[i] = nx; y[i] = ny;   // la velocità si smorza, non si azzera di colpo
        }
      }
    }
    const PV = this.pavimento;
    for (let i = C, n = C * R; i < n; i++) {
      let s0 = suolo;
      if (PV.on) { const u = Math.max(0, Math.min(PV.n - 1.001, (x[i] - PV.x0) / PV.passo)), j = u | 0, f = u - j; s0 = PV.y[j] + (PV.y[j + 1] - PV.y[j]) * f; }   // retta della pendenza sotto ogni punto
      if (y[i] > s0 - 1) { y[i] = s0 - 1; px[i] = x[i] - (x[i] - px[i]) * 0.55; py[i] = y[i]; }
    }
    if (!this.sano()) this.posa(dietro);
  }
  /** Il punto (x, y) è dentro una capsula o una sfera-buco? (k = indice da saltare) */
  _dentro(x, y, sc = 1) {
    const cap = this.cap, cer = this.cer;
    for (let k = 0; k < this.nCap; k++) {
      const o = k * 6, ax = cap[o], ay = cap[o + 1], bx = cap[o + 2] - ax, by = cap[o + 3] - ay, rr = cap[o + 4] * (cap[o + 5] ? sc : 1);
      const u = Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by) / (bx * bx + by * by || 1e-6)));
      const dx = x - ax - bx * u, dy = y - ay - by * u; if (dx * dx + dy * dy < rr * rr - 1e-4) return true;
    }
    for (let k = 0; k < this.nCer; k++) { const o = k * 4; if (cer[o + 3] && (x - cer[o]) ** 2 + (y - cer[o + 1]) ** 2 < cer[o + 2] ** 2 - 1e-4) return true; }
    return false;
  }
  /** Fuori dall'unione di capsule e sfere: dal più vicino asse verso l'esterno, poi avanti lungo la stessa direzione finché si è fuori. */
  _urti(dietro) {
    if (this.giroT > 0) return;     // nel cambio di verso il telo passa dietro il busto
    const C = this.C, n = C * this.R, x = this.x, y = this.y, cap = this.cap, cer = this.cer;
    for (let i = C; i < n; i++) {
      let ux = 0, uy = 0, sx = 0, sy = 0, dentro = false;
      // aderenza: le colonne vicine stanno sul fianco del corpo (dentro la sagoma), quella di dietro sul dorso
      const sc = 1 - this.aderenza * (i % C) / (C - 1);
      for (let k = 0; k < this.nCap && !dentro; k++) {
        const o = k * 6, ax = cap[o], ay = cap[o + 1], bx = cap[o + 2] - ax, by = cap[o + 3] - ay, rr = cap[o + 4] * (cap[o + 5] ? sc : 1);
        const L2 = bx * bx + by * by || 1e-6, u = Math.max(0, Math.min(1, ((x[i] - ax) * bx + (y[i] - ay) * by) / L2));
        const qx = ax + bx * u, qy = ay + by * u; let dx = x[i] - qx, dy = y[i] - qy; const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        let d = Math.sqrt(d2); if (d < 1e-3) { dx = dietro; dy = 0; d = 1; }
        ux = dx / d; uy = dy / d;
        if (cap[o + 5] && this.lato) {             // busto e bacino: il telo si appoggia sul dorso, mai sul petto
          const bl = Math.sqrt(L2); let nx = -by / bl, ny = bx / bl; if (nx * dietro < 0) { nx = -nx; ny = -ny; }
          const dd = ux * nx + uy * ny; if (dd < 0.2 && dd > -0.35) { ux = nx; uy = ny; }   // chiaramente davanti: esce davanti (niente salto attraverso)
        }
        sx = qx + ux * rr; sy = qy + uy * rr; dentro = true;
      }
      for (let k = 0; k < this.nCer && !dentro; k++) {
        const o = k * 4; if (!cer[o + 3]) continue;
        const rr = cer[o + 2]; let dx = x[i] - cer[o], dy = y[i] - cer[o + 1]; const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        let d = Math.sqrt(d2); if (d < 1e-3) { dx = dietro; dy = 0; d = 1; }
        ux = dx / d; uy = dy / d; sx = cer[o] + ux * rr; sy = cer[o + 1] + uy * rr; dentro = true;
      }
      if (!dentro) continue;
      for (let s = 0; s < 20 && this._dentro(sx, sy, sc); s++) { sx += ux * 0.75; sy += uy * 0.75; }
      x[i] = sx; y[i] = sy;
    }
  }
  /** Punti della forma bersaglio: si integra la direzione lungo ogni colonna a partire dall'ancora. */
  _bersagli(dietro) {
    const B = this.bers, C = this.C, R = this.R, tx = this.tx, ty = this.ty;
    let bx = dietro, by = 0;
    if (B.modo === 1) bx = -dietro;
    else if (B.modo === 2) { const m = Math.hypot(B.bx, B.by); if (m > 1e-6) { bx = B.bx / m; by = B.by / m; } }
    // giù del sistema: perpendicolare a «dietro» con la componente verso il basso (o verso il dorso se dietro è verticale)
    let dx = -by, dy = bx; if (dy < 0 || (Math.abs(dy) < 1e-3 && dx * dietro < 0)) { dx = -dx; dy = -dy; }
    if (B.modo !== 2) { dx = 0; dy = 1; }
    const D2R = Math.PI / 180;
    for (let c = 0; c < C; c++) {
      const off = B.apertura * (1 - 2 * c / (C - 1));
      tx[c] = this.ax[c]; ty[c] = this.ay[c];
      for (let r = 1; r < R; r++) {
        const u = r / (R - 1), a = ((u < 0.5 ? B.a0 + (B.a1 - B.a0) * u * 2 : B.a1 + (B.a2 - B.a1) * (u - 0.5) * 2) + off * u) * D2R;
        const ca = Math.cos(a), sa = Math.sin(a), i = r * C + c, s = this.sv[c];
        tx[i] = tx[i - C] + (dx * ca + bx * sa) * s; ty[i] = ty[i - C] + (dy * ca + by * sa) * s;
      }
    }
  }
  /** Distanza minima (con segno: negativa = dentro) dei punti liberi dalle capsule, per le prove. */
  dentroCapsule() {
    let m = 1e9; const C = this.C, n = C * this.R, cap = this.cap;
    for (let i = C; i < n; i++) for (let k = 0; k < this.nCap; k++) {
      const o = k * 6, ax = cap[o], ay = cap[o + 1], bx = cap[o + 2] - ax, by = cap[o + 3] - ay;
      const u = Math.max(0, Math.min(1, ((this.x[i] - ax) * bx + (this.y[i] - ay) * by) / (bx * bx + by * by || 1e-6)));
      m = Math.min(m, Math.hypot(this.x[i] - ax - bx * u, this.y[i] - ay - by * u) - cap[o + 4] * (cap[o + 5] ? 1 - this.aderenza * (i % C) / (C - 1) : 1));
    }
    return m;
  }
  lunghezzaColonna(c) { let s = 0; for (let r = 1; r < this.R; r++) { const i = r * this.C + c; s += Math.hypot(this.x[i] - this.x[i - this.C], this.y[i] - this.y[i - this.C]); } return s; }
}

// ------------------------------------------------------------ disegno a pixel netti
// etichette: 1 luce, 2 base, 3 ombra, 4 rovescio, 5 rovescio in ombra, 6 contorno, 7 orlo, 8 bagliore, 9 ricamo, 10 cornice; +16 = acceso dal lampo
const SEG_COLL = [0, 1, 1, 1, 2, 1];   // collare: dietro → base del cappuccio → gola (niente falda sulla spalla)   // coppie di punti del colletto e spessore relativo
const T_CONT = 6, T_ORLO = 7, T_BAGL = 8, T_RIC = 9, T_CORN = 10, T_FERM = 11;

// parte dell'atlas sotto il pixel (X, Y) della tela del telo; 0 fuori dallo sprite
function parteDi(P, X, Y) {
  const sx = X + P.X0, sy = Y + P.Y0;
  if (sx < 0 || sy < 0 || sx >= P.fw || sy >= P.fh) return 0;
  return P.par[((sy * P.W) + P.fx0 + (P.specchio ? P.fw - 1 - sx : sx)) * 4];
}
// 2 = corpo (il telo ci sta sopra con ogni colonna), 1 = lembo (solo le colonne vicine), 0 = mai / niente
function tipoParte(p, mb, mc, mm, lembo) { return p <= 0 || p >= 32 || ((mm >>> p) & 1) ? 0 : ((mb >>> p) & 1) ? 2 : lembo && ((mc >>> p) & 1) ? 1 : 0; }
const dav1 = (lab, cop, fr, k) => lab[k] && (cop[k] === 2 || (cop[k] === 1 && fr[k]));

export class Pittore {
  /** BW × BH pixel; dietro/davanti: Uint32Array (vista sui dati di un ImageData) o creati qui (Node). */
  constructor(BW, BH, dietro = null, davanti = null) {
    const n = BW * BH;
    this.BW = BW; this.BH = BH;
    this.lab = new Uint8Array(n); this.riga = new Uint8Array(n); this.fr = new Uint8Array(n); this.cop = new Uint8Array(n);
    this.dietro = dietro || new Uint32Array(n); this.davanti = davanti || new Uint32Array(n);
    this.lut = new Uint32Array(32);
    this.b = [0, 0, -1, -1]; this.prima = [0, 0, -1, -1]; this.sporco = [0, 0, 0, 0];   // riquadro di adesso, di prima, unione (x, y, w, h)
    this.contaDavanti = 0; this.contaPixel = 0; this.tick = 0;
    this.tonoDenti = new Uint8Array(16);
  }
  _pulisci() {
    const [x0, y0, x1, y1] = this.b, BW = this.BW;
    for (let y = y0; y <= y1; y++) { const a = y * BW + x0, z = y * BW + x1 + 1; this.lab.fill(0, a, z); this.riga.fill(0, a, z); this.fr.fill(0, a, z); this.cop.fill(0, a, z); this.dietro.fill(0, a, z); this.davanti.fill(0, a, z); }
  }
  /** Tavolozza: col = {luce, base, ombra, rovescio, rovescio_ombra, contorno} in [r,g,b]; extra orlo/bagliore/ricamo/cornice; lampo {col, f}. */
  tavolozza(col, orlo, bagliore, ricamo, cornice, lampoCol, lampoF) {
    const lut = this.lut, chiavi = ['luce', 'base', 'ombra', 'rovescio', 'rovescio_ombra'];
    for (let k = 0; k < 5; k++) {
      const c = col[chiavi[k]]; lut[k + 1] = imp(c[0], c[1], c[2]);
      if (lampoCol) { const f = Math.min(0.75, lampoF); lut[k + 17] = imp(c[0] + (lampoCol[0] - c[0]) * f | 0, c[1] + (lampoCol[1] - c[1]) * f | 0, c[2] + (lampoCol[2] - c[2]) * f | 0); }
      else lut[k + 17] = lut[k + 1];
    }
    const ct = col.contorno; lut[T_CONT] = imp(ct[0], ct[1], ct[2]);
    lut[T_ORLO] = orlo ? imp(orlo[0], orlo[1], orlo[2]) : lut[T_CONT];
    lut[T_BAGL] = bagliore ? imp(bagliore[0], bagliore[1], bagliore[2]) : lut[T_ORLO];
    lut[T_RIC] = ricamo ? imp(ricamo[0], ricamo[1], ricamo[2]) : lut[2];
    lut[T_CORN] = cornice ? imp(cornice[0], cornice[1], cornice[2]) : lut[T_CONT];
    lut[T_FERM] = imp(212, 168, 88);   // ottone del personaggio
  }
  _tri(x0, y0, x1, y1, x2, y2, L, rg, f) {
    let ar = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
    if (ar > -0.02 && ar < 0.02) return;
    if (ar < 0) { let t = x1; x1 = x2; x2 = t; t = y1; y1 = y2; y2 = t; }
    const BW = this.BW, lab = this.lab, riga = this.riga, fr = this.fr;
    const xa = Math.max(0, Math.floor(Math.min(x0, x1, x2))), xb = Math.min(BW - 1, Math.ceil(Math.max(x0, x1, x2)));
    const ya = Math.max(0, Math.floor(Math.min(y0, y1, y2))), yb = Math.min(this.BH - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let y = ya; y <= yb; y++) {
      const Y = y + 0.5;
      for (let x = xa; x <= xb; x++) {
        const X = x + 0.5;
        if ((x1 - x0) * (Y - y0) - (y1 - y0) * (X - x0) < 0) continue;
        if ((x2 - x1) * (Y - y1) - (y2 - y1) * (X - x1) < 0) continue;
        if ((x0 - x2) * (Y - y2) - (y0 - y2) * (X - x2) < 0) continue;
        const q = y * BW + x; lab[q] = L; riga[q] = rg; fr[q] = f;
      }
    }
  }
  /** Impronta al pixel di ciò che il disegno userebbe: se non cambia, la tela di prima va ancora bene. */
  firma(t, o) {
    let h = (o.ox * 73 + o.oy * 151 + o.verso * 7 + Math.round(o.copre * 20) + (o.parti?.fx0 || 0) * 3 + (o.parti?.X0 || 0) * 11 + (o.parti?.Y0 || 0) * 13) | 0;
    for (let i = 0, n = t.C * t.R; i < n; i++) h = (Math.imul(h, 31) + Math.round(t.x[i] - o.ox) * 977 + Math.round(t.y[i] - o.oy)) | 0;
    const K = o.coll; if (K) for (let k = 0; k < K.length; k++) h = (Math.imul(h, 17) + Math.round(K[k])) | 0;
    return h;
  }
  /**
   * Disegna il telo t. o (riusato, senza allocazioni):
   *  ox, oy: origine della tela in coordinate del telo (interi); verso: ±1; luce [x, y su, z]; lampo {dx, dy su, f} | null;
   *  copre 0..1 (quota di colonne dal lato vicino che può passare davanti); parti {par, W, fw, fh, fx0, X0, Y0, specchio} | null;
   *  mCopre, mMai: maschere di bit delle parti; ricamoRiga 0..1 | -1; bagliore bool.
   */
  disegna(t, o) {
    this._pulisci(); this.tick++;
    const C = t.C, R = t.R, x = t.x, y = t.y, BW = this.BW, BH = this.BH, ox = o.ox, oy = o.oy;
    let mx = 1e9, my = 1e9, Mx = -1e9, My = -1e9;
    for (let i = 0, n = C * R; i < n; i++) { const X = x[i] - ox, Y = y[i] - oy; if (X < mx) mx = X; if (X > Mx) Mx = X; if (Y < my) my = Y; if (Y > My) My = Y; }
    const dente = t.sv[0] * t.prof + 2;
    const b = this.b;
    b[0] = Math.max(1, Math.floor(mx - dente)); b[1] = Math.max(1, Math.floor(my - dente)); b[2] = Math.min(BW - 2, Math.ceil(Mx + dente)); b[3] = Math.min(BH - 2, Math.ceil(My + dente));
    const lx = o.luce[0], ly = o.luce[1], lz = o.luce[2], v = o.verso;
    const lp = o.lampo; let lpx = 0, lpy = 0; if (lp && lp.f > 0.05) { const m = Math.hypot(lp.dx, lp.dy) || 1; lpx = lp.dx / m; lpy = -lp.dy / m; }
    const soglia = 1 - o.copre;
    // due passate: prima il rovescio, poi il dritto sopra
    for (let pass = 0; pass < 2; pass++) for (let r = 0; r < R - 1; r++) for (let c = 0; c < C - 1; c++) {
      if (r >= t.rT && (t.taglio >>> c) & 1) continue;
      const a = r * C + c, bb = a + 1, cc = a + C + 1, d = a + C;
      const Ax = x[a] - ox, Ay = y[a] - oy, Bx = x[bb] - ox, By = y[bb] - oy, Cx = x[cc] - ox, Cy = y[cc] - oy, Dx = x[d] - ox, Dy = y[d] - oy;
      const s = (Cx - Ax) * (Dy - By) - (Cy - Ay) * (Dx - Bx);
      const dritto = s * v >= 0;
      if (dritto !== (pass === 1)) continue;
      // normale (di piatto) verso il lato della colonna 0 = esterno del telo
      const mxx = Dx + Cx - Ax - Bx, myy = Dy + Cy - Ay - By; let nx = -myy, ny = mxx; const nm = Math.hypot(nx, ny) || 1; nx /= nm; ny /= nm;
      if (nx * (Ax - Bx) + ny * (Ay - By) < 0) { nx = -nx; ny = -ny; }
      const dl = 0.75 * (nx * lx - ny * ly) + 0.66 * lz;
      let tono = dritto ? (dl > 0.6 ? 1 : dl < -0.08 ? 3 : 2) : (dl > 0.3 ? 4 : 5);
      const acceso = lpx || lpy ? (nx * lpx + ny * lpy > 0.15 ? 16 : 0) : 0;
      const larg = Math.hypot(Bx - Ax, By - Ay) / (t.sh[r > 0 ? r : 1] || 1);
      const M1x = (Ax + Bx) * 0.5, M1y = (Ay + By) * 0.5, M2x = (Dx + Cx) * 0.5, M2y = (Dy + Cy) * 0.5;
      // pieghe: bande lungo le colonne; più il telo è stretto più la banda in ombra si vede
      const t0 = dritto && larg < 0.75 && tono === 2 ? 1 : tono;
      const t1 = dritto ? (larg < 0.95 ? Math.min(3, tono + 1) : tono) : 5;
      const f0 = (c + 0.25) / (C - 1) >= soglia ? 1 : 0, f1 = (c + 0.75) / (C - 1) >= soglia ? 1 : 0;
      this._tri(Ax, Ay, M1x, M1y, M2x, M2y, t0 + acceso, r + 1, f0); this._tri(Ax, Ay, M2x, M2y, Dx, Dy, t0 + acceso, r + 1, f0);
      this._tri(M1x, M1y, Bx, By, Cx, Cy, t1 + acceso, r + 1, f1); this._tri(M1x, M1y, Cx, Cy, M2x, M2y, t1 + acceso, r + 1, f1);
      if (r === R - 2) { this.tonoDenti[c * 2] = t0 + acceso; this.tonoDenti[c * 2 + 1] = t1 + acceso; }
    }
    // orlo strappato: denti che pendono lungo la direzione dell'ultimo tratto di colonna
    const nd = t.denti, last = (R - 1) * C;
    if (nd > 0) for (let c = 0; c < C - 1; c++) {
      if ((t.taglio >>> c) & 1 && t.rT <= R - 2) continue;
      const i0 = last + c, i1 = i0 + 1;
      let dx = x[i0] - x[i0 - C] + x[i1] - x[i1 - C], dy = y[i0] - y[i0 - C] + y[i1] - y[i1 - C]; const dm = Math.hypot(dx, dy) || 1; dx /= dm; dy /= dm;
      const X0 = x[i0] - ox, Y0 = y[i0] - oy, X1 = x[i1] - ox, Y1 = y[i1] - oy;
      for (let k = 0; k < nd; k++) {
        const u0 = k / nd, u1 = (k + 1) / nd, h = hash(c * 13 + k * 5 + t.seme * 101), um = u0 + (u1 - u0) * (0.3 + 0.4 * hash(c * 7 + k + t.seme));
        const len = t.sv[c] * t.prof * (0.3 + 0.9 * h) * (h < 0.18 ? 0.2 : 1);
        const bx0 = X0 + (X1 - X0) * u0, by0 = Y0 + (Y1 - Y0) * u0, bx1 = X0 + (X1 - X0) * u1, by1 = Y0 + (Y1 - Y0) * u1;
        const tx = X0 + (X1 - X0) * um + dx * len, ty = Y0 + (Y1 - Y0) * um + dy * len;
        const sub = (u0 + u1) * 0.5 < 0.5 ? 0 : 1, f = (c + 0.25 + 0.5 * sub) / (C - 1) >= soglia ? 1 : 0;
        this._tri(bx0, by0, bx1, by1, tx, ty, this.tonoDenti[c * 2 + sub] || 2, R, f);
      }
    }
    const lab = this.lab;
    // ricamo: una riga di 1 px sul dritto
    if (o.ricamoRiga >= 0) {
      const rr = Math.max(1, Math.min(R - 1, Math.round(o.ricamoRiga * (R - 1))));
      for (let c = 0; c < C - 1; c++) {
        const i = rr * C + c, X0 = x[i] - ox, Y0 = y[i] - oy, X1 = x[i + 1] - ox, Y1 = y[i + 1] - oy, n = Math.ceil(Math.hypot(X1 - X0, Y1 - Y0) * 2) + 1;
        for (let s = 0; s <= n; s++) { const X = X0 + (X1 - X0) * s / n | 0, Y = Y0 + (Y1 - Y0) * s / n | 0; if (X < 0 || Y < 0 || X >= BW || Y >= BH) continue; const q = Y * BW + X, L = lab[q] & 15; if (L >= 1 && L <= 3) lab[q] = T_RIC; }
      }
    }
    // colletto: fascia attorno alla base del cappuccio (dietro → spalla → gola) e fermaglio d'ottone sulla gola
    const K = o.coll;
    if (K) {
      // tratti: dietro→spalla, spalla→gola (colletto), colletto→spalla vicina, spalla→metà omero (falda, più larga)
      for (let k = 0; k < SEG_COLL.length / 3; k++) {
        const a = SEG_COLL[k * 3], bq = SEG_COLL[k * 3 + 1]; if (bq * 2 + 1 >= K.length) continue;
        const rr = o.collW * 0.5 * SEG_COLL[k * 3 + 2], r2 = rr * rr;
        const X0 = K[a * 2] - ox, Y0 = K[a * 2 + 1] - oy, X1 = K[bq * 2] - ox, Y1 = K[bq * 2 + 1] - oy, n = Math.ceil(Math.hypot(X1 - X0, Y1 - Y0)) + 1;
        for (let s2 = 0; s2 <= n; s2++) {
          const Xc = X0 + (X1 - X0) * s2 / n, Yc = Y0 + (Y1 - Y0) * s2 / n;
          for (let Y = Math.floor(Yc - rr); Y <= Math.ceil(Yc + rr); Y++) for (let X = Math.floor(Xc - rr); X <= Math.ceil(Xc + rr); X++) {
            if (X < 1 || Y < 1 || X >= BW - 1 || Y >= BH - 1 || (X + 0.5 - Xc) ** 2 + (Y + 0.5 - Yc) ** 2 > r2) continue;
            const q = Y * BW + X; lab[q] = Y + 0.5 < Yc - rr * 0.3 ? 1 : 2; this.riga[q] = 1; this.fr[q] = 1;
          }
        }
      }
      const FX = Math.round(K[4] - ox), FY = Math.round(K[5] - oy);
      if (FX > 0 && FY > 0 && FX < BW - 1 && FY < BH - 1) { lab[FY * BW + FX] = T_FERM; if (o.collW >= 3) lab[FY * BW + FX + 1] = T_FERM; }
      if (b[0] > FX - 4) b[0] = Math.max(1, FX - 6); if (b[2] < FX + 4) b[2] = Math.min(BW - 2, FX + 6); if (b[1] > FY - 6) b[1] = Math.max(1, FY - 8);
    }
    // doni: buco con cornice (si apre) o solo riserva (il lembo non ci passa davanti)
    for (let k = 0; k < t.nCer; k++) {
      const cx = t.cer[k * 4] - ox, cy = t.cer[k * 4 + 1] - oy, rr = t.cer[k * 4 + 2], buco = t.cer[k * 4 + 3];
      const r2 = rr * rr, rc = (rr + 1.3) * (rr + 1.3);
      for (let Y = Math.max(b[1], cy - rr - 2 | 0); Y <= Math.min(b[3], cy + rr + 2); Y++) for (let X = Math.max(b[0], cx - rr - 2 | 0); X <= Math.min(b[2], cx + rr + 2); X++) {
        const q = Y * BW + X, d2 = (X + 0.5 - cx) ** 2 + (Y + 0.5 - cy) ** 2;
        if (d2 < r2) { if (buco) lab[q] = 0; this.fr[q] = 0; } else if (buco && d2 < rc && lab[q] && o.cornice) lab[q] = T_CORN;
      }
    }
    // copertura per pixel con l'atlas delle parti
    const A = o.asse, mg = o.margine ?? 0, P = o.parti, cop = this.cop, fr = this.fr, mc = o.mCopre >>> 0, mb = o.mCorpo >>> 0, mm = o.mMai >>> 0, lembo = o.copre > 0;
    let nfr = 0;
    if (P && P.par) {
      for (let Y = b[1] - 1; Y <= b[3] + 1; Y++) for (let X = b[0] - 1; X <= b[2] + 1; X++) {
        const q = Y * BW + X, p = parteDi(P, X, Y);
        let c = tipoParte(p, mb, mc, mm, lembo);
        if (!c && p === 0) {         // contorno dello sprite: come la parte accanto, mai vicino a una parte proibita
          let m = 0, no = 0;
          for (let j = 0; j < 4; j++) { const pp = parteDi(P, X + (j === 0 ? 1 : j === 1 ? -1 : 0), Y + (j === 2 ? 1 : j === 3 ? -1 : 0)); const t = tipoParte(pp, mb, mc, mm, lembo); if (t > m) m = t; if (pp && pp < 32 && ((mm >>> pp) & 1)) no = 1; }
          c = no ? 0 : m;
        }
        // corpo: il telo sta davanti solo dietro l'asse del corpo (meno il margine): mai un blocco rosso su tutto il busto
        if (c === 2 && A && ((A[0] + (A[2] - A[0]) * (Y + 0.5 - A[1]) / ((A[3] - A[1]) || 1)) - (X + 0.5)) * o.verso < mg) c = 0;
        cop[q] = c; if (lab[q] && (c === 2 || (c === 1 && fr[q]))) nfr++;
      }
    }
    // uscita: colori, contorno, orlo (bordo sotto le righe d'orlo), strato davanti
    const lut = this.lut, riga = this.riga, out = this.dietro, dav = this.davanti, orloRiga = R - 1, tick = this.tick;
    let npx = 0;
    for (let Y = b[1] - 1; Y <= b[3] + 1; Y++) for (let X = b[0] - 1; X <= b[2] + 1; X++) {
      const q = Y * BW + X, L = lab[q];
      if (L) {
        out[q] = lut[L]; npx++;
        if (nfr && (cop[q] === 2 || (cop[q] === 1 && fr[q]))) dav[q] = lut[L];
        continue;
      }
      const su = lab[q - BW], gi = lab[q + BW], sx = lab[q - 1], dx = lab[q + 1];
      if (!(su | gi | sx | dx)) continue;
      let col = lut[T_CONT];
      if (su && riga[q - BW] >= orloRiga) col = o.bagliore && ((X + (tick >> 2)) % 5 === 0) ? lut[T_BAGL] : lut[T_ORLO];
      out[q] = col;
      if (nfr && cop[q] && (dav1(lab, cop, fr, q - BW) || dav1(lab, cop, fr, q + BW) || dav1(lab, cop, fr, q - 1) || dav1(lab, cop, fr, q + 1))) dav[q] = col;
    }
    this.contaDavanti = nfr; this.contaPixel = npx;
    // riquadro sporco: unione con il precedente (per putImageData)
    const p = this.prima, sp = this.sporco;
    const ux0 = Math.max(0, Math.min(b[0], p[2] >= 0 ? p[0] : b[0]) - 1), uy0 = Math.max(0, Math.min(b[1], p[3] >= 0 ? p[1] : b[1]) - 1);
    const ux1 = Math.min(BW - 1, Math.max(b[2], p[2]) + 1), uy1 = Math.min(BH - 1, Math.max(b[3], p[3]) + 1);
    sp[0] = ux0; sp[1] = uy0; sp[2] = ux1 - ux0 + 1; sp[3] = uy1 - uy0 + 1;
    p[0] = b[0] - 1; p[1] = b[1] - 1; p[2] = b[2] + 1; p[3] = b[3] + 1;
    // il prossimo _pulisci deve coprire anche il bordo di 1 px
    b[0]--; b[1]--; b[2]++; b[3]++;
    return sp;
  }
}

/**
 * Mantello di un personaggio: legge i dati (stoffa.json → mantello), la posa del fotogramma (punti nominati),
 * tiene l'accumulatore a passo fisso. Le ancore sono relative al corpo (bx, by), così la simulazione segue
 * l'entità anche fra un disegno e l'altro.
 */
export class Mantello {
  constructor(dati = MANTELLO_BASE) {
    this.telo = new Telo(); this.dati = dati; this.par = risolviLivello(dati, dati.livello ?? 1);
    this.acc = 0; this.H = 48; this.verso = 1; this.pronte = false;
    this.rk = new Float32Array(16); this.nk = 0;
    this.rcap = new Float32Array(this.telo.maxCap * 6);
    this.rcer = new Float32Array(this.telo.maxCer * 4); this.nCer = 0;
    this.tmp = [0, 0]; this.tmp2 = [0, 0];
    this.bx = 0; this.by = 0; this.ventoF = 0; this.girato = false; this.versoPrima = 0;
  }
  /** dati: blocco mantello; livello; ext: sovrascritture del pannello {lunghezza ×, larghezza ×, rigidita, peso, accorcia ×}. */
  imposta(dati, livello, ext, H) {
    this.dati = dati || this.dati; this.H = H;
    const p = risolviLivello(this.dati, livello ?? this.dati.livello ?? 1);
    if (ext) {
      p.lunghezza_H *= (ext.lunghezza ?? 1) * (ext.accorcia ?? 1); p.larghezza_H *= ext.larghezza ?? 1;
      if (ext.rigidita != null) p.rigidita = ext.rigidita;
      if (ext.peso != null) p.peso = ext.peso;
    }
    this.par = p; this.telo.configura(p, H);
  }
  /**
   * Posa del fotogramma: punto(nome, out) → true e out = [x, y] nel mondo (agganci_px, giunti_px o ripiego).
   * bx, by: corpo; verso ±1; moduli: [{giunto, dietro_H, giu_H, raggio_H, buco}] (sfere dei doni).
   */
  leggiPosa(punto, bx, by, verso, moduli = null) {
    const H = this.H, d = this.par, t = this.tmp, rk = this.rk;
    this.girato = this.versoPrima !== 0 && verso !== this.versoPrima; this.versoPrima = verso;
    this.verso = verso; this.bx = bx; this.by = by;
    if (punto('collo', t) && punto('vita', this.tmp2)) { const dx = this.tmp2[0] - t[0], dy = this.tmp2[1] - t[1], m = Math.hypot(dx, dy) || 1; this.telo.giuX = dx / m; this.telo.giuY = dy / m; }
    let n = 0;
    for (const a of d.agganci) {
      if (!punto(a.punto, t)) continue;
      rk[n * 2] = t[0] - bx - verso * (a.dietro_H || 0) * H; rk[n * 2 + 1] = t[1] - by + (a.giu_H || 0) * H; n++;
      if (n >= 8) break;
    }
    this.nk = n;
    let m = 0;
    for (const c of d.capsule || []) {
      if (m >= this.telo.maxCap) break;
      if (!punto(c[0], t) || !punto(c[1], this.tmp2)) continue;
      const o = m * 6; this.rcap[o] = t[0] - bx; this.rcap[o + 1] = t[1] - by; this.rcap[o + 2] = this.tmp2[0] - bx; this.rcap[o + 3] = this.tmp2[1] - by; this.rcap[o + 4] = c[2] * H; this.rcap[o + 5] = c[3] === 'dietro' ? 1 : 0; m++;
    }
    this.telo.nCap = m;
    let k = 0;
    if (moduli) for (const mo of moduli) {
      if (k >= this.telo.maxCer || !punto(mo.giunto, t)) continue;
      const o = k * 4; this.rcer[o] = t[0] - bx - verso * (mo.dietro_H || 0) * H; this.rcer[o + 1] = t[1] - by + (mo.giu_H || 0) * H; this.rcer[o + 2] = (mo.raggio_H || 0.1) * H; this.rcer[o + 3] = mo.buco ? 1 : 0; k++;
    }
    this.nCer = k;
    this.pronte = n >= 1;
  }
  _assoluti(bx, by) {
    const tl = this.telo;
    for (let i = 0; i < this.nk; i++) { tl.kx[i] = bx + this.rk[i * 2]; tl.ky[i] = by + this.rk[i * 2 + 1]; }
    tl.nk = this.nk; tl.distribuisci(); tl.bx = bx; tl.by = by;
    for (let k = 0; k < tl.nCap; k++) { const o = k * 6; tl.cap[o] = bx + this.rcap[o]; tl.cap[o + 1] = by + this.rcap[o + 1]; tl.cap[o + 2] = bx + this.rcap[o + 2]; tl.cap[o + 3] = by + this.rcap[o + 3]; tl.cap[o + 4] = this.rcap[o + 4]; tl.cap[o + 5] = this.rcap[o + 5]; }
    tl.nCer = this.nCer;
    for (let k = 0; k < this.nCer; k++) { const o = k * 4; tl.cer[o] = bx + this.rcer[o]; tl.cer[o + 1] = by + this.rcer[o + 1]; tl.cer[o + 2] = this.rcer[o + 2]; tl.cer[o + 3] = this.rcer[o + 3]; }
  }
  /** Avanza di dt (accumulatore a 1/120 s); vento px/s; suolo quota o 1e9. */
  aggiorna(dt, bx, by, vento, suolo) {
    if (!this.pronte) return;
    this.acc = Math.min(this.acc + dt, 0.05);
    this._assoluti(bx, by);
    while (this.acc >= PASSO) {
      this.acc -= PASSO;
      this.ventoF += (vento - this.ventoF) * 0.02;         // vento passato in un filtro lento (~0,4 s): niente tremolio
      // (ORCH) Carlo 16/11 (immagine: da fermo il mantello non si vede, restano due lembi rossi alle spalle). Misurato nel gioco:
      // il vento di stanza che soffia verso il viso (40–56 px/s) portava il telo 4–5 px in avanti, cioè dentro la sagoma del
      // corpo, che lo copre. Il corpo ripara il mantello: il vento che spinge verso il davanti conta per un decimo, quello
      // che lo allontana dalla schiena conta intero.
      const vAv = this.ventoF * this.verso > 0 ? 0.1 : 1;
      this.telo.passo(this.ventoF * vAv * (1 - 0.7 * this.telo.bers.k), suolo, -this.verso);
    }
  }
  /** Coreografia: out della Regia (forma, k, modo, davanti); dir = direzione del telo per il modo libero (es. opposta allo scatto). */
  dirigi(out, dirx = 0, diry = 0) {
    const B = this.telo.bers, f = out && out.forma;
    if (!f || !(out.k > 0)) { B.k = 0; return; }
    const a = f.angoli; B.k = out.k; B.a0 = a[0]; B.a1 = a[1] ?? a[0]; B.a2 = a[2] ?? B.a1; B.apertura = f.apertura || 0;
    B.modo = out.modo; B.bx = dirx; B.by = diry; B.davanti = !!out.davanti; B.guida = out.passo?.guida || 0;
  }
  spingi(vx, vy) { this.telo.spingi(vx, vy); }
  onda(a) { this.telo.onda(a); }
  /**
   * (GAL-1) Gravità apparente del telo nel sistema del corpo, in unità di gravita_H: v = [gx, gy] (logica.mjs → posaCorpo.gM:
   * nella galleria 6 H/s² giù + 11 H/s² nel verso del vento, girati con la posa), null = quella di sempre (0, 1).
   */
  gravita(v) { const t = this.telo; if (v && Number.isFinite(v[0]) && Number.isFinite(v[1])) { t.gvx = v[0]; t.gvy = v[1]; } else { t.gvx = 0; t.gvy = 1; } }
  /**
   * (GAL-1) Il corpo ha girato di d radianti (orario): il telo, che si simula nel sistema del corpo, resta un poco indietro
   * (ruota di −0,6·d attorno alle ancore, al più 0,5 rad per volta) e poi le rigidità lo riportano in ~150 ms.
   */
  ruota(d) {
    const t = this.telo;
    if (!t.pronta || !Number.isFinite(d)) return;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const a = Math.max(-0.5, Math.min(0.5, -0.6 * d));
    if (Math.abs(a) < 1e-4) return;
    const c = Math.cos(a), s = Math.sin(a), C = t.C, R = t.R, x = t.x, y = t.y, px = t.px, py = t.py;
    for (let r = 1; r < R; r++) for (let k = 0; k < C; k++) {
      const i = r * C + k, ox = t.ax[k], oy = t.ay[k];
      let dx = x[i] - ox, dy = y[i] - oy; x[i] = ox + c * dx - s * dy; y[i] = oy + s * dx + c * dy;
      dx = px[i] - ox; dy = py[i] - oy; px[i] = ox + c * dx - s * dy; py[i] = oy + s * dx + c * dy;
    }
  }
  /**
   * Spostamento fra l'ancora usata dalla simulazione e quella della posa disegnata (il disegno resta attaccato al collo).
   * bx, by: il corpo COME SI DISEGNA. (ORCH) 17/11: prima era il corpo letto nella posa (quota logica), mentre la simulazione
   * corre sul corpo disegnato (abbassato di dyPendenza sulle rampe): lo scarto valeva −dyPendenza e il disegno rialzava
   * tutto il telo di quanto il corpo era stato abbassato (fino a 0,45 H). Il «mantello che sale sulle pendenze».
   */
  scarto(out, bx = this.bx, by = this.by) {
    if (!this.nk) { out[0] = out[1] = 0; return out; }
    out[0] = bx + this.rk[0] - this.telo.kx[0]; out[1] = by + this.rk[1] - this.telo.ky[0];
    if (!(Math.abs(out[0]) < this.H && Math.abs(out[1]) < this.H)) out[0] = out[1] = 0;
    return out;
  }
}
