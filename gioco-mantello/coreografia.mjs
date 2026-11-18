// Copia di strumenti/pennino/prova/coreografia.mjs (sito/strumenti/copia_sprite.py): non modificare qui.
// Coreografia del mantello (MOVESET.md → «Coreografia del mantello»): per ogni mossa una sequenza di passi
// {fase, ritardo_ms, forma, forza, durata_ms, verso, onda, copre} agganciati alle fasi reali della clip (inizio, colpo, gira, fine)
// o a un evento (sparo, atterraggio, danno...). La Regia sceglie il passo attivo e ne dà la forma bersaglio e la forza;
// il Telo (mantello.mjs) ci viene tirato da molle smorzate e raccorda con l'inerzia. Niente rumore: stessa mossa = stesso disegno.
// Riusabile per mantelli, stendardi e code dei nemici (forme e coreografie sono dati). Niente DOM.

/** Angoli in gradi lungo il telo (collo, metà, orlo): 0 = giù, 90 = dietro orizzontale, 180 = su, negativi = davanti. */
export const FORME_BASE = Object.freeze({
  appoggiato: { angoli: [3, 5, 7], apertura: 3 },
  bandiera: { angoli: [72, 86, 94], apertura: 8 },
  bandiera_alta: { angoli: [102, 114, 124], apertura: 8 },
  campana: { angoli: [22, 40, 56], apertura: 22 },
  ala: { angoli: [148, 164, 172], apertura: 14 },
  frusta_su: { angoli: [55, 118, 165], apertura: 6 },
  frusta_giu: { angoli: [118, 70, 22], apertura: 6 },
  spirale: { angoli: [-25, -95, -150], apertura: 10, davanti: true },
  tenda: { angoli: [32, 74, 96], apertura: 16 },
  sipario: { angoli: [-18, -30, -36], apertura: 6, davanti: true },
});

const liscio = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Tempi (ms) delle fasi di una clip dal suo JSON: colpo, gira, fine; ripieghi in proporzione. */
export function tempiClip(meta, durate, out) {
  const tot = durate.reduce((a, b) => a + b, 0) || 1;
  const fino = (i) => { let s = 0; for (let k = 0; k < i && k < durate.length; k++) s += durate[k]; return s; };
  out.fine = tot;
  out.colpo = Number.isInteger(meta?.colpo) ? fino(meta.colpo) : Array.isArray(meta?.colpi) && meta.colpi.length ? fino(meta.colpi[0]) : tot * 0.4;
  out.gira = Number.isInteger(meta?.gira) ? fino(meta.gira) : tot * 0.5;
  out.inizio = 0;
  return out;
}

export class Regia {
  constructor(dati = {}) {
    this.cache = new Map();
    this.out = { forma: null, k: 0, modo: 0, passo: null, indice: -1, nome: '', davanti: false };   // modo: 0 corpo, 1 specchio, 2 direzione libera
    this.evento = { nome: '', t: 0, passi: null, attivo: false };
    this.cNome = null; this.cInd = -1; this.T0 = { inizio: 0, colpo: 0, gira: 0, fine: 0 };
    this.imposta(dati);
  }
  imposta(dati) {
    this.forme = { ...FORME_BASE, ...(dati.forme || {}) };
    this.cor = dati.coreografie || { classi: {}, mosse: {}, mappa: [], eventi: {} };
    this.cache.clear();
  }
  /** Passi risolti di una mossa o di uno stato: voce propria, voce con classe, mappa per prefisso, poi classe «movimento». */
  risolvi(nome) {
    if (this.cache.has(nome)) return this.cache.get(nome);
    const c = this.cor, v = c.mosse?.[nome] ?? (nome === 'scivolata' ? c.mosse?.sparo_scivolata : undefined);   // (B2) la scivolata tiene i passi dello sparo in scivolata
    let r = null, da = '';
    if (Array.isArray(v)) { r = v; da = 'mossa'; }
    else if (v && v.classe) { r = c.classi?.[v.classe] || null; da = 'classe ' + v.classe; }
    if (!r) for (const [pref, cl] of c.mappa || []) if (nome === pref || nome.startsWith(pref)) { r = c.classi?.[cl] || null; da = 'classe ' + cl; break; }
    if (!r) { r = c.classi?.movimento || []; da = 'classe movimento'; }
    const ris = { passi: r, da };
    this.cache.set(nome, ris);
    return ris;
  }
  /** Fa partire una coreografia d'evento (sparo, atterraggio, danno, onda_aria...): ha il suo orologio. */
  scatena(nome) {
    const p = this.cor.eventi?.[nome];
    if (!p) return false;
    this.evento.nome = nome; this.evento.t = 0; this.evento.passi = p; this.evento.attivo = true; this.evento.visti = 0;
    return true;
  }
  _scegli(passi, t, tempi, out) {
    let best = -1, bk = 0;
    for (let j = 0; j < passi.length; j++) {
      const s = passi[j], t0 = (tempi[s.fase || 'inizio'] ?? 0) + (s.ritardo_ms || 0), d = s.durata_ms ?? 300;
      const u = d < 0 ? (t - t0) / 120 : (t - t0) / d;            // durata < 0: per tutto lo stato
      if (u < 0 || (d >= 0 && u > 1)) continue;
      const env = d < 0 ? liscio(u) : u < 0.25 ? liscio(u / 0.25) : u > 0.7 ? liscio((1 - u) / 0.3) : 1;
      const k = env * (s.forza ?? 0.5);
      if (k >= bk) { bk = k; best = j; }                           // a parità vince il passo più tardo
    }
    out.indice = best; out.k = bk; out.passo = best >= 0 ? passi[best] : null;
    return best;
  }
  /**
   * Passo attivo per la mossa `nome` al tempo t (ms nella clip), con i tempi delle fasi. dt in s fa avanzare l'evento.
   * Restituisce out: {forma, k, modo, passo, indice, davanti}; `nuovo` = indice del passo appena iniziato (per onde e spinte).
   */
  valuta(nome, t, tempi, dt = 0) {
    const out = this.out, ev = this.evento;
    out.nome = nome; out.nuovo = -1;
    if (ev.attivo) {
      ev.t += dt * 1000;
      if (this._scegli(ev.passi, ev.t, this.T0, out) >= 0) { this._riempi(out, ev.passi); return out; }
      let fine = 0; for (const s of ev.passi) fine = Math.max(fine, (s.ritardo_ms || 0) + (s.durata_ms ?? 300));
      if (ev.t > fine) ev.attivo = false;
    }
    const { passi } = this.risolvi(nome);
    this._scegli(passi, t, tempi, out);
    this._riempi(out, passi);
    return out;
  }
  _riempi(out, chiave) {
    const s = out.passo;
    out.forma = s ? this.forme[s.forma] || this.forme.appoggiato : null;
    out.modo = !s || !s.verso || s.verso === 'opposto' ? 0 : s.verso === 'stesso' ? 1 : 2;
    out.davanti = !!(s && (s.copre || out.forma?.davanti));
    if (s && (chiave !== this.cNome || out.indice !== this.cInd)) out.nuovo = out.indice;
    this.cNome = s ? chiave : ''; this.cInd = s ? out.indice : -1;
  }
}
