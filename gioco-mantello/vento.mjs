// Copia di strumenti/pennino/prova/vento.mjs (sito/strumenti/copia_sprite.py): non modificare qui.
// Vento della stanza: direzione, forza di fondo e raffiche periodiche con rumore. Senza DOM (si prova in Node).
// Unità: H/s (si moltiplica per H in px). Lo leggono stoffa, polvere, fumo e particelle leggere.

/** Preimpostazioni del pannello. forza e raffica in H/s; periodo delle raffiche in secondi. */
export const VENTI = Object.freeze({
  calmo:  Object.freeze({ dir: 1, forza: 0.08, raffica: 0.12, periodo: 7 }),
  brezza: Object.freeze({ dir: 1, forza: 0.7, raffica: 0.9, periodo: 4.5 }),
  bufera: Object.freeze({ dir: -1, forza: 2.4, raffica: 2.2, periodo: 2.2 }),
});

// rumore 1D liscio e deterministico (valori su una griglia intera, interpolazione coseno)
function hash(i) { let x = (i * 374761393) ^ 0x5bd1e995; x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; }
export function rumore(t) {
  const i = Math.floor(t), f = t - i, u = (1 - Math.cos(f * Math.PI)) * 0.5;
  return hash(i) * (1 - u) + hash(i + 1) * u;
}

export class Vento {
  constructor(par = VENTI.brezza) { this.t = 0; this.v = 0; this.raffica01 = 0; this.soffioV = 0; this.imposta(par); }
  /** Soffio di un istante (onda d'aria che passa): H/s col segno, cala in ~0,4 s. */
  soffio(v) { if (Math.abs(v) > Math.abs(this.soffioV)) this.soffioV = v; }
  imposta(par) { this.dir = par.dir < 0 ? -1 : 1; this.forza = +par.forza || 0; this.raffica = +par.raffica || 0; this.periodo = Math.max(0.5, +par.periodo || 4); }
  /** Avanza il tempo; v = velocità del vento ora (H/s, col segno). */
  aggiorna(dt) {
    this.t += dt;
    const ciclo = (this.t / this.periodo) % 1;
    // raffica: sale in fretta, cala piano; ampiezza variata dal rumore, più un tremito veloce
    const busta = ciclo < 0.18 ? ciclo / 0.18 : Math.max(0, 1 - (ciclo - 0.18) / 0.5);
    const amp = 0.45 + 0.55 * rumore(Math.floor(this.t / this.periodo) * 1.7 + 0.3);
    this.raffica01 = busta * busta * amp;
    const tremito = (rumore(this.t * 3.1) - 0.5) * 0.35;
    this.soffioV *= Math.exp(-dt * 5);
    this.v = this.dir * Math.max(0, this.forza * (1 + tremito) + this.raffica * this.raffica01) + this.soffioV;
    return this.v;
  }
  /** Vento in un punto (H/s): stessa base, con un piccolo sfasamento lungo x (le raffiche passano, non arrivano ovunque insieme). */
  in(xH) { return this.v * (0.8 + 0.4 * rumore(this.t * 1.3 - xH * 0.25)); }
}
