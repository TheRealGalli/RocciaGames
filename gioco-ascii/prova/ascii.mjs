// Copia di strumenti/pennino/prova/ascii.mjs (sito/strumenti/copia_sprite.py): non modificare qui.
// (ASC0, ASC5) Motore degli effetti in caratteri: caratteri in volo con fisica leggera e materia in una griglia di celle.
// Contratti: design/effetti-ascii-2026-11-17/CONTRATTO-MOTORE.md (simulazione) e CONTRATTO-LETTERE.md (resa). Numeri in
// zone/ascii.json (e nei pacchetti registrati). ?ascii=1 (o 2, sinonimo) = LETTERE VERE: caratteri di un font monospace su
// una griglia da terminale ancorata al mondo, una tela propria sopra la scena, un carattere per cella. Il carattere e il
// colore di ogni cella vengono da un campo d'energia (i caratteri in volo la depositano nelle celle che attraversano e
// decade a gradini) e dagli stati della materia in griglia. La resa a pixel (glifi 3 × 5) resta solo come ripiego interno:
// new Ascii(dati, 1), usata dalle tavole dei moduli esterni finché non passano alle lettere.
// Spento: nessuno stato, nessuna chiamata (chi aggancia crea l'istanza solo se asciiModo()). Acceso: vasche fisse in array
// tipizzati (riciclo del più vecchio), niente allocazioni per fotogramma, rumore deterministico dal seme. Solo resa.
//
// ---- Resa a lettere (modo 2) ---------------------------------------------------------------------------------------------
//  asc.disegnaFine(camX, z, te, tf, lume?, punto?) // nel gioco: tutto sulla tela propria (disegnaSotto/Sopra non fanno nulla)
//  asc.disegnaLettere(cx, camX, z, te, tf, k, W, H) // il nucleo: su qualunque contesto 2D (k = px del contesto per px di tela)
//  asc.usaFont(maschera, misure)          // in node: atlante di lavoro cotto da prova/ascii_cuoci_font.py (solo tavole)
//  asc.filtro(src, o) → F · asc.timbraFiltro(F, x, y, verso, strato)   // immagine → lettere scelte per forma (sotto)
//
// ---- API per i moduli esterni (ASC2 colpi, ASC3 ombre, …): tutto passa da un'istanza `asc` (null se spento) -------------
//  const ID = asc.registra(PACCHETTO)   // JSON con le sezioni di zone/ascii.json: glifi, tavolozze, cella_glifi, volo.tipi, materie
//    → { materie: {nome: id}, tavolozze: {nome: primo indice di colore}, tipi: {nome: id}, toni: {materia: {tono: i}}, glifi: {car: i} }
//    Tavolozze dal più chiaro (0) al più scuro. materie.tipo: 'liquido' (scorre, cola, secca), 'polvere' (cade, si ammucchia,
//    svanisce: svanisce_s), 'gas' (sale, si allarga, svanisce: vita_s, sale_passi, allarga, glifi_eta, colori_eta, sopra).
//    volo.tipi: { nome, g_H_s2, att_s, glifo ('' = dalla velocità), rimbalzi, rimbalzo_k, rimbalzo_att, scia: [s, max] }.
//    Stesso nome = si sostituisce (stesso id). L'atlante si rifà da solo al primo disegno dopo.
//  asc.volo(x, y, vx, vy, materia, tipo, vita, seme, p?)   // px, px/s di mondo; p riusato da chi chiama:
//                                                          // { g px/s², att 1/s, rit s senza gravità, lascia 0..1 (−1: della materia), tono }
//  asc.cella(x, y, materia, quanti)      // semina materia in griglia (liquido cade e scorre, polvere si ammucchia, gas sale)
//  asc.bagliore(x, y, r, forza)          // punto cremisi (al più tetti.bagliori_fotogramma per fotogramma)
//  asc.bersaglio(k, x, y) · asc.arrivi(k) // tipo di volo con "richiamo": true: sospeso p.rit s, poi ad arco (scarto p.arco px)
//                                        // verso il bersaglio mobile k = p.bers (0..7) da aggiornare a ogni fotogramma; arriva
//                                        // a fine vita; arrivi(k) = arrivi recenti con decadimento (tetti.arrivi_s)
//  asc.glifo(car) → indice (0 se manca) · asc.colore(tavolozza, i) → indice di colore · asc.tono(materia, nome) → indice
//  asc.timbro(gi, ci, x, y, strato = 1)  // un glifo centrato in (x, y) px di MONDO, in coda: lo disegna il motore nelle due
//                                        // rese (strato 0 prima della luce, 1 dopo). Coda svuotata a ogni disegno, tetto tetti.timbri.
//  asc.timbra(cx, gi, ci, X, Y)          // solo resa a pixel, subito, in coordinate di disegno (X = x − camX), glifo centrato
//  asc.solido(x, y) → bool               // solido o piattaforma in quel punto del mondo (fuori di lato o sotto: solido)
//  asc.modo (1 pixel | 2 lettere), asc.H, asc.t, asc.cw, asc.ch   // sola lettura
//  Nella resa a lettere ogni timbro cade nella cella della griglia che contiene (x, y): un carattere per cella; dove due
//  cose vogliono la stessa cella vince la più forte (energia pesante > timbri dello strato 1 > tratti > … > macchie).
//  Le materie e i tipi registrati possono dire come stanno in lettere (facoltativo, sennò valgono i toni):
//    materie.X.lettere = { pesanti: '8%&#', tratti: '-/|\\', leggeri: "',.:", colori: [indici dal più acceso] }
//    materie.X.toni_lettere = { tono: [indici per livello d'energia] } · volo.tipi[].energia (1) · .testa: 'pesante'
// Esempio: const ID = asc.registra(SCINTILLE);                         // una volta
//          const p = { g: 20 * asc.H, att: 1, rit: 0, lascia: 0, tono: 0 };   // riusato, niente allocazioni per colpo
//          asc.volo(x, y, vx, vy, ID.materie.scintilla, ID.tipi.scintilla, 0.5, seme, p);
//          asc.timbro(asc.glifo('#'), asc.colore('ambra', 2), x0 + 4 * i, y0, 0);   // sagoma propria, nelle due rese
// ----------------------------------------------------------------------------------------------------------------------------
import DATI from '../zone/ascii.json' with { type: 'json' };
import { TETTO_FX, posto } from './tetto_fx.mjs';
const TETTO_MAX0 = TETTO_FX.max;   // (OTT1) tetto degli effetti a qualità piena: sotto, la qualità adattiva è scesa

export const ASCII_DATI = DATI;

/** Modi dell'istanza: 1 resa a pixel (ripiego interno), 2 lettere vere (la resa del gioco). */
export const PIXEL = 1, LETTERE = 2;
// ?ascii=1 e ?ascii=2 (sinonimo, indirizzi già dati) accendono le lettere
let MODO = (() => { try { const v = new URLSearchParams(globalThis.location?.search || '').get('ascii'); return v === '1' || v === '2' ? LETTERE : 0; } catch { return 0; } })();
/** 0 spento, 2 lettere (l'unica resa raggiungibile dall'indirizzo). */
export const asciiModo = () => MODO;
/** Per prove e test: qualunque valore vero accende le lettere. */
export function accendiAscii(m = 1) { MODO = m ? LETTERE : 0; }

/** Rumore deterministico in [0, 1) da un intero (stesso hash di fx_materia.mjs → h01). */
export const h01 = (i) => { let x = (i * 374761393) ^ 0x5bd1e995; x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };

// codici di cella: 0 vuoto, 1..252 materia (id), 254 piattaforma passante, 255 solido
export const VUOTO = 0, PIATTA = 254, SOLIDO = 255;
/** Tipi di volo di base (i registrati seguono). */
export const TIPO = Object.freeze({ STRISCIA: 0, GOCCIA: 1, PESANTE: 2, SCHIZZO: 3, URTO: 4 });
const LIQUIDO = 0, POLVERE = 1, GAS = 2, GENERI = { liquido: LIQUIDO, polvere: POLVERE, gas: GAS };

const ora = () => (globalThis.performance ? performance.now() : Date.now());
const rgb = (s) => { const h = s.replace('#', ''); const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const voce = (k) => k[0] !== '_';

export class Ascii {
  constructor(dati = ASCII_DATI, modo = asciiModo()) {
    this.modo = modo === 2 ? 2 : modo ? 1 : 0;
    this.dati = dati;
    if (!this.modo) return;           // spento: niente stato
    const T = dati.tetti;
    this.T = T;
    this.H = 48; this.mondo = null; this.t = 0;
    [this.cw, this.ch] = this.modo === LETTERE ? dati.cella.lettere : dati.cella.pixel;
    // registro: glifi, colori, tipi di volo, materie (la base e i pacchetti dei moduli esterni)
    this.alfa = [' ']; this.mask = [0]; this.gIdx = Object.create(null); this.gIdx[' '] = 0;
    this.pal = []; this.tav = Object.create(null);
    this.tipi = []; this.tipoId = Object.create(null);
    this.MAT = []; this.idMateria = Object.create(null); this.crudi = [];
    this.cellaGlifi = dati.cella_glifi;
    this.LD = dati.lettere;
    this.livelli = Float32Array.from(this.LD.livelli); this.classi = Uint8Array.from([...this.LD.classi].map((c) => (c === 'P' ? 2 : c === 'T' ? 1 : 0)));
    this.gMir = null; this.filAlfa = null; this.lut = null; this.vett = null; this._cacheF = null;
    this.atlL = null; this.fonteNode = null; this.fine = null;
    if (this.modo === LETTERE) for (const c of this.LD.filtro.alfabeto) this._aggiungi(c);   // l'alfabeto del filtro sta nell'atlante
    this.registra(dati);
    const gi = (c) => this._gi(c);   // glifi del moto, fissi (gli indici non cambiano con le registrazioni)
    this.gv = { meno: gi('-'), bar: gi('|'), sl: gi('/'), bs: gi('\\'), ap: gi("'"), vir: gi(','), pun: gi('.') };
    const NV = this.NV = T.volo;
    this.vx = new Float32Array(NV); this.vy = new Float32Array(NV); this.px = new Float32Array(NV); this.py = new Float32Array(NV);
    this.vg = new Float32Array(NV); this.va = new Float32Array(NV); this.ve = new Float32Array(NV); this.vv = new Float32Array(NV); this.vr = new Float32Array(NV);
    this.vm = new Uint8Array(NV); this.vt = new Uint8Array(NV); this.vtono = new Uint8Array(NV); this.vl = new Float32Array(NV); this.vs = new Uint32Array(NV);
    this.vb = new Uint8Array(NV); this.vivo = new Uint8Array(NV); this.vTesta = 0; this.nVolo = 0;
    // richiamati: punto di partenza, scarto dell'arco, bersaglio; bersagli mobili e arrivi recenti (con decadimento)
    this.sx0 = new Float32Array(NV); this.sy0 = new Float32Array(NV); this.vo = new Float32Array(NV); this.vk = new Uint8Array(NV);
    this.bersX = new Float32Array(8); this.bersY = new Float32Array(8); this.arr = new Float32Array(8);
    const NC = this.NC = T.celle;
    this.lc = new Int32Array(NC); this.lm = new Uint8Array(NC); this.ls = new Uint8Array(NC); this.ld = new Int8Array(NC); this.lf = new Uint16Array(NC);
    this.la = new Uint8Array(NC); this.lk = new Uint8Array(NC); this.lq = new Uint8Array(NC); this.lcad = new Uint8Array(NC); this.lsec = new Uint8Array(NC);
    this.le = new Uint16Array(NC); this.ord = new Uint16Array(NC); this.nCel = 0; this.nSu = 0;
    this.lvy = new Float32Array(NC); this.lac = new Float32Array(NC); this.lliv = new Uint8Array(NC);   // caduta accelerata, livellamento
    this.lt = new Float32Array(NC); this.viaFuori = 0;   // (TAR) età al deposito; strati oltre tetti.strati da togliere anche senza altre secche
    const NM = this.NM = T.macchie;
    this.mc = new Int32Array(NM); this.mq = new Uint8Array(NM); this.mm = new Uint8Array(NM); this.mt = new Float32Array(NM); this.mTesta = 0; this.nMac = 0;
    const NT = this.NT = T.timbri;   // due code di timbri: [0] prima della luce, [1] dopo
    this.tq = [0, 1].map(() => ({ x: new Float32Array(NT), y: new Float32Array(NT), g: new Uint8Array(NT), c: new Uint16Array(NT), n: 0 }));
    this.gw = 0; this.gh = 0; this.mat = null; this.quale = null; this.pend = null; this.sup = null; this.mIn = null; this.conta = null;
    this.hV = 1 / dati.passo.volo_hz; this.hG = 1 / dati.passo.griglia_hz; this.accV = 0; this.accG = 0;
    this._gPasso = this.H / this.ch * this.hG * this.hG;
    this.kImp = 0; this.asse = 0; this.asseDir = 0; this.serie = 0; this.nb = 0;
    this.bx = new Float32Array(4); this.by = new Float32Array(4); this.br = new Float32Array(4); this.bf = new Float32Array(4); this.bt = new Float32Array(4); this.bTesta = 0;
    this.persi = 0; this.chiamate = 0; this.ms = 0; this._scia = 0;
    this._vista = { x0: 0, x1: 0, y0: 0, y1: 0 };
    this._mis = { volo: 0, celle: 0, macchie: 0, chiamate: 0, ms_passo: 0, persi: 0, lettere: 0, energia: 0 };
    this._pv = { g: 0, att: 0, rit: 0, lascia: 0, tono: 0 };
    this.atl = null;
    this._cx = null; this._camX = 0; this._z = 1; this._te = 0; this._tf = 0; this._k = 1; this._lume = null;
    const M = dati.moto;
    this._tO = Math.tan(M.orizzontale_gradi * Math.PI / 180); this._tV = Math.tan(M.verticale_gradi * Math.PI / 180);
    if (this.modo !== LETTERE) return;
    // campo d'energia (array per cella, fatti in stanza()) e lista delle celle accese; composizione del fotogramma
    const L = this.LD;
    this.NE = T.energia; this.eL = new Int32Array(this.NE); this.nE = 0;
    this.en = null; this.eD = null; this.eM = null; this.eT = null; this.fP = null; this.fG = null; this.fC = null;
    this.NF = T.energia + T.celle + T.macchie + 2 * T.timbri + T.volo; this.fL = new Int32Array(this.NF); this.nF = 0;
    this.spegni = L.livelli[L.livelli.length - 1];
    this.contaP = new Int32Array(9); this.nLettere = 0; this._cMax = 2; this.nB = 0; this.bq = null;
  }
  /** Indice del glifo `car`, aggiunto al registro se manca (senza maschera a pixel: vale solo per le lettere). */
  _aggiungi(car) {
    let i = this.gIdx[car];
    if (i === undefined) { i = this.alfa.length; this.alfa.push(car); this.mask.push(0); this.gIdx[car] = i; this.atl = null; this.atlL = null; this._atlB?.clear(); }
    return i;
  }

  // ------------------------------------------------------------------------------------------------ registro
  /** Aggiunge (o sostituisce per nome) glifi, tavolozze, tipi di volo e materie da un pacchetto; restituisce gli id. */
  registra(pk) {
    const R = { materie: {}, tavolozze: {}, tipi: {}, toni: {}, glifi: {} };
    if (!this.modo || !pk) return R;
    for (const [car, s] of Object.entries(pk.glifi || {})) {
      if (car.length !== 1) continue;      // le chiavi lunghe sono note (_formato)
      const righe = String(s).trim().split(/\s+/);
      let b = 0;
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if ((righe[r] || '')[c] === '1') b |= 1 << (14 - r * 3 - c);
      let i = this.gIdx[car];
      if (i === undefined) { i = this.alfa.length; this.alfa.push(car); this.mask.push(b); this.gIdx[car] = i; } else this.mask[i] = b;
      R.glifi[car] = i;
    }
    for (const [nome, L] of Object.entries(pk.tavolozze || {})) {
      if (!voce(nome) || !Array.isArray(L)) continue;
      const v = this.tav[nome];
      if (v && v.n === L.length) for (let i = 0; i < L.length; i++) this.pal[v.o + i] = L[i];
      else { this.tav[nome] = { o: this.pal.length, n: L.length }; this.pal.push(...L); }
      R.tavolozze[nome] = this.tav[nome].o;
    }
    for (const t of pk.volo?.tipi || []) {
      let id = this.tipoId[t.nome];
      if (id === undefined) { id = this.tipi.length; this.tipoId[t.nome] = id; }
      this.tipi[id] = { nome: t.nome, g: t.g_H_s2 ?? 0, att: t.att_s ?? 0, glifo: t.glifo || '', rimb: t.rimbalzi ?? 0, rk: t.rimbalzo_k ?? 0.5, ra: t.rimbalzo_att ?? 0.8, sciaS: t.scia?.[0] ?? 0, sciaN: t.scia?.[1] ?? 0, rich: !!t.richiamo, gi: 0,
        en: t.energia ?? 1, testaP: t.testa === 'pesante', cMax: t.classe_max === 'L' ? 0 : t.classe_max === 'T' ? 1 : 2, nucleo: t.nucleo !== false };
      R.tipi[t.nome] = id;
    }
    if (pk.cella_glifi && pk === this.dati) this.cellaGlifi = pk.cella_glifi;
    for (const [nome, m] of Object.entries(pk.materie || {})) {
      if (!voce(nome) || typeof m !== 'object') continue;
      let id = this.idMateria[nome];
      if (id === undefined) { id = this.MAT.length || 1; if (id > 252) continue; this.idMateria[nome] = id; }
      this.crudi[id] = m;
      this.MAT[id] = null;
      R.materie[nome] = id;
    }
    // si risolvono tutto insieme: un tipo nuovo cambia le probabilità di lasciare di tutte le materie
    for (const t of this.tipi) t.gi = t.glifo ? this._gi(t.glifo) : 0;
    for (let id = 1; id < this.crudi.length; id++) if (this.crudi[id]) this.MAT[id] = this._risolvi(this.crudi[id], id);
    for (const nome of Object.keys(this.idMateria)) { const M = this.MAT[this.idMateria[nome]]; if (M) R.toni[nome] = M.toniNomi; }
    this.atl = null; this.atlL = null; this._atlB?.clear();   // atlanti rifatti al prossimo disegno
    this._lT = null;   // (OTT1) tabelle della luce rifatte al prossimo uso
    if (this.modo === LETTERE) {     // specchio dei glifi per i timbri del filtro girati (/ ↔ \ …)
      const S = this.LD.specchio, n = this.alfa.length;
      this.gMir = new Uint8Array(n);
      for (let i = 0; i < n; i++) { const k = S.indexOf(this.alfa[i]), j = k < 0 ? -1 : this.gIdx[S[k ^ 1]]; this.gMir[i] = j === undefined || j < 0 ? i : j; }
    }
    return R;
  }
  _gi(car) { const i = this.gIdx[car]; return i === undefined ? 0 : i; }
  _risolvi(m, id) {
    const tv = this.tav[m.tavolozza] || { o: 0, n: this.pal.length }, col = (i) => tv.o + Math.max(0, Math.min(tv.n - 1, i | 0));
    const G = { ...this.cellaGlifi, ...(m.glifi_cella || {}) }, C = m.colori || {};
    const toniNomi = {}, toni = [];
    for (const [k, L] of Object.entries(m.toni || { base: [[C.cade ?? 0, 99]] })) {
      if (!voce(k)) continue;
      toniNomi[k] = toni.length;
      toni.push({ C: Uint8Array.from(L.map((x) => col(x[0]))), T: Float32Array.from(L.map((x) => x[1])) });
    }
    const lascia = new Float32Array(Math.max(1, this.tipi.length));
    if (Array.isArray(m.lascia)) m.lascia.forEach((v, i) => { if (i < lascia.length) lascia[i] = v; });
    else for (const [k, v] of Object.entries(m.lascia || {})) { const i = this.tipoId[k]; if (i !== undefined) lascia[i] = v; }
    // nelle lettere ogni carattere del font esiste: i glifi di stato e quelli d'età entrano nel registro anche senza maschera
    if (this.modo === LETTERE) for (const [k, s] of [...Object.entries(G), ['eta', m.glifi_eta || '']]) if (voce(k) && typeof s === 'string') for (const q of s) this._aggiungi(q);
    const glMac = Uint8Array.from([...(G.macchia || '.')].map((c) => this._gi(c)));
    let let_ = null;
    if (this.modo === LETTERE) {   // alfabeto e colori per livello d'energia (dal più acceso); senza dati, gli stadi dei toni
      const A = { ...this.LD.alfabeto, ...(m.lettere || {}) }, ag = (s) => Uint8Array.from([...s].map((c) => this._aggiungi(c)));
      const lv = this.livelli.length, perLivello = (L) => Uint16Array.from({ length: lv }, (_, k) => col(L[Math.min(L.length - 1, k)]));
      const TL = m.toni_lettere || {}, base = m.lettere?.colori;
      const toniL = Object.keys(toniNomi).map((k) => (TL[k] ? perLivello(TL[k]) : base ? perLivello(base) : perLivello(Array.from(toni[toniNomi[k]].C, (c) => c - tv.o))));
      const lg = ag(A.leggeri);
      let_ = { pes: ag(A.pesanti), tra: [0, 1, 2, 3].map((k) => ag(Array.isArray(A.tratti) ? A.tratti[k] || '-' : A.tratti[k] || '-')), su: lg[0], giu: lg[1 % lg.length], fermo: lg[2 % lg.length], denso: lg[3 % lg.length], toniL };
    }
    return {
      L: let_,
      id, genere: GENERI[m.tipo] ?? LIQUIDO, toni, toniNomi, lascia,
      livella: m.livella_passi ?? 0, cadG: m.caduta_g_H_s2 ?? this.dati.passo.caduta_g_H_s2, cadMax: m.caduta_max_passo ?? this.dati.passo.caduta_max_passo,
      slancio: m.slancio ?? 0, slancioP: m.slancio_pendenza ?? m.slancio ?? 0, pendPassi: m.pendenza_passi ?? 2, colatura: m.colatura_passi ?? 3, cadVel: m.caduta_veloce_passi ?? 3,
      seccaS: m.secca_s ?? 2, svanisceS: m.svanisce_s ?? 2, vitaS: m.vita_s ?? 1.5, saleP: m.sale_passi ?? 1, allarga: m.allarga ?? 0,
      macchia: !!m.macchia, scuraS: m.macchia_scura_s ?? 5, vitaMac: m.macchia_vita_s ?? 30, sopra: !!m.sopra,
      cCade: col(C.cade ?? 0), cFermo: col(C.fermo ?? 0), cAder: col(C.aderente ?? C.fermo ?? 0), cMac: col(C.macchia ?? 0), cVecchia: col(C.macchia_vecchia ?? C.macchia ?? 0),
      gCade: this._gi(G.cade), gFilo: this._gi(G.filo), gFermo: this._gi(G.fermo), gPozza: this._gi(G.pozza), gFondo: this._gi(G.fondo), gFondo2: this._gi(G.fondo2), gAder: this._gi(G.aderente), glMac,
      etaG: Uint8Array.from([...(m.glifi_eta || '.')].map((c) => this._gi(c))), etaC: Uint8Array.from((m.colori_eta || [0]).map(col)),
    };
  }
  /** Indice del glifo (0 = spazio se manca). */
  glifo(car) { return this.modo ? this._gi(car) : 0; }
  /** Indice di colore globale dell'i-esimo colore della tavolozza. */
  colore(tav, i = 0) { const v = this.modo && this.tav[tav]; return v ? v.o + Math.max(0, Math.min(v.n - 1, i | 0)) : 0; }
  /** Indice del tono di volo `nome` della materia (0 se manca). */
  tono(materia, nome) { const M = this.modo && this.MAT[typeof materia === 'number' ? materia : this.idMateria[materia]]; return M?.toniNomi[nome] ?? 0; }

  // ------------------------------------------------------------------------------------------------ stanza e griglia
  /** Scrive i solidi della stanza nella griglia e svuota tutto (volo, celle, macchie). */
  stanza(mondo, H = 48) {
    if (!this.modo) return;
    this.mondo = mondo; this.H = H || 48;
    this._gPasso = this.H / this.ch * this.hG * this.hG;     // 1 H/s² in celle per passo di griglia al quadrato
    const cw = this.cw, ch = this.ch, W = Math.max(1, Math.ceil((mondo?.w || 480) / cw)), Hc = Math.max(1, Math.ceil((mondo?.h || 270) / ch)), N = W * Hc;
    if (!this.mat || this.mat.length < N) {     // si rialloca solo se la stanza è più grande di quella tenuta
      this.mat = new Uint8Array(N); this.quale = new Uint16Array(N); this.pend = new Int8Array(N); this.sup = new Int8Array(N); this.mIn = new Uint16Array(N);
    } else { this.mat.fill(0, 0, N); this.quale.fill(0, 0, N); this.pend.fill(0, 0, N); this.sup.fill(0, 0, N); this.mIn.fill(0, 0, N); }
    if (!this.conta || this.conta.length < Hc + 1) this.conta = new Uint16Array(Hc + 1);
    if (this.modo === LETTERE) {   // campo d'energia e composizione: una voce per cella della stanza
      if (!this.en || this.en.length < N) {
        this.en = new Float32Array(N); this.eD = new Uint8Array(N); this.eM = new Uint8Array(N); this.eT = new Uint8Array(N); this.eS = new Uint8Array(N); this.eK = new Uint8Array(N);
        this.fP = new Uint8Array(N); this.fG = new Uint8Array(N); this.fC = new Uint16Array(N);
      } else { this.en.fill(0, 0, N); this.fP.fill(0, 0, N); }
      this.nE = 0; this.nF = 0;
    }
    this.gw = W; this.gh = Hc;
    this.vivo.fill(0); this.nVolo = 0; this.vTesta = 0; this.nCel = 0; this.nSu = 0; this.mTesta = 0; this.nMac = 0; this.accV = 0; this.accG = 0; this.viaFuori = 0;   // (TAR) viaFuori
    this.bf.fill(0); this.tq[0].n = 0; this.tq[1].n = 0;
    if (!mondo) return;
    if (Number.isFinite(mondo.suolo)) this._rett(-cw, mondo.suolo, (W + 2) * cw, Hc * ch - mondo.suolo + ch, SOLIDO);   // suolo di base, come _quotaSotto
    for (const s of mondo.solidi || []) this._rett(s.x, s.y, s.w, s.h, SOLIDO);
    for (const q of mondo.piattaforme || []) this._piatta(q.x, q.y, q.w);
    for (const P of mondo.pendenze || []) this._pendenza(P);
  }
  // cella piena se il suo centro sta nel rettangolo; la prima riga si ricorda dov'è la superficie vera (sup, px dalla cima della cella)
  _rett(x, y, w, h, v) {
    const cw = this.cw, ch = this.ch, W = this.gw, Hc = this.gh;
    const i0 = Math.max(0, Math.ceil(x / cw - 0.5)), i1 = Math.min(W - 1, Math.floor((x + w) / cw - 0.5));
    const j0 = Math.max(0, Math.ceil(y / ch - 0.5)), j1 = Math.min(Hc - 1, Math.floor((y + h) / ch - 0.5));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * W + i;
      if (j === j0 && this.mat[c] !== SOLIDO) this.sup[c] = Math.round(y - j * ch);
      this.mat[c] = v;
    }
  }
  _piatta(x, y, w) {
    const cw = this.cw, ch = this.ch, W = this.gw, j = Math.floor(y / ch);
    if (j < 0 || j >= this.gh) return;
    const i0 = Math.max(0, Math.ceil(x / cw - 0.5)), i1 = Math.min(W - 1, Math.floor((x + w) / cw - 0.5));
    for (let i = i0; i <= i1; i++) { const c = j * W + i; if (this.mat[c] === SOLIDO) continue; this.mat[c] = PIATTA; this.sup[c] = Math.round(y - j * ch); }
  }
  _pendenza(P) {
    const cw = this.cw, ch = this.ch, W = this.gw, Hc = this.gh;
    const i0 = Math.max(0, Math.ceil(P.x0 / cw - 0.5)), i1 = Math.min(W - 1, Math.floor(P.x1 / cw - 0.5));
    const dir = Math.abs(P.k) < 0.05 ? 0 : P.k > 0 ? 1 : -1;   // k > 0: la superficie scende verso destra
    for (let i = i0; i <= i1; i++) {
      const xc = (i + 0.5) * cw, q = P.yA + P.k * (Math.min(P.x1, Math.max(P.x0, xc)) - P.x0);
      if (P.soffitto) {
        const ja = Math.max(0, Math.ceil(P.base / ch - 0.5)), jb = Math.min(Hc - 1, Math.floor(q / ch - 0.5));
        for (let j = ja; j <= jb; j++) this.mat[j * W + i] = SOLIDO;
        continue;
      }
      const jt = Math.max(0, Math.ceil(q / ch - 0.5));
      if (jt >= Hc) continue;
      const ct = jt * W + i;
      if (P.attraversabile) { if (this.mat[ct] !== SOLIDO) { this.mat[ct] = PIATTA; this.sup[ct] = Math.round(q - jt * ch); this.pend[ct] = dir; } continue; }
      const jb = Math.min(Hc - 1, Math.floor(P.base / ch - 0.5));
      for (let j = jt; j <= jb; j++) this.mat[j * W + i] = SOLIDO;
      this.sup[ct] = Math.round(q - jt * ch); this.pend[ct] = dir;
    }
  }
  /** Codice della cella che contiene (x, y) in px di mondo (fuori di lato o sotto: solido; sopra: vuoto). */
  codice(x, y) {
    if (!this.mat) return VUOTO;
    const i = Math.floor(x / this.cw), j = Math.floor(y / this.ch);
    if (i < 0 || i >= this.gw || j >= this.gh) return SOLIDO;
    return j < 0 ? VUOTO : this.mat[j * this.gw + i];
  }
  /** Solido o piattaforma in (x, y) px di mondo. */
  solido(x, y) { const c = this.codice(x, y); return c === SOLIDO || c === PIATTA; }

  // ------------------------------------------------------------------------------------------------ emissione
  /**
   * Un carattere in volo (px, px/s). tipo: id di volo (0 striscia, 1 goccia, 2 pesante, 3 schizzo, 4 urto, poi i registrati).
   * p (facoltativo, riusato da chi chiama): { g px/s², att 1/s, rit s senza gravità, lascia 0..1 (−1 = della materia), tono }.
   */
  volo(x, y, vx, vy, materia, tipo, vita, seme, p = null) {
    if (!this.modo || !(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(vx) && Number.isFinite(vy))) return -1;
    const Tp = this.tipi[tipo] || this.tipi[0], H = this.H, M = this.MAT[materia];
    if (!M) return -1;
    const i = this.vTesta;
    this.vTesta = (i + 1) % this.NV;
    if (!this.vivo[i]) this.nVolo++;
    this.vivo[i] = 1; this.px[i] = x; this.py[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.vm[i] = materia; this.vt[i] = this.tipi[tipo] ? tipo : 0; this.ve[i] = 0; this.vv[i] = vita > 0 ? vita : 0.5; this.vs[i] = seme >>> 0;
    this.vg[i] = p ? p.g : Tp.g * H; this.va[i] = p ? p.att : Tp.att; this.vr[i] = p ? p.rit : 0;
    this.vl[i] = p && p.lascia >= 0 ? p.lascia : M.lascia[this.vt[i]] ?? 0;
    this.vtono[i] = p && p.tono < M.toni.length ? p.tono : 0; this.vb[i] = Tp.rimb;
    this.sx0[i] = x; this.sy0[i] = y;    // origine: la scia non va oltre (la linea di moto parte dal corpo)
    if (Tp.rich) { this.vk[i] = p?.bers & 7; this.vo[i] = p?.arco || 0; this.vx[i] = 0; this.vy[i] = 0; }
    // lettere: alla nascita il carattere carica la sua cella (i nati insieme nello stesso punto fanno il nucleo pesante)
    if (this.en && this.mat) this._nucleo(i, x, y);
    return i;
  }
  /** Semina `quanti` celle di materia attorno a (x, y), in fila (0, −1, +1, −2, …); poi fanno da sole. */
  cella(x, y, materia, quanti = 1) {
    if (!this.modo || !this.mat || !this.MAT[materia]) return 0;
    const i0 = Math.floor(x / this.cw), j0 = Math.floor(y / this.ch);
    let n = 0;
    for (let q = 0; q < quanti; q++) {
      const di = (q & 1 ? 1 : -1) * ((q + 1) >> 1), s = ++this.serie;
      if (this._deposita(i0 + di, j0, materia, di < 0 ? -1 : 1, 0, s, 2)) n++;
    }
    return n;
  }
  /** Bersaglio mobile k (0..7) dei caratteri richiamati: da aggiornare a ogni fotogramma (es. il petto del protagonista). */
  bersaglio(k, x, y) { if (this.modo && Number.isFinite(x) && Number.isFinite(y)) { this.bersX[k & 7] = x; this.bersY[k & 7] = y; } }
  /** Arrivi recenti al bersaglio k (somma con decadimento tetti.arrivi_s). */
  arrivi(k) { return this.modo ? this.arr[k & 7] : 0; }
  /** Caratteri in volo vivi di un tipo (scorre la vasca: da usare agli eventi, non a ogni fotogramma). */
  contaVolo(tipo) { let n = 0; if (this.modo) for (let i = 0; i < this.NV; i++) if (this.vivo[i] && this.vt[i] === tipo) n++; return n; }
  /** Conta un impatto del fotogramma: il k-esimo (1 = primo). */
  impatto() { return this.modo ? ++this.kImp : 0; }
  /** Punto di bagliore (al più tetti.bagliori_fotogramma per fotogramma). */
  bagliore(x, y, r, forza) {
    if (!this.modo || this.nb >= this.T.bagliori_fotogramma) return false;
    this.nb++;
    const k = this.bTesta; this.bTesta = (k + 1) & 3;
    this.bx[k] = x; this.by[k] = y; this.br[k] = r; this.bf[k] = forza; this.bt[k] = this.t;
    return true;
  }
  /** Glifo in coda, centrato in (x, y) px di mondo; strato 0 prima della luce, 1 dopo. false se la coda è piena. */
  timbro(gi, ci, x, y, strato = 1) {
    if (!this.modo) return false;
    const Q = this.tq[strato ? 1 : 0];
    if (Q.n >= this.NT) { this.persi++; return false; }
    const k = Q.n++;
    Q.x[k] = x; Q.y[k] = y; Q.g[k] = gi; Q.c[k] = ci;
    return true;
  }
  /** Solo resa a pixel: un glifo subito, centrato in (X, Y) coordinate di disegno. Conta nel tetto globale. */
  timbra(cx, gi, ci, X, Y) {
    if (this.modo !== 1 || !this._atlante()) return false;
    cx.drawImage(this.atl, ci * 4, gi * 6, 3, 5, Math.round(X) - 1, Math.round(Y) - 2, 3, 5);
    TETTO_FX.n++;
    return true;
  }
  // materia nella cella (i, j) o più su (fino a `su` celle) se è piena; false se non c'è posto
  _deposita(i, j, materia, dir, aderente, seme, su = 1) {
    if (i < 0 || i >= this.gw) return false;
    if (this.nCel >= this.NC) { this.persi++; return false; }
    for (let k = 0; k <= su; k++, j--) {
      if (j < 0) return false;
      if (j >= this.gh) continue;
      const c = j * this.gw + i;
      if (this.mat[c] !== VUOTO) continue;
      const n = this.nCel++, M = this.MAT[materia];
      this.mat[c] = materia; this.quale[c] = n + 1;
      this.lc[n] = c; this.lm[n] = materia; this.ls[n] = M.slancio; this.ld[n] = dir < 0 ? -1 : 1; this.lf[n] = 0;
      this.la[n] = aderente; this.lk[n] = 0; this.lq[n] = seme & 255; this.lcad[n] = 0; this.lsec[n] = 0; this.le[n] = 0;
      this.lvy[n] = 0; this.lac[n] = 0; this.lliv[n] = M.livella; this.lt[n] = this.t;
      if (this.T.strati > 0) this._strati(c);   // (TAR) al più tetti.strati lettere impilate nella colonna
      return true;
    }
    return false;
  }
  // (TAR) la pila sotto la cella c appena depositata (solo questa colonna, celle contigue): oltre tetti.strati la più vecchia
  // comincia a seccarsi subito (lsec), anche se non sono passati i suoi secondi; la toglie il prossimo _passoGriglia
  _strati(c) {
    const W = this.gw, fine = W * this.gh, quale = this.quale, sec = this.lsec, lt = this.lt;
    let n = 0, vk = -1;
    for (let d = c; d < fine; d += W) {
      const q = quale[d];
      if (!q) break;
      const k = q - 1;
      if (sec[k]) continue;
      n++;
      if (vk < 0 || lt[k] < lt[vk]) vk = k;
    }
    if (n > this.T.strati && vk >= 0) { sec[vk] = 1; this.viaFuori = 1; }
  }

  // ------------------------------------------------------------------------------------------------ passo
  /** Fisica: volo a passo fisso (60 Hz), griglia a passo fisso (30 Hz). Rifà la griglia quando cambia g.mondo. */
  passo(dt, g, vento) {
    if (!this.modo) return;
    const t0 = ora();
    if (g && g.mondo && g.mondo !== this.mondo) this.stanza(g.mondo, g.mondo.H || g.H || this.H);
    this.kImp = 0; this.nb = 0;
    if (!(dt > 0)) { this.ms = ora() - t0; return; }
    dt = Math.min(dt, 0.1); this.t += dt;
    if (this.nE) this._decadi(dt);
    const T = this.T;
    for (let k = 0; k < 8; k++) if (this.arr[k]) { this.arr[k] *= Math.exp(-dt / T.arrivi_s); if (this.arr[k] < 0.01) this.arr[k] = 0; }
    this.accV += dt;
    for (let n = 0; this.accV >= this.hV; n++) {
      if (n >= T.passi_volo_max) { this.accV = 0; break; }   // si perde tempo, mai stabilità
      this.accV -= this.hV;
      if (this.nVolo) this._passoVolo(this.hV, vento);
    }
    this.accG += dt;
    for (let n = 0; this.accG >= this.hG; n++) {
      if (n >= T.passi_griglia_max) { this.accG = 0; break; }
      this.accG -= this.hG;
      if (this.nCel) this._passoGriglia();
    }
    this.ms = ora() - t0;
  }
  _muori(i) { this.vivo[i] = 0; this.nVolo--; }
  _passoVolo(h, vento) {
    const NV = this.NV, cw = this.cw, ch = this.ch, W = this.gw, Hc = this.gh, mat = this.mat, H = this.H;
    const kv = this.dati.volo.vento_k ?? 0;
    for (let i = 0; i < NV; i++) {
      if (!this.vivo[i]) continue;
      const e = (this.ve[i] += h), tipo = this.vt[i], T = this.tipi[tipo];
      if (e >= this.vv[i]) { if (T.rich) this.arr[this.vk[i]] += 1; this._muori(i); continue; }
      if (tipo === TIPO.URTO) { if (this.en) this._traccia(i, this.px[i], this.py[i], h); continue; }
      if (T.rich) { const ax = this.px[i], ay = this.py[i]; this._richiamo(i, e, h); if (this.en) this._traccia(i, ax, ay, h); continue; }
      let vx = this.vx[i], vy = this.vy[i];
      if (e >= this.vr[i]) vy += this.vg[i] * h;
      const a = this.va[i];
      if (a) { const f = a * h < 1 ? 1 - a * h : 0; vx *= f; vy *= f; }
      if (vento && kv && (tipo === TIPO.STRISCIA || tipo === TIPO.SCHIZZO)) vx += vento.in(this.px[i] / H) * H * kv * h;
      this.vx[i] = vx; this.vy[i] = vy;
      const x0 = this.px[i], y0 = this.py[i], dx = vx * h, dy = vy * h;
      if (!mat) { this.px[i] = x0 + dx; this.py[i] = y0 + dy; continue; }
      // marcia nella griglia a passi di cella: niente tunnel attraverso i muri sottili anche a 34 H/s
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx) / cw, Math.abs(dy) / ch)));
      let pi = Math.floor(x0 / cw), pj = Math.floor(y0 / ch), lx = x0, ly = y0, urto = false;
      for (let s = 1; s <= n; s++) {
        const x = x0 + dx * s / n, y = y0 + dy * s / n, ci = Math.floor(x / cw), cj = Math.floor(y / ch);
        if (ci === pi && cj === pj) { lx = x; ly = y; continue; }
        if (cj >= Hc || ((ci < 0 || ci >= W) && !this.vb[i])) { this._muori(i); urto = true; break; }   // fuori dalla stanza
        if (cj < 0 && ci >= 0 && ci < W) { pi = ci; pj = cj; lx = x; ly = y; continue; }
        const m = ci < 0 || ci >= W ? SOLIDO : cj < 0 ? VUOTO : mat[cj * W + ci];
        if (m === VUOTO) { pi = ci; pj = cj; lx = x; ly = y; continue; }
        const giu = cj > pj;
        if (m !== SOLIDO && !giu) { pi = ci; pj = cj; lx = x; ly = y; continue; }   // piattaforme e materia: solide solo dall'alto
        // dall'alto se scende e la colonna di partenza è chiusa alla stessa riga; soffitto se sale; altrimenti di fianco
        const chiusa = ci === pi || pi < 0 || pi >= W || pj < 0 || mat[cj * W + pi] !== VUOTO;
        const dallAlto = giu && chiusa, soffitto = cj < pj && chiusa;
        if (this.vb[i]) {         // rimbalzo: si riflette la componente contro la superficie, resta nell'ultimo punto libero
          this.vb[i]--;
          if (dallAlto) { this.vy[i] = -Math.abs(vy) * T.rk; this.vx[i] = vx * T.ra; }
          else if (soffitto) { this.vy[i] = Math.abs(vy) * T.rk; this.vx[i] = vx * T.ra; }
          else { this.vx[i] = -vx * T.rk; this.vy[i] = vy * T.ra; }
          this.px[i] = lx; this.py[i] = ly; urto = true; break;
        }
        this.px[i] = lx; this.py[i] = ly;     // fin dove è arrivato (serve alla traccia delle lettere)
        this._urto(i, ci, cj, pi, pj, dallAlto, m, x, cj * ch);
        urto = true; break;
      }
      if (!urto) { this.px[i] = x0 + dx; this.py[i] = y0 + dy; }
      if (this.en) this._traccia(i, x0, y0, h);
    }
  }
  // richiamato: sospeso per vr s, poi lungo un arco (curva di Bézier con il controllo spostato di lato di vo px) verso il
  // bersaglio mobile, accelerando; arriva a fine vita. Niente gravità né urti; la velocità serve solo al glifo.
  _richiamo(i, e, h) {
    const hov = this.vr[i];
    if (e < hov) { this.vx[i] = 0; this.vy[i] = 0; return; }
    const k = this.vk[i], tx = this.bersX[k], ty = this.bersY[k], x0 = this.sx0[i], y0 = this.sy0[i];
    const u = Math.min(1, (e - hov) / Math.max(1e-3, this.vv[i] - hov)), w = u * u;
    const dx = tx - x0, dy = ty - y0, l = Math.sqrt(dx * dx + dy * dy) || 1, cx = (x0 + tx) / 2 - dy / l * this.vo[i], cy = (y0 + ty) / 2 + dx / l * this.vo[i];
    const a = (1 - w) * (1 - w), b = 2 * (1 - w) * w, c = w * w, x = a * x0 + b * cx + c * tx, y = a * y0 + b * cy + c * ty;
    this.vx[i] = (x - this.px[i]) / h; this.vy[i] = (y - this.py[i]) / h; this.px[i] = x; this.py[i] = y;
  }
  _urto(i, ci, cj, pi, pj, dallAlto, m, x, yTop) {
    const tipo = this.vt[i], s = this.vs[i], mat = this.vm[i];
    this._muori(i);
    if (tipo === TIPO.SCHIZZO) return;
    const lascia = h01(s * 31 + 7) < this.vl[i];
    if (dallAlto) {
      if (lascia && !this._deposita(ci, cj - 1, mat, this.vx[i], 0, s, 1)) this._deposita(pi, pj, mat, this.vx[i], 0, s, 0);
      if (tipo === TIPO.PESANTE) this._schizzi(x, yTop + this._supDi(ci, cj), mat, s);
    } else if (lascia && ci !== pi && pj >= 0) this._deposita(pi, pj, mat, this.vx[i], m === SOLIDO ? 1 : 0, s, 0);   // di fianco: aderente al muro
  }
  _supDi(i, j) { return i >= 0 && i < this.gw && j >= 0 && j < this.gh ? this.sup[j * this.gw + i] : 0; }
  // goccia pesante a terra: un * per un attimo e due o tre punti bassi di lato
  _schizzi(x, y, mat, s) {
    const V = this.dati.volo, H = this.H, p = this._pv, ts = this.tipi[TIPO.SCHIZZO];
    p.g = ts.g * H; p.att = ts.att; p.rit = 0; p.lascia = 0; p.tono = 0;
    this.volo(x, y - 2, 0, 0, mat, TIPO.URTO, V.urto_s, s, null);
    const [a, b] = V.schizzi_pesante, n = a + Math.floor(h01(s + 3) * (b - a + 1));
    for (let k = 0; k < n; k++) {
      const d = k & 1 ? 1 : -1, r1 = h01(s * 7 + k * 13 + 1), r2 = h01(s * 11 + k * 17 + 2);
      const vx = d * (V.schizzo_vx_H_s[0] + r1 * (V.schizzo_vx_H_s[1] - V.schizzo_vx_H_s[0])) * H;
      const vy = -(V.schizzo_vy_H_s[0] + r2 * (V.schizzo_vy_H_s[1] - V.schizzo_vy_H_s[0])) * H;
      this.volo(x, y - 2, vx, vy, mat, TIPO.SCHIZZO, V.schizzo_vita_s, s + k + 1, p);
    }
  }
  _passoGriglia() {
    const W = this.gw, Hc = this.gh, mat = this.mat, quale = this.quale, n = this.nCel;
    // ordine dal basso verso l'alto: conteggio per riga (stabile, O(n + righe)), niente ordinamenti per confronto
    const conta = this.conta, ord = this.ord;
    conta.fill(0, 0, Hc + 1);
    for (let k = 0; k < n; k++) conta[Hc - 1 - ((this.lc[k] / W) | 0)]++;
    for (let r = 0, s = 0; r <= Hc; r++) { const c = conta[r]; conta[r] = s; s += c; }
    for (let k = 0; k < n; k++) ord[conta[Hc - 1 - ((this.lc[k] / W) | 0)]++] = k;
    let su = 0, via = 0, gas = 0;
    for (let o = 0; o < n; o++) {
      const k = ord[o], M = this.MAT[this.lm[k]];
      if (M.genere === GAS) { gas++; continue; }      // il gas va dall'alto in basso, dopo
      const c = this.lc[k], i = c % W, j = (c / W) | 0;
      const sotto = j + 1 < Hc ? c + W : -1, ms = sotto >= 0 ? mat[sotto] : SOLIDO;
      if (ms === VUOTO) {
        // caduta: il liquido aderente a una parete scende piano (colatura), il resto libero e poi più svelto
        const muro = M.genere === LIQUIDO && ((i > 0 ? mat[c - 1] : SOLIDO) === SOLIDO || (i < W - 1 ? mat[c + 1] : SOLIDO) === SOLIDO);
        if (this.la[k] && !muro) this.la[k] = 0;
        this.lf[k] = 0; this.ls[k] = M.slancio; su++;
        if (this.lcad[k] < 255) this.lcad[k]++;
        if (this.la[k]) {
          if (++this.lk[k] < M.colatura) continue;
          this.lk[k] = 0; this._sposta(k, c, sotto);
          continue;
        }
        // caduta con accelerazione vera: velocità in celle per passo che cresce con g, spostamento accumulato (frazioni comprese)
        const vy = (this.lvy[k] = Math.min(M.cadMax, this.lvy[k] + M.cadG * this._gPasso)), quanti = Math.floor((this.lac[k] += vy));
        if (quanti < 1) continue;              // da ferma parte piano: frazioni di cella che si accumulano
        let d = sotto;
        for (let q = 1; q < quanti && d + W < W * Hc && mat[d + W] === VUOTO; q++) d += W;
        this.lac[k] -= quanti;
        this._sposta(k, c, d);
        continue;
      }
      this.lcad[k] = 0; this.lvy[k] = 0; this.lac[k] = 0;
      if (M.sopra) su++;
      // diagonale in basso: corre lungo le pendenze, cola dal bordo, una pila si allarga
      const pd = ms === SOLIDO || ms === PIATTA ? this.pend[sotto] : 0, d1 = pd || this.ld[k];
      let mosso = false;
      for (let q = 0; q < 2 && !mosso; q++) {
        const d = q ? -d1 : d1, ni = i + d;
        if (ni < 0 || ni >= W || mat[c + d] !== VUOTO || j + 1 >= Hc || mat[sotto + d] !== VUOTO) continue;
        this._sposta(k, c, sotto + d); this.ld[k] = d; this.ls[k] = pd ? M.slancioP : M.slancio; this.lf[k] = 0; mosso = true;
        if (pd) break;      // sulla pendenza non si risale
      }
      if (mosso) continue;
      if (M.genere === LIQUIDO) {
        if (pd) {          // sulla pendenza scende di lato senza consumare lo slancio (che lo porta oltre il piede)
          if (++this.lk[k] >= M.pendPassi) {
            this.lk[k] = 0;
            const ni = i + pd;
            if (ni >= 0 && ni < W && mat[c + pd] === VUOTO) { this._sposta(k, c, c + pd); this.ld[k] = pd; this.ls[k] = M.slancioP; this.lf[k] = 0; continue; }
          }
        } else if (this.lliv[k] > 0 && ms > 0 && ms < PIATTA && this.MAT[ms].genere === LIQUIDO) {
          // sopra altro liquido non si ammucchia: scorre di lato (girando contro gli ostacoli) finché trova dove scendere
          this.lliv[k]--;
          let d = this.ld[k], ni = i + d;
          if (ni < 0 || ni >= W || mat[c + d] !== VUOTO) { d = -d; ni = i + d; }
          if (ni >= 0 && ni < W && mat[c + d] === VUOTO) { this._sposta(k, c, c + d); this.ld[k] = d; this.lf[k] = 0; continue; }
          this.ld[k] = d;
        } else if (this.ls[k] > 0) {   // di lato finché ha slancio (denso: poche celle)
          const d = this.ld[k], ni = i + d;
          if (ni >= 0 && ni < W && mat[c + d] === VUOTO) { this._sposta(k, c, c + d); this.ls[k]--; this.lf[k] = 0; continue; }
          this.ls[k] = 0;
        }
      }
      // ferma: il liquido secca in macchia, la polvere svanisce
      if (++this.lf[k] >= (M.genere === LIQUIDO ? M.seccaS : M.svanisceS) / this.hG) { this.lsec[k] = 1; via++; }
    }
    if (gas) for (let o = n - 1; o >= 0; o--) {
      const k = ord[o], M = this.MAT[this.lm[k]];
      if (M.genere !== GAS) continue;
      if (M.sopra) su++;
      if (++this.le[k] >= M.vitaS / this.hG) { this.lsec[k] = 1; via++; continue; }
      const c = this.lc[k], i = c % W, j = (c / W) | 0;
      if (j === 0) { this.lsec[k] = 1; via++; continue; }     // esce dalla stanza in alto
      if (++this.lk[k] >= M.saleP) {
        this.lk[k] = 0;
        const s = c - W;
        if (mat[s] === VUOTO) { this._sposta(k, c, s); continue; }
        let mosso = false;
        for (let q = 0; q < 2 && !mosso; q++) {
          const d = q ? -this.ld[k] : this.ld[k], ni = i + d;
          if (ni < 0 || ni >= W || mat[s + d] !== VUOTO || mat[c + d] !== VUOTO) continue;
          this._sposta(k, c, s + d); this.ld[k] = d; mosso = true;
        }
        if (mosso) continue;
      }
      // si allarga: un passo di lato ogni tanto (dal seme), cambiando verso contro un ostacolo
      if (M.allarga && h01(this.lq[k] * 977 + this.le[k] * 31 + k) < M.allarga) {
        const d = this.ld[k], ni = i + d;
        if (ni >= 0 && ni < W && mat[c + d] === VUOTO) this._sposta(k, c, c + d); else this.ld[k] = -d;
      }
    }
    this.nSu = su;
    if (!via && !this.viaFuori) return;   // (TAR) viaFuori: strati di troppo segnati al deposito
    this.viaFuori = 0;
    // dall'ultimo al primo: lo scambio con l'ultima porta qui una cella già guardata
    for (let k = this.nCel - 1; k >= 0; k--) {
      if (!this.lsec[k]) continue;
      const c = this.lc[k], M = this.MAT[this.lm[k]];
      if (M.macchia) this._macchia(c, this.lm[k], this.lq[k]);
      mat[c] = VUOTO; quale[c] = 0;
      const u = --this.nCel;
      if (k !== u) {
        this.lc[k] = this.lc[u]; this.lm[k] = this.lm[u]; this.ls[k] = this.ls[u]; this.ld[k] = this.ld[u]; this.lf[k] = this.lf[u];
        this.la[k] = this.la[u]; this.lk[k] = this.lk[u]; this.lq[k] = this.lq[u]; this.lcad[k] = this.lcad[u]; this.lsec[k] = this.lsec[u]; this.le[k] = this.le[u];
        this.lvy[k] = this.lvy[u]; this.lac[k] = this.lac[u]; this.lliv[k] = this.lliv[u]; this.lt[k] = this.lt[u];   // (TAR) lt
        quale[this.lc[k]] = k + 1;
      }
      this.lsec[u] = 0;
    }
  }
  _sposta(k, c, d) {
    const m = this.mat;
    m[d] = m[c]; this.quale[d] = k + 1; m[c] = VUOTO; this.quale[c] = 0; this.lc[k] = d;
  }
  _macchia(c, materia, q) {
    const s = this.mIn[c];
    if (s) { this.mt[s - 1] = this.t; this.mq[s - 1] = q; this.mm[s - 1] = materia; return; }   // già macchiata: si rinfresca
    const k = this.mTesta, NM = this.NM;
    if (this.nMac >= NM) { const v = this.mc[k]; if (this.mIn[v] === k + 1) this.mIn[v] = 0; } else this.nMac++;
    this.mc[k] = c; this.mq[k] = q; this.mm[k] = materia; this.mt[k] = this.t; this.mIn[c] = k + 1;
    this.mTesta = (k + 1) % NM;
  }

  // ------------------------------------------------------------------------------------------------ disegno
  /** Vista in px di mondo dalla trasformazione di camera (oggetto riusato). */
  vistaDa(camX, z, te, tf, VW, VH) {
    const v = this._vista, m = this.T.margine_vista_px;
    v.x0 = camX - te / z - m; v.x1 = camX + (VW - te) / z + m; v.y0 = -tf / z - m; v.y1 = (VH - tf) / z + m;
    return v;
  }
  /**
   * Solo resa a pixel (ripiego interno), prima della luce: macchie, materia ferma e timbri dello strato 0. Nelle lettere non
   * fa nulla: tutto passa da disegnaFine (gli agganci di prova.mjs restano validi e inerti).
   */
  disegnaSotto(cx, camX, vista) {
    if (this.modo !== 1 || !this.mat) return;
    this.chiamate = 0;
    if (!this.nCel && !this.nMac && !this.tq[0].n) return;
    if (!this._atlante()) return;
    this._cx = cx; this._camX = camX;
    this._disegnaTerra(vista, this.nVolo + this.nSu + this.tq[1].n);
  }
  /** Solo resa a pixel, dopo la luce: volo, materia che cade, timbri dello strato 1; punto(x, y, r, forza, tono) = bagliore. Lettere: nulla. */
  disegnaSopra(cx, camX, vista, punto = null) {
    if (this.modo !== 1 || !this.mat) return;
    if (!this.nVolo && !this.nSu && !this.tq[1].n && !this._baglioriVivi()) return;
    if (!this._atlante()) return;
    this._cx = cx; this._camX = camX;
    this._disegnaAria(vista);
    if (punto) this._bagliori(punto, camX);
  }
  _baglioriVivi() { for (let k = 0; k < 4; k++) if (this.bf[k] > 0 && this.t - this.bt[k] < this.T.bagliore_s) return true; return false; }
  _bagliori(punto, camX) {
    const dur = this.T.bagliore_s;
    for (let k = 0; k < 4; k++) {
      if (!(this.bf[k] > 0)) continue;
      const a = this.t - this.bt[k];
      if (a >= dur) { this.bf[k] = 0; continue; }
      punto(this.bx[k] - camX, this.by[k], this.br[k], this.bf[k] * (1 - a / dur), 'cremisi');
    }
  }
  // quanti di n disegni entrano nel tetto (proprio e globale), tenendo `riserva` per ciò che sta sopra
  _quanti(n, riserva) {
    if (n <= 0) return 0;
    n = Math.min(n, Math.max(0, this.T.chiamate - this.chiamate - riserva));
    while (n > 0) { if (posto(n + riserva)) return n; n = n > 16 ? n >> 1 : 0; }
    return 0;
  }
  _spesa(n) { this.chiamate += n; TETTO_FX.n += n; }
  _disegnaTerra(V, riserva) {
    // a tetto stretto cadono prima le macchie, poi la materia ferma: la ferma chiede posto per prima
    const Q = this.tq[0], nF = this.nCel - this.nSu + Q.n, aF = this._quanti(nF, riserva), aM = this._quanti(this.nMac, riserva + aF);
    let n = 0;
    if (aM) {   // dalle più nuove: a tetto stretto svaniscono le più vecchie
      const NM = this.NM, W = this.gw, cw = this.cw, ch = this.ch;
      for (let q = 0, k = (this.mTesta - 1 + NM) % NM; q < this.nMac && n < aM; q++, k = (k - 1 + NM) % NM) {
        const M = this.MAT[this.mm[k]], eta = this.t - this.mt[k];
        if (!M || eta > M.vitaMac) continue;
        const c = this.mc[k];
        if (this.mIn[c] !== k + 1) continue;
        const i = c % W, j = (c / W) | 0, x = i * cw, y = (j + 1) * ch;
        if (x < V.x0 || x > V.x1 || y < V.y0 || y > V.y1) continue;
        this._gb(M.glMac[this.mq[k] % M.glMac.length], eta < M.scuraS ? M.cMac : M.cVecchia, x, y + this._appoggio(i, j), true);
        n++;
      }
    }
    if (aF) { const t = this._timbri(Q, V, aF); n += t + this._disegnaCelle(V, false, aF - t); }
    Q.n = 0;
    this._spesa(n);
  }
  _disegnaAria(V) {
    const Q = this.tq[1], tot = this.nVolo + this.nSu + Q.n + Math.max(this._scia, this.nVolo * 2), a = this._quanti(tot, 0), nasc = this.T.nascita_s, cap = this.T.chiamate - this.chiamate;
    let n = 0, extra = 0, sc = 0;
    for (let i = 0; i < this.NV; i++) {
      if (!this.vivo[i]) continue;
      const x = this.px[i], y = this.py[i];
      if (x < V.x0 || x > V.x1 || y < V.y0 || y > V.y1) continue;
      if (n >= a) { if (this.ve[i] > nasc || n >= cap) continue; extra++; }   // i nati adesso passano anche a tetto globale pieno, mai oltre il tetto proprio
      const gi = this._glifoVolo(i), st = this._stadio(i), M = this.MAT[this.vm[i]], C = M.toni[this.vtono[i]].C;
      this._gc(gi, C[st], x, y);
      n++;
      // scia: glifi dietro alla testa lungo la velocità, uno stadio di colore più scuri a ogni passo
      const T = this.tipi[this.vt[i]];
      if (T.sciaN && n < a) {
        const vx = this.vx[i], vy = this.vy[i], v = Math.sqrt(vx * vx + vy * vy), p = this.cw, ox = x - this.sx0[i], oy = y - this.sy0[i];
        const L = Math.min(T.sciaN, Math.floor(v * T.sciaS / p), Math.floor(Math.sqrt(ox * ox + oy * oy) / p));
        if (L > 0 && (gi === this.gv.meno || gi === this.gv.sl || gi === this.gv.bs || gi === this.gv.bar)) {   // solo i trattini del moto veloce
          const ux = vx / v * p, uy = vy / v * p;
          for (let s = 1; s <= L && n < a; s++, n++, sc++) this._gc(gi, C[Math.min(C.length - 1, st + (s >> 1))], x - ux * s, y - uy * s);   // si spegne ogni due glifi
        }
      }
    }
    this._scia = sc;    // glifi di scia di questo fotogramma: stima per il posto da chiedere al prossimo
    let r = a - (n - extra);
    if (r > 0) { const t = this._timbri(Q, V, r); n += t; r -= t; }
    Q.n = 0;
    if (r > 0) n += this._disegnaCelle(V, true, r);
    this._spesa(n);
  }
  _timbri(Q, V, max) {
    let n = 0;
    for (let k = 0; k < Q.n && n < max; k++) {
      const x = Q.x[k], y = Q.y[k];
      if (x < V.x0 || x > V.x1 || y < V.y0 || y > V.y1) continue;
      this._gc(Q.g[k], Q.c[k], x, y); n++;
    }
    return n;
  }
  _glifoVolo(i) {
    const T = this.tipi[this.vt[i]];
    if (T.gi) return T.gi;
    const M = this.dati.moto, H = this.H, vx = this.vx[i], vy = this.vy[i], s2 = vx * vx + vy * vy, vf = M.veloce_H_s * H, vl = M.lento_H_s * H;
    if (s2 > vf * vf) {
      const ax = vx < 0 ? -vx : vx, ay = vy < 0 ? -vy : vy;
      if (ay < ax * this._tO) return this.gv.meno;
      if (ay > ax * this._tV) return this.gv.bar;
      return vx * vy < 0 ? this.gv.sl : this.gv.bs;     // y in giù: destra e su = /
    }
    if (s2 > vl * vl) return vy < 0 ? this.gv.ap : this.gv.vir;
    return this.gv.pun;
  }
  // stadio del tono per l'età
  _stadio(i) {
    const L = this.MAT[this.vm[i]].toni[this.vtono[i]].T, e = this.ve[i];
    if (this.tipi[this.vt[i]].rich) {    // richiamati: il colore segue il cammino (si accende avvicinandosi), non l'età
      const hov = this.vr[i], u = e <= hov ? 0 : (e - hov) / Math.max(1e-3, this.vv[i] - hov);
      return Math.min(L.length - 1, Math.floor(u * L.length));
    }
    for (let k = 0; k < L.length; k++) if (e < L[k]) return k;
    return L.length - 1;
  }
  // scostamento verticale per appoggiare il glifo sulla superficie vera sotto la colonna di materia (al più 4 celle)
  _appoggio(i, j) {
    const W = this.gw, mat = this.mat;
    for (let jj = j + 1, q = 0; jj < this.gh && q < 4; jj++, q++) {
      const m = mat[jj * W + i];
      if (m === SOLIDO || m === PIATTA) return this.sup[jj * W + i];
      if (m === VUOTO) return 0;
    }
    return 0;
  }
  // celle vive: dello strato sopra (cadono o materia «sopra») o di quello sotto; al più `max`
  _disegnaCelle(V, sopra, max) {
    const W = this.gw, mat = this.mat, cw = this.cw, ch = this.ch;
    let n = 0;
    for (let k = 0; k < this.nCel && n < max; k++) {
      const M = this.MAT[this.lm[k]], cad = this.lcad[k] > 0;
      if ((cad || M.sopra) !== sopra) continue;
      const c = this.lc[k], i = c % W, j = (c / W) | 0, x = i * cw, y = (j + 1) * ch;
      if (x < V.x0 || x > V.x1 || y < V.y0 || y > V.y1) continue;
      const su = j > 0 ? mat[c - W] : VUOTO, pienoSu = su > 0 && su < PIATTA;
      let gl, col;
      if (M.genere === GAS) {
        const f = Math.min(M.etaG.length - 1, Math.floor(this.le[k] * this.hG / M.vitaS * M.etaG.length));
        gl = M.etaG[f]; col = M.etaC[Math.min(M.etaC.length - 1, f)];
        this._gb(gl, col, x, y, !M.sopra);
        n++; continue;
      }
      if (M.genere === LIQUIDO && this.la[k] && ((i > 0 ? mat[c - 1] : SOLIDO) === SOLIDO || (i < W - 1 ? mat[c + 1] : SOLIDO) === SOLIDO)) { gl = M.gAder; col = M.cAder; }
      else if (cad) { gl = pienoSu && M.genere === LIQUIDO ? M.gFilo : M.gCade; col = M.cCade; }
      else {
        col = M.cFermo;
        if (pienoSu) { const s2 = j > 1 ? mat[c - 2 * W] : VUOTO; gl = s2 > 0 && s2 < PIATTA ? M.gFondo2 : M.gFondo; }
        else {
          const l = i > 0 ? mat[c - 1] : 0, r = i < W - 1 ? mat[c + 1] : 0;
          gl = l > 0 && l < PIATTA && r > 0 && r < PIATTA ? M.gPozza : M.gFermo;
        }
      }
      this._gb(gl, col, x, y + (cad ? 0 : this._appoggio(i, j)), !cad);
      n++;
    }
    return n;
  }

  // ---- pennelli della resa a pixel: un glifo per chiamata
  // centrato su (x, y) in px di mondo
  _gc(gi, ci, x, y) { this._cx.drawImage(this.atl, ci * 4, gi * 6, 3, 5, Math.round(x - this._camX) - 1, Math.round(y) - 2, 3, 5); }
  // cella: angolo in basso a sinistra (x, yFondo) in px di mondo
  _gb(gi, ci, x, yb) { this._cx.drawImage(this.atl, ci * 4, gi * 6, 3, 5, Math.round(x - this._camX), Math.round(yb) - 5, 3, 5); }
  // lettere: un gradino più scuro nel buio, più chiaro nella luce, dentro la stessa tavolozza (dal chiaro allo scuro)
  _luce(ci, lv) {
    const L = this.LD.luce, d = lv < L[0] ? 1 : lv < L[1] ? 0 : -1;
    if (!d) return ci;
    // (OTT1) tabelle colore → un gradino più scuro / più chiaro, fatte una volta per registro (prima: for…in sulle tavolozze
    // per ogni cella illuminata, 2,4 % del tempo del gioco a strato acceso); stesso risultato
    const T = this._lT || this._tabLuce();
    return ci < T.n ? (d > 0 ? T.scuro[ci] : T.chiaro[ci]) : ci;
  }
  _tabLuce() {
    const n = this.pal.length, scuro = new Uint16Array(n), chiaro = new Uint16Array(n);
    for (let ci = 0; ci < n; ci++) {
      scuro[ci] = chiaro[ci] = ci;
      for (const nome in this.tav) { const v = this.tav[nome]; if (ci >= v.o && ci < v.o + v.n) { scuro[ci] = Math.min(v.o + v.n - 1, ci + 1); chiaro[ci] = Math.max(v.o, ci - 1); break; } }
    }
    return (this._lT = { n, scuro, chiaro });
  }

  // atlante a pixel: una colonna per colore, una riga per glifo (celle 4 × 6, glifo 3 × 5 in alto a sinistra)
  _atlante() {
    if (this.atl) return this.atl;
    const pal = this.pal.map(rgb), w = pal.length * 4, h = this.alfa.length * 6, px = new Uint8ClampedArray(w * h * 4);
    for (let g = 1; g < this.alfa.length; g++) for (let c = 0; c < pal.length; c++) for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) {
      if (!((this.mask[g] >> (14 - r * 3 - q)) & 1)) continue;
      const o = ((g * 6 + r) * w + c * 4 + q) * 4;
      px[o] = pal[c][0]; px[o + 1] = pal[c][1]; px[o + 2] = pal[c][2]; px[o + 3] = 255;
    }
    this.atl = Ascii.tela(w, h, px);
    return this.atl;
  }
  /** Tela con i pixel dati: canvas vero nel browser, oggetto {width, height, data} in node (lo legge tela_sw e lo conta il contesto finto). */
  static tela(w, h, px) {
    if (typeof document !== 'undefined' && typeof ImageData !== 'undefined') {
      const t = document.createElement('canvas'); t.width = w; t.height = h;
      t.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0);
      return t;
    }
    return { width: w, height: h, data: px };
  }

  // ------------------------------------------------------------------------------------------------ lettere: campo d'energia
  // È il «filtro»: i caratteri in volo depositano energia, verso e materia nelle celle che attraversano; l'energia decade
  // (lettere.decadimento_s) e la lettera della cella si legge dal livello: pesante → tratto orientato → punto → spenta.
  // Verso del moto come codice: 1 '-', 2 '/', 3 '|', 4 '\' (veloce), 5 sale, 6 scende (lento), 0 fermo.
  _verso(vx, vy) {
    const M = this.dati.moto, H = this.H, s2 = vx * vx + vy * vy, vf = M.veloce_H_s * H, vl = M.lento_H_s * H;
    if (s2 > vf * vf) {
      const ax = vx < 0 ? -vx : vx, ay = vy < 0 ? -vy : vy;
      if (ay < ax * this._tO) return 1;
      if (ay > ax * this._tV) return 3;
      return vx * vy < 0 ? 2 : 4;     // y in giù: destra e su = /
    }
    if (s2 > vl * vl) return vy < 0 ? 5 : 6;
    return 0;
  }
  // energia per cella attraversata: del tipo; più forte appena nato; i richiamati si accendono avvicinandosi al bersaglio
  _peso(i) {
    const T = this.tipi[this.vt[i]], e = this.ve[i], L = this.LD;
    if (T.rich) {
      const hov = this.vr[i], u = e <= hov ? 0 : Math.min(1, (e - hov) / Math.max(1e-3, this.vv[i] - hov));
      return T.en * (L.richiamo_k[0] + (L.richiamo_k[1] - L.richiamo_k[0]) * u);
    }
    return (e < this.T.nascita_s ? T.en * L.fresco_k : T.en) * (1 - L.vecchio_k * Math.min(1, e / this.vv[i]));   // verso la fine si spegne: punti
  }
  // carica la cella (i, j) e, un poco, le quattro vicine: la scia ha corpo e dove le scie si incrociano l'energia si somma
  // u = terzo della cella (0 alto, 1 mezzo, 2 basso) in cui passa il moto: sceglie fra i tratti della stessa direzione
  // (`~ - _` per l'orizzontale): la scia segue la forma vera del cammino invece di fare una riga di trattini uguali
  _accendi(i, j, e, d, m, t, u) {
    if (i < 0 || j < 0 || i >= this.gw || j >= this.gh || !(e > 0)) return;
    const W = this.gw, c = j * W + i;
    this._carica(c, e, d, m, t, u);
    const s = e * this.LD.spargi;
    if (s < this.spegni) return;
    if (i > 0) this._carica(c - 1, s, d, m, t, u);
    if (i < W - 1) this._carica(c + 1, s, d, m, t, u);
    if (j > 0) this._carica(c - W, s, d, m, t, 2);       // il cammino passa sotto la cella di sopra
    if (j < this.gh - 1) this._carica(c + W, s, d, m, t, 0);
  }
  _carica(c, e, d, m, t, u) {
    const q = this.mat[c];
    if (q === SOLIDO || q === PIATTA) return;          // niente lettere dentro i muri
    const v = this.en[c];
    if (v === 0) { if (this.nE >= this.NE) { this.persi++; return; } this.eL[this.nE++] = c; this.eK[c] = 0; }
    if (e >= v * 0.5) { this.eD[c] = d; this.eM[c] = m; this.eT[c] = t; this.eS[c] = u; }    // verso e materia di chi pesa di più
    if (this._cMax > this.eK[c]) this.eK[c] = this._cMax;     // classe più alta concessa da chi è passato (l'ago resta sottile)
    this.en[c] = v + e;
  }
  // nascita: carica un'ellisse di celle attorno al punto (lettere.nucleo = semiassi in celle), più forte al centro;
  // i caratteri nati insieme sommano lì e fanno il nucleo di lettere pesanti dove il colpo esce dal corpo
  _nucleo(i, x, y) {
    const T = this.tipi[this.vt[i]], [rx, ry] = T.nucleo ? this.LD.nucleo : [0, 0], e = this._peso(i) * this.LD.nascita_k, d = this._verso(this.vx[i], this.vy[i]), m = this.vm[i], t = this.vtono[i];
    const i0 = Math.floor(x / this.cw), j0 = Math.floor(y / this.ch);
    this._cMax = T.cMax;
    for (let dj = -ry; dj <= ry; dj++) for (let di = -rx; di <= rx; di++) {
      const q = 1 - (di * di) / ((rx + 1) * (rx + 1)) - (dj * dj) / ((ry + 1) * (ry + 1));
      const ii = i0 + di, jj = j0 + dj;
      if (q > 0 && ii >= 0 && jj >= 0 && ii < this.gw && jj < this.gh) this._carica(jj * this.gw + ii, e * q, d, m, t, 1);
    }
  }
  _terzo(y, j) { const f = y / this.ch - j; return f < 1 / 3 ? 0 : f < 2 / 3 ? 1 : 2; }
  // il carattere i è andato da (x0, y0) a dove sta: carica le celle nuove; nella sua rabbocca quanto decade (resta acceso)
  _traccia(i, x0, y0, h) {
    const e = this._peso(i);
    if (!(e > 0)) return;
    this._cMax = this.tipi[this.vt[i]].cMax;
    const cw = this.cw, ch = this.ch, dx = this.px[i] - x0, dy = this.py[i] - y0, d = this._verso(this.vx[i], this.vy[i]), m = this.vm[i], t = this.vtono[i];
    let pi = Math.floor(x0 / cw), pj = Math.floor(y0 / ch);
    this._accendi(pi, pj, e * this.LD.resta_k * (1 - Math.exp(-h / this.LD.decadimento_s)), d, m, t, this._terzo(y0, pj));
    // passi di mezza cella: si prende ogni cella toccata e il punto in cui il cammino la attraversa
    const n = Math.ceil(2 * Math.max(Math.abs(dx) / cw, Math.abs(dy) / ch));
    for (let s = 1; s <= n; s++) {
      const y = y0 + dy * s / n, ci = Math.floor((x0 + dx * s / n) / cw), cj = Math.floor(y / ch);
      if (ci === pi && cj === pj) continue;
      pi = ci; pj = cj;
      this._accendi(ci, cj, e, d, m, t, this._terzo(y, cj));
    }
  }
  // decadimento: sotto l'ultimo livello la cella si spegne ed esce dalla lista (scambio con l'ultima)
  _decadi(dt) {
    const f = Math.exp(-dt / this.LD.decadimento_s), lim = this.spegni, en = this.en, L = this.eL;
    for (let k = this.nE - 1; k >= 0; k--) {
      const c = L[k], v = en[c] * f;
      if (v >= lim) { en[c] = v; continue; }
      en[c] = 0; this.eM[c] = 0; L[k] = L[--this.nE];
    }
  }
  _livello(v) { const L = this.livelli; for (let k = 0; k < L.length; k++) if (v >= L[k]) return k; return -1; }

  // ------------------------------------------------------------------------------------------------ lettere: composizione
  // Una lettera per cella: chi vuole la cella la chiede con una priorità e vince la più alta.
  // 8 energia pesante · 7 timbri dello strato 1 e teste dei caratteri · 6 tratti · 5 punti · 4 materia che cade, gas
  // 3 materia ferma · 2 timbri dello strato 0 · 1 macchie. A tetto stretto cadono dalle priorità basse.
  _metti(c, g, col, p) {
    const q = this.fP[c];
    if (p <= q || !g) return;
    if (!q) { if (this.nF >= this.NF) return; this.fL[this.nF++] = c; }
    this.fP[c] = p; this.fG[c] = g; this.fC[c] = col;
  }
  _cellaVista(x, y) {   // indice della cella che contiene (x, y) se è nella vista, sennò −1
    const i = Math.floor(x / this.cw), j = Math.floor(y / this.ch);
    return i < this._i0 || i > this._i1 || j < this._j0 || j > this._j1 ? -1 : j * this.gw + i;
  }
  _componi(V) {
    const W = this.gw, cw = this.cw, ch = this.ch, mat = this.mat;
    this._i0 = Math.max(0, Math.floor(V.x0 / cw)); this._i1 = Math.min(W - 1, Math.floor(V.x1 / cw));
    this._j0 = Math.max(0, Math.floor(V.y0 / ch)); this._j1 = Math.min(this.gh - 1, Math.floor(V.y1 / ch));
    if (this._i1 < this._i0 || this._j1 < this._j0) return;
    const lume = this._lume;
    // macchie (dalle più nuove)
    for (let q = 0, NM = this.NM, k = (this.mTesta - 1 + NM) % NM; q < this.nMac; q++, k = (k - 1 + NM) % NM) {
      const M = this.MAT[this.mm[k]], eta = this.t - this.mt[k], c = this.mc[k];
      if (!M || eta > M.vitaMac || this.mIn[c] !== k + 1) continue;
      const i = c % W, j = (c / W) | 0;
      if (i < this._i0 || i > this._i1 || j < this._j0 || j > this._j1) continue;
      let col = eta < M.scuraS ? M.cMac : M.cVecchia;
      if (lume) col = this._luce(col, lume.livello((i + 0.5) * cw, (j + 0.5) * ch));
      this._metti(c, M.glMac[this.mq[k] % M.glMac.length], col, 1);
    }
    // timbri dei moduli esterni: nella cella che contiene il loro centro
    for (let s = 0; s < 2; s++) {
      const Q = this.tq[s], p = s ? 7 : 2;
      for (let k = 0; k < Q.n; k++) { const c = this._cellaVista(Q.x[k], Q.y[k]); if (c >= 0) this._metti(c, Q.g[k], Q.c[k], p); }
    }
    // materia viva in griglia, con i suoi caratteri di stato
    for (let k = 0; k < this.nCel; k++) {
      const M = this.MAT[this.lm[k]], c = this.lc[k], i = c % W, j = (c / W) | 0;
      if (i < this._i0 || i > this._i1 || j < this._j0 || j > this._j1) continue;
      const cad = this.lcad[k] > 0, su = j > 0 ? mat[c - W] : VUOTO, pienoSu = su > 0 && su < PIATTA;
      let gl, col, p = cad || M.sopra ? 4 : 3;
      if (M.genere === GAS) {
        const f = Math.min(M.etaG.length - 1, Math.floor(this.le[k] * this.hG / M.vitaS * M.etaG.length));
        gl = M.etaG[f]; col = M.etaC[Math.min(M.etaC.length - 1, f)]; p = M.sopra ? 4 : 3;
      } else if (M.genere === LIQUIDO && this.la[k] && ((i > 0 ? mat[c - 1] : SOLIDO) === SOLIDO || (i < W - 1 ? mat[c + 1] : SOLIDO) === SOLIDO)) { gl = M.gAder; col = M.cAder; }
      else if (cad) { gl = pienoSu && M.genere === LIQUIDO ? M.gFilo : M.gCade; col = M.cCade; }
      else {
        col = M.cFermo;
        if (pienoSu) { const s2 = j > 1 ? mat[c - 2 * W] : VUOTO; gl = s2 > 0 && s2 < PIATTA ? M.gFondo2 : M.gFondo; }
        else {
          const l = i > 0 ? mat[c - 1] : 0, r = i < W - 1 ? mat[c + 1] : 0;
          gl = l > 0 && l < PIATTA && r > 0 && r < PIATTA ? M.gPozza : M.gFermo;
        }
        if (lume) col = this._luce(col, lume.livello((i + 0.5) * cw, (j + 0.5) * ch));
      }
      this._metti(c, gl, col, p);
    }
    // campo d'energia: livello → classe (pesante, tratto, punto) → lettera dell'alfabeto della materia; colore dal livello
    const tick = Math.floor(this.t / this.LD.cambio_s);
    for (let k = 0; k < this.nE; k++) {
      const c = this.eL[k], i = c % W, j = (c / W) | 0;
      if (i < this._i0 || i > this._i1 || j < this._j0 || j > this._j1) continue;
      const lv = this._livello(this.en[c]), M = this.MAT[this.eM[c]];
      if (lv < 0 || !M || !M.L) continue;
      const A = M.L, cl = Math.min(this.classi[lv], this.eK[c]), d = this.eD[c], C = A.toniL[this.eT[c]] || A.toniL[0];
      let g, p;
      if (cl === 2) { g = A.pes[(h01(c * 31 + tick * 7919 + lv) * A.pes.length) | 0]; p = 8; }
      else if (cl === 1) { if (d >= 1 && d <= 4) { const T = A.tra[d - 1]; g = T[T.length === 3 ? this.eS[c] : 0]; } else g = d === 5 ? A.su : d === 6 ? A.giu : A.denso; p = 6; }
      else { g = d === 5 ? A.su : d === 6 ? A.giu : d ? (this.eS[c] === 0 ? A.su : this.eS[c] === 2 ? A.fermo : A.denso) : A.fermo; p = 5; }   // ai bordi di una scia veloce: ' sopra, . sotto
      this._metti(c, g, C[lv], p);
    }
    // teste dei caratteri con un glifo proprio (urto *, schizzo ., tipi registrati) o con la lettera pesante della materia
    for (let i = 0; i < this.NV; i++) {
      if (!this.vivo[i]) continue;
      const T = this.tipi[this.vt[i]];
      if (!T.gi && !T.testaP) continue;
      const c = this._cellaVista(this.px[i], this.py[i]), M = this.MAT[this.vm[i]];
      if (c < 0 || !M || !M.L) continue;
      const C = M.L.toniL[this.vtono[i]] || M.L.toniL[0], lv = this._livello(this.en[c]);
      this._metti(c, T.gi || M.L.pes[this.vs[i] % M.L.pes.length], C[lv < 0 ? C.length - 1 : lv], 7);
    }
  }
  // una drawImage per cella accesa, al più tetti.lettere (e quanto concede il tetto globale; i caratteri vivi passano sempre)
  // Due strati: priorità fino a 3 (macchie, timbri dello strato 0, materia ferma, gas di fondo) stanno DIETRO ai personaggi,
  // il resto DAVANTI. Con cxDav le lettere di dietro vanno in cx e si bucano con le sagome (asc.buco); senza, tutto in cx,
  // prima quelle di dietro e poi quelle davanti, senza buchi.
  _stampa(cx, A, aw, ah, camX, z, te, tf, k, cxDav) {
    const P = this.contaP, fL = this.fL, fP = this.fP, nF = this.nF, DIETRO = this.LD.dietro_fino;
    P.fill(0);
    for (let q = 0; q < nF; q++) P[fP[fL[q]]]++;
    const cap = Math.min(this.T.lettere, nF), vivi = Math.min(cap, P[8] + P[7] + P[6]);
    let a = cap;
    while (a > 0 && !posto(a)) a = a > 16 ? a >> 1 : 0;     // quanto concede il tetto globale degli effetti
    const budget = Math.max(a, vivi);
    let cut = 0, resto = 0, cum = 0;
    for (let p = 8; p >= 1; p--) { if (cum + P[p] <= budget) { cum += P[p]; continue; } cut = p; resto = budget - cum; break; }
    const W = this.gw, cw = this.cw, ch = this.ch, img = A.img, sw = A.aw, sh = A.ah;
    const R = (this._rd ||= new Float64Array(8));   // (OTT1) rettangolo delle lettere disegnate per tela [x0 y0 x1 y1] × (dietro, davanti), px
    R[0] = R[1] = R[4] = R[5] = Infinity; R[2] = R[3] = R[6] = R[7] = -Infinity;
    let n = 0;
    for (let pass = 0; pass < 2; pass++) {       // 0: dietro, 1: davanti
      const dst = pass && cxDav ? cxDav : cx, o = pass && cxDav ? 4 : 0;
      for (let q = 0; q < nF; q++) {
        const c = fL[q], p = fP[c];
        if ((p > DIETRO) !== (pass === 1)) continue;
        if (p < cut || (p === cut && resto-- <= 0)) continue;
        const i = c % W, j = (c / W) | 0, X = Math.round(((i * cw - camX) * z + te) * k), Y = Math.round((j * ch * z + tf) * k);
        dst.drawImage(img, this.fG[c] * sw, this.fC[c] * sh, sw, sh, X, Y, aw, ah);
        if (X < R[o]) R[o] = X; if (Y < R[o + 1]) R[o + 1] = Y; if (X + aw > R[o + 2]) R[o + 2] = X + aw; if (Y + ah > R[o + 3]) R[o + 3] = Y + ah;
        n++;
      }
      if (!pass && cxDav) this._buchi(cx, camX, z, te, tf, k, true);   // (OTT1) true: solo dove ci sono lettere di dietro
    }
    for (let q = 0; q < nF; q++) fP[fL[q]] = 0;
    this.nF = 0; this.nLettere = n; this.nB = 0;
    this._spesa(n);
    return n;
  }

  // ------------------------------------------------------------------------------------------------ lettere: buchi
  /**
   * La sagoma di uno sprite buca lo strato di DIETRO (destination-out): macchie, nebbia e timbri dello strato 0 restano
   * dietro a protagonista e nemici. Stessi argomenti della drawImage dello sprite, ma in px di MONDO (dw < 0 = specchiato).
   * Da chiamare quando si disegna lo sprite; vale per il disegno di questo fotogramma. false se la coda è piena.
   */
  buco(img, sx, sy, sw, sh, dx, dy, dw, dh) {
    if (this.modo !== LETTERE || !img || !(sw > 0 && sh > 0) || !dw || !(dh > 0)) return false;
    const Q = (this.bq ||= Array.from({ length: this.T.buchi }, () => ({ img: null, sx: 0, sy: 0, sw: 0, sh: 0, dx: 0, dy: 0, dw: 0, dh: 0 })));
    if (this.nB >= Q.length) { this.persi++; return false; }
    const B = Q[this.nB++];
    B.img = img; B.sx = sx; B.sy = sy; B.sw = sw; B.sh = sh; B.dx = dx; B.dy = dy; B.dw = dw; B.dh = dh;
    return true;
  }
  _buchi(cx, camX, z, te, tf, k, filtra = false) {
    for (let q = 0; q < (this.nB || 0); q++) {
      const B = this.bq[q], s = z * k, X = ((B.dx - camX) * z + te) * k, Y = (B.dy * z + tf) * k;
      // (OTT1) niente lettere di dietro sotto la sagoma: il buco non toglierebbe nulla (prima: un drawImage in destination-out
      // alla risoluzione dello schermo per ogni sprite, anche sul vuoto). lettere.buchi_solo_su_lettere: false = come prima
      if (filtra && this.LD.buchi_solo_su_lettere && this._rd) {
        const R = this._rd, w = Math.abs(B.dw) * s, x0 = B.dw < 0 ? X - w : X;
        if (!(x0 < R[2] && x0 + w > R[0] && Y < R[3] && Y + B.dh * s > R[1])) { B.img = null; this.buchiSaltati = (this.buchiSaltati || 0) + 1; continue; }
      }
      if (cx.canvas && cx.canvas.data && B.img.data) { this._bucaSW(cx.canvas, B, s, X, Y); continue; }   // tela software (node)
      try {
        cx.save();
        cx.globalCompositeOperation = 'destination-out';
        cx.setTransform(B.dw < 0 ? -s : s, 0, 0, s, X, Y);
        cx.drawImage(B.img, B.sx, B.sy, B.sw, B.sh, 0, 0, Math.abs(B.dw), B.dh);
        cx.restore();
      } catch { /* contesto senza composizione: niente buco */ }
      B.img = null;
    }
  }
  // stesso buco a mano sui pixel (la tela software di node non ha destination-out)
  _bucaSW(T, B, s, X, Y) {
    const D = T.data, S = B.img.data, SW = B.img.width, w = Math.abs(B.dw) * s, h = B.dh * s, x0 = B.dw < 0 ? X - w : X;
    const a0 = Math.max(0, Math.floor(x0)), a1 = Math.min(T.width, Math.ceil(x0 + w)), b0 = Math.max(0, Math.floor(Y)), b1 = Math.min(T.height, Math.ceil(Y + h));
    for (let y = b0; y < b1; y++) for (let x = a0; x < a1; x++) {
      let u = (x + 0.5 - x0) / w;
      if (B.dw < 0) u = 1 - u;
      const px = Math.floor(B.sx + u * B.sw), py = Math.floor(B.sy + (y + 0.5 - Y) / h * B.sh), a = S[(py * SW + px) * 4 + 3];
      if (a) { const o = (y * T.width + x) * 4 + 3; D[o] = Math.round(D[o] * (1 - a / 255)); }
    }
    B.img = null;
  }

  // ------------------------------------------------------------------------------------------------ lettere: disegno
  /**
   * Il nucleo della resa a lettere, su qualunque contesto 2D (la tela propria nel gioco, una TelaSW nelle tavole).
   * Trasformazione di camera del gioco (camX, z, te, tf) moltiplicata per k (px del contesto per px della tela di gioco);
   * W, H = misura del contesto in px (vista). cxDav: contesto dello strato DAVANTI (cx resta quello di dietro e si buca
   * con le sagome di asc.buco); senza, tutto in cx. Svuota le code dei timbri e dei buchi. Ritorna le lettere disegnate.
   */
  disegnaLettere(cx, camX, z, te, tf, k = 1, W = 0, H = 0, cxDav = null) {
    this.chiamate = 0; this.nLettere = 0;
    if (this.modo !== LETTERE || !this.mat) return 0;
    const aw = Math.max(1, Math.round(this.cw * z * k)), ah = Math.max(1, Math.round(this.ch * z * k)), A = this._atlanteLettere(aw, ah);
    if (A) this._componi(this.vistaDa(camX, z, te, tf, (W || cx.canvas?.width || 0) / k, (H || cx.canvas?.height || 0) / k));
    this.nTimbri = this.tq[0].n + this.tq[1].n;   // (OTT1) timbri dell'ultimo disegno, per la scatola dei cali
    this.tq[0].n = 0; this.tq[1].n = 0;
    if (A) return this._stampa(cx, A, aw, ah, camX, z, te, tf, k, cxDav);
    this.nF = 0; this.nB = 0;
    return 0;
  }
  /**
   * Nel gioco (?ascii=1): tutto sulla tela propria sopra #c, alla risoluzione dello schermo. lume: le macchie e la materia
   * ferma prendono il buio della stanza; punto(x, y, r, forza, tono): bagliori (facoltativo).
   */
  disegnaFine(camX, z, te, tf, lume = null, punto = null) {
    if (this.modo !== LETTERE || !this.mat) return;
    const F = this._tela();
    if (!F) { this.tq[0].n = 0; this.tq[1].n = 0; this.nB = 0; return; }   // niente documento, niente .tela o tela finta: ripiego silenzioso
    this._precuoci(F.k);   // (OTT1) atlanti degli zoom previsti, a fette, prima che servano
    const vivi = this.nE + this.nVolo + this.nCel + this.nMac + this.tq[0].n + this.tq[1].n;
    if (!vivi && !F.sporca) { this.nB = 0; return; }
    // (OTT1) si pulisce solo il rettangolo delle lettere del fotogramma prima (più 2 px), non le due tele intere alla
    // risoluzione dello schermo; tutta la tela dopo un cambio di misura. lettere.pulizia_parziale: false = come prima
    const RS = (F.rs ||= new Float64Array(8)), parz = this.LD.pulizia_parziale && !F.tutta && F.rs0;
    for (let q = 0; q < 2; q++) {
      const g = F.cx[q], o = 4 * q; g.setTransform(1, 0, 0, 1, 0, 0);
      if (!parz) g.clearRect(0, 0, F.w, F.h);
      else if (RS[o + 2] > RS[o]) g.clearRect(RS[o] - 2, RS[o + 1] - 2, RS[o + 2] - RS[o] + 4, RS[o + 3] - RS[o + 1] + 4);
    }
    F.tutta = false; F.rs0 = true; RS.fill(0);
    F.sporca = vivi > 0;
    if (vivi) {
      this._lume = lume && lume.livello ? lume : null;
      if (this._rd) this._rd.fill(0);
      this.disegnaLettere(F.cx[0], camX, z, te, tf, F.k, F.w, F.h, F.cx[1]);
      if (this.nLettere && this._rd) for (let o = 0; o < 8; o += 4) if (this._rd[o + 2] > this._rd[o]) for (let u = 0; u < 4; u++) RS[o + u] = this._rd[o + u];
      this._lume = null;
    } else this.nB = 0;
    if (punto) this._bagliori(punto, camX);
  }
  // due tele proprie (dietro, davanti) create alla prima chiamata dentro .tela, sopra #c; quella di dietro si buca con le
  // sagome degli sprite (asc.buco). Si ridimensionano quando cambia la misura CSS di #c.
  // Se il documento non sa farla (node, documento finto del collaudo) si rinuncia per sempre, senza eccezioni nel ciclo.
  /** (MEN1) Le tele delle lettere stanno sopra a #c: nel menu, in pausa e nelle schermate di fine vanno nascoste, o coprono le scritte. */
  mostra(v) { const F = this.fine; if (F && F.tela && F.vista !== v) { F.vista = v; for (const t of F.tela) t.style.visibility = v ? 'visible' : 'hidden'; } }
  _tela() {
    let F = this.fine;
    if (F === false || typeof document === 'undefined') return null;
    try {
      const c = document.getElementById('c');
      if (!c) return null;
      if (!F) {
        const box = c.parentElement?.classList?.contains('tela') ? c.parentElement : document.querySelector('.tela');
        if (!box) return null;
        const T = [0, 1].map((q) => {
          const t = document.createElement('canvas');
          t.setAttribute('aria-hidden', 'true');
          t.style.cssText = `position:absolute;left:0;top:0;pointer-events:none;z-index:${2 + q};`;
          const g = t.getContext('2d');
          if (!g || typeof g.drawImage !== 'function') throw new Error('tela senza contesto');
          return t;
        });
        for (const t of T) box.appendChild(t);
        F = this.fine = { tela: T, cx: T.map((t) => t.getContext('2d')), c, w: 0, h: 0, k: 1, sporca: false };
      }
      // (OTT1) qualità adattiva scesa (tetto degli effetti ridotto): tele delle lettere a lettere.dpr_carico (meno pixel da pulire,
      // bucare e comporre; lettere meno nitide finché il carico resta alto). dpr_carico = dpr_max: come prima
      const carico = this.sottoCarico(), r = Math.min(carico ? (this.LD.dpr_carico ?? this.LD.dpr_max) : this.LD.dpr_max, globalThis.devicePixelRatio || 1), cw = c.clientWidth || c.width, chh = c.clientHeight || c.height;
      const w = Math.max(1, Math.round(cw * r)), h = Math.max(1, Math.round(chh * r));
      if (w !== F.w || h !== F.h) {
        for (const t of F.tela) {
          t.width = w; t.height = h;
          t.style.width = cw + 'px'; t.style.height = chh + 'px'; t.style.left = c.offsetLeft + 'px'; t.style.top = c.offsetTop + 'px';
        }
        F.w = w; F.h = h; F.k = w / c.width; F.sporca = true; F.tutta = true;   // (OTT1) tutta la tela alla prossima pulizia
      }
      return F;
    } catch { this.fine = false; return null; }
  }
  // atlante delle lettere: colonna = glifo del registro, riga = colore della tavolozza, più una riga bianca per le misure
  // di forma. Node: dalla maschera cotta da ascii_cuoci_font.py; browser: fillText col font di sistema, come nel sito.
  // (OTT1) Un atlante per misura della cella (aw × ah), che segue lo zoom: arena (0,86–1) × impatto passano per 7 misure,
  // una più delle 6 tenute, e prima a tetto pieno si svuotava tutto e si ricuoceva in pieno combattimento (glifi × colori
  // fillText in un fotogramma, a ogni andata e ritorno dello zoom). Ora: si scarta il meno usato (atlanti_max), le misure
  // degli zoom previsti si cuociono prima a fette (_precuoci, lettere.zoom_previsti) e una misura nuova si cuoce a fette
  // disegnando intanto con l'atlante pronto più vicino, scalato. lettere.atlante_fetta_ms = 0: come prima, tutto in un colpo.
  _atlanteLettere(aw, ah) {
    if (this.fonteNode) return this.atlL || (this.atlL = this._atlanteNode());
    const B = (this._atlB ||= new Map()), key = aw * 4096 + ah;
    let A = B.get(key);
    if (A === null) return null;
    if (A && A.riga >= A.righe) { if (A.rotto) return null; B.delete(key); B.set(key, A); return A; }   // in fondo alla mappa: il più usato
    const fetta = this.LD.atlante_fetta_ms || 0, V = fetta > 0 ? this._atlanteVicino(aw, ah) : null;
    if (!A) { A = this._apriAtlante(aw, ah); this._tieni(key, A); if (!A) return null; }
    this._cuociRighe(A, V ? fetta : Infinity);
    return A.riga >= A.righe ? (A.rotto ? V : A) : V;
  }
  // (OTT1) mette l'atlante nella mappa scartando i meno usati oltre atlanti_max (prima: B.clear(), tutti)
  _tieni(key, A) {
    const B = this._atlB;
    B.delete(key);
    while (B.size >= Math.max(1, this.LD.atlanti_max)) B.delete(B.keys().next().value);
    B.set(key, A);
  }
  // (OTT1) l'atlante pronto di misura più vicina (si disegna scalato finché quello giusto non è cotto)
  _atlanteVicino(aw, ah) {
    let V = null, d = Infinity;
    for (const A of this._atlB.values()) {
      if (!A || A.rotto || A.riga < A.righe) continue;
      const e = Math.abs(A.aw - aw) + Math.abs(A.ah - ah);
      if (e < d) { d = e; V = A; }
    }
    return V;
  }
  // (OTT1) tela dell'atlante, ancora da cuocere (riga = prossima riga di colore)
  _apriAtlante(aw, ah) {
    if (typeof document === 'undefined') return null;
    try {
      const L = this.LD, t = document.createElement('canvas'), g = t.getContext('2d'), nG = this.alfa.length, nC = this.pal.length + 1;
      t.width = aw * nG; t.height = ah * nC; this.nAtlanti = (this.nAtlanti || 0) + 1;   // (OTT1) conto per la scatola dei cali
      return { img: t, aw, ah, g, bianca: nC - 1, riga: 0, righe: nC, nG, font: `${L.peso} ${Math.max(4, Math.round(L.corpo_k * ah))}px ${L.font}`, rotto: false };
    } catch { return null; }
  }
  // (OTT1) cuoce righe di colore finché non passano ms (Infinity: tutte); stessi fillText di prima, nello stesso ordine
  _cuociRighe(A, ms) {
    const L = this.LD, g = A.g, a = ms < Infinity, t0 = a ? performance.now() : 0;
    try {
      g.font = A.font; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      while (A.riga < A.righe) {
        const k = A.riga++;
        g.fillStyle = k < A.righe - 1 ? this.pal[k] : '#ffffff';
        for (let i = 1; i < A.nG; i++) g.fillText(this.alfa[i], i * A.aw + A.aw / 2, k * A.ah + L.base_k * A.ah);
        if (a && performance.now() - t0 >= ms) break;
      }
    } catch { A.riga = A.righe; A.rotto = true; }
  }
  // (OTT1) misure (aw, ah) degli zoom previsti alla scala k della tela, cotte a fette in anticipo (una fetta per fotogramma)
  _precuoci(k) {
    const fetta = this.LD.atlante_fetta_ms || 0, Z = this.LD.zoom_previsti;
    if (!(fetta > 0) || !Z || this.fonteNode) return;
    let P = this._prev;
    if (!P || P.k !== k) {
      P = this._prev = { k, aw: [], ah: [], fatto: false };
      const S = new Set();
      for (let z = Z[0]; z <= Z[1] + 1e-9 && P.aw.length < this.LD.atlanti_max; z += 0.0025) {
        const aw = Math.max(1, Math.round(this.cw * z * k)), ah = Math.max(1, Math.round(this.ch * z * k));
        if (!S.has(aw * 4096 + ah)) { S.add(aw * 4096 + ah); P.aw.push(aw); P.ah.push(ah); }
      }
    }
    const B = (this._atlB ||= new Map());
    for (let q = 0; q < P.aw.length; q++) {
      const key = P.aw[q] * 4096 + P.ah[q];
      let A = B.get(key);
      if (A === null || (A && A.riga >= A.righe)) continue;
      if (!A) { A = this._apriAtlante(P.aw[q], P.ah[q]); this._tieni(key, A); if (!A) return; }
      this._cuociRighe(A, fetta);
      return;
    }
  }
  _cuociBrowser(aw, ah) {
    const A = this._apriAtlante(aw, ah);
    if (A) this._cuociRighe(A, Infinity);
    return A && !A.rotto ? A : null;
  }
  /** Node (tavole): l'atlante di lavoro cotto da prova/ascii_cuoci_font.py. maschera = PNG letto ({width, height, data}). */
  usaFont(maschera, misure) {
    if (this.modo !== LETTERE || !maschera?.data || !misure?.cella) return false;
    this.fonteNode = { m: maschera, car: misure.caratteri, aw: misure.cella[0], ah: misure.cella[1] };
    this.atlL = null; this.lut = null; this.vett = null;
    return true;
  }
  _atlanteNode() {
    const F = this.fonteNode, aw = F.aw, ah = F.ah, nG = this.alfa.length, nC = this.pal.length + 1, w = aw * nG, h = ah * nC;
    const px = new Uint8ClampedArray(w * h * 4), pal = this.pal.map(rgb), M = F.m;
    pal.push([255, 255, 255]);
    for (let gl = 1; gl < nG; gl++) {
      const q = F.car.indexOf(this.alfa[gl]);
      if (q < 0) continue;
      for (let v = 0; v < ah; v++) for (let u = 0; u < aw; u++) {
        const a = M.data[(v * M.width + q * aw + u) * 4 + 3];
        if (!a) continue;
        for (let c = 0; c < nC; c++) { const o = ((c * ah + v) * w + gl * aw + u) * 4; px[o] = pal[c][0]; px[o + 1] = pal[c][1]; px[o + 2] = pal[c][2]; px[o + 3] = a; }
      }
    }
    return { img: { width: w, height: h, data: px }, aw, ah, g: null, bianca: nC - 1 };
  }

  // ------------------------------------------------------------------------------------------------ filtro di forma
  // Immagine → lettere scelte per FORMA (Alex Harri, «ASCII characters are not pixels»): di ogni carattere dell'alfabeto del
  // filtro si misura l'inchiostro in sei zone (due colonne per tre righe); ogni cella dell'immagine dà lo stesso vettore e
  // prende il carattere più vicino, da una tabella di ricerca fatta una volta (lettere.filtro.livelli^6 voci).
  // Vettori dal font in uso: maschera di node, atlante del browser; senza font, dalle maschere 3 × 5 (stessa API, più grezza).
  _vettori() {
    if (this.vett) return this.vett;
    const al = this.LD.filtro.alfabeto, n = al.length, V = new Float32Array(n * 6), G = new Uint8Array(n);
    let leggi = null, aw = 3, ah = 5;
    const N = this.fonteNode;
    if (N) { aw = N.aw; ah = N.ah; leggi = (car, u, v) => { const q = N.car.indexOf(car); return q < 0 ? 0 : N.m.data[(v * N.m.width + q * aw + u) * 4 + 3] / 255; }; }
    else if (typeof document !== 'undefined') {
      try {
        const A = this._cuociBrowser(12, 21), d = A && A.g.getImageData(0, A.bianca * 21, A.img.width, 21).data;
        if (d) { aw = 12; ah = 21; leggi = (car, u, v) => d[(v * A.img.width + this._gi(car) * 12 + u) * 4 + 3] / 255; }
      } catch { leggi = null; }
    }
    if (!leggi) { aw = 3; ah = 5; leggi = (car, u, v) => (this.mask[this._gi(car)] >> (14 - v * 3 - u)) & 1; }
    const mx = new Float32Array(6);
    for (let k = 0; k < n; k++) {
      const car = al[k];
      G[k] = this._aggiungi(car);
      for (let z = 0; z < 6; z++) {
        const x0 = (z & 1) * aw / 2, x1 = x0 + aw / 2, y0 = (z >> 1) * ah / 3, y1 = y0 + ah / 3;
        let s = 0, a = 0;
        for (let v = Math.floor(y0); v < Math.ceil(y1); v++) for (let u = Math.floor(x0); u < Math.ceil(x1); u++) {
          const w = (Math.min(u + 1, x1) - Math.max(u, x0)) * (Math.min(v + 1, y1) - Math.max(v, y0));
          if (w > 0) { s += w * leggi(car, u, v); a += w; }
        }
        V[k * 6 + z] = a ? s / a : 0;
        if (V[k * 6 + z] > mx[z]) mx[z] = V[k * 6 + z];
      }
    }
    for (let k = 0; k < n; k++) for (let z = 0; z < 6; z++) if (mx[z]) V[k * 6 + z] /= mx[z];   // il più pieno vale 1 per zona
    return (this.vett = { V, G, n });
  }
  _tabella() {
    if (this.lut) return this.lut;
    const { V, G, n } = this._vettori(), Q = this.LD.filtro.livelli, N = Q ** 6, T = new Uint8Array(N), s = new Float32Array(6);
    for (let q = 0; q < N; q++) {
      for (let z = 0, r = q; z < 6; z++, r = (r / Q) | 0) s[z] = (r % Q) / (Q - 1);
      let best = 0, bd = 1e9;
      for (let k = 0; k < n; k++) {
        let d = 0;
        for (let z = 0; z < 6; z++) { const e = s[z] - V[k * 6 + z]; d += e * e; }
        if (d < bd) { bd = d; best = k; }
      }
      T[q] = G[best];
    }
    return (this.lut = T);
  }
  // pixel della sorgente: {data, width} (tela software, PNG letto, ImageData) o immagine/tela del browser (letta una volta)
  _sorgente(src, sx, sy, sw, sh) {
    const S = (this._S ||= { d: null, w: 0, ox: 0, oy: 0 });
    if (src.data && src.width) { S.d = src.data; S.w = src.width; S.ox = 0; S.oy = 0; return S; }
    if (typeof document === 'undefined') return null;
    try {
      const A = (this._app ||= (() => { const c = document.createElement('canvas'); return { c, g: c.getContext('2d', { willReadFrequently: true }) }; })());
      if (A.c.width !== sw || A.c.height !== sh) { A.c.width = sw; A.c.height = sh; } else A.g.clearRect(0, 0, sw, sh);
      A.g.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
      S.d = A.g.getImageData(0, 0, sw, sh).data; S.w = sw; S.ox = sx; S.oy = sy;
      return S;
    } catch { return null; }
  }
  /**
   * Filtro di forma: un riquadro d'immagine → celle (lettera, colore) della griglia del motore.
   *  src: {data, width, height} oppure immagine/tela del browser.
   *  o: { sx, sy, sw, sh: riquadro (tutta l'immagine); ax, ay: ancora nella sorgente, va nel punto (x, y) di timbraFiltro
   *       (angolo del riquadro); scala: px di mondo per px di sorgente (1); tavolozze: nomi ammessi per il colore (tutte);
   *       inchiostro: 'luce' (alfa × luminosità stirata sul riquadro, sprite e effetti) o 'alfa' (sagoma); fondo: inchiostro
   *       minimo dei pixel opachi scuri (0.3); soglia: copertura minima della cella (lettere.filtro.soglia);
   *       chiave, f: cache per (chiave, f), per esempio (clip, fotogramma): mai due volte lo stesso fotogramma }
   *  → F = { cols, rows, ox, oy (px di mondo dell'angolo della cella 0 rispetto all'ancora), cw, ch, g, c, n } o null.
   *  Senza chiave alloca il risultato: per un effetto che cambia a ogni fotogramma passare o.F (si riusa se della misura).
   */
  filtro(src, o = {}) {
    if (this.modo !== LETTERE || !src) return null;
    const FD = this.LD.filtro;
    if (o.chiave) { const v = this._cacheF?.m.get(o.chiave); if (v && v[o.f | 0]) return v[o.f | 0]; }
    const sx = o.sx ?? 0, sy = o.sy ?? 0, sw = o.sw ?? src.width, sh = o.sh ?? src.height, ax = o.ax ?? sx, ay = o.ay ?? sy, sc = o.scala || 1;
    const S = this._sorgente(src, sx, sy, sw, sh);
    if (!S || !(sw > 0 && sh > 0)) return null;
    this.nFiltri = (this.nFiltri || 0) + 1;   // (OTT1) filtri fatti (non dalla cache), per la scatola dei cali
    const lut = this._tabella(), Q = FD.livelli, cu = this.cw / sc, cv = this.ch / sc, d = S.d, W = S.w, luce = (o.inchiostro || 'luce') === 'luce';
    const fondo = o.fondo ?? FD.fondo, soglia = o.soglia ?? FD.soglia, contr = o.contrasto ?? FD.contrasto;
    // luminosità minima e massima dei pixel opachi del riquadro: la rampa si usa tutta anche sugli sprite scuri
    let lMin = 1, lMax = 0;
    if (luce) for (let v = sy; v < sy + sh; v++) for (let u = sx; u < sx + sw; u++) {
      const p = ((v - S.oy) * W + u - S.ox) * 4;
      if (d[p + 3] < 24) continue;
      const l = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255;
      if (l < lMin) lMin = l; if (l > lMax) lMax = l;
    }
    const kL = lMax > lMin ? 1 / (lMax - lMin) : 0;
    const i0 = Math.floor((sx - ax) / cu), i1 = Math.ceil((sx + sw - ax) / cu), j0 = Math.floor((sy - ay) / cv), j1 = Math.ceil((sy + sh - ay) / cv);
    const cols = Math.max(1, i1 - i0), rows = Math.max(1, j1 - j0), N = cols * rows;
    let F = o.F && o.F.g.length >= N ? o.F : null;
    if (F) { F.g.fill(0); F.c.fill(0); } else F = { cols: 0, rows: 0, ox: 0, oy: 0, cw: this.cw, ch: this.ch, g: new Uint8Array(N), c: new Uint16Array(N), n: 0 };
    F.cols = cols; F.rows = rows; F.ox = i0 * this.cw; F.oy = j0 * this.ch; F.n = 0;
    const pal = (this._palRgb ||= this.pal.map(rgb)), amm = this._ammessi(o.tavolozze);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const bx = ax + (i0 + i) * cu, by = ay + (j0 + j) * cv;
      let idx = 0, mul = 1, A = 0, R = 0, G = 0, B = 0, ink = 0;
      for (let z = 0; z < 6; z++) {
        const x0 = bx + (z & 1) * cu / 2, x1 = x0 + cu / 2, y0 = by + (z >> 1) * cv / 3, y1 = y0 + cv / 3;
        let s = 0, a = 0;
        for (let v = Math.max(sy, Math.floor(y0)); v < Math.min(sy + sh, Math.ceil(y1)); v++) for (let u = Math.max(sx, Math.floor(x0)); u < Math.min(sx + sw, Math.ceil(x1)); u++) {
          const w = (Math.min(u + 1, x1) - Math.max(u, x0)) * (Math.min(v + 1, y1) - Math.max(v, y0));
          if (!(w > 0)) continue;
          const p = ((v - S.oy) * W + u - S.ox) * 4, al = d[p + 3] / 255;
          a += w;
          if (!al) continue;
          const l = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255;
          s += w * al * (luce ? fondo + (1 - fondo) * (l - lMin) * kL : 1);
          A += w * al; R += w * al * d[p]; G += w * al * d[p + 1]; B += w * al * d[p + 2];
        }
        const val = a ? Math.pow(s / a, contr) : 0;
        ink += val;
        idx += Math.min(Q - 1, Math.round(val * (Q - 1))) * mul; mul *= Q;
      }
      const g = lut[idx], c = j * cols + i;
      if (!g || ink / 6 < soglia || !A) continue;
      F.g[c] = g; F.c[c] = this._vicino(pal, amm, R / A, G / A, B / A); F.n++;
    }
    if (o.chiave) this._metteCache(o.chiave, o.f | 0, F);
    return F;
  }
  // indici di colore ammessi (dalle tavolozze nominate), in cache per lista
  _ammessi(nomi) {
    if (!nomi) return null;
    const C = (this._amm ||= new Map());
    let L = C.get(nomi);
    if (!L) { L = []; for (const n of nomi) { const v = this.tav[n]; if (v) for (let i = 0; i < v.n; i++) L.push(v.o + i); } L = Uint16Array.from(L); C.set(nomi, L); }
    return L;
  }
  _vicino(pal, amm, r, g, b) {
    let best = 0, bd = 1e12;
    const n = amm ? amm.length : pal.length;
    for (let q = 0; q < n; q++) {
      const k = amm ? amm[q] : q, P = pal[k], dr = P[0] - r, dg = P[1] - g, db = P[2] - b, dd = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (dd < bd) { bd = dd; best = k; }
    }
    return best;
  }
  _metteCache(chiave, f, F) {
    const K = (this._cacheF ||= { m: new WeakMap(), rC: new Array(this.LD.filtro.cache).fill(null), rF: new Int32Array(this.LD.filtro.cache), testa: 0, n: 0 });
    let v = K.m.get(chiave);
    if (!v) { v = []; K.m.set(chiave, v); }
    if (K.n >= K.rC.length) { const vc = K.m.get(K.rC[K.testa]); if (vc) vc[K.rF[K.testa]] = null; } else K.n++;
    K.rC[K.testa] = chiave; K.rF[K.testa] = f; K.testa = (K.testa + 1) % K.rC.length;
    v[f] = F;
  }
  /** Le celle di un filtro in coda come timbri, con l'ancora in (x, y) px di mondo; verso −1 = specchiato (anche / ↔ \). */
  timbraFiltro(F, x, y, verso = 1, strato = 1) {
    if (this.modo !== LETTERE || !F) return 0;
    const cw = F.cw, ch = F.ch, M = this.gMir;
    let n = 0;
    for (let j = 0, c = 0; j < F.rows; j++) for (let i = 0; i < F.cols; i++, c++) {
      const g = F.g[c];
      if (!g) continue;
      const X = verso < 0 ? x - F.ox - (i + 0.5) * cw : x + F.ox + (i + 0.5) * cw;
      if (this.timbro(verso < 0 && M ? M[g] : g, F.c[c], X, y + F.oy + (j + 0.5) * ch, strato)) n++;
    }
    return n;
  }

  /** (OTT1) La qualità adattiva del gioco è scesa (tetto globale degli effetti sotto l'80 % di quello pieno)? */
  sottoCarico() { return TETTO_FX.max < 0.8 * TETTO_MAX0; }

  /** Conti dell'ultimo passo e disegno (oggetto riusato). */
  misure() {
    const m = this._mis;
    if (!this.modo) return m;
    m.volo = this.nVolo; m.celle = this.nCel; m.macchie = this.nMac; m.chiamate = this.chiamate; m.ms_passo = this.ms; m.persi = this.persi;
    m.lettere = this.nLettere || 0; m.energia = this.nE || 0;
    return m;
  }
}
