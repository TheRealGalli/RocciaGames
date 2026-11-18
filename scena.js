// Roccia Games — scene in pixel art del sito: mini gioco al buio in apertura, mini boss animati,
// passeggiata in chiusura e sfondi ASCII (il motore è in ascii.js).
(() => {
  'use strict';

  const FERMO = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SPRITE = 'media/sprite/';
  const GIOCO = 'media/gioco/';
  const A = window.RocciaAscii || null;
  // Colatura ASCII rosso scuro dietro il titolo (spegnibile qui)
  const COLATURA = true;

  // ---------- Attrezzi comuni ----------

  const carica = (src) => new Promise((ok, ko) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = ko;
    i.src = src;
  });

  let datiSprite = null;
  const caricaDati = () => (datiSprite ||= fetch(SPRITE + 'sprite.json', { priority: 'high' })
    .then((r) => { if (!r.ok) throw new Error('sprite.json'); return r.json(); }));

  // Nemici e mini boss cotti dal gioco: null se non ci sono (mai un errore)
  let datiGioco = null;
  const caricaGioco = () => (datiGioco ||= fetch(GIOCO + 'gioco.json')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null));

  // Atlante orizzontale: fotogrammi, pivot e durate
  async function atlante(d, dir) {
    const img = await carica(dir + d.file);
    const durate = Array.isArray(d.durations) && d.durations.length ? d.durations : [100];
    return {
      img, fw: d.frame_w, fh: d.frame_h, px: d.pivot[0], py: d.pivot[1],
      durate, n: Math.max(1, d.frames | 0), loop: d.loop !== false,
      tot: durate.reduce((s, x) => s + x, 0),
      // dati per fotogramma del protagonista (copia_sprite.py): mantello, bocca della pistola, effetti, colpi
      giunti: d.giunti || null, bocca: d.bocca || null, effetti: d.effetti || null, colpi: d.colpi || null,
      // occhi cotti nei dati del nemico (gioco.json): per fotogramma [[x, y, lato], …]
      occhiDati: Array.isArray(d.occhi) ? d.occhi : null,
      fasi: d.fasi_ms || null,   // tempi delle fasi della mossa (avviso, attivo, recupero), in ms
      // nome della clip (dal file a_<clip>.png) e atlante delle parti per il mantello
      nome: String(d.file).replace(/^a_/, '').replace(/\.png$/, ''), partiFile: d.parti || null, partiIndici: d.parti_indici || null,
    };
  }
  // Come sopra, ma una clip che manca o non si carica vale null
  const atlanteOpz = (d, dir) => (d && d.file ? atlante(d, dir).catch(() => null) : Promise.resolve(null));

  // Indice del fotogramma dopo `ms` millisecondi di animazione
  function fotogramma(a, ms) {
    let t = a.loop ? ms % a.tot : Math.min(ms, a.tot - 1);
    for (let i = 0; i < a.n; i++) { t -= a.durate[i % a.durate.length]; if (t < 0) return i; }
    return a.n - 1;
  }

  // Una lettura dei pixel dell'atlante: riquadro pieno (unione dei fotogrammi) e occhi per fotogramma
  // come terne [x, y, lato]. Occhi: dai dati cotti (gioco.json → clip.occhi) se ci sono, altrimenti i pixel
  // rosso vivo dello sprite così come sono (lato 0: si ridisegnano solo quelli, senza alone).
  // Con file:// il canvas è «sporco»: si tiene tutto il riquadro e, senza dati, niente occhi.
  function analizza(a, occhi) {
    a.r = { x0: 0, y0: 0, x1: a.fw, y1: a.fh };
    a.occhi = null;
    if (occhi && a.occhiDati) {
      a.occhi = Array.from({ length: a.n }, (_, f) => (a.occhiDati[f] || []).flatMap((p) => [p[0], p[1], p[2] < 0 ? -1 : 1]));
      occhi = false;
    }
    let d, W;
    try {
      const c = document.createElement('canvas');
      W = c.width = a.img.width; c.height = a.img.height;
      const g = c.getContext('2d');
      g.drawImage(a.img, 0, 0);
      d = g.getImageData(0, 0, c.width, c.height).data;
    } catch (e) { return a; }
    let x0 = a.fw, y0 = a.fh, x1 = -1, y1 = -1;
    const tutti = [], q = occhi ? 1 : 2;   // senza occhi da cercare basta un pixel su due per il riquadro
    for (let f = 0; f < a.n; f++) {
      const cand = [];
      for (let y = 0; y < a.fh; y += q) {
        for (let x = 0; x < a.fw; x += q) {
          const k = (y * W + f * a.fw + x) * 4;
          if (d[k + 3] <= 40) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
          const r = d[k], g = d[k + 1], b = d[k + 2];
          if (occhi && d[k + 3] > 200 && r >= 190 && r - g >= 110 && r - b >= 100) cand.push(x, y, 0);
        }
      }
      tutti.push(cand);
    }
    if (x1 >= 0) a.r = { x0, y0, x1: Math.min(a.fw, x1 + q), y1: Math.min(a.fh, y1 + q) };
    if (occhi) a.occhi = tutti.map((cand) => cand.slice(0, 96));   // al più 32 pixel per fotogramma
    return a;
  }

  // Sagoma a tinta unita della stessa immagine (bianca: lampo del colpo; rossa: scia dello scatto)
  const bianca = (img) => sagoma(img, '#fff');
  function sagoma(img, col) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = col;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  // Disegna un ritaglio con il pivot (px,py) sul punto (x,y); verso -1 = specchiato
  function disegna(g, src, sx, sy, w, h, px, py, x, y, verso) {
    x = Math.round(x); y = Math.round(y);
    if (verso < 0) {
      g.save();
      g.translate(x, y);
      g.scale(-1, 1);
      g.drawImage(src, sx, sy, w, h, -px, -py, w, h);
      g.restore();
    } else {
      g.drawImage(src, sx, sy, w, h, x - px, y - py, w, h);
    }
  }

  // Ciclo che gira solo con l'elemento a schermo e la scheda in primo piano
  function ciclo(el, passo) {
    const stato = { visibile: !('IntersectionObserver' in window) };
    let id = 0, prima = 0;
    const gira = (t) => {
      const dt = Math.min(0.05, Math.max(0, (t - prima) / 1000));
      prima = t;
      passo(dt, t);
      id = requestAnimationFrame(gira);
    };
    const aggiorna = () => {
      const vai = stato.visibile && !document.hidden;
      if (vai && !id) { prima = performance.now(); id = requestAnimationFrame(gira); }
      else if (!vai && id) { cancelAnimationFrame(id); id = 0; }
    };
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((voci) => {
        stato.visibile = voci[voci.length - 1].isIntersecting;
        aggiorna();
      }).observe(el);
    }
    document.addEventListener('visibilitychange', aggiorna);
    aggiorna();
    return stato;
  }

  // Richiama `fn` al ridimensionamento, al più una volta per fotogramma
  function aRidimensiona(fn) {
    let atteso = 0;
    window.addEventListener('resize', () => {
      if (!atteso) atteso = requestAnimationFrame(() => { atteso = 0; fn(); });
    });
  }

  // Richiama `fn` una volta, quando l'elemento si avvicina allo schermo
  function quandoVicino(el, fn) {
    if (!('IntersectionObserver' in window)) { fn(); return; }
    const io = new IntersectionObserver((voci) => {
      if (voci.some((v) => v.isIntersecting)) { io.disconnect(); fn(); }
    }, { rootMargin: '600px 0px' });
    io.observe(el);
  }

  // Imposta il canvas in pixel di gioco e lo ingrandisce di `s` via CSS
  function dimensiona(canvas, W, H, s) {
    canvas.width = W; canvas.height = H;
    if (s) {
      canvas.style.width = W * s + 'px';
      canvas.style.height = H * s + 'px';
    }
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    return g;
  }

  const tela = () => document.createElement('canvas');
  const caso = (a, b) => a + Math.random() * (b - a);

  // ---------- Luce a retino (rifatta in 2D da lume.mjs) ----------

  // Gradini della pozza: [raggio relativo, quanto buio toglie]; il più interno vince
  const BANDE = [[1, 0.45], [0.7, 0.78], [0.42, 1]];
  const BUIO = '#05060b';
  const pozze = new Map();

  // Pozza di raggio r (pixel di gioco), orlo di ogni gradino a scacchi. tinta: versione calda per l'alone
  function pozza(r, tinta) {
    const k = r * 2 + (tinta ? 1 : 0);
    let c = pozze.get(k);
    if (c) return c;
    const n = r * 2;
    c = tela();
    c.width = c.height = n;
    const g = c.getContext('2d');
    const im = g.createImageData(n, n), d = im.data;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = x + 0.5 - r, dy = y + 0.5 - r, dist = Math.sqrt(dx * dx + dy * dy);
        let a = 0;
        for (const [rk, v] of BANDE) {
          const rr = r * rk;
          if (dist < rr && !(dist > rr - 1.5 && ((x + y) & 1))) a = v;
        }
        const p = (y * n + x) * 4;
        d[p] = 255; d[p + 1] = tinta ? 220 : 255; d[p + 2] = tinta ? 176 : 255;
        d[p + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(im, 0, 0);
    if (pozze.size > 48) pozze.clear();
    pozze.set(k, c);
    return c;
  }

  // ---------- Profilo inferiore del titolo (attacchi di catene e gocce) ----------

  // Le lettere del titolo disegnate una per una su una tela nascosta, col carattere calcolato dall'elemento e nella
  // posizione che il browser dà a ogni lettera (Range): per ogni colonna il punto più basso con inchiostro.
  // Restituisce i tratti che arrivano alla linea di base (entro 2 px) larghi abbastanza da essere un'asta:
  // [{ x0, x1, y, lettera }] in px della pagina (client). Lista vuota se i pixel non si leggono.
  const STIRA = { 50: 'ultra-condensed', 62.5: 'extra-condensed', 75: 'condensed', 87.5: 'semi-condensed', 100: 'normal',
    112.5: 'semi-expanded', 125: 'expanded', 150: 'extra-expanded', 200: 'ultra-expanded' };
  let profiloChiave = '', profiloTratti = [];
  function trattiTitolo(h1) {
    const r = h1.getBoundingClientRect(), cs = getComputedStyle(h1);
    const chiave = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), cs.fontSize,
      document.fonts ? document.fonts.status : ''].join('|');
    if (chiave === profiloChiave) return profiloTratti;
    profiloChiave = chiave; profiloTratti = [];
    const nodo = [...h1.childNodes].find((n) => n.nodeType === 3);
    if (!nodo || r.width < 4) return profiloTratti;
    try {
      const fs = parseFloat(cs.fontSize) || 100, pad = Math.ceil(fs * 0.3);
      const c = tela();
      c.width = Math.ceil(r.width) + 2 * pad; c.height = Math.ceil(r.height) + 2 * pad;
      const g = c.getContext('2d', { willReadFrequently: true });
      const stira = STIRA[parseFloat(cs.fontStretch)] || (cs.fontStretch && !/%/.test(cs.fontStretch) ? cs.fontStretch : 'normal');
      g.font = `${cs.fontStyle} ${cs.fontWeight} ${stira} ${cs.fontSize} ${cs.fontFamily}`;
      if ('fontStretch' in g) g.fontStretch = stira;
      g.textBaseline = 'alphabetic';
      g.fillStyle = '#000';
      const m0 = g.measureText('H'), asc = m0.fontBoundingBoxAscent;
      const rg = document.createRange(), testo = nodo.textContent, lettere = [];
      for (let i = 0; i < testo.length; i++) {
        if (!testo[i].trim()) continue;
        rg.setStart(nodo, i); rg.setEnd(nodo, i + 1);
        const q = rg.getClientRects()[0];
        if (!q || q.width < 1) continue;
        // linea di base: cima del riquadro della lettera più la salita del carattere
        const base = q.top + (asc > 0 ? asc : q.height * 0.8);
        g.fillText(testo[i], q.left - r.left + pad, base - r.top + pad);
        lettere.push({ x0: q.left, x1: q.right, base });
      }
      const W = c.width, H = c.height, d = g.getImageData(0, 0, W, H).data;
      // profilo inferiore: per colonna, la riga più bassa con inchiostro
      const basso = new Int32Array(W).fill(-1);
      for (let x = 0; x < W; x++) {
        for (let y = H - 1; y >= 0; y--) if (d[(y * W + x) * 4 + 3] > 128) { basso[x] = y; break; }
      }
      const minimo = Math.max(3, Math.round(fs * 0.04));   // larghezza minima di un'asta
      lettere.forEach((L, k) => {
        const xa = Math.max(0, Math.floor(L.x0 - r.left + pad)), xb = Math.min(W - 1, Math.ceil(L.x1 - r.left + pad));
        const yb = L.base - r.top + pad;
        let i0 = -1;
        for (let x = xa; x <= xb + 1; x++) {
          const ok = x <= xb && basso[x] >= yb - 2 && basso[x] <= yb + 3;   // l'inchiostro arriva alla linea di base
          if (ok && i0 < 0) i0 = x;
          if (!ok && i0 >= 0) {
            if (x - i0 >= minimo) {
              let y = 0;
              for (let j = i0; j < x; j++) y = Math.max(y, basso[j]);
              profiloTratti.push({ x0: i0 - pad + r.left, x1: x - pad + r.left, y: y + 1 - pad + r.top, lettera: k });
            }
            i0 = -1;
          }
        }
      });
    } catch (e) { profiloTratti = []; }   // senza lettura dei pixel: nessuna catena, nessuna goccia
    return profiloTratti;
  }
  // Un attacco per lettera (il centro dell'asta più larga), da sinistra a destra
  function attacchiLettere(tratti) {
    const per = new Map();
    for (const t of tratti) {
      const p = per.get(t.lettera);
      if (!p || t.x1 - t.x0 > p.x1 - p.x0) per.set(t.lettera, t);
    }
    return [...per.values()].sort((a, b) => a.x0 - b.x0).map((t) => ({ x: (t.x0 + t.x1) / 2, y: t.y, lettera: t.lettera }));
  }

  // ---------- 1. Apertura: mini gioco al buio ----------

  // Attacco di ogni nemico come nel gioco (personaggi/z24-e0N/mosse.json → cervello, comportamento):
  // carica = corsa addosso dopo un avviso (e sasso ad arco), sputo = salva ad arco tenendo la distanza, balzo = salto
  // addosso, rotola = rotola e salta con l'onda, scaglie = dardi dritti in volo, lampada = fascio e salva ad arco,
  // muro = fisso alla parete col laser dalla mano (Braccio innestato), mischia = colpo a contatto.
  const MODI = { 'z24-e01': 'carica', 'z24-e02': 'sputo', 'z24-e03': 'balzo', 'z24-e04': 'carica', 'z24-e05': 'rotola',
    'z24-e06': 'scaglie', 'z24-e07': 'lampada', 'z24-e08': 'muro', 'z24-e09': 'mischia' };
  // Tipo di nemico: clip (avanza obbligatoria) e misure del corpo; modo = attacco (MODI).
  // Con alt (altezza_px di gioco.json) il corpo sta sopra il pivot (i piedi): le celle cotte sono larghe e hanno
  // spazio per gli effetti, quindi il riquadro dei pixel vale solo per la larghezza, contenuta. Senza: il riquadro.
  function tipo(c, vola, vel, hp, modo, alt) {
    const a = c.avanza, r = a.r;
    modo = modo || 'mischia';
    if (alt > 0) {
      const hw = Math.max(4, Math.min((r.x1 - r.x0) / 2, alt * 0.6));
      const ox = Math.max(-hw, Math.min(hw, (r.x0 + r.x1) / 2 - a.px));
      if (!vola && modo !== 'muro') return { c, vola, vel, hp, modo, alto: alt, basso: 1, hw, hh: alt / 2, ox, oy: -alt / 2 };
      // volanti e Braccio a muro hanno il pivot nel corpo (il Braccio: il punto d'innesto)
      // riquadro dei pixel, tenuto entro 1,6 altezze sopra e 0,8 sotto il pivot
      const y0 = Math.max(r.y0, a.py - 1.6 * alt), y1 = Math.min(r.y1, a.py + 0.8 * alt);
      return { c, vola, vel, hp, modo, alto: a.py - y0, basso: Math.max(1, y1 - a.py), hw, hh: (y1 - y0) / 2, ox, oy: (y0 + y1) / 2 - a.py };
    }
    return {
      c, vola, vel, hp, modo,
      alto: a.py - r.y0, basso: r.y1 - a.py,
      hw: (r.x1 - r.x0) / 2, hh: (r.y1 - r.y0) / 2,
      ox: (r.x0 + r.x1) / 2 - a.px, oy: (r.y0 + r.y1) / 2 - a.py,
    };
  }
  const pronta = (a) => { if (a) { analizza(a, true); a.b = bianca(a.img); } return a; };

  // Nemici animati del gioco (gioco.json → nemici): ognuno va a `dai` appena le sue strisce sono pronte.
  // Restituisce quanti ne sono arrivati.
  async function tipiDelGioco(G, dai) {
    const voci = Object.entries((G && G.nemici) || {}).filter(([, n]) => n && n.clip && n.clip.avanza);
    const fatti = await Promise.all(voci.map(async ([id, n]) => {
      const [avanza, attacco, colpito, morte] = await Promise.all(
        ['avanza', 'attacco', 'colpito', 'morte'].map((k) => atlanteOpz(n.clip[k], GIOCO)));
      if (!avanza) return 0;
      // pixel e sagome bianche a fette nei momenti liberi: niente blocchi mentre la scena parte
      const c = await new Promise((ok) => aFette(() => ok({ avanza: pronta(avanza), attacco: pronta(attacco), colpito: pronta(colpito), morte: pronta(morte) })));
      // le farfalline (Falena piccola) volano in sciami alti e non sparano
      const modo = id === 'z24-e06-mini' ? 'sciame' : MODI[id.replace(/-mini$/, '')] || (n.volante ? 'scaglie' : 'mischia');
      const alt = +n.altezza_px || 0;
      const t = n.volante ? tipo(c, true, caso(18, 26), 2, modo, alt) : tipo(c, false, caso(14, 24), Math.random() < 0.5 ? 2 : 3, modo, alt);
      t.id = id; t.alt = alt;
      dai(t);
      return 1;
    }).map((p) => p.catch(() => 0)));
    return fatti.reduce((s, x) => s + x, 0);
  }

  // Ripiego: PNG fermi di sprite.json, il glifo che rotola e l'anello che vola (e tira)
  async function tipiDiRipiego(dati, dai) {
    for (const f of dati.nemici_fermi || []) {
      if (f.file.startsWith('b24')) continue;
      try {
        const img = await carica(SPRITE + f.file);
        const a = analizza({ img, fw: f.w, fh: f.h, n: 1, durate: [1000], tot: 1000, loop: true, px: 0, py: 0 }, true);
        a.px = Math.round((a.r.x0 + a.r.x1) / 2); a.py = a.r.y1; a.b = bianca(img);
        dai(tipo({ avanza: a, attacco: null, colpito: null, morte: null }, false, caso(12, 20), 3));
      } catch (e) { /* manca un nemico: si va avanti senza */ }
    }
    const NA = dati.nemici_animati || {};
    for (const [pre, avanza, attacco, vel, vola] of [
      ['glifo_rotolante', 'rotolare', 'scatto', 34, false], ['anello_custode', 'fermo', 'sparo', 22, true]]) {
      const [av, at, co, mo] = await Promise.all(
        [avanza, attacco, 'danno', 'morte'].map((k) => atlanteOpz(NA[pre + '_' + k], SPRITE)));
      if (av) dai(tipo({ avanza: pronta(av), attacco: pronta(at), colpito: pronta(co), morte: pronta(mo) }, vola, vel, 2, vola ? 'sputo' : 'rotola'));
    }
  }

  // Archi dei fendenti (effetti «arco» della clip, come rasterizzaArchi di feel.mjs) cotti una volta in un
  // atlante a parte: si disegnano sopra il buio, specchiati col protagonista
  function cuociArchi(a) {
    const ef = a.effetti;
    if (!Array.isArray(ef) || !ef.some((l) => Array.isArray(l) && l.some((e) => e && e.tipo === 'arco'))) return;
    const c = tela();
    c.width = a.fw * a.n; c.height = a.fh;
    const gc = c.getContext('2d'), im = gc.createImageData(c.width, c.height), d = im.data;
    a.arco = new Uint8Array(a.n);
    for (let f = 0; f < a.n; f++) {
      for (const e of ef[f] || []) {
        if (!e || e.tipo !== 'arco' || !e.c || !Array.isArray(e.colori) || !e.colori.length) continue;
        a.arco[f] = 1;
        const span = Math.abs(e.a0 - e.a1), n = e.colori.length, bordo = e.bordo ?? 0.28, v = e.verso || 1;
        const xa = Math.max(0, Math.floor(e.c[0] - e.r1)), xb = Math.min(a.fw - 1, Math.ceil(e.c[0] + e.r1));
        const ya = Math.max(0, Math.floor(e.c[1] - e.r1)), yb = Math.min(a.fh - 1, Math.ceil(e.c[1] + e.r1));
        for (let y = ya; y <= yb; y++) {
          for (let x = xa; x <= xb; x++) {
            const dx = x + 0.5 - e.c[0], dy = y + 0.5 - e.c[1], dist = Math.hypot(dx, dy);
            if (dist < e.r0 || dist > e.r1) continue;
            const an = Math.atan2(-dy, dx) * 180 / Math.PI;
            const rel = (((e.a0 - an) * v) % 360 + 360) % 360;
            if (rel > span) continue;
            const tt = Math.min(1, rel / Math.max(span, 1e-6)), rr = (dist - e.r0) / Math.max(e.r1 - e.r0, 1e-6);
            if (dist < e.r1 - (e.r1 - e.r0) * Math.pow(tt, 0.6)) continue;   // mezzaluna: coda sottile, testa piena
            const col = e.colori[(rr > 1 - bordo && tt > 0.35) ? 0 : (tt > 0.25 ? Math.min(1, n - 1) : n - 1)];
            const o = (y * c.width + f * a.fw + x) * 4;
            d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
          }
        }
      }
    }
    gc.putImageData(im, 0, 0);
    a.archi = c;
  }

  // ---- Mantello rosso: maglia di Verlet C×R appesa a nuca e spalle (versione piccola di prova/mantello.mjs,
  // misure e colori di personaggi/a/stoffa.json). Disegno a pixel interi: triangoli → toni → contorno di 1 px.
  const STOFFA = ['', '#d8423e', '#a0202e', '#62122a', '#7c1a2e', '#561224', '#2a0a14']; // luce, base, ombra, rovescio ×2, contorno
  function mantello() {
    const C = 4, R = 7, N = C * R, H = 48, PASSO = 1 / 120, S = 96;
    const LUN = 0.62 * H, ACC = 0.06 * H, LAR = 0.14 * H, ALL = 2.2, GRAV = 17 * H * 0.8;
    const sv = [], sh = [];
    for (let c = 0; c < C; c++) sv.push((LUN - ACC * c / (C - 1)) / (R - 1));
    for (let r = 0; r < R; r++) sh.push(LAR / (C - 1) * (1 + (ALL - 1) * r / (R - 1)));
    const x = new Float32Array(N), y = new Float32Array(N), xp = new Float32Array(N), yp = new Float32Array(N);
    const dX = new Float32Array(N), dY = new Float32Array(N);
    const ka = new Float32Array(C * 2), kp = new Float32Array(C * 2), sp = new Float32Array(4);
    let pronto = false, acc = 0, t = 0, verso = 1;
    const cv = tela();
    cv.width = cv.height = S;
    const cg = cv.getContext('2d');
    const im = cg.createImageData(S, S), u32 = new Uint32Array(im.data.buffer), et = new Uint8Array(S * S);
    const COL = STOFFA.map((h) => {
      if (!h) return 0;
      const v = parseInt(h.slice(1), 16);
      return ((255 << 24) | ((v & 255) << 16) | (((v >> 8) & 255) << 8) | (v >> 16)) >>> 0;
    });

    // Ancore della riga 0 lungo la spezzata nuca → spalla lontana → spalla vicina, a pari lunghezza d'arco
    function ancore(p) {
      kp.set(ka);
      const l1 = Math.hypot(p[2] - p[0], p[3] - p[1]), l2 = Math.hypot(p[4] - p[2], p[5] - p[3]), tot = l1 + l2;
      for (let c = 0; c < C; c++) {
        const s = tot * c / (C - 1);
        if (s <= l1 && l1 > 0) {
          const u = s / l1;
          ka[c * 2] = p[0] + (p[2] - p[0]) * u; ka[c * 2 + 1] = p[1] + (p[3] - p[1]) * u;
        } else {
          const u = l2 > 0 ? Math.min(1, (s - l1) / l2) : 1;
          ka[c * 2] = p[2] + (p[4] - p[2]) * u; ka[c * 2 + 1] = p[3] + (p[5] - p[3]) * u;
        }
      }
    }
    // Telo appeso fermo, appena staccato dalla schiena
    function posa() {
      for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
          const i = r * C + c, s = sv[c] * r;
          x[i] = xp[i] = ka[c * 2] - verso * s * 0.25;
          y[i] = yp[i] = ka[c * 2 + 1] + s * 0.96;
        }
      }
      kp.set(ka);
      pronto = true;
    }
    function vincoli(terra) {
      for (let r = 1; r < R; r++) {
        for (let c = 0; c < C; c++) {   // colonne: lunghezza fissa
          const i = r * C + c, j = i - C, dx = x[i] - x[j], dy = y[i] - y[j], d = Math.hypot(dx, dy) || 1e-3, e = (d - sv[c]) / d;
          if (r === 1) { x[i] -= dx * e; y[i] -= dy * e; }
          else { x[i] -= dx * e * 0.5; y[i] -= dy * e * 0.5; x[j] += dx * e * 0.5; y[j] += dy * e * 0.5; }
        }
        for (let c = 0; c < C - 1; c++) {   // righe: si piegano ma non si schiacciano né si strappano
          const i = r * C + c, j = i + 1, dx = x[j] - x[i], dy = y[j] - y[i], d = Math.hypot(dx, dy) || 1e-3;
          const L = Math.max(sh[r] * 0.4, Math.min(sh[r] * 1.1, d));
          if (L === d) continue;
          const e = (d - L) / d * 0.5;
          x[i] += dx * e; y[i] += dy * e; x[j] -= dx * e; y[j] -= dy * e;
        }
      }
      // Dietro la schiena (asse collo → anca) e mai sotto il suolo
      const cy = sp[1], dy0 = sp[3] - sp[1] || 1;
      for (let i = C; i < N; i++) {
        if (y[i] < sp[3] + 10) {
          const u = Math.max(0, Math.min(1, (y[i] - cy) / dy0)), d = (x[i] - (sp[0] + (sp[2] - sp[0]) * u)) * verso;
          if (d > 0.5) x[i] -= (d - 0.5) * verso;
        }
        if (y[i] > terra - 0.5) { y[i] = terra - 0.5; x[i] = xp[i] + (x[i] - xp[i]) * 0.5; }
      }
    }
    // p: [nuca, spalla lontana, spalla vicina] nel mondo; s: [collo, anca]; hv: velocità del corpo (px/s)
    function aggiorna(dt, p, s, ver, hvx, hvy, terra) {
      const sx = ka[0], sy = ka[1];
      verso = ver;
      ancore(p);
      sp.set(s);
      if (!pronto || Math.abs(ka[0] - sx) > 30 || Math.abs(ka[1] - sy) > 30) posa();
      acc = Math.min(acc + dt, PASSO * 6);
      const n = Math.floor(acc / PASSO);
      acc -= n * PASSO;
      hvx = Math.max(-300, Math.min(300, hvx)); hvy = Math.max(-400, Math.min(400, hvy));
      const a2 = PASSO * PASSO, sm = 0.988, mosso = Math.abs(hvx) + Math.abs(hvy) * 0.5 + 12;
      for (let k = 1; k <= n; k++) {
        t += PASSO;
        const u = k / n;
        for (let c = 0; c < C; c++) {
          x[c] = xp[c] = kp[c * 2] + (ka[c * 2] - kp[c * 2]) * u;
          y[c] = yp[c] = kp[c * 2 + 1] + (ka[c * 2 + 1] - kp[c * 2 + 1]) * u;
        }
        for (let r = 1; r < R; r++) {
          const f = r / (R - 1), q = 0.4 + 0.6 * f;
          for (let c = 0; c < C; c++) {
            const i = r * C + c;
            // aria: il corpo che si muove spinge il telo indietro (e in su quando cade), più un poco di sventolio
            const fl = Math.sin(t * 13 + r * 0.9 + c * 1.7) * mosso * 1.6 * f;
            const fx = -hvx * 10 * q + fl, fy = GRAV - hvy * 5 * q - Math.abs(hvx) * 2.2 * f + fl * 0.4;
            const nx = x[i] + (x[i] - xp[i]) * sm + fx * a2, ny = y[i] + (y[i] - yp[i]) * sm + fy * a2;
            xp[i] = x[i]; yp[i] = y[i]; x[i] = nx; y[i] = ny;
          }
        }
        for (let it = 0; it < 3; it++) vincoli(terra);
      }
    }
    // Triangolo pieno sui centri dei pixel (con mezzo pixel di tolleranza: niente buchi nelle parti sottili)
    function tri(i, j, k, lab, ox, oy, w, h) {
      const ax = dX[i] - ox, ay = dY[i] - oy, bx = dX[j] - ox, by = dY[j] - oy, cx = dX[k] - ox, cy = dY[k] - oy;
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 0.01) return;
      const s = area > 0 ? 1 : -1;
      const l0 = -0.4 * Math.hypot(bx - ax, by - ay), l1 = -0.4 * Math.hypot(cx - bx, cy - by), l2 = -0.4 * Math.hypot(ax - cx, ay - cy);
      const xa = Math.max(0, Math.floor(Math.min(ax, bx, cx))), xb = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
      const ya = Math.max(0, Math.floor(Math.min(ay, by, cy))), yb = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let py = ya; py <= yb; py++) {
        const qy = py + 0.5;
        for (let px = xa; px <= xb; px++) {
          const qx = px + 0.5;
          if (((bx - ax) * (qy - ay) - (by - ay) * (qx - ax)) * s >= l0
            && ((cx - bx) * (qy - by) - (cy - by) * (qx - bx)) * s >= l1
            && ((ax - cx) * (qy - cy) - (ay - cy) * (qx - cx)) * s >= l2) et[py * S + px] = lab;
        }
      }
    }
    function disegna(gx) {
      if (!pronto) return;
      dX.set(x); dY.set(y);
      // orlo a denti: le colonne dispari dell'ultima riga un poco più corte
      for (let c = 1; c < C; c += 2) {
        const i = (R - 1) * C + c, j = i - C;
        dX[i] = x[i] + (x[j] - x[i]) * 0.35; dY[i] = y[i] + (y[j] - y[i]) * 0.35;
      }
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let i = 0; i < N; i++) {
        if (dX[i] < x0) x0 = dX[i];
        if (dX[i] > x1) x1 = dX[i];
        if (dY[i] < y0) y0 = dY[i];
        if (dY[i] > y1) y1 = dY[i];
      }
      const ox = Math.floor(x0) - 1, oy = Math.floor(y0) - 1;
      const w = Math.min(S, Math.ceil(x1) + 2 - ox), h = Math.min(S, Math.ceil(y1) + 2 - oy);
      if (w <= 0 || h <= 0) return;
      for (let r = 0; r < h; r++) et.fill(0, r * S, r * S + w);
      for (let r = 0; r < R - 1; r++) {
        for (let c = 0; c < C - 1; c++) {
          const a = r * C + c, b = a + 1, d = a + C, e = d + 1;
          // dritto o rovescio dal verso del quadrilatero; sul dritto tre bande (luce, base, ombra) come pieghe
          const cr = (dX[d] - dX[a]) * (dY[b] - dY[a]) - (dY[d] - dY[a]) * (dX[b] - dX[a]);
          const lab = cr * verso <= 0 ? (r === 0 ? 2 : c === 0 ? 1 : c === C - 2 ? 3 : 2) : (c % 2 ? 5 : 4);
          tri(a, b, e, lab, ox, oy, w, h);
          tri(a, e, d, lab, ox, oy, w, h);
        }
      }
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const p = py * S + px;
          let l = et[p];
          if (!l) {
            const v = (q) => et[q] && et[q] < 6;
            if ((px > 0 && v(p - 1)) || (px < w - 1 && v(p + 1)) || (py > 0 && v(p - S)) || (py < h - 1 && v(p + S))) et[p] = l = 6;
          }
          u32[p] = COL[l];
        }
      }
      cg.putImageData(im, 0, 0, 0, 0, w, h);
      gx.drawImage(cv, 0, 0, w, h, ox, oy, w, h);
    }
    return { aggiorna, disegna, azzera: () => { pronto = false; } };
  }

  // ---- Mantello del gioco: la stessa simulazione e lo stesso pittore (gioco-mantello/ = copia di prova/mantello.mjs,
  // coreografia.mjs, vento.mjs e personaggi/a/stoffa.json, fatta da copia_sprite.py), usati come in prova.mjs
  // (FX_BASE.mantello: livello 1, cremisi, copertura 0,3; vento «brezza»; regia delle coreografie; lembo davanti).
  // Se i moduli non si caricano (file://, browser vecchio) resta mantello() qui sopra come riserva.
  const GIUNTI = ['nuca', 'spalla_f', 'spalla_n', 'collo', 'anca', 'vita', 'anca_n', 'ginocchio_n', 'anca_f', 'ginocchio_f', 'gomito_n'];
  // ripiego (H, avanti/su dai piedi) per i giunti che mancano, come RIPIEGO_M di prova.mjs
  const RIPIEGO_M = { nuca: [-0.02, 0.85], collo: [0, 0.76], spalla_n: [0.01, 0.72], spalla_f: [-0.02, 0.72], vita: [0, 0.5], anca: [0, 0.44],
    anca_n: [0.02, 0.44], anca_f: [-0.02, 0.44], ginocchio_n: [0.08, 0.23], ginocchio_f: [-0.02, 0.23], gomito_n: [0.04, 0.58], polso_n: [0.08, 0.46] };
  const ATTACCO_RE = /^(fendente|montante|spazzata|affondo|aria_|ritorno|taglio|caricato|carica|doppia|bruciapelo|schianto)/;
  let promessaManto = null;
  function caricaMantelloGioco() {
    return (promessaManto ||= Promise.all([
      import('./gioco-mantello/mantello.mjs'), import('./gioco-mantello/coreografia.mjs'), import('./gioco-mantello/vento.mjs'),
      fetch('gioco-mantello/stoffa.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([M, Co, Ve, j]) => ({ M, Co, Ve, dati: (j && j.mantello) || M.MANTELLO_BASE })).catch(() => null));
  }
  // Atlante delle parti di una clip (una lettura dei pixel, quando serve): copertura del lembo davanti
  function partiDi(a) {
    if (!a.partiFile || a.par !== undefined) return;
    a.par = null;
    carica(SPRITE + a.partiFile).then((img) => {
      try {
        const c = tela();
        c.width = img.width; c.height = img.height;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0);
        a.par = x.getImageData(0, 0, c.width, c.height).data;
        a.parW = img.width;
      } catch (e) { /* file:// o tela sporca: niente lembo davanti */ }
    }).catch(() => {});
  }
  // ---- Effetti in lettere del gioco (gioco-ascii/ = copia di prova/ascii*.mjs coi loro dati, da copia_sprite.py):
  // stesso motore, stesse ricette di sangue (ASC0/ASC5), colpi e spari (ASC2/SPA1). Senza: restano gli effetti a pixel.
  let promessaLettere = null;
  function caricaLettereGioco() {
    return (promessaLettere ||= Promise.all([
      import('./gioco-ascii/prova/ascii.mjs'), import('./gioco-ascii/prova/ascii_sangue.mjs'),
      import('./gioco-ascii/prova/ascii_colpi.mjs'), import('./gioco-ascii/prova/tetto_fx.mjs'),
      fetch('gioco-ascii/zone/ascii-agganci.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([M, S, C, T, AG]) => ({ M, S, C, T, corpo: (AG && AG.spari && AG.spari.corpo) || null })).catch(() => null));
  }
  const nomeRegia = (a) => String(a && a.nome || '').replace(/_pistola$/, '');

  function mantelloVero(K) {
    const { M, Co, Ve, dati } = K, H = 48;
    const man = new M.Mantello(dati);
    man.imposta(dati, 1, { lunghezza: 1, larghezza: 1, rigidita: 0.5, peso: 1, accorcia: 1 }, H);
    const P = man.par, cc = (dati.colori && dati.colori.cremisi) || M.MANTELLO_BASE.colori.cremisi, col = {};
    for (const k of ['luce', 'base', 'ombra', 'rovescio', 'rovescio_ombra', 'contorno']) col[k] = M.rgb(cc[k]);
    if (P.fodera) { col.rovescio = M.rgb(P.fodera.rovescio); col.rovescio_ombra = M.rgb(P.fodera.rovescio_ombra); }
    const regia = new Co.Regia(dati), vento = new Ve.Vento(Ve.VENTI.brezza);
    const MBW = Math.ceil(2.8 * H), MBH = Math.ceil(2.3 * H);
    const cvD = tela(), cvV = tela();
    cvD.width = cvV.width = MBW; cvD.height = cvV.height = MBH;
    const gD = cvD.getContext('2d', { willReadFrequently: true }), gV = cvV.getContext('2d', { willReadFrequently: true });
    const imD = new ImageData(MBW, MBH), imV = new ImageData(MBW, MBH);
    const pit = new M.Pittore(MBW, MBH, new Uint32Array(imD.data.buffer), new Uint32Array(imV.data.buffer));
    pit.tavolozza(col, P.orlo ? M.rgb(P.orlo) : null, P.bagliore ? M.rgb(P.bagliore) : null, P.ricamo ? M.rgb(P.ricamo.colore) : null, null, null, 0);
    const PARTI = { par: null, W: 0, fw: 0, fh: 0, fx0: 0, X0: 0, Y0: 0, specchio: false };
    const vista = { ox: 0, oy: 0, verso: 1, luce: [0.45, 0.62, 0.64], lampo: null, copre: 0, parti: PARTI, mCopre: 0, mMai: 0, mCorpo: 0,
      ricamoRiga: P.ricamo ? P.ricamo.riga : -1, bagliore: !!P.bagliore, cornice: false, coll: null, collW: Math.max(1, Math.round(0.035 * H)), asse: null, margine: -0.5 };
    const posa = { a: null, f: 0, x: 0, y: 0, v: 1, nome: '', t: 0 }, tempi = { inizio: 0, colpo: 0, gira: 0, fine: 0 };
    const COLL = new Float32Array(10), ASSE = new Float32Array(4), t1 = [0, 0], t2 = [0, 0], sc = [0, 0], maschere = new Map();
    let firma = 0, ox = 0, oy = 0, davanti = false, davReg = false, copReg = 0.33;

    // Punto nominato della posa nel mondo. Lo sprite specchiato qui è disegnato 1 px più a sinistra che nel gioco.
    function punto(nome, o) {
      const { a, f, x, y, v } = posa, gj = a && a.giunti && a.giunti[f], k = GIUNTI.indexOf(nome);
      if (gj && k >= 0 && gj[k * 2] != null) {
        o[0] = x + v * (gj[k * 2] - a.px) - (v < 0 ? 1 : 0); o[1] = y + (gj[k * 2 + 1] - a.py);
        return true;
      }
      const r = RIPIEGO_M[nome];
      if (!r) return false;
      o[0] = x + v * r[0] * H; o[1] = y - r[1] * H;
      return true;
    }
    // Colletto: fascia rossa alla base del cappuccio e fermaglio sulla gola (colletto() di prova.mjs)
    function colletto(v, ex, ey) {
      const gx = man.telo.giuX, gy = man.telo.giuY;
      if (!punto('collo', t1)) { vista.coll = null; return; }
      let fx0 = -gy, fy0 = gx;
      if (fx0 * v < 0) { fx0 = -fx0; fy0 = -fy0; }
      const cxx = t1[0] + ex, cyy = t1[1] + ey;
      COLL[0] = cxx - fx0 * 0.085 * H + gx * 0.025 * H; COLL[1] = cyy - fy0 * 0.085 * H + gy * 0.025 * H;
      COLL[2] = cxx - fx0 * 0.01 * H - gx * 0.03 * H; COLL[3] = cyy - fy0 * 0.01 * H - gy * 0.03 * H;
      COLL[4] = cxx + fx0 * 0.07 * H + gx * 0.015 * H; COLL[5] = cyy + fy0 * 0.07 * H + gy * 0.015 * H;
      if (punto('spalla_n', t2)) {
        COLL[6] = t2[0] + ex; COLL[7] = t2[1] + ey;
        if (punto('gomito_n', t1)) { COLL[8] = COLL[6] + (t1[0] + ex - COLL[6]) * 0.5; COLL[9] = COLL[7] + (t1[1] + ey - COLL[7]) * 0.5; }
        else { COLL[8] = COLL[6] + gx * 0.1 * H; COLL[9] = COLL[7] + gy * 0.1 * H; }
      } else { COLL[6] = COLL[8] = COLL[2]; COLL[7] = COLL[9] = COLL[3]; }
      vista.coll = COLL;
    }
    // Un passo (dirigiMantello + mantello.aggiorna di prova.mjs): posa del fotogramma, coreografia della mossa, vento
    function passo(dt, a, f, x, y, v, t, vx, vy, suolo) {
      posa.a = a; posa.f = Math.max(0, f); posa.x = x; posa.y = y; posa.v = v; posa.t = t; posa.nome = nomeRegia(a);
      man.leggiPosa(punto, x, y, v, null);
      if (man.girato && !regia.risolvi(posa.nome).passi.some((q) => q.fase === 'gira')) regia.scatena('cambio_verso');
      Co.tempiClip({ colpi: a.colpi }, a.durate, tempi);
      const o = regia.valuta(posa.nome, t, tempi, dt);
      let dx = 0, dy = 0;
      if (o.modo === 2) { dx = -vx; dy = -vy; if (!dx && !dy) dx = -v; }
      man.dirigi(o, dx, dy);
      davReg = o.davanti && o.k > 0.2; copReg = (o.passo && o.passo.copre) ?? 0.33;
      if (o.nuovo >= 0 && o.passo) {
        if (o.passo.onda) man.onda(o.passo.onda);
        if (o.passo.spinta) man.spingi(-v * o.passo.spinta[0] * H, o.passo.spinta[1] * H);
      }
      vento.aggiorna(dt);
      const ve = vento.in(x / H) * H;
      if (!man.telo.pronta) man.aggiorna(1 / 60, x, y, ve, suolo);
      man.aggiorna(dt, x, y, ve, suolo);
    }
    // Strato dietro (prima dello sprite): telo e colletto; prepara anche il lembo davanti
    function dietro(gx) {
      const a = posa.a;
      if (!a || !man.pronte) return;
      const x = posa.x, y = posa.y, v = posa.v, tl = man.telo;
      man.scarto(sc, x, y);
      const rx = Math.round(x) - x, ry = Math.round(y) - y;
      sc[0] += rx; sc[1] += ry;
      colletto(v, rx - sc[0], ry - sc[1]);
      ox = Math.round(tl.kx[0] + sc[0]) - (MBW >> 1); oy = Math.round(tl.ky[0] + sc[1]) - Math.round(1.05 * H);
      if (punto('collo', t1) && punto('anca', t2)) {
        ASSE[0] = t1[0] + rx - ox; ASSE[1] = t1[1] + ry - oy; ASSE[2] = t2[0] + rx - ox; ASSE[3] = t2[1] + ry - oy; vista.asse = ASSE;
      } else vista.asse = null;
      vista.margine = tl.giroT > 0 || tl.coda > 0 ? 0.0625 * H : -0.5;
      vista.ox = ox - sc[0]; vista.oy = oy - sc[1]; vista.verso = v; vista.copre = 0;
      PARTI.par = null;
      partiDi(a);
      if (a.par) {
        let mk = maschere.get(a);
        if (!mk) {
          const cp = P.copertura || {};
          mk = [M.maschera(a.partiIndici, cp.copre), M.maschera(a.partiIndici, cp.mai_coprire), M.maschera(a.partiIndici, cp.corpo), M.maschera(a.partiIndici, cp.mai_in_attacco)];
          maschere.set(a, mk);
        }
        const X = Math.round(x), drawX = v >= 0 ? X - a.px : X + a.px - a.fw;
        PARTI.par = a.par; PARTI.W = a.parW; PARTI.fw = a.fw; PARTI.fh = a.fh; PARTI.fx0 = posa.f * a.fw;
        PARTI.X0 = ox - drawX; PARTI.Y0 = oy - (Math.round(y) - a.py); PARTI.specchio = v < 0;
        const armato = ATTACCO_RE.test(posa.nome) && posa.t < tempi.colpo + 120;
        vista.mCopre = mk[0]; vista.mMai = armato ? (mk[1] | mk[3]) >>> 0 : mk[1]; vista.mCorpo = mk[2];
        vista.copre = davReg ? Math.max(0.3, copReg) : 0.3;
      }
      const fi = pit.firma(tl, vista);
      if (fi !== firma || vista.bagliore) {   // fermo: la tela resta quella di prima
        firma = fi;
        const sp = pit.disegna(tl, vista);
        gD.putImageData(imD, 0, 0, sp[0], sp[1], sp[2], sp[3]);
        gV.putImageData(imV, 0, 0, sp[0], sp[1], sp[2], sp[3]);
      }
      davanti = pit.contaDavanti > 0;
      gx.drawImage(cvD, ox, oy);
    }
    // Strato davanti (dopo lo sprite): il lembo sul braccio vicino e sulla pistola
    function sopra(gx) { if (davanti && posa.a) gx.drawImage(cvV, ox, oy); }
    return {
      passo, dietro, sopra,
      evento: (nome) => regia.scatena(nome),
      spingi: (vx, vy) => man.spingi(vx * H, vy * H),   // in H/s, come le chiamate di prova.mjs
      azzera: () => { man.telo.pronta = false; },
    };
  }

  // Mantello di una scena: parte con la riserva, passa a quello del gioco appena i moduli sono caricati
  function mantelloScena(pronto) {
    const m = { vero: null, riserva: mantello() };
    caricaMantelloGioco().then((K) => {
      if (!K) return;
      try { m.vero = mantelloVero(K); if (pronto) pronto(); } catch (e) { m.vero = null; }
    });
    return m;
  }

  // Agganci del mantello per il fotogramma f della clip a, protagonista coi piedi in (x, y):
  // P6 = nuca, spalla lontana, spalla vicina (stoffa.json: giù 0,05 H; giù e dietro 0,02 H; giù 0,03 H); SP = collo, anca
  function agganci(a, f, x, y, v, P6, SP) {
    const gj = a.giunti && a.giunti[Math.max(0, f)];
    if (!gj) return false;
    const X = (sx) => x + v * (sx - a.px), Y = (sy) => y + (sy - a.py);
    P6[0] = X(gj[0]); P6[1] = Y(gj[1]) + 2.4;
    P6[2] = X(gj[2]) - v; P6[3] = Y(gj[3]) + 1;
    P6[4] = X(gj[4]); P6[5] = Y(gj[5]) + 1.4;
    SP[0] = X(gj[6]); SP[1] = Y(gj[7]); SP[2] = X(gj[8]); SP[3] = Y(gj[9]);
    return true;
  }

  // Cifre a pixel 3×5 con contorno scuro (come i numeri del danno di feel.mjs), in cache per colore
  const CIFRE = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
    '111100111001111', '111100111101111', '111001010010010', '111101111101111', '111101111001111'];
  const cifre = new Map();
  function cifra(d, col) {
    const k = col + d;
    let c = cifre.get(k);
    if (c) return c;
    c = tela();
    c.width = 5; c.height = 7;
    const gc = c.getContext('2d'), m = CIFRE[d];
    for (const [colore, o] of [['#120e14', -1], ['#120e14', 1], [col, 0]]) {
      gc.fillStyle = colore;
      for (let j = 0; j < 5; j++) {
        for (let i = 0; i < 3; i++) {
          if (m[j * 3 + i] !== '1') continue;
          if (o) { gc.fillRect(1 + i + o, 1 + j, 1, 1); gc.fillRect(1 + i, 1 + j + o, 1, 1); }
          else gc.fillRect(1 + i, 1 + j, 1, 1);
        }
      }
    }
    cifre.set(k, c);
    return c;
  }

  // Tratto a pixel netti da (X, Y) lungo (a, b) per l px, quadrati di lato s
  function tratto(gx, X, Y, a, b, l, col, s) {
    gx.fillStyle = col;
    const h = s >> 1;
    for (let j = 0; j <= l; j++) gx.fillRect(Math.round(X + a * j) - h, Math.round(Y + b * j) - h, s, s);
  }

  // Clip del protagonista che arrivano mentre la scena gira (corsa, sparo e respiro servono subito)
  const MOSSE = ['fendente_1', 'fendente_2', 'fendente_3', 'salto_stacco', 'salto_sale', 'salto_apice', 'salto_cade',
    'aria_schianto', 'schianto_atterra', 'scatto', 'atterraggio', 'sparo_diag_su', 'sparo_su', 'sparo_aria',
    'sparo_diag_su_aria', 'sparo_su_aria', 'salto_doppio', 'aria_1', 'aria_2', 'fendente_alto', 'montante', 'spazzata',
    'parry', 'affondo_scatto', 'carica_inizio', 'carica', 'caricato'];
  // Pose di sparo [orizzontale, diagonale, in alto], a terra e in aria
  const POSE_SPARO = [['sparo', 'sparo_diag_su', 'sparo_su'], ['sparo_aria', 'sparo_diag_su_aria', 'sparo_su_aria']];
  // Particelle: scintilla, pixel, polvere, fumo, stella, bossolo (le prime e le stelle stanno sopra il buio)
  const SCI = 0, PIX = 1, POL = 2, FUM = 3, STE = 4, BOS = 5, PARTI = 160;
  const COL_SCINT = ['#ffffff', '#fff1b8', '#ffd36b', '#ff9a3c'];
  const COL_FUOCO = ['#fff1b8', '#ffb347', '#ff7a2a', '#e8661c'];
  const rgbCss = (c) => (Array.isArray(c) ? `rgb(${c[0]},${c[1]},${c[2]})` : c || '#fff');

  async function scenaApertura(canvas) {
    const dati = await caricaDati();
    const P = dati.protagonista;
    // si parte appena c'è il respiro (precaricato da index.html); corsa e sparo arrivano subito dopo
    const respiro = await atlante(P.respiro_pistola, SPRITE);
    let corsa = respiro, sparo = respiro;
    const clip = { respiro_pistola: respiro };
    atlanteOpz(P.corsa_pistola, SPRITE).then((a) => { if (a) corsa = clip.corsa_pistola = a; });
    atlanteOpz(P.sparo, SPRITE).then((a) => { if (a) sparo = clip.sparo = a; });

    const tipi = [];
    const guida = canvas.parentElement.querySelector('.scena__guida');
    const contatore = canvas.parentElement.querySelector('[data-uccisi]');
    // Tre livelli: blocchi (sul canvas), mondo (terra, nemici, eroe) e maschera del buio
    const mondo = tela(), maschera = tela();
    let g = null, gm = null, gb = null, s = 2, W = 160, H = 150, TERRA = 144, V_SALTO = 0;

    // Bocca della pistola rispetto ai piedi (se la clip non la dà); raggio della luce del protagonista
    const BOCCA_X = 26, BOCCA_Y = 33, R_EROE = 58, V_COLPO = 260;
    // Regolazione del pilota (da ritoccare qui): ritmo a frasi, pulizia dei gruppi, pistola a raffiche brevi
    const REGIA = {
      gruppo: 5, gruppoPx: 60,     // pulizia: almeno 5 nemici entro 60 px (o accerchiato da due lati)
      tetto: 0.8,                  // ... o vivi oltre l'80% del massimo della scena
      respiro: [0.9, 1.4],         // s di posa dopo una pulizia
      ritardoOndata: 2,            // s in più prima dell'ondata dopo una pulizia
      cadenza: 0.16,               // s fra i colpi di una raffica
      raffica: [3, 6],             // colpi per raffica
      pausaRaffica: [0.4, 0.9],    // s di silenzio della pistola fra due raffiche
      vicinoPx: 28,                // più vicino di così la pistola tace e tocca alla spada (spara anche a media distanza)
      // raggi dei due Bracci (pista da ballo): un passaggio ogni balloOgni s, a volte insieme a volte alternati
      balloOgni: [8, 14],          // s fra due passaggi
      balloInsieme: 0.4,           // probabilità che partano insieme (incrociati); altrimenti alternati
      balloSfaso: 1.6,             // s di ritardo del secondo raggio quando sono alternati
      raggioMira: 550,             // ms di preavviso (linea sottile)
      raggioFuoco: 3600,           // ms di raggio pieno che spazza la scena
      rossoForza: 0.07,            // luce rossa diffusa del raggio acceso: intensità del velo additivo
      rossoRaggio: 70,             // ... raggio attorno al Braccio che spara (px di gioco)
      rossoLungo: 44,              // ... raggio delle pozze lungo il raggio
      rossoDissolvenza: 250,       // ms di accensione e spegnimento
      // frasi del pilota: [passo, argomento, in aria]; passi: corri (gruppo|oltre|volante|lato|lontano|via), scatto
      // (gruppo|via|lato|avanti|indietro; terzo campo true = in aria), salto (avanti|indietro|su|gruppo), doppio,
      // spara n, aria (spadata), schianto, combo, raffica, affondo (scatto + affondo), caricato, atterra, posa s
      frasi: {
        attraversa_schianto: [['corri', 'gruppo'], ['scatto', 'gruppo'], ['salto', 'avanti'], ['spara', 3], ['doppio'], ['schianto'], ['posa', 0.4]],
        raffica_indietro: [['raffica'], ['salto', 'indietro'], ['aria'], ['atterra'], ['scatto', 'gruppo'], ['combo'], ['posa', 0.3]],
        caccia_volanti: [['corri', 'volante'], ['salto', 'su'], ['spara', 2], ['doppio'], ['spara', 3], ['scatto', 'via', true], ['atterra']],
        cambio_lato: [['scatto', 'lato'], ['salto', 'avanti'], ['doppio'], ['aria'], ['scatto', 'avanti', true], ['atterra'], ['posa', 0.3]],
        scavalca: [['salto', 'gruppo'], ['doppio'], ['scatto', 'avanti', true], ['atterra'], ['combo']],
        affondo_carica: [['affondo'], ['caricato'], ['posa', 0.4]],
        schiva_contrattacca: [['scatto', 'via'], ['salto', 'su'], ['doppio'], ['spara', 3], ['atterra']],
        pistolero: [['corri', 'lontano'], ['spara', 4], ['salto', 'su'], ['spara', 2], ['doppio'], ['atterra']],
      },
      // pesi delle frasi: di base, e moltiplicatori con la folla, coi volanti, col raggio dei Bracci acceso
      pesiFrasi: {
        attraversa_schianto: 1, raffica_indietro: 1, caccia_volanti: 0.6, cambio_lato: 1.2, scavalca: 1, affondo_carica: 0.8,
        schiva_contrattacca: 0.3, pistolero: 1,
        folla: { attraversa_schianto: 4, affondo_carica: 2, scavalca: 2, pistolero: 0.3 },
        volanti: { caccia_volanti: 4, pistolero: 1.5 },
        raggio: { schiva_contrattacca: 5, cambio_lato: 2 },
      },
      frasePausa: [0.35, 0.7],     // s di posa dopo una frase
      fraseOgni: [0.6, 1.6],       // s di calma (corsa, colpi singoli) fra una frase e la successiva
      passoMax: 1.8,               // s massimi perché un passo parta o finisca, poi si salta
      ariaQuota: 0.3,              // quota di tempo in aria desiderata; sotto, le frasi coi salti pesano ariaSpinta volte
      ariaSpinta: 1.8,
      dallAlto: 0.5,               // quota di volanti e sciami che entra dall'alto (sotto il titolo) ballando
      balloVolanti: [1.8, 3],      // s di ballo d'ingresso prima di attaccare
      volantiMax: 3,               // volanti in aria insieme (Falena, Lampada), sciami a parte
      sciameMax: 6,                // farfalline vive insieme
    };
    // Velo rosso morbido (gradiente radiale, una volta): la luce del raggio acceso, senza gradini
    const veloRosso = tela();
    veloRosso.width = veloRosso.height = 64;
    {
      const gv = veloRosso.getContext('2d'), gr = gv.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,48,36,1)'); gr.addColorStop(0.45, 'rgba(255,40,30,.55)'); gr.addColorStop(1, 'rgba(255,30,24,0)');
      gv.fillStyle = gr;
      gv.fillRect(0, 0, 64, 64);
    }
    // Movimento: corsa, gravità, schianto, scatto (px di gioco al secondo); attesa prima di staccarsi da terra
    const V_CORSA = 64, G_EROE = 640, V_SCHIANTO = 380, V_SCATTO = 250, STACCO_MS = 120, G_BOMBA = 260;

    // La tela va dalla base del titolo fino a terra (sopra la riga dei tasti), dietro testo e bottone:
    // salti, volanti, effetti e catene stanno nello stesso spazio. Le misure del DOM si leggono solo qui.
    const titolo = document.getElementById('titolo-gioco');
    function misura() {
      const larg = innerWidth;
      s = larg > 1600 ? 4 : larg >= 760 ? 3 : 2;
      const rp = canvas.parentElement.getBoundingClientRect(), rt = titolo ? titolo.getBoundingClientRect() : null;
      const fz = titolo ? parseFloat(getComputedStyle(titolo).fontSize) || 100 : 100;
      const alto = rt ? rp.top - rt.bottom + fz * 0.12 : 300;
      H = Math.max(80, Math.floor(Math.max(240, alto) / s));
      TERRA = H - 6;
      W = Math.max(80, Math.floor(canvas.parentElement.clientWidth / s));
      g = dimensiona(canvas, W, H, s);
      gm = dimensiona(mondo, W, H, 0);
      gb = dimensiona(maschera, W, H, 0);
      // salto alto al più 36 px, purché la testa resti in scena
      const hmax = Math.min(36, TERRA - 56);
      V_SALTO = hmax >= 10 ? Math.sqrt(2 * G_EROE * hmax) : 0;
      // catene appese alle lettere, in px di gioco della scena
      const cima = rp.top - H * s;
      cimaCatene = rt ? (rt.bottom - fz * 0.08 - cima) / s : 0;
      // attacchi misurati sul bordo inferiore delle aste (uno per lettera), in px di gioco della scena
      const punti = titolo ? attacchiLettere(trattiTitolo(titolo)).map((p) => ({ x: (p.x - rp.left) / s, y: (p.y - cima) / s })) : [];
      costruisciCatene(punti, rt ? rt.width * 1 : 0);
      misuraLettere();
      // Bracci: innestati nei muri laterali (il pivot, punto d'innesto, sul bordo della scena), a metà della fascia
      // d'azione: sopra la testa del protagonista, sotto il titolo
      bracciPosti = [{ x: 0, y: TERRA - 62 }, { x: W, y: TERRA - 62 }];
    }

    // ---- Catene: corde di Verlet appese sotto le lettere, ferme finché qualcosa le tocca (corpo, spada, colpi,
    // esplosioni, schianto). Disegnate in ASCII da un atlante di glifi su una tela sopra la scena, stesse coordinate.
    // Lettere degli effetti (motore del gioco): una tela sopra la scena, alla risoluzione dello schermo
    const cvLettere = document.createElement('canvas');
    cvLettere.className = 'apertura__lettere';
    cvLettere.setAttribute('aria-hidden', 'true');
    canvas.after(cvLettere);
    const gL = cvLettere.getContext('2d');
    let lett = null, dprL = 1, lettereSporche = false;
    function misuraLettere() {
      if (!lett) return;
      dprL = Math.min(2, window.devicePixelRatio || 1);
      cvLettere.width = Math.round(W * s * dprL); cvLettere.height = Math.round(H * s * dprL);
      cvLettere.style.width = W * s + 'px'; cvLettere.style.height = H * s + 'px';
      lett.asc.stanza({ w: W, h: H, suolo: TERRA }, 48);   // la terra della scena: il sangue cade e resta lì
      lettereSporche = false;
    }
    const ferita = (dir) => { if (lett) lett.K.S.notaFerita(lett.asc, { x: eroe.x, y: eroe.y - 26, dir }, 48, 3); };   // sangue blu
    const TIPO_SPARO = { carica: 'sasso', sputo: 'cera', lampada: 'brace', scaglie: 'ago' };
    const cvCatene = document.createElement('canvas');
    cvCatene.className = 'apertura__catene';
    cvCatene.setAttribute('aria-hidden', 'true');
    canvas.after(cvCatene);
    const gC = cvCatene.getContext('2d');
    const ALF_C = ' O0|/\\-', COL_C = ['#4a4e56', '#7a8089', '#b4bac2', '#e3000f'];
    const PASSO_C = 1 / 120;
    let catene = [], glifiC = null, dprC = 1, accC = 0, catSporche = true;
    const vecchioC = [0, 0, 0, 0];
    function costruisciCatene(punti, largCss) {
      const fsC = innerWidth < 760 ? 10 : 13;
      dprC = Math.min(1.5, window.devicePixelRatio || 1);
      glifiC = A && A.glifi ? A.glifi(ALF_C, COL_C, fsC, dprC) : null;
      cvCatene.width = Math.round(W * s * dprC); cvCatene.height = Math.round(H * s * dprC);
      cvCatene.style.width = W * s + 'px'; cvCatene.style.height = H * s + 'px';
      const L = fsC / s * 0.95;
      // su lettere diverse, sparse fra quelle misurate; l'orlo sta sopra la fascia del salto semplice
      // (testa a 84 px da terra): le raggiunge solo il doppio salto (fino a ~110 px)
      const quante = Math.min(punti.length, largCss > 560 ? 6 : 4);
      const scelti = [];
      for (let j = 0; j < quante; j++) scelti.push(punti[Math.round((j + 0.5) * punti.length / quante - 0.5)]);
      const fondi = [96, 104, 92, 108, 100, 94];
      catene = scelti.map((p, j) => {
        // il punto fisso mezzo anello sopra il bordo: il primo anello disegnato tocca la lettera
        const ax = p.x, ay = p.y - L * 0.5, fondo = Math.max(ay + 3 * L, TERRA - fondi[j]);
        const n = Math.max(3, Math.round((fondo - ay) / L));
        const x = new Float32Array(n + 1), y = new Float32Array(n + 1);
        for (let i = 0; i <= n; i++) { x[i] = ax; y[i] = ay + i * L; }
        return { n, L, ax, ay, x, y, xp: x.slice(), yp: y.slice(), sveglia: 0, rosso: 2 + ((j * 5) % Math.max(1, n - 3)) };
      });
      catSporche = true;
      gC.clearRect(0, 0, cvCatene.width, cvCatene.height);
    }
    // Spinta (px/s) ai punti entro r da (x, y); radiale se radiale
    function scuotiCatene(x, y, r, vx, vy, radiale) {
      for (const k of catene) {
        if (Math.abs(k.ax - x) > r + k.n * k.L) continue;
        for (let i = 1; i <= k.n; i++) {
          const dx = k.x[i] - x, dy = k.y[i] - y, d = Math.hypot(dx, dy);
          if (d >= r) continue;
          const f = 1 - d / r;
          const ux = radiale ? (d ? dx / d : 0) * vx : vx, uy = radiale ? (d ? dy / d : -1) * vx : vy;
          k.xp[i] -= ux * f * PASSO_C; k.yp[i] -= uy * f * PASSO_C;
          k.sveglia = 6;
        }
      }
    }
    // Il corpo del protagonista in aria (capsula piedi–testa) sposta gli anelli e passa loro la sua velocità:
    // le catene si muovono solo così (doppio salto, schianto che ci passa in mezzo) e col Braccio del muro
    function toccaCatene() {
      if (eroe.aterra) return;
      const top = eroe.y - 44, bot = eroe.y - 2, R = 6;
      for (const k of catene) {
        if (Math.abs(k.ax - eroe.x) > k.n * k.L + R) continue;
        for (let i = 1; i <= k.n; i++) {
          const py = k.y[i], dx = k.x[i] - eroe.x;
          if (py < top || py > bot || Math.abs(dx) >= R) continue;
          const lato = dx ? Math.sign(dx) : (eroe.hvx >= 0 ? 1 : -1);
          k.x[i] = eroe.x + lato * R;
          k.xp[i] = k.x[i] - eroe.hvx * 0.8 * PASSO_C;
          k.yp[i] = k.y[i] - eroe.hvy * 0.5 * PASSO_C;
          k.sveglia = 6;
        }
      }
    }
    function passoCatene(dt) {
      accC = Math.min(accC + dt, PASSO_C * 6);
      const g2 = 600 * PASSO_C * PASSO_C;
      while (accC >= PASSO_C) {
        accC -= PASSO_C;
        for (const k of catene) {
          if (k.sveglia <= 0) continue;
          k.sveglia -= PASSO_C;
          const { n, x, y, xp, yp } = k;
          let moto = 0;
          for (let i = 1; i <= n; i++) {
            const vx = (x[i] - xp[i]) * 0.992, vy = (y[i] - yp[i]) * 0.992;
            xp[i] = x[i]; yp[i] = y[i];
            x[i] += vx; y[i] += vy + g2;
            moto += Math.abs(vx) + Math.abs(vy);
          }
          for (let it = 0; it < 6; it++) {
            for (let i = 1; i <= n; i++) {
              const dx = x[i] - x[i - 1], dy = y[i] - y[i - 1], d = Math.hypot(dx, dy) || 1e-3, e = (d - k.L) / d;
              if (i === 1) { x[i] -= dx * e; y[i] -= dy * e; }
              else { x[i] -= dx * e * 0.5; y[i] -= dy * e * 0.5; x[i - 1] += dx * e * 0.5; y[i - 1] += dy * e * 0.5; }
            }
          }
          if (moto < 0.002 * n && k.sveglia < 4) k.sveglia = 0;   // ferma: si smette di simulare
          catSporche = true;
        }
      }
    }
    // Disegno: solo se qualcosa si è mosso; si pulisce il riquadro occupato prima e si copiano i glifi
    function disegnaCatene() {
      if (!catSporche || !glifiC) return;
      catSporche = false;
      const a = glifiC, k0 = s * dprC, hw = a.cw / 2, hh = a.ch / 2;
      gC.clearRect(vecchioC[0], vecchioC[1], vecchioC[2] - vecchioC[0], vecchioC[3] - vecchioC[1]);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const k of catene) {
        const { n, x, y } = k;
        for (let i = 1; i <= n; i++) {
          let ch;
          if (i === n) ch = 2;
          else if (i % 2) ch = 1;
          else {
            const an = Math.atan2(x[i + 1] - x[i - 1], y[i + 1] - y[i - 1]);
            ch = Math.abs(an) < 0.4 ? 3 : Math.abs(an) > 1.2 ? 6 : an > 0 ? 5 : 4;
          }
          const X = Math.round(x[i] * k0 - hw), Y = Math.round(y[i] * k0 - hh);
          gC.drawImage(a.c, ch * a.cw, (i === k.rosso ? 3 : i % 3) * a.ch, a.cw, a.ch, X, Y, a.cw, a.ch);
          if (X < x0) x0 = X;
          if (Y < y0) y0 = Y;
          if (X + a.cw > x1) x1 = X + a.cw;
          if (Y + a.ch > y1) y1 = Y + a.ch;
        }
      }
      vecchioC[0] = x0 - 1; vecchioC[1] = y0 - 1; vecchioC[2] = x1 + 1; vecchioC[3] = y1 + 1;
    }

    // Il tipo sta nella scena? (i volanti hanno bisogno di spazio sopra il protagonista)
    const entra = (t) => (t.modo === 'muro' ? quotaMuro(t) > 0 : t.vola ? t.alto + t.basso <= TERRA - 16 : t.alto <= TERRA - 2);
    // Quota dei piedi del Braccio a muro: all'altezza del titolo, vicino alle catene, sopra la fascia del salto semplice
    let cimaCatene = 0;
    const quotaMuro = (t) => {
      const y = Math.max(t.alto + 2, Math.min(TERRA - 92, cimaCatene + 30 + t.alto * 0.5));
      return y <= TERRA - 92 ? y : 0;
    };
    const petto = () => TERRA - 30;
    // (SIT8) Arrivi: quanto deve stare fuori il pivot perché nessun pixel della clip d'arrivo sia in scena
    // (in orizzontale dal davanti del corpo; in verticale sotto il pivot, più il ballo e il dondolio); ingresso graduale
    const fuoriX = (T) => { const a = T.c.avanza; return Math.min(190, Math.max(T.hw + Math.abs(T.ox), a.r ? a.r.x1 - a.px : a.fw - a.px) + 8); };
    const fuoriY = (T) => { const a = T.c.avanza; return Math.min(140, Math.max(T.basso, a.r ? a.r.y1 - a.py : a.fh - a.py) + 14); };
    const ingresso = (e) => (e.nato == null ? 1 : Math.min(1, e.nato / 0.6));

    // Blocchi pieni ai lati, alla Mistral: [x dal bordo, largo, alto, rialzo, colore]
    const BLOCCHI_SX = [[0, 22, 18, 0, '#e3000f'], [22, 12, 8, 0, '#8c000a'], [0, 10, 12, 18, '#5c0008']];
    const BLOCCHI_DX = [[0, 16, 26, 0, '#8c000a'], [16, 14, 12, 0, '#e3000f'], [4, 12, 8, 26, '#e3000f']];
    function blocchi() {
      for (const [x, w, h, su, c] of BLOCCHI_SX) { g.fillStyle = c; g.fillRect(x, TERRA - su - h, w, h); }
      for (const [x, w, h, su, c] of BLOCCHI_DX) { g.fillStyle = c; g.fillRect(W - x - w, TERRA - su - h, w, h); }
    }

    function terra() {
      gm.fillStyle = '#0b0b0b';
      gm.fillRect(0, TERRA, W, H - TERRA);
      gm.fillStyle = 'rgba(255,255,255,.22)';
      gm.fillRect(0, TERRA, W, 1);
    }

    // ---- Stato del gioco ----
    // az: azione in corso (stacco, salto, doppio, schianto, pesante, atterra, colpo, carica, scatto) e da quanti ms (azT);
    // mossa: il colpo di spada in corso (COLPI); piano: cosa fare in aria; tm: tempo nella clip mostrata
    const eroe = {
      x: 0, y: 0, vx: 0, vy: 0, aterra: true, verso: 1, az: null, azT: 0, mossa: '', ancora: false, deciso: false,
      colpito: false, piano: null, doppioFatto: false, saltoVx: 0, t: 0, tm: 0, cl: respiro, f: 0, sparo, sparoT: 1e9,
      cad: 0, raffica: false, serie: 0, spinta: 0, cdSalto: 2, cdScatto: 3, cdMossa: 1, pensa: 0.6, ultima: '', meta: 0,
      scia: [], sciaT: 0, caricaMs: 0, dopoScatto: null, cdSchiva: 0,
      frase: null, ultimaFrase: '', cdFrase: 1.5, metaFrase: 0, sparaN: 0, ariaMedia: 0, scattoAriaFatto: false, posaT: 0, silenzio: 0, colpiFrase: 2, pulizia: false, px: 0, py: 0, hvx: 0, hvy: 0, lampo: 0, lx: 0, ly: 0, lux: 1, luy: 0,
    };
    // il mantello del gioco arriva coi suoi moduli; finché manca, la riserva
    const telo = mantelloScena(() => { if (FERMO && statico) statico(); });
    let statico = null;
    const P6 = new Float32Array(6), SP = new Float32Array(4);
    let nemici = [], colpi = [], part = [], numeri = [], bombe = [], botti = [], onde = [], lampi = [], raggi = [];
    let uccisi = 0, onda = 0.3, coda = [], scuoti = 0, scuotiF = 0;

    // Clip e fotogramma del momento; posizione del pivot; centro del corpo
    const clipDi = (e) => e.tipo.c[e.stato] || e.tipo.c.avanza;
    const fotoDi = (e, a) => fotogramma(a, a === e.tipo.c.avanza ? e.t : e.st);
    function yDi(e) {
      if (e.muro) return e.y;
      if (e.tipo.vola) return e.y + Math.round(Math.sin(e.t / 420 + e.fase) * 3);
      // i PNG fermi avanzano a scatti con un dondolio di 1 px; h = altezza del balzo
      return TERRA - Math.round(e.h || 0) - (e.tipo.c.avanza.n === 1 && !e.kb && e.stato === 'avanza' ? Math.floor(e.t / 220) % 2 : 0);
    }
    const centro = (e) => [e.x + e.tipo.ox * e.verso, yDi(e) + e.tipo.oy];
    const vivo = (e) => e.stato !== 'morte';

    // tipo: '' (a caso), 'aria' (un volante), 'sciame' (una farfallina dello sciame)
    function nuovo(lato, tipoOnda = '') {
      // i due Bracci non arrivano con le ondate: stanno fissi ai muri (creaBracci); le farfalline solo negli sciami
      const adatti = tipi.filter((t) => entra(t) && t.modo !== 'muro' && t.modo !== 'sciame');
      let T;
      if (tipoOnda === 'sciame') {
        T = tipi.find((t) => t.modo === 'sciame' && entra(t));
        if (!T) return;
      } else {
        if (!adatti.length) return;
        // volanti regolari ma non troppi in aria insieme (REGIA.volantiMax, sciami a parte)
        let inAria = 0;
        for (const e of nemici) if (e.tipo.vola && e.tipo.modo !== 'sciame' && vivo(e)) inAria++;
        const volanti = inAria < REGIA.volantiMax ? adatti.filter((t) => t.vola) : [], aterra = adatti.filter((t) => !t.vola);
        const scelta = volanti.length && (tipoOnda === 'aria' || !aterra.length || Math.random() < 0.25) ? volanti : aterra;
        T = scelta[Math.floor(Math.random() * scelta.length)];
      }
      const muro = T.modo === 'muro';
      // volanti nella fascia sopra il protagonista (si vedono e si colpiscono in diagonale); lo sciame più in alto
      const alto = (a, b) => Math.max(T.alto + 2, Math.min(TERRA - T.basso - 24, caso(TERRA - a, TERRA - b)));
      const q0 = muro ? quotaMuro(T) : T.modo === 'sciame' ? alto(150, 100) : T.vola ? alto(125, 62) : TERRA;
      const fx = fuoriX(T);   // (SIT8) nasce del tutto fuori dall'inquadratura (pixel veri della clip, non solo hw)
      nemici.push({
        tipo: T, hp: T.hp * 10, verso: -lato, stato: 'avanza', t: Math.random() * 1000, st: 0, nato: 0,
        x: muro ? (lato < 0 ? T.hw + 4 : W - T.hw - 4) : lato < 0 ? -fx : W + fx, y: q0, q0, fase: caso(0, 6.3),
        contatto: T.hw * 0.5 + caso(2, 6), flash: 0, kb: 0, acc: 0, tiro: muro ? 1.2 : caso(2, 5), lancia: false,
        att: '', durAtt: 0, colpiMs: null, sparati: 0, muro, slam: false,
        h: 0, vh: 0, balzo: caso(0.2, 1), vb: 1, ballo: 0, ballo0: 1, bx: 0, by0: 0,
      });
      // volanti e sciami: a volte entrano dall'alto, appena sotto il titolo, e ballano un poco (a otto, scendendo)
      // prima di attaccare; i compagni dello stesso sciame ballano sfasati, così si incrociano
      if (T.vola && !muro && Math.random() < REGIA.dallAlto) {
        const e = nemici[nemici.length - 1];
        e.bx = tipoOnda === 'sciame' && sciameX ? sciameX : caso(W * 0.15, W * 0.85);
        if (tipoOnda === 'sciame') sciameX = e.bx;
        e.x = e.bx; e.by0 = e.y = -fuoriY(T);   // (SIT8) parte sopra il bordo alto e scende ballando (prima: dentro, sotto il titolo)
        e.ballo = e.ballo0 = caso(REGIA.balloVolanti[0], REGIA.balloVolanti[1]);
        e.fase = tipoOnda === 'sciame' ? (sciameN++ % 2 ? Math.PI : 0) + caso(-0.3, 0.3) : caso(0, 6.3);
      }
    }
    let sciameX = 0, sciameN = 0;   // centro del ballo dello sciame che sta entrando
    // I due Bracci: innestati nel muro sinistro (dalla parte della S) e destro (della A), il braccio verso l'interno;
    // fissi e indistruttibili, fuori dal conto dei nemici; fanno solo i raggi della pista da ballo
    let bracciPosti = [];
    function creaBracci(T) {
      if (nemici.some((e) => e.muro)) return;
      bracciPosti.forEach((p, k) => {
        // (SIT8) entra dal suo muro: parte tutto fuori (x0) e scivola all'innesto in arrivoDur s, rallentando
        const v = k ? -1 : 1, fx = fuoriX(T) + 2;
        nemici.push({
          tipo: T, hp: 1, verso: v, stato: 'avanza', t: Math.random() * 1000, st: 0, x: p.x - v * fx, y: p.y, q0: p.y, fase: 0,
          contatto: 0, flash: 0, kb: 0, acc: 0, tiro: 0, lancia: false, att: '', durAtt: 0, colpiMs: null, sparati: 0,
          muro: true, slam: false, h: 0, vh: 0, balzo: 0, vb: 1, prossimoRaggio: 0,
          posto: k, fuori: fx, arrivo: 0, arrivoDur: caso(3, 3.8) + k * caso(0.4, 1.2),
        });
      });
    }
    // (SIT8) Braccio ancora in arrivo? (niente preavviso né raggio finché non è all'innesto)
    const inArrivo = (e) => e.muro && e.arrivoDur > 0 && e.arrivo < e.arrivoDur;
    const contaNemici = () => { let n = 0; for (const e of nemici) if (!e.muro) n++; return n; };

    // Ondata: un gruppo da un lato o da tutti e due, uno dopo l'altro
    // (spesso il primo è un volante; a volte arriva anche uno sciame di farfalline, in alto)
    function ondata() {
      // (SIT8) le prime due ondate più piccole e scaglionate: uno alla volta, non tutti insieme
      const prime = ondateFatte++ < 2;
      const quanti = Math.round(prime ? caso(3, 5) : caso(4, 8)), ambo = Math.random() < 0.45, lato = Math.random() < 0.5 ? -1 : 1;
      let quando = 0;
      for (let k = 0; k < quanti; k++) {
        coda.push({ lato: ambo && k % 2 ? -lato : lato, quando, tipo: k === 0 && Math.random() < 0.6 ? 'aria' : '' });
        quando += prime ? caso(0.7, 1.2) : caso(0.12, 0.35);
      }
      if (Math.random() < 0.4) {
        sciameX = 0;
        const ls = Math.random() < 0.5 ? -1 : 1, n = Math.round(caso(3, 5));
        for (let k = 0; k < n; k++) coda.push({ lato: ls, quando: quando + k * caso(0.1, 0.2), tipo: 'sciame' });
      }
    }
    let ondateFatte = 0;   // (SIT8)
    const massimo = () => (W < 240 ? 10 : W < 400 ? 13 : 16);

    // ---- Effetti ----
    function emetti(k, x, y, vx, vy, vita, c, d = 1, gr = 0, att = 0) {
      if (part.length >= PARTI) part.shift();
      part.push({ k, x, y, vx, vy, t: 0, vita, c, d, g: gr, att, rimb: 0 });
    }
    function scintille(x, y, dir, n, cols = COL_SCINT) {
      for (let i = 0; i < n; i++) {
        const a = (Math.random() - 0.5) * 2.2 + (dir < 0 ? Math.PI : 0), v = caso(80, 220);
        emetti(SCI, x, y, Math.cos(a) * v, Math.sin(a) * v - 30, caso(0.12, 0.26), cols[i % cols.length], 1, 500, 3);
      }
    }
    function schizzi(x, y, dir, n) {
      const cols = ['#e3000f', '#8a0009', '#b0101c'];
      for (let i = 0; i < n; i++) {
        emetti(PIX, x, y, dir * caso(30, 110) + caso(-20, 20), -caso(40, 120), caso(0.5, 0.9), cols[i % 3], Math.random() < 0.3 ? 2 : 1, 420);
      }
    }
    function polvere(x, y, n, dir = 0, col = '#8a8077') {
      for (let i = 0; i < n; i++) {
        const lato = dir || (i % 2 ? 1 : -1);
        emetti(POL, x + lato * caso(2, 8), y - 1 - caso(0, 3), lato * caso(25, 60), -caso(6, 20), caso(0.25, 0.5), col, 2 + (Math.random() * 2 | 0), 0, 4);
      }
    }
    function fumo(x, y, n, dir = 0) {
      const cols = ['#cfc6bb', '#b8aea3', '#9e958c'];
      for (let i = 0; i < n; i++) {
        emetti(FUM, x + caso(-2, 2), y + caso(-1.5, 1.5), dir * caso(10, 25) + caso(-6, 6), -caso(18, 40), caso(0.45, 0.8), cols[i % 3], 2 + (Math.random() * 2 | 0), 0, 2.5);
      }
    }
    function frantuma(e) {
      const [cx, cy] = centro(e), T = e.tipo;
      const tinte = ['#e3000f', '#8a0009', '#9a9a9a', '#5e5e5e', '#d8d8d8'];
      for (let k = 0; k < 14; k++) {
        emetti(PIX, cx + caso(-T.hw, T.hw), cy + caso(-T.hh, T.hh), caso(-50, 50), caso(-110, -20), caso(0.5, 1.1), tinte[k % tinte.length], 1, 320);
      }
    }
    function numero(x, y, v, col) {
      if (numeri.length >= 12) numeri.shift();
      numeri.push({ x: x + caso(-3, 3), y, vx: caso(-12, 12), vy: -caso(70, 85), t: 0, vita: 0.62, v: Math.max(0, Math.round(v)), col });
    }
    function scossa(f, durata) {
      if (scuoti <= 0 || f >= scuotiF) { scuotiF = f; scuoti = durata; }
    }
    // Scintille e polvere scritte nella clip del protagonista per quel fotogramma (feel.mjs: emettiEffettiClip)
    function effettiClip(a, f) {
      const lista = a.effetti && a.effetti[f];
      if (!lista) return;
      const dur = a.durate[f % a.durate.length] || 33;
      for (const e of lista) {
        if (!e || !e.c || e.fonte === 'lampo') continue;
        const x = eroe.x + eroe.verso * (e.c[0] - a.px), y = eroe.y + (e.c[1] - a.py), r = e.r ?? 1;
        if (e.tipo === 'scintilla') emetti(STE, x, y, 0, 0, Math.max(0.05, dur / 1000 * 1.5), rgbCss(e.colore), Math.max(1, Math.round(r)));
        else if (e.tipo === 'polvere' && e.fonte === 'fumo') fumo(x, y, 1, -eroe.verso * 0.4);
        else if (e.tipo === 'polvere') emetti(POL, x, y, 0, -4, 0.18 + r * 0.05, rgbCss(e.colore), Math.max(1, Math.round(r * 2)), 0, 2);
      }
    }

    function colpisci(e, x, y, dir, danno, spinta, col, fonte = 'spada', vx = 0, vy = 0) {
      const T = e.tipo;
      if (e.muro) {   // i Bracci non cadono: solo un lampo (e la clip colpito, se non sta sparando)
        e.flash = 60;
        if (e.stato === 'avanza' && T.c.colpito) { e.stato = 'colpito'; e.st = 0; }
        lampi.push({ x, y, vita: 0.06, r: 10 });
        emetti(STE, x, y, 0, 0, 0.08, '#ffffff', 2);
        return;
      }
      e.hp -= danno;
      e.flash = 60;
      e.lancia = false;
      lampi.push({ x, y, vita: 0.08, r: 16 });
      scintille(x, y, dir, 4);
      const [cx, cy] = centro(e);
      if (lett) {   // sangue in lettere, come nel gioco (al posto degli schizzi a pixel)
        if (fonte === 'proiettile') {
          // lo spruzzo lo scala il motore secondo l'altezza del bersaglio (sangue.pistola.taglia, H 48) e va lungo il colpo
          lett.K.S.notaSangue(lett.asc, { tipo: 'impatto', x, y, dir, bx: cx, by: cy, fonte, uccide: e.hp <= 0, ux: vx || dir, uy: vy, dy: 0 },
            { x: cx, w: T.hw * 2, h: T.alt || T.hh * 2 }, 48);
          lett.C.pistolaNemico(x, y, dir);
        } else {
          lett.K.S.notaSangue(lett.asc, { tipo: 'impatto', x, y, dir, bx: cx, by: cy, fonte, uccide: e.hp <= 0, critico: danno >= 26, finale: danno >= 26, dy: 0 },
            { x: cx, w: T.hw * 2, h: T.hh * 2 }, 48);
        }
      } else schizzi(x, y, dir, 4);
      numero(cx, cy - T.hh - 3, danno, col || '#fff4d0');
      if (e.hp <= 0) {
        e.stato = 'morte'; e.st = 0; e.kb = 0;
        uccisi = Math.min(999, uccisi + 1);
        if (contatore) contatore.textContent = 'UCCISI ' + String(uccisi).padStart(3, '0');
        if (!T.c.morte) { frantuma(e); e.via = true; }
      } else {
        e.stato = 'colpito'; e.st = 0;
        e.kb = dir * spinta;
      }
    }

    // Colpo dalla bocca della canna: posa orizzontale, diagonale o in alto a seconda del bersaglio
    function spara(bers, corre) {
      const aria = !eroe.aterra;
      let posa = 0, tx = 0, ty = 0;
      if (bers) {
        [tx, ty] = centro(bers);
        const ax = Math.abs(tx - eroe.x), ay = eroe.y - 33 - ty;
        if (!corre) posa = ay > ax * 2.2 ? 2 : ay > ax * 0.45 ? 1 : 0;
      }
      let a = corre ? eroe.cl : clip[POSE_SPARO[aria ? 1 : 0][posa]];
      if (!a && posa) { posa = 0; a = clip[POSE_SPARO[aria ? 1 : 0][0]]; }
      const posaNuova = !corre && !!a;   // senza la posa giusta (non ancora caricata) resta quella che c'è
      if (!a) a = aria ? eroe.cl : sparo;
      // bocca, direzione della canna ed espulsione dal fotogramma che spara
      const fb = corre ? eroe.f : Math.min(1, a.n - 1);
      const b = (a.bocca && (a.bocca[fb] || a.bocca[0])) || null;
      const v = eroe.verso;
      const bx = b ? eroe.x + v * (b[0] - a.px) : eroe.x + v * BOCCA_X, by = b ? eroe.y + (b[1] - a.py) : eroe.y - BOCCA_Y;
      let ux = b ? b[2] * v : v, uy = b ? b[3] : 0;
      if (bers) {
        // verso il bersaglio, ma al più 0,35 rad dalla canna
        const ang0 = Math.atan2(uy, ux), d = Math.atan2(ty - by, tx - bx) - ang0;
        const dd = Math.max(-0.35, Math.min(0.35, Math.atan2(Math.sin(d), Math.cos(d))));
        ux = Math.cos(ang0 + dd); uy = Math.sin(ang0 + dd);
      }
      colpi.push({ x: bx, y: by, x0: bx, y0: by, vx: ux * V_COLPO, vy: uy * V_COLPO });
      fumo(bx, by, 1, ux * 0.5);
      eroe.lampo = 0.06; eroe.lx = bx; eroe.ly = by; eroe.lux = ux; eroe.luy = uy;
      if (posaNuova || (!corre && !aria)) { eroe.sparo = a; eroe.sparoT = 0; }
      // bossolo dall'espulsione: vola indietro, rimbalza una volta
      const ex = b ? eroe.x + v * (b[4] - a.px) : bx - v * 8, ey = b ? eroe.y + (b[5] - a.py) : by;
      emetti(BOS, ex, ey, -v * caso(30, 60), -caso(80, 120), caso(0.9, 1.3), '#d6a23c', 1, 500);
      if (lett) lett.C.pistolaBocca(bx, by, ux, uy);
    }

    // Bersaglio: il nemico vivo più vicino al petto, a schermo (dal lato `verso` se dato)
    function bersaglio(verso) {
      let best = null, min = Infinity;
      const py = eroe.y - 30;
      for (const e of nemici) {
        if (!vivo(e) || e.muro || e.x < 2 || e.x > W - 2) continue;
        const [cx, cy] = centro(e), dx = cx - eroe.x, dy = cy - py;
        if (verso && dx * verso < 0) continue;
        if (verso && Math.abs(dy) > Math.abs(dx) * 2.6 + 8) continue;
        const d = dx * dx + dy * dy;
        if (d < min) { min = d; best = e; }
      }
      return best;
    }

    // ---- Mosse del protagonista ----
    // Colpi di spada (a terra e in aria): portata avanti/sopra/sotto/dietro, danno, spinta; segue = combo;
    // aria = in volo; avanza = scivolata in avanti fino al colpo (px/s); parata = respinge invece di colpire
    const COLPI = {
      fendente_1: { raggio: 32, danno: 16, spinta: 70, segue: 'fendente_2', col: '#ffd9a0' },
      fendente_2: { raggio: 32, danno: 16, spinta: 70, segue: 'fendente_3', col: '#ffd9a0' },
      fendente_3: { raggio: 38, danno: 28, spinta: 150, col: '#ffcf5a', scossa: 1 },
      fendente_alto: { raggio: 30, su: 80, danno: 18, spinta: 60, col: '#ffd9a0' },
      montante: { raggio: 28, su: 84, danno: 20, spinta: 40, col: '#ffd9a0' },
      spazzata: { raggio: 44, su: 28, dietro: 14, danno: 16, spinta: 170, col: '#ffd9a0' },
      affondo_scatto: { raggio: 40, danno: 22, spinta: 130, avanza: 230, col: '#ffcf5a' },
      caricato: { raggio: 46, su: 62, danno: 34, spinta: 210, col: '#ffcf5a', scossa: 2 },
      aria_1: { raggio: 30, su: 40, giu: 26, danno: 14, spinta: 60, segue: 'aria_2', aria: true, col: '#ffd9a0' },
      aria_2: { raggio: 30, su: 40, giu: 26, danno: 14, spinta: 90, aria: true, col: '#ffd9a0' },
      parry: { parata: true },
    };
    // Raffica della pistola (mosse.json → armi.pistola.raffica): sei colpi 167 · 100 · 100 · 100 · 100 ms, poi 625 ms
    const RAFFICA = [0.167, 0.1, 0.1, 0.1, 0.1, 0.625];
    const inAria = () => eroe.az === 'salto' || eroe.az === 'doppio';
    function inizia(az) { eroe.az = az; eroe.azT = 0; eroe.colpito = false; }
    const libero = () => eroe.aterra && (!eroe.az || eroe.az === 'atterra');
    // piano: cosa fare in aria (schianto, doppio, aria = spadate)
    function salta(vx, piano) {
      if (!libero() || !V_SALTO || !clip.salto_sale) return;
      inizia('stacco');
      eroe.saltoVx = vx; eroe.piano = piano || null; eroe.doppioFatto = false;
      eroe.cdSalto = caso(3, 5);
    }
    function doppio() {
      if (!inAria() || eroe.doppioFatto || !V_SALTO) return;
      eroe.doppioFatto = true;
      inizia(clip.salto_doppio ? 'doppio' : 'salto');
      eroe.vy = -V_SALTO * 0.85;
      for (let i = 0; i < 4; i++) emetti(POL, eroe.x + caso(-5, 5), eroe.y, caso(-30, 30), caso(10, 30), 0.3, '#b0a496', 2, 0, 4);
      if (telo.vero) telo.vero.spingi(0, 3);
    }
    function colpo(nome) {
      const C = COLPI[nome];
      if (!C || !clip[nome]) return false;
      inizia('colpo');
      eroe.mossa = nome; eroe.ancora = false; eroe.deciso = false;
      if (C.aria) { eroe.vy = Math.min(eroe.vy, -40); eroe.vx *= 0.4; }   // un attimo sospeso nel colpo
      return true;
    }
    function carica() {
      if (!libero() || !clip.carica || !clip.caricato) return;
      inizia('carica');
      eroe.caricaMs = caso(550, 900); eroe.sciaT = 0;
    }
    function scatta(dir, aria = false) {
      if (!clip.scatto) return false;
      if (aria ? !inAria() || eroe.scattoAriaFatto : !libero()) return false;
      eroe.verso = dir;
      if (aria) { eroe.scattoAriaFatto = true; eroe.vy = 0; }   // scatto in aria: sospeso, poi ricade
      inizia('scatto');
      eroe.scia = []; eroe.sciaT = 0;
      eroe.cdScatto = caso(2, 3.5);
      if (telo.vero) telo.vero.spingi(-dir * 7, 0);   // il telo si tende all'opposto dello scatto (prova.mjs)
      return true;
    }
    function schianta() {
      if (!inAria() || !clip.aria_schianto) return;
      inizia('schianto');
      eroe.vx = 0; eroe.vy = 0; eroe.piano = null;
    }
    // Chi sta nel riquadro del colpo C davanti al protagonista
    function nelColpo(e, C) {
      const [cx, cy] = centro(e), T = e.tipo, dx = (cx - eroe.x) * eroe.verso;
      return dx >= -(C.dietro ?? 6) - T.hw && dx <= C.raggio + T.hw && cy >= eroe.y - (C.su ?? 54) - T.hh && cy <= eroe.y + (C.giu ?? 2) + T.hh;
    }
    function fendi(C) {
      let n = 0;
      for (const e of nemici) {
        if (!vivo(e) || e.via || e.muro || !nelColpo(e, C)) continue;
        const [cx, cy] = centro(e), dir = (cx - eroe.x) * eroe.verso < 0 ? -eroe.verso : eroe.verso;
        colpisci(e, cx - dir * Math.min(e.tipo.hw, 4), cy, dir, Math.round(C.danno * caso(0.9, 1.1)), C.spinta, C.col);
        n++;
      }
      if (n) scossa(C.scossa || 1, C.scossa ? 0.14 : 0.08);
    }
    const aPortata = (C) => nemici.some((e) => vivo(e) && !e.via && !e.muro && nelColpo(e, C));
    // Parata: chi attacca davanti viene respinto e stordito, i proiettili vicini scoppiano
    function para() {
      let n = 0;
      for (const e of nemici) {
        if (!vivo(e) || e.via || e.muro) continue;
        const dx = (e.x - eroe.x) * eroe.verso;
        if (dx < -4 || dx > e.contatto + 22) continue;
        const [cx, cy] = centro(e);
        e.stato = 'colpito'; e.st = 0; e.lancia = false; e.kb = eroe.verso * 220; e.flash = 60;
        emetti(STE, cx - eroe.verso * 4, cy, 0, 0, 0.12, '#ffffff', 4);
        scintille(cx - eroe.verso * 4, cy, eroe.verso, 5, ['#ffffff', '#cfe8ff', '#fff1b8', '#9dbccd']);
        n++;
      }
      for (const b of bombe) {
        if (b.via || Math.abs(b.x - eroe.x) > 28 || Math.abs(b.y - (eroe.y - 30)) > 34) continue;
        b.via = true; esplodi(b.x, b.y, b); n++;
      }
      lampi.push({ x: eroe.x + eroe.verso * 10, y: eroe.y - 30, vita: 0.1, r: 22 });
      if (n) scossa(1, 0.08);
    }
    // Atterraggio dello schianto: onda a terra, scossa, danno a chi sta intorno
    // Atterraggio dello schianto: esplosione vera a terra (come lo schianto del gioco): anello d'urto, cupola di
    // fuoco, colonna di polvere e schegge, lampo largo, scossa decisa, nemici sbalzati in arco, catene scosse
    function atterraPesante() {
      inizia('pesante');
      eroe.vx = 0;
      const x = eroe.x, y = TERRA - 1;
      onde.push({ x, t: 0 });
      botti.push({ x, y, t: 0, grande: true });
      scossa(3, 0.3);
      lampi.push({ x, y: y - 10, vita: 0.22, r: 48 });
      if (lett) lett.C.schianto(x, y, eroe.verso, 64, 0.4, 1.6, 2);   // onda, detriti e polvere in lettere, nei due versi
      polvere(x, TERRA, 10, 0, '#b0a496');
      for (let i = 0; i < 16; i++) {      // colonna di polvere che sale e si allarga
        emetti(POL, x + caso(-8, 8), y - caso(0, 4), caso(-45, 45), -caso(50, 170), caso(0.55, 0.95), i % 3 ? '#a89a8a' : '#d6c8b4', 3 + (i % 2), 90, 2.4);
      }
      for (let i = 0; i < 12; i++) {      // schegge in arco
        emetti(PIX, x + caso(-6, 6), y - 2, caso(-150, 150), -caso(100, 230), caso(0.6, 1.1), i % 3 ? '#4a3a30' : '#8a6a4a', 1 + (i % 2), 520);
      }
      for (let i = 0; i < 12; i++) {      // scintille di fuoco
        const a = -Math.PI / 2 + caso(-1.4, 1.4), v = caso(90, 220);
        emetti(SCI, x, y - 3, Math.cos(a) * v, Math.sin(a) * v, caso(0.18, 0.34), COL_FUOCO[i % 4], 1, 420, 2);
      }
      for (const e of nemici) {
        if (!vivo(e) || e.via || e.muro) continue;
        const [cx, cy] = centro(e), dx = cx - x;
        if (Math.abs(dx) > 56 + e.tipo.hw || cy < TERRA - 64) continue;
        const dir = dx < 0 ? -1 : 1;
        colpisci(e, cx, cy, dir, Math.round(caso(24, 32)), 220, '#ffcf5a');
        e.kb = dir * caso(170, 230);                         // sbalzati via in arco (anche i morti)
        if (!e.tipo.vola) e.vh = -caso(110, 170);
      }
    }

    // ---- Frasi del pilota: piccole coreografie concatenate (REGIA.frasi), una alla volta, poi un attimo di posa ----
    // Ogni passo: [nome, argomento, in aria]. Un passo aspetta di poter partire (es. «doppio» vicino all'apice), parte,
    // e finisce quando la sua azione è finita; se non riesce entro REGIA.passoMax s si salta.
    function bersaglioX(dove) {
      let gx = 0, gn = 0, vx = null, dv = 1e9;
      for (const e of nemici) {
        if (!vivo(e) || e.muro) continue;
        if (e.tipo.vola) { const d = Math.abs(e.x - eroe.x); if (d < dv) { dv = d; vx = e.x; } }
        else if (Math.abs(e.x - eroe.x) < W * 0.5) { gx += e.x; gn++; }
      }
      const g = gn ? gx / gn : eroe.x + eroe.verso * 60, lim = (x) => Math.max(16, Math.min(W - 16, x));
      switch (dove) {
        case 'gruppo': return lim(g - Math.sign(g - eroe.x || 1) * 34);   // si ferma prima del gruppo
        case 'oltre': return lim(g + Math.sign(g - eroe.x || 1) * 60);
        case 'volante': return lim(vx ?? eroe.x);
        case 'lato': return eroe.x < W / 2 ? lim(W * 0.82) : lim(W * 0.18);
        case 'lontano': case 'via': return g < W / 2 ? lim(W * 0.88) : lim(W * 0.12);
        default: return lim(eroe.x + eroe.verso * 60);
      }
    }
    const versoA = (x) => (x < eroe.x ? -1 : 1);
    function iniziaPasso(p) {
      const [k, arg, aria] = p;
      switch (k) {
        case 'corri':
          if (!libero()) return false;
          eroe.metaFrase = bersaglioX(arg); return true;
        case 'scatto': {
          const dir = arg === 'indietro' ? -eroe.verso : arg === 'avanti' ? eroe.verso : versoA(bersaglioX(arg === 'gruppo' ? 'oltre' : arg));
          return scatta(dir, !!aria && !eroe.aterra);
        }
        case 'salto': {
          if (!libero()) return false;
          const dx = arg === 'indietro' ? -eroe.verso * 80 : arg === 'su' ? eroe.verso * 15 : arg === 'gruppo' ? (bersaglioX('oltre') - eroe.x) / 0.9 : eroe.verso * 70;
          if (arg !== 'indietro') eroe.verso = dx < 0 ? -1 : 1;
          salta(Math.max(-140, Math.min(140, dx)), null);
          return eroe.az === 'stacco';
        }
        case 'doppio':
          if (!inAria() || eroe.vy < -40 || eroe.doppioFatto) return false;
          doppio(); return true;
        case 'spara': eroe.sparaN = arg || 3; return true;
        case 'aria':
          if (!inAria() || !clip.aria_1) return false;
          return colpo('aria_1');
        case 'schianto':
          if (!inAria() || eroe.vy < -40) return false;
          schianta(); return eroe.az === 'schianto';
        case 'combo': {
          if (!libero()) return false;
          eroe.verso = versoA(bersaglioX('gruppo'));
          return colpo('fendente_1');
        }
        case 'raffica':
          if (!libero()) return false;
          eroe.raffica = true; eroe.serie = 0; return true;
        case 'affondo':
          if (!libero() || !clip.affondo_scatto) return false;
          eroe.dopoScatto = 'affondo_scatto';
          return scatta(versoA(bersaglioX('gruppo')), false);
        case 'caricato':
          if (!libero()) return false;
          carica(); return eroe.az === 'carica';
        case 'atterra': return true;
        case 'posa': return true;
      }
      return true;
    }
    function passoFinito(p, F) {
      switch (p[0]) {
        case 'corri': return Math.abs(eroe.metaFrase - eroe.x) < 6 || !libero();
        case 'scatto': return eroe.az !== 'scatto';
        case 'salto': return inAria();
        case 'doppio': return true;
        case 'spara': return eroe.sparaN <= 0;
        case 'aria': case 'combo': case 'affondo': return eroe.az !== 'colpo' && eroe.az !== 'scatto';
        case 'schianto': return eroe.aterra && eroe.az !== 'pesante' && eroe.az !== 'schianto';
        case 'raffica': return !eroe.raffica;
        case 'caricato': return eroe.az !== 'carica' && eroe.az !== 'colpo';
        case 'atterra': return eroe.aterra && (!eroe.az || eroe.az === 'atterra');
        case 'posa': return F.t >= (p[1] || 0.3);
      }
      return true;
    }
    function passoFrase(dt) {
      const F = eroe.frase;
      if (!F) return;
      const p = F.passi[F.i];
      if (!p) {   // fine della frase: un attimo di posa (mantello che ricade), poi la calma fino alla prossima
        eroe.frase = null; eroe.sparaN = 0;
        eroe.posaT = Math.max(eroe.posaT, caso(REGIA.frasePausa[0], REGIA.frasePausa[1]));
        eroe.cdFrase = caso(REGIA.fraseOgni[0], REGIA.fraseOgni[1]);
        return;
      }
      F.t += dt;
      if (F.t > REGIA.passoMax) { F.i++; F.t = 0; F.via = false; return; }   // non riuscito: si passa oltre
      if (!F.via) { if (iniziaPasso(p)) { F.via = true; F.t = 0; } return; }
      if (passoFinito(p, F)) { F.i++; F.t = 0; F.via = false; }
    }
    // Sceglie la frase secondo la scena: folla → pulizia; volanti → caccia; raggio → schiva; poca aria → più salti
    function avviaFrase(folla, volanti) {
      const P = REGIA.pesiFrasi, L = [];
      const aria = eroe.ariaMedia < REGIA.ariaQuota ? REGIA.ariaSpinta : 1;
      for (const [nome, passi] of Object.entries(REGIA.frasi)) {
        if (nome === eroe.ultimaFrase) continue;
        let w = P[nome] ?? 1;
        if (folla && P.folla[nome]) w *= P.folla[nome];
        if (volanti && P.volanti[nome]) w *= P.volanti[nome];
        if (raggi.length && P.raggio[nome]) w *= P.raggio[nome];
        if (passi.some((q) => q[0] === 'salto')) w *= aria;
        if (w > 0) L.push([nome, w]);
      }
      if (!L.length) return false;
      let r = Math.random() * L.reduce((s, q) => s + q[1], 0), nome = L[0][0];
      for (const q of L) { r -= q[1]; if (r <= 0) { nome = q[0]; break; } }
      eroe.frase = { nome, passi: REGIA.frasi[nome], i: 0, t: 0, via: false };
      eroe.ultimaFrase = nome;
      if (folla) eroe.pulizia = true;
      return true;
    }

    // Pilota automatico: ogni 0,3–0,6 s guarda la scena. Chi arriva addosso ha una risposta immediata (parata, combo);
    // altrimenti, finita la calma fra due frasi, parte la frase scelta secondo la scena (con la folla: la pulizia, poi
    // un respiro e l'ondata dopo più tardi). Mai la stessa frase due volte di fila.
    function scegli() {
      if (eroe.cdMossa > 0 || eroe.posaT > 0) return;
      let sx = 0, dx = 0, folla = 0, vivi = 0, vicino = null, dv = 1e9, sopra = null, attacca = null;
      for (const e of nemici) {
        if (!vivo(e) || e.muro || e.x < 4 || e.x > W - 4) continue;
        vivi++;
        const d = e.x - eroe.x, ad = Math.abs(d), cy = centro(e)[1];
        if (ad < 30) { if (d < 0) sx++; else dx++; }
        if (ad < REGIA.gruppoPx) folla++;
        if (ad < e.contatto + 14 && cy > eroe.y - 56 && ad < dv) { dv = ad; vicino = e; }
        if (ad < e.contatto + 10 && e.stato === 'attacco' && !e.lancia) attacca = e;
        if (e.tipo.vola && ad < 34 && cy < eroe.y - 40) sopra = e;
      }
      const pulizia = folla >= REGIA.gruppo || (sx && dx && sx + dx >= 3) || vivi >= massimo() * REGIA.tetto;
      const guarda = (e) => { if (e) eroe.verso = e.x < eroe.x ? -1 : 1; };
      // risposte immediate a chi arriva addosso; altrimenti la prossima frase
      if (attacca && clip.parry && eroe.ultima !== 'parata' && Math.random() < 0.5) {
        eroe.ultima = 'parata'; eroe.cdMossa = caso(0.4, 0.8); guarda(attacca); colpo('parry'); return;
      }
      if (vicino && clip.fendente_1 && !pulizia && eroe.ultima !== 'combo' && Math.random() < 0.35) {
        eroe.ultima = 'combo'; eroe.cdMossa = caso(0.4, 0.8); guarda(vicino); colpo('fendente_1'); return;
      }
      if (eroe.cdFrase > 0 && !pulizia) return;
      let volanti = false;
      for (const e of nemici) if (e.tipo.vola && vivo(e) && !e.muro && Math.abs(e.x - eroe.x) < W * 0.5) { volanti = true; break; }
      if (avviaFrase(pulizia, volanti || !!sopra)) eroe.ultima = '';
    }
    function passo(dt, ora) {
      const ms = dt * 1000;
      if (lett) lett.K.T.nuovoFotogramma();   // tetto delle lettere del fotogramma
      eroe.cad -= dt; eroe.cdSalto -= dt; eroe.cdScatto -= dt; eroe.cdMossa -= dt;
      eroe.sparoT += ms; eroe.lampo -= dt;
      let mossa = 0, fuoco = false, mira = null;
      // il pilota gioca sempre (la scena non si comanda)
      {
        // fine di una pulizia: un respiro (posa, mantello che ricade) e l'ondata dopo arriva più tardi
        if (eroe.pulizia && !eroe.az && eroe.aterra) {
          eroe.pulizia = false;
          eroe.posaT = caso(REGIA.respiro[0], REGIA.respiro[1]);
          onda += REGIA.ritardoOndata;
          for (const q of coda) q.quando += REGIA.ritardoOndata;
        }
        eroe.posaT -= dt; eroe.silenzio -= dt; eroe.cdSchiva -= dt;
        // un raggio sta per prenderlo: lo schiva con lo scatto (o col salto), lontano dal punto in cui arriva
        if (raggi.length && eroe.cdSchiva <= 0 && eroe.aterra && (!eroe.az || eroe.az === 'atterra')) {
          const r = raggioVicino();
          if (r) {
            eroe.cdSchiva = 0.8;
            const ex = r.x + Math.cos(r.ang) * r.len;
            let dir = eroe.x >= ex ? 1 : -1;
            if ((dir > 0 && eroe.x > W - 50) || (dir < 0 && eroe.x < 50)) dir = -dir;
            if (clip.scatto) scatta(dir); else salta(dir * 60, null);
          }
        }
        eroe.cdFrase -= dt;
        eroe.ariaMedia += ((eroe.aterra ? 0 : 1) - eroe.ariaMedia) * Math.min(1, dt / 8);   // quota di tempo in aria (≈ 8 s)
        passoFrase(dt);
        if (!eroe.frase && !eroe.az && eroe.aterra && !eroe.raffica) {
          eroe.pensa -= dt;
          if (eroe.pensa <= 0) { eroe.pensa = caso(0.3, 0.6); scegli(); }
        }
        if (inAria()) {
          if (eroe.piano === 'schianto' && eroe.vy > -30) schianta();
          else if (eroe.piano === 'doppio' && eroe.vy > -40 && !eroe.doppioFatto) doppio();
          else if (eroe.piano === 'aria' && eroe.vy > -90 && clip.aria_1) { eroe.piano = null; colpo('aria_1'); }
        }
        if (eroe.posaT > 0 && !eroe.az) {
          // respiro dopo la pulizia: fermo, niente colpi
        } else if (!eroe.az || inAria()) {
          mira = bersaglio(0);
          // la pistola è per i lontani e i volanti, a raffiche brevi intervallate; da vicino tocca alla spada
          const dm = mira ? Math.abs(mira.x - eroe.x) : 1e9;
          const lontano = mira && dm < W * 0.48 && (mira.tipo.vola || dm > REGIA.vicinoPx);
          const passoF = eroe.frase && eroe.frase.via ? eroe.frase.passi[eroe.frase.i] : null;
          if (eroe.raffica || eroe.sparaN > 0) {
            if (mira) eroe.verso = mira.x < eroe.x ? -1 : 1;
            fuoco = true;
          } else if (passoF && passoF[0] === 'corri' && !eroe.az) {
            // la frase corre verso il suo punto (tutta la larghezza della scena)
            mira = null;
            mossa = eroe.metaFrase > eroe.x ? 1 : -1;
            eroe.verso = mossa;
          } else if (eroe.frase) {
            mira = null;   // dentro una frase si spara solo quando la frase lo dice
          } else if (lontano && eroe.silenzio <= 0) {
            eroe.verso = mira.x < eroe.x ? -1 : 1;
            fuoco = true;
          } else {
            mira = null;
            if (!eroe.az) {
              if (Math.abs(eroe.meta - eroe.x) < 2) eroe.meta = Math.round(caso(W * 0.25, W * 0.75));
              mossa = eroe.meta > eroe.x ? 1 : -1;
              eroe.verso = mossa;
            }
          }
        }
      }

      // Azione in corso
      eroe.azT += ms;
      switch (eroe.az) {
        case 'stacco':
          if (eroe.azT >= STACCO_MS) {
            inizia('salto');
            eroe.aterra = false; eroe.vy = -V_SALTO; eroe.vx = eroe.saltoVx;
            polvere(eroe.x, TERRA, 4, 0, '#b0a496');
          }
          break;
        case 'doppio':
          if (eroe.azT >= clip.salto_doppio.tot) eroe.az = 'salto';
          break;
        case 'colpo': {
          const nome = eroe.mossa, C = COLPI[nome], a = clip[nome], f = fotogramma(a, eroe.azT);
          if (C.parata) {
            if (!eroe.colpito && eroe.azT >= 60) { eroe.colpito = true; para(); }
          } else {
            const fc = a.colpi && a.colpi.length ? a.colpi[0] : Math.floor(a.n * 0.4);
            if (!eroe.colpito && f >= fc) {
              eroe.colpito = true;
              fendi(C);
              if (nome === 'caricato') {   // rilascio: lampo largo, anello di fuoco, scossa, catene scosse
                const bx = eroe.x + eroe.verso * 22, by = eroe.y - 30;
                lampi.push({ x: bx, y: by, vita: 0.2, r: 42 });
                botti.push({ x: bx, y: by + 8, t: 0 });
                emetti(STE, bx, by, 0, 0, 0.16, '#ffffff', 6);
                scintille(bx, by, eroe.verso, 12, COL_FUOCO);
                scossa(2, 0.18);
              }
            }
            if (!C.aria) eroe.vx = f < fc ? eroe.verso * (C.avanza || 28) : 0;
            // combo: il pilota decide una volta sola se legare il colpo dopo
            const dopo = C.segue && clip[C.segue];
            if (dopo && eroe.azT >= a.tot * 0.8 && (!C.aria || !eroe.aterra)) {
              if (!eroe.deciso) {
                eroe.deciso = true;
                eroe.ancora = aPortata(COLPI[C.segue]) && Math.random() < (nome === 'fendente_2' ? 0.6 : 0.9);
              }
              if (eroe.ancora) { colpo(C.segue); break; }
            }
          }
          if (eroe.azT >= a.tot) {
            eroe.az = C.aria && !eroe.aterra ? 'salto' : null;
            if (!C.aria) eroe.vx = 0;
          }
          break;
        }
        case 'carica': {
          // la lama si carica: scintille e luce che cresce; si libera dopo un poco
          const ini = clip.carica_inizio ? clip.carica_inizio.tot : 150;
          eroe.sciaT -= dt;
          if (eroe.azT > ini && eroe.sciaT <= 0) {
            eroe.sciaT = 0.06;
            emetti(STE, eroe.x + eroe.verso * caso(4, 16), eroe.y - caso(22, 42), 0, 0, 0.1, COL_FUOCO[(Math.random() * 4) | 0], 1 + ((Math.random() * 2) | 0));
          }
          if (eroe.azT >= ini + eroe.caricaMs) colpo('caricato');
          break;
        }
        case 'scatto': {
          const a = clip.scatto;
          eroe.vx = eroe.verso * V_SCATTO;
          eroe.sciaT -= dt;
          if (eroe.sciaT <= 0) {
            eroe.sciaT = 0.035;
            if (eroe.scia.length < 6) eroe.scia.push({ x: eroe.x, y: eroe.y, f: eroe.f, v: eroe.verso, t: 0 });
            // striscia di polvere sotto lo scatto (a terra)
            if (eroe.aterra) emetti(POL, eroe.x - eroe.verso * caso(2, 8), TERRA - 1, -eroe.verso * caso(20, 50), -caso(4, 14), caso(0.3, 0.5), '#a89a8a', 2 + (Math.random() * 2 | 0), 0, 3);
          }
          if (telo.vero) telo.vero.spingi(-eroe.verso * 0.4, 0);   // mantello teso all'indietro per tutto lo scatto
          if (eroe.azT >= a.tot) {
            eroe.az = eroe.aterra ? null : 'salto'; eroe.vx = eroe.aterra ? 0 : eroe.verso * 40;
            if (eroe.dopoScatto && eroe.aterra) { const k = eroe.dopoScatto; eroe.dopoScatto = null; colpo(k); }
          }
          break;
        }
        case 'schianto':
          eroe.vy = eroe.azT < 90 ? 0 : V_SCHIANTO;   // un attimo sospeso, poi giù
          break;
        case 'pesante':
          if (eroe.azT >= Math.min(460, clip.schianto_atterra ? clip.schianto_atterra.tot : 300)) eroe.az = null;
          break;
        case 'atterra':
          if (eroe.azT >= 220) eroe.az = null;
          break;
      }

      // Protagonista: a terra corre, in aria cade; le esplosioni lo spingono
      eroe.px = eroe.x; eroe.py = eroe.y;
      if (eroe.aterra) {
        const v = (!eroe.az ? mossa * V_CORSA : 0) + (eroe.az === 'colpo' || eroe.az === 'scatto' ? eroe.vx : 0);
        eroe.x += (v + eroe.spinta) * dt;
        eroe.y = TERRA;
      } else {
        if (eroe.az !== 'schianto' && eroe.az !== 'scatto') eroe.vy += G_EROE * dt;
        eroe.x += (eroe.vx + eroe.spinta) * dt;
        eroe.y += eroe.vy * dt;
        if (eroe.y >= TERRA) {
          eroe.y = TERRA; eroe.aterra = true; eroe.vy = 0; eroe.vx = 0; eroe.sparoT = 1e9; eroe.scattoAriaFatto = false;
          if (eroe.az === 'schianto') atterraPesante(); else inizia('atterra');
          eroe.piano = null;
          if (telo.vero) telo.vero.evento('atterraggio');
        }
      }
      eroe.x = Math.max(10, Math.min(W - 10, eroe.x));
      toccaCatene();
      passoCatene(dt);
      eroe.spinta *= Math.pow(0.03, dt);
      if (Math.abs(eroe.spinta) < 2) eroe.spinta = 0;
      if (dt > 0) {
        const k = Math.min(1, dt * 12);
        eroe.hvx += ((eroe.x - eroe.px) / dt - eroe.hvx) * k;
        eroe.hvy += ((eroe.y - eroe.py) / dt - eroe.hvy) * k;
      }

      // Sparo (a terra da fermo o correndo, oppure in aria)
      if (fuoco && eroe.cad <= 0 && (!eroe.az || inAria())) {
        spara(mira, !!mossa && eroe.aterra && !eroe.az);
        // raffica (una mossa del pilota): sei colpi a ritmo di gioco, poi la ricarica; colpi di una frase; raffiche brevi
        if (eroe.sparaN > 0) {
          eroe.sparaN--;
          eroe.cad = 0.14;
          if (telo.vero) telo.vero.evento('sparo');
        } else if (eroe.raffica) {
          const k = Math.min(5, eroe.serie++);
          eroe.cad = RAFFICA[k];
          if (k >= 5) { eroe.serie = 0; eroe.raffica = false; }
          if (telo.vero) telo.vero.evento('raffica_colpo');
        } else {
          // colpi di una raffica breve, poi silenzio
          eroe.cad = REGIA.cadenza;
          if (--eroe.colpiFrase <= 0) {
            eroe.colpiFrase = Math.round(caso(REGIA.raffica[0], REGIA.raffica[1]));
            eroe.silenzio = caso(REGIA.pausaRaffica[0], REGIA.pausaRaffica[1]);
          }
          if (telo.vero) telo.vero.evento('sparo');
        }
      }

      // Posa del momento, effetti del fotogramma, mantello
      posaEroe(mossa, ms);
      if (telo.vero) telo.vero.passo(dt, eroe.cl, eroe.f, eroe.x, eroe.y, eroe.verso, eroe.tm, eroe.hvx, eroe.hvy, eroe.aterra ? TERRA : 1e9);
      else if (ancoreEroe()) telo.riserva.aggiorna(dt, P6, SP, eroe.verso, eroe.hvx, eroe.hvy, TERRA);
      for (const q of eroe.scia) q.t += dt;
      eroe.scia = eroe.scia.filter((q) => q.t < 0.22);

      // Ondate
      onda -= dt;
      if (onda <= 0) {
        if (contaNemici() <= massimo() - 4) ondata();
        onda = caso(1.8, 3.2);
      }
      for (const q of coda) {
        q.quando -= dt;
        if (q.quando <= 0) {
          q.via = true;
          const sciame = q.tipo === 'sciame' && nemici.filter((e) => e.tipo.modo === 'sciame' && vivo(e)).length >= REGIA.sciameMax;
          if (!sciame && contaNemici() < massimo() + (q.tipo === 'sciame' ? 3 : 0)) nuovo(q.lato, q.tipo);
        }
      }
      coda = coda.filter((q) => !q.via);

      // Nemici: arrivano, attaccano come nel gioco (MODI), a contatto colpiscono e vengono respinti
      for (const e of nemici) {
        const T = e.tipo;
        e.t += ms; e.st += ms; e.flash -= ms;
        if (e.nato != null) e.nato += dt;   // (SIT8) ingresso graduale
        // a terra: chi è in aria ricade (balzelli, salti addosso, il salto dell'Anello che finisce in un'onda)
        if (!T.vola && !e.muro && (e.h > 0 || e.vh < 0)) {
          e.vh += 420 * dt; e.h -= e.vh * dt;
          if (e.stato === 'avanza') e.x += e.verso * T.vel * (e.vb - 1) * dt;
          if (e.h <= 0) {
            e.h = 0; e.vh = 0; e.vb = 1;
            if (e.stato !== 'morte') polvere(e.x, TERRA, 2, 0, '#6a625a');
            if (e.slam && e.stato !== 'morte') { e.slam = false; onde.push({ x: e.x, t: 0, piccola: true }); scossa(1, 0.08); }
          }
        }
        if (e.stato === 'morte') {
          if (!e.muro && Math.abs(e.kb) > 8) { e.x += e.kb * dt; e.kb *= Math.pow(0.05, dt); }
          if (e.st >= T.c.morte.tot + 80) { frantuma(e); e.via = true; }
          continue;
        }
        if (e.stato === 'colpito' && e.st >= durata(T.c.colpito, 120, 320, 140)) { e.stato = 'avanza'; e.st = 0; }
        if (e.stato === 'attacco') {
          const dur = e.durAtt || durata(T.c.attacco, 300, 900, 450);
          attaccoInCorso(e, dt);
          if (e.st >= dur) {
            e.stato = 'avanza'; e.st = 0; e.durAtt = 0;
            if (e.lancia) e.lancia = false;
            else if (!e.muro) e.kb = (e.x < eroe.x ? -1 : 1) * caso(90, 140);
          }
          continue;
        }
        if (e.muro && e.stato === 'colpito') e.stato = 'avanza';
        if (e.muro) {   // fisso: mai un passo; spara quando il ballo glielo chiede
          e.kb = 0;
          // (SIT8) arrivo: mano, avambraccio, busto escono piano dal muro (uscita cubica), animato con la sua clip
          const p = bracciPosti[e.posto];
          if (p && e.arrivoDur > 0) {
            e.arrivo = Math.min(e.arrivoDur, e.arrivo + dt);
            const u = e.arrivo / e.arrivoDur, k = 1 - (1 - u) * (1 - u) * (1 - u);
            e.x = p.x - e.verso * e.fuori * (1 - k); e.y = e.q0 = p.y;
            if (u < 1) { e.prossimoRaggio = 0; continue; }
          }
          if (e.prossimoRaggio > 0 && (e.prossimoRaggio -= ms) <= 0) laser(e);
          continue;
        }
        if (Math.abs(e.kb) > 8) {
          e.x += e.kb * dt;
          e.kb *= Math.pow(0.02, dt);
          continue;
        }
        e.kb = 0;
        if (e.stato !== 'avanza') continue;
        e.verso = eroe.x < e.x ? -1 : 1;
        const dx = Math.abs(e.x - eroe.x);
        // chi tira tiene la distanza (e arretra se il protagonista è troppo vicino)
        const tiene = (T.modo === 'sputo' && dx < 110) || ((T.modo === 'scaglie' || T.modo === 'lampada') && dx < 80);
        const v = T.vel * (T.modo === 'rotola' ? 1.8 : 1) * (tiene ? (dx < 46 ? -0.8 : 0) : 1);
        if (T.c.avanza.n > 1) e.x += e.verso * v * dt;
        else {
          e.acc += v * dt; // passo a scatti di 1 px
          while (e.acc >= 1) { e.x += e.verso; e.acc -= 1; }
          while (e.acc <= -1) { e.x -= e.verso; e.acc += 1; }
        }
        if (T.vola && e.ballo > 0) {
          // ballo d'ingresso: a otto attorno al punto d'arrivo, scendendo dalla cima alla sua quota
          e.ballo -= dt;
          const k = 1 - Math.max(0, e.ballo) / e.ballo0, u = k * k * (3 - 2 * k), w = e.t / 1000 * 1.7 + e.fase, R = 26;
          const nx = e.bx + Math.sin(w) * R;
          e.verso = nx >= e.x ? 1 : -1;
          e.x = nx;
          e.y = e.by0 + (e.q0 - e.by0) * u + Math.sin(w * 2) * R * 0.35;
          continue;
        }
        if (T.vola && T.modo === 'sciame') {
          e.y = e.q0 + Math.sin(e.t / 260 + e.fase) * 5;   // sciame: in alto, ondeggiando
          continue;
        }
        if (T.vola) {
          // scendono verso il petto man mano che si avvicinano
          const ty0 = Math.max(T.alto + 1, Math.min(TERRA - T.basso - 1, petto() - T.oy));
          const k = Math.max(0, Math.min(1, dx / (W * 0.5)));
          e.y += (e.q0 * k + ty0 * (1 - k) - e.y) * Math.min(1, dt * 2);
        }
        // a terra: i piccoli avanzano a balzelli; la Puntina salta addosso (balzo), l'Anello salta e fa l'onda
        if (!T.vola && !e.h && T.c.avanza.n > 1) {
          e.balzo -= dt;
          if (e.balzo <= 0) {
            const piccolo = T.alto < 34;
            if (T.modo === 'balzo' && dx < 80 && dx > e.contatto + 6 && Math.random() < 0.6) { e.vh = -caso(160, 190); e.vb = 1 + dx / 26; }
            else if (T.modo === 'rotola' && dx < 56 && dx > e.contatto && Math.random() < 0.5) { e.vh = -150; e.vb = 1 + dx / 36; e.slam = true; }
            else if (dx < 46 && dx > e.contatto + 6 && Math.random() < 0.25) { e.vh = -caso(130, 160); e.vb = 1 + dx / 30; }
            else if (piccolo) { e.vh = -caso(50, 100); e.vb = caso(1.4, 2); }
            e.balzo = piccolo || T.modo === 'balzo' ? caso(0.25, 1.1) : caso(1.5, 3.5);
          }
        }
        if (dx < e.contatto && !e.h) { avviaAttacco(e, 'contatto', 0, null); continue; }
        // attacco da lontano, secondo il tipo
        e.tiro -= dt;
        if (e.tiro > 0 || e.h || e.x < 8 || e.x > W - 8) continue;
        e.tiro = caso(3, 6);
        if (T.modo === 'carica' && dx > 50 && dx < 140) {
          if (Math.random() < 0.3 && bombe.length < 5) avviaAttacco(e, 'lancio', 1350, [750]);   // il sasso ad arco
          else avviaAttacco(e, 'carica', 1100, null);
        } else if (T.modo === 'sputo' && dx > 40 && dx < W * 0.6 && bombe.length < 5) avviaAttacco(e, 'lancio', 1100, [500, 800]);
        else if (T.modo === 'scaglie' && dx > 30 && dx < W * 0.5 && bombe.length < 6) avviaAttacco(e, 'dardo', 1290, [650, 780]);
        else if (T.modo === 'lampada' && dx < W * 0.55 && bombe.length < 5) avviaAttacco(e, 'lancio', 1700, [900, 1100, 1300]);   // salva di tre
      }
      passoBallo(dt);
      passoRaggi(dt);

      // Colpi (tre sottopassi, così non attraversano i nemici sottili); possono far scoppiare i proiettili
      for (const c of colpi) {
        for (let k = 0; k < 3 && !c.morto; k++) {
          c.x += c.vx * dt / 3;
          c.y += c.vy * dt / 3;
          for (const e of nemici) {
            if (!vivo(e) || e.via || e.muro) continue;   // i Bracci: i colpi li attraversano (sennò restano «colpiti» e saltano il ballo)
            const [cx, cy] = centro(e);
            if (Math.abs(c.x - cx) > e.tipo.hw || Math.abs(c.y - cy) > e.tipo.hh) continue;
            c.morto = true;
            emetti(STE, c.x, c.y, 0, 0, 0.09, '#fff1b8', 3);
            colpisci(e, c.x, c.y, Math.sign(c.vx) || eroe.verso, Math.round(caso(9, 12)), 40, null, 'proiettile', c.vx, c.vy);
            break;
          }
          for (const b of bombe) {
            if (c.morto || b.via || Math.abs(c.x - b.x) > 3 || Math.abs(c.y - b.y) > 3) continue;
            c.morto = true; b.via = true;
            esplodi(b.x, b.y, b);
          }
        }
        if (c.x < -4 || c.x > W + 4 || c.y < -4 || c.y > TERRA) {
          if (lett && !c.morto && c.y > TERRA) lett.C.pistolaUrto(c.x, TERRA - 1, Math.sign(c.vx), true);
          c.morto = true;
        }
        if (lett && !c.morto) lett.C.pistolaScia(c.x, c.y, c.vx / V_COLPO, c.vy / V_COLPO, c, dt);
      }
      colpi = colpi.filter((c) => !c.morto);
      nemici = nemici.filter((e) => !e.via && (e.muro || (e.x > -200 && e.x < W + 200)));   // (SIT8) i Bracci in arrivo restano

      // Proiettili ad arco: esplodono a terra
      for (const b of bombe) {
        if (b.via) continue;
        if (!b.dritto) b.vy += G_BOMBA * dt;
        b.x += b.vx * dt; b.y += b.vy * dt;
        const vicino = eroe.az !== 'scatto' && Math.abs(b.x - eroe.x) < 6 && b.y > eroe.y - 46 && b.y < eroe.y;
        if (b.y >= TERRA - 1 || vicino) {
          b.via = true;
          if (vicino) ferita(b.vx >= 0 ? 1 : -1);
          if (lett) {   // lo scoppio secondo la materia, in lettere; luce e spinta restano
            lett.C.scoppioSparo(b.tipoA, b.x, Math.min(b.y, TERRA - 2), b.vx, b.vy, lett.C.nemico(b.id || ''));
            lampi.push({ x: b.x, y: Math.min(b.y, TERRA - 2) - 3, vita: 0.14, r: b.dritto ? 12 : 26 });
            if (vicino) eroe.spinta = (b.vx >= 0 ? 1 : -1) * (b.dritto ? 40 : 90);
          } else if (b.dritto) {
            emetti(STE, b.x, Math.min(b.y, TERRA - 2), 0, 0, 0.08, '#ffe27a', 2);
            scintille(b.x, Math.min(b.y, TERRA - 2), -Math.sign(b.vx) || 1, 3, COL_FUOCO);
            if (vicino) eroe.spinta = (b.vx >= 0 ? 1 : -1) * 40;
          } else esplodi(b.x, Math.min(b.y, TERRA - 2));
        } else if (b.x < -20 || b.x > W + 20 || b.y < -40) b.via = true;
        else if (lett) {   // corpo in volo in lettere: raggio e qualità da spari.corpo del gioco (senza dati: come il motore)
          const Cp = lett.K.corpo;
          lett.C.corpoSparo(b.tipoA, b.x, b.y, b.vx, b.vy, Cp ? Cp.raggio_px48[b.tipoA] ?? 3.5 : 7.2, null, lett.C.nemico(b.id || ''), Cp ? Cp.q_max ?? 1 : 1, b, dt);
        }
      }
      bombe = bombe.filter((b) => !b.via);

      aggiornaEffetti(dt);
      if (lett) { lett.asc.passo(dt, null, null); lett.C.passo(dt); }
      scena(ora);
    }

    // ---- Attacchi dei nemici (MODI) ----
    // att: contatto | lancio (ad arco, colpi agli istanti colpiMs) | dardo (dritto) | carica | laser | fascio
    function avviaAttacco(e, att, durMs, colpiMs) {
      e.stato = 'attacco'; e.st = 0; e.att = att; e.lancia = att !== 'contatto';
      e.durAtt = durMs; e.colpiMs = colpiMs; e.sparati = 0;
    }
    function attaccoInCorso(e, dt) {
      const T = e.tipo;
      if (e.colpiMs && e.sparati < e.colpiMs.length && e.st >= e.colpiMs[e.sparati]) {
        e.sparati++;
        if (e.att === 'dardo') dardo(e); else lancia(e);
      }
      if (e.att === 'carica') {
        // avviso di 400 ms, poi corsa addosso; al contatto diventa un colpo a contatto (e la respinta)
        if (e.st < 400) { if (((e.st / 60) | 0) % 2) e.flash = 30; return; }
        e.verso = eroe.x < e.x ? -1 : 1;
        e.x += e.verso * (T.vel * 4 + 50) * dt;
        if (Math.abs(e.x - eroe.x) < e.contatto + 2) avviaAttacco(e, 'contatto', 0, null);
        if (Math.random() < 0.3) emetti(POL, e.x - e.verso * T.hw, TERRA - 1, -e.verso * 30, -10, 0.3, '#6a625a', 2, 0, 3);
      }
      if ((e.att === 'laser' || e.att === 'fascio') && e.muro && ((e.st / 300) | 0) !== ((e.st - dt * 1000) / 300 | 0)) {
        // la mano del Braccio si agita: sfiora le catene vicine
        const [hx, hy] = manoDi(e);
        scuotiCatene(hx, hy, 22, 50, 0, true);
      }
    }
    // Dardo dritto (le scaglie della Falena): veloce, scoppia piccolo a terra
    function dardo(e) {
      const [cx, cy] = centro(e), tx = eroe.x + caso(-6, 6), ty = eroe.y - caso(10, 34);
      const l = Math.hypot(tx - cx, ty - cy) || 1, v = 200;
      bombe.push({ x: cx, y: cy, vx: (tx - cx) / l * v, vy: (ty - cy) / l * v, dritto: true, tipoA: 'ago', id: e.tipo.id });
    }
    // Mano del Braccio (origine del laser) e bocca della Lampada (origine del fascio)
    // Origine del raggio del Braccio: il suo occhio/mano nel fotogramma (dati `occhi`), se no l'estremità del braccio
    function manoDi(e) {
      const a = clipDi(e), pts = a.occhi && a.occhi[fotoDi(e, a)];
      if (pts && pts.length >= 2) {
        const x = Math.round(e.x), y = Math.round(yDi(e));
        return [e.verso < 0 ? x + a.px - 1 - pts[0] : x + pts[0] - a.px, y + pts[1] - a.py];
      }
      const [cx, cy] = centro(e);
      return [cx + e.verso * e.tipo.hw * 0.9, cy];
    }
    // Raggio di un Braccio, da pista da ballo: preavviso con la linea sottile, poi il raggio bianco e rosso che spazza
    // lentamente la scena dal lato opposto fino sotto di sé (i due Bracci si incrociano), con un leggero pulsare.
    // Niente danno: spinge il protagonista, fa scintille a terra, buca il buio, sfiora le catene.
    function laser(e) {
      const mira = REGIA.raggioMira, fuoco = REGIA.raggioFuoco;
      avviaAttacco(e, 'laser', mira + fuoco + 300, null);
      const [hx, hy] = manoDi(e), v = e.verso;
      // da quasi orizzontale (attraversa tutta la scena a mezza altezza) fino a terra poco davanti al muro, o al contrario;
      // i due Bracci, da muri opposti, si incrociano al centro
      const orizz = v > 0 ? -0.03 : Math.PI + 0.03, basso = Math.atan2(TERRA - hy, v * W * caso(0.12, 0.22));
      const giu = Math.random() < 0.6;
      raggi.push({ e, x: hx, y: hy, ang: giu ? orizz : basso, a0: giu ? orizz : basso, a1: giu ? basso : orizz,
        t: 0, mira, fuoco, largo: 3, fase: 'mira', tocco: 0, len: 0, scint: 0 });
    }
    const COL_RAGGIO = ['#ffffff', '#ff8a7a', '#e3000f'];   // nucleo bianco, alone rosso
    function passoRaggi(dt) {
      for (const r of raggi) {
        const e = r.e;
        if (!vivo(e) || e.via || e.stato !== 'attacco') { r.via = true; continue; }
        [r.x, r.y] = manoDi(e);
        r.t += dt * 1000;
        if (r.t < r.mira) r.fase = 'mira';
        else if (r.t < r.mira + r.fuoco) {
          r.fase = 'fuoco';
          const u = (r.t - r.mira) / r.fuoco, k = u * u * (3 - 2 * u);   // lento all'inizio e alla fine
          r.ang = r.a0 + (r.a1 - r.a0) * k;
        } else { r.via = true; continue; }
        const ux = Math.cos(r.ang), uy = Math.sin(r.ang);
        let L = 600;
        if (uy > 0.01) L = Math.min(L, (TERRA - r.y) / uy);
        if (ux > 0.01) L = Math.min(L, (W - r.x) / ux);
        if (ux < -0.01) L = Math.min(L, -r.x / ux);
        r.len = Math.max(0, L);
        r.largo = 2 + (Math.sin(r.t / 70) > 0.2 ? 1 : 0);   // pulsa
        if (lett) {   // scintille, terra bruciata e fumo in lettere dove tocca (il nucleo a pixel lo disegna già la scena)
          lett.C.raggio(r, r.x, r.y, ux, uy, r.len, r.fase === 'fuoco' ? 'fuoco' : 'mira', r.fase === 'fuoco' ? r.t - r.mira : r.t, r.t > r.mira - 150 ? 1 : 0, false);
          lett.C.nn = 0;
        }
        if (r.fase !== 'fuoco') continue;
        // scintille dove tocca terra
        r.scint -= dt;
        if (r.scint <= 0) {
          r.scint = 0.04;
          const ex = r.x + ux * r.len, ey = r.y + uy * r.len;
          emetti(SCI, ex, ey - 1, caso(-70, 70), -caso(40, 110), caso(0.12, 0.24), Math.random() < 0.5 ? '#ffffff' : '#ff5a4a', 1, 420, 2);
        }
        // spinge il protagonista (mai durante lo scatto)
        r.tocco -= dt;
        if (r.tocco <= 0 && eroe.az !== 'scatto' && distRaggio(r, eroe.x, eroe.y - 24, 20) < 4) {
          r.tocco = 0.6;
          eroe.spinta = (ux >= 0 ? 1 : -1) * 70;
          ferita(ux >= 0 ? 1 : -1);
          emetti(STE, eroe.x, eroe.y - 26, 0, 0, 0.1, '#ffffff', 3);
        }
        // sfiora le catene
        for (const k of catene) {
          if (k.toccoR > 0) { k.toccoR -= dt; continue; }
          for (let i = 1; i <= k.n; i++) {
            if (distRaggio(r, k.x[i], k.y[i], 0) >= 2.5) continue;
            scuotiCatene(k.x[i], k.y[i], 8, ux * 50, uy * 50, false);
            k.toccoR = 0.25;
            break;
          }
        }
      }
      raggi = raggi.filter((r) => !r.via);
    }
    // Il ballo: ogni tanto i due Bracci accendono i raggi, insieme (incrociati) o uno dopo l'altro
    let ballo = caso(4, 7);
    function passoBallo(dt) {
      ballo -= dt;
      if (ballo > 0) return;
      ballo = caso(REGIA.balloOgni[0], REGIA.balloOgni[1]);
      const b = nemici.filter((e) => e.muro && e.stato !== 'attacco' && !inArrivo(e));   // (SIT8) solo quelli a posto
      if (!b.length) { if (nemici.some(inArrivo)) ballo = 1; return; }   // (SIT8) in arrivo: si riprova presto
      const insieme = Math.random() < REGIA.balloInsieme, primo = Math.random() < 0.5 ? 0 : 1;
      b.forEach((e, k) => { e.prossimoRaggio = 1 + (insieme ? 0 : (k === primo % b.length ? 0 : REGIA.balloSfaso * 1000)); });
    }
    // Distanza dal raggio r del segmento verticale (x, y ± h)
    function distRaggio(r, x, y, h) {
      const ux = Math.cos(r.ang), uy = Math.sin(r.ang);
      let best = 1e9;
      for (let k = -1; k <= 1; k++) {
        const px = x - r.x, py = y + k * h - r.y, t = Math.max(0, Math.min(r.len, px * ux + py * uy));
        best = Math.min(best, Math.hypot(px - ux * t, py - uy * t));
      }
      return best;
    }
    // Un raggio sta per prendere il protagonista? (pilota: lo schiva con lo scatto o col salto)
    function raggioVicino() {
      for (const r of raggi) {
        if (r.fase === 'fuoco' || r.t > r.mira - 220) {
          if (distRaggio(r, eroe.x, eroe.y - 24, 20) < 14) return r;
        }
      }
      return null;
    }

    // Proiettile ad arco verso il protagonista (un poco a caso), in volo 0,75–1,3 s
    function lancia(e) {
      const [cx, cy] = centro(e);
      const tx = eroe.x + caso(-16, 16), T = Math.max(0.75, Math.min(1.3, Math.abs(tx - cx) / 80));
      bombe.push({ x: cx, y: cy, vx: (tx - cx) / T, vy: (TERRA - 1 - cy - 0.5 * G_BOMBA * T * T) / T, tipoA: TIPO_SPARO[e.tipo.modo] || 'cera', id: e.tipo.id });
    }
    // Piccola esplosione a pixel con luce: nessun danno, al più spinge il protagonista
    function esplodi(x, y, b = null) {
      if (lett && b) {   // con le lettere: lo scoppio secondo la materia, niente pixel; luce, spinta e scossa restano
        lett.C.scoppioSparo(b.tipoA, x, y, b.vx, b.vy, lett.C.nemico(b.id || ''));
        lampi.push({ x, y: y - 3, vita: 0.14, r: 24 });
        const dx = eroe.x - x;
        if (eroe.az !== 'scatto' && Math.abs(dx) < 24 && Math.abs(eroe.y - 20 - y) < 34) { eroe.spinta = (dx >= 0 ? 1 : -1) * 90; ferita(dx >= 0 ? 1 : -1); }
        scossa(1, 0.08);
        return;
      }
      lampi.push({ x, y: y - 3, vita: 0.18, r: 30 });
      botti.push({ x, y, t: 0 });
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + caso(-1.3, 1.3), v = caso(60, 150);
        emetti(SCI, x, y, Math.cos(a) * v, Math.sin(a) * v, caso(0.15, 0.3), COL_FUOCO[i % 4], 1, 400, 2);
      }
      for (let i = 0; i < 5; i++) emetti(PIX, x, y, caso(-60, 60), -caso(50, 130), caso(0.5, 0.9), i % 2 ? '#3a2a22' : '#7a5a40', 1, 420);
      fumo(x, y - 2, 3);
      const dx = eroe.x - x;
      if (eroe.az !== 'scatto' && Math.abs(dx) < 24 && Math.abs(eroe.y - 20 - y) < 34) { eroe.spinta = (dx >= 0 ? 1 : -1) * 110; ferita(dx >= 0 ? 1 : -1); }
      scossa(1, 0.1);
    }

    function aggiornaEffetti(dt) {
      for (const p of part) {
        p.t += dt;
        p.vy += p.g * dt;
        if (p.att) { const f = Math.max(0, 1 - p.att * dt); p.vx *= f; if (!p.g) p.vy *= f; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y >= TERRA - 1 && p.vy > 0) {
          p.y = TERRA - 1;
          if (p.k === BOS && !p.rimb) { p.rimb = 1; p.vy *= -0.4; p.vx *= 0.5; }
          else { p.vy = 0; p.vx *= 0.8; p.g = 0; }
        }
      }
      part = part.filter((p) => p.t < p.vita);
      for (const q of numeri) { q.t += dt; q.vy += 160 * dt; q.x += q.vx * dt; q.y += q.vy * dt; }
      numeri = numeri.filter((q) => q.t < q.vita);
      for (const l of lampi) l.vita -= dt;
      lampi = lampi.filter((l) => l.vita > 0);
      for (const b of botti) b.t += dt;
      botti = botti.filter((b) => b.t < 0.25);
      for (const o of onde) o.t += dt;
      onde = onde.filter((o) => o.t < 0.35);
      scuoti -= dt;
    }

    const durata = (a, min, max, base) => (a ? Math.max(min, Math.min(max, a.tot)) : base);

    // Clip e fotogramma del protagonista; emette gli effetti quando il fotogramma cambia
    function posaEroe(mossa, ms) {
      const az = eroe.az;
      let a = null, tm = null;
      if (az === 'colpo') a = clip[eroe.mossa];
      else if (az === 'carica') {
        const ini = clip.carica_inizio ? clip.carica_inizio.tot : 0;
        if (eroe.azT < ini) a = clip.carica_inizio;
        else { a = clip.carica; tm = eroe.azT - ini; }
      } else if (az === 'doppio') a = clip.salto_doppio;
      else if (az === 'scatto') a = clip.scatto;
      else if (az === 'schianto') a = clip.aria_schianto;
      else if (az === 'stacco') a = clip.salto_stacco;
      else if (az === 'pesante') a = clip.schianto_atterra;
      else if (az === 'atterra') a = clip.atterraggio;
      if (a) tm = tm ?? eroe.azT;
      else if (eroe.sparo && eroe.sparoT < eroe.sparo.tot) { a = eroe.sparo; tm = eroe.sparoT; }
      else if (!eroe.aterra) a = clip[eroe.vy < -60 ? 'salto_sale' : eroe.vy < 60 ? 'salto_apice' : 'salto_cade'] || clip.salto_sale || respiro;
      else a = mossa && !az ? corsa : respiro;
      if (a !== eroe.cl) { eroe.cl = a; eroe.t = 0; eroe.f = -1; }
      eroe.t += ms;
      eroe.tm = tm ?? eroe.t;
      const f = fotogramma(a, eroe.tm);
      if (f !== eroe.f) { eroe.f = f; effettiClip(a, f); }
    }

    const ancoreEroe = () => agganci(eroe.cl, eroe.f, eroe.x, eroe.y, eroe.verso, P6, SP);

    // Luci del fotogramma: [x, y, raggio, forza]
    function luci(ora) {
      const tr = FERMO ? 0 : Math.round(Math.sin(ora / 1000 * 9) * 1.5);
      const L = [[eroe.x, eroe.y - 30, R_EROE + tr, 1]];
      if (eroe.lampo > 0) L.push([eroe.lx + eroe.lux * 2, eroe.ly + eroe.luy * 2, 42, Math.min(1, eroe.lampo / 0.04)]);
      const a = eroe.cl;
      if (a.arco && a.arco[eroe.f]) L.push([eroe.x + eroe.verso * 12, eroe.y - 30, 22, 0.7]);
      for (const c of colpi) L.push([c.x, c.y, 7, 0.6]);
      for (const b of bombe) L.push([b.x, b.y, 9, 0.8]);
      for (const l of lampi) L.push([l.x, l.y, l.r, Math.min(1, l.vita / 0.05)]);
      for (const b of botti) L.push([b.x, b.y - 4, b.grande ? 56 : 36, 1 - b.t / 0.25]);
      for (const o of onde) L.push([o.x, TERRA - 6, Math.round((18 + 30 * o.t / 0.35) * (o.piccola ? 0.6 : 1)), 1 - o.t / 0.35]);
      // (SIT8) niente più «filo di luce» sui volanti in alto: prendono il buio come i nemici a terra
      for (const r of raggi) {
        if (r.fase === 'mira') { L.push([r.x, r.y, 10, 0.7]); continue; }
        const ux = Math.cos(r.ang), uy = Math.sin(r.ang), n = Math.max(2, Math.min(14, Math.round(r.len / 22)));
        for (let k = 1; k <= n; k++) L.push([r.x + ux * r.len * k / n, r.y + uy * r.len * k / n, 12, 0.75]);
      }
      if (eroe.az === 'carica') L.push([eroe.x + eroe.verso * 10, eroe.y - 32, 14 + Math.min(14, Math.round(eroe.azT / 60)), 0.8]);
      return L;
    }

    // Quanta luce arriva in (x, y): 0 buio pieno, 1 piena luce (stessi gradini della pozza)
    function livello(L, x, y) {
      let lv = 0;
      for (const [lx, ly, r, f] of L) {
        const u = Math.hypot(x - lx, y - ly) / r;
        if (u >= 1) continue;
        let a = 0;
        for (const [rk, v] of BANDE) if (u < rk) a = v;
        lv += a * f;
      }
      return Math.min(1, lv);
    }

    // Occhi rossi sopra il buio, come nel gioco. Con i punti cotti (lato ≠ 0): alone 3×3, punto acceso e riflesso
    // dal lato dello sguardo, anche dentro la luce. Senza dati: al buio si ridisegnano solo i pixel rosso vivo dello
    // sprite, nella loro posizione esatta (in luce bastano quelli già dipinti).
    function occhi(e, L) {
      const a = clipDi(e), pts = a.occhi && a.occhi[fotoDi(e, a)];
      if (!pts || !pts.length) return;
      const [cx, cy] = centro(e), buio = (1 - livello(L, cx, cy)) * ingresso(e);   // (SIT8) occhi in dissolvenza con l'ingresso
      const x = Math.round(e.x), y = Math.round(yDi(e)), d = e.verso;
      for (let j = 0; j < pts.length; j += 3) {
        const ex = d < 0 ? x + a.px - 1 - pts[j] : x + pts[j] - a.px, ey = y + pts[j + 1] - a.py;
        if (pts[j + 2]) {
          const k = Math.max(0.7 * ingresso(e), buio), lato = pts[j + 2] * d;   // (SIT8)
          g.globalAlpha = k * 0.4; g.fillStyle = '#ff3a26'; g.fillRect(ex - 1, ey - 1, 3, 3);
          g.globalAlpha = Math.min(1, k * 1.4); g.fillStyle = '#ff2a1c'; g.fillRect(ex, ey, 1, 1);
          g.fillStyle = '#ffb0a0'; g.fillRect(ex + (lato > 0 ? 1 : -1), ey, 1, 1);
        } else if (buio > 0.05) {
          g.globalAlpha = Math.min(1, buio * 1.3); g.fillStyle = '#ff2a1c'; g.fillRect(ex, ey, 1, 1);
        }
      }
      g.globalAlpha = 1;
    }

    // Buio sopra un livello: copre solo i pixel già disegnati
    function abbuia(gx, forza) {
      gx.globalCompositeOperation = 'source-atop';
      gx.globalAlpha = forza;
      gx.drawImage(maschera, 0, 0);
      gx.globalAlpha = 1;
      gx.globalCompositeOperation = 'source-over';
    }

    // Particelle: quelle del mondo (sotto il buio) o quelle che brillano (sopra)
    function disegnaParti(gx, sopra) {
      for (const p of part) {
        if ((p.k === SCI || p.k === STE) !== sopra) continue;
        const k = p.t / p.vita, X = Math.round(p.x), Y = Math.round(p.y);
        gx.fillStyle = p.c;
        if (p.k === SCI) {   // tratto lungo la velocità, si accorcia col tempo
          const l = (1 - k) * 0.022;
          gx.fillRect(X, Y, 1, 1);
          gx.fillRect(Math.round(p.x - p.vx * l * 0.5), Math.round(p.y - p.vy * l * 0.5), 1, 1);
          gx.fillRect(Math.round(p.x - p.vx * l), Math.round(p.y - p.vy * l), 1, 1);
        } else if (p.k === STE) {   // stella a croce
          const r = Math.max(1, Math.round(p.d * (1 - k * 0.5))), q = Math.round(r * 0.55);
          gx.fillRect(X - r, Y, 2 * r + 1, 1); gx.fillRect(X, Y - r, 1, 2 * r + 1);
          for (let j = 1; j <= q; j++) {
            gx.fillRect(X - j, Y - j, 1, 1); gx.fillRect(X + j, Y - j, 1, 1);
            gx.fillRect(X - j, Y + j, 1, 1); gx.fillRect(X + j, Y + j, 1, 1);
          }
        } else if (p.k === POL || p.k === FUM) {
          const d = Math.max(1, Math.round(p.d * (p.k === POL ? 0.6 + k * 1.2 : 0.7 + k * 1.6)));
          gx.globalAlpha = p.k === POL ? 0.75 * (1 - k) : 0.55 * (1 - k) * (1 - k);
          gx.fillRect(X - (d >> 1), Y - (d >> 1), d, d);
          gx.globalAlpha = 1;
        } else if (p.k === BOS) {
          gx.fillRect(X, Y, 2, 1);
        } else {
          if (k > 0.75) gx.globalAlpha = (1 - k) * 4;
          gx.fillRect(X, Y, p.d, p.d);
          gx.globalAlpha = 1;
        }
      }
    }

    // Colpo di pistola come nel gioco (feel.mjs, disegnaProiettile): contorno scuro, tracciante oro e arancio
    // che si sgrana, corpo oro lungo 7 px e spesso 2, nucleo bianco; la scia non va oltre la bocca
    function disegnaColpo(c) {
      const ux = c.vx / V_COLPO, uy = c.vy / V_COLPO, CORPO = 7;
      const n = Math.max(3, Math.min(29, Math.floor(Math.hypot(c.x - c.x0, c.y - c.y0))));
      const pieno = CORPO + Math.round((n - CORPO) * 0.55);
      const X = (j) => Math.round(c.x - ux * j), Y = (j) => Math.round(c.y - uy * j);
      g.fillStyle = '#1b0f0c';
      for (let j = 0; j < n; j++) {
        if (j < CORPO) g.fillRect(X(j) - 2, Y(j) - 2, 4, 4);
        else if (j < pieno || !(j & 1)) g.fillRect(X(j) - 1, Y(j) - 1, 3, 3);
      }
      g.fillRect(Math.round(c.x + ux * 2) - 1, Math.round(c.y + uy * 2) - 1, 3, 3);
      for (let j = CORPO; j < n; j++) {
        if (j >= pieno && (j & 1)) continue;
        const t = (j - CORPO) / Math.max(1, n - CORPO);
        g.fillStyle = t < 0.3 ? '#ffe27a' : t < 0.65 ? '#ffa22a' : '#e8661c';
        g.fillRect(X(j), Y(j), 1, 1);
      }
      g.fillStyle = '#ffc93a';
      for (let j = 0; j < Math.min(CORPO, n); j++) g.fillRect(X(j) - 1, Y(j) - 1, 2, 2);
      g.fillStyle = '#ffffff';
      for (let j = 0; j < Math.min(CORPO >> 1, n); j++) g.fillRect(X(j) - 1, Y(j) - 1, 2, 2);
      g.fillRect(Math.round(c.x + ux * 2), Math.round(c.y + uy * 2), 1, 1);
    }

    // Effetti luminosi sopra il buio: arco del fendente, scia dello scatto, colpi, proiettili, scoppi, onda, lampo, numeri
    function disegnaLuminosi() {
      const a = eroe.cl;
      if (a.archi && a.arco[eroe.f]) {
        // arco del fendente: due volte, la seconda in luce additiva spostata di 1 px (più ampio e più chiaro)
        disegna(g, a.archi, eroe.f * a.fw, 0, a.fw, a.fh, a.px, a.py, eroe.x, eroe.y, eroe.verso);
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.45;
        disegna(g, a.archi, eroe.f * a.fw, 0, a.fw, a.fh, a.px, a.py, eroe.x + eroe.verso, eroe.y - 1, eroe.verso);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      }
      if (eroe.az === 'carica') {    // bagliore che cresce sulla lama
        const ini = clip.carica_inizio ? clip.carica_inizio.tot : 0, k = Math.max(0, Math.min(1, (eroe.azT - ini) / 800));
        const X = Math.round(eroe.x + eroe.verso * 10), Y = Math.round(eroe.y - 34), r = 2 + Math.round(5 * k);
        g.globalAlpha = 0.35 + 0.4 * k;
        g.fillStyle = k < 0.5 ? '#ffb347' : '#ffe27a';
        for (let j = 0; j < 12; j++) {
          const an = j / 12 * Math.PI * 2 + eroe.azT / 120;
          g.fillRect(Math.round(X + Math.cos(an) * r), Math.round(Y + Math.sin(an) * r), 1, 1);
        }
        g.globalAlpha = 1;
        g.fillStyle = k < 0.7 ? '#fff1b8' : '#ffffff';
        g.fillRect(X - 1, Y - 1, 2 + (k > 0.6 ? 1 : 0), 2 + (k > 0.6 ? 1 : 0));
      }
      const sc = clip.scatto;
      if (sc && sc.ombra) {
        for (const q of eroe.scia) {
          g.globalAlpha = 0.6 * (1 - q.t / 0.22);
          disegna(g, sc.ombra, Math.max(0, q.f) * sc.fw, 0, sc.fw, sc.fh, sc.px, sc.py, q.x, q.y, q.v);
        }
        g.globalAlpha = 1;
      }
      for (const c of colpi) disegnaColpo(c);
      for (const b of bombe) {
        if (lett) break;   // gli spari dei nemici sono in lettere
        const l = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / l, uy = b.vy / l, X = Math.round(b.x), Y = Math.round(b.y);
        if (b.dritto) {   // scaglia: tratto giallo con punta bianca
          tratto(g, X, Y, -ux, -uy, 4, '#ffb347', 1);
          g.fillStyle = '#fff6d8';
          g.fillRect(X, Y, 1, 1);
          continue;
        }
        g.fillStyle = '#e8661c';
        g.fillRect(Math.round(b.x - ux * 4), Math.round(b.y - uy * 4), 1, 1);
        g.fillStyle = '#ff7a2a';
        g.fillRect(Math.round(b.x - ux * 2.5), Math.round(b.y - uy * 2.5), 1, 1);
        g.fillStyle = '#ffe27a';
        g.fillRect(X - 1, Y - 1, 2, 2);
        g.fillStyle = '#fff';
        g.fillRect(X, Y - 1, 1, 1);
      }
      for (const r of raggi) {   // laser del Braccio e fascio della Lampada
        const ux = Math.cos(r.ang), uy = Math.sin(r.ang), L = Math.round(r.len);
        if (r.fase === 'mira') {
          // preavviso: linea sottile a tratti, piena negli ultimi 150 ms
          const fissa = r.t > r.mira - 150;
          g.globalAlpha = fissa ? 0.9 : 0.55;
          g.fillStyle = COL_RAGGIO[1];
          for (let d = 3; d < L; d++) if (fissa || d % 6 < 3) g.fillRect(Math.round(r.x + ux * d), Math.round(r.y + uy * d), 1, 1);
          g.globalAlpha = 1;
        } else {
          const w = r.largo;
          g.fillStyle = COL_RAGGIO[2];
          for (let d = 0; d < L; d += 2) g.fillRect(Math.round(r.x + ux * d) - (w >> 1), Math.round(r.y + uy * d) - (w >> 1), w, w);
          g.fillStyle = COL_RAGGIO[1];
          if (w > 2) for (let d = 0; d < L; d += 2) g.fillRect(Math.round(r.x + ux * d) - 1, Math.round(r.y + uy * d) - 1, 2, 2);
          g.fillStyle = COL_RAGGIO[0];
          for (let d = 0; d < L; d++) g.fillRect(Math.round(r.x + ux * d), Math.round(r.y + uy * d), 1, 1);
          g.fillRect(Math.round(r.x + ux * L) - 1, Math.round(r.y + uy * L) - 1, 3, 3);
        }
      }
      for (const b of botti) {   // anello di fuoco che si allarga (lo schianto: più grande, con la cupola piena)
        const k = b.t / 0.25, r = 2 + Math.round((b.grande ? 22 : 10) * k);
        if (b.grande && k < 0.6) {
          g.globalAlpha = 0.5 * (1 - k / 0.6);
          g.fillStyle = k < 0.25 ? '#fff1b8' : '#ffb347';
          for (let j = 0; j <= r; j += 2) {
            const w = Math.round(Math.sqrt(r * r - j * j) * 0.9);
            g.fillRect(Math.round(b.x) - w, Math.round(b.y) - Math.round(j * 0.7), 2 * w + 1, 1);
          }
          g.globalAlpha = 1;
        }
        g.fillStyle = k < 0.4 ? '#fff1b8' : k < 0.7 ? '#ffb347' : '#ff7a2a';
        for (let j = 0; j < 16; j++) {
          const an = j / 16 * Math.PI * 2, py = Math.round(b.y + Math.sin(an) * r * 0.7);
          if (py <= TERRA) g.fillRect(Math.round(b.x + Math.cos(an) * r), py, 1, 1);
        }
        if (k < 0.3) { g.fillStyle = '#fff'; g.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 2, 3, 3); }
      }
      for (const o of onde) {    // onda dello schianto: due fronti lungo il suolo e una cupola bassa
        const k = o.t / 0.35, r = Math.round((6 + 64 * k) * (o.piccola ? 0.4 : 1)), X = Math.round(o.x);
        g.globalAlpha = 1 - k;
        g.fillStyle = k < 0.5 ? '#fff6d8' : '#ffb347';
        for (const d of [-1, 1]) {
          g.fillRect(X + d * r, TERRA - 4, 1, 4);
          g.fillRect(X + d * (r - 1), TERRA - 2, 1, 2);
        }
        for (let j = 1; j < 12; j++) {
          const an = j / 12 * Math.PI;
          g.fillRect(Math.round(X + Math.cos(an) * r), Math.round(TERRA - 1 - Math.sin(an) * r * 0.35), 1, 1);
        }
        g.globalAlpha = (1 - k) * 0.5;
        g.fillRect(X - r, TERRA, 2 * r + 1, 1);
        g.globalAlpha = 1;
      }
      if (eroe.lampo > 0) {      // lampo a stella lungo la canna (feel.mjs, Lampi tipo 0, in piccolo)
        const k = 1 - eroe.lampo / 0.06, ux = eroe.lux, uy = eroe.luy;
        const X = Math.round(eroe.lx + ux * 2), Y = Math.round(eroe.ly + uy * 2), L = 7 - Math.round(k * 3);
        tratto(g, X, Y, ux, uy, L, k < 0.5 ? '#ffb347' : '#ff7a2a', 3);
        tratto(g, X, Y, (ux - uy) * 0.7071, (uy + ux) * 0.7071, 3, '#ff9a3c', 1);
        tratto(g, X, Y, (ux + uy) * 0.7071, (uy - ux) * 0.7071, 3, '#ff9a3c', 1);
        tratto(g, X, Y, -ux, -uy, 1, '#ffd36b', 1);
        tratto(g, X, Y, ux, uy, L - 1, '#ffe9a8', 1);
        g.fillStyle = '#fff';
        g.fillRect(X - 1, Y - 1, 3, 3);
      }
      disegnaParti(g, true);
      for (const q of numeri) {  // lampeggiano negli ultimi istanti invece di sfumare
        if (q.t > q.vita * 0.75 && ((q.t * 30) | 0) % 2) continue;
        const txt = String(q.v);
        let X = Math.round(q.x - txt.length * 2);
        const Y = Math.round(q.y - 3);
        for (const ch of txt) { g.drawImage(cifra(+ch, q.col), X - 1, Y - 1); X += 4; }
      }
    }

    function scena(ora) {
      const L = luci(ora);
      // Maschera: buio pieno, le pozze lo tolgono a gradini
      gb.globalCompositeOperation = 'source-over';
      gb.fillStyle = BUIO;
      gb.fillRect(0, 0, W, H);
      gb.globalCompositeOperation = 'destination-out';
      for (const [x, y, r, f] of L) {
        if (f <= 0) continue;
        gb.globalAlpha = f;
        gb.drawImage(pozza(r, false), Math.round(x - r), Math.round(y - r));
      }
      gb.globalAlpha = 1;
      gb.globalCompositeOperation = 'source-over';

      // Scossa breve dello schermo (pixel interi)
      const sx = scuoti > 0 ? Math.round(caso(-1, 1) * scuotiF) : 0, sy = scuoti > 0 ? Math.round(caso(-1, 1) * scuotiF * 0.6) : 0;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, W, H);
      g.setTransform(1, 0, 0, 1, sx, sy);

      // Blocchi: il buio li smorza a metà, restano il fondo rosso delle sagome
      blocchi();
      abbuia(g, 0.55);

      // Mondo: terra, nemici, mantello, protagonista, particelle; poi il buio quasi pieno
      gm.clearRect(0, 0, W, H);
      terra();
      for (const e of nemici) {
        const a = clipDi(e), i = fotoDi(e, a);
        gm.globalAlpha = ingresso(e);   // (SIT8)
        disegna(gm, e.flash > 0 ? a.b : a.img, i * a.fw, 0, a.fw, a.fh, a.px, a.py, e.x, yDi(e), e.verso);
      }
      gm.globalAlpha = 1;
      if (telo.vero) telo.vero.dietro(gm); else telo.riserva.disegna(gm);
      const ea = eroe.cl;
      disegna(gm, ea.img, Math.max(0, eroe.f) * ea.fw, 0, ea.fw, ea.fh, ea.px, ea.py, eroe.x, eroe.y, eroe.verso);
      if (telo.vero) telo.vero.sopra(gm);
      disegnaParti(gm, false);
      abbuia(gm, 0.93);
      g.drawImage(mondo, 0, 0);

      // Alone caldo delle luci (si vede anche sul fondo vuoto)
      g.globalCompositeOperation = 'lighter';
      for (const [x, y, r, f] of L) {
        if (r < 20 || f <= 0) continue;
        g.globalAlpha = 0.16 * f;
        g.drawImage(pozza(r, true), Math.round(x - r), Math.round(y - r));
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';

      // luce rossa lieve del raggio acceso: sul Braccio che spara e lungo il raggio, in dissolvenza
      if (raggi.length) {
        g.globalCompositeOperation = 'lighter';
        for (const r of raggi) {
          if (r.fase !== 'fuoco') continue;
          const tf = r.t - r.mira, D = REGIA.rossoDissolvenza;
          const k = Math.max(0, Math.min(1, tf / D, (r.fuoco - tf) / D));
          if (k <= 0) continue;
          g.globalAlpha = REGIA.rossoForza * k;
          const R0 = REGIA.rossoRaggio, R1 = REGIA.rossoLungo, ux = Math.cos(r.ang), uy = Math.sin(r.ang);
          g.drawImage(veloRosso, r.x - R0, r.y - R0, 2 * R0, 2 * R0);
          for (let d = R1; d < r.len; d += R1) g.drawImage(veloRosso, r.x + ux * d - R1, r.y + uy * d - R1, 2 * R1, 2 * R1);
        }
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      }
      for (const e of nemici) if (vivo(e)) occhi(e, L);
      disegnaLuminosi();
      g.setTransform(1, 0, 0, 1, 0, 0);
      disegnaCatene();
      // lettere degli effetti: tutto sulla loro tela (px di gioco × s × dpr); si pulisce solo se c'era qualcosa
      if (lett) {
        if (lettereSporche) gL.clearRect(0, 0, cvLettere.width, cvLettere.height);
        lettereSporche = lett.asc.disegnaLettere(gL, 0, s * dprL, 0, 0, 1, cvLettere.width, cvLettere.height) > 0;
      }
    }

    // Il mantello si posa prima del primo fotogramma
    function posaTelo() {
      if (telo.vero) {
        telo.vero.azzera();
        for (let k = 0; k < 90; k++) telo.vero.passo(1 / 60, eroe.cl, eroe.f, eroe.x, eroe.y, eroe.verso, 0, 0, 0, TERRA);
      } else {
        telo.riserva.azzera();
        if (ancoreEroe()) for (let k = 0; k < 90; k++) telo.riserva.aggiorna(1 / 60, P6, SP, eroe.verso, 0, 0, TERRA);
      }
    }

    if (!FERMO && guida) guida.hidden = false;   // prima di misurare: la riga dei tasti sposta la base della scena
    misura();
    eroe.x = eroe.meta = eroe.px = Math.round(W / 2);
    eroe.y = eroe.py = TERRA;
    eroe.f = 0;
    posaTelo();

    // Nemici: entrano man mano che le loro strisce sono pronte (nel frattempo il protagonista gira già)
    const dai = (t) => {
      tipi.push(t);
      if (t.modo === 'muro') { tipoBraccio = t; creaBracci(t); return; }
      if (tipi.length === 1) onda = Math.min(onda, 0.2);
    };
    let tipoBraccio = null;
    const nemiciPronti = caricaGioco()
      .then((G) => tipiDelGioco(G, dai))
      .then((n) => (n ? n : tipiDiRipiego(dati, dai)))
      .catch(() => 0);

    // Movimento ridotto: un solo fotogramma fermo, uno vicino alla luce e uno al buio
    if (FERMO) {
      statico = () => {
        misura();
        eroe.x = Math.round(W / 2); eroe.y = TERRA; eroe.cl = respiro; eroe.f = 0;
        const adatti = tipi.filter(entra);
        nemici = [];
        const posa = (T, x, verso, y) => nemici.push({
          tipo: T, verso, stato: 'avanza', t: 0, st: 0, x, y: y ?? TERRA, q0: TERRA, fase: 0, flash: 0, kb: 0,
        });
        const terrestri = adatti.filter((t) => !t.vola), volanti = adatti.filter((t) => t.vola);
        if (terrestri[0]) posa(terrestri[0], eroe.x + 34, -1);
        if (terrestri[1] || terrestri[0]) posa(terrestri[1] || terrestri[0], Math.round(W * 0.14), 1);
        if (volanti[0]) posa(volanti[0], Math.round(W * 0.82), -1, volanti[0].alto + 4);
        posaTelo();
        scena(0);
      };
      statico();
      nemiciPronti.then(statico);
      aRidimensiona(statico);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(statico);
      return;
    }

    const rimisura = () => {
      misura();
      eroe.x = Math.min(eroe.x, W - 10);
      if (eroe.aterra) eroe.y = TERRA;
      else eroe.y = Math.min(eroe.y, TERRA);
      nemici = nemici.filter((e) => entra(e.tipo));
      bombe = [];
      // (SIT8) i Bracci già in scena restano (seguono il loro posto, bracciPosti); si ricreano, entrando dal muro, solo se mancano
      if (tipoBraccio) creaBracci(tipoBraccio);
      if (telo.vero) telo.vero.azzera(); else telo.riserva.azzera();
    };
    aRidimensiona(rimisura);
    // il carattere del titolo arriva dopo: la base del titolo (e le catene) si rimisurano una volta
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(rimisura);

    // Effetti in lettere del gioco: arrivano coi loro moduli; finché mancano restano quelli a pixel
    caricaLettereGioco().then((K) => {
      if (!K) return;
      try {
        // tarature del gioco (TAR1): tre strati a terra (tetti.strati), spruzzo per taglia, corpo dei colpi; niente qui
        const asc = new K.M.Ascii(K.M.ASCII_DATI, K.M.LETTERE);
        lett = { K, asc, C: K.C.colpiDi(asc) };
        misuraLettere();
      } catch (e) { lett = null; }
    });

    // Le altre mosse del protagonista arrivano in sottofondo; finché mancano, il pilota non le sceglie
    for (const k of MOSSE) {
      atlanteOpz(P[k], SPRITE).then((a) => {
        if (!a) return;
        cuociArchi(a);
        if (k === 'scatto') a.ombra = sagoma(a.img, '#e3000f');
        clip[k] = a;
      }).catch(() => {});
    }

    // la scena va da sola: nessun comando del visitatore (la tela non prende clic né tasti)
    ciclo(canvas, passo);
  }

  // ---------- 2. Mostri: mini boss in ASCII animato, nemici comuni fermi con la loro ombra ASCII ----------

  // Fotogramma di `avanza` mostrato per ogni nemico comune: il più leggibile (occhi presenti, corpo più aperto),
  // scelto a mano libera da cambiare qui. Gli altri: il primo.
  const POSA_COMUNI = { 'z24-e01': 6, 'z24-e02': 5, 'z24-e03': 2, 'z24-e04': 7, 'z24-e05': 2, 'z24-e06': 0, 'z24-e07': 3, 'z24-e08': 0, 'z24-e09': 0 };

  // Riquadro del corpo nella cella (pixel opachi attorno al pivot, entro 1,6 altezze sopra e 0,8 sotto: fuori restano
  // archi e proiettili). Fotogrammi `quali` (indici), unione. Se i pixel non si leggono (file://): una stima.
  function corpoDi(a, alt, quali) {
    const px = a.px, py = a.py;
    const wx0 = Math.max(0, Math.floor(px - 1.6 * alt)), wx1 = Math.min(a.fw, Math.ceil(px + 1.6 * alt));
    const wy0 = Math.max(0, Math.floor(py - 1.6 * alt)), wy1 = Math.min(a.fh, Math.ceil(py + 0.8 * alt) + 1);
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    try {
      const c = tela();
      c.width = wx1 - wx0; c.height = wy1 - wy0;
      const g = c.getContext('2d', { willReadFrequently: true });
      for (const f of quali) {
        g.clearRect(0, 0, c.width, c.height);
        g.drawImage(a.img, f * a.fw + wx0, wy0, c.width, c.height, 0, 0, c.width, c.height);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        for (let y = 0; y < c.height; y++) {
          for (let x = 0; x < c.width; x++) {
            if (d[(y * c.width + x) * 4 + 3] <= 40) continue;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
    } catch (e) { x1 = -1; }
    if (x1 < 0) return { x0: px - alt * 0.5, y0: py - alt, x1: px + alt * 0.5, y1: py };
    return { x0: wx0 + x0, y0: wy0 + y0, x1: wx0 + x1 + 1, y1: wy0 + y1 + 1 };
  }
  // Alcuni fotogrammi sparsi di una clip (al più n): basta per il riquadro del corpo
  const sparsi = (a, n) => Array.from({ length: Math.min(n, a.n) }, (_, k) => Math.floor(k * a.n / Math.min(n, a.n)));

  // Lavoro a fette nei momenti liberi del browser (conversioni in ASCII): niente scatto all'ingresso della sezione
  const lavori = [];
  let lavoriAttesi = false;
  function fetta(dl) {
    const fine = performance.now() + 5;
    do { const fn = lavori.shift(); if (fn) fn(); }
    while (lavori.length && (dl && !dl.didTimeout ? dl.timeRemaining() > 3 : performance.now() < fine));
    if (lavori.length) pianifica(); else lavoriAttesi = false;
  }
  function pianifica() {
    lavoriAttesi = true;
    if (window.requestIdleCallback) requestIdleCallback(fetta, { timeout: 250 }); else setTimeout(fetta, 16);
  }
  const aFette = (fn) => { lavori.push(fn); if (!lavoriAttesi) pianifica(); };

  // Campione ridotto di un riquadro di sorgente: una cella per carattere (sorgente fuori cella = vuoto)
  const campM = tela(), gCampM = campM.getContext('2d', { willReadFrequently: true });
  function campione(img, cella, sx0, sy0, sw, sh, cols, rows) {
    if (campM.width !== cols || campM.height !== rows) { campM.width = cols; campM.height = rows; }
    gCampM.imageSmoothingEnabled = true;
    gCampM.imageSmoothingQuality = 'high';
    gCampM.clearRect(0, 0, cols, rows);
    // cella = [x, y, w, h] del fotogramma nell'atlante: si legge solo dentro
    const kx = cols / sw, ky = rows / sh;
    const ax = Math.max(cella[0], sx0), ay = Math.max(cella[1], sy0);
    const bx = Math.min(cella[0] + cella[2], sx0 + sw), by = Math.min(cella[1] + cella[3], sy0 + sh);
    if (bx > ax && by > ay) gCampM.drawImage(img, ax, ay, bx - ax, by - ay, (ax - sx0) * kx, (ay - sy0) * ky, (bx - ax) * kx, (by - ay) * ky);
    try { return gCampM.getImageData(0, 0, cols, rows).data; } catch (e) { return null; }
  }

  // Mini boss come sprite del gioco: la vetrina (`G.miniboss[id].vetrina`, fase 3 cotta dal gioco a 4× con ombra e aura
  // in lettere dentro; cammina sul posto e fa un gesto) a ciclo coi suoi `durations`; senza, `clip.fermo` (1×). Una tela
  // grande quanto il riquadro (tutto tagliato dentro), corpo centrato e appoggiato a una terra comune; aTerra: il pivot
  // della clip sta già a terra (vetrina), sennò si appoggia il fondo del corpo.
  function bossSprite(li, nome, a, corpo, Nstriscia, aTerra) {
    const cv = tela();
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', nome + ', mini boss del gioco');
    li.prepend(cv);
    return { li, cv, g: null, a, corpo, N: Nstriscia, aTerra, t: 0, fUlt: -1, sd: 1, Wc: 1, Hc: 1, X: 0, Y: 0 };
  }
  // sd: px CSS per px della striscia (1, 1/2, … per le strisce a 4×; intero per quelle a 1×)
  function dimensionaBoss(v, larg, Hbox, sd) {
    v.sd = sd;
    v.Wc = Math.max(1, Math.floor(larg / sd)); v.Hc = Math.max(1, Math.floor(Hbox / sd));
    v.g = dimensiona(v.cv, v.Wc, v.Hc, sd);
    v.cv.style.width = v.Wc * sd + 'px'; v.cv.style.height = v.Hc * sd + 'px';
    const c = v.corpo, a = v.a, terra = Math.round(10 / sd);
    v.X = Math.round(v.Wc / 2 - ((c.x0 + c.x1) / 2 - a.px));
    v.Y = v.Hc - terra - (v.aTerra ? 0 : Math.round(c.y1 - a.py));
    v.fUlt = -1;
  }
  function disegnaBoss(v) {
    const a = v.a, f = fotogramma(a, v.t);
    if (f === v.fUlt || !v.g) return false;
    v.fUlt = f;
    v.g.clearRect(0, 0, v.Wc, v.Hc);
    v.g.drawImage(a.img, f * a.fw, 0, a.fw, a.fh, v.X - a.px, v.Y - a.py, a.fw, a.fh);
    return true;
  }

  // Alfabeto delle ombre ASCII dei nemici comuni
  const ALF_M = ' .:-=+*#%@';
  // Ombra ASCII di un nemico comune: lo stesso fotogramma in caratteri bordeaux, poco più grande e spostata
  const TONI_OMBRA_C = ['#2e0810', '#4a0c14', '#6a1018', '#8a141e'];
  function ombraComune(v) {
    const { cw, ch } = v.ombra.prepara(innerWidth < 760 ? 5 : 6, ALF_M, TONI_OMBRA_C, 1.5);
    const cols = Math.max(4, Math.round(v.dw * 1.12 / cw)), rows = Math.max(3, Math.round(v.dh * 1.12 / ch));
    v.ombra.dimensiona(cols, rows);
    aFette(() => {
      const d = campione(v.img, [v.f * v.fw, 0, v.fw, v.fh], v.f * v.fw + v.x0, v.y0, v.w, v.h, cols, rows);
      if (!d) return;
      const n = cols * rows, car = new Uint8Array(n), col = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const al = d[i * 4 + 3] / 255;
        if (al < 0.12) continue;
        const lum = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
        car[i] = Math.min(9, 1 + Math.floor(al * (0.5 + 0.5 * lum) * 9));
        col[i] = Math.min(3, Math.floor(lum * 4));
      }
      v.ombra.disegna(car, col);
    });
  }

  function mostri(sez) {
    caricaGioco().then((G) => {
      if (!G) return;
      const ulBoss = sez.querySelector('.mostri__boss');
      const ulFila = sez.querySelector('.mostri__fila');
      const boss = [], comuni = [];
      const voceLi = (ul, cls, testo) => {
        const li = document.createElement('li');
        li.className = cls;
        const p = document.createElement('p');
        if (cls === 'boss') p.className = 'boss__nome';
        p.textContent = testo;
        li.append(p);
        ul.appendChild(li);
        return li;
      };
      // Le voci (solo i nomi) subito, le immagini quando la sezione si avvicina allo schermo
      const capi = Object.entries(G.miniboss || {}).filter(([, m]) => m && (m.vetrina || (m.clip && (m.clip.fermo || m.clip.avanza))));
      // Ordine voluto da Carlo (dal più grosso); niente doppioni piccoli (`-mini`)
      const ORDINE = ['z24-e04', 'z24-e01', 'z24-e05', 'z24-e02', 'z24-e07', 'z24-e06', 'z24-e09', 'z24-e08', 'z24-e03'];
      const posto = (id) => { const k = ORDINE.indexOf(id); return k < 0 ? ORDINE.length : k; };
      const elencoComuni = Object.entries(G.nemici || {}).filter(([id, n]) => !(n && n.piccolo) && !id.endsWith('-mini'))
        .sort((x, y) => posto(x[0]) - posto(y[0]));
      if (!capi.length && !elencoComuni.length) return;
      const liBoss = capi.map(([id, m]) => voceLi(ulBoss, 'boss', m.nome || id));
      const liComuni = elencoComuni.map(([id, n]) => voceLi(ulFila, 'comune', (n && n.nome) || id));
      sez.hidden = false;
      ulBoss.hidden = !capi.length;
      ulFila.hidden = !elencoComuni.length;

      quandoVicino(sez, async () => {
        const Hbox = () => (innerWidth < 760 ? 300 : 340);
        // Mini boss: la sola clip `vetrina` (ripiego: `fermo`); corpo dai dati (`corpo: [x, y, w, h]`) o misurato
        await Promise.all(capi.map(async ([id, m], j) => {
          const d = m.vetrina || m.clip.fermo || m.clip.avanza;
          if (!String(d.file || '').startsWith(id)) console.warn('[mostri] clip estranea per', id, d.file);
          const a = await atlanteOpz(d, GIOCO);
          if (!a) { liBoss[j].remove(); return; }
          const N = Math.max(1, Math.round(+d.scala || 1)), alt = (+m.altezza_px || a.fh * 0.5) * N;
          const corpo = Array.isArray(d.corpo) && d.corpo.length === 4
            ? { x0: d.corpo[0], y0: d.corpo[1], x1: d.corpo[0] + d.corpo[2], y1: d.corpo[1] + d.corpo[3] }
            : corpoDi(a, alt, sparsi(a, 8));
          boss[j] = bossSprite(liBoss[j], m.nome || id, a, corpo, N, !!m.vetrina);
        }));
        // Nemici comuni: un solo fotogramma di `avanza`, ritagliato sul corpo, con dietro la sua ombra ASCII
        await Promise.all(elencoComuni.map(async ([id, n], j) => {
          const a = await atlanteOpz(n && n.clip && n.clip.avanza, GIOCO);
          if (!a) { liComuni[j].remove(); return; }
          const f = Math.min(a.n - 1, POSA_COMUNI[id] || 0), alt = +n.altezza_px || a.fh * 0.5;
          const c = corpoDi(a, alt, [f]), x0 = Math.floor(c.x0), y0 = Math.floor(c.y0);
          const w = Math.ceil(c.x1) - x0, h = Math.ceil(c.y1) - y0;
          const fig = document.createElement('div');
          fig.className = 'comune__figura';
          liComuni[j].prepend(fig);
          const ombra = A && A.Griglia ? new A.Griglia(fig, 'comune__ombra') : null;
          if (ombra) ombra.cv.style.animationDelay = -j * 0.7 + 's';
          const cv = tela();
          cv.setAttribute('role', 'img');
          cv.setAttribute('aria-label', (n.nome || id) + ', nemico del gioco');
          fig.append(cv);
          dimensiona(cv, w, h, 0).drawImage(a.img, f * a.fw + x0, y0, w, h, 0, 0, w, h);
          comuni[j] = { li: liComuni[j], cv, ombra, img: a.img, f, fw: a.fw, fh: a.fh, x0, y0, w, h, dw: w, dh: h };
        }));

        // Scala comune dei mini boss: stessi px CSS per px di gioco per i tre (il Pressatore resta il più grosso).
        // Strisce a N× (vetrina, 4×): 1:1, oppure ridotte di un fattore intero r se non entrano (su telefono almeno 1/2),
        // mai ingrandite; il riquadro si alza fino a 480 px perché entri il corpo (si taglia solo l'aura). Strisce a 1×:
        // ingrandite a scala intera col corpo più alto a circa il 75% del riquadro.
        const scala = () => {
          const vivi = boss.filter(Boolean);
          if (vivi.length) {
            const larg = Math.max(60, vivi[0].li.clientWidth - 24), Nm = Math.max(...vivi.map((v) => v.N));
            const Hg = Math.max(...vivi.map((v) => (v.corpo.y1 - v.corpo.y0) / v.N));   // corpo più alto, px di gioco
            const Wg = Math.max(...vivi.map((v) => (v.corpo.x1 - v.corpo.x0) / v.N));
            const base = Hbox();
            let k, Hb = base;
            if (Nm > 1) {
              let r = innerWidth < 760 ? 2 : 1;
              while (r < 8 && (Hg * Nm / r > 480 * 0.8 || Wg * Nm / r > larg)) r++;
              k = Nm / r;                                          // px CSS per px di gioco
              Hb = Math.max(base, Math.min(480, Math.ceil(Hg * k / 0.78)));
            } else k = Math.max(1, Math.floor(base * 0.75 / Hg));
            for (const v of vivi) {
              dimensionaBoss(v, larg, Hb, k / v.N);
              disegnaBoss(v);
            }
          }
          const maxH = innerWidth < 760 ? 110 : 140;
          for (const v of comuni) {
            if (!v) continue;
            const spazio = Math.max(16, v.li.clientWidth - 12);
            const k = Math.max(1, Math.floor(Math.min(spazio / v.w, maxH / v.h)));
            v.dw = v.w * k; v.dh = v.h * k;
            v.cv.style.width = v.dw + 'px';
            v.cv.style.height = v.dh + 'px';
            if (v.ombra) ombraComune(v);
          }
        };
        scala();
        aRidimensiona(scala);
        if (FERMO) return;

        // la vetrina a ciclo coi suoi tempi; sfasati; fuori schermo o a scheda nascosta si ferma (ciclo)
        boss.forEach((v, j) => { if (v) v.t = j * 330; });
        ciclo(sez, (dt) => {
          for (const v of boss) if (v) { v.t += dt * 1000; disegnaBoss(v); }
        });
      });
    }).catch(() => {});
  }

  // ---------- 3. Chiusura: passeggiata sulle fasce ----------

  async function scenaChiusura(canvas) {
    const dati = await caricaDati();
    const P = dati.protagonista;
    const boss = dati.nemici_fermi.find((f) => f.file.startsWith('b24'));
    if (!boss) return;
    // corsa armata e respiro con la pistola (subito); le altre clip della sequenza arrivano dopo
    const [cammino, attesa, custode] = await Promise.all([
      atlanteOpz(P.corsa_pistola, SPRITE).then((a) => a || atlante(P.cammino, SPRITE)),
      atlanteOpz(P.respiro_pistola, SPRITE).then((a) => a || atlante(P.attesa, SPRITE)),
      carica(SPRITE + boss.file)]);
    const clip = {};
    for (const k of ['scatto', 'salto_stacco', 'salto_sale', 'salto_apice', 'salto_cade', 'salto_doppio', 'atterraggio',
      'fendente_1', 'fendente_2', 'sparo_su', 'scivolata', 'scivolata_esce']) {
      atlanteOpz(P[k], SPRITE).then((a) => {
        if (!a) return;
        cuociArchi(a);
        if (k === 'scatto') a.ombra = sagoma(a.img, '#e3000f');
        clip[k] = a;
      }).catch(() => {});
    }
    // passo accordato alla clip: la velocità dei dati, così i piedi non scivolano
    const V_PASSO = (P.corsa_pistola && P.corsa_pistola.velocita) || (P.cammino && P.cammino.velocita) || 55;
    const V_SCIV = (P.scivolata && P.scivolata.velocita) || 200, G = 640, V_SALTO = Math.sqrt(2 * G * 34), V_SCATTO = 250;
    let statico = null;
    const telo = mantelloScena(() => { if (FERMO && statico) statico(); }), P6 = new Float32Array(6), SP = new Float32Array(4);
    const rc = analizza({ img: custode, fw: boss.w, fh: boss.h, n: 1 }, false).r;
    const palco = canvas.parentElement;
    let g, s = 1, W = 200, H = 100, Hb = 76;

    // La tela sale sopra la fascia (in trasparenza sulla roccia ASCII) quanto serve ai salti; la fascia resta alta Hb
    function misura() {
      const larg = innerWidth;
      s = larg > 1600 ? 3 : larg >= 760 ? 2 : 1;
      Hb = Math.max(76, rc.y1 - rc.y0 + 4);   // mai meno del protagonista (72 px di cella, pivot a 68)
      H = Hb + 72;                             // salto e doppio salto
      W = Math.floor(palco.clientWidth / s);
      g = dimensiona(canvas, W, H, s);
      palco.style.minHeight = Hb * s + 'px';
    }

    // Il Custode in un angolo, rivolto al centro, fermo: il bordo basso dei piedi sulla linea di terra
    const cx = () => W - Math.ceil((rc.x1 - rc.x0) / 2) - 6;
    const limite = () => Math.max(20, cx() - Math.ceil((rc.x1 - rc.x0) / 2) - 16);
    function disegnaCustode() {
      disegna(g, custode, 0, 0, boss.w, boss.h, Math.round((rc.x0 + rc.x1) / 2), rc.y1, cx(), H, -1);
    }
    // Protagonista col mantello (lo stesso dell'apertura): telo dietro, poi lo sprite
    function disegnaEroe(a, ms, x, y, verso, dt, hvx, hvy) {
      const f = fotogramma(a, ms);
      if (telo.vero) {
        if (dt) telo.vero.passo(dt, a, f, x, y, verso, ms % a.tot, hvx, hvy, y >= H - 0.5 ? H : 1e9);
        telo.vero.dietro(g);
      } else if (agganci(a, f, x, y, verso, P6, SP)) {
        if (dt) telo.riserva.aggiorna(dt, P6, SP, verso, hvx, hvy, H);
        telo.riserva.disegna(g);
      }
      disegna(g, a.img, f * a.fw, 0, a.fw, a.fh, a.px, a.py, x, y, verso);
      if (telo.vero) telo.vero.sopra(g);
      // arco del fendente, se la clip lo ha in questo fotogramma
      if (a.archi && a.arco[f]) disegna(g, a.archi, f * a.fw, 0, a.fw, a.fh, a.px, a.py, x, y, verso);
      return f;
    }
    // il telo si posa fermo prima del primo disegno
    function posaTelo(a, x, verso) {
      if (telo.vero) {
        telo.vero.azzera();
        for (let k = 0; k < 90; k++) telo.vero.passo(1 / 60, a, 0, x, H, verso, 0, 0, 0, H);
      } else {
        telo.riserva.azzera();
        if (agganci(a, 0, x, H, verso, P6, SP)) for (let k = 0; k < 90; k++) telo.riserva.aggiorna(1 / 60, P6, SP, verso, 0, 0, H);
      }
    }

    misura();
    if (FERMO) {
      statico = () => {
        misura();
        const x = Math.round(limite() * 0.35);
        posaTelo(attesa, x, 1);
        g.clearRect(0, 0, W, H);
        disegnaCustode();
        disegnaEroe(attesa, 0, x, H, 1, 0, 0, 0);
      };
      statico();
      aRidimensiona(statico);
      return;
    }

    // ---- Sequenza in loop: un giro è 5–6 azioni mescolate con pause, mai due giri uguali di fila ----
    // corsa, scatto, salto (anche doppio, verso la roccia), scivolata, respiro, fendenti a vuoto, raffica verso l'alto,
    // avvicinamento al Custode e ritirata in scatto all'indietro; poi riparte nell'altro verso
    const AZIONI = ['corsa', 'scatto', 'salto', 'doppio', 'scivolata', 'fendenti', 'raffica', 'custode'];
    const e = { x: 24, y: H, vx: 0, vy: 0, aterra: true, verso: 1, az: '', azT: 0, t: 0, cl: attesa, meta: 0, coda: [], giro: '',
      doppio: false, colpi: 0, cad: 0, px: 24, py: H, hvx: 0, hvy: 0, scia: [], sciaT: 0 };
    let parti = [], spari = [], lampo = 0, lx = 0, ly = 0;
    function nuovoGiro() {
      let lista, chiave, k = 0;
      do {
        lista = AZIONI.filter((a) => Math.random() < 0.7).sort(() => Math.random() - 0.5).slice(0, 6);
        while (lista.length < 5) lista.push(AZIONI[Math.floor(Math.random() * AZIONI.length)]);
        chiave = lista.join(',');
      } while (chiave === e.giro && ++k < 5);
      e.giro = chiave;
      // fra le azioni, corse e respiri: il giro finisce col cambio di verso
      e.coda = [];
      for (const a of lista) { e.coda.push(a); if (Math.random() < 0.5) e.coda.push(Math.random() < 0.5 ? 'respiro' : 'corsa'); }
      e.coda.push('giro');
    }
    const polvere = (x, n, dir) => {
      for (let i = 0; i < n && parti.length < 40; i++) {
        parti.push({ x: x + caso(-3, 3), y: H - 1, vx: (dir || (i % 2 ? 1 : -1)) * caso(15, 45), vy: -caso(6, 22), t: 0, vita: caso(0.3, 0.55) });
      }
    };
    const max = () => limite();
    function inizia(az) {
      e.az = az; e.azT = 0;
      const libera = max() - 12;
      switch (az) {
        case 'corsa': e.meta = Math.round(caso(12 + libera * 0.15, 12 + libera * 0.85)); e.verso = e.meta > e.x ? 1 : -1; break;
        case 'scatto': if (!clip.scatto) { e.az = ''; return; } if (e.x + e.verso * 60 > max() || e.x + e.verso * 60 < 12) e.verso *= -1; e.scia = []; break;
        case 'salto': case 'doppio':
          if (!clip.salto_sale) { e.az = ''; return; }
          e.aterra = false; e.vy = -V_SALTO; e.vx = e.verso * 70; e.doppio = az === 'doppio'; polvere(e.x, 4, 0); break;
        case 'scivolata': if (!clip.scivolata) { e.az = ''; return; } if (e.x + e.verso * 80 > max() || e.x + e.verso * 80 < 12) e.verso *= -1; break;
        case 'fendenti': if (!clip.fendente_1) { e.az = ''; return; } e.colpi = 0; break;
        case 'raffica': if (!clip.sparo_su) { e.az = ''; return; } e.colpi = 0; e.cad = 0; break;
        case 'custode': e.meta = max(); e.verso = 1; e.fase = 0; break;
        case 'respiro': e.durata = caso(0.9, 1.5); break;
      }
    }
    // clip e tempo della posa per l'azione in corso
    function posa() {
      if (!e.aterra) {
        if (e.az === 'doppio' && e.doppioT >= 0 && clip.salto_doppio && e.doppioT < clip.salto_doppio.tot) return [clip.salto_doppio, e.doppioT];
        return [clip[e.vy < -60 ? 'salto_sale' : e.vy < 60 ? 'salto_apice' : 'salto_cade'] || attesa, e.t];
      }
      switch (e.az) {
        case 'corsa': return [cammino, e.t];
        case 'custode': return [e.fase === 1 ? attesa : e.fase === 2 ? clip.scatto || cammino : cammino, e.fase === 2 ? e.azT : e.t];
        case 'scatto': return [clip.scatto, e.azT];
        case 'scivolata': return e.azT < clip.scivolata.tot ? [clip.scivolata, e.azT] : [clip.scivolata_esce || attesa, e.azT - clip.scivolata.tot];
        case 'fendenti': { const a = clip[e.colpi ? 'fendente_2' : 'fendente_1'] || clip.fendente_1; return [a, e.azT]; }
        case 'raffica': return [clip.sparo_su, e.azT % clip.sparo_su.tot];
        case 'atterra': return [clip.atterraggio || attesa, e.azT];
      }
      return [attesa, e.t];
    }
    function passo(dt) {
      const ms = dt * 1000, M = max();
      e.azT += ms; e.t += ms; e.px = e.x; e.py = e.y;
      if (!e.az) { if (!e.coda.length) nuovoGiro(); inizia(e.coda.shift()); }
      switch (e.az) {
        case 'corsa':
          e.x += e.verso * V_PASSO * dt;
          if ((e.meta - e.x) * e.verso <= 0) { e.x = e.meta; e.az = ''; }
          break;
        case 'scatto':
          e.x += e.verso * V_SCATTO * dt;
          e.sciaT -= dt;
          if (e.sciaT <= 0) { e.sciaT = 0.035; e.scia.push({ x: e.x, y: e.y, f: 0, v: e.verso, t: 0, ms: e.azT }); polvere(e.x - e.verso * 4, 1, -e.verso); }
          if (e.azT >= clip.scatto.tot) e.az = '';
          break;
        case 'scivolata': {
          const a = clip.scivolata;
          if (e.azT < a.tot) { e.x += e.verso * V_SCIV * dt; if (Math.random() < 0.5) polvere(e.x, 1, -e.verso); }
          if (e.azT >= a.tot + (clip.scivolata_esce ? clip.scivolata_esce.tot : 0)) e.az = '';
          break;
        }
        case 'fendenti': {
          const a = clip[e.colpi ? 'fendente_2' : 'fendente_1'] || clip.fendente_1;
          if (e.azT >= a.tot) { if (e.colpi === 0 && clip.fendente_2) { e.colpi = 1; e.azT = 0; } else e.az = ''; }
          break;
        }
        case 'raffica':
          e.cad -= dt;
          if (e.cad <= 0 && e.colpi < 4) {
            // colpo verso l'alto, dalla bocca della posa (dati della clip)
            const a = clip.sparo_su, b = a.bocca && (a.bocca[1] || a.bocca[0]);
            lx = b ? e.x + e.verso * (b[0] - a.px) : e.x + e.verso * 3; ly = b ? e.y + (b[1] - a.py) : e.y - 58;
            spari.push({ x: lx, y: ly, vx: b ? b[2] * e.verso * 260 : 0, vy: b ? b[3] * 260 : -260 });
            lampo = 0.06; e.cad = 0.18; e.colpi++;
          }
          if (e.colpi >= 4 && e.cad <= -0.25) e.az = '';
          break;
        case 'custode':
          // avvicinamento, un attimo davanti al Custode, poi ritirata in scatto all'indietro (guardandolo)
          if (e.fase === 0) {
            e.verso = 1;
            e.x += V_PASSO * dt;
            if (e.x >= e.meta) { e.x = e.meta; e.fase = 1; e.azT = 0; }
          } else if (e.fase === 1) {
            if (e.azT > 450) { e.fase = 2; e.azT = 0; e.scia = []; }
          } else {
            e.x -= V_SCATTO * dt;
            e.sciaT -= dt;
            if (e.sciaT <= 0) { e.sciaT = 0.035; e.scia.push({ x: e.x, y: e.y, f: 0, v: 1, t: 0, ms: e.azT }); polvere(e.x + 4, 1, 1); }
            if (e.azT >= (clip.scatto ? clip.scatto.tot : 230) * 1.3) e.az = '';
          }
          break;
        case 'respiro': if (e.azT >= e.durata * 1000) e.az = ''; break;
        case 'atterra': if (e.azT >= 220) e.az = ''; break;
        case 'giro': e.verso *= -1; e.az = ''; break;
      }
      // salto: gravità, doppio salto all'apice, atterraggio con polvere
      if (!e.aterra) {
        e.vy += G * dt;
        if (e.doppio && e.vy > -30 && e.doppioT === undefined) { e.vy = -V_SALTO * 0.85; e.doppioT = 0; polvere(e.x, 3, 0); }
        if (e.doppioT !== undefined) e.doppioT += ms;
        e.x += e.vx * dt; e.y += e.vy * dt;
        if (e.y >= H) { e.y = H; e.aterra = true; e.vy = 0; e.vx = 0; e.doppio = false; e.doppioT = undefined; e.az = 'atterra'; e.azT = 0; polvere(e.x, 5, 0); }
      }
      if (e.x < 12 || e.x > M) { e.x = Math.max(12, Math.min(M, e.x)); if (e.az === 'corsa') e.az = ''; }
      if (dt > 0) { const k = Math.min(1, dt * 12); e.hvx += ((e.x - e.px) / dt - e.hvx) * k; e.hvy += ((e.y - e.py) / dt - e.hvy) * k; }
      // effetti leggeri
      for (const p of parti) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; }
      parti = parti.filter((p) => p.t < p.vita);
      for (const b of spari) { b.x += b.vx * dt; b.y += b.vy * dt; }
      spari = spari.filter((b) => b.y > -6 && b.x > -6 && b.x < W + 6);
      for (const q of e.scia) q.t += dt;
      e.scia = e.scia.filter((q) => q.t < 0.22);
      lampo -= dt;
    }
    function disegnaTutto(dt) {
      g.clearRect(0, 0, W, H);
      disegnaCustode();
      // scia rossa dello scatto
      const sc = clip.scatto;
      if (sc && sc.ombra) {
        for (const q of e.scia) {
          g.globalAlpha = 0.55 * (1 - q.t / 0.22);
          disegna(g, sc.ombra, fotogramma(sc, q.ms) * sc.fw, 0, sc.fw, sc.fh, sc.px, sc.py, q.x, q.y, q.v);
        }
        g.globalAlpha = 1;
      }
      const [a, tm] = posa();
      if (a !== e.cl) { e.cl = a; e.t = 0; }
      disegnaEroe(a, tm ?? e.t, e.x, e.y, e.verso, dt, e.hvx, e.hvy);
      g.fillStyle = '#a89a8a';
      for (const p of parti) {
        g.globalAlpha = 0.7 * (1 - p.t / p.vita);
        g.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
      }
      g.globalAlpha = 1;
      for (const b of spari) {   // colpi verso l'alto: corpo oro con nucleo bianco
        g.fillStyle = '#ffc93a'; g.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 1, 2, 4);
        g.fillStyle = '#fff'; g.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 1, 2, 1);
      }
      if (lampo > 0) { g.fillStyle = '#fff1b8'; g.fillRect(Math.round(lx) - 1, Math.round(ly) - 2, 3, 3); }
    }
    aRidimensiona(() => { misura(); e.y = Math.min(e.y, H); if (e.aterra) e.y = H; posaTelo(attesa, e.x, e.verso); });
    posaTelo(cammino, e.x, e.verso);
    ciclo(canvas, (dt) => { passo(dt); disegnaTutto(dt); });
  }

  // ---------- 4. ASCII: logo, copertina, divisorio ----------

  // Logo a colori quantizzati: grigi della pietra, bianco del teschio, ottone dell'elsa, acciaio della lama
  const TONI_ROCCIA = ['#5a5e54', '#7f8476', '#a9ad9e', '#eeebe3', '#d6a23c', '#aeb7c2'];

  async function logoAscii(box) {
    const img = box.querySelector('img');
    const div = box.querySelector('.ascii');
    if (!A || !img || !div) return;
    const sorg = await carica(img.currentSrc || img.src);
    const palco = box.parentElement;
    div.hidden = false;
    const band = bandieraLogo(sorg);   // null: pixel non leggibili, la conversione resta com'è
    const ok = A.blocco({
      contenitore: div, modo: 'larghezza', rifila: true, margineAlto: 2, altezzaMax: 520,
      misura: () => ({ w: palco.clientWidth - 2 * parseFloat(getComputedStyle(palco).paddingLeft || 0), h: 0 }),
      colonne: (w) => (w < 560 ? 60 : w < 960 ? 84 : 110),
      fotogramma: () => [sorg, 0, 0, sorg.width, sorg.height],
      tavolozza: TONI_ROCCIA, fps: 1000 / 120,
      // teschio della bandiera ritoccato al suo posto; la scansione del logo (e l'onda del drappo) sopra
      ritocco: band ? band.ritocco : null,
      effetto: (st, t) => { A.effetti.scansione(st, t); if (band) band.onda(st, t); },
    });
    if (!ok) { div.hidden = true; return; }
    img.classList.add('solo-lettore');
  }

  // Teschio della bandiera nel logo: la conversione rende il teschio vero come una macchia di glifi chiari. Si lavora
  // SOLO dentro il riquadro delle sue celle (pixel chiari del drappo, misurati sull'immagine): se ci sta (≥ 7 × 5 celle)
  // un teschio pieno con glifi densi della stessa rampa, in bianco osso (con le ossa incrociate se il riquadro è ≥ 11 × 7);
  // se no la bandiera resta grigia senza teschio e un'onda lenta di un tono attraversa il drappo in diagonale.
  // Misure su media/roccia.webp (892 × 690): teschio e ossa 486–573 × 104–191 px (88 × 88): circa 10,9 × 6,5 celle a 110
  // colonne (schermo largo: teschio con ossa), 8,3 × 5 a 84 (teschio), 5,9 × 3,6 a 60 (telefono: bandiera con l'onda).
  const TESCHI_PIENI = [
    ['   #####   ', '  #######  ', '  #  #  #  ', '  ### ###  ', '##  # #  ##', '   #####   ', '##       ##'],
    [' ##### ', '#######', '#  #  #', '### ###', ' # # # '],
  ];
  const DRAPPO = { x0: 420, y0: 75, x1: 630, y1: 215 };   // riquadro del drappo nell'immagine
  function bandieraLogo(sorg) {
    // riquadro dei pixel chiari (teschio e ossa) dentro il drappo; senza lettura dei pixel non si tocca niente
    let chiari = null;
    try {
      const c = tela(), w = DRAPPO.x1 - DRAPPO.x0, h = DRAPPO.y1 - DRAPPO.y0;
      c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(sorg, DRAPPO.x0, DRAPPO.y0, w, h, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const k = (y * w + x) * 4;
          if (0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2] <= 170) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      if (x1 >= 0) chiari = { x0: DRAPPO.x0 + x0, y0: DRAPPO.y0 + y0, x1: DRAPPO.x0 + x1 + 1, y1: DRAPPO.y0 + y1 + 1 };
    } catch (e) { return null; }
    if (!chiari) return null;
    const iw = sorg.width, ih = sorg.height;
    let chiave = '', B = null, D = null, M = null, mx = 0, my = 0;
    const celle = (r, st) => ({   // riquadro in celle della griglia rifilata
      c0: Math.floor(r.x0 / iw * st.cols), c1: Math.ceil(r.x1 / iw * st.cols),
      r0: Math.floor(r.y0 / ih * st.campRows) - st.y0, r1: Math.ceil(r.y1 / ih * st.campRows) - st.y0,
    });
    function misura(st) {
      const k = st.cols + 'x' + st.rows + 'x' + st.campRows + 'x' + st.y0;
      if (k === chiave) return;
      chiave = k;
      B = celle(chiari, st); D = celle(DRAPPO, st);
      const w = B.c1 - B.c0, h = B.r1 - B.r0;
      // la misura vera (non arrotondata alle celle) decide se il teschio ci sta, con mezza cella di tolleranza
      const wv = (chiari.x1 - chiari.x0) / iw * st.cols + 0.5, hv = (chiari.y1 - chiari.y0) / ih * st.campRows + 0.5;
      M = TESCHI_PIENI.find((m) => m[0].length <= Math.min(w, wv) && m.length <= Math.min(h, hv)) || null;
      if (M) { mx = B.c0 + ((w - M[0].length) >> 1); my = B.r0 + ((h - M.length) >> 1); }
    }
    // ritocco fisso: il riquadro del teschio prende il grigio del drappo (dalla cella a sinistra), poi il teschio pieno
    function ritocco(car, col, st) {
      misura(st);
      const W = st.cols, R = st.rows, cs = Math.max(0, B.c0 - 1), rs = Math.max(0, Math.min(R - 1, (B.r0 + B.r1) >> 1));
      const fc = car[rs * W + cs], fk = col[rs * W + cs];
      for (let y = Math.max(0, B.r0); y < Math.min(R, B.r1); y++) {
        for (let x = Math.max(0, B.c0); x < Math.min(W, B.c1); x++) { car[y * W + x] = fc; col[y * W + x] = fk; }
      }
      if (!M) return;
      for (let y = 0; y < M.length; y++) {
        const yy = my + y;
        if (yy < 0 || yy >= R) continue;
        for (let x = 0; x < M[y].length; x++) {
          if (M[y][x] !== '#') continue;
          const xx = mx + x;
          if (xx < 0 || xx >= W) continue;
          // osso: glifi densi della rampa (@ % #), bianco osso (TONI_ROCCIA[3])
          car[yy * W + xx] = y === 0 || x === 0 || x === M[y].length - 1 ? 8 : (x + y) % 3 ? 9 : 7;
          col[yy * W + xx] = 3;
        }
      }
      // (Carlo 18/11) sopra il cranio deve esserci uno strato di grigio del drappo: la conversione lascia un vuoto dove
      // l'immagine ha il bianco del teschio. Dalla prima riga del drappo fino a quella sopra il teschio si riempiono i
      // vuoti fra il primo e l'ultimo carattere della riga, col grigio del drappo (fc, fk). Ripeterlo non cambia nulla.
      for (let y = Math.max(0, my - 1); y < my; y++) {   // solo la riga sopra il cranio: le righe più in alto restano com'erano, così il bordo del drappo ondeggia
        let a = -1, b = -1;
        for (let x = Math.max(0, D.c0 - 1); x < Math.min(W, D.c1 + 1); x++) if (car[y * W + x]) { if (a < 0) a = x; b = x; }
        if (y === my - 1) { a = a < 0 ? B.c0 : Math.min(a, B.c0); b = Math.max(b, B.c1 - 1); }
        else if (a < 0 || b - a < 3) continue;   // riga vuota, o solo l'asta: non è drappo   // la riga sopra il cranio copre tutto il teschio
        for (let x = a; x <= b; x++) if (!car[y * W + x]) { car[y * W + x] = fc; col[y * W + x] = fk; }
      }
    }
    // senza teschio: un'onda lenta di un tono attraversa il drappo in diagonale (stoffa al vento)
    function onda(st, t) {
      if (M || !D) return;
      const W = st.cols, R = st.rows, cur = st.cur, base = st.base, R1 = st.R - 1;
      const larg = D.c1 - D.c0 + D.r1 - D.r0, p = ((t * 4) % (larg + 8)) - 4;
      for (let y = Math.max(0, D.r0); y < Math.min(R, D.r1); y++) {
        for (let x = Math.max(0, D.c0); x < Math.min(W, D.c1); x++) {
          const i = y * W + x;
          if (base[i] && Math.abs(x - D.c0 + y - D.r0 - p) < 1.5) cur[i] = Math.min(R1, base[i] + 1);
        }
      }
    }
    return { ritocco, onda };
  }

  // Copertina dietro i «24»: rossi scuri e grigi freddi che respirano
  const TONI_FONDO = ['#5a0b12', '#3a070c', '#2e3136', '#44474d', '#5e5a53'];

  function fondoAlbum(sez) {
    const fondo = sez.querySelector('.album__fondo');
    if (!A || !fondo) return;
    quandoVicino(sez, async () => {
      let img;
      try { img = await carica('media/copertina.jpg'); } catch (e) { return; }
      A.blocco({
        contenitore: fondo, modo: 'copri', fs: (w) => (w < 760 ? 9 : 13), fuoco: [0.5, 0.25],
        fotogramma: () => [img, 0, 0, img.width, img.height],
        tavolozza: TONI_FONDO, gamma: 0.9, soglia: 0.14, effetto: A.effetti.respiro, fps: 8, dpr: 1.5,
      });
    });
  }

  // Riga divisoria: catena che scorre, onda sopra e sotto, scintille rosse che passano
  function divisore(el) {
    if (!A) return;
    const ALF = " .',-=o~*#+";
    const COL = ['#34373d', '#5a5e66', '#e3000f', '#8c000a'];
    const RIGHE = 3, CATENA = [6, 4, 5, 4], CODA = [9, 8, 10, 7, 4];
    const t = new A.Tela(el);
    let cols = 0, car = null, col = null, scintille = [];
    function misura() {
      const fs = innerWidth < 760 ? 11 : 14;
      cols = Math.max(8, Math.floor(el.clientWidth / (fs * A.aspettoFont())));
      t.dimensiona(cols, RIGHE, fs);
      car = new Uint8Array(cols * RIGHE);
      col = new Uint8Array(cols * RIGHE);
      scintille = Array.from({ length: Math.max(1, Math.round(cols / 60)) }, () => ({ x: caso(0, cols), v: caso(1.2, 2.6) }));
    }
    function passo(_, n) {
      car.fill(0); col.fill(0);
      for (let x = 0; x < cols; x++) {
        const m = (x + n) % 4;
        car[cols + x] = CATENA[m];
        col[cols + x] = m === 0 ? 1 : 0;
        const o = Math.sin(x * 0.22 - n * 0.3);
        if (o > 0.55) car[x] = o > 0.85 ? 2 : 1;
        if (o < -0.55) car[2 * cols + x] = o < -0.85 ? 3 : 1;
      }
      for (const sc of scintille) {
        sc.x += sc.v;
        if (sc.x - CODA.length > cols) { sc.x = -caso(4, cols * 0.6); sc.v = caso(1.2, 2.6); }
        for (let k = 0; k < CODA.length; k++) {
          const x = Math.round(sc.x) - k;
          if (x < 0 || x >= cols) continue;
          car[cols + x] = CODA[k];
          col[cols + x] = k < 2 ? 2 : 3;
        }
      }
      t.disegna(car, col, ALF, COL);
    }
    misura();
    let n = 0;
    A.anima(el, 9, (tm, k) => { n = k; passo(tm, k); });
    aRidimensiona(() => { misura(); passo(0, n); });
  }

  // ---------- 5. Titolo: colatura ASCII ----------

  // Gocce rosso scuro che colano dalle lettere (le catene ora stanno nella scena). Griglia di glifi da atlante:
  // si ridisegnano solo le righe cambiate; le misure del DOM si leggono solo al ridimensionamento.
  function titoloAscii(testo) {
    const h1 = testo.querySelector('.titolo-gioco');
    if (!A || !A.Griglia || !h1 || !COLATURA) return;
    const t = new A.Griglia(testo, 'apertura__ascii');
    // 0 spazio, 1 |, 2 o, 3 :, 4 !, 5 .
    const ALF = ' |o:!.';
    const COL = ['#3a0710', '#5a0b12', '#8a1018', '#e3000f'];
    let cols = 0, rows = 0, cw = 7, ch = 12, car = null, col = null, gocce = [], tratti = [], prima = 0;
    const base = { x: 0, y: 0 };   // angolo del riquadro nel documento (per il cursore, senza misure nel ciclo)
    const mouse = { x: -1e4, y: -1e4 };

    function misura() {
      const r = testo.getBoundingClientRect(), h = h1.getBoundingClientRect();
      const fs = innerWidth < 760 ? 10 : 13;
      ({ cw, ch } = t.prepara(fs, ALF, COL, 1.5));
      cols = Math.ceil(r.width / cw); rows = Math.ceil(r.height / ch);
      t.dimensiona(cols, rows);
      car = new Uint8Array(cols * rows); col = new Uint8Array(cols * rows);
      base.x = r.left + window.scrollX; base.y = r.top + window.scrollY;
      // le gocce nascono solo dal bordo inferiore delle aste (profilo misurato del titolo); senza, niente gocce
      // solo aste larghe almeno un carattere: il centro della cella cade sempre dentro l'asta
      tratti = trattiTitolo(h1).map((q) => ({ x0: q.x0 - r.left, x1: q.x1 - r.left, y: q.y - r.top })).filter((q) => q.x1 - q.x0 >= cw);
      gocce = [];
      if (!tratti.length) return;
      const quante = Math.max(4, Math.round((h.right - h.left) / cw / 6));
      for (let k = 0; k < quante; k++) gocce.push(nuovaGoccia({}, caso(0, 4)));
    }
    function nuovaGoccia(q, attesa) {
      const t = tratti[Math.floor(Math.random() * tratti.length)];
      q.c = Math.max(0, Math.min(cols - 1, Math.floor(caso(t.x0 + cw / 2, t.x1 - cw / 2) / cw)));
      q.r0 = Math.floor(t.y / ch);
      q.len = 0; q.max = caso(2, 11); q.v = caso(0.3, 1.1); q.cade = false; q.dr = 0; q.dv = 0; q.attesa = attesa;
      return q;
    }
    function passoGocce(dt) {
      for (const q of gocce) {
        if (q.attesa > 0) { q.attesa -= dt; continue; }
        if (!q.cade) {
          q.len += q.v * dt;
          if (q.len >= q.max) { q.cade = true; q.dr = q.r0 + q.len; q.dv = 0; }
        } else {
          q.dv += 30 * dt; q.dr += q.dv * dt;
          q.r0 += 1.6 * dt; q.len -= 1.6 * dt;   // la scia si ritira dall'alto
          if (q.len <= 0 && q.dr > rows) nuovaGoccia(q, caso(0.5, 3));
        }
      }
    }
    const metti = (c, r, k, tono) => {
      if (c < 0 || c >= cols || r < 0 || r >= rows) return;
      const i = r * cols + c;
      car[i] = k; col[i] = tono;
    };
    function disegna() {
      car.fill(0); col.fill(0);
      const mx = (mouse.x - base.x) / cw, my = (mouse.y - base.y) / ch;
      for (const q of gocce) {
        if (q.attesa > 0 || q.len <= 0) { if (q.cade && q.attesa <= 0) metti(q.c, Math.floor(q.dr), q.dv > 8 ? 5 : 2, 2); continue; }
        const a = Math.floor(q.r0), b = Math.floor(q.r0 + q.len);
        for (let r = a; r <= b; r++) {
          const d = b - r;
          let c = q.c, tono = d === 0 ? 2 : r - a < 2 ? 1 : 0;
          const dx = c - mx, dy = r - my;
          if (dx * dx + dy * dy < 25) { c += dx < 0 ? -1 : 1; tono = d === 0 ? 3 : 2; }   // vicino al cursore: si scosta e si accende
          metti(c, r, d === 0 ? 2 : d === 1 ? 3 : (r % 3 ? 1 : 4), tono);
        }
        if (q.cade) metti(q.c, Math.floor(q.dr), q.dv > 8 ? 5 : 2, 2);
      }
      t.disegna(car, col);
    }

    window.addEventListener('pointermove', (e) => { mouse.x = e.pageX; mouse.y = e.pageY; }, { passive: true });
    misura();
    disegna();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { misura(); disegna(); });
    aRidimensiona(() => { misura(); disegna(); });
    A.anima(testo, 30, (tm) => {
      const dt = prima ? Math.min(0.05, Math.max(0, tm - prima)) : 0;
      prima = tm;
      if (dt) passoGocce(dt);
      disegna();
    });
  }

  // ---------- Avvio: se qualcosa manca, quella parte resta com'è ----------

  // Schermo largo con mouse: nell'apertura gira il gioco vero (modalità vetrina) dentro un iframe.
  // Altrove, o se la vetrina non parte, resta la scena leggera su canvas.
  const VETRINA_URL = '../strumenti/pennino/gioco/vetrina.html';
  const scena = document.getElementById('scena');
  const avviaScena = () => { if (scena && scena.getContext) scenaApertura(scena).catch(() => {}); };
  const apertura = document.querySelector('.apertura');
  // Carlo (17/11): preferisce la scena leggera; la vetrina resta pronta ma spenta
  const USA_VETRINA = false;
  const adatta = USA_VETRINA && window.matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)').matches
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (apertura && adatta) {
    const quadro = document.createElement('iframe');
    quadro.className = 'apertura__vetrina';
    quadro.title = 'SUPERPERSONA: il gioco che gira da solo; clicca per giocare';
    quadro.src = VETRINA_URL;
    const conto = document.querySelector('[data-vetrina-uccisi]');
    let pronta = false;
    // Se entro 45 s il gioco non si è disegnato si torna alla scena leggera
    const ripiego = setTimeout(() => { if (!pronta) { quadro.remove(); apertura.classList.remove('con-vetrina'); avviaScena(); } }, 45000);
    window.addEventListener('message', (e) => {
      if (e.source !== quadro.contentWindow || !e.data || e.data.tipo !== 'vetrina') return;
      if (e.data.pronto) { pronta = true; clearTimeout(ripiego); apertura.classList.add('vetrina-pronta'); }
      if (e.data.errore) { clearTimeout(ripiego); quadro.remove(); apertura.classList.remove('con-vetrina'); avviaScena(); }
      if (typeof e.data.uccisi === 'number' && conto) conto.textContent = 'UCCISI ' + String(Math.min(999, e.data.uccisi)).padStart(3, '0');
    });
    apertura.classList.add('con-vetrina');
    apertura.prepend(quadro);
    // Fuori schermo o a scheda nascosta il gioco si ferma
    let vista = true;
    const pausa = () => { try { quadro.contentWindow.postMessage({ tipo: 'vetrina', pausa: !vista || document.hidden }, '*'); } catch (_) {} };
    if ('IntersectionObserver' in window) new IntersectionObserver((v) => { vista = v[0].isIntersecting; pausa(); }, { threshold: 0.05 }).observe(apertura);
    document.addEventListener('visibilitychange', pausa);
  } else {
    avviaScena();
  }
  const chiusura = document.querySelector('.chiusura__scena');
  if (chiusura && chiusura.getContext) scenaChiusura(chiusura).catch(() => {});
  const logo = document.querySelector('.chiusura__logo');
  if (logo) logoAscii(logo).catch(() => {});
  const vetrina = document.getElementById('mostri');
  if (vetrina) mostri(vetrina);
  const album = document.querySelector('.album');
  if (album) fondoAlbum(album);
  const riga = document.querySelector('.divisore');
  if (riga) divisore(riga);
  const testoApertura = document.querySelector('.apertura__testo');
  // la colatura parte dopo il primo disegno della pagina e della scena, quando il browser è libero
  const dopoIlPrimoDisegno = (fn) => requestAnimationFrame(() => {
    if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: 800 }); else setTimeout(fn, 120);
  });
  if (testoApertura) dopoIlPrimoDisegno(() => { try { titoloAscii(testoApertura); } catch (e) { /* il titolo resta com'è */ } });
})();
