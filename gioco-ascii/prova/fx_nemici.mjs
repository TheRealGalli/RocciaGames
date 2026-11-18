// Copia di strumenti/pennino/prova/fx_nemici.mjs (sito/strumenti/copia_sprite.py): non modificare qui.
// (FXN) Effetti visivi di nemici, oggetti e terreno — piccolo motore a dati (personaggi/fx-nemici.json).
//
// Tre parti:
//  1. PREAVVISO IN TRE TEMPI dallo stato delle mosse (n.fase), per ogni nemico, grossi e piccoli:
//     CARICA (fase 'avviso': scintille che convergono sulla parte che colpisce, bagliore che cresce, polvere ai piedi,
//     zona d'arrivo che si accende a terra) → RILASCIO (ingresso in 'attivo': scia lungo la traiettoria della mossa + lampo)
//     → CODA (uscita da 'attivo': il colpo a segno lo dà l'evento nemico_colpisce, altrimenti polvere e crepe a terra).
//     Durate dalle fasi di fotogrammi_ms della mossa (non cambiate). La carica dei grossi si disegna dopo la folla.
//  2. RICETTE per evento (g.fx): strati semplici a pixel (lampo, palla di fuoco, anello, onda a terra, nastro, schegge con
//     rimbalzo, braci, scintille, gocce, scaglie, fiamme, fumo, polvere, crepe e macchie che restano, zona, luce, scossa,
//     spinta su polvere e nebbia). Esplosioni in tre taglie e cinque materie. Morti per tipo e per modo.
//  3. VASCHE FISSE: particelle in array tipizzati (tetto globale, si ricicla la più vecchia), segni, terra ed emettitori
//     preallocati; niente allocazioni per particella. Disegno solo con fillRect/globalAlpha/fillStyle a pixel interi.
//  4. (FX5) FORME FINI: tratti di 1 px orientati (tratto()), anelli a tratti che si aprono o si chiudono, raggi che
//     schizzano, urto direzionale su A, falce della spazzata, colonna della comparsa. Tempi con entrata rapida e coda lenta
//     (1 − (1 − u)³). Il preavviso è un anello a tratti che si stringe sulla parte che colpisce: quando la tocca, parte.
//
// Uso (prova.mjs, righe (FXN)): FX_NEMICI.collega({nuvole, luce, scuoti, spinta}); FX_NEMICI.nota(e, g) per ogni evento;
// FX_NEMICI.passo(dt, g); FX_NEMICI.disegnaSotto(cx, g, camX, camY) prima dei nemici; FX_NEMICI.disegna(...) dopo.
import D from '../personaggi/fx-nemici.json' with { type: 'json' };
import { faseSegnale } from './segnali.mjs';
import { sbuffo } from './polvere.mjs';
import { TETTO_FX, posto, nuovoFotogramma, ContaFx } from './tetto_fx.mjs';   // (FIN) tetto globale con fx_abilita

export const DATI_FXN = D;
const TT = D.tetti;
const PALN = Object.keys(D.pal), PAL = PALN.map((k) => D.pal[k]), PI = Object.fromEntries(PALN.map((k, i) => [k, i]));
export const STRATI = new Set(['lampo', 'palla', 'anello', 'onda', 'nastro', 'filo', 'graffi', 'crepe', 'macchia', 'zona', 'schegge', 'braci',
  'scintille', 'gocce', 'scaglie', 'fiamme', 'fumo', 'polvere', 'luce', 'scossa', 'spinta', 'tratti', 'raggi', 'urto', 'falce', 'sorge']);
/** Eventi che fx_nemici disegna (nemici/effetti.mjs li salta: niente doppioni). */
export const COPERTI = new Set([...Object.keys(D.eventi).filter((k) => k !== 'nota'), 'uccisione', 'nemico_morte', 'nemico_colpisce', 'impatto']);

// tipi di particella
const SCHEGGIA = 0, BRACE = 1, FUMO = 2, FIAMMA = 3, GOCCIA = 4, SCINTILLA = 5, SCAGLIA = 6;
let seme = 0x2f6e2b1;
const rnd = () => ((seme = (Math.imul(seme, 1664525) + 1013904223) >>> 0) / 4294967296);
const lim = (v, a, b) => (v < a ? a : v > b ? b : v);
const base = (id) => String(id || '').replace(/-(elite|mini)$/, '');
const RAD = Math.PI / 180;
const TONI_NUVOLE = { scuro: 3, chiaro: 1, vapore: 4 };
const tMossa = (n) => { const c = n.motore?.corrente; return c ? c.t * 1000 : (n.animT || 0); };

/** Portata della mossa in H, dall'unione delle hitbox ([avanti, su, largo, alto]): {x0, x1, y0, y1}. In cache sull'oggetto. */
const PORTATE = new WeakMap();
export function portata(m) {
  if (!m) return { x0: 0.2, x1: 1, y0: -1.1, y1: -0.2 };
  let P = PORTATE.get(m);
  if (P) return P;
  P = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const hb of m.hitbox || []) { const r = hb.rett_H; if (!r) continue; P.x0 = Math.min(P.x0, r[0]); P.x1 = Math.max(P.x1, r[0] + r[2]); P.y0 = Math.min(P.y0, r[1]); P.y1 = Math.max(P.y1, r[1] + r[3]); }
  if (!(P.x1 > -Infinity)) { P.x0 = 0.2; P.x1 = 1; P.y0 = -1.1; P.y1 = -0.2; }
  if (m.onda?.lunghezza_H) P.x1 = Math.max(P.x1, 0.6 + m.onda.lunghezza_H);
  PORTATE.set(m, P);
  return P;
}
/** La mossa corre in avanti (carica): movimento attivo veloce. */
const corre = (m) => (m?.movimento?.attivo?.vel_H_s ?? 0) >= 3;

/** Modo della morte dall'evento uccisione (e dal bersaglio): tagliato | schiacciato | bruciato | esploso | colpo. */
export function modoMorte(e, b = null) {
  const M = D.morti;
  if (e.modo === 'ambiente') return M.oggetto[e.oggetto] ?? M.oggetto._;
  if (b?.st?.e?.fuoco?.t > 0 || b?.stati?.fuoco > 0) return 'bruciato';
  if (e.fonte && M.fonte[e.fonte]) return M.fonte[e.fonte];
  return 'colpo';
}
/** Forma del rilascio per nemico e mossa (dati, poi ricavata dalla mossa). */
const FASCIO_NEM = Object.freeze({ forma: 'fascio', w: 6 });   // (NEM)
export function formaRilascio(n) {
  const R = D.rilascio, tb = base(n.tipo), m = n.mossa;
  if (n.nomeMossa === 'fascio' && n.comp?.lampada) return FASCIO_NEM;   // (NEM) fascio della Lampada lungo la sua linea
  const F = R[tb]?.[n.nomeMossa] ?? (n.sciame ? R.mini?.[n.nomeMossa] ?? R.mini?._ : null) ?? R[tb]?._;
  // (MBC3) la forma «hitbox» (archi dei mini boss) vale solo per le mosse con hitbox: i tiri restano bocca
  if (F && !(F.forma === 'hitbox' && !m?.hitbox)) return F;
  if (m?.proiettile) return { forma: 'bocca' };
  if (corre(m)) return { forma: 'carica' };
  if (m?.onda || m?.onda_atterra) return { forma: 'pesta', w: 6 };
  return { forma: 'arco', a0: -60, a1: 40, w: n.sciame ? 2 : 4 };
}

// ------------------------------------------------------------ disegno a pixel
function disco(cx, X, Y, r) {
  if (r <= 0) { cx.fillRect(X, Y, 1, 1); return; }
  const a = Math.round(r * 0.55);
  if (r <= 1 || a >= r) { cx.fillRect(X - r, Y - r, 2 * r + 1, 2 * r + 1); return; }   // (FIN) piccolo: un solo quadrato
  cx.fillRect(X - r, Y - a, 2 * r + 1, 2 * a + 1); cx.fillRect(X - a, Y - r, 2 * a + 1, 2 * r + 1);
  if (r >= 4) { const b = Math.round(r * 0.78); cx.fillRect(X - b, Y - b, 2 * b + 1, 2 * b + 1); }
}
const banda = (u) => (u < 0.55 ? 1 : u < 0.8 ? 0.66 : 0.33);
/** (FX5) Entrata rapida, coda lenta. */
const esce = (u) => 1 - (1 - u) * (1 - u) * (1 - u);
/** (FX5) Tratto di 1 px lungo len, orientato lungo (ux, uy): riga o colonna; in diagonale un pixel (due da len 3). */
function tratto(cx, x, y, ux, uy, len) {
  if (len <= 1) { cx.fillRect(x, y, 1, 1); return; }
  const ax = ux < 0 ? -ux : ux, ay = uy < 0 ? -uy : uy;
  if (ax >= 2 * ay) cx.fillRect(x - (len >> 1), y, len, 1);
  else if (ay >= 2 * ax) cx.fillRect(x, y - (len >> 1), 1, len);
  else { cx.fillRect(x, y, 1, 1); if (len >= 3) cx.fillRect(x + (ux < 0 ? -1 : 1), y + (uy < 0 ? -1 : 1), 1, 1); }
}

// ------------------------------------------------------------ (MBC3) (MBC4) colpi dei mini boss dalla hitbox
// Carlo (17/11): «che si capisca bene quanto è il raggio delle mosse con dei begli archi … belle scintille, come se fossero
// un personaggio». Per ogni hitbox di una mossa dei mini boss (fx-nemici.json → miniboss) un colpo PIENO, nel linguaggio delle
// falci del protagonista (mosse_fx.mjs → FormeColpo 'falce'), che nella sua finestra (da_ms/a_ms o la fase attivo) arriva
// ESATTAMENTE al bordo del rettangolo della hitbox (ogni rettangolo disegnato è ritagliato sulla hitbox). La forma nasce dai
// dati della hitbox, non dal nome della mossa:
//  - falce: mezzaluna spessa che spazza la mezza ellisse davanti (dall'alto in basso), testa larga, coda che si assottiglia;
//  - affondo: hitbox lunga e bassa in aria (presa): cuneo che corre in avanti con la punta chiara;
//  - radente: lama d'urto raso terra che corre fino alla fine della hitbox, solco a tratti dietro;
//  - due_lati: due lame raso terra dal centro ai due capi;
//  - anello: cometa spessa che gira attorno al corpo (mulinello, corpo in volo);
//  - espande: fronte a cupola che si allarga dal corpo al bordo, anello a terra in prospettiva e due lame raso terra.
// Corpo a tre toni (contorno scuro, corpo, ombra interna), filo chiaro sul bordo d'attacco, punta bianca, coda che si
// sgrana a retino (soglie, nessuna trasparenza). Spessore della testa dalla forza del colpo (spessore[leggero, normale,
// pesante] in px a H 48). A fine corsa un lampo sul bordo («fin qui»). Disegno a fillRect, stato in oggetti creati una volta.
export const MB_ARCHI = D.miniboss || null;
const GEO_ARCHI = new WeakMap();
const B4M = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const accM = (i, j, c) => B4M[(j & 3) * 4 + (i & 3)] < c;
const TERRA_TIPI = new Set(['radente', 'due_lati', 'affondo']);
/** Geometria del colpo di una hitbox ({rett_H, onda}) della mossa m, in H rispetto ai piedi (x avanti, y giù). */
export function geometriaArco(hb, m, tipo0 = null) {
  let G = GEO_ARCHI.get(hb);
  if (G && !tipo0) return G;
  const [av, su, w, h] = hb.rett_H, x0 = av, x1 = av + w, y0 = su, y1 = su + h;
  const terra = Math.abs(y1) < 0.08, attorno = x0 < 0 && x1 > 0 && Math.abs(x0 + x1) < 0.4 * w;
  // (MBC4) hitbox lunga e bassa in aria (presa della catena): affondo, non una mezzaluna schiacciata
  const tipo = tipo0 || (m?.onda && attorno ? 'espande' : terra && h <= 0.7 ? (attorno ? 'due_lati' : 'radente') : attorno ? 'anello' : w >= 2.5 * h ? 'affondo' : 'falce');
  if (tipo === 'falce') G = { tipo, cx: x0, cy: (y0 + y1) / 2, rx: w, ry: h / 2, a0: -Math.PI / 2, a1: Math.PI / 2 };
  else if (tipo === 'espande') G = { tipo, cx: (x0 + x1) / 2, cy: y1, rx: w / 2, ry: h, a0: -Math.PI, a1: 0 };
  else G = { tipo, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: w / 2, ry: h / 2, a0: -Math.PI / 2, a1: 1.5 * Math.PI };
  G.x0 = x0; G.x1 = x1; G.y0 = y0; G.y1 = y1;
  if (!tipo0) GEO_ARCHI.set(hb, G);
  return G;
}
/** Finestra [t0, t1] in ms della hitbox: da_ms/a_ms o la fase attivo della mossa. */
export function finestraArco(hb, m, out = [0, 0]) {
  const A = m?.fotogrammi_ms?.attivo;
  if (hb.da_ms != null) { out[0] = hb.da_ms; out[1] = hb.a_ms; } else if (A) { out[0] = A[0]; out[1] = A[1]; } else { out[0] = 0; out[1] = 150; }
  return out;
}
/**
 * Stato del colpo al tempo t (ms nella mossa) o null se non si vede: testa/coda = frazioni del percorso (0 inizio, 1 fine);
 * giro = angolo della testa per l'anello; k = scala del fronte di espande; cu = consumo dopo la finestra (0..1);
 * fine = ms da quando la testa è arrivata in fondo (negativo prima); lontano = idem dal punto più lontano (falce);
 * fr = passo del retino.
 */
export function statoArco(G, w, t, C = MB_ARCHI || {}, out = {}) {
  const [t0, t1] = w, dur = Math.max(C.min_ms ?? 110, t1 - t0), coda = C.coda_ms ?? 150, te = t0 + dur, corsa = 0.7 * dur;
  if (t < t0 || t > te + coda) return null;
  const lin = lim((t - t0) / corsa, 0, 1), cu = t > te ? (t - te) / coda : 0;
  out.testa = TERRA_TIPI.has(G.tipo) ? lin : esce(lin); out.coda = out.testa * esce(cu); out.giro = (t - t0) / (C.giro_ms ?? 360) * 2 * Math.PI;
  out.k = 0.3 + 0.7 * esce(lin); out.alfa = 1; out.cu = cu; out.fine = t - t0 - corsa; out.fr = Math.floor(t / 33);
  // (MBC4) ms da quando la testa della falce è passata dal punto più lontano (metà percorso: esce(u) = 0,5)
  out.lontano = t - t0 - 0.2063 * corsa;
  return out;
}
/** Forza del colpo: 0 leggero, 1 normale, 2 pesante (elenco pesanti del mini boss, poi danno della mossa). */
export function forzaMb(MB, nome, danno = 0) {
  if (MB?.pesanti?.includes(nome)) return 2;
  const C = MB_ARCHI || {};
  if (danno >= (C.danno_pesante ?? 12)) return 2;
  return danno > 0 && danno <= (C.danno_leggero ?? 5) ? 0 : 1;
}
/** Spessore della testa in px a H 48 per la forza f (spessore[f] del mini boss). */
export const spessoreMb = (MB, f) => (Array.isArray(MB?.spessore) ? MB.spessore[f] ?? MB.spessore[1] : MB?.spessore) ?? 8;

// stato del disegno (uno solo, riusato): contesto, origine a schermo, verso, ritaglio sulla hitbox in px locali
const _R = { cx: null, X0: 0, Y0: 0, face: 1, a: 0, b: 0, c: 0, d: 0, col: '' };
function rettR(i, j, w, h, col) {
  let i1 = i + w, j1 = j + h;
  if (i < _R.a) i = _R.a;
  if (i1 > _R.b) i1 = _R.b;
  if (j < _R.c) j = _R.c;
  if (j1 > _R.d) j1 = _R.d;
  if (i1 <= i || j1 <= j) return;
  if (col !== _R.col) { _R.cx.fillStyle = col; _R.col = col; }
  _R.cx.fillRect(_R.face > 0 ? _R.X0 + i : _R.X0 - i1, _R.Y0 + j, i1 - i, j1 - j);
}
/**
 * Mezzaluna piena lungo l'ellisse (centro cxp, cyp; raggi rx, ry px) dalla coda thT alla testa thH: quattro passate come la
 * falce di A, mai una sopra l'altra a pettine (contorno scuro, corpo, ombra sul lato interno, filo chiaro sul bordo esterno,
 * bianco in testa). unif: spessore uguale e filo per tutto il percorso (fronte di espande). sgr 0..1: coda a retino.
 */
function falciaR(cxp, cyp, rx, ry, thT, thH, spH, P, fr, sgr, unif) {
  const span = thH - thT;
  if (Math.abs(span) < 1e-3 || rx < 2 || ry < 2) return;
  spH = Math.max(2, Math.min(spH, 0.6 * Math.min(rx, ry)));
  const L = Math.abs(span) * (rx + ry) * 0.5, N = Math.min(MB_ARCHI?.passi_max ?? 150, Math.max(3, Math.ceil(L / Math.max(1.5, spH * (unif ? 0.6 : 0.3)))));
  const spT = Math.min(spH, 2);
  for (let pass = 0; pass < 4; pass++) {
    let xp = NaN, yp = 0;
    for (let k = 0; k <= N; k++) {
      const tt = k / N, th = thT + span * tt, c = Math.cos(th), s = Math.sin(th);
      const rimx = cxp + rx * c, rimy = cyp + ry * s;
      let nx = c / rx, ny = s / ry;
      const nl = Math.sqrt(nx * nx + ny * ny) || 1; nx /= nl; ny /= nl;
      const cop = Math.round(16 * (unif ? 1 : Math.min(1, tt / 0.4)) * (1 - sgr));
      if (cop < 16 && !accM(k, fr, cop)) { xp = NaN; continue; }
      const sp = unif ? spH : spT + (spH - spT) * Math.pow(tt, 0.6), S = Math.max(1, Math.round(sp)), mx = rimx - nx * sp * 0.5, my = rimy - ny * sp * 0.5;
      const ix = Math.round(mx - S / 2), iy = Math.round(my - S / 2);
      if (pass === 0) { if ((unif || tt > 0.15) && S >= 3) rettR(ix - 1, iy - 1, S + 2, S + 2, P[4]); }
      else if (pass === 1) rettR(ix, iy, S, S, unif || tt > 0.45 ? P[1] : tt > 0.2 ? P[2] : P[3]);
      else if (pass === 2) {
        // ombra sul lato interno: metà dello spessore, spinta verso il centro
        if (S >= 5 && !unif && tt > 0.2) { const S2 = S >> 1; rettR(Math.round(rimx - nx * (sp - S2 * 0.5) - S2 / 2), Math.round(rimy - ny * (sp - S2 * 0.5) - S2 / 2), S2, S2, unif || tt > 0.45 ? P[2] : P[3]); }
      } else if (unif || tt > 0.25) {
        const bianca = !unif && tt > 0.88, x = Math.round(rimx - nx), y = Math.round(rimy - ny), col = bianca ? '#ffffff' : P[0], th2 = bianca ? 3 : 2;
        if (xp === xp) {
          const dx = x - xp, dy = y - yp, ax = dx < 0 ? -dx : dx, ay = dy < 0 ? -dy : dy;
          if (ax >= ay) rettR(Math.min(x, xp), y - (th2 >> 1), ax + 1, th2, col);
          else rettR(x - (th2 >> 1), Math.min(y, yp), th2, ay + 1, col);
        }
        xp = x; yp = y;
      }
    }
  }
}
/** Corsa q ∈ [qa, qz) dietro la testa xh (verso d) sulla riga y. */
function corsaR(xh, d, qa, qz, y, col) {
  const a = Math.round(qa), z = Math.round(qz);
  if (z > a) rettR(d > 0 ? xh - z : xh + a, y, z - a, 1, col);
}
/**
 * Lama d'urto da xs a xh (px locali, testa in xh), alta alt px sopra la riga base (sim: simmetrica attorno a base, per
 * l'affondo). Fronte a quarto d'ellisse col filo chiaro; corpo che sale ripido verso il fronte (cresta chiara in alto,
 * filetti di corsa, sotto più scuro; l'affondo ha l'anima chiara al centro); coda a gradini; solco a tratti fino alla
 * partenza. Righe di fillRect.
 */
function lamaR(xs, xh, base, alt, sim, P, fr, sgr, Lmax) {
  const d = xh >= xs ? 1 : -1, corsa = d > 0 ? xh - xs : xs - xh;
  if (corsa < 2 || alt < 2) return;
  const wf = Math.min(corsa, Math.max(3, Math.round(alt * 0.55))), Lb = Math.max(0, Math.min(corsa - wf, Lmax)), qs = wf + 0.55 * Lb;
  const righe = sim ? 2 * alt - 1 : alt, bianco = sgr <= 0;
  for (let r = 0; r < righe; r++) {
    if (sgr > 0 && !accM(r, fr, Math.round(16 * (1 - sgr)))) continue;
    const su = sim ? (r < alt ? alt - 1 - r : r - alt + 1) : r, y = sim ? base - alt + 1 + r : base - 1 - su;
    const e = su / alt, e1 = Math.min(1, (su + 1.5) / alt);
    const qf = wf * (1 - Math.sqrt(Math.max(0, 1 - e * e))), qb = wf + Lb * (1 - Math.sqrt(e)), qc = wf + Lb * (1 - Math.sqrt(e1));
    if (qb <= qf + 0.5) continue;
    const sopra = !sim || r < alt - 1, bordo = qb - qc;
    // filo chiaro sul fronte (bianco nel mezzo mentre corre)
    corsaR(xh, d, qf, Math.min(qb, qf + 2), y, bianco && e > 0.15 && e < 0.75 ? '#ffffff' : P[0]);
    const q1 = qf + 2, qcr = e > 0.2 && (sopra || bordo > 0) ? Math.max(q1, Math.min(qc, qb - 1)) : qb;
    const corpo = !sim && su === 0 ? P[4] : sim ? (e < 0.3 ? P[1] : e < 0.7 ? P[2] : P[3]) : e > 0.5 ? P[2] : P[3];
    corsaR(xh, d, q1, Math.min(qcr, qs), y, corpo);
    // filetti di corsa: una riga su quattro più chiara nel corpo pieno
    if (!sim && su % 4 === 2 && qcr > q1 + 6) corsaR(xh, d, q1 + 3, Math.min(qcr, qs) - 2, y, P[1]);
    // coda a gradini: tratti di 3 px sempre più radi
    for (let q = Math.max(q1, qs) + ((r * 2 + fr) % 4); q < qcr; q += 5 + 4 * (q - qs) / Math.max(1, Lb)) corsaR(xh, d, q, Math.min(qcr, q + 3), y, corpo);
    // cresta: chiara sopra, scura sotto per l'affondo
    if (qcr < qb) corsaR(xh, d, qcr, qb, y, sopra ? (e > 0.85 ? P[0] : P[1]) : P[4]);
  }
  // solco a tratti dal punto di partenza al corpo: dice dove la lama è già passata
  const q0 = wf + Lb, ys = sim ? base : base - 1;
  for (let q = q0 + 2 + (fr % 3); q < corsa; q += 7 + 3 * (q - q0) / Math.max(1, corsa)) {
    if (sgr > 0 && !accM(q | 0, fr, Math.round(16 * (1 - sgr)))) continue;
    corsaR(xh, d, q, Math.min(corsa, q + 4), ys, sim ? P[1] : P[3]);
    if (sim && alt > 4) { corsaR(xh, d, q + 1, Math.min(corsa, q + 3), ys - 1, P[2]); corsaR(xh, d, q + 1, Math.min(corsa, q + 3), ys + 1, P[3]); }
  }
}
/** Lampo «fin qui» sul bordo: barra bianca di 2 px alta h px che finisce sulla riga yb, con una tacca chiara di traverso. */
function taccaR(i, yb, h, d, P) {
  rettR(d > 0 ? i - 2 : i, yb - h, 2, h, '#ffffff');
  rettR(d > 0 ? i - 5 : i, yb - (h >> 1) - 1, 5, 2, P[0]);
}
/** (MBC4) Disegna il colpo G allo stato S (px locali × pxH, origine X0, Y0 ai piedi, verso face). sp = spessore della testa (px). */
export function disegnaArco(cx, G, S, pxH, sp, P, X0, Y0, face, fine_ms = 90) {
  const R = _R;
  R.cx = cx; R.X0 = X0; R.Y0 = Y0; R.face = face; R.col = '';
  R.a = Math.round(G.x0 * pxH); R.b = Math.round(G.x1 * pxH); R.c = Math.round(G.y0 * pxH); R.d = Math.round(G.y1 * pxH);
  const fr = S.fr | 0, sgr = S.cu > 0 ? 0.6 * S.cu : 0, fin = S.fine >= 0 && S.fine < fine_ms;
  const alt = R.d - R.c, Lmax = Math.max(0.8 * pxH, 2.2 * alt);
  switch (G.tipo) {
    case 'falce': {
      const span = G.a1 - G.a0, thH = G.a0 + span * S.testa, thT = G.a0 + span * S.coda;
      falciaR(G.cx * pxH, G.cy * pxH, G.rx * pxH, G.ry * pxH, thT, thH, sp, P, fr, sgr, false);
      if (S.lontano >= 0 && S.lontano < fine_ms) taccaR(R.b, Math.round(G.cy * pxH + 0.2 * alt), Math.max(4, Math.round(0.4 * alt)), 1, P);
      break;
    }
    case 'anello': {
      const thH = G.a0 + S.giro, Lc = 1.5 * Math.PI * Math.min(1, S.testa) * (1 - S.coda / Math.max(1e-6, S.testa));
      falciaR(G.cx * pxH, G.cy * pxH, G.rx * pxH, G.ry * pxH, thH - Lc, thH, sp, P, fr, sgr, false);
      break;
    }
    case 'espande': {
      const cxp = Math.round(G.cx * pxH), base = R.d, rx = G.rx * pxH * S.k, ry = G.ry * pxH * S.k;
      falciaR(cxp, base, rx, ry, -Math.PI, 0, 0.85 * sp, P, fr, sgr, true);
      // anello a terra in prospettiva (metà lontana, sopra la riga del suolo): fascia di 3 px con la cresta chiara
      const rg = Math.max(2, Math.round(Math.min(0.16 * pxH, 0.12 * rx)));
      for (let su = 0; su < rg; su++) {
        if (sgr > 0 && !accM(su, fr, Math.round(16 * (1 - sgr)))) continue;
        const f = Math.sqrt(Math.max(0, 1 - (su / rg) * (su / rg))), xo = Math.round(rx * f), xi = Math.round(Math.max(0, rx - 3) * f), y = base - 1 - su;
        const col = su === rg - 1 ? P[1] : P[2];
        if (xo - xi >= 1) { rettR(cxp - xo, y, xo - xi, 1, col); rettR(cxp + xi, y, xo - xi, 1, col); } else rettR(cxp - xo, y, 2 * xo, 1, P[2]);
      }
      const altB = Math.max(4, Math.round(Math.min(0.3 * alt, 0.42 * pxH)));
      for (let sd = -1; sd <= 1; sd += 2) lamaR(cxp, cxp + sd * Math.round(rx), base, altB, false, P, fr, sgr, 0.7 * pxH);
      if (fin) { taccaR(R.b, base, altB + 4, 1, P); taccaR(R.a, base, altB + 4, -1, P); rettR(cxp - 4, R.c, 9, 2, '#ffffff'); }
      break;
    }
    case 'radente': {
      const xh = Math.round((G.x0 + (G.x1 - G.x0) * S.testa) * pxH), xs = R.a + Math.round((xh - R.a) * S.coda * 0.85);
      lamaR(xs, xh, R.d, alt, false, P, fr, sgr, Lmax);
      if (fin) taccaR(R.b, R.d, alt, 1, P);
      break;
    }
    case 'due_lati': {
      const cxp = Math.round(G.cx * pxH), mezzo = (R.b - cxp) * S.testa, dc = Math.round(mezzo * S.coda * 0.85);
      lamaR(cxp + dc, cxp + Math.round(mezzo), R.d, alt, false, P, fr, sgr, Lmax);
      lamaR(cxp - dc, cxp - Math.round((cxp - R.a) * S.testa), R.d, alt, false, P, fr, sgr, Lmax);
      if (fin) { taccaR(R.b, R.d, alt, 1, P); taccaR(R.a, R.d, alt, -1, P); }
      break;
    }
    case 'affondo': {
      const xh = Math.round((G.x0 + (G.x1 - G.x0) * S.testa) * pxH), xs = R.a + Math.round((xh - R.a) * S.coda * 0.85), am = Math.ceil(alt / 2);
      lamaR(xs, xh, R.c + am - 1, am, true, P, fr, sgr, Math.max(Lmax, 0.5 * (xh - xs)));
      if (fin) taccaR(R.b, R.d, alt, 1, P);
      break;
    }
  }
  return R;
}
/**
 * (MBC4) Preavviso: traccia tenue a puntini sul bordo della zona che sarà colpita (k 0..1 dell'avviso). Parte più larga
 * (1 + allarga) e si stringe sul bordo vero; nel guizzo i puntini si infittiscono e si accendono. Nessun ritaglio.
 */
export function disegnaPreavviso(cx, G, pxH, k, guizzo, P, X0, Y0, face, tempo, C = MB_ARCHI?.preavviso || {}) {
  const R = _R;
  R.cx = cx; R.X0 = X0; R.Y0 = Y0; R.face = face; R.col = ''; R.a = -1e9; R.b = 1e9; R.c = -1e9; R.d = 1e9;
  const kk = 1 + (C.allarga ?? 0.22) * (1 - k), passo = guizzo ? (C.passo_guizzo ?? 3) : (C.passo ?? 5), off = Math.floor(tempo * (C.corre ?? 24)) % passo;
  const col = guizzo ? P[0] : P[k > 0.6 ? 1 : 2], dim = guizzo ? 2 : 1;
  const x0 = Math.round(G.x0 * pxH), x1 = Math.round(G.x1 * pxH), y0 = Math.round(G.y0 * pxH), y1 = Math.round(G.y1 * pxH);
  if (G.tipo === 'falce' || G.tipo === 'anello' || G.tipo === 'espande') {
    const cxp = G.cx * pxH, cyp = G.cy * pxH, rx = G.rx * pxH * kk, ry = G.ry * pxH * kk, span = G.a1 - G.a0;
    const N = Math.min(160, Math.ceil(Math.abs(span) * (rx + ry) * 0.5 / passo));
    for (let i = 0; i <= N; i++) {
      const th = G.a0 + span * ((i + off / passo) / Math.max(1, N));
      if (th > G.a1) continue;
      rettR(Math.round(cxp + rx * Math.cos(th)), Math.round(cyp + ry * Math.sin(th)) - (G.tipo === 'espande' ? 1 : 0), dim, dim, col);
    }
    if (G.tipo === 'espande') for (let x = Math.round(cxp - rx) + off; x < cxp + rx; x += passo) rettR(x, y1 - 1, dim, 1, col);
    return;
  }
  // lame e affondo: riga a puntini dove corre la lama e tacca in fondo, alta quanto la hitbox
  const yr = G.tipo === 'affondo' ? Math.round((y0 + y1) / 2) : y1 - 1, cxp = Math.round(G.cx * pxH);
  const lo = G.tipo === 'due_lati' ? Math.round(cxp - (cxp - x0) * kk) : x0, hi = G.tipo === 'due_lati' ? Math.round(cxp + (x1 - cxp) * kk) : Math.round(x0 + (x1 - x0) * kk);
  for (let x = lo + off; x < hi; x += passo) rettR(x, yr, dim, 1, col);
  for (let y = y0; y < y1; y += passo) { rettR(hi - 1, y, 1, dim, col); if (G.tipo === 'due_lati') rettR(lo, y, 1, dim, col); }
}
/** (MBC4) Punto della testa (o dei due fronti) in H locali: out = [x, y, tx, ty, x2] (x2 = NaN se un fronte solo). */
export function testaArco(G, S, out = [0, 0, 0, 0, NaN]) {
  out[4] = NaN;
  switch (G.tipo) {
    case 'falce': case 'anello': {
      const th = G.tipo === 'falce' ? G.a0 + (G.a1 - G.a0) * S.testa : G.a0 + S.giro, c = Math.cos(th), s = Math.sin(th);
      out[0] = G.cx + G.rx * c; out[1] = G.cy + G.ry * s; out[2] = -G.rx * s; out[3] = G.ry * c; break;
    }
    case 'espande': out[0] = G.cx + G.rx * S.k; out[4] = G.cx - G.rx * S.k; out[1] = G.y1; out[2] = 1; out[3] = 0; break;
    case 'due_lati': out[0] = G.cx + (G.x1 - G.cx) * S.testa; out[4] = G.cx - (G.cx - G.x0) * S.testa; out[1] = G.y1; out[2] = 1; out[3] = 0; break;
    default: out[0] = G.x0 + (G.x1 - G.x0) * S.testa; out[1] = G.tipo === 'affondo' ? (G.y0 + G.y1) / 2 : G.y1; out[2] = 1; out[3] = 0;
  }
  const l = Math.sqrt(out[2] * out[2] + out[3] * out[3]) || 1; out[2] /= l; out[3] /= l;
  return out;
}
/** (MBC4) Chiamate di disegno stimate per un colpo (per il tetto globale, prima di disegnare). */
export function stimaArco(G, pxH) {
  const w = (G.x1 - G.x0) * pxH, h = (G.y1 - G.y0) * pxH;
  if (G.tipo === 'espande') return 140 + Math.ceil(Math.PI * (w / 2 + h) / 2 / 3.6) * 3;
  if (G.tipo === 'due_lati') return 2 * (Math.ceil(h) * 7 + 20);
  if (G.tipo === 'radente' || G.tipo === 'affondo') return Math.ceil(h) * 7 + Math.ceil(w / 7) + 10;
  return 3 * Math.min(MB_ARCHI?.passi_max ?? 150, Math.ceil(Math.PI * (w + h) / 2 / 3));
}

export class FxNemici {
  constructor(tetti = TT) {
    const N = this.N = tetti.particelle, F = (k) => new Float32Array(k);
    this.x = F(N); this.y = F(N); this.vx = F(N); this.vy = F(N); this.g = F(N); this.att = F(N); this.t = F(N); this.vita = F(N);
    this.dim = F(N); this.suolo = F(N); this.rimb = F(N);
    this.tipo = new Uint8Array(N); this.pal = new Uint8Array(N); this.ci = new Uint8Array(N); this.on = new Uint8Array(N);
    this.i = 0; this.vivi = 0;
    const segno = () => ({ on: false, s: '', x: 0, y: 0, dir: 1, t: 0, vita: 0, r: 0, r2: 0, a0: 0, a1: 0, w: 1, p: 0, rif: null, sem: 0, n: 0, acc: 0 });
    this.segni = Array.from({ length: tetti.segni }, segno); this.is = 0;
    this.terra = Array.from({ length: tetti.terra }, segno); this.it = 0;
    this.emett = Array.from({ length: tetti.emettitori }, () => ({ on: false, x: 0, y: 0, w: 0, dir: 1, ang: '', t: 0, dur: 0, ogni: 0.1, acc: 0, L: null, suolo: 0 }));
    this.ie = 0;
    this.hook = { nuvole: null, luce: null, scuoti: null, spinta: null };
    this.H = 48; this.camX = 0; this.camY0 = 0; this.vx0 = -1e9; this.vx1 = 1e9; this.tempo = 0;
    this.cache = new Map();
    this.c = { x: 0, y: 0, suolo: 0, xp: 0, dir: 1, kr: 1, kn: 1, kpx: 1, tinta: 0, lontano: false, ms: 0, e: null, ang: '' };
    this._e = { tipo: '', x: 0, y: 0, dir: 1, suolo: 0, xp: 0, nemico: '', bersaglio: null };
    this.muc = { prev: 0, x: 0, y: 0 };
    this.conta = { eventi: 0, ricette: 0 };
    // (MBC3) (MBC4) stato del disegno dei colpi dei mini boss: oggetti creati una volta (stato, finestra, testa)
    this._sa = {}; this._fa = [0, 0]; this._ta = [0, 0, 0, 0, NaN];
    this._prio = false; this._cf = new ContaFx(); this.atterraggi = 0;   // (FIN) tetto globale; sbuffi d'atterraggio a sacco in questo secondo
  }
  /** Ganci del browser: nuvole (polvere.mjs), luce(x, y, col, raggio, ms, forza), scuoti(px, ms), spinta(x, y, raggio). */
  collega(h) { Object.assign(this.hook, h); return this; }
  azzera() { this.on.fill(0); this.vivi = 0; for (const q of this.segni) q.on = false; for (const q of this.terra) q.on = false; for (const q of this.emett) q.on = false; }

  // ---------------------------------------------------------- vasche
  _p(tipo, x, y, vx, vy, g, vita, dim, pal, ci, suolo, rimb = 0, att = 0, rit = 0) {
    const k = this.i; this.i = (k + 1) % this.N;              // anello: si ricicla sempre la più vecchia
    if (!this.on[k]) this.vivi++;
    this.on[k] = 1; this.tipo[k] = tipo; this.x[k] = x; this.y[k] = y; this.vx[k] = vx; this.vy[k] = vy; this.g[k] = g;
    this.vita[k] = vita; this.t[k] = -rit; this.dim[k] = dim; this.pal[k] = pal; this.ci[k] = ci; this.suolo[k] = suolo; this.rimb[k] = rimb; this.att[k] = att;
  }
  _segno(pool, s, x, y, dir, vita, r, p, rit = 0) {
    const L = pool === 0 ? this.segni : this.terra, j = pool === 0 ? this.is : this.it;
    const q = L[j];
    if (pool === 0) this.is = (j + 1) % L.length; else this.it = (j + 1) % L.length;
    q.on = true; q.s = s; q.x = x; q.y = y; q.dir = dir || 1; q.t = -rit; q.vita = Math.max(0.03, vita); q.r = r; q.r2 = 0; q.a0 = 0; q.a1 = 0;
    q.w = 1; q.p = p; q.rif = null; q.sem = (rnd() * 1e9) | 0; q.n = 1; q.acc = 0;
    q.prio = this._prio; q.sotto = false;                      // (FIN) esplosioni grandi: precedenza nel tetto globale; sotto: disegnato prima dei nemici
    return q;
  }

  // ---------------------------------------------------------- eventi
  /** Un evento di g.fx. */
  nota(e, g = null) {
    if (!e?.tipo) return;
    if (this.salta?.(e)) return;   // (ASC8) con ?ascii=1 lo scoppio di uno sparo reso in lettere lo fanno le lettere (salta: prova/ascii_agganci.mjs; assente = come prima)
    if (g?.H) this.H = g.H;
    if (e.tipo === 'uccisione') { this._morte(e, g); return; }
    if (e.tipo === 'impatto') { if (!e.uccide && !e.finale) this.ricetta('nemico_colpito', e, g, 'piccola'); return; }   // (FX5) tacca del colpo di A sul nemico: tre raggi nel verso del colpo (la morte e i finali hanno i loro segni)
    // (MBC3) mini boss: colpo a segno e parata con le ricette loro (scintille e schegge più ricche, scossa sui pesanti)
    const MBe = MB_ARCHI?.[base(e.nemico || this._bersaglio(g, e.bersaglio)?.nem?.tipo)];
    // (MBC4) tre taglie dalla forza del colpo (leggero, normale, pesante): ricette e taglia da miniboss.ricette
    if (MBe && (e.tipo === 'nemico_colpisce' || e.tipo === 'parata')) {
      const RR = MB_ARCHI.ricette, bb = this._bersaglio(g, e.bersaglio), f = forzaMb(MBe, e.mossa, e.danno ?? bb?.nem?.mossa?.danno ?? 0);
      const L = RR?.[e.tipo === 'parata' ? 'parata' : 'colpo'];
      if (L) this.ricetta(L[f], e, g, RR.taglie?.[f] ?? 'media');
      if (e.tipo === 'nemico_colpisce') return;
    }
    if (e.tipo === 'nemico_colpisce') { this.ricetta(/-mini$/.test(e.nemico || '') ? 'morso' : 'colpo_a_segno', e, g); return; }
    let V = D.eventi[e.tipo];
    for (let i = 0; i < 4 && V && typeof V === 'object' && V.per; i++) {
      const k = Array.isArray(V.per) ? V.per.map((c) => e[c]).join('.') : String(e[V.per]);
      V = V.casi[k] ?? V.casi._ ?? null;
    }
    if (!V) return;
    this.conta.eventi++;
    if (typeof V === 'string') { this.ricetta(V, e, g); return; }
    if (V.emetti) { this._emetti(V, e, g); return; }
    let taglia = V.taglia;
    if (taglia === 'da_raggio') { const r = (e.raggio ?? 2 * this.H) / this.H; taglia = r < 1.6 ? 'piccola' : r < 2.6 ? 'media' : 'grande'; }
    this.ricetta(V.r, e, g, taglia, V.materia, V.msE ? e[V.msE] : undefined);
  }
  _bersaglio(g, id) { if (id == null || !g?.bersagli) return null; for (const b of g.bersagli) if (b.id === id) return b; return null; }
  _quota(g, x, y) { const q = g?._quotaSotto ? g._quotaSotto(x, y) : g?.mondo?.suolo; return Number.isFinite(q) ? q : y + 0.6 * this.H; }

  /** Ricetta compilata (materia applicata), in cache. */
  compila(nome, materia = '', src = null) {
    const key = nome + '|' + materia;
    let C = this.cache.get(key);
    if (C) return C;
    const S = src || D.ricette[nome] || [], M = D.materie[materia] || {};
    C = [];
    for (const L0 of S) {
      if (M.senza?.includes(L0.s)) continue;
      const s = M.come?.[L0.s] ?? L0.s, pn = L0.pal === '$' ? null : (M.sost?.[L0.pal] ?? L0.pal ?? (s === 'braci' ? 'fuoco' : s === 'crepe' ? 'scuro' : 'bianco'));
      C.push({ ...L0, s, p: pn == null ? -1 : (PI[pn] ?? 0), tono: s === 'fumo' ? (M.fumo ?? L0.tono ?? 'chiaro') : L0.tono, col: s === 'luce' ? (M.luce ?? L0.col) : L0.col});
    }
    this.cache.set(key, C);
    return C;
  }
  /** Esegue una ricetta all'evento e (x, y, dir, nemico, bersaglio, suolo, xp). */
  ricetta(nome, e, g = null, taglia = 'media', materia = '', ms = undefined, src = null) {
    const C = this.compila(nome, materia || '', src);
    if (!C.length) return;
    const c = this._contesto(e, g, taglia, ms);
    this.conta.ricette++;
    this._prio = taglia === 'grande';                        // (FIN)
    for (const L of C) this._strato(L, c);
    this._prio = false;
  }
  _contesto(e, g, taglia, ms) {
    const H = this.H, c = this.c, T = D.taglie[taglia] || D.taglie.media, b = e.bersaglio != null ? this._bersaglio(g, e.bersaglio) : null;
    c.e = e; c.x = Number.isFinite(e.x) ? e.x : 0; c.y = Number.isFinite(e.y) ? e.y : 0; c.dir = Math.sign(e.dir || e.verso || 0) || 1;
    c.suolo = Number.isFinite(e.suolo) ? e.suolo : b ? b.y : this._quota(g, c.x, c.y);
    if (Number.isFinite(e.xp)) c.xp = e.xp;
    else if (b?.nem) c.xp = b.x + (b.face || c.dir) * portata(b.nem.mossa).x1 * 0.85 * H;
    else c.xp = c.x + c.dir * 0.8 * H;
    c.kr = T.r; c.kpx = T.px; c.kn = T.n; c.ms = ms ?? 600; c.ang = '';
    c.tinta = PI[D.tinte[base(e.nemico)] ?? D.tinte._] ?? 0;
    const m = TT.lontano_H * H;
    c.lontano = c.x < this.vx0 - m || c.x > this.vx1 + m;
    if (c.lontano) c.kn *= TT.lontano_k;
    if (this.vivi > TT.carico_dimezza * this.N) c.kn *= 0.5;
    return c;
  }
  _strato(L, c) {
    const H = this.H, s = H / 48, dir = c.dir, kr = c.kr;
    let x = c.x, y = c.y;
    if (L.dove === 'suolo') y = c.suolo; else if (L.dove === 'portata') { x = c.xp; y = c.suolo; }
    if (L.dx) x += L.dx * dir * H;
    if (L.dy) y += L.dy * H;
    const p = L.p < 0 ? c.tinta : L.p, n = L.n == null ? 1 : Math.round(L.n * c.kn), suolo = c.suolo, rit = L.rit || 0;
    const v = (L.v ?? 3) * H, vita = L.vita ?? 0.6;
    switch (L.s) {
      case 'lampo': if (!c.lontano) this._segno(0, 'lampo', x, y, dir, (L.ms ?? 40) / 1000, Math.max(1, (L.r ?? 0.4) * H * kr), p, rit); break;
      case 'palla': this._segno(0, 'palla', x, y, dir, (L.ms ?? 300) / 1000, (L.r ?? 1) * H * kr, p, rit); break;
      case 'anello': this._segno(0, L.aria ? 'aria' : 'anello', x, y, dir, (L.ms ?? 220) / 1000, (L.r ?? 1) * H * kr, p, rit); break;
      case 'onda': {
        const r = L.rE && Number.isFinite(c.e?.[L.rE]) ? c.e[L.rE] : (L.r ?? 2) * H * kr;
        const q = this._segno(0, 'onda', x, y, L.verso === 'due' ? 0 : dir, (L.ms ?? 240) / 1000, r, p, rit); if (L.verso === 'due') q.dir = 0;
        break;
      }
      case 'nastro': { const q = this._segno(0, 'nastro', x, y, dir, (L.ms ?? 160) / 1000, (L.r ?? 0.8) * H * kr, p, rit); q.a0 = (L.a0 ?? -60) * RAD; q.a1 = (L.a1 ?? 40) * RAD; q.w = L.w ?? 3; break; }
      case 'filo': this._segno(0, 'filo', x, y, dir, (L.ms ?? 600) / 1000, (L.r ?? 1.5) * H * kr, p, rit); break;
      case 'graffi': { const q = this._segno(0, 'graffi', x, y, dir, (L.ms ?? 200) / 1000, (L.r ?? 0.4) * H * kr, p, rit); q.n = L.n ?? 3; break; }
      // (FX5) forme fini: anello a tratti (chiude: si stringe; piatto: schiacciato a terra), raggi, urto su A, falce, colonna che sorge
      case 'tratti': { const q = this._segno(0, 'tratti', x, y, dir, (L.ms ?? 240) / 1000, (L.r ?? 0.6) * H * kr, p, rit); q.n = L.n == null ? 8 : lim(n, 3, 12); q.a0 = L.chiude ? 1 : 0; q.a1 = L.piatto ?? 1; q.w = L.w ?? 3; break; }
      case 'raggi': { const q = this._segno(0, 'raggi', x, y, dir, (L.ms ?? 200) / 1000, (L.r ?? 0.6) * H * kr, p, rit); q.n = L.n == null ? 6 : lim(n, 3, 12); q.a0 = L.avanti ? 1 : 0; q.w = L.w ?? 4; break; }
      case 'urto': if (!c.lontano) this._segno(0, 'urto', x, y, dir, (L.ms ?? 220) / 1000, (L.r ?? 0.5) * H * kr, p, rit); break;
      case 'falce': { const r = L.rE && Number.isFinite(c.e?.[L.rE]) ? c.e[L.rE] : (L.r ?? 2.4) * H; this._segno(0, 'falce', x, y, dir, (L.ms ?? 260) / 1000, r, p, rit); break; }
      case 'sorge': { const q = this._segno(0, 'sorge', x, y, dir, (L.ms ?? 420) / 1000, (L.r ?? 0.6) * H * kr, p, rit); q.n = L.n == null ? 5 : lim(n, 2, 8); q.w = (L.largo ?? 0.25) * H * kr; break; }
      case 'crepe': if (n > 0) { const q = this._segno(1, 'crepe', x, y, dir, (L.ms ?? 3000) / 1000, (L.r ?? 0.8) * H * kr, p); q.n = lim(Math.round((L.n ?? 3) * Math.min(1.4, kr)), 1, 5); } break;
      case 'macchia': this._segno(1, 'macchia', x, y, dir, (L.ms ?? 5000) / 1000, (L.r ?? 1) * H * kr, p); break;
      case 'zona': this._segno(1, 'zona', x, y, dir, (c.ms ?? 600) / 1000, (L.r ?? 0.9) * H, p); break;
      case 'schegge': case 'gocce':
        for (let i = 0; i < n; i++) {
          const [vx, vy] = this._vel(L.ang || c.ang || 'tutto', dir, v);
          const d0 = L.dim?.[0] ?? 1, d1 = L.dim?.[1] ?? 2;
          this._p(L.s === 'gocce' ? GOCCIA : SCHEGGIA, x + (rnd() - 0.5) * 4 * s, y - rnd() * 3 * s, vx, vy, (L.g ?? 18) * H, vita * (0.6 + 0.6 * rnd()),
            Math.max(1, Math.round((d0 + rnd() * (d1 - d0 + 0.99)) * Math.max(1, s * kr * 0.8))), p, (rnd() * 2) | 0, suolo, L.rimb ?? 0.3, 0.4, rit);
        }
        break;
      case 'braci':
        for (let i = 0; i < n; i++) { const [vx, vy] = this._vel(L.ang || 'su', dir, v); this._p(BRACE, x + (rnd() - 0.5) * 6 * s, y, vx, vy, 3.5 * H, vita * (0.6 + 0.7 * rnd()), rnd() < 0.3 ? 2 : 1, L.p >= 0 && L.pal ? p : PI.fuoco, 1, suolo, 0, 1.2, rit); }
        break;
      case 'scintille':
        for (let i = 0; i < n; i++) { const [vx, vy] = this._vel(L.ang || c.ang || 'tutto', dir, v); this._p(SCINTILLA, x, y, vx, vy, 9 * H, vita * (0.6 + 0.6 * rnd()), Math.max(1, Math.round(s)), p, 0, suolo, 0, 2.5, rit); }
        break;
      case 'scaglie':
        for (let i = 0; i < n; i++) { const [vx, vy] = this._vel('tutto', dir, v); this._p(SCAGLIA, x + (rnd() - 0.5) * 8 * s, y + (rnd() - 0.5) * 8 * s, vx, vy, 0.8 * H, vita * (0.6 + 0.6 * rnd()), Math.max(1, Math.round(s)), p, (rnd() * 3) | 0, suolo, 0, 2.2, rit); }
        break;
      case 'fiamme':
        for (let i = 0; i < n; i++) {
          const r = Math.max(1, (L.r ?? 0.2) * H * kr * (0.6 + 0.6 * rnd()));
          this._p(FIAMMA, x + (rnd() - 0.5) * (L.r ?? 0.2) * 3 * H * kr, y - rnd() * 4 * s, (rnd() - 0.5) * 0.8 * H, -(L.sale ?? 1) * H * (0.4 + 0.5 * rnd()), -(L.sale ?? 1) * 0.6 * H,
            vita * (0.7 + 0.5 * rnd()), r, p, 0, NaN, 0, 1.5, rit + rnd() * 0.08);
        }
        break;
      case 'fumo': {
        const nv = this.hook.nuvole, tono = L.tono ?? 'chiaro';
        for (let i = 0; i < n; i++) {
          const r1 = Math.min(16, Math.max(2, (L.r ?? 0.3) * H * kr * (0.7 + 0.5 * rnd()))), vx = (rnd() - 0.5) * 1.2 * H + dir * (L.v ? L.v * H * 0.4 : 0), vy = -(L.sale ?? 0.5) * H * (0.5 + 0.6 * rnd());
          const xx = x + (rnd() - 0.5) * (L.r ?? 0.3) * 2 * H * kr, yy = y - rnd() * (L.r ?? 0.3) * H * kr;
          if (nv) nv.globo(xx, yy, vx, vy, r1 * 0.35, r1, vita * (0.7 + 0.5 * rnd()), rit + rnd() * 0.1, 1.6, 6 * s, 0.6, TONI_NUVOLE[tono] ?? 1, 0);
          else this._p(FUMO, xx, yy, vx, vy, -2 * s, vita * (0.7 + 0.5 * rnd()), r1 * 0.6, tono === 'scuro' ? PI.fumo : tono === 'vapore' ? PI.vapore : PI.polvere, 1, NaN, 0, 1.6, rit);
        }
        break;
      }
      case 'polvere': {
        const nv = this.hook.nuvole, vs = L.verso === 'avanti' ? dir : L.verso === 'dietro' ? -dir : 0;
        if (n <= 0) break;
        if (nv) sbuffo(nv, x, y, vs, n, lim((L.forza ?? 0.6) * Math.min(1.3, kr), 0, 1.3), 0);
        else for (let i = 0; i < n; i++) this._p(FUMO, x + (rnd() - 0.5) * 8 * s, y - 2 * s, (vs || (rnd() < 0.5 ? -1 : 1)) * (0.6 + rnd()) * H * (L.forza ?? 0.6), -0.3 * H * rnd(), -1 * s, 0.5 + 0.3 * rnd(), (2 + 3 * rnd()) * s, PI.polvere, 1, NaN, 0, 3, rit);
        break;
      }
      case 'luce': if (!c.lontano && this.hook.luce) this.hook.luce(x, y, L.col || [255, 220, 170], (L.r ?? 3) * H * kr, L.ms ?? 160, L.forza ?? 1); break;
      case 'scossa': if (!c.lontano && this.hook.scuoti) this.hook.scuoti((L.px ?? 3) * c.kpx * H / 60, L.ms ?? 180); break;
      case 'spinta': {
        const r = (L.r ?? 3) * H * kr;
        this.hook.nuvole?.spingi?.(x, y, r, 1);
        if (!c.lontano) this.hook.spinta?.(x, y, r);
        break;
      }
    }
  }
  /** Velocità di una particella per verso: su | tutto | avanti | dietro | ventaglio | basso. */
  _vel(ang, dir, v) {
    let a;
    switch (ang) {
      case 'su': a = -Math.PI / 2 + (rnd() - 0.5) * 1.6; break;
      case 'avanti': a = dir > 0 ? -0.35 + (rnd() - 0.5) * 1.0 : Math.PI + 0.35 + (rnd() - 0.5) * 1.0; break;
      case 'dietro': a = dir > 0 ? Math.PI + 0.4 + (rnd() - 0.5) * 1.0 : -0.4 + (rnd() - 0.5) * 1.0; break;
      case 'ventaglio': { const b = -0.25 - rnd() * 1.0; a = dir > 0 ? b : Math.PI - b; break; }
      case 'giu': a = Math.PI / 2 + (rnd() - 0.5) * 0.8; break;
      case 'basso': a = (rnd() < 0.5 ? 0 : Math.PI) + (rnd() - 0.5) * 0.4; break;
      default: a = rnd() * Math.PI * 2; if (Math.sin(a) > 0.3) a = -a;     // tutto, ma più in su che in giù
    }
    const k = v * (0.45 + 0.55 * rnd());
    return [Math.cos(a) * k, Math.sin(a) * k];
  }
  _emetti(V, e, g) {
    if (V.prima) this.ricetta(V.prima, e, g);
    const q = this.emett[this.ie]; this.ie = (this.ie + 1) % this.emett.length;
    q.on = true; q.x = e.x ?? 0; q.y = e.y ?? 0; q.w = V.larghezzaE ? (e[V.larghezzaE] ?? this.H) : 0.15 * this.H; q.t = 0;
    q.dur = Math.min(12, ((V.msE ? e[V.msE] : V.ms) ?? 1000) / 1000); q.ogni = V.ogni ?? 0.1; q.acc = 0; q.L = this.compila(V.emetti);
    const d = e.direzione; q.dir = d === 'sinistra' ? -1 : d === 'destra' ? 1 : Math.sign(e.dir || 0) || 1;
    q.ang = d === 'su' ? 'su' : d === 'giu' ? 'giu' : d === 'sinistra' || d === 'destra' ? 'avanti' : '';
    q.suolo = Number.isFinite(e.suolo) ? e.suolo : V.cade ? this._quota(g, q.x, q.y) : e.y ?? 0;   // (FIN) cade: dal soffitto al suolo sotto
    q.dopo = V.dopo || null;                                    // (FIN) ricetta alla fine (sbuffo all'apertura della bocca)
  }
  _morte(e, g) {
    const b = this._bersaglio(g, e.bersaglio), tb = base(e.nemico), piccolo = /-mini$/.test(e.nemico || '') || e.sciame, modo = modoMorte(e, b);
    const taglia = piccolo ? 'piccola' : e.elite ? 'grande' : 'media', M = D.morti;
    this.ricetta('morte:' + tb, e, g, taglia, '', undefined, M.tipo[tb] || M.tipo._);
    this.ricetta('modo:' + modo, e, g, taglia, '', undefined, M.modo[modo] || M.modo.colpo);
  }

  // ---------------------------------------------------------- preavviso in tre tempi (dallo stato)
  /** Punto della parte che colpisce, in px di mondo: dal segnale di segnali.mjs (n._seg, a schermo) o dal corpo. */
  _punto(b, n, out) {
    const S = n._seg;
    if (S && (S.fase === 'avviso' || S.fase === 'guizzo') && Number.isFinite(S.x)) { out[0] = S.x + this.camX; out[1] = S.y + this.camY0; return out; }
    out[0] = b.x + (b.face || 1) * 0.35 * this.H * (n.scala ?? 1); out[1] = b.y - (b.alto || 0) - (b.h || this.H) * 0.7;   // (SCA) dal corpo scalato
    return out;
  }
  _rilascio(b, n) {
    const F = formaRilascio(n), m = n.mossa, H = this.H, s = H / 48, face = b.face || 1, P = portata(m), pic = !!n.sciame;
    if (F.forma === 'nessuna') return;
    const A = m.fotogrammi_ms?.attivo, dur = lim(A ? (A[1] - A[0]) / 1000 : 0.15, 0.09, 1.8), pt = this._punto(b, n, this._pt || (this._pt = [0, 0]));
    const tinta = PI[D.tinte[base(n.tipo)] ?? D.tinte._] ?? 0, cy = b.y - (b.alto || 0) - (b.h || H) * 0.55;
    if (F.forma !== 'bocca') { const q = this._segno(0, 'lampo', pt[0], pt[1], face, 0.04, (pic ? 0.07 : 0.11) * H, tinta); q.sotto = !pic; }   // (FIN) grossi: lampo più piccolo e dietro il corpo
    switch (F.forma) {
      case 'arco': {
        const q = this._segno(0, 'nastro', b.x, cy, face, Math.min(0.5, dur + 0.12), Math.max(0.35 * H, P.x1 * H * 0.9), tinta);
        q.a0 = (F.a0 ?? -60) * RAD; q.a1 = (F.a1 ?? 40) * RAD; q.w = (F.w ?? 3) * 1.5 * s; q.r2 = b.y; break;   // (FX5) w ≥ 4: testa spessa 2 px ed eco interna
      }
      case 'affondo': {
        const q = this._segno(0, 'affondo', pt[0], pt[1], face, Math.min(0.45, dur + 0.1), Math.abs(b.x + face * P.x1 * H - pt[0]), tinta);
        q.r2 = (b.y - (b.alto || 0) + (P.y0 + P.y1) * 0.5 * H) - pt[1]; q.w = (F.w ?? 3) * s; break;
      }
      case 'pesta': {
        const q = this._segno(0, 'pesta', b.x + face * (P.x0 + 0.35) * H, b.y - (b.alto || 0) - (b.h || H) * 1.05, face, Math.min(0.4, dur + 0.15), (b.h || H) * 1.05, tinta);
        q.w = (F.w ?? 6) * s; break;
      }
      case 'carica': { const q = this._segno(0, 'cono', b.x, cy, face, dur, (b.h || H), tinta); q.rif = b; break; }
      // (MBC3) mini boss: l'arco lo disegna _archiMb dalla hitbox per tutta la finestra; qui il lampo dell'istante attivo, grande e chiaro
      case 'hitbox': this._segno(0, 'lampo', pt[0], pt[1], face, (MB_ARCHI?.lampo_ms ?? 70) / 1000, (MB_ARCHI?.lampo_H ?? 0.28) * H, PI.bianco); break;
      case 'fascio': { const q = this._segno(0, 'fascio', pt[0], pt[1], face, dur, Math.max(2 * H, P.x1 * H), PI.luce); q.rif = b; q.w = (F.w ?? 6) * s; break; }
      case 'bocca': {
        const e = this._e; e.tipo = 'bocca'; e.x = pt[0]; e.y = pt[1]; e.dir = face; e.nemico = n.tipo; e.bersaglio = null; e.suolo = b.y; e.xp = NaN;
        this.ricetta('bocca', e, null, pic ? 'piccola' : 'media'); break;
      }
    }
  }
  _coda(b, n, m) {
    if (!m || b.morto) return;
    if (b.atk && b.atk.colpito === b.atk.serie) return;                 // a segno: lo disegna nemico_colpisce
    const F = formaRilascio({ tipo: n.tipo, nomeMossa: n._fxn.nome, mossa: m, sciame: n.sciame }), P = portata(m);
    if (F.forma === 'bocca' || F.forma === 'fascio' || F.forma === 'nessuna' || F.forma === 'pesta' || F.forma === 'carica') return;
    if (P.y1 < -0.3 && !(F.forma === 'arco' && (F.a1 ?? 0) >= 30)) return;   // la mossa non arriva a terra
    const e = this._e; e.tipo = 'mancato'; e.x = b.x; e.y = b.y; e.dir = b.face || 1; e.nemico = n.tipo; e.bersaglio = null; e.suolo = b.y; e.xp = b.x + e.dir * P.x1 * 0.85 * this.H;
    // (MBC3) mini boss: polvere, schegge e scintille dove la mazza o la catena toccano terra (scossa sui pesanti)
    const MBt = F.forma === 'hitbox' ? MB_ARCHI?.[base(n.tipo)] : null;
    if (MBt) {
      // (MBC4) terra in tre taglie dalla forza del colpo
      const RR = MB_ARCHI.ricette, f = forzaMb(MBt, n._fxn.nome, m.danno ?? 0);
      if (RR?.terra) { this.ricetta(RR.terra[f], e, null, RR.taglie?.[f] ?? 'media'); return; }
    }
    this.ricetta(n.sciame ? 'mancato_piccolo' : 'mancato_terra', e, null);
  }
  /** Fasi delle mosse, polvere della carica, mucchio dello sciame (una lettura per nemico, nessuna allocazione dopo la prima). */
  osserva(g, dt) {
    const L = g?.bersagli;
    if (!L) return;
    const H = this.H, s = H / 48;
    let muc = 0, mx = 0, my = 0;
    for (let i = 0; i < L.length; i++) {
      const b = L[i], n = b.nem;
      if (!n) continue;
      const S = n._fxn || (n._fxn = { f: null, m: null, nome: null, tp: 0, sac: null }), f = b.morto ? null : n.fase;
      if (f !== S.f) {
        if (S.f === 'attivo') this._coda(b, n, S.m);
        if (f === 'attivo' && n.mossa) this._rilascio(b, n);
        S.f = f; S.m = n.mossa; S.nome = n.nomeMossa;
      }
      if (f === 'avviso' && !n.sciame && n.mossa) {                       // polvere che si alza ai piedi durante la carica
        S.tp += dt * D.carica.grosso.polvere_s;
        while (S.tp >= 1) { S.tp -= 1; this._p(FUMO, b.x + (rnd() - 0.5) * (b.w || H * 0.6), b.y - 1, (rnd() - 0.5) * 0.4 * H, -(0.4 + 0.5 * rnd()) * H, -0.2 * H, 0.5 + 0.3 * rnd(), (1 + 2 * rnd()) * s, PI.polvere, 0, NaN, 0, 2); }
      } else S.tp = 0;
      if (f === 'attivo' && corre(n.mossa) && !n.sciame && rnd() < dt * 18) this._p(FUMO, b.x - (b.face || 1) * 0.3 * H, b.y - 1, -(b.face || 1) * 0.8 * H, -0.3 * H, 0, 0.45, (2 + 2 * rnd()) * s, PI.polvere, 1, NaN, 0, 3);
      const fs = n.sacco?.fase || null;                                  // (FIN) atterraggio a sacco (ZOM3): sbuffo con tetto
      if (fs === 'terra' && S.sac === 'aria' && !b.morto) this._atterra(b, g);
      S.sac = fs;
      const liv = n.sci?.liv ?? 0;
      if (liv >= 2 && !b.morto) { muc++; mx = b.x; my = b.y; }
    }
    const M = this.muc;
    if (muc > 0) { M.x = mx; M.y = my; }
    if (M.prev >= 2 && muc === 0) { const e = this._e; e.tipo = 'mucchio_crolla'; e.x = M.x; e.y = M.y; e.dir = 1; e.nemico = ''; e.bersaglio = null; e.suolo = M.y; e.xp = NaN; this.nota(e, g); }
    M.prev = muc;
  }

  /** (FIN) Sbuffo d'atterraggio a sacco: al più atterra_sacco.max per finestra (decine di corpi insieme non saturano). */
  _atterra(b, g) {
    const A = D.atterra_sacco || {}, t = this.tempo;
    if (t - (this._atF ?? -1e9) >= (A.finestra_s ?? 0.25)) { this._atF = t; this.atterraggi = 0; }
    if (this.atterraggi >= (A.max ?? 4)) return;
    this.atterraggi++;
    const e = this._e; e.tipo = 'atterra_sacco'; e.x = b.x; e.y = b.y; e.dir = b.face || 1; e.nemico = b.nem?.tipo || ''; e.bersaglio = null; e.suolo = b.y; e.xp = NaN;
    this.ricetta('atterra_sacco', e, g, A.taglia || 'piccola');
  }

  // ---------------------------------------------------------- passo
  passo(dt, g = null) {
    if (!(dt > 0)) return;
    if (g?.H) this.H = g.H;
    this.tempo += dt;
    const H = this.H, s = H / 48;
    let vivi = 0;
    for (let k = 0; k < this.N; k++) {
      if (!this.on[k]) continue;
      const t = (this.t[k] += dt);
      if (t < 0) { vivi++; continue; }
      if (t >= this.vita[k]) { this.on[k] = 0; continue; }
      vivi++;
      this.vy[k] += this.g[k] * dt;
      if (this.att[k] > 0) { const f = Math.exp(-this.att[k] * dt); this.vx[k] *= f; this.vy[k] *= f; }
      this.x[k] += this.vx[k] * dt; this.y[k] += this.vy[k] * dt;
      const tp = this.tipo[k], sl = this.suolo[k];
      if (sl === sl && this.y[k] >= sl && this.vy[k] > 0 && (tp === SCHEGGIA || tp === GOCCIA || tp === BRACE || tp === SCINTILLA)) {
        this.y[k] = sl;
        if (tp === SCHEGGIA && this.vy[k] > 0.9 * H && this.rimb[k] > 0) { this.vy[k] = -this.vy[k] * this.rimb[k]; this.vx[k] *= 0.6; }
        else if (tp === SCINTILLA) { this.vita[k] = Math.min(this.vita[k], t + 0.05); this.vy[k] = 0; }
        else { this.vy[k] = 0; this.g[k] = 0; this.vx[k] *= tp === GOCCIA ? 0 : 0.3; if (tp === GOCCIA) this.rimb[k] = -1; }
      }
    }
    this.vivi = vivi;
    for (const q of this.segni) {
      if (!q.on) continue;
      q.t += dt;
      if (q.t >= q.vita) { q.on = false; q.rif = null; continue; }
      if (q.rif) {
        const b = q.rif;
        if ((b.morto || b.nem?.fase !== 'attivo') && q.t > 0.08 && q.vita - q.t > 0.12) q.vita = q.t + 0.12;
      }
      if (q.s === 'onda' && q.t > 0 && (q.acc += dt) >= 0.035) {           // sassolini sollevati dal fronte
        q.acc = 0;
        const u = q.t / q.vita, f = q.r * (1 - (1 - u) ** 1.5);
        for (let sd = -1; sd <= 1; sd += 2) { if (q.dir && sd !== q.dir) continue; this._p(SCHEGGIA, q.x + sd * f, q.y - 1, sd * 0.6 * H * rnd(), -(1.5 + 2 * rnd()) * H, 16 * H, 0.45, 1, PI.pietra, 1, q.y, 0.2, 0.5); }   // (FX5) senza array, sassolini di 1 px
      }
    }
    for (const q of this.terra) if (q.on && (q.t += dt) >= q.vita) q.on = false;
    for (const q of this.emett) {
      if (!q.on) continue;
      q.t += dt;
      if (q.t >= q.dur) {
        q.on = false;
        if (q.dopo) { const e = this._e; e.tipo = 'emettitore'; e.x = q.x; e.y = q.y; e.dir = q.dir; e.nemico = ''; e.bersaglio = null; e.suolo = NaN; e.xp = NaN; this.ricetta(q.dopo, e, g); }   // (FIN)
        continue;
      }
      q.acc += dt;
      while (q.acc >= q.ogni) {
        q.acc -= q.ogni;
        const e = this._e; e.tipo = 'emettitore'; e.x = q.x + (rnd() * 2 - 1) * q.w; e.y = q.y; e.dir = q.dir; e.nemico = ''; e.bersaglio = null; e.suolo = q.suolo; e.xp = NaN;
        const c = this._contesto(e, null, 'media', 0); c.ang = q.ang;
        for (const L of q.L) this._strato(L, c);
      }
    }
    this.osserva(g, dt);
    // (MBC4) particelle dei fronti dei colpi dei mini boss
    if (MB_ARCHI && g?.bersagli) this._archiPasso(g, dt);
  }

  // ---------------------------------------------------------- disegno
  _vista(cx, camX, camY) {
    this.camX = camX; this.camY0 = camY;
    this.vx0 = camX; this.vx1 = camX + (cx.canvas?.width ?? 640);
  }
  /** Prima dei nemici: crepe, macchie e zone a terra. */
  disegnaSotto(cx0, g, camX = 0, camY = 0) {
    nuovoFotogramma(); this._sotto = true;                               // (FIN) primo disegno degli effetti nel fotogramma
    const cx = this._cf.su(cx0);
    this._vista(cx, camX, camY);
    const s = this.H / 48, NT = this.terra.length;
    for (let j = 0; j < NT; j++) {                                       // (FIN) dalle più nuove: le più vecchie cadono per prime
      const q = this.terra[(this.it - 1 - j + 2 * NT) % NT];
      if (!q.on || q.t < 0) continue;
      if (!posto(q.s === 'crepe' ? q.n * 6 : 4)) continue;
      const X = Math.round(q.x - camX), Y = Math.round(q.y - camY), u = q.t / q.vita;
      if (X + q.r < -8 || X - q.r > this.vx1 - camX + 8) continue;
      const P = PAL[q.p] || PAL[PI.scuro];
      if (q.s === 'crepe') this._crepe(cx, q, X, Y, u, s);
      else if (q.s === 'macchia') {
        const rx = Math.round(q.r), ry = Math.max(1, Math.round(q.r * 0.16));
        cx.globalAlpha = 0.55 * (u < 0.7 ? 1 : u < 0.88 ? 0.6 : 0.3);
        cx.fillStyle = P[q.p === PI.scuro ? 0 : P.length - 2]; cx.fillRect(X - rx, Y - ry + 1, 2 * rx, ry);
        cx.fillRect(X - Math.round(rx * 0.7), Y - ry, Math.round(rx * 1.4), 2 * ry);
        if (q.p !== PI.scuro) { cx.fillStyle = P[1]; cx.fillRect(X - Math.round(rx * 0.4), Y - ry, Math.round(rx * 0.5), 1); }
      } else if (q.s === 'zona') this._zona(cx, X - q.r, X + q.r, Y, Math.min(1, u * 1.6), u > 0.8, P, s, true, this.tempo);
    }
    // (MBC4) preavviso dei mini boss: il bordo della zona che sarà colpita, a puntini tenui sotto i personaggi
    const LS = g?.bersagli;
    if (LS && MB_ARCHI) for (let i = 0; i < LS.length; i++) { const b = LS[i], n = b.nem; if (n && !b.morto && n.fase === 'avviso' && n.mossa?.hitbox) this._preavvisoMb(cx, b, n, camX, camY); }
    for (const q of this.segni) if (q.on && q.sotto && q.t >= 0 && posto(4)) this._segnoDisegna(cx, q, Math.round(q.x - camX), Math.round(q.y - camY), q.t / q.vita, s, camX, camY);   // (FIN) lampi del rilascio dei grossi
    cx.globalAlpha = 1;
  }
  _crepe(cx, q, X, Y, u, s) {
    let r = q.sem >>> 0;
    const R = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
    const calde = q.t < 0.35, passi = lim(Math.round(q.r / (3 * s)), 2, 8), step = Math.max(2, Math.round(q.r / passi));   // al più 8 tratti per ramo
    cx.globalAlpha = u < 0.7 ? 1 : u < 0.88 ? 0.6 : 0.3;
    for (let b = 0; b < q.n; b++) {
      const lato = b % 2 ? -1 : 1;
      let xx = X + Math.round((R() - 0.5) * 4 * s), yy = 0;
      const np = Math.max(2, Math.round(passi * (0.5 + 0.6 * R())));
      for (let j = 0; j < np; j++) {
        yy = lim(yy + Math.round(R() * 2.4 - 0.9), 0, Math.round(6 * s));
        cx.fillStyle = calde ? PAL[PI.caldo][2] : PAL[PI.scuro][0]; cx.fillRect(xx, Y + yy, step, Math.max(1, Math.round(s)));
        if (!calde && yy > 0) { cx.fillStyle = PAL[PI.polvere][1]; cx.fillRect(xx, Y + yy - 1, step, 1); }
        xx += lato * step;
      }
    }
  }
  /** Zona d'arrivo a terra (x0..x1 a schermo, Y suolo): striscia che si accende, colonne di luce, bordi. */
  _zona(cx, x0, x1, Y, k, guizzo, P, s, colonne, t) {
    if (x1 < x0) { const q = x0; x0 = x1; x1 = q; }
    x0 = Math.round(x0); x1 = Math.round(x1);
    const w = x1 - x0, h = Math.max(1, Math.round((1 + 3 * k) * s));
    cx.globalAlpha = guizzo ? 0.9 : 0.35 + 0.5 * k; cx.fillStyle = guizzo && (Math.floor(t * 20) & 1) ? P[0] : P[1];
    const passo = Math.max(3, Math.round(4 * s)), off = Math.floor(t * 24) % passo;
    if (!colonne) cx.fillRect(x0, Y - h, w, h);                           // piccoli: una striscia sola (40 insieme costano poco)
    else for (let x = x0 - off; x < x1; x += passo) { const a = Math.max(x0, x), b = Math.min(x1, x + passo - 1); if (b > a) cx.fillRect(a, Y - h, b - a, h); }
    cx.fillStyle = P[0]; cx.globalAlpha = 0.5 + 0.5 * k;
    const eh = Math.round((2 + 4 * k) * s);
    cx.fillRect(x0, Y - eh, Math.max(1, Math.round(s)), eh); cx.fillRect(x1 - Math.max(1, Math.round(s)), Y - eh, Math.max(1, Math.round(s)), eh);
    if (colonne && w > 6) {
      cx.fillStyle = P[1];
      for (let x = x0 + passo; x < x1 - 2; x += 2 * passo) {
        const ch = Math.round((3 + 12 * k) * s * (0.55 + 0.45 * Math.sin(t * 9 + x * 0.7)));
        cx.globalAlpha = 0.25 + 0.4 * k; cx.fillRect(x, Y - h - ch, Math.max(1, Math.round(s)), ch);
        cx.globalAlpha = 0.6 + 0.4 * k; cx.fillStyle = P[0]; cx.fillRect(x, Y - h - ch, Math.max(1, Math.round(s)), 1); cx.fillStyle = P[1];
      }
    }
  }
  /** Carica di un nemico in avviso: scintille che convergono, bagliore, zona d'arrivo. */
  _carica(cx, b, n, camX, camY, pic) {
    // (MBC3) mini boss: preavviso più deciso (carica.miniboss: più scintille, giro e bagliore più larghi)
    const m = n.mossa, H = this.H, s = H / 48, C = pic ? D.carica.piccolo : (MB_ARCHI?.[base(n.tipo)] && D.carica.miniboss) || D.carica.grosso, face = b.face || 1;
    const fine = m.fotogrammi_ms?.avviso?.[1] || 400, t = tMossa(n), k = lim(t / fine, 0, 1);
    const guizzo = faseSegnale(n) === 'guizzo' || fine - t < 110;
    const pt = this._punto(b, n, this._pc || (this._pc = [0, 0])), X = Math.round(pt[0] - camX), Y = Math.round(pt[1] - camY);
    const P = PAL[PI[D.tinte[base(n.tipo)] ?? D.tinte._] ?? 0], Z = PAL[PI[m.parabile === false ? D.carica.zona_non_parabile : D.carica.zona_parabile]];
    // zona d'arrivo a terra (non per i tiri: la chiazza di mira la disegna proiettili.mjs)
    if (!m.proiettile && D.debug?.linee_portata) {   // (GP7) linea di portata a terra: spenta (Carlo), solo per le prove
      const Pm = portata(m), yT = Math.round(b.y - camY);
      let a = b.x + face * Pm.x0 * H, z = b.x + face * Pm.x1 * H;
      if (corre(m) && Number.isFinite(n.bersX)) { a = b.x + face * 0.4 * H; z = n.bersX + face * (m.movimento?.attivo?.oltre_H ?? 0.5) * H; }
      this._zona(cx, a - camX, z - camX, yT, k, guizzo, Z, s, C.colonne, this.tempo);
    }
    // (FX5) anello a tratti che si stringe sulla parte che colpisce: quando la tocca, il colpo parte. Colore della zona a
    // terra (caldo = parabile, viola = no); nel guizzo lampeggia chiaro. Gira nel verso del colpo.
    const ts = t / 1000, fl = guizzo && (Math.floor(this.tempo * 20) & 1), nt = pic ? 4 : 8;
    const Rr = Math.round((1 - k) * (pic ? 7 : 13) * s) + (pic ? 2 : 4), rot = face * ts * 3, pt2 = 6.283185307 / nt, lt = pic ? 1 : k < 0.6 ? 3 : 2;
    cx.globalAlpha = guizzo ? 1 : 0.55 + 0.45 * k; cx.fillStyle = fl ? '#ffffff' : Z[guizzo ? 0 : Math.min(2, Z.length - 1)];
    for (let i = 0; i < nt; i++) { const a = rot + i * pt2, ca = Math.cos(a), sa = Math.sin(a); tratto(cx, Math.round(X + ca * Rr), Math.round(Y + sa * Rr * 0.8), -sa, ca, lt); }
    // schegge di 1 px che convergono sul punto (testa chiara, coda nella tinta del nemico per i grossi)
    const N = C.scintille, giro = C.giro_H * H * (1 - 0.45 * k);
    cx.globalAlpha = 0.5 + 0.5 * k; cx.fillStyle = P[0];
    for (let i = 0; i < N; i++) {
      const ph = (ts * 1.7 + i / N) % 1, r = (1 - ph) * giro + 2, a = i * 2.39996 + ts * 2.2, ca = Math.cos(a), sa = Math.sin(a) * 0.8;
      tratto(cx, Math.round(X + ca * r), Math.round(Y + sa * r), ca, sa, ph > 0.6 ? 1 : 2);
    }
    if (pic) { cx.globalAlpha = 1; cx.fillStyle = fl ? '#ffffff' : P[0]; cx.fillRect(X, Y, 1, 1); return; }
    cx.fillStyle = P[1];
    for (let i = 0; i < N; i++) {
      const ph = (ts * 1.7 + i / N) % 1, r = (1 - ph) * giro + 5, a = i * 2.39996 + ts * 2.2;
      cx.fillRect(Math.round(X + Math.cos(a) * r), Math.round(Y + Math.sin(a) * 0.8 * r), 1, 1);
    }
    // bagliore a una banda che cresce dietro il segno (la stellina la disegna segnali.mjs)
    const rg = Math.max(1, Math.round((0.5 + k * C.bagliore_px) * s * 0.6));
    cx.globalAlpha = guizzo ? 0.5 : 0.3; cx.fillStyle = fl ? '#ffffff' : P[Math.min(P.length - 1, 2)]; disco(cx, X, Y, rg);
  }
  /** Dopo i nemici: particelle, segni, cariche (piccoli, poi i grossi sopra la folla). */
  disegna(cx0, g, camX = 0, camY = 0) {
    if (!this._sotto) nuovoFotogramma();                                 // (FIN) senza disegnaSotto il fotogramma comincia qui
    this._sotto = false;
    const cx = this._cf.su(cx0);                                         // (FIN) conta le chiamate per il tetto globale
    this._vista(cx, camX, camY);
    const H = this.H, s = H / 48, W = this.vx1 - camX;
    let fa = -1, fs = '';
    const alfa = (a) => { if (a !== fa) { cx.globalAlpha = a; fa = a; } };
    const stile = (c) => { if (c !== fs) { cx.fillStyle = c; fs = c; } };
    // (FIN) segni prima delle particelle nel conto: quelli prioritari (esplosioni grandi) per primi, poi i più nuovi
    const NS = this.segni.length, n0 = TETTO_FX.n;
    for (let pass = 0; pass < 2; pass++) for (let j = 0; j < NS; j++) {
      const q = this.segni[(this.is - 1 - j + 2 * NS) % NS];
      if (pass === 0) q.vis = false;
      if (!q.on || q.t < 0 || q.sotto || !!q.prio !== (pass === 0)) continue;
      const X = Math.round(q.x - camX);
      if (q.s !== 'cono' && q.s !== 'fascio' && (X + q.r + 40 < 0 || X - q.r - 40 > W)) continue;
      const st = q.s === 'tratti' || q.s === 'raggi' ? 2 * q.n : STIMA_SEGNO[q.s] ?? 20;   // (FX5) tratti e raggi: due chiamate a tratto al più
      if ((q.vis = posto(st, !!q.prio))) TETTO_FX.n += st;               // posto promesso ai segni visibili
    }
    const promesso = TETTO_FX.n - n0;
    // particelle: prima le vicine al centro della vista, poi le altre; in ognuna dalle più nuove (cadono le più vecchie e lontane)
    const NP = this.N, mezzo = W / 2, vicino = W * 0.35;
    for (let pass = 0; pass < 2; pass++) for (let j = 0; j < NP; j++) {
      const k = (this.i - 1 - j + 2 * NP) % NP;
      if (!this.on[k] || this.t[k] < 0) continue;
      const X = Math.round(this.x[k] - camX), Y = Math.round(this.y[k] - camY);
      if (X < -16 || X > W + 16) continue;
      if ((Math.abs(X - mezzo) < vicino) !== (pass === 0)) continue;
      const tp = this.tipo[k];
      if (!posto(STIMA_P[tp])) continue;
      const u = this.t[k] / this.vita[k], P = PAL[this.pal[k]], d = Math.round(this.dim[k]);
      switch (tp) {
        case SCHEGGIA: {                                                // (FX5) da 1 px: trattino di 2 px lungo la velocità (ferma: un punto)
          alfa(banda(u)); stile(P[Math.min(P.length - 1, this.ci[k] + (u > 0.6 ? 2 : 1))]);
          if (d > 1) { cx.fillRect(X, Y - d, d, d); break; }
          const vx = this.vx[k], vy = this.vy[k], ax = vx < 0 ? -vx : vx, ay = vy < 0 ? -vy : vy;
          if (ax + ay < 0.8 * H) cx.fillRect(X, Y - 1, 1, 1); else if (ax >= ay) cx.fillRect(vx > 0 ? X - 1 : X, Y - 1, 2, 1); else cx.fillRect(X, Y - 2, 1, 2);
          break;
        }
        case GOCCIA: alfa(banda(u)); stile(P[Math.min(P.length - 1, this.ci[k] + 1)]);
          if (this.rimb[k] < 0) cx.fillRect(X - d, Y - 1, 2 * d + 1, 1); else cx.fillRect(X, Y - d, d, d); break;
        case BRACE: alfa(u < 0.7 ? 1 : 0.5); stile(P[lim(1 + (((this.tempo * 18 + k) | 0) & 1) + (u > 0.6 ? 2 : 0), 0, P.length - 1)]); cx.fillRect(X, Y, d, d); break;
        case SCINTILLA: {
          alfa(u < 0.6 ? 1 : 0.6);
          stile(P[0]); cx.fillRect(X, Y, d, d);
          const xs = Math.round(X - this.vx[k] * 0.018), ys = Math.round(Y - this.vy[k] * 0.018);
          if (Math.abs(xs - X) < d && Math.abs(ys - Y) < d) break;    // (FIN) scia sotto la testa: un fillRect solo
          stile(P[Math.min(P.length - 1, 1 + (u > 0.5 ? 1 : 0))]);
          cx.fillRect(xs, ys, d, d); break;
        }
        case SCAGLIA: { alfa(banda(u)); const f = ((this.tempo * 10 + k) | 0) & 1; stile(P[(this.ci[k] + f) % P.length]); cx.fillRect(X, Y, f ? d : 2 * d, f ? 2 * d : d); break; }
        case FIAMMA: {                                                  // lingua di fuoco: corpo tondo, punta in su, nucleo chiaro
          const r = Math.max(1, Math.round(d * (1 - 0.4 * u))), j = Math.min(P.length - 1, 1 + Math.floor(u * (P.length - 1))), lg = Math.round(r * 1.4 * (1 - u));
          alfa(u < 0.7 ? 1 : 0.6); stile(j >= P.length - 1 ? PAL[PI.fumo][1] : P[j]); disco(cx, X, Y, r);
          if (lg > 0) cx.fillRect(X - (r >> 1), Y - r - lg, Math.max(1, r), lg);
          if (u < 0.4) { stile(P[0]); disco(cx, X, Y + (r >> 2), r >> 1); }
          break;
        }
        case FUMO: { const r = Math.max(1, Math.round(d * (1 + 0.9 * u))); alfa(u < 0.4 ? 0.7 : u < 0.75 ? 0.45 : 0.22); stile(P[Math.min(P.length - 1, this.ci[k] + (u > 0.5 ? 1 : 0))]); disco(cx, X, Y, r); break; }
      }
    }
    TETTO_FX.n -= promesso;                                              // (FIN) i segni ora contano le chiamate vere
    for (const q of this.segni) {
      if (!q.on || q.t < 0 || !q.vis) continue;
      const X = Math.round(q.x - camX), Y = Math.round(q.y - camY);
      this._segnoDisegna(cx, q, X, Y, q.t / q.vita, s, camX, camY);
      fa = -1; fs = '';
    }
    // cariche: prima i piccoli, poi i grossi (sopra la folla)
    const L = g?.bersagli;
    if (L) for (let pass = 0; pass < 2; pass++) for (let i = 0; i < L.length; i++) {
      const b = L[i], n = b.nem;
      if (!n || b.morto || n.fase !== 'avviso' || !n.mossa || (!!n.sciame) !== (pass === 0)) continue;
      if (b.x < camX - 3 * H || b.x > camX + W + 3 * H) continue;
      if (!posto(pass === 0 ? 10 : 30)) continue;                       // (FIN) (FX5) piccoli: zona, 3 schegge, 4 tratti, nucleo
      this._carica(cx, b, n, camX, camY, pass === 0);
    }
    // (MBC3) archi dei mini boss dalla hitbox attiva, sopra la folla
    if (L && MB_ARCHI) for (let i = 0; i < L.length; i++) { const b = L[i]; if (b.nem && !b.morto && b.nem.mossa?.hitbox) this._archiMb(cx, b, b.nem, camX, camY); }
    cx.globalAlpha = 1;
  }
  /** (MBC3) (MBC4) Colpi della mossa di un mini boss: uno per ogni hitbox nella sua finestra (geometriaArco, disegnaArco). */
  _archiMb(cx, b, n, camX, camY) {
    const MB = MB_ARCHI[base(n.tipo)], m = n.mossa;
    if (!MB) return;
    const t = tMossa(n), H = this.H, conf = MB.mosse?.[n.nomeMossa], P = PAL[PI[MB.pal] ?? 0];
    const sp = spessoreMb(MB, forzaMb(MB, n.nomeMossa, m.danno ?? 0)) * H / 48, X0 = Math.round(b.x - camX), Y0 = Math.round(b.y - (b.alto || 0) - camY);
    cx.globalAlpha = 1;
    for (const hb of m.hitbox) {
      if (!hb.rett_H) continue;
      const G = geometriaArco(hb, m, conf?.tipo), S = statoArco(G, finestraArco(hb, m, this._fa), t, MB_ARCHI, this._sa);
      if (!S || !posto(Math.min(MB_ARCHI.tetto_chiamate ?? 520, stimaArco(G, H)))) continue;
      disegnaArco(cx, G, S, H, sp, P, X0, Y0, b.face || 1, MB_ARCHI.fine_ms ?? 90);
    }
  }
  /** (MBC4) Preavviso dei mini boss: puntini tenui sul bordo di ogni hitbox, sotto i personaggi (disegnaSotto). */
  _preavvisoMb(cx, b, n, camX, camY) {
    const MB = MB_ARCHI[base(n.tipo)], m = n.mossa, C = MB_ARCHI.preavviso;
    if (!MB || !C || C.attivo === false) return;
    const fine = m.fotogrammi_ms?.avviso?.[1] || 400, t = tMossa(n), k = lim(t / fine, 0, 1), guizzo = faseSegnale(n) === 'guizzo' || fine - t < (C.guizzo_ms ?? 110);
    const H = this.H, conf = MB.mosse?.[n.nomeMossa], P = PAL[PI[MB.pal] ?? 0];
    cx.globalAlpha = guizzo ? (C.alfa_guizzo ?? 0.85) : (C.alfa?.[0] ?? 0.3) + ((C.alfa?.[1] ?? 0.6) - (C.alfa?.[0] ?? 0.3)) * k;
    for (const hb of m.hitbox) {
      if (!hb.rett_H || !posto(C.stima ?? 60)) continue;
      disegnaPreavviso(cx, geometriaArco(hb, m, conf?.tipo), H, k, guizzo, P, Math.round(b.x - camX), Math.round(b.y - (b.alto || 0) - camY), b.face || 1, this.tempo, C);
    }
    cx.globalAlpha = 1;
  }
  /**
   * (MBC4) Particelle dei colpi dei mini boss (dal passo): schegge, polvere e scintille alzate dal fronte o dalla testa mentre
   * corre, e a fine corsa il lampo «fin qui» con uno scoppio sul bordo. Stato per nemico in n._mb4 (creato una volta).
   */
  _archiPasso(g, dt) {
    const L = g.bersagli, C = MB_ARCHI, ogni = C.particelle?.ogni_ms ?? 45;
    for (let i = 0; i < L.length; i++) {
      const b = L[i], n = b.nem;
      if (!n || b.morto) continue;
      const MB = C[base(n.tipo)], m = n.mossa;
      if (!MB || !m?.hitbox) continue;
      const Z = n._mb4 || (n._mb4 = { m: null, t: 0, fine: 0, acc: 0 }), t = tMossa(n);
      if (Z.m !== m || t < Z.t) { Z.m = m; Z.fine = 0; Z.acc = 0; }
      Z.t = t; Z.acc += dt * 1000;
      const emetti = Z.acc >= ogni, conf = MB.mosse?.[n.nomeMossa];
      if (emetti) Z.acc = 0;
      for (let k = 0; k < m.hitbox.length && k < 30; k++) {
        const hb = m.hitbox[k];
        if (!hb.rett_H) continue;
        const G = geometriaArco(hb, m, conf?.tipo), S = statoArco(G, finestraArco(hb, m, this._fa), t, C, this._sa);
        if (!S) continue;
        const T = testaArco(G, S, this._ta);
        if (S.fine >= 0 && !(Z.fine & (1 << k))) { Z.fine |= 1 << k; this._fronteMb(b, MB, G, T, true); }
        else if (emetti && S.fine < 0 && S.cu <= 0) this._fronteMb(b, MB, G, T, false);
      }
    }
  }
  /** (MBC4) Scintille (e a terra schegge e polvere) dal fronte T; fine: scoppio e lampo sul bordo. */
  _fronteMb(b, MB, G, T, fine) {
    const H = this.H, face = b.face || 1, Y0 = b.y - (b.alto || 0), pal = PI[MB.pal] ?? 0, Cp = MB_ARCHI.particelle || {};
    const aTerra = Math.abs(T[1] - G.y1) < 0.05 && Math.abs(G.y1) < 0.08;
    for (let lato = 0; lato < 2; lato++) {
      const xl = lato ? T[4] : T[0];
      if (!(xl === xl)) continue;
      const sx = lato ? -1 : 1, x = b.x + face * xl * H, y = Y0 + T[1] * H - (aTerra ? 1 : 0), ux = face * sx * T[2], uy = T[3];
      const ns = fine ? Cp.scintille_fine ?? 7 : Cp.scintille ?? 2;
      for (let j = 0; j < ns; j++) {
        const v = (fine ? 5 : 3.5) * H * (0.5 + 0.6 * rnd()), a = (rnd() - 0.5) * (fine ? 2.4 : 0.9);
        const vx = (ux * Math.cos(a) - uy * Math.sin(a)) * v, vy = (uy * Math.cos(a) + ux * Math.sin(a)) * v - (aTerra ? 1.5 * H : 0);
        this._p(SCINTILLA, x, y, vx, vy, 9 * H, (fine ? 0.32 : 0.22) * (0.6 + 0.6 * rnd()), 1, pal, 0, Y0, 0, 2.5);
      }
      if (aTerra) {
        const nk = fine ? Cp.schegge_fine ?? 5 : Cp.schegge ?? 2;
        for (let j = 0; j < nk; j++) this._p(SCHEGGIA, x - ux * rnd() * 4, Y0 - 1, (ux * (0.4 + rnd()) + (rnd() - 0.5) * 0.6) * H, -(1.6 + 2.2 * rnd()) * H, 16 * H, 0.5 + 0.3 * rnd(), rnd() < 0.3 ? 2 : 1, PI.pietra, (rnd() * 2) | 0, Y0, 0.3, 0.4);
        if (fine || rnd() < 0.6) this._p(FUMO, x - ux * 3, Y0 - 2, -ux * 0.5 * H, -(0.3 + 0.4 * rnd()) * H, -0.2 * H, 0.45 + 0.25 * rnd(), (2 + 2 * rnd()) * H / 48, PI.polvere, 0, NaN, 0, 2.5);
      }
      if (fine) this._segno(0, 'lampo', x - ux * 2, y, face, (MB_ARCHI.fine_ms ?? 90) / 1000, (Cp.lampo_fine_H ?? 0.14) * H, PI.bianco);
    }
  }
  _segnoDisegna(cx, q, X, Y, u, s, camX, camY) {
    const P = PAL[q.p] || PAL[0], H = this.H, last = P.length - 1;
    switch (q.s) {
      case 'lampo': {
        cx.globalAlpha = 1;
        if (u < 0.5) { cx.fillStyle = '#ffffff'; disco(cx, X, Y, Math.round(q.r)); cx.fillStyle = P[0]; disco(cx, X, Y, Math.round(q.r * 0.5)); }
        else { cx.globalAlpha = 0.6; cx.fillStyle = P[Math.min(1, last)]; disco(cx, X, Y, Math.round(q.r * 0.6)); }
        break;
      }
      case 'palla': {                                                     // palla di fuoco che si gonfia e si spegne
        const e = 1 - (1 - u) ** 2, R = Math.max(2, Math.round(q.r * (0.35 + 0.65 * e)));
        let r = q.sem >>> 0; const rn = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
        cx.globalAlpha = u < 0.7 ? 1 : 0.6;
        cx.fillStyle = P[Math.min(last, 3 + (u > 0.6 ? 1 : 0))];
        for (let i = 0; i < 7; i++) { const a = i * 0.9 + rn() * 0.6, d = R * (0.65 + 0.25 * rn()); disco(cx, X + Math.round(Math.cos(a) * d), Y + Math.round(Math.sin(a) * d * 0.8 - R * 0.15 * e), Math.round(R * (0.32 + 0.12 * rn()))); }
        cx.fillStyle = P[Math.min(last, 2)]; disco(cx, X, Y - Math.round(R * 0.1 * e), Math.round(R * 0.8));
        if (u < 0.75) { cx.fillStyle = P[1]; disco(cx, X, Y - Math.round(R * 0.15 * e), Math.round(R * 0.55 * (1 - 0.6 * u))); }
        if (u < 0.45) { cx.fillStyle = P[0]; disco(cx, X, Y - Math.round(R * 0.2 * e), Math.round(R * 0.3 * (1 - u))); }
        break;
      }
      case 'anello': case 'aria': {                                       // (FX5) anello a tratti di 1 px (piatto a terra o tondo in aria)
        const piatto = q.s === 'anello', R = q.r * (0.25 + 0.75 * esce(u)), ry = piatto ? Math.max(1, R * 0.22) : R, N = lim(Math.round(R / 3.5), 8, 24), len = u < 0.5 ? (piatto ? 3 : 2) : u < 0.8 ? 2 : 1;
        cx.globalAlpha = banda(u);
        for (let pass = 0; pass < 2; pass++) {                            // metà lontana chiara, metà vicina più scura: due colori, due passate
          cx.fillStyle = pass ? P[Math.min(1, last)] : P[0];
          for (let i = pass; i < N; i += 2) { const a = (i / N) * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a); tratto(cx, Math.round(X + ca * R), Math.round(Y + sa * ry), piatto ? 1 : -sa, piatto ? 0 : ca, len); }
        }
        break;
      }
      case 'onda': {                                                      // fronte che corre a terra, scia bassa dietro
        const f = q.r * (1 - (1 - u) ** 1.5), h = Math.round((7 * (1 - u) + 2) * s), w = Math.max(2, Math.round(4 * s));
        cx.globalAlpha = banda(u);
        for (let sd = -1; sd <= 1; sd += 2) {
          if (q.dir && sd !== q.dir) continue;                            // (FX5) senza array per fotogramma
          const Xf = Math.round(X + sd * f);
          cx.fillStyle = P[Math.min(last, 2)]; cx.globalAlpha = 0.45 * banda(u); cx.fillRect(Math.min(X, Xf), Y - 1, Math.abs(Xf - X), 1);
          cx.globalAlpha = banda(u);
          cx.fillStyle = P[1]; cx.fillRect(Xf - sd * 2 * w - (sd < 0 ? 0 : 0), Y - Math.round(h * 0.55), 2 * w, Math.round(h * 0.55));
          cx.fillStyle = P[0]; cx.fillRect(Xf - (w >> 1), Y - h, w, h);
        }
        break;
      }
      case 'nastro': {                                                    // (FX5) scia dell'arma: arco sottile che si apre in fretta e si consuma piano dalla coda
        const a0 = q.a0, da = q.a1 - q.a0, ah = a0 + da * Math.min(1, u / 0.3), at = a0 + da * esce(Math.max(0, (u - 0.25) / 0.75)) * 0.92;
        const N = lim(Math.round(Math.abs(ah - at) * q.r / 3), 3, 30), grosso = q.w >= 4, yMax = q.r2 ? q.r2 - camY - 1 : 1e9;
        cx.globalAlpha = u < 0.7 ? 1 : 0.55;
        let xp = Math.round(X + q.dir * Math.cos(at) * q.r), yp = Math.round(Math.min(Y + Math.sin(at) * q.r, yMax)), col = -1;
        for (let j = 1; j <= N; j++) {                                    // un rettangolo per passo: riga o colonna dal punto prima a questo
          const v = j / N, a = at + (ah - at) * v, x = Math.round(X + q.dir * Math.cos(a) * q.r), y = Math.round(Math.min(Y + Math.sin(a) * q.r, yMax));   // non sotto il suolo
          const c = v > 0.85 ? 3 : v > 0.45 ? 0 : 1, th = v > 0.75 && grosso ? 2 : 1, dx = x - xp, dy = y - yp;
          if (c !== col) { cx.fillStyle = c === 3 ? '#ffffff' : P[Math.min(c, last)]; col = c; }
          if ((dx < 0 ? -dx : dx) >= (dy < 0 ? -dy : dy)) cx.fillRect(dx < 0 ? x : xp, y, Math.max(1, dx < 0 ? -dx : dx), th);
          else cx.fillRect(x, dy < 0 ? y : yp, th, Math.max(1, dy < 0 ? -dy : dy));
          xp = x; yp = y;
        }
        if (grosso && u < 0.6) {                                          // eco interna a punti, solo dietro la testa
          cx.fillStyle = P[Math.min(2, last)];
          for (let j = N >> 1; j < N; j += 2) { const a = at + (ah - at) * (j / N); cx.fillRect(Math.round(X + q.dir * Math.cos(a) * (q.r - 3)), Math.round(Math.min(Y + Math.sin(a) * (q.r - 3), yMax)), 1, 1); }
        }
        break;
      }
      case 'affondo': {                                                   // (FX5) stoccata: filo di 1–2 px a gradini, punta bianca con la tacca, due linee di corsa
        const hd = Math.min(1, u / 0.25), tl = esce(Math.max(0, (u - 0.3) / 0.7)) * 0.95, d = q.dir;
        const x0 = X + d * q.r * tl, x1 = X + d * q.r * hd, y0 = Y + q.r2 * tl, y1 = Y + q.r2 * hd, th = q.w >= 3 ? 2 : 1;
        const nr = lim(Math.round(Math.abs(y1 - y0)) + 1, 1, 6);
        cx.globalAlpha = u < 0.7 ? 1 : 0.55;
        for (let j = 0; j < nr; j++) {
          const xa = Math.round(x0 + (x1 - x0) * j / nr), xb = Math.round(x0 + (x1 - x0) * (j + 1) / nr), y = Math.round(y0 + (y1 - y0) * (j + 0.5) / nr);
          cx.fillStyle = j === nr - 1 ? P[0] : P[Math.min(1, last)]; cx.fillRect(Math.min(xa, xb), y - (th >> 1), Math.max(1, Math.abs(xb - xa)), th);
        }
        const xm = Math.round((x0 + x1) / 2), ym = Math.round((y0 + y1) / 2), lc = Math.round(Math.abs(x1 - x0) * 0.3);
        if (lc > 1) { cx.fillStyle = P[Math.min(2, last)]; cx.fillRect(xm - (lc >> 1), ym - 3, lc, 1); cx.fillRect(xm - (lc >> 1), ym + 3, lc, 1); }
        if (u < 0.6) { cx.fillStyle = '#ffffff'; cx.fillRect(Math.round(x1) - (d > 0 ? 2 : 0), Math.round(y1) - (th >> 1), 3, th); cx.fillRect(Math.round(x1), Math.round(y1) - 2, 1, 5); }
        break;
      }
      case 'pesta': {                                                     // (FX5) colpo dall'alto: filo che cade, due fili corti ai lati, barra bianca all'arrivo che si allarga
        const hd = Math.min(1, u / 0.22), w = Math.max(2, Math.round(q.w)), L = Math.round(q.r * hd), y0 = Y + Math.round(q.r * esce(Math.max(0, (u - 0.28) / 0.72)) * 0.95), len = Math.max(0, Y + L - y0);
        cx.globalAlpha = u < 0.7 ? 1 : 0.5;
        if (len > 0) {
          cx.fillStyle = P[Math.min(last, 2)]; cx.fillRect(X - 2, y0 + (len >> 2), 1, len - (len >> 2)); cx.fillRect(X + 2, y0 + (len >> 2), 1, len - (len >> 2));
          cx.fillStyle = P[0]; cx.fillRect(X, y0, 1, len);
        }
        if (hd >= 1) {
          const lb = Math.round(w * (1 + 1.5 * esce(Math.min(1, (u - 0.22) / 0.5))));
          cx.fillStyle = '#ffffff'; cx.fillRect(X - lb, Y + L - 1, 2 * lb + 1, 1);
          cx.fillStyle = P[Math.min(1, last)]; cx.fillRect(X - lb - 1, Y + L - 3, 1, 2); cx.fillRect(X + lb + 1, Y + L - 3, 1, 2);
        }
        break;
      }
      case 'cono': {                                                      // carica: linee di corsa dietro, prua d'aria davanti
        const b = q.rif; if (!b) break;
        const Xb = Math.round(b.x - camX), Yb = Math.round(b.y - (b.alto || 0) - camY), h = b.h || H, d = q.dir, w2 = (b.w || 0.6 * H) / 2;
        cx.globalAlpha = 0.6; cx.fillStyle = P[1];
        for (let i = 0; i < 4; i++) { const L = Math.round((0.5 + 0.35 * (((this.tempo * 30 + i * 7) | 0) % 3) / 2) * H); cx.fillRect(d > 0 ? Xb - w2 - L : Xb + w2, Yb - Math.round(h * (0.15 + i * 0.22)), L, 1); }
        cx.fillStyle = P[0];
        for (let i = 0; i < 3; i++) { cx.globalAlpha = 0.7 - i * 0.2; const hh = Math.round(h * (0.85 - i * 0.25)); cx.fillRect(Xb + d * (w2 + 2 + i * 3 * s), Yb - hh - Math.round(h * 0.05), Math.max(1, Math.round(2 * s)), hh); }
        break;
      }
      case 'fascio': {                                                    // raggio della Lampada: tre bande che tremano
        const Fn = q.rif?.nem?.comp?.fascio;                              // (NEM) fascio orientato (lampada.mjs): rosso-bianco lungo la linea fissata
        if (Fn) {
          const f = 0.85 + 0.15 * Math.sin(this.tempo * 60), st = Math.max(1, Math.round(H / 24)), w = Math.max(2, Math.round(Fn.w));
          for (let s = 0; s < Fn.len; s += st) {
            const x = Math.round(Fn.x + Fn.ux * s - camX), y = Math.round(Fn.y + Fn.uy * s - camY);
            cx.globalAlpha = 0.35 * f; cx.fillStyle = '#ff3b30'; cx.fillRect(x - w, y - w, 2 * w, 2 * w);
            cx.globalAlpha = 1; cx.fillStyle = '#ffffff'; cx.fillRect(x - (w >> 2), y - (w >> 2), Math.max(1, w >> 1), Math.max(1, w >> 1));
          }
          cx.globalAlpha = 1;
          break;
        }
        const b = q.rif, f = 0.85 + 0.15 * Math.sin(this.tempo * 60), L = Math.round(q.r * Math.min(1, (q.t + 0.001) / 0.06)), w = q.w;
        const x0 = b ? Math.round(b.x - camX + q.dir * 0.3 * H) : X, y0 = b ? Math.round(b.y - (b.alto || 0) - (b.h || H) * 0.72 - camY) : Y, xa = q.dir > 0 ? x0 : x0 - L;
        cx.globalAlpha = 0.3 * f; cx.fillStyle = P[last]; cx.fillRect(xa, y0 - Math.round(w / 2) - 2, L, Math.round(w) + 4);
        cx.globalAlpha = 0.7 * f; cx.fillStyle = P[2]; cx.fillRect(xa, y0 - Math.round(w / 2), L, Math.round(w));
        cx.globalAlpha = 1; cx.fillStyle = P[0]; cx.fillRect(xa, y0 - Math.max(1, Math.round(w / 6)), L, Math.max(1, Math.round(w / 3)));
        cx.fillStyle = '#ffffff'; for (let i = 0; i < 5; i++) { const v = (this.tempo * 2.5 + i / 5) % 1; cx.fillRect(Math.round(x0 + q.dir * v * L), y0 + Math.round(Math.sin(i * 3.1 + this.tempo * 7) * w * 0.35), 1, 1); }
        disco(cx, Math.round(x0 + q.dir * L), y0, Math.max(1, Math.round(w / 3)));
        break;
      }
      case 'filo': {                                                      // punti cuciti a terra con l'ago che corre
        const hd = Math.min(1, u / 0.5), L = q.r * hd, st = Math.max(3, Math.round(4 * s));
        cx.globalAlpha = banda(u); cx.fillStyle = P[1];
        for (let x = 0, i = 0; x < L; x += st, i++) cx.fillRect(Math.round(X + q.dir * x), Y - Math.round((i & 1 ? 3 : 1) * s), Math.max(2, Math.round(2 * s)), Math.max(1, Math.round(s)));
        if (hd < 1) { cx.fillStyle = '#ffffff'; cx.fillRect(Math.round(X + q.dir * L), Y - Math.round(5 * s), Math.max(1, Math.round(s)), Math.round(4 * s)); }
        break;
      }
      case 'tratti': {                                                    // (FX5) anello a tratti: si apre (o si stringe: a0) in fretta e ruota piano; a1 = schiacciamento
        const e = esce(u), k = q.a0 ? 1 - e : e, R = Math.max(2, q.r * (0.18 + 0.82 * k)), sch = q.a1, n = q.n, rot = (q.sem & 15) * 0.4 + q.dir * 0.7 * e, len = u < 0.3 ? q.w : u < 0.65 ? Math.max(1, q.w - 1) : 1;
        cx.globalAlpha = banda(u); cx.fillStyle = u < 0.25 ? P[0] : P[Math.min(u < 0.7 ? 1 : 2, last)];
        for (let i = 0; i < n; i++) { const a = rot + (i / n) * 6.283185307, ca = Math.cos(a), sa = Math.sin(a); tratto(cx, Math.round(X + ca * R), Math.round(Y + sa * R * sch), -sa, ca * sch, len); }
        break;
      }
      case 'raggi': {                                                     // (FX5) raggi che schizzano dal punto: corpo che si accorcia, testa chiara (a0: solo nel verso del colpo)
        const e = esce(u), r1 = q.r * (0.2 + 0.8 * e), len = Math.max(1, Math.round(q.w * (1 - u))), n = q.n, a0 = q.a0 ? (q.dir > 0 ? -0.9 : Math.PI - 0.9) : (q.sem & 15) * 0.4, pa = (q.a0 ? 1.8 : 6.283185307) / n;
        cx.globalAlpha = banda(u);
        if (len > 1) { cx.fillStyle = P[Math.min(1, last)]; for (let i = 0; i < n; i++) { const a = a0 + (i + 0.5) * pa, ca = Math.cos(a), sa = Math.sin(a) * 0.85, rb = r1 - len * 0.5 - 1; tratto(cx, Math.round(X + ca * rb), Math.round(Y + sa * rb), ca, sa, len); } }
        cx.fillStyle = u < 0.45 ? '#ffffff' : P[0];
        for (let i = 0; i < n; i++) { const a = a0 + (i + 0.5) * pa; cx.fillRect(Math.round(X + Math.cos(a) * r1), Math.round(Y + Math.sin(a) * 0.85 * r1), 1, 1); }
        break;
      }
      case 'urto': {                                                      // (FX5) colpo a segno su A: un filo bianco lo attraversa nel verso del colpo, una freccia entra da dove è arrivato, un arco a tratti esce dall'altra parte
        const d = q.dir, L = q.r, e = esce(u), hd = Math.min(1, u / 0.18), tl = esce(Math.max(0, (u - 0.2) / 0.8));
        const xa = Math.round(X + d * L * (-1 + 1.7 * tl)), xb = Math.round(X + d * L * (-1 + 1.7 * hd));
        cx.globalAlpha = banda(u);
        if (xa !== xb) { cx.fillStyle = '#ffffff'; cx.fillRect(Math.min(xa, xb), Y, Math.abs(xb - xa), 1); cx.fillRect(xb - (d > 0 ? 3 : 0), Y - 1, 3, 3); }
        const xc = Math.round(X - d * (3 + L * 0.7 * (1 - e)));               // freccia: sette pixel a punta nel verso del colpo
        cx.fillStyle = u < 0.35 ? P[0] : P[Math.min(1, last)];
        for (let j = -3; j <= 3; j++) cx.fillRect(xc - d * (j < 0 ? -j : j), Y + j, 1, 1);
        const R = L * (0.35 + 0.65 * e), len = u < 0.5 ? 2 : 1;               // arco d'uscita: cinque tratti sul lato opposto
        cx.fillStyle = P[Math.min(u < 0.5 ? 1 : 2, last)];
        for (let i = -2; i <= 2; i++) { const a = i * 0.42, ca = Math.cos(a) * d, sa = Math.sin(a); tratto(cx, Math.round(X + ca * R), Math.round(Y + sa * R), -sa, ca, len); }
        break;
      }
      case 'falce': {                                                     // (FX5) spazzata della parata: due lame rase a terra che corrono ai lati, punta bianca, solco a punti dietro
        const e = esce(Math.min(1, u / 0.55)), f = q.r * e, c0 = q.r * Math.min(e, u * u);
        cx.globalAlpha = banda(u);
        for (let sd = -1; sd <= 1; sd += 2) {
          const xf = Math.round(X + sd * f), xt = Math.round(X + sd * c0), w = Math.abs(xf - xt), wm = w >> 1;
          if (w > 0) { cx.fillStyle = P[Math.min(2, last)]; cx.fillRect(Math.min(xf, xt), Y, w, 1); }
          if (wm > 0) { cx.fillStyle = P[Math.min(1, last)]; cx.fillRect(sd > 0 ? xf - wm : xf, Y - 1, wm, 1); }
          cx.fillStyle = '#ffffff'; cx.fillRect(sd > 0 ? xf - 2 : xf, Y - 1, 3, 2); cx.fillRect(xf, Y - 3, 1, 2);
          cx.fillStyle = P[Math.min(3, last)];
          for (let i = 1; i <= 5; i++) { const xx = X + sd * i * q.r / 6; if ((xx - X) * sd >= (xt - X) * sd) break; cx.fillRect(Math.round(xx), Y + 1, 2, 1); }
        }
        if (u < 0.2) { cx.fillStyle = '#ffffff'; cx.fillRect(X - 2, Y - 1, 5, 1); }
        break;
      }
      case 'sorge': {                                                     // (FX5) comparsa: fili di 1 px che salgono dal punto d'ingresso, uno dopo l'altro
        const n = q.n;
        cx.globalAlpha = banda(u);
        for (let pass = 0; pass < 2; pass++) {
          cx.fillStyle = pass ? P[0] : P[Math.min(2, last)];
          for (let i = 0; i < n; i++) {
            const rit = ((i * 5 + (q.sem & 7)) % n) / n * 0.45, v = (u - rit) / (1 - rit); if (v <= 0) continue;
            const x = X + Math.round((((i * 3) % n) - (n - 1) / 2) / n * 2 * q.w), h = Math.round(q.r * esce(v) * (0.6 + 0.4 * (((i * 7) % 5) / 4))), len = 1 + Math.round(5 * (1 - v));
            if (pass) cx.fillRect(x, Y - h - 1, 1, 1); else cx.fillRect(x, Y - h, 1, len);
          }
        }
        break;
      }
      case 'graffi': {
        cx.globalAlpha = banda(u);
        for (let i = 0; i < q.n; i++) {
          const v = lim((u - i * 0.12) / 0.35, 0, 1); if (v <= 0) continue;
          const n = Math.round(5 * v), d = Math.max(1, Math.round(s * 1.4));
          for (let j = 0; j < n; j++) { cx.fillStyle = j === n - 1 ? '#ffffff' : P[Math.min(1, last)]; cx.fillRect(Math.round(X + q.dir * (i * 4 * s + j * q.r / 5) - q.r * 0.5 * q.dir), Math.round(Y - q.r * 0.5 + j * q.r / 5), d, d); }
        }
        break;
      }
    }
  }
}
// (FIN) stima delle chiamate per unità (per decidere prima di disegnare): particelle per tipo, segni per forma
const STIMA_P = new Uint8Array([1, 1, 2, 4, 1, 2, 1]);   // SCHEGGIA, BRACE, FUMO, FIAMMA, GOCCIA, SCINTILLA, SCAGLIA
const STIMA_SEGNO = { lampo: 4, palla: 14, anello: 20, aria: 20, onda: 8, nastro: 34, affondo: 12, pesta: 6, cono: 8, fascio: 12, filo: 20, graffi: 15,
  tratti: 12, raggi: 16, urto: 18, falce: 22, sorge: 10 };   // (FX5) forme fini
export const FX_NEMICI = new FxNemici();
