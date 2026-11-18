// Copia di strumenti/pennino/prova/ascii_sangue.mjs (sito/strumenti/copia_sprite.py): non modificare qui.
// (ASC0) Ricette del sangue in caratteri: traducono gli eventi del gioco in emissioni del motore (ascii.mjs).
// Numeri in zone/ascii.json → sangue. Forma prima del caso: ogni ricetta è una figura ordinata (ventaglio, ago) con un
// rumore piccolo e deterministico dal seme del colpo. Solo resa: niente torna al gioco.
//  - spada: ventaglio a mezzaluna dal lato d'uscita del corpo; strisce veloci al centro (linee di moto), gocce ai bordi,
//    la goccia pesante sul bordo basso (cade vicino). Nei colpi di gruppo una sola lama larga: stesso asse, meno caratteri.
//  - pistola: ago di pochi caratteri chiari sulla retta del proiettile, oltre il corpo; una goccia che cade dall'uscita.
//  - uccisione: ventaglio raddoppiato, colata di celle dal centro del corpo, un punto di bagliore cremisi.
//  - ferita del protagonista: sangue blu, un ventaglio piccolo dal lato opposto a chi colpisce (notaFerita).
//  - richiamo di vita: il sangue dell'ucciso torna al petto, un carattere per punto curato davvero (notaVita); attorno al
//    petto un alone lieve che cresce con gli arrivi recenti (vitaPetto, a ogni fotogramma).
//  notaEvento(asc, e, g, H) smista gli eventi di g.fx: è l'unico aggancio in gestisciFx.
import { h01, TIPO } from './ascii.mjs';

const GRADI = Math.PI / 180;
const PA = { g: 0, att: 0, rit: 0, lascia: 0, tono: 1 };   // profilo dell'ago, riusato (nessuna allocazione per colpo)
const PR = { g: 0, att: 0, rit: 0, lascia: 0, tono: 0, bers: 0, arco: 0 };   // profilo dei richiamati
const fin = (v) => Number.isFinite(v);
const semeDi = (asc, x, y) => { asc.serie = (asc.serie + 1) >>> 0; return (Math.imul(asc.serie, 2654435761) ^ (Math.round(x) * 73856093) ^ (Math.round(y) * 19349663)) >>> 0; };

/** Sangue di un impatto. e = evento 'impatto' di g.fx; b = bersaglio colpito (può mancare). Ritorna i caratteri emessi. */
export function notaSangue(asc, e, b, H) {
  if (!asc || !asc.modo || !e || e.tipo !== 'impatto' || !fin(e.x) || !fin(e.y)) return 0;
  const S = asc.dati.sangue, mat = asc.idMateria[S.materia];
  if (!mat) return 0;
  H = H > 0 ? H : asc.H;
  const dir = e.dir < 0 ? -1 : 1, bx = fin(e.bx) ? e.bx : e.x;
  // il bersaglio vale solo se è proprio quello colpito (chi lo cerca salta i morti e può restituire il vicino)
  const ok = b && fin(b.w) && fin(b.h) && b.w > 0 && b.h > 0 && (!fin(b.x) || Math.abs(b.x - bx) <= b.w * 0.5 + 2);
  const w = ok ? b.w : S.corpo_H[0] * H, h = ok ? b.h : S.corpo_H[1] * H;
  const by = fin(e.by) ? e.by : e.y, seme = semeDi(asc, e.x, e.y), k = asc.impatto();
  let n;
  if (e.fonte === 'proiettile') n = ago(asc, e, dir, bx, by, w, h, mat, seme, H);
  else {
    const P = S.spada;
    let q = P.n + (e.critico ? P.critico : 0);
    if (e.finale) q *= P.finale;
    if (e.uccide) q *= P.uccide;
    if (e.fonte !== 'spada') q *= S.altre.k;
    q = Math.round(q);
    if (k > 1) q = Math.max(S.gruppo.minimo, Math.round(q / Math.sqrt(k)));
    // asse: il primo impatto del fotogramma lo fissa, gli altri dello stesso verso lo riusano (una sola lama larga)
    let elev;
    if (k > 1 && asc.asseDir === dir) elev = asc.asse;
    else { elev = (P.asse_gradi - (e.dy || 0) * P.asse_dy_gradi) * GRADI; asc.asse = elev; asc.asseDir = dir; }
    n = ventaglio(asc, P, q, elev, dir, bx + dir * S.uscita * w, Math.max(by - h * 0.45, Math.min(by + h * 0.45, e.y)), mat, seme, H);
  }
  const U = S.uccisione;
  if (e.uccide) asc.cella(bx, by, mat, U.celle[0] + Math.floor(h01(seme + 5) * (U.celle[1] - U.celle[0] + 1)));
  if (e.uccide || (e.critico && U.bagliore_critico)) asc.bagliore(e.x, e.y, U.bagliore_r_H * H, U.bagliore_forza);
  return n;
}

/**
 * Sangue blu del protagonista colpito. e = evento 'danno' di g.fx ({x, y, dir}: dir = verso della spinta, cioè opposto a
 * chi colpisce); danno facoltativo (e.danno se c'è). Ritorna i caratteri emessi.
 */
export function notaFerita(asc, e, H, danno) {
  if (!asc || !asc.modo || !e || !fin(e.x) || !fin(e.y)) return 0;
  const F = asc.dati.sangue.ferita, mat = asc.idMateria[F.materia];
  if (!mat) return 0;
  H = H > 0 ? H : asc.H;
  const dir = e.dir < 0 ? -1 : 1, d = fin(e.danno) ? e.danno : fin(danno) ? danno : 0;
  const q = Math.min(F.max, F.n + (d > F.danno_soglia ? Math.floor((d - F.danno_soglia) * F.per_danno) : 0));
  return ventaglio(asc, F, q, F.asse_gradi * GRADI, dir, e.x + dir * asc.dati.sangue.uscita * asc.dati.sangue.corpo_H[0] * H, e.y, mat, semeDi(asc, e.x, e.y), H);
}

// ventaglio: q caratteri in ordine sull'apertura, velocità a mezzaluna, miscela per posizione (non a caso)
function ventaglio(asc, P, q, elev, dir, ox, oy, mat, seme, H) {
  if (q < 1) return 0;
  const ap = P.apertura_gradi * GRADI, rg = P.rumore_gradi * GRADI, m0 = P.miscela[0], m2 = P.miscela[2], ry = (P.rumore_y_H ?? 0) * H;
  for (let i = 0; i < q; i++) {
    const t = q > 1 ? -1 + 2 * i / (q - 1) : 0, s = seme + i * 7919;
    // posizione sull'apertura → tipo: centro strisce (linee di moto), bordo basso pesanti, il resto gocce
    const tipo = Math.abs(t) < m0 ? TIPO.STRISCIA : t <= -1 + 2 * m2 + 1e-6 ? TIPO.PESANTE : TIPO.GOCCIA;
    const a = elev + t * ap + (h01(s + 1) - 0.5) * 2 * rg;
    const v = (P.v_bordo_H_s + (P.v_centro_H_s - P.v_bordo_H_s) * (1 - t * t)) * (1 + (h01(s + 2) - 0.5) * 2 * P.rumore_v) * H;
    const [v0, v1] = P.vita_s[tipo];
    asc.volo(ox, oy + (h01(s + 3) - 0.5) * 2 * ry, dir * Math.cos(a) * v, -Math.sin(a) * v, mat, tipo, v0 + (v1 - v0) * h01(s + 4), s, null);
  }
  return q;
}

// ago: pochi caratteri sulla retta del proiettile, veloci e chiari; la riga si allunga perché le velocità sono scalate
function ago(asc, e, dir, bx, by, w, h, mat, seme, H) {
  const S = asc.dati.sangue, A = S.pistola;
  let ux, uy;
  if (fin(e.ux) && fin(e.uy) && (e.ux || e.uy)) { const l = Math.hypot(e.ux, e.uy); ux = e.ux / l; uy = e.uy / l; }
  else { const a = (e.dy || 0) * A.inclina_dy_gradi * GRADI; ux = dir * Math.cos(a); uy = Math.sin(a); }
  // uscita: di lato sulla retta; se il colpo è quasi verticale, dal sotto o dal sopra del corpo
  let ox, oy;
  if (Math.abs(uy) > 0.7) { oy = by + Math.sign(uy) * h * 0.45; ox = e.x + (oy - e.y) * ux / uy; }
  else { ox = bx + (ux < 0 ? -1 : 1) * S.uscita * w; oy = e.y + (ox - e.x) * uy / ux; }
  PA.g = A.g_H_s2 * H; PA.att = A.att_s; PA.rit = A.senza_g_s; PA.lascia = A.lascia; PA.tono = asc.tono(mat, 'ago');
  // (TAR) per taglia del bersaglio (altezza in px a H 48): meno lettere e più corte sui piccoli
  const T = A.taglia, a48 = h * 48 / H, kt = T ? (a48 >= T.soglie_px48[1] ? T.k[2] : a48 >= T.soglie_px48[0] ? T.k[1] : T.k[0]) : 1;
  const n = T ? Math.max(2, Math.round(A.n * kt)) : A.n, rg = A.rumore_gradi * GRADI, a0 = Math.atan2(uy, ux), tipo = asc.tipoId.ago ?? TIPO.STRISCIA;
  for (let i = 0; i < n; i++) {
    const s = seme + i * 7919, f = n > 1 ? i / (n - 1) : 0, v = (A.v_H_s[0] + (A.v_H_s[1] - A.v_H_s[0]) * f) * kt * H, a = a0 + (h01(s + 1) - 0.5) * 2 * rg;   // (TAR) kt
    asc.volo(ox, oy, Math.cos(a) * v, Math.sin(a) * v, mat, tipo, A.vita_s[0] + (A.vita_s[1] - A.vita_s[0]) * h01(s + 2), s, PA);
  }
  asc.volo(ox, oy, (ux < 0 ? -1 : 1) * A.goccia_vx_H_s * H, A.goccia_vy_H_s * H, mat, TIPO.GOCCIA, A.goccia_vita_s, seme + 99991, null);
  return n + 1;
}

/**
 * Unico aggancio in gestisciFx: impatto → sangue (bersaglio cercato qui, anche già morto); uccisione → si ricorda il corpo;
 * vita_cura da uccisione → richiamo di vita; vita_danno (non continuo) → ferita blu. Ritorna i caratteri emessi.
 */
export function notaEvento(asc, e, g, H) {
  if (!asc || !asc.modo || !e) return 0;
  const S = (asc._sangue ||= { ux: 0, uy: 0, ut: -9 });
  switch (e.tipo) {
    case 'impatto': return notaSangue(asc, e, bersaglioVicino(g, e), H);
    case 'uccisione': if (fin(e.x) && fin(e.y)) { S.ux = e.x; S.uy = e.y; S.ut = asc.t; } return 0;
    case 'vita_cura': {
      if (e.fonte !== 'uccisione' || !(e.cura > 0)) return 0;
      if (g?.p) asc.bersaglio(0, g.p.x, g.p.y - asc.dati.sangue.vita.petto_H * H);
      const fresco = asc.t - S.ut < 0.3;     // l'uccisione è passata in questo fotogramma (o poco fa)
      return notaVita(asc, fresco ? S.ux : e.x, fresco ? S.uy : e.y - H, e.cura, H);
    }
    case 'vita_danno': return e.continuo ? 0 : notaFerita(asc, e, H, e.danno);
  }
  return 0;
}
// il bersaglio colpito, anche già morto (chi cerca fra i vivi può restituire il vicino)
function bersaglioVicino(g, e) {
  const L = g?.bersagli, bx = fin(e.bx) ? e.bx : e.x;
  if (!L) return null;
  let m = null, d = 1e9;
  for (let i = 0; i < L.length; i++) { const b = L[i], q = Math.abs(b.x - bx); if (q < d && q <= (b.w || 0) * 0.5 + 2) { d = q; m = b; } }
  return m;
}

/** Richiamo di vita: n punti curati da un'uccisione in (x, y) → un carattere per punto, verso il bersaglio 0 del motore. */
export function notaVita(asc, x, y, n, H) {
  if (!asc || !asc.modo || !fin(x) || !fin(y) || !(n > 0)) return 0;
  const V = asc.dati.sangue.vita, mat = asc.idMateria[V.materia], R = asc.tipoId.richiamo;
  if (!mat || R === undefined) return 0;
  H = H > 0 ? H : asc.H;
  const q = Math.min(Math.round(n * V.per_punto), V.max_uccisione, V.max_vivi - asc.contaVolo(R));
  if (q <= 0) return 0;
  const seme = semeDi(asc, x, y), tx = asc.bersX[0], ty = asc.bersY[0];
  PR.tono = asc.tono(mat, V.tono); PR.bers = 0;
  for (let i = 0; i < q; i++) {
    const s = seme + i * 7919, sx = x + (h01(s + 1) - 0.5) * 2 * V.partenza_H * H, sy = y + (h01(s + 2) - 0.5) * 2 * V.partenza_H * H;
    const f = Math.min(1, Math.hypot(tx - sx, ty - sy) / (V.durata_dist_H * H)), D = V.durata_s[0] + (V.durata_s[1] - V.durata_s[0]) * f;
    PR.rit = V.sospeso_s + i * V.scaglione_s;
    PR.arco = (i & 1 ? 1 : -1) * (V.arco_H[0] + (V.arco_H[1] - V.arco_H[0]) * h01(s + 3)) * H;   // i fili si aprono ai due lati e poi convergono
    asc.volo(sx, sy, 0, 0, mat, R, PR.rit + D, s, PR);
  }
  return q;
}

/** A ogni fotogramma (prima del disegno): petto del protagonista come bersaglio, alone lieve dagli arrivi recenti. */
export function vitaPetto(asc, x, y, H) {
  if (!asc || !asc.modo || !fin(x) || !fin(y)) return 0;
  const V = asc.dati.sangue.vita, A = V.alone, cy = y - V.petto_H * H;
  asc.bersaglio(0, x, cy);
  const I = asc.arrivi(0), k = Math.min(A.max, Math.floor(Math.max(0, I - A.soglia) * A.per_arrivo));
  if (k <= 0) return 0;
  const mat = asc.idMateria[V.materia], tav = asc.MAT[mat], tick = Math.floor(asc.t / A.passo_s), col = A.colori[Math.min(A.colori.length - 1, Math.floor(I / 2))];
  const ci = asc.colore(asc.dati.materie[V.materia].tavolozza, col);
  for (let j = 0; j < k; j++) {
    const a = h01(tick * 13 + j * 7) * Math.PI * 2, r = (A.raggio_H[0] + (A.raggio_H[1] - A.raggio_H[0]) * h01(tick * 17 + j * 3)) * H;
    asc.timbro(asc.glifo(A.glifi[j % A.glifi.length]), ci, x + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 1.2, 1);
  }
  asc.bagliore(x, cy, V.bagliore_r_H * H, Math.min(V.bagliore_max, I * V.bagliore_forza));
  return tav ? k : 0;
}
