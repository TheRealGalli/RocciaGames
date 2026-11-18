// Copia di strumenti/pennino/prova/ascii_colpi.mjs (sito/strumenti/copia_sprite.py): non modificare qui.
// (ASC2) Colpi dei nemici e dei mini boss in caratteri: il colpo resta leggibile (nucleo a pixel o in caratteri) e dove tocca
// il mondo lascia una conseguenza fisica (polvere che si ammucchia, scintille che rimbalzano, celle bruciate, cera che cola).
// Studio: design/effetti-ascii-2026-11-17/STUDIO-COLPI-NEMICI.md. Numeri in zone/ascii-colpi.json, mai qui.
// Costruito SOLO sull'API pubblica del motore (prova/ascii.mjs: registra, volo, cella, timbro, glifo, colore, solido).
// Sei famiglie: falce, schianto, raggio, catena (e filo), cera, ago. Due varianti: «mista» (nucleo a pixel, come il raggio
// del sito) e «ascii» (anche il nucleo in caratteri); di base quella raccomandata per famiglia (dati → raccomandata).
// Uso nel gioco (proposta, righe nel rapporto ASC2):
//   const C = colpiDi(asc)                      // una volta (null se asc spento)
//   notaColpo(asc, e, g)                        // per ogni evento di g.fx (onde, catene, fili, cera)
//   osservaColpi(asc, g)                        // ogni fotogramma: raggi dei Bracci e delle Lampade, hitbox dei colpi in corso
//   C.passo(dt)                                 // prima di asc.disegnaSotto/disegnaSopra (mette in coda i glifi fissi)
//   C.disegnaPixel(cx, camX)                    // dopo la luce: i nuclei a pixel della variante mista
// Solo resa: niente qui cambia danno, movimento o nemici. Spento (asc null o modo 0): ogni funzione esce subito.
// Vasche fisse e oggetti creati una volta; rumore deterministico (h01 del motore) con un contatore di semi proprio.
import DATI from '../zone/ascii-colpi.json' with { type: 'json' };
import { h01 } from './ascii.mjs';
import { TETTO_FX, posto } from './tetto_fx.mjs';
import { geometriaArco, finestraArco, statoArco, testaArco, MB_ARCHI } from './fx_nemici.mjs';

export const COLPI_DATI = DATI;
const RAD = Math.PI / 180;
const base = (id) => String(id || '').replace(/-(elite|mini)$/, '');
const tMossa = (n) => { const c = n.motore?.corrente; return c ? c.t * 1000 : (n.animT || 0); };
const NUCLEO = { RAGGIO: 1, MIRA: 2, GRUMO: 3, AGO: 4 };
const CORSA = { ONDA: 1, CATENA: 2, FILO: 3 };
const FAM_GEO = { falce: 'falce', anello: 'falce', radente: 'schianto', due_lati: 'schianto', espande: 'schianto', affondo: 'catena' };

const ISTANZE = new WeakMap();
/** Stato dei colpi legato all'istanza del motore (creato alla prima chiamata); null se il motore è spento. */
export function colpiDi(asc, dati = DATI, variante = null) {
  if (!asc || !asc.modo) return null;
  let C = ISTANZE.get(asc);
  if (!C) { C = new Colpi(asc, dati, variante); ISTANZE.set(asc, C); }
  return C;
}

export class Colpi {
  /** variante: null = raccomandata per famiglia; 'mista' | 'ascii' = forzata (tavole e prove). */
  constructor(asc, dati = DATI, variante = null) {
    this.asc = asc; this.D = dati; this.var = variante;
    this.spento = !asc || !asc.modo;
    if (this.spento) return;
    const D = dati, T = D.tetti, ID = asc.registra(D.pacchetto);
    this.ID = ID;
    this.mPolvere = ID.materie.polvere; this.mFumo = ID.materie.fumo; this.mCera = ID.materie.cera;
    this.tScint = ID.tipi.scintilla; this.tZolla = ID.tipi.zolla; this.tDetrito = ID.tipi.detrito; this.tGoccia = ID.tipi.goccia_cera; this.tRimb = ID.tipi.rimbalzo_ago;
    const g = (c) => asc.glifo(c);
    this.g = { meno: g('-'), bar: g('|'), sl: g('/'), bs: g('\\'), ap: g("'"), pun: g('.'), und: g('_'), o: g('o'), ast: g('*'), ug: g('='), cap: g('^'), til: g('~'), x: g('x'), piu: g('+') };
    this._tO = Math.tan(22 * RAD); this._tV = Math.tan(68 * RAD);
    // glifi fissi (segni): per tipo, glifi e colori per età
    this.ST = []; this.stIdx = Object.create(null);
    for (const [nome, S] of Object.entries(D.segni)) {
      if (nome[0] === '_') continue;
      this.stIdx[nome] = this.ST.length;
      this.ST.push({ gl: Uint8Array.from([...S.glifi].map((c) => (c === '?' ? 255 : asc.glifo(c)))), col: Uint16Array.from(S.colori.map((i) => asc.colore(S.tavolozza, i))), vita: S.vita_s, strato: S.strato });
    }
    const NS = this.NS = T.segni;
    this.sx = new Float32Array(NS); this.sy = new Float32Array(NS); this.sT = new Float32Array(NS); this.st = new Uint8Array(NS); this.sg = new Uint8Array(NS); this.son = new Uint8Array(NS);
    this.sTesta = 0; this.nSegni = 0;
    // corse: onde a terra e strisciate (oggetti creati una volta)
    this.corse = Array.from({ length: T.corse }, () => ({ on: false, tipo: 0, x0: 0, y: 0, dir: 1, L: 0, dur: 0, t: 0, forza: 1, passi: 0, hx: 0, hy: 0, ascii: false, sc: 0, N: null, fine: false }));
    this.iCorsa = 0;
    // raggi seguiti (per id del nemico): ultima cella bruciata, ultimi tempi di scintille e fumo
    this.raggi = Array.from({ length: T.raggi }, () => ({ id: null, cella: -1, ts: -1, tf: -1, t: -1, tl: -1, bx: NaN, by: NaN }));   // (SPA1) tl, bx, by
    // nemici seguiti per i contatti delle hitbox: ultima cella toccata per hitbox
    this.nem = Array.from({ length: T.nemici }, () => ({ b: null, m: null, t: -1, cel: new Int32Array(32).fill(-1), px: new Float32Array(32).fill(NaN), py: new Float32Array(32) }));
    // nuclei a pixel del fotogramma
    const NN = this.NN = T.nuclei;
    this.nt = new Uint8Array(NN); this.nx = new Float32Array(NN); this.ny = new Float32Array(NN); this.nux = new Float32Array(NN); this.nuy = new Float32Array(NN);
    this.nl = new Float32Array(NN); this.nk = new Float32Array(NN); this.nn = 0;
    this._p = { g: 0, att: 0, rit: 0, lascia: 0, tono: 0 };
    this._sa = {}; this._fa = [0, 0]; this._ta = [0, 0, 0, 0, NaN];
    this._nem = Object.create(null);   // tavolozza e scintilla per tipo, risolte alla prima volta
    this.seme = 1; this.t = 0;
    this.conta = { segni: 0, volo: 0, celle: 0, timbri: 0 };
    this._iniziaSpari(D);   // (SPA1) spari in lettere
  }
  variante(fam) { return this.var || this.D.raccomandata[fam] || 'mista'; }
  ascii(fam) { return this.variante(fam) === 'ascii'; }
  _s() { return (this.seme = (this.seme + 0x9e37) >>> 0); }
  _r(k = 0) { return h01(this.seme * 131 + k * 977 + 17); }
  /** Tavolozza e materia delle scintille del nemico (tipo base). */
  nemico(tipo) {
    const k = base(tipo);
    let N = this._nem[k];
    if (!N) {
      const Q = this.D.nemici[k] || this.D.nemici._, tav = Q.tavolozza, asc = this.asc;
      N = this._nem[k] = { tav, sc: this.ID.materie[Q.scintilla] ?? this.ID.materie.scintilla, col: Uint16Array.from([0, 1, 2, 3, 4, 5].map((i) => asc.colore(tav, i))) };
    }
    return N;
  }

  // ------------------------------------------------------------------------------------------------ primitive
  /** Glifo orientato lungo (ux, uy) (y in giù), come il moto dei caratteri in volo del motore. */
  glifoDir(ux, uy) {
    const ax = ux < 0 ? -ux : ux, ay = uy < 0 ? -uy : uy, G = this.g;
    if (ay < ax * this._tO) return G.meno;
    if (ay > ax * this._tV) return G.bar;
    return ux * uy < 0 ? G.sl : G.bs;
  }
  /** Un glifo fisso del tipo `nome` in (x, y) px di mondo; gDato = glifo per le età segnate «?». */
  segno(nome, x, y, gDato = 0) {
    const k = this.stIdx[nome];
    if (k === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const i = this.sTesta; this.sTesta = (i + 1) % this.NS;
    if (!this.son[i]) this.nSegni++;
    this.son[i] = 1; this.sx[i] = x; this.sy[i] = y; this.sT[i] = 0; this.st[i] = k; this.sg[i] = gDato;
    this.conta.segni++;
  }
  /** n scintille dal punto (x, y) attorno alla normale (nx, ny), apertura in gradi, velocità [a, b] H/s, vita [a, b] s. */
  scintille(x, y, nx, ny, n, v, apertura, vita, mat, tipo = this.tScint) {   // (SPA1) tipo di volo facoltativo
    const asc = this.asc, H = asc.H, a0 = Math.atan2(ny, nx), ap = apertura * RAD;
    for (let k = 0; k < n; k++) {
      const s = this._s(), u = n > 1 ? k / (n - 1) - 0.5 : 0;
      const a = a0 + ap * (u + (h01(s * 3 + 1) - 0.5) * 0.3), vv = (v[0] + (v[1] - v[0]) * h01(s * 7 + 2)) * H;
      asc.volo(x, y, Math.cos(a) * vv, Math.sin(a) * vv, mat, tipo, vita[0] + (vita[1] - vita[0]) * h01(s * 11 + 3), s);
      this.conta.volo++;
    }
  }
  /** Quota della superficie sotto (o sopra, se dentro un solido) a x, partendo da y; NaN se non c'è entro 2 H. */
  quota(x, y) {
    const asc = this.asc, M = 2 * asc.H;
    if (asc.solido(x, y)) { for (let d = 1; d < M; d++) if (!asc.solido(x, y - d)) return y - d + 1; return NaN; }
    for (let d = 1; d < M; d++) if (asc.solido(x, y + d)) return y + d;
    return NaN;
  }
  _nucleo(tipo, x, y, ux, uy, len, k) {
    if (this.nn >= this.NN) return;
    const i = this.nn++;
    this.nt[i] = tipo; this.nx[i] = x; this.ny[i] = y; this.nux[i] = ux; this.nuy[i] = uy; this.nl[i] = len; this.nk[i] = k;
  }

  // ------------------------------------------------------------------------------------------------ passo e disegno
  /** Avanza onde e strisciate, invecchia i segni e li mette in coda al motore (prima di asc.disegnaSotto/Sopra). */
  passo(dt) {
    if (this.spento) return;
    if (dt > 0) this.t += Math.min(dt, 0.1);
    for (const c of this.corse) if (c.on) this._corsa(c, dt);
    const asc = this.asc, ST = this.ST;
    for (let i = 0; i < this.NS; i++) {
      if (!this.son[i]) continue;
      const S = ST[this.st[i]], e = (this.sT[i] += dt > 0 ? Math.min(dt, 0.1) : 0);
      if (e >= S.vita) { this.son[i] = 0; this.nSegni--; continue; }
      const f = Math.min(S.gl.length - 1, (e / S.vita * S.gl.length) | 0), gl = S.gl[f] === 255 ? this.sg[i] : S.gl[f];
      if (asc.timbro(gl, S.col[Math.min(S.col.length - 1, f)], this.sx[i], this.sy[i], S.strato)) this.conta.timbri++;
    }
  }
  /** Nuclei a pixel della variante mista (raggio del sito, grumo di cera, ago), dopo la luce; la coda si svuota. */
  disegnaPixel(cx, camX = 0) {
    if (this.spento) return 0;
    let n = 0;
    for (let i = 0; i < this.nn; i++) {
      const X = this.nx[i] - camX, Y = this.ny[i], t = this.nt[i];
      // il colpo stesso non si taglia (deve leggersi): posto prioritario nel tetto globale; il preavviso è normale
      const st = t === NUCLEO.RAGGIO || t === NUCLEO.MIRA ? 3 * (Math.min(Math.abs(this.nux[i]), Math.abs(this.nuy[i])) * this.nl[i] + 1) + 1 : 8;
      if (!posto(st, t !== NUCLEO.MIRA)) continue;
      const n0 = n;
      switch (t) {
        case NUCLEO.RAGGIO: n += nucleoRaggio(cx, X, Y, this.nux[i], this.nuy[i], this.nl[i], 'fuoco', this.nk[i], 0, this.D.raggio.pixel); break;
        case NUCLEO.MIRA: n += nucleoRaggio(cx, X, Y, this.nux[i], this.nuy[i], this.nl[i], 'mira', this.nk[i], this.nl[i] > 0 ? 1 : 0, this.D.raggio.pixel); break;
        case NUCLEO.GRUMO: n += nucleoGrumo(cx, X, Y, this.nux[i], this.nuy[i], this.asc.H, this.D.cera.grumo); break;
        case NUCLEO.AGO: n += nucleoAgo(cx, X, Y, this.nux[i], this.nuy[i], this.D.ago); break;
      }
      TETTO_FX.n += n - n0;
    }
    this.nn = 0;
    return n;
  }

  // ------------------------------------------------------------------------------------------------ A. falce
  /**
   * Un colpo dalla hitbox (geometria G e stato S di fx_nemici: arco = hitbox): variante ascii = la falce in caratteri orientati
   * lungo l'arco, fitti sul filo; in tutte e due le varianti, dove la testa tocca muro o pavimento, graffio e scintille.
   * X0, Y0: piedi del nemico in px di mondo; face ±1; N = nemico() del tipo; forza 0..2; slot = stato del nemico (contatti).
   */
  falce(G, S, X0, Y0, face, N, forza, slot, k, ascii) {
    const asc = this.asc, H = asc.H, F = this.D.falce;
    if (ascii) this._falceCaratteri(G, S, X0, Y0, face, N, forza);
    const T = testaArco(G, S, this._ta), th = G.a0 + (G.a1 - G.a0) * S.testa;
    // normale verso l'esterno dell'ellisse alla testa (per le forme a lama: avanti)
    let nx = G.tipo === 'falce' || G.tipo === 'anello' ? Math.cos(th) / Math.max(1e-6, G.rx) : 1, ny = G.tipo === 'falce' || G.tipo === 'anello' ? Math.sin(th) / Math.max(1e-6, G.ry) : 0;
    const l = Math.hypot(nx, ny) || 1; nx = nx / l * face; ny /= l;
    let hx = X0 + face * T[0] * H, hy = Y0 + T[1] * H;
    const d = F.contatto.tocca_px;
    // la testa può saltare un muro sottile fra due fotogrammi: si cerca il primo solido sul tratto dalla testa di prima
    if (slot && slot.px[k] === slot.px[k]) {
      const ax = slot.px[k], ay = slot.py[k], L = Math.hypot(hx - ax, hy - ay), n = Math.min(40, Math.ceil(L / 2));
      slot.px[k] = hx; slot.py[k] = hy;
      for (let q = 1; q < n; q++) { const x = ax + (hx - ax) * q / n, y = ay + (hy - ay) * q / n; if (asc.solido(x + nx * d, y + ny * d)) { hx = x; hy = y; break; } }
    } else if (slot) { slot.px[k] = hx; slot.py[k] = hy; }
    if (!asc.solido(hx + nx * d, hy + ny * d)) return;
    const prima = slot ? slot.cel[k] : -2;
    this._contatto(hx, hy, nx, ny, N, slot, k, F.contatto, 'graffio');
    if (forza >= 2 && ny > 0.6 && slot && prima === -1) this.colpoTerra(hx, this.quota(hx, hy - 2), forza, N);   // il maglio a terra: una volta per colpo
  }
  _contatto(hx, hy, nx, ny, N, slot, k, C, segno) {
    const asc = this.asc;
    let x = hx, y = hy;
    for (let q = 0; q < 8 && asc.solido(x, y); q++) { x -= nx; y -= ny; }   // sul bordo, dalla parte dell'aria
    const cel = ((x / asc.cw) | 0) * 4096 + ((y / asc.ch) | 0);   // cella del motore (2 × 3,5 px con le lettere)
    if (slot && slot.cel[k] === cel) return;
    if (slot && slot.cel[k] === -1) this.segno('lampo', x, y);
    if (slot) slot.cel[k] = cel;
    this.segno(segno, x, y, this.glifoDir(-ny, nx));
    this.scintille(x, y, -nx, -ny, C.scintille, C.v_H_s, C.apertura_gradi, C.vita_s, N.sc);
  }
  _falceCaratteri(G, S, X0, Y0, face, N, forza) {
    const asc = this.asc, H = asc.H, F = this.D.falce, righe = F.righe[forza] ?? 2, CC = F.colori, rie = F.rientro_px;
    const col = (tt, piu) => { for (const [s, i] of CC) if (tt >= s) return N.col[Math.min(5, i + piu)]; return N.col[5]; };
    if (G.tipo === 'falce' || G.tipo === 'anello') {
      const span = G.a1 - G.a0, thH = G.tipo === 'falce' ? G.a0 + span * S.testa : G.a0 + S.giro;
      const thT = G.tipo === 'falce' ? G.a0 + span * S.coda : thH - 1.5 * Math.PI * Math.min(1, S.testa) * (1 - S.coda / Math.max(1e-6, S.testa));
      const L = Math.abs(thH - thT) * (G.rx + G.ry) * 0.5 * H, Nn = Math.min(this.D.tetti.campioni_falce, Math.max(2, Math.ceil(L / F.passo_px)));
      if (L < 2) return;
      const cx0 = G.cx * H, cy0 = G.cy * H, sg = thH >= thT ? 1 : -1;
      for (let q = 0; q <= Nn; q++) {
        const tt = q / Nn, th = thT + (thH - thT) * tt, c = Math.cos(th), s = Math.sin(th);
        const lx = cx0 + G.rx * H * c, ly = cy0 + G.ry * H * s, tx = -G.rx * s * sg * face, ty = G.ry * c * sg;
        const gl = this.glifoDir(tx, ty), X = X0 + face * lx, Y = Y0 + ly;
        asc.timbro(tt > 0.94 ? this.g.ast : gl, col(tt, 0), X, Y, 1);
        // righe interne: verso il centro, più rade e più scure (corpo della falce)
        let ix = cx0 - lx, iy = cy0 - ly; const il = Math.hypot(ix, iy) || 1; ix = ix / il * face; iy /= il;
        for (let r = 1; r < righe; r++) if (tt > 0.2 * r && (r < 2 || (q + r) % r === 0)) asc.timbro(gl, col(tt, r), X + ix * rie * r, Y + iy * rie * r, 1);
      }
      return;
    }
    // forme a lama (radente, affondo, due lati): caratteri lungo la corsa, testa inclinata
    const T = testaArco(G, S, this._ta), y = Y0 + (G.tipo === 'affondo' ? (G.y0 + G.y1) / 2 : G.y1) * H - 2;
    for (let lato = 0; lato < (G.tipo === 'due_lati' ? 2 : 1); lato++) {
      const xh = lato ? T[4] : T[0], xs = lato ? G.cx - (G.cx - G.x0) * S.coda : G.tipo === 'due_lati' ? G.cx + (G.x1 - G.cx) * S.coda : G.x0 + (T[0] - G.x0) * S.coda;
      if (!(xh === xh)) continue;
      const d = lato ? -1 : 1, Ln = Math.abs(xh - xs) * H, Nn = Math.min(this.D.tetti.campioni_falce, Math.ceil(Ln / F.passo_px));
      for (let q = 0; q <= Nn; q++) {
        const tt = Nn ? q / Nn : 1, X = X0 + face * (xs + (xh - xs) * tt) * H;
        asc.timbro(tt > 0.92 ? (face * d > 0 ? this.g.sl : this.g.bs) : this.g.meno, col(tt, 0), X, y, 1);
        for (let r = 1; r < righe; r++) if (tt > 0.3 * r && q % 2 === 0) asc.timbro(this.g.und, col(tt, r), X, y - rie * r, 1);
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ B. schianto
  /** Schianto a terra in (x, y): colpo (detriti, polvere, scintille, lampo) e onde che corrono sul pavimento (versi 1 o 2). */
  schianto(x, y, dir, L, dur, forza = 1, versi = 1, N = null, ascii = this.ascii('schianto')) {
    if (this.spento) return;
    const q = this.quota(x, y - 2);
    if (!Number.isFinite(q)) return;
    N = N || this.nemico('');
    this.colpoTerra(x, q, forza, N);
    for (let v = 0; v < versi; v++) this._avviaCorsa(CORSA.ONDA, x, q, versi === 2 ? (v ? -1 : 1) : dir, L, dur, forza, N, ascii);
  }
  /** Il colpo che arriva a terra in (x, q superficie): lampo, scintille, detriti che rimbalzano, sbuffo di polvere. */
  colpoTerra(x, q, forza, N) {
    const asc = this.asc, D = this.D.schianto, kf = D.forza[forza] ?? 1, C = D.colpo, H = asc.H;
    this.segno('lampo', x, q - 3);
    this.scintille(x, q - 1, 0, -1, Math.round(C.scintille * kf), C.v_H_s, 150, [0.15, 0.3], N.sc);
    for (let k = 0; k < Math.round(C.detriti * kf); k++) {
      const s = this._s(), sx = k & 1 ? 1 : -1;
      asc.volo(x + sx * 2, q - 2, sx * (D.detrito_vx_H_s[0] + h01(s) * (D.detrito_vx_H_s[1] - D.detrito_vx_H_s[0])) * H, -(D.detrito_vy_H_s[0] + h01(s + 5) * (D.detrito_vy_H_s[1] - D.detrito_vy_H_s[0])) * H, this.mPolvere, this.tDetrito, D.detrito_vita_s, s);
      this.conta.volo++;
    }
    this._polvere(x, q, 0, Math.round(C.polvere * kf));
  }
  _polvere(x, q, dir, n) {
    const asc = this.asc, D = this.D.schianto, H = asc.H;
    for (let k = 0; k < n; k++) {
      const s = this._s(), d = dir || (k & 1 ? 1 : -1);
      asc.volo(x + (h01(s + 1) - 0.5) * 4, q - 2, d * (D.polvere_vx_H_s[0] + h01(s + 2) * (D.polvere_vx_H_s[1] - D.polvere_vx_H_s[0])) * H,
        -(D.polvere_vy_H_s[0] + h01(s + 3) * (D.polvere_vy_H_s[1] - D.polvere_vy_H_s[0])) * H, this.mPolvere, this.tZolla,
        D.polvere_vita_s[0] + h01(s + 4) * (D.polvere_vita_s[1] - D.polvere_vita_s[0]), s);
      this.conta.volo++;
    }
  }
  /** Una cella del fronte d'onda: polvere che salta, un detrito ogni tanto, crepe, la cresta in caratteri (variante ascii). */
  ondaCella(x, q, dir, forza, passo, N, ascii) {
    const asc = this.asc, D = this.D.schianto, kf = D.forza[forza] ?? 1, H = asc.H;
    this._polvere(x, q, dir, Math.max(1, Math.round(D.polvere * kf)));
    if (passo % D.detriti_ogni === 0) {
      const s = this._s();
      asc.volo(x, q - 2, dir * D.detrito_vx_H_s[0] * H, -D.detrito_vy_H_s[0] * H * (0.7 + 0.3 * h01(s)), this.mPolvere, this.tDetrito, D.detrito_vita_s, s);
      this.conta.volo++;
    }
    if (passo % D.crepa_ogni === 0) this.segno('crepa', x, q - 2, h01(this._s()) < 0.5 ? this.g.und : dir > 0 ? this.g.bs : this.g.sl);
    if (ascii) this.segno('cresta', x, q - 3);
  }
  _avviaCorsa(tipo, x, y, dir, L, dur, forza, N, ascii, hx = 0, hy = 0) {
    const c = this.corse[this.iCorsa]; this.iCorsa = (this.iCorsa + 1) % this.corse.length;
    c.on = true; c.tipo = tipo; c.x0 = x; c.y = y; c.dir = dir < 0 ? -1 : 1; c.L = Math.max(0, L); c.dur = Math.max(0.03, dur); c.t = 0; c.forza = forza;
    c.passi = 0; c.hx = hx; c.hy = hy; c.ascii = ascii; c.sc = N.sc; c.N = N; c.fine = false;
    return c;
  }
  _corsa(c, dt) {
    const asc = this.asc, p = c.tipo === CORSA.ONDA ? this.D.onda_passo_px : c.tipo === CORSA.FILO ? this.D.filo.passo_px : this.D.catena.passo_px;
    c.t += dt > 0 ? Math.min(dt, 0.1) : 0;
    const fin = Math.min(c.L, c.L * c.t / c.dur), giaFatti = c.passi;
    for (let k = giaFatti + 1; k * p <= fin && !c.fine; k++) {
      const x = c.x0 + c.dir * k * p, q = this.quota(x, c.y - 3);
      c.passi = k;
      // muro davanti o vuoto sotto (bordo della piattaforma): la corsa finisce lì
      if (asc.solido(x + c.dir * 2, c.y - 4)) { this._finisceAlMuro(c.tipo === CORSA.ONDA, c.dir, c.sc, x, c.y); c.fine = true; break; }
      if (!Number.isFinite(q) || Math.abs(q - c.y) > 6) { c.fine = true; break; }
      c.y = q;
      if (c.tipo === CORSA.ONDA) this.ondaCella(x, q, c.dir, c.forza, k, c.N, c.ascii);
      else this.strisciaCella(x, q, c.dir, k, c.N, c.tipo === CORSA.FILO);
    }
    // variante ascii di catena e filo: la corda dalla mano alla testa finché corre
    if (c.ascii && c.tipo !== CORSA.ONDA && !c.fine) this.corda(c.hx, c.hy, c.x0 + c.dir * fin, c.y - 2, c.tipo === CORSA.FILO, c.N);
    if (c.t >= c.dur || c.fine) c.on = false;
  }
  _finisceAlMuro(onda, dir, sc, x, y) {
    const C = onda ? this.D.schianto.muro : this.D.catena.muro;
    this.segno('lampo', x, y - 4);
    this.scintille(x, y - 4, -dir, -0.6, C.scintille, C.v_H_s, 90, C.vita_s, sc);
    if (onda) this._polvere(x, y, -dir, C.polvere);
  }

  // ------------------------------------------------------------------------------------------------ C. raggio
  /**
   * Un raggio acceso o in preavviso (per fotogramma). id: chi spara (per ricordare la cella bruciata); (x, y) origine,
   * (ux, uy) direzione, len fino al primo solido; fase 'mira' | 'fuoco'; tMs: ms dall'inizio (pulsa come nel sito);
   * mira: frazione 0..1 del preavviso (negli ultimi fisso la linea è piena).
   */
  raggio(id, x, y, ux, uy, len, fase, tMs, mira = 0, ascii = this.ascii('raggio')) {
    if (this.spento || !(len > 0)) return;
    const R = this.D.raggio;
    if (ascii) this._raggioCaratteri(x, y, ux, uy, len, fase, tMs, mira);
    else this._nucleo(fase === 'mira' ? NUCLEO.MIRA : NUCLEO.RAGGIO, x, y, ux, uy, len, fase === 'mira' ? mira : tMs);
    if (fase !== 'fuoco') return;
    // contatto: scintille a cadenza, una cella bruciata per ogni cella nuova, un filo di fumo
    const S = this._slotRaggio(id), asc = this.asc, ex = x + ux * len, ey = y + uy * len;
    let nx = -ux, ny = -uy;
    if (asc.solido(ex, ey + 2) && !asc.solido(ex, ey - 3)) { nx = 0; ny = -1; } else if (asc.solido(ex + Math.sign(ux) * 2, ey)) { nx = -Math.sign(ux); ny = 0; }
    const px = ex + nx * 1.5, py = ey + ny * 1.5;
    const Tr = R.terra?.attivo ? R.terra : null;   // (SPA1) contatto più presente
    if (this.t - S.ts >= R.scintille_ogni_s || S.ts < 0) {
      S.ts = this.t; this.scintille(px, py, nx, ny, R.scintille, R.v_H_s, R.apertura_gradi, R.vita_s, this.ID.materie.scintilla_raggio);
      if (Tr) this.scintille(px, py, nx, ny, Tr.scintille_piu, R.v_H_s, R.apertura_gradi, R.vita_s, this.ID.materie.scintilla_raggio, this.tRimbSc);
    }
    const cel = ((ex / asc.cw) | 0) * 4096 + ((ey / asc.ch) | 0);
    if (cel !== S.cella) { S.cella = cel; if (Tr) this._bruciaTratto(S, ex + nx * 2, ey + ny * 2.5, Tr); else this.segno('bruciato', ex + nx * 2, ey + ny * 2.5); }
    const fo = Tr ? Tr.fumo_ogni_s : R.fumo_ogni_s, fc = Tr ? Tr.fumo_celle : 1;
    if (this.t - S.tf >= fo || S.tf < 0) { S.tf = this.t; asc.cella(px + nx * 3, py + ny * 4 - 2, this.mFumo, fc); this.conta.celle += fc; }
    if (Tr?.stacca && (this.t - S.tl >= Tr.stacca.ogni_s || S.tl < 0)) { S.tl = this.t; this._staccaRaggio(x, y, ux, uy, len, Tr.stacca); }
  }
  /** (SPA1) La traccia bruciata dove il raggio tocca: anche le celle saltate dalla spazzata fra due fotogrammi (al più riempi_celle). */
  _bruciaTratto(S, x, y, Tr) {
    const ax = S.bx, ay = S.by, d = Math.hypot(x - ax, y - ay);
    S.bx = x; S.by = y;
    // salto da una superficie all'altra (pavimento → piattaforma) o troppo lungo: niente riga in mezzo all'aria
    if (!(d === d) || d > 2 * Tr.riempi_celle * this.asc.cw || Math.abs(y - ay) > 2 * this.asc.ch || d < this.asc.cw) { this.segno(Tr.segno, x, y); return; }
    const n = Math.min(Tr.riempi_celle, Math.ceil(d / this.asc.cw));
    for (let k = 1; k <= n; k++) this.segno(Tr.segno, ax + (x - ax) * k / n, ay + (y - ay) * k / n);
  }
  /** (SPA1) Una lettera che si stacca dal raggio: di lato rispetto al filo (mai sopra), si allontana e si spegne. */
  _staccaRaggio(x, y, ux, uy, len, St) {
    const asc = this.asc, s = this._s(), lato = s & 2 ? 1 : -1, d = len * (St.da + (St.a - St.da) * h01(s + 1)), nx = -uy * lato, ny = ux * lato;
    const v = (St.v_H_s[0] + (St.v_H_s[1] - St.v_H_s[0]) * h01(s + 2)) * asc.H;
    asc.volo(x + ux * d + nx * St.scarto_px, y + uy * d + ny * St.scarto_px, nx * v + ux * v * 0.3, ny * v + uy * v * 0.3, this.ID.materie.scintilla_raggio, this.tStacco,
      St.vita_s[0] + (St.vita_s[1] - St.vita_s[0]) * h01(s + 3), s);
    this.conta.volo++;
  }
  _slotRaggio(id) {
    let best = this.raggi[0];
    for (const S of this.raggi) { if (S.id === id) { S.t = this.t; return S; } if (S.t < best.t) best = S; }
    best.id = id; best.cella = -1; best.ts = -1; best.tf = -1; best.t = this.t; best.tl = -1; best.bx = NaN; best.by = NaN;   // (SPA1) tl, bx, by
    return best;
  }
  _raggioCaratteri(x, y, ux, uy, len, fase, tMs, mira) {
    const asc = this.asc, R = this.D.raggio, A = R.ascii, P = R.pixel, p = R.passo_px, c = (i) => asc.colore('raggio', i);
    if (fase === 'mira') {
      const fissa = mira >= 1, gl = fissa ? this.glifoDir(ux, uy) : this.g.pun, st = fissa ? p : P.tratto[1];
      for (let d = 3; d < len; d += st) asc.timbro(gl, c(fissa ? 1 : 2), x + ux * d, y + uy * d, 1);
      return;
    }
    const gl = this.glifoDir(ux, uy), w = Math.sin(tMs / P.pulsa_ms) > 0.2 ? 1 : 0, nx = -uy, ny = ux;
    for (let d = 0, k = 0; d < len; d += p, k++) {
      const X = x + ux * d, Y = y + uy * d;
      asc.timbro(gl, c(A.nucleo[(k + w) & 1]), X, Y, 1);
      if (w && (k & 1)) asc.timbro(this.g.pun, c(A.bordo), X + nx * 2 * ((k & 2) ? 1 : -1), Y + ny * 2 * ((k & 2) ? 1 : -1), 1);
    }
    asc.timbro(this.g.ast, c(0), x + ux * len, y + uy * len, 1);
  }

  // ------------------------------------------------------------------------------------------------ D. catena e filo
  /** Catena o filo che striscia sul pavimento da x per L px in dur s; (hx, hy) la mano (corda in caratteri, variante ascii). */
  catena(x, y, dir, L, dur, filo = false, N = null, hx = x, hy = y, ascii = this.ascii(filo ? 'filo' : 'catena')) {
    if (this.spento) return;
    const q = this.quota(x, y - 2);
    if (!Number.isFinite(q)) return;
    this._avviaCorsa(filo ? CORSA.FILO : CORSA.CATENA, x, q, dir, L, dur, 1, N || this.nemico(filo ? 'z24-e09' : ''), ascii, hx, hy);
  }
  /** Una cella della strisciata: scintille basse lungo la superficie e un graffio (catena) o un punto di cucitura (filo). */
  strisciaCella(x, q, dir, passo, N, filo) {
    const asc = this.asc, C = this.D.catena, H = asc.H;
    if (filo) { if ((passo * this.D.filo.passo_px) % this.D.filo.cucitura_ogni_px < this.D.filo.passo_px) this.segno('cucitura', x, q - 2); return; }
    for (let k = 0; k < C.scintille; k++) {
      const s = this._s();
      asc.volo(x, q - 1.5, dir * (C.v_H_s[0] + h01(s) * (C.v_H_s[1] - C.v_H_s[0])) * H, -(C.vy_H_s[0] + h01(s + 1) * (C.vy_H_s[1] - C.vy_H_s[0])) * H,
        N.sc, this.tScint, C.vita_s[0] + h01(s + 2) * (C.vita_s[1] - C.vita_s[0]), s);
      this.conta.volo++;
    }
    if (passo % C.graffio_ogni === 0) this.segno('graffio', x, q - 2, this.g.meno);
  }
  /** Corda in caratteri dalla mano (x0, y0) alla testa (x1, y1): catena = anelli o e trattini con la pancia, filo = teso che vibra. */
  corda(x0, y0, x1, y1, filo, N) {
    const asc = this.asc, dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
    if (L < 2) return;
    const C = this.D.catena, F = this.D.filo, p = filo ? F.passo_px : C.anello_px, n = Math.min(60, Math.ceil(L / p)), ux = dx / L, uy = dy / L;
    const colF = filo ? null : N.col, tav = filo ? 'filo' : null;
    for (let k = 1; k < n; k++) {
      const u = k / n, pancia = filo ? Math.sin(this.t * F.vibra_hz * 2 * Math.PI + k) * F.vibra_px * (k & 1 ? 1 : -1) : C.pancia * L * 4 * u * (1 - u);
      const X = x0 + dx * u, Y = y0 + dy * u + pancia;
      if (filo) asc.timbro(this.glifoDir(ux, uy), asc.colore(tav, F.colori[k % F.colori.length]), X, Y, 1);
      else asc.timbro(k & 1 ? this.g.o : this.glifoDir(ux, uy + C.pancia * 4 * (1 - 2 * u)), colF[k & 1 ? 2 : 3], X, Y, 1);
    }
  }

  // ------------------------------------------------------------------------------------------------ E. cera
  /** Grumo di cera in volo (per fotogramma): mista = sfera a pixel, ascii = @ con la scia o . */
  grumo(x, y, vx, vy, ascii = this.ascii('cera')) {
    if (this.spento) return;
    if (!ascii) { this._nucleo(NUCLEO.GRUMO, x, y, vx, vy, 0, 0); return; }
    const asc = this.asc, c = (i) => asc.colore('ambra', i), S = this.D.cera.grumo.scia;
    asc.timbro(asc.glifo('@'), c(1), x, y, 1);
    for (let k = 1; k <= S; k++) asc.timbro(k === 1 ? this.g.o : this.g.pun, c(2 + k), x - vx * 0.022 * k, y - vy * 0.022 * k, 1);
  }
  /** Il grumo tocca: sul pavimento le gocce saltano e scorrono, sul muro restano aderenti e colano; poi si rapprende. */
  cera(x, y, vx, vy, forza = 1) {
    if (this.spento) return;
    const asc = this.asc, C = this.D.cera, H = asc.H, sv = vx < 0 ? -1 : 1, v0 = Math.hypot(vx, vy) || 1;
    for (let q = 0; q < 8 && asc.solido(x, y); q++) { x -= vx / v0; y -= vy / v0; }   // dal punto dentro il solido all'ultimo libero
    const muro = asc.solido(x + sv * 3, y - 1) && !asc.solido(x, y + 3);
    const n = Math.round(C.gocce * forza);
    this.segno('lampo', x, y);
    if (muro) {
      for (let k = 0; k < n; k++) {
        const s = this._s(), v = (C.v_H_s[0] + h01(s) * (C.v_H_s[1] - C.v_H_s[0])) * H;
        asc.volo(x - sv * 2, y + (k - n / 2) * asc.ch, sv * v * C.muro_k, -v * 0.4 * h01(s + 1), this.mCera, this.tGoccia, C.vita_s, s);
      }
    } else {
      const q = this.quota(x, y - 2);
      if (!Number.isFinite(q)) return;
      const a0 = -Math.PI / 2 + (vx > 0 ? 0.25 : vx < 0 ? -0.25 : 0), ap = C.apertura_gradi * RAD;
      for (let k = 0; k < n; k++) {
        const s = this._s(), a = a0 + ap * ((n > 1 ? k / (n - 1) : 0.5) - 0.5), v = (C.v_H_s[0] + h01(s) * (C.v_H_s[1] - C.v_H_s[0])) * H;
        asc.volo(x, q - 3, Math.cos(a) * v, Math.sin(a) * v, this.mCera, this.tGoccia, C.vita_s, s);
      }
      asc.cella(x, q - 3, this.mCera, Math.round(C.celle * forza));
      asc.cella(x, q - 9, this.mFumo, C.fumo);
      this.conta.celle += Math.round(C.celle * forza) + C.fumo;
    }
    this.conta.volo += n;
  }

  // ------------------------------------------------------------------------------------------------ F. ago
  /** Ago in volo (per fotogramma): ascii = carattere orientato col moto e due punti di scia; mista = tratto a pixel. */
  ago(x, y, vx, vy, N = null, ascii = this.ascii('ago')) {
    if (this.spento) return;
    if (!ascii) { this._nucleo(NUCLEO.AGO, x, y, vx, vy, 0, 0); return; }
    const asc = this.asc, v = Math.hypot(vx, vy) || 1, ux = vx / v, uy = vy / v, col = (N || this.nemico('z24-mb03')).col;
    asc.timbro(this.glifoDir(ux, uy), col[0], x, y, 1);
    for (let k = 1; k <= this.D.ago.scia; k++) asc.timbro(this.g.pun, col[1 + k], x - ux * 3.5 * k, y - uy * 3.5 * k, 1);
  }
  /** L'ago tocca: sul muro resta piantato e schegge; sul pavimento rimbalza basso e lascia un graffio. */
  agoTocca(x, y, vx, vy, N = null) {
    if (this.spento) return;
    const asc = this.asc, A = this.D.ago, v = Math.hypot(vx, vy) || 1, ux = vx / v, uy = vy / v, sv = vx < 0 ? -1 : 1;
    for (let q = 0; q < 8 && asc.solido(x, y); q++) { x -= ux; y -= uy; }
    N = N || this.nemico('z24-mb03');
    if (asc.solido(x + sv * 3, y) && !asc.solido(x, y + 3)) {
      let X = x; for (let q = 0; q < 6 && asc.solido(X, y); q++) X -= sv;
      this.segno('piantato', X - sv * 1.5, y, this.glifoDir(ux, uy));
      this.scintille(X - sv, y, -sv, -0.3, A.muro.schegge, A.muro.v_H_s, 80, A.muro.vita_s, N.sc);
    } else {
      const q = this.quota(x, y - 2);
      if (!Number.isFinite(q)) return;
      asc.volo(x, q - 2, vx * A.terra.k, -Math.abs(vy) * A.terra.k - 0.6 * asc.H, N.sc, this.tRimb, A.terra.vita_s, this._s());
      this.segno('graffio', x, q - 2, this.g.meno);
      this.conta.volo++;
    }
  }

  // ------------------------------------------------------------------------------------------------ G. spari (SPA1)
  // Proiettili in lettere: corpo in volo (nucleo di lettere pesanti della materia, coda di tratti orientati lungo la strada
  // fatta, materia che si stacca con la fisica), scoppio secondo la materia (cera che cola, sasso che si sbriciola, brace che
  // sprizza e brucia, ago che si pianta), e la pistola del protagonista «un po'» (scia corta, bocca, urto). Dati: spari.*.
  _iniziaSpari(D) {
    const asc = this.asc, ID = this.ID, SP = D.spari;
    this.tRimbSc = ID.tipi.scintilla_rimbalzo ?? this.tScint; this.tStacco = ID.tipi.stacco ?? this.tScint;
    this.mBrace = ID.materie.scintilla_brace ?? ID.materie.scintilla;
    this.SP = null; this.PI = null; this.nPerse = 0; this.nTimbriSp = 0;
    if (!SP) return;
    this.SP = Object.create(null);
    const gl = (s) => Uint8Array.from([...s].map((c) => asc.glifo(c)));
    for (const [nome, Q] of Object.entries(SP)) {
      if (nome[0] === '_' || !Q || typeof Q !== 'object' || !Q.coda_px) continue;
      const tav = Q.tavolozza, col = (i) => (tav ? asc.colore(tav, i) : i);   // senza tavolozza: indici in N.col del nemico
      const P = Q.perde;
      this.SP[nome] = {
        Q, tav: !!tav, lettere: gl(Q.lettere || '*'), nucleo: (Q.nucleo || [[0, 0, 0, 0]]).map((r) => Int8Array.from(r)),
        cn: Uint16Array.from(Q.colori.map(col)), cc: Uint16Array.from(Q.coda_colori.map(col)), leggeri: gl(Q.leggeri || '.'),
        punta: Q.punta ? asc.glifo(Q.punta) : 0, puntaL: Q.punta === '>' ? asc.glifo('<') : Q.punta ? asc.glifo(Q.punta) : 0,
        pm: P ? (P.materia ? ID.materie[P.materia] ?? -1 : -1) : 0, pt: P ? ID.tipi[P.tipo] ?? asc.tipoId?.[P.tipo] ?? this.tStacco : 0,
        costo: (Q.ago_celle || (Q.nucleo || [0]).length) + Math.ceil(Q.coda_px / Q.passo_px),
      };
    }
    const Pi = SP.pistola;
    if (Pi) this.PI = { Q: Pi, mat: ID.materie[Pi.materia] ?? ID.materie.scintilla, tipo: ID.tipi[Pi.tipo] ?? this.tScint, g: gl(Pi.scia.glifi), c: Uint16Array.from(Pi.scia.colori.map((i) => asc.colore(Pi.tavolozza, i))), dono: gl(Pi.dono?.lettere || '*'), bianco: asc.colore('scintille', 0) };
  }
  /** Inizio del fotogramma degli spari: azzera i conti (perdite, timbri); n = spari in lettere in volo → qualità 0..1 per il tetto. */
  inizioSpari(n = 0, tipo = 'cera') {
    this.nPerse = 0; this.nTimbriSp = 0;
    const S = this.SP?.[tipo];
    return S && n > 0 ? Math.min(1, this.D.spari.tetto_timbri / (n * S.costo)) : 1;
  }
  /**
   * Corpo in volo di uno sparo, per fotogramma. tipo: chiave di spari.* ('cera' | 'sasso' | 'brace' | 'bomba' | 'ago' | 'dardo');
   * (x, y) px di mondo, (vx, vy) px/s; r raggio px; scia: [x0, y0, x1, y1, …] posizioni dei fotogrammi prima, dal più vecchio (o
   * null: coda dritta); N = nemico() (tavolozza dell'ago); q 0..1 qualità (tetto); A: l'oggetto del proiettile (accumulatore
   * delle perdite in A._ascAcc); dt per le perdite; bianco: rimandato dal protagonista (testa bianca). → timbri messi in coda.
   */
  corpoSparo(tipo, x, y, vx, vy, r, scia = null, N = null, q = 1, A = null, dt = 0, bianco = false) {
    const S = this.SP?.[tipo];
    if (this.spento || !S || !Number.isFinite(x) || !Number.isFinite(y)) return 0;
    const asc = this.asc, Q = S.Q, v = Math.hypot(vx, vy), ux = v > 1e-6 ? vx / v : 1, uy = v > 1e-6 ? vy / v : 0;
    const col = S.tav ? (c) => c : (c) => (N ? N.col[Math.min(5, c)] : this.nemico('').col[Math.min(5, c)]);
    let n = 0;
    // nucleo: lettere pesanti della materia; davanti la più chiara; nei liquidi e nel fuoco le lettere si scambiano (trema)
    if (Q.ago_celle) {
      const m = Math.max(1, Math.round(Q.ago_celle * Math.max(0.5, q))), g = this.glifoDir(ux, uy);
      const st = 1 / Math.max(Math.abs(ux) / asc.cw, Math.abs(uy) / asc.ch, 1e-3);   // una cella per lettera lungo il moto
      for (let k = 0; k < m; k++) {
        const gk = k === 0 && S.punta && Math.abs(ux) > 0.85 ? (ux < 0 ? S.puntaL : S.punta) : g;   // la punta solo quasi in orizzontale
        if (asc.timbro(gk, k === 0 && bianco ? this.PI?.bianco ?? col(S.cn[0]) : col(S.cn[Math.min(S.cn.length - 1, k)]), x - ux * st * k, y - uy * st * k, 1)) n++;
      }
    } else {
      const fr = vx < 0 ? -1 : 1, L = S.lettere.length, w = Q.ondeggia_hz ? (this.t * Q.ondeggia_hz) | 0 : 0;
      const nm = Math.max(Math.min(this.D.spari.nucleo_min, S.nucleo.length), Math.round(S.nucleo.length * Math.min(1, r / (this.D.spari.raggio_pieno_H * asc.H)) * Math.min(1, q * 1.4)));
      for (let k = 0; k < nm && k < S.nucleo.length; k++) {
        const c = S.nucleo[k], gk = S.lettere[(c[2] + (k ? w + k : 0)) % L];
        if (asc.timbro(gk, k === 0 && bianco ? this.PI?.bianco ?? col(S.cn[0]) : col(S.cn[Math.min(S.cn.length - 1, c[3])]), x + fr * c[0] * asc.cw, y + c[1] * asc.ch, 1)) n++;
      }
    }
    // coda: dalla testa all'indietro lungo la strada fatta (scia), poi dritta; tratti orientati, poi punti, colori che si spengono
    const coda = Q.coda_px * (0.5 + 0.5 * q), passo = Q.passo_px, s0 = Q.ago_celle ? Q.ago_celle * 2 : Math.max(asc.cw * 1.5, r * 0.45);
    let ax = x, ay = y, s = 0, j = scia ? scia.length - 2 : -1, prossimo = s0;
    for (let giro = 0; giro < 8 && prossimo <= s0 + coda; giro++) {
      const dritta = j < 0, bx = dritta ? ax - ux * (coda + s0) : scia[j], by = dritta ? ay - uy * (coda + s0) : scia[j + 1];
      j -= 2;
      const Ls = Math.hypot(bx - ax, by - ay);
      if (Ls < 0.5) { if (dritta) break; continue; }
      const sx = (bx - ax) / Ls, sy = (by - ay) / Ls, gd = this.glifoDir(-sx, -sy);
      for (; prossimo <= s + Ls && prossimo <= s0 + coda; prossimo += passo) {
        const f = (prossimo - s0) / Math.max(1, coda), d = prossimo - s;
        const g = f < Q.tratti ? gd : S.leggeri[Math.min(S.leggeri.length - 1, ((f - Q.tratti) / Math.max(1e-3, 1 - Q.tratti) * S.leggeri.length) | 0)];
        if (asc.timbro(g, col(S.cc[Math.min(S.cc.length - 1, (f * S.cc.length) | 0)]), ax + sx * d, ay + sy * d, 1)) n++;
      }
      s += Ls; ax = bx; ay = by;
      if (dritta) break;
    }
    // materia che si stacca (gocce che cadono e colano a terra, polvere, scintille): con la fisica del motore
    if (S.pm && Q.perde_s > 0 && A && dt > 0 && q >= 0.5) {
      A._ascAcc = (A._ascAcc || 0) + Q.perde_s * Math.min(dt, 0.1);
      while (A._ascAcc >= 1 && this.nPerse < this.D.spari.perdite_fotogramma) { A._ascAcc -= 1; this._perdi(S, x, y, vx, vy, ux, uy, r, N); }
      if (A._ascAcc > 2) A._ascAcc = 0;
    }
    this.nTimbriSp += n;
    return n;
  }
  _perdi(S, x, y, vx, vy, ux, uy, r, N) {
    const P = S.Q.perde, asc = this.asc, s = this._s(), a = h01(s + 1) * 2 * Math.PI, vv = (P.v_H_s[0] + (P.v_H_s[1] - P.v_H_s[0]) * h01(s + 2)) * asc.H;
    const mat = S.pm > 0 ? S.pm : N?.sc ?? this.ID.materie.scintilla;
    asc.volo(x - ux * r * 0.5 + (h01(s + 4) - 0.5) * r * 0.6, y - uy * r * 0.5 + (h01(s + 5) - 0.5) * r * 0.6, vx * P.trascina + Math.cos(a) * vv, vy * P.trascina + Math.sin(a) * vv,
      mat, S.pt, P.vita_s[0] + (P.vita_s[1] - P.vita_s[0]) * h01(s + 3), s);
    this.nPerse++; this.conta.volo++;
  }
  /** Lo sparo tocca (o si rompe sulla spada): lo scoppio secondo la materia (spari.<tipo>.scoppio), forza dai dati se null. */
  scoppioSparo(tipo, x, y, vx, vy, N = null, forza = null) {
    const S = this.SP?.[tipo];
    if (this.spento || !S || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const f = forza ?? S.Q.forza ?? 1, asc = this.asc, v = Math.hypot(vx, vy) || 1, ux = vx / v, uy = vy / v;
    const vicino = asc.solido(x + ux * 4, y + uy * 4) || asc.solido(x, y + 4) || asc.solido(x + 3, y) || asc.solido(x - 3, y) || asc.solido(x, y);
    switch (S.Q.scoppio) {
      case 'cera': if (vicino) this.cera(x, y, vx, vy, f); else this._sprazzo(x, y, vx, vy, this.mCera, this.tGoccia, Math.round(this.D.cera.gocce * f * 0.6), [0.6, 1.6], [0.5, 0.9]); break;
      case 'ago': if (vicino) this.agoTocca(x, y, vx, vy, N); else this.scintille(x, y, -ux, -uy, 3, [0.8, 1.8], 160, [0.1, 0.2], (N || this.nemico('')).sc); break;
      case 'sasso': this._scoppioSasso(x, y, vx, vy, f, vicino); break;
      case 'brace': this._scoppioBrace(x, y, vx, vy, f, vicino); break;
    }
  }
  /** Spruzzo in aria (lo sparo rotto dalla spada): n caratteri della materia tutt'attorno, con un po' del moto di prima. */
  _sprazzo(x, y, vx, vy, mat, tipo, n, v, vita) {
    const asc = this.asc;
    for (let k = 0; k < n; k++) {
      const s = this._s(), a = (k / Math.max(1, n) + 0.3 * h01(s)) * 2 * Math.PI, vv = (v[0] + (v[1] - v[0]) * h01(s + 1)) * asc.H;
      asc.volo(x, y, Math.cos(a) * vv + vx * 0.15, Math.sin(a) * vv - 0.4 * asc.H + vy * 0.15, mat, tipo, vita[0] + (vita[1] - vita[0]) * h01(s + 2), s);
    }
    this.conta.volo += n;
  }
  _scoppioSasso(x, y, vx, vy, f, vicino) {
    const asc = this.asc, H = asc.H, D = this.D.spari.scoppi.sasso, v0 = Math.hypot(vx, vy) || 1;
    for (let q = 0; q < 8 && asc.solido(x, y); q++) { x -= vx / v0; y -= vy / v0; }
    const q = vicino ? this.quota(x, y - 2) : NaN, terra = Number.isFinite(q) && Math.abs(q - y) < 8, y0 = terra ? q - 2 : y, sv = vx < 0 ? -1 : 1;
    const nd = Math.round(D.detriti * f), nz = Math.round(D.zolle * f);
    for (let k = 0; k < nd + nz; k++) {
      const s = this._s(), lato = k & 1 ? 1 : -1, det = k < nd;
      const ax = (D.v_H_s[0] + (D.v_H_s[1] - D.v_H_s[0]) * h01(s + 1)) * H * (det ? 1 : 0.6), ay = (D.su_H_s[0] + (D.su_H_s[1] - D.su_H_s[0]) * h01(s + 2)) * H * (det ? 1 : 0.7);
      asc.volo(x + (h01(s + 3) - 0.5) * 4, y0, lato * ax + sv * 0.2 * H, terra ? -ay : (h01(s + 4) - 0.6) * ay, this.mPolvere, det ? this.tDetrito : this.tZolla, D.vita_s[0] + (D.vita_s[1] - D.vita_s[0]) * h01(s + 5), s);
    }
    this.conta.volo += nd + nz;
    if (terra) {
      asc.cella(x, q - 2, this.mPolvere, Math.round(D.celle * f)); this.conta.celle += Math.round(D.celle * f);
      if (D.crepa) { this.segno('crepa', x, q - 2, this.g.und); this.segno('crepa', x + 2 * sv, q - 2, sv > 0 ? this.g.bs : this.g.sl); }
    }
  }
  _scoppioBrace(x, y, vx, vy, f, vicino) {
    const asc = this.asc, H = asc.H, D = this.D.spari.scoppi.brace, v0 = Math.hypot(vx, vy) || 1, ux = vx / v0, uy = vy / v0;
    for (let q = 0; q < 8 && asc.solido(x, y); q++) { x -= ux; y -= uy; }
    let nx = -ux, ny = -uy;
    if (asc.solido(x, y + 3) && !asc.solido(x, y - 3)) { nx = 0; ny = -1; } else if (asc.solido(x + Math.sign(ux || 1) * 3, y)) { nx = -Math.sign(ux || 1); ny = 0; }
    this.segno('lampo', x, y);
    this.scintille(x + nx, y + ny, nx, ny, Math.round(D.scintille * f), D.v_H_s, D.apertura_gradi, D.vita_s, this.mBrace, this.tRimbSc);
    if (vicino) {
      const ns = Math.round(D.segni * f), tx = -ny, ty = nx;
      for (let k = 0; k < ns; k++) { const o = (k - (ns - 1) / 2) * asc.cw * 1.3; this.segno('brucia_sparo', x + tx * o - nx, y + ty * o - ny); }
    }
    asc.cella(x + nx * 3, y + ny * 4 - 2, this.mFumo, Math.round(D.fumo * f)); this.conta.celle += Math.round(D.fumo * f);
    for (let k = 0; k < Math.round(D.stacchi * f); k++) {   // braci che salgono piano
      const s = this._s();
      asc.volo(x + (h01(s) - 0.5) * 6, y - 2, (h01(s + 1) - 0.5) * 0.6 * H, -(0.5 + 0.7 * h01(s + 2)) * H, this.mBrace, this.tStacco, 0.4 + 0.4 * h01(s + 3), s);
    }
    this.conta.volo += Math.round(D.stacchi * f);
  }
  /** Il protagonista rimanda lo sparo: un ventaglio di scintille nel verso nuovo (lo sparo resta in lettere). */
  rimandoSparo(x, y, dir) {
    const R = this.D.spari?.scoppi?.rimando;
    if (this.spento || !R || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.segno('lampo', x, y);
    this.scintille(x, y, dir < 0 ? -1 : 1, -0.2, R.scintille, R.v_H_s, 70, R.vita_s, this.ID.materie.scintilla);
  }
  /** Pistola: scia corta di lettere dietro al proiettile a pixel (che resta), qualche scintilla che si stacca; tav = colpo di un dono. */
  pistolaScia(x, y, ux, uy, A = null, dt = 0, tav = null) {
    const P = this.PI;
    if (this.spento || !P || !Number.isFinite(x) || !Number.isFinite(y)) return 0;
    const Q = P.Q.scia, asc = this.asc;
    let n = 0;
    for (let k = 0; k < Q.n; k++) {
      const d = Q.da_px + k * Q.passo_px, g = P.g[Math.min(P.g.length - 1, k)] === P.g[0] ? this.glifoDir(ux, uy) : P.g[Math.min(P.g.length - 1, k)];   // i tratti seguono il moto
      if (asc.timbro(g, tav ? asc.colore(tav, k + 1) : P.c[Math.min(P.c.length - 1, k)], x - ux * d, y - uy * d, 1)) n++;
    }
    if (tav && asc.timbro(P.dono[0], asc.colore(tav, P.Q.dono?.colore ?? 1), x + ux * asc.cw, y + uy * asc.cw, 1)) n++;   // dono: la testa in lettere nel colore dell'elemento
    if (A && dt > 0 && Q.perde_s > 0) {
      A._ascAcc = (A._ascAcc || 0) + Q.perde_s * Math.min(dt, 0.1);
      if (A._ascAcc >= 1 && this.nPerse < this.D.spari.perdite_fotogramma) { A._ascAcc -= 1; this.nPerse++; this.scintille(x - ux * Q.da_px, y - uy * Q.da_px, -ux, -uy + 0.4, 1, Q.v_H_s, 70, Q.vita_s, P.mat, this.tStacco); }
      if (A._ascAcc > 2) A._ascAcc = 0;
    }
    this.nTimbriSp += n;
    return n;
  }
  /** Pistola: lampo alla bocca con poche lettere, tre scintille in avanti, un filo di fumo. */
  pistolaBocca(x, y, ux, uy) {
    const P = this.PI;
    if (this.spento || !P || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(ux) || !Number.isFinite(uy)) return;
    const B = P.Q.bocca;
    this.segno('bocca', x + ux * 2, y + uy * 2);
    this.scintille(x + ux * 3, y + uy * 3, ux, uy, B.scintille, B.v_H_s, B.apertura_gradi, B.vita_s, P.mat);
    if (B.fumo) { this.asc.cella(x + ux * 4, y + uy * 4 - 2, this.mFumo, B.fumo); this.conta.celle += B.fumo; }
  }
  /** Pistola: il colpo tocca muro (dir verso del colpo) o pavimento (terra): scintille che rimbalzano, segno, un po' di polvere. */
  pistolaUrto(x, y, dir, terra) {
    const P = this.PI;
    if (this.spento || !P || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const U = P.Q.urto, asc = this.asc, d = dir < 0 ? -1 : 1, nx = terra ? 0 : -d, ny = terra ? -1 : 0;
    for (let q = 0; q < 6 && asc.solido(x, y); q++) { x += nx; y += ny; }
    this.scintille(x, y, nx, ny - (terra ? 0 : 0.4), U.scintille, U.v_H_s, U.apertura_gradi, U.vita_s, P.mat, P.tipo);
    this.segno(U.segno, x - nx, y - ny);
    if (U.zolle) this._polvere(x, y + (terra ? 0 : 2), terra ? 0 : -d, U.zolle);
  }
  /** Pistola: il colpo prende un nemico: due scintille nel verso del colpo (gli effetti di oggi restano). */
  pistolaNemico(x, y, dir) {
    const P = this.PI;
    if (this.spento || !P || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const U = P.Q.nemico;
    this.scintille(x, y, dir < 0 ? -1 : 1, -0.2, U.scintille, U.v_H_s, U.apertura_gradi, U.vita_s, P.mat);
  }

  // ------------------------------------------------------------------------------------------------ eventi e osservazione
  /** Traduce un evento di g.fx (dati → eventi). */
  nota(e, g = null) {
    if (this.spento || !e?.tipo) return false;
    const V = this.D.eventi[e.tipo];
    if (!V || typeof V !== 'object' || !V.famiglia) return false;
    const H = this.asc.H, x = Number.isFinite(e.x) ? e.x : 0, y = Number.isFinite(e.suolo) ? e.suolo : Number.isFinite(e.y) ? e.y : 0, dir = Math.sign(e.dir || e.verso || 0) || 1;
    const L = Number.isFinite(e.lunghezza) ? e.lunghezza : Number.isFinite(e.raggio) ? e.raggio : (V.lunghezza_H ?? 1) * H, N = this.nemico(e.nemico);
    switch (V.famiglia) {
      case 'schianto': this.schianto(x, y, dir, L, V.durata_s, V.forza ?? 1, V.versi ?? 1, N); return true;
      case 'catena': this.catena(x, y, dir, L, V.durata_s, false, N); return true;
      case 'filo': this.catena(x, y, dir, L, V.durata_s, true, N); return true;
      case 'cera': this.cera(x, Number.isFinite(e.y) ? e.y : y, e.vx ?? 0, e.vy ?? 1, V.forza ?? 1); return true;
    }
    return false;
  }
  /**
   * Per fotogramma: raggi dei Bracci (comp.raggio, comp.mira) e delle Lampade (comp.fascio), e i colpi con hitbox in corso
   * (forma dalla hitbox come gli archi di fx_nemici: arco = hitbox), con il contatto col mondo.
   */
  osserva(g) {
    if (this.spento || !g?.bersagli) return;
    const H = this.asc.H;
    for (const b of g.bersagli) {
      const n = b.nem;
      if (!n || b.morto) continue;
      const c = n.comp;
      if (c?.raggio) this.raggio(b.id ?? b, c.raggio.x, c.raggio.y, c.raggio.ux, c.raggio.uy, c.raggio.len, 'fuoco', (n.orologio ?? this.t) * 1000);
      else if (c?.mira && Number.isFinite(c.mira.len)) this.raggio(b.id ?? b, c.mira.x, c.mira.y, c.mira.ux, c.mira.uy, c.mira.len, 'mira', 0, c.mira.fissa ? 1 : 0);
      if (c?.fascio) this.raggio(b.id ?? b, c.fascio.x, c.fascio.y, c.fascio.ux, c.fascio.uy, c.fascio.len, 'fuoco', (n.orologio ?? this.t) * 1000);
      const m = n.mossa;
      if (!m?.hitbox || !n.fase || n.fase === 'avviso') continue;
      this.colpo(b, n, m, tMossa(n), H);
    }
  }
  /** I colpi della mossa m del nemico b al tempo t ms: per ogni hitbox nella sua finestra, la famiglia giusta. */
  colpo(b, n, m, t, H = this.asc.H) {
    const slot = this._slotNemico(b, m), tb = base(n.tipo), N = this.nemico(tb), mb = !!MB_ARCHI?.[tb], face = b.face || 1;
    const X0 = b.x, Y0 = b.y - (b.alto || 0), conf = MB_ARCHI?.[tb]?.mosse?.[n.nomeMossa], forza = mb && MB_ARCHI[tb].pesanti?.includes(n.nomeMossa) ? 2 : (m.danno ?? 0) >= 12 ? 2 : 1;
    for (let k = 0; k < m.hitbox.length && k < 32; k++) {
      const hb = m.hitbox[k];
      if (!hb.rett_H) continue;
      const G = geometriaArco(hb, m, conf?.tipo), S = statoArco(G, finestraArco(hb, m, this._fa), t, MB_ARCHI || {}, this._sa);
      if (!S) continue;
      const fam = this.D.mosse[tb]?.[n.nomeMossa] || FAM_GEO[G.tipo] || 'falce', aF = this.ascii(mb ? 'falce_mb' : 'falce');
      if (S.cu > 0) { if (fam === 'falce' && aF) this._falceCaratteri(G, S, X0, Y0, face, N, forza); continue; }   // coda: si consuma, niente contatti
      if (fam === 'falce') { this.falce(G, S, X0, Y0, face, N, forza, slot, k, aF); continue; }
      // fronti a terra (onda, catena, filo): una cella nuova a ogni passo della testa
      const T = testaArco(G, S, this._ta);
      for (let lato = 0; lato < 2; lato++) {
        const xl = lato ? T[4] : T[0];
        if (!(xl === xl)) continue;
        const d = (lato ? -1 : 1) * face, x = X0 + face * xl * H, q0 = this.quota(x, Y0 + T[1] * H - 3), q = Number.isFinite(q0) && Math.abs(q0 - Y0 - T[1] * H) < 8 ? q0 : Y0 + T[1] * H;   // testa dentro un muro: la riga della hitbox
        const P = this.D.onda_passo_px, kk = (k * 2 + lato) & 31, cel = (x / P) | 0, prima = slot.cel[kk];
        if (prima === cel) continue;
        slot.cel[kk] = cel;
        // tutte le celle fra l'ultima toccata e la testa (a 30 fotogrammi un fronte veloce salta 8–10 celle)
        const da = prima < 0 ? cel : prima + Math.sign(cel - prima), n0 = Math.min(16, Math.abs(cel - da) + 1), sd = Math.sign(cel - da) || 0;
        for (let j = 0; j < n0; j++) {
          const xc = (da + sd * j) * P + P / 2, qc = this.quota(xc, q - 3);
          if (!Number.isFinite(qc) || Math.abs(qc - q) > 6) break;
          if (this.asc.solido(xc + d * 2, qc - 4)) { this._finisceAlMuro(fam === 'schianto', d, N.sc, xc, qc); slot.cel[kk] = cel; break; }
          if (fam === 'schianto') this.ondaCella(xc, qc, d, forza, da + sd * j, N, this.ascii('schianto'));
          else this.strisciaCella(xc, qc, d, da + sd * j, N, fam === 'filo');
        }
      }
      if (fam !== 'schianto' && this.ascii(fam)) {
        const hx = X0 + face * 0.35 * H, hy = Y0 - 1.1 * H;
        this.corda(hx, hy, X0 + face * T[0] * H, Y0 + T[1] * H - 2, fam === 'filo', N);
      }
    }
  }
  _slotNemico(b, m) {
    let best = this.nem[0];
    for (const S of this.nem) {
      if (S.b === b) { if (S.m !== m) { S.m = m; S.cel.fill(-1); S.px.fill(NaN); } S.t = this.t; return S; }
      if (S.t < best.t) best = S;
    }
    best.b = b; best.m = m; best.t = this.t; best.cel.fill(-1); best.px.fill(NaN);
    return best;
  }
  /** Conti per le misure (oggetto riusato). */
  misure() {
    const m = this._mis || (this._mis = { segni: 0, corse: 0, volo: 0, celle: 0, timbri: 0, posati: 0 });
    let c = 0; for (const q of this.corse) if (q.on) c++;
    m.segni = this.nSegni; m.corse = c; m.volo = this.conta.volo; m.celle = this.conta.celle; m.timbri = this.conta.timbri; m.posati = this.conta.segni;
    return m;
  }
}

// ------------------------------------------------------------------------------------------------ funzioni per famiglia
/** A. falce dalla hitbox (G, S di fx_nemici). */
export const falce = (asc, ...a) => colpiDi(asc)?.falce(...a);
/** B. schianto a terra con onda che corre sul pavimento. */
export const schianto = (asc, ...a) => colpiDi(asc)?.schianto(...a);
/** C. raggio (preavviso o fuoco) con contatto. */
export const raggio = (asc, ...a) => colpiDi(asc)?.raggio(...a);
/** D. catena o filo che striscia. */
export const catena = (asc, ...a) => colpiDi(asc)?.catena(...a);
/** E. cera che tocca (e grumo in volo). */
export const cera = (asc, ...a) => colpiDi(asc)?.cera(...a);
export const grumo = (asc, ...a) => colpiDi(asc)?.grumo(...a);
/** F. ago in volo e che tocca. */
export const ago = (asc, ...a) => colpiDi(asc)?.ago(...a);
export const agoTocca = (asc, ...a) => colpiDi(asc)?.agoTocca(...a);
/** Un evento del gioco (g.fx) → ricetta. */
export function notaColpo(asc, e, g = null) { const C = colpiDi(asc); return C ? C.nota(e, g) : false; }
/** Per fotogramma: raggi e colpi con hitbox in corso. */
export function osservaColpi(asc, g) { colpiDi(asc)?.osserva(g); }

// ------------------------------------------------------------------------------------------------ raggio del sito
/**
 * Movimento del raggio del sito (sito/scena.js → laser, passoRaggi): un passaggio da a0 ad a1 in smoothstep dopo il preavviso.
 * r = { a0, a1, mira (ms), fuoco (ms) }; tMs dall'inizio. out = { fase: 'mira' | 'fuoco' | 'fine', ang, k (0..1 del preavviso), fissa }.
 */
export function spazzataSito(r, tMs, out = {}, fissa_ms = 150) {
  if (tMs < r.mira) { out.fase = 'mira'; out.ang = r.a0; out.k = tMs / r.mira; out.fissa = tMs > r.mira - fissa_ms; return out; }
  if (tMs >= r.mira + r.fuoco) { out.fase = 'fine'; out.ang = r.a1; return out; }
  const u = (tMs - r.mira) / r.fuoco, k = u * u * (3 - 2 * u);
  out.fase = 'fuoco'; out.ang = r.a0 + (r.a1 - r.a0) * k; out.k = 1; out.fissa = true;
  return out;
}
/** Lunghezza del raggio da (x, y) lungo (ux, uy) fino al primo solido del motore, al più max px (passo 1 px). */
export function lunghezzaRaggio(asc, x, y, ux, uy, max) {
  if (!asc?.modo) return max;
  for (let d = 1; d < max; d++) if (asc.solido(x + ux * d, y + uy * d)) return d;
  return max;
}
/**
 * Nucleo a pixel del raggio come nel sito (sito/scena.js righe 2243–2253): fuoco = bordo rosso spesso w (pulsa 2↔3), alone rosa
 * di 2 px quando w = 3, riga bianca di 1 px, punta bianca 3 × 3; mira = linea rosa di 1 px a tratti, piena alla fine.
 * Stessi pixel del sito ma a tratti lungo l'asse principale (una chiamata per riga o colonna, non una per pixel: il sito ne fa
 * circa 2 × lunghezza, qui 3 × l'estensione sull'asse minore). X, Y in coordinate di disegno; t = ms del raggio (pulsazione);
 * nel preavviso fissa = linea piena. Restituisce le chiamate di disegno.
 */
export function nucleoRaggio(cx, X, Y, ux, uy, L, fase, t, fissa, P = DATI.raggio.pixel) {
  const C = P.colori, Ln = Math.round(L);
  if (fase === 'mira') {
    const a = cx.globalAlpha; cx.globalAlpha = fissa ? P.mira_alfa[1] : P.mira_alfa[0]; cx.fillStyle = C[1];
    const n = fissa ? riga(cx, X, Y, ux, uy, 3, Ln, 1, 0, 0) : riga(cx, X, Y, ux, uy, 3, Ln, 1, P.tratto[0], P.tratto[1]);
    cx.globalAlpha = a;
    return n;
  }
  const w = P.largo[0] + (Math.sin(t / P.pulsa_ms) > 0.2 ? P.largo[1] - P.largo[0] : 0);
  let n = 0;
  cx.fillStyle = C[2]; n += riga(cx, X, Y, ux, uy, 0, Ln, w, 0, 0);
  if (w > 2) { cx.fillStyle = C[1]; n += riga(cx, X, Y, ux, uy, 0, Ln, 2, 0, 0); }
  cx.fillStyle = C[0]; n += riga(cx, X, Y, ux, uy, 0, Ln, 1, 0, 0);
  const p = P.punta; cx.fillRect(Math.round(X + ux * Ln) - (p >> 1), Math.round(Y + uy * Ln) - (p >> 1), p, p);
  return n + 1;
}
/** Linea spessa w da d0 a d1 lungo (ux, uy), a tratti sull'asse principale; on/per: tratteggio (on px accesi ogni per). */
function riga(cx, X, Y, ux, uy, d0, d1, w, on, per) {
  const oriz = Math.abs(ux) >= Math.abs(uy), h = w >> 1;
  let n = 0, inizio = -1, m0 = 0, a0 = 0;
  for (let d = d0; d <= d1; d++) {
    const acceso = d < d1 && (!per || d % per < on), x = Math.round(X + ux * d), y = Math.round(Y + uy * d), m = oriz ? y : x, a = oriz ? x : y;
    if (inizio >= 0 && (!acceso || m !== m0)) {
      const lo = Math.min(a0, inizio), len = Math.abs(a0 - inizio) + 1;
      if (oriz) cx.fillRect(lo, m0 - h, len, w); else cx.fillRect(m0 - h, lo, w, len);
      n++; inizio = -1;
    }
    if (!acceso) continue;
    if (inizio < 0) { inizio = a; m0 = m; }
    a0 = a;
  }
  return n;
}
/** Grumo di cera a pixel (come i proiettili di oggi: contorno scuro, corpo, luce). */
export function nucleoGrumo(cx, X, Y, vx, vy, H, G = DATI.cera.grumo) {
  const r = Math.max(2, Math.round(G.raggio_H * H)), x = Math.round(X), y = Math.round(Y);
  cx.fillStyle = G.colori[2]; cx.fillRect(x - r, y - r + 1, 2 * r, 2 * r - 2); cx.fillRect(x - r + 1, y - r, 2 * r - 2, 2 * r);
  cx.fillStyle = G.colori[1]; cx.fillRect(x - r + 1, y - r + 1, 2 * r - 2, 2 * r - 2);
  cx.fillStyle = G.colori[0]; cx.fillRect(x - r + 2, y - r + 2, Math.max(1, r - 2), Math.max(1, r - 2));
  return 4;
}
/** Ago a pixel: tratto chiaro lungo il moto, punta bianca. */
export function nucleoAgo(cx, X, Y, vx, vy, A = DATI.ago) {
  const v = Math.hypot(vx, vy) || 1, ux = vx / v, uy = vy / v, L = A.lungo_px, nx = -uy, ny = ux;
  cx.fillStyle = A.pixel.colori[1];
  for (let d = 2; d < L; d++) { cx.fillRect(Math.round(X - ux * d), Math.round(Y - uy * d), 1, 1); if (d < L - 3) cx.fillRect(Math.round(X - ux * d + nx), Math.round(Y - uy * d + ny), 1, 1); }
  cx.fillStyle = A.pixel.colori[0]; cx.fillRect(Math.round(X) - 1, Math.round(Y) - 1, 2, 2); cx.fillRect(Math.round(X - ux * 2), Math.round(Y - uy * 2), 1, 1);
  return 2 * L;
}
