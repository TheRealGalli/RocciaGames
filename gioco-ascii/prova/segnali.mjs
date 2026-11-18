// Copia di strumenti/pennino/prova/segnali.mjs (sito/strumenti/copia_sprite.py): non modificare qui.
// (UI) Segnali di lettura dei nemici, effetto della parata di A, ombre a terra. Tutto a dati: personaggi/segnali.json.
// Al posto del contorno colorato su tutto lo sprite: una stellina (parabile) o un anello spezzato (non parabile) sul punto
// che colpisce, con un alone a bande dietro la parte; il guizzo cade sul lampo già esistente (~100–120 ms prima
// dell'impatto); la finestra scoperta schiarisce appena il corpo, fa salire scintille d'oro rade e segna il punto debole.
// Le forme sono liste di pixel calcolate una volta al caricamento; nel browser si cuociono in tele piccole al primo uso
// (poi solo drawImage), in Node (contesto finto dei test) si disegnano a fillRect. Nessuna allocazione per fotogramma.
// I tempi di gioco (finestra della parata, avvisi, lampo) restano in nemici/parry.json e nei mosse.json: qui come si vedono.
import SEG from '../personaggi/segnali.json' with { type: 'json' };
import PARRY from './nemici/parry.json' with { type: 'json' };
import REGIA from '../personaggi/regia.json' with { type: 'json' };   // (REG) centro della sfida, preavviso dei grossi, ultimo nemico

export const DATI_SEGNALI = SEG;
/** Opzioni (copiate: il pannello può cambiarle). contorno_pieno: false = niente linea colorata attorno ai nemici. */
export const OPZ_SEGNALI = { ...SEG.opzioni };
const P = SEG.palette, T = SEG.tempi, MIS = SEG.misure_px, PA = SEG.parata, OM = SEG.ombre;
const DUR_LAMPO_MS = 120;              // durata del lampo in cervello.mjs (n.lampoT = 0.12)

// ------------------------------------------------------------ forme a pixel
function rgba(hex, a) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}
/** Forma: punti [dx, dy, indice colore] attorno a (0, 0) e i colori; tela cotta al primo uso nel browser. */
function forma(colori, punti, tipo) {
  let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
  for (let i = 0; i < punti.length; i += 3) { x0 = Math.min(x0, punti[i]); x1 = Math.max(x1, punti[i]); y0 = Math.min(y0, punti[i + 1]); y1 = Math.max(y1, punti[i + 1]); }
  return { tipo, colori, px: Int16Array.from(punti), x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1, tela: null };
}
/** Stellina a quattro punte: nucleo, bracci sugli assi lunghi L, punte più fredde; da L ≥ 4 un pixel in diagonale. */
function stella(L, cNucleo, cBraccio, cPunta) {
  const p = [0, 0, 0];
  for (let i = 1; i <= L; i++) { const c = i <= Math.ceil(L / 2) ? 1 : 2; p.push(i, 0, c, -i, 0, c, 0, i, c, 0, -i, c); }
  if (L >= 4) for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) p.push(a, b, 1);
  if (L >= 8) for (const [a, b] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) p.push(a, b, 2);
  return forma([cNucleo, cBraccio, cPunta], p, 'stella');
}
/** Anello di raggio r: pixel del cerchio; spezzato = vuoto attorno agli assi (dove la stella ha i bracci), centro vuoto. */
function anello(r, colori, spezzato) {
  const p = [], visti = new Set();
  for (let k = 0; k < 360; k += 2) {
    const a = k * Math.PI / 180, x = Math.round(Math.cos(a) * r), y = Math.round(Math.sin(a) * r), ch = x + ',' + y;
    if (visti.has(ch)) continue; visti.add(ch);
    if (spezzato) { const m = ((k % 90) + 90) % 90; if (m < 20 || m > 70) continue; }
    p.push(x, y, spezzato ? ((k / 90 | 0) % 2) : 0);
  }
  return forma(colori, p, spezzato ? 'anello_spezzato' : 'anello');
}
/** Alone a bande (niente sfumatura liscia): disco con due anelli di alfa, il centro un poco più pieno. */
function alone(r, hex) {
  const p = [];
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const d = Math.hypot(x, y) / r; if (d > 1) continue;
    p.push(x, y, d <= 0.5 ? 1 : 0);
  }
  return forma([rgba(hex, 0.18), rgba(hex, 0.34)], p, 'alone');
}
/** Segno del punto debole: rombo di 5 px con nucleo chiaro e bordo scuro. */
function rombo(cBordo, cCorpo, cNucleo) {
  const p = [];
  for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
    const d = Math.abs(x) + Math.abs(y); if (d > 3) continue;
    p.push(x, y, d === 3 ? 0 : d === 0 ? 2 : 1);
  }
  return forma([cBordo, cCorpo, cNucleo], p, 'rombo');
}
/** Punto esclamativo piccolo (2 × 5 + punto) con ombra a destra. */
function esclamativo(w, h, col, ombra) {
  const p = [];
  for (let y = 0; y < h + 3; y++) {
    if (y === h) continue;
    if (y > h + 1) continue;
    for (let x = 0; x < w; x++) { p.push(x + 1, y + 1, 1); p.push(x, y, 0); }
  }
  // l'ombra va sotto: si ordina mettendo prima i pixel d'ombra
  const o = [], c = [];
  for (let i = 0; i < p.length; i += 3) (p[i + 2] ? o : c).push(p[i], p[i + 1], p[i + 2]);
  return forma([col, ombra], [...o, ...c], 'esclamativo');
}

/** (FX5) Taglio di luce della parata: linea a pendenza 2:1 lunga 2L + 1, la cima piegata verso dir; cuore bianco e doppio, punte fredde. */
function taglio(L, dir) {
  const p = [];
  for (let y = -L; y <= L; y++) {
    const x = dir * Math.round(-y / 2), d = Math.abs(y) / L;
    if (d < 0.34) p.push(x + dir, y, 1);
    p.push(x, y, d < 0.5 ? 0 : d < 0.8 ? 1 : 2);
  }
  return forma([P.bianco, P.freddo, P.acciaio], p, 'taglio');
}
/** (FX5) Anello a n tratti: pixel del cerchio di raggio r entro mezzo° dal centro di ogni tratto (rot° = giro dei tratti). */
function anelloTratti(r, hex, n, mezzo, rot) {
  const p = [], visti = new Set(), passo = 360 / n;
  for (let k = 0; k < 360; k += 2) {
    const m = (((k - rot) % passo) + passo) % passo; if (Math.min(m, passo - m) > mezzo) continue;
    const a = k * Math.PI / 180, x = Math.round(Math.cos(a) * r), y = Math.round(Math.sin(a) * r), ch = x + ',' + y;
    if (visti.has(ch)) continue; visti.add(ch);
    p.push(x, y, 0);
  }
  return forma([hex], p, 'anello_tratti');
}
/** (FX5) «Ora rispondi»: due punte d'oro una dietro l'altra, alte 7 px, rivolte verso dir. */
function freccia(dir, cPunta, cDietro) {
  const p = [];
  for (let j = -3; j <= 3; j++) { const a = 3 - Math.abs(j); p.push(dir * (a - 3), j, 1, dir * a, j, 0); }
  return forma([cPunta, cDietro], p, 'risposta');
}

const LMAX = 14, RMAX = 16, TMAX = 18;
const FORME = {
  stellaFredda: [], stellaGuizzo: [], stellaImpatto: [], stellaGrigia: [],
  anelloViola: [], anelloRosso: [], anelloImpatto: [], anelloImpattoTenue: [],
  aloneFreddo: [], aloneViola: [], aloneRosso: [],
  taglioDx: [], taglioSx: [], tratti: [], trattiTenue: [],                                  // (FX5) parata riuscita
  rispostaDx: freccia(1, P.oro_luce, P.oro), rispostaSx: freccia(-1, P.oro_luce, P.oro),
  debole: rombo('#1a120a', P.oro, P.oro_luce),
  visto: esclamativo(MIS.esclamativo[0], MIS.esclamativo[1], P.freddo, '#0b0a0e'),
};
for (let L = 1; L <= LMAX; L++) {
  FORME.stellaFredda[L] = stella(L, P.bianco, P.freddo, P.acciaio);
  FORME.stellaGuizzo[L] = stella(L, P.bianco, P.bianco, P.freddo);
  FORME.stellaImpatto[L] = stella(L, P.bianco, P.freddo, P.acciaio);
  FORME.stellaGrigia[L] = stella(L, P.grigio, P.grigio, P.grigio_scuro);
}
for (let L = 2; L <= TMAX; L++) { FORME.taglioDx[L] = taglio(L, 1); FORME.taglioSx[L] = taglio(L, -1); }
for (let r = 2; r <= RMAX; r++) {
  FORME.tratti[r] = anelloTratti(r, P.freddo, 8, 12, 0);
  FORME.trattiTenue[r] = anelloTratti(r, P.acciaio, 8, 5, 22.5);
  FORME.anelloViola[r] = anello(r, [P.viola, P.viola_cupo], true);
  FORME.anelloRosso[r] = anello(r, [P.rosso, P.rosso_cupo], true);
  FORME.anelloImpatto[r] = anello(r, [P.freddo], false);
  FORME.anelloImpattoTenue[r] = anello(r, [P.acciaio], false);
  FORME.aloneFreddo[r] = alone(r, P.freddo);
  FORME.aloneViola[r] = alone(r, P.viola);
  FORME.aloneRosso[r] = alone(r, P.rosso);
}
export { FORME as FORME_SEGNALI };

function cuoci(F) {
  const c = document.createElement('canvas'); c.width = F.w; c.height = F.h;
  const x = c.getContext('2d');
  for (let i = 0; i < F.px.length; i += 3) { x.fillStyle = F.colori[F.px[i + 2]]; x.fillRect(F.px[i] - F.x0, F.px[i + 1] - F.y0, 1, 1); }
  F.tela = c;
}
/** Disegna la forma centrata in (x, y) a pixel interi. */
export function stampa(cx, F, x, y) {
  if (!F) return;
  x = Math.round(x); y = Math.round(y);
  if (typeof document !== 'undefined') { if (!F.tela) cuoci(F); cx.drawImage(F.tela, x + F.x0, y + F.y0); return; }
  for (let i = 0; i < F.px.length; i += 3) { cx.fillStyle = F.colori[F.px[i + 2]]; cx.fillRect(x + F.px[i], y + F.px[i + 1], 1, 1); }
}
const lim = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------ dati dei segnali (puri, provati in Node)
/** Segnale di una mossa: {parte|null, al, tipo 'parabile'|'non_parabile', forma 'stella'|'anello_spezzato'}. */
export function segnaleMossa(idNemico, nomeMossa, mossa) {
  const d = SEG.nemici[idNemico]?.mosse?.[nomeMossa];
  const parabile = mossa?.parabile === true;
  return { parte: d?.parte ?? mossa?.lampo_parte ?? null, al: d?.al ?? [0.5, 0.5], tipo: parabile ? 'parabile' : 'non_parabile', forma: parabile ? 'stella' : 'anello_spezzato' };
}
/** Una mossa d'attacco ha un avviso (e quindi un segnale). */
export const mossaConAvviso = (m) => !!m?.fotogrammi_ms?.avviso;
/**
 * Tempi del guizzo rispetto all'inizio della mossa (ms): {inizio, fine, impatto, dinamico}. Parabili: il lampo di
 * cervello.mjs (lampo_ms prima dell'attivo, 120 ms); chi carica a mira fissa lo accende a distanza (dinamico). Non
 * parabili: gli ultimi guizzo_ms dell'avviso.
 */
export function tempiGuizzo(m) {
  const F = m?.fotogrammi_ms, av = F?.avviso; if (!av) return null;
  const impatto = F.attivo ? F.attivo[0] : av[1];
  if (m.parabile === true) {
    if (m.movimento?.attivo?.mira_fissa) return { inizio: null, fine: null, impatto: null, dinamico: true };
    const inizio = impatto - (PARRY.lampo_ms ?? 100);
    return { inizio, fine: inizio + DUR_LAMPO_MS, impatto, dinamico: false };
  }
  return { inizio: av[1] - T.guizzo_ms, fine: av[1], impatto, dinamico: false };
}
/** ms dall'inizio della mossa corrente. */
function tMossa(n) { const c = n.motore?.corrente; return c ? c.t * 1000 : (n.animT || 0); }
/** Fase del segnale: 'guizzo' | 'avviso' | 'scoperto' | 'stordito' | ''. */
export function faseSegnale(n) {
  if (n.stato === 'stordito') return 'stordito';
  const m = n.mossa, parabile = m?.parabile === true;
  if (parabile && n.lampoT > 0) return 'guizzo';
  if (n.fase === 'avviso') {
    if (m && !parabile) { const fine = m.fotogrammi_ms?.avviso?.[1], t = tMossa(n); if (fine != null && t < fine && fine - t <= T.guizzo_ms) return 'guizzo'; }
    return 'avviso';
  }
  if ((m?.scoperto?.includes(n.fase)) || m?.punizione || n.vulnerabile > 0) return 'scoperto';
  return '';
}
/**
 * Colore del contorno pieno dello sprite: quello di base (= nessun contorno disegnato) salvo opzione contorno_pieno o
 * stato elementale che lo chiede (AB). Con le opzioni predefinite avviso e scoperto non accendono la linea.
 */
export function coloreContorno(n, ts, base, opz = OPZ_SEGNALI) {
  let col = base;
  if (opz.contorno_pieno) {
    const lamp = Math.floor((n.animT || 0) / 70) % 2 === 0;
    if (n.fase === 'avviso') col = n.mossa?.parabile === false ? (lamp ? '#b25cff' : '#e0b8ff') : (lamp ? '#ff3b2e' : '#ffb347');
    else if (n.mossa?.scoperto?.includes(n.fase) || n.mossa?.punizione) col = '#ffd36b';
    else if (n.stato === 'stordito') col = '#ffe9a8';
  }
  if (ts?.contorno && col === base) col = ts.contorno === true ? ts.colore : ts.contorno;
  return col;
}
/** Schiarita del corpo nella finestra scoperta (0 = niente). */
export const schiaritaCorpo = (n) => (faseSegnale(n) === 'scoperto' ? OPZ_SEGNALI.schiarisci_scoperto || 0 : 0);

/** Punto della parte (spazio della figura: px dello sprite dai piedi, prima di verso e scala) in out [x, y]; false = ripiego. */
export function puntoParte(n, A, nome, al, out) {
  const L = n._comp;
  if (nome && L) for (let i = 0; i < L.length; i++) {
    const c = L[i], q = c.parte; if (q.nome !== nome) continue;
    const w = q.rett[2], h = q.rett[3], lx = q.perno[0] - q.origine[0], ly = q.perno[1] - q.origine[1];
    const px = al[0] * w - lx, py = al[1] * h - ly, a = (c.ang || 0) * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
    out[0] = c.x + px * co - py * si; out[1] = c.y + px * si + py * co;
    return true;
  }
  out[0] = 0; out[1] = -0.7 * (A?.piedi?.[1] ?? 48);    // centro alto del corpo
  return false;
}

// ------------------------------------------------------------ disegno sui nemici
let BAGLIORE = null, TONI = null;
/** prova.mjs passa lo strato del bagliore (facoltativo) e la tabella dei toni (bagliore.mjs → TONO). */
export function collegaBagliore(b, toni) { BAGLIORE = b; TONI = toni; }

const PT = [0, 0];
function stato(n) { return n._seg || (n._seg = { fase: '', x: 0, y: 0, tipo: '', notaPrima: false, vistoT: -1e9 }); }
function aggiornaPunto(S, n, b, X, Y, s) {
  const N = n.N, A = N?.atlante, id = N?.id ?? n.tipo;
  if (S.fase === 'scoperto') {
    const deb = SEG.nemici[id]?.debole;
    puntoParte(n, A, deb, [0.5, 0.5], PT);
  } else {
    const d = SEG.nemici[id]?.mosse?.[n.nomeMossa];
    puntoParte(n, A, d?.parte ?? n.mossa?.lampo_parte, d?.al ?? [0.5, 0.5], PT);
  }
  S.x = X + Math.round(b.face * PT[0] * s); S.y = Y + Math.round(PT[1] * s);
  S.tipo = n.mossa?.parabile === true ? 'parabile' : 'non_parabile';
}

/** Prima dello sprite: alone a bande dietro la parte che colpisce (avviso e guizzo). */
export function segnaliDietro(cx, b, X, Y, s) {
  const n = b.nem, S = stato(n);
  S.fase = faseSegnale(n);
  if (S.fase !== 'avviso' && S.fase !== 'guizzo' && S.fase !== 'scoperto') return;
  aggiornaPunto(S, n, b, X, Y, s);
  if (!OPZ_SEGNALI.alone || S.fase === 'scoperto') return;
  const g = S.fase === 'guizzo', k = lim(tMossa(n) / T.accensione_ms, 0, 1);
  const r = lim(Math.round((g ? MIS.alone + 2 : MIS.alone - 1 + k) * Math.max(1, s * 0.75)), 2, RMAX);
  const F = S.tipo === 'parabile' ? FORME.aloneFreddo[r] : (g ? FORME.aloneRosso[r] : FORME.aloneViola[r]);
  stampa(cx, F, S.x, S.y);
}

/** Dopo lo sprite: stellina / anello spezzato, scintille della finestra scoperta, segno del punto debole, «!» del vedere. */
export function segnaliDavanti(cx, b, X, Y, s, top) {
  const n = b.nem, S = stato(n), o = n.orologio || 0, H = b.H;
  // «ti ho visto»: solo quando il nemico si accorge di A, piccolo, per visto_ms
  if (n.nota && !S.notaPrima) S.vistoT = o;
  S.notaPrima = !!n.nota;
  if (OPZ_SEGNALI.esclamativo_visto && o - S.vistoT < T.visto_ms / 1000 && S.fase !== 'guizzo') {
    const sale = Math.min(3, Math.round((o - S.vistoT) * 30));
    stampa(cx, FORME.visto, X - 1, top - sale);
  }
  const f = S.fase;
  if (f === 'avviso' || f === 'guizzo') {
    const g = f === 'guizzo', t = tMossa(n), k = lim(t / T.accensione_ms, 0, 1), tw = (Math.floor(t / 140) & 1);
    if (S.tipo === 'parabile') {
      if (g) {   // scatto: nasce grande e bianca, rientra in 120 ms
        const kk = lim((n.lampoT || 0) / 0.12, 0, 1), L = lim(Math.round(MIS.stella_guizzo * (0.45 + 0.55 * kk)), 2, LMAX);
        stampa(cx, FORME.stellaGuizzo[L], S.x, S.y);
        if (OPZ_SEGNALI.bagliore && BAGLIORE) BAGLIORE.punto(S.x, S.y, 0.32 * H * (0.5 + 0.5 * kk), TONI?.bianco ?? 1, 0.85 * kk + 0.15);
      } else {
        const L = lim(Math.round(1 + k * (MIS.stella_avviso - 1)) - tw * (k >= 1 ? 1 : 0), 1, LMAX);
        stampa(cx, FORME.stellaFredda[L], S.x, S.y);
      }
    } else {
      const r = g ? MIS.anello_guizzo : MIS.anello_avviso + (tw && k >= 1 ? 1 : 0);
      stampa(cx, g ? FORME.anelloRosso[r] : FORME.anelloViola[r], S.x, S.y);
      if (g) { cx.fillStyle = P.rosso; cx.fillRect(S.x, S.y, 1, 1); }
      if (g && OPZ_SEGNALI.bagliore && BAGLIORE) BAGLIORE.punto(S.x, S.y, 0.22 * H, TONI?.cremisi ?? 3, 0.45);
    }
  } else if (f === 'scoperto') {
    // scintille d'oro rade che salgono attorno al corpo (deterministiche) e il punto debole che pulsa a 4 Hz
    const w = b.w, base = Y - Math.round(b.h * 0.25);
    for (let i = 0; i < 4; i++) {
      const u = (o * 0.9 + i * 0.27) % 1; if (u > 0.85) continue;
      cx.fillStyle = u < 0.3 ? P.oro_luce : P.oro;
      cx.fillRect(X + Math.round((((i * 7) % 5) - 2) * 0.22 * w), base - Math.round(u * b.h * 0.7), 1, i === 0 && u < 0.4 ? 2 : 1);
    }
    if ((Math.floor(o * 8) & 1) === 0) stampa(cx, FORME.debole, S.x, S.y);
  }
}

// ------------------------------------------------------------ parata di A
/**
 * Effetto della parata. Riuscita (tipo 0), in quattro segni fini che si leggono in ordine: taglio di luce diagonale (la cima
 * piegata nel verso del colpo respinto: entra in due fotogrammi, si ritira piano), anello a tratti che si apre, schegge di
 * luce nel verso del colpo respinto, e la freccia d'oro verso il nemico finché dura = ora si può rispondere. Presto / tardi
 * (tipo 1): scintilla grigia smorzata. Non parabile (tipo 2): anello viola che si stringe. Forme cotte (nel browser un
 * drawImage l'una), pool fisso, nessuna allocazione per fotogramma.
 */
const esce = (u) => 1 - (1 - u) * (1 - u) * (1 - u);     // entrata rapida, coda lenta
const PA_TAGLIO = lim(PA.taglio_px ?? 14, 2, TMAX), PA_VITA_CORTA = Math.max(PA.stella_ms, PA.anello_ms, PA.taglio_ms ?? 0, PA.schegge_ms ?? 0), PA_VITA = Math.max(PA_VITA_CORTA, PA.risposta_ms ?? 0);
export class FxParata {
  constructor(n = 6) {
    this.pool = [];
    for (let i = 0; i < n; i++) this.pool.push({ on: false, tipo: 0, x: 0, y: 0, dir: 1, t: 0, vita: 0.2, sem: 0, risp: true });
    this.i = 0;
  }
  /** risp: mostra la freccia «ora rispondi» (non per i proiettili rimandati: lì non c'è risposta). */
  accendi(tipo, x, y, dir = 1, risp = true) {
    const q = this.pool[this.i]; this.i = (this.i + 1) % this.pool.length;
    q.on = true; q.tipo = tipo; q.x = x; q.y = y; q.dir = dir; q.t = 0; q.sem = (q.sem * 5 + 3) & 15; q.risp = risp;
    q.vita = (tipo === 0 ? (risp ? PA_VITA : PA_VITA_CORTA) : PA.smorzata_ms) / 1000;
  }
  /** Evento di g.fx: 'parata' → perfetta; 'parry_esito' (≠ perfetto) → smorzata. Restituisce true se l'ha preso. */
  evento(e, H) {
    if (e.tipo === 'parata') { this.accendi(0, e.x, e.y, e.dir || 1, e.mossa !== 'proiettile'); return true; }
    if (e.tipo === 'parry_esito' && e.esito && e.esito !== 'perfetto') { this.accendi(e.esito === 'non parabile' ? 2 : 1, e.x, e.y + 0.42 * H, 0); return true; }
    return false;
  }
  aggiorna(dt) { for (const q of this.pool) if (q.on && (q.t += dt) >= q.vita) q.on = false; }
  disegna(cx, camX, H = 48, bagliore = null, toni = null) {
    for (const q of this.pool) {
      if (!q.on) continue;
      const X = Math.round(q.x - camX), Y = Math.round(q.y), ms = q.t * 1000;
      if (q.tipo === 0) {
        const d = q.dir < 0 ? -1 : 1, ka = ms / PA.anello_ms, ks = ms / PA.stella_ms, kt = ms / (PA.taglio_ms ?? 210), kb = ms / (PA.bagliore_ms ?? 170), kg = ms / (PA.schegge_ms ?? 190);
        if (ka < 1) {                               // anello a tratti che si apre: larghi e freddi, poi punti d'acciaio girati di mezzo passo
          const r = lim(Math.round(PA.anello_px[0] + (PA.anello_px[1] - PA.anello_px[0]) * esce(ka)), 2, RMAX);
          stampa(cx, ka < 0.55 ? FORME.tratti[r] : FORME.trattiTenue[r], X, Y);
        }
        if (kg < 1) {                               // schegge di luce nel verso del colpo respinto: trattini che si accorciano
          const n = PA.schegge ?? 4, e = esce(kg), len = kg < 0.45 ? 3 : kg < 0.8 ? 2 : 1;
          cx.fillStyle = kg < 0.4 ? P.bianco : kg < 0.75 ? P.freddo : P.acciaio;
          for (let i = 0; i < n; i++) {
            const a = ((i + 0.5) / n - 0.5) * 1.1 - 0.28 + (((q.sem + i * 3) % 5) - 2) * 0.05, dist = (PA.schegge_px ?? 20) * (0.55 + 0.45 * (((q.sem + i * 7) % 4) / 3)) * e + 4;
            const x = Math.round(X + d * Math.cos(a) * dist), y = Math.round(Y + Math.sin(a) * dist + 5 * kg * kg);
            cx.fillRect(d > 0 ? x - len + 1 : x, y, len, 1);
          }
        }
        if (kt < 1) {                               // taglio di luce: 60 % → pieno in ~35 ms, poi si ritira piano
          const L = kt < 0.17 ? PA_TAGLIO * (0.6 + 0.4 * kt / 0.17) : PA_TAGLIO * (1 - 0.78 * esce((kt - 0.17) / 0.83));
          stampa(cx, (d > 0 ? FORME.taglioDx : FORME.taglioSx)[lim(Math.round(L), 2, TMAX)], X, Y);
        }
        if (ks < 1) stampa(cx, FORME.stellaImpatto[lim(Math.round(PA.stella_px * (1 - 0.7 * ks)), 1, LMAX)], X, Y);   // nucleo: stellina che rientra
        if (kb < 1 && bagliore) bagliore.punto(X, Y, PA.bagliore_H * H * (1 - 0.5 * kb), toni?.bianco ?? 1, 1 - kb);
        const da = PA.risposta_da_ms ?? 110;
        if (q.risp && ms >= da && PA.risposta_ms) {           // «ora rispondi»: freccia d'oro verso il nemico; lampeggia all'entrata e all'uscita
          const kr = (ms - da) / Math.max(1, q.vita * 1000 - da);
          if (kr > 0.3 && kr < 0.8 ? true : (Math.floor(ms / 45) & 1) === 0) stampa(cx, d > 0 ? FORME.rispostaDx : FORME.rispostaSx, X + d * ((PA.risposta_px ?? 9) + Math.round(3 * esce(Math.min(1, kr * 2)))), Y);
        }
      } else if (q.tipo === 1) {
        const k = lim(ms / PA.smorzata_ms, 0, 1), L = lim(Math.round(3 - 2 * k), 1, LMAX), d = 2 + Math.round(4 * k);
        stampa(cx, FORME.stellaGrigia[L], X, Y);
        cx.fillStyle = P.grigio_scuro; cx.fillRect(X - d, Y - 1, 1, 1); cx.fillRect(X + d, Y - 2, 1, 1); cx.fillRect(X + 1, Y + d - 1, 1, 1);
      } else {
        const k = lim(ms / PA.smorzata_ms, 0, 1);
        stampa(cx, FORME.anelloViola[lim(Math.round(5 - 3 * k), 2, RMAX)], X, Y);
      }
    }
  }
}
/** Parametri della luce della parata (prova.mjs → luci.accendi). */
export const LUCE_PARATA = Object.freeze({ col: PA.luce_colore, raggio_H: PA.luce_raggio_H, ms: PA.luce_ms, forza: PA.luce_forza, scintille: PA.scintille_particelle });

// ------------------------------------------------------------ ombre a terra
/** Superficie sotto (x, y) fra solidi e piattaforme: out {ok, y, x0, x1} con i tratti adiacenti alla stessa quota uniti. */
export function superficieSotto(M, x, y, out) {
  out.ok = false; out.y = 1e9; out.x0 = 0; out.x1 = 0; out.k = 0;
  const liste = [M?.solidi, M?.piattaforme];
  for (let l = 0; l < 2; l++) { const L = liste[l]; if (!L) continue;
    for (let i = 0; i < L.length; i++) { const s = L[i]; if (x >= s.x && x <= s.x + s.w && s.y >= y - 1 && s.y < out.y) { out.ok = true; out.y = s.y; out.x0 = s.x; out.x1 = s.x + s.w; } } }
  const PL = M?.pendenze;                       // (GEO) pendenze: superficie inclinata (out.k = dy/dx), tratto = la pendenza
  if (PL) for (let i = 0; i < PL.length; i++) { const P = PL[i]; if (P.soffitto || x < P.x0 || x > P.x1) continue;
    const q = P.yA + P.k * (x - P.x0); if (q >= y - 1 && q < out.y) { out.ok = true; out.y = q; out.x0 = P.x0; out.x1 = P.x1; out.k = P.k; } }
  if (!out.ok || out.k) return out;
  for (let giro = 0; giro < 3; giro++) {           // unisce i tratti che si toccano alla stessa quota (pavimento a pezzi)
    let cresce = false;
    for (let l = 0; l < 2; l++) { const L = liste[l]; if (!L) continue;
      for (let i = 0; i < L.length; i++) { const s = L[i]; if (Math.abs(s.y - out.y) > 1) continue;
        if (s.x <= out.x0 && s.x + s.w >= out.x0 - 1 && s.x < out.x0) { out.x0 = s.x; cresce = true; }
        if (s.x + s.w >= out.x1 && s.x <= out.x1 + 1 && s.x + s.w > out.x1) { out.x1 = s.x + s.w; cresce = true; } } }
    if (!cresce) break;
  }
  return out;
}
const SUP = { ok: false, y: 0, x0: 0, x1: 0 };
const OMBRE_COTTE = new Map();   // (MOD) ombre a terra piana già cotte: misura × forza → tela
/**
 * Ombra a terra di una figura (piedi in x, y del mondo; larghezza w px; H px): ellisse a tre bande che si stringe e
 * schiarisce con la quota, si allunga e si sposta via dalla luce (lato = -1, 0, 1: da dove arriva), tagliata ai bordi
 * della superficie sotto. volo: quota massima più alta (i volanti la tengono proporzionata). Solo fillRect a righe.
 */
export function ombraFigura(cx, M, x, y, w, H, camX, lato = 0, volo = false) {
  superficieSotto(M, x, y, SUP); if (!SUP.ok) return;
  const qmax = volo ? OM.quota_max_volo_H : OM.quota_max_H, d = Math.max(0, (SUP.y - y) / H); if (d > qmax) return;
  const f = Math.max(OM.minimo, 1 - (d / qmax) * (1 - OM.minimo)), al = Math.abs(lato) * OM.allunga_luce;
  const ww = Math.max(6, Math.round(w * f * (1 + al))), hh = Math.max(2, Math.round(H * OM.alto_px * f + 1));
  const c = Math.round(x - camX - lato * w * OM.sposta_luce * f), xa = Math.round(SUP.x0 - camX), xb = Math.round(SUP.x1 - camX), y0 = Math.round(SUP.y - hh / 2);
  cx.fillStyle = '#000000';
  if (SUP.k) {                                   // (GEO) sulla pendenza: ellisse a colonne che segue la superficie
    for (let k = 0; k < OM.bande.length; k++) {
      const fb = OM.bande[k][0], R = ww / 2 * fb; cx.globalAlpha = OM.bande[k][1] * f;
      for (let X = Math.max(Math.round(c - R), xa); X < Math.min(Math.round(c + R), xb); X++) {
        const u = (X + 0.5 - c) / R; if (Math.abs(u) >= 1) continue;
        const hv = Math.max(1, Math.round(hh / 2 * Math.max(0.5, fb) * Math.sqrt(1 - u * u))), yc = SUP.y + SUP.k * (X + camX - x);
        cx.fillRect(X, Math.round(yc - hv / 2), 1, hv);
      }
    }
    cx.globalAlpha = 1; return;
  }
  if (typeof document !== 'undefined') {         // (MOD) a terra piana: forma a bande cotta per misura, un drawImage invece di ~20 fillRect
    const k = ww * 4096 + hh * 64 + Math.round(f * 32);
    let T = OMBRE_COTTE.get(k);
    if (!T) {
      if (OMBRE_COTTE.size > 400) OMBRE_COTTE.clear();
      T = document.createElement('canvas'); T.width = ww + 2; T.height = hh;
      const x = T.getContext('2d'), cc = (ww >> 1) + 1; x.fillStyle = '#000000';
      for (let q = 0; q < OM.bande.length; q++) {
        const fb = OM.bande[q][0]; x.globalAlpha = OM.bande[q][1] * f;
        for (let j = 0; j < hh; j++) {
          const v = (j + 0.5 - hh / 2) / (hh / 2 * Math.max(0.5, fb)); if (Math.abs(v) >= 1) continue;
          const hw = Math.round(ww / 2 * fb * Math.sqrt(1 - v * v)); if (hw > 0) x.fillRect(cc - hw, j, hw * 2, 1);
        }
      }
      OMBRE_COTTE.set(k, T);
    }
    const sx = c - (ww >> 1) - 1, a = Math.max(sx, xa), z = Math.min(sx + T.width, xb);
    cx.globalAlpha = 1; if (z > a) cx.drawImage(T, a - sx, 0, z - a, hh, a, y0, z - a, hh);
    return;
  }
  for (let k = 0; k < OM.bande.length; k++) {
    const fb = OM.bande[k][0]; cx.globalAlpha = OM.bande[k][1] * f;
    for (let j = 0; j < hh; j++) {
      const v = (j + 0.5 - hh / 2) / (hh / 2 * Math.max(0.5, fb)); if (Math.abs(v) >= 1) continue;
      const hw = Math.round(ww / 2 * fb * Math.sqrt(1 - v * v)), a = Math.max(c - hw, xa), z = Math.min(c + hw, xb);
      if (z > a) cx.fillRect(a, y0 + j, z - a, 1);
    }
  }
  cx.globalAlpha = 1;
}

// ------------------------------------------------------------ (REG) regia della sfida nel mondo
// Dentro la trasformazione della camera (x già meno camX, y del mondo). Dati: personaggi/regia.json.
const RG = REGIA.grossi, aloniGrossi = new Map();
/** Alone largo e schiacciato a tre bande (alfa da regia.json) per il preavviso dei grossi: cotto una volta per raggio. */
function aloneGrosso(r) {
  let F = aloniGrossi.get(r);
  if (F) return F;
  const p = [], ry = Math.max(2, Math.round(r * 0.7)), [a0, a1, a2] = RG.alfa;
  for (let y = -ry; y <= ry; y++) for (let x = -r; x <= r; x++) {
    const d = Math.hypot(x / r, y / ry); if (d > 1) continue;
    p.push(x, y, d <= 0.4 ? 2 : d <= 0.72 ? 1 : 0);
  }
  F = forma([rgba(RG.colore, a0), rgba(RG.colore, a1), rgba(RG.colore, a2)], p, 'alone_grosso');
  aloniGrossi.set(r, F); return F;
}
/**
 * (REG) Prima dei nemici: segno discreto sul centro da raggiungere (attesa della sfida) e preavviso diffuso degli attacchi
 * dei grossi (alone largo a bande che cresce durante l'avviso, striscia a terra che pulsa; niente linea attorno allo sprite).
 * S: StatoSfida di regia.mjs; grossi: lista da grossiInAvviso(); t: secondi.
 */
export function regiaDietro(cx, S, grossi, camX, H, t = 0) {
  const C = S?.centro;
  if (C) {
    const w = Math.round(REGIA.centro.largo_H * H), X = Math.round(C.x - camX), Y = Math.round(C.y), k = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 0.7);
    cx.globalAlpha = 0.3 + 0.35 * k; cx.fillStyle = REGIA.centro.colore;
    cx.fillRect(X - (w >> 1), Y - 1, 3, 1); cx.fillRect(X + (w >> 1) - 3, Y - 1, 3, 1);          // due tacche ai lati
    cx.fillRect(X - (w >> 1), Y - 3, 1, 2); cx.fillRect(X + (w >> 1) - 1, Y - 3, 1, 2);
    cx.fillRect(X - 1, Y - 1, 3, 1);
    for (let i = 0; i < 3; i++) { const u = (t * 0.35 + i / 3) % 1; cx.globalAlpha = (1 - u) * 0.5; cx.fillRect(X + (i - 1) * 4, Y - 3 - Math.round(u * 0.9 * H), 1, 1); }   // granelli che salgono
    cx.globalAlpha = 1;
  }
  if (!grossi?.length) return;
  for (let i = 0; i < grossi.length; i++) {
    const b = grossi[i], n = b.nem, guizzo = faseSegnale(n) === 'guizzo', fine = n.mossa?.fotogrammi_ms?.avviso?.[1] || 400;
    const k = guizzo ? 1 : lim(tMossa(n) / fine, 0, 1), R = RG.raggio_H * H, passo = RG.passo_px || 4;
    const r = Math.max(passo, Math.round(R * (0.55 + 0.45 * k) / passo) * passo);
    const X = Math.round(b.x - camX), Y = Math.round(b.y - (b.h || H) * 0.45);
    stampa(cx, aloneGrosso(r), X, Y);
    if (guizzo) stampa(cx, aloneGrosso(Math.max(passo, Math.round(r * 0.5 / passo) * passo)), X, Y);
    const tw = Math.round(RG.terra_H * H * (0.6 + 0.4 * k)), lampo = guizzo || (Math.floor(t * 8) & 1);   // striscia a terra
    cx.globalAlpha = lampo ? 0.55 : 0.3; cx.fillStyle = RG.colore;
    cx.fillRect(X - tw, Math.round(b.y), 2 * tw, 1); cx.fillRect(X - (tw >> 1), Math.round(b.y) + 1, tw, 1);
    cx.globalAlpha = 1;
  }
}
/** (REG) Dopo i nemici: freccia d'oro che ondeggia sopra l'ultimo nemico rimasto (fuori vista la indica hud.mjs). */
export function regiaDavanti(cx, S, camX, H, t = 0) {
  const u = S?.ultimo; if (!u?.b) return;
  const b = u.b, X = Math.round(b.x - camX), Y = Math.round(b.y - (b.h || H) - 6 - 2 * Math.abs(Math.sin(t * 5)));
  cx.fillStyle = '#000000'; for (let a = 0; a < 4; a++) cx.fillRect(X - 3 + a + 1, Y + a + 1, 7 - 2 * a, 1);
  cx.fillStyle = REGIA.ultimo.colore; for (let a = 0; a < 4; a++) cx.fillRect(X - 3 + a, Y + a, 7 - 2 * a, 1);
}
