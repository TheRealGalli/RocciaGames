// Copia di strumenti/pennino/prova/tetto_fx.mjs (sito/strumenti/copia_sprite.py): non modificare qui.
// (FIN) Tetto globale condiviso delle chiamate di disegno degli effetti per fotogramma, fra fx_nemici.mjs (FXN) e
// fx_abilita.mjs (POT). Un contatore leggero avvolge il contesto e conta i fillRect (le forme degli effetti sono solo
// fillRect); ogni unità di disegno (particella, segno, forma, segno di stato) chiede prima se c'è posto.
//  - normale: finché le chiamate del fotogramma restano sotto max − riserva;
//  - prioritaria (legami, esplosioni grandi): fino a max (la riserva è sua).
// Chi chiede per primo non ruba la riserva: FXN disegna prima di POT, quindi POT dichiara a ogni fotogramma quanto gli
// serve per le sue forme prioritarie (riserva, letta al fotogramma dopo). Le unità che cadono: le più vecchie e le più
// lontane dalla vista (ordine scelto da chi disegna). Il fotogramma comincia con nuovoFotogramma() (FXN.disegnaSotto).
import D from '../personaggi/fx-nemici.json' with { type: 'json' };

const T = D.tetto_globale || {};
export const TETTO_FX = {
  max: T.chiamate ?? 1450,          // chiamate di disegno degli effetti per fotogramma (tutto compreso)
  riserva_min: T.riserva_min ?? 60, // sempre tenute per le unità prioritarie
  riserva: 0,                       // dichiarata da POT (forme prioritarie attive), al più riserva_max
  riserva_max: T.riserva_max ?? 320,
  n: 0,                             // chiamate spese in questo fotogramma
  cadute: 0,                        // unità saltate in questo fotogramma (per i test e il pannello)
  attivo: true,
  visto: false,                     // POT ha già disegnato in questo fotogramma
};
export function nuovoFotogramma() { TETTO_FX.n = 0; TETTO_FX.cadute = 0; TETTO_FX.visto = false; }
/** C'è posto per un'unità che costerà circa `stima` chiamate? Conta come caduta se no. */
export function posto(stima = 1, prio = false) {
  const t = TETTO_FX;
  if (!t.attivo) return true;
  const lim = prio ? t.max : t.max - Math.max(t.riserva_min, Math.min(t.riserva_max, t.riserva));
  if (t.n + stima <= lim) return true;
  t.cadute++;
  return false;
}
/** Dichiarazione di POT: chiamate che le sue forme prioritarie chiederanno nel prossimo fotogramma. */
export function riserva(n) { TETTO_FX.riserva = Math.max(0, n); }

/** Contesto che conta i fillRect e passa tutto il resto al contesto vero (stessa forma d'uso per chi disegna). */
export class ContaFx {
  constructor() { this.cx = null; }
  su(cx) { this.cx = cx; return this; }
  get canvas() { return this.cx.canvas; }
  get fillStyle() { return this.cx.fillStyle; } set fillStyle(v) { this.cx.fillStyle = v; }
  get globalAlpha() { return this.cx.globalAlpha; } set globalAlpha(v) { this.cx.globalAlpha = v; }
  get globalCompositeOperation() { return this.cx.globalCompositeOperation; } set globalCompositeOperation(v) { this.cx.globalCompositeOperation = v; }
  get font() { return this.cx.font; } set font(v) { this.cx.font = v; }
  get textAlign() { return this.cx.textAlign; } set textAlign(v) { this.cx.textAlign = v; }
  get textBaseline() { return this.cx.textBaseline; } set textBaseline(v) { this.cx.textBaseline = v; }
  get strokeStyle() { return this.cx.strokeStyle; } set strokeStyle(v) { this.cx.strokeStyle = v; }
  get lineWidth() { return this.cx.lineWidth; } set lineWidth(v) { this.cx.lineWidth = v; }
  fillRect(x, y, w, h) { TETTO_FX.n++; this.cx.fillRect(x, y, w, h); }
  fillText(s, x, y) { TETTO_FX.n++; this.cx.fillText(s, x, y); }
  drawImage(...a) { TETTO_FX.n++; this.cx.drawImage(...a); }
  strokeRect(x, y, w, h) { TETTO_FX.n++; this.cx.strokeRect(x, y, w, h); }
  clearRect(x, y, w, h) { this.cx.clearRect(x, y, w, h); }
  save() { this.cx.save(); } restore() { this.cx.restore(); }
  translate(x, y) { this.cx.translate(x, y); } scale(x, y) { this.cx.scale(x, y); } rotate(a) { this.cx.rotate(a); }
  setTransform(...a) { this.cx.setTransform(...a); } getTransform() { return this.cx.getTransform?.(); }
  measureText(s) { return this.cx.measureText(s); }
  beginPath() { this.cx.beginPath(); } fill() { TETTO_FX.n++; this.cx.fill(); } stroke() { TETTO_FX.n++; this.cx.stroke(); }
  moveTo(x, y) { this.cx.moveTo(x, y); } lineTo(x, y) { this.cx.lineTo(x, y); } arc(...a) { this.cx.arc(...a); } rect(...a) { this.cx.rect(...a); }
}
