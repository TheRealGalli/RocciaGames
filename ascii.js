// Roccia Games — motore ASCII del sito: un'immagine (o un fotogramma che cambia nel tempo)
// diventa un blocco di caratteri su <canvas>, in un solo colore o a colori quantizzati.
// Si aggiorna a pochi fotogrammi al secondo e si ferma fuori schermo, a scheda nascosta
// e con movimento ridotto (un fotogramma solo).
(() => {
  'use strict';

  const FERMO = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
  const RAMPA = ' .:-=+*#%@';

  // Larghezza di un carattere rispetto alla sua altezza (misurata una volta)
  let aspetto = 0;
  function aspettoFont() {
    if (!aspetto) {
      const g = document.createElement('canvas').getContext('2d');
      g.font = '100px ' + FONT;
      aspetto = g.measureText('M').width / 100 || 0.6;
    }
    return aspetto;
  }

  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

  // Tela d'appoggio per leggere i pixel ridotti a una cella per carattere
  const app = document.createElement('canvas');
  const gApp = app.getContext('2d', { willReadFrequently: true });

  // Luminosità (per l'alfa) e colore di ogni cella; null se il canvas è «sporco» (file://)
  function campiona(img, sx, sy, sw, sh, cols, rows) {
    app.width = cols; app.height = rows;
    gApp.imageSmoothingEnabled = true;
    gApp.imageSmoothingQuality = 'high';
    gApp.clearRect(0, 0, cols, rows);
    gApp.drawImage(img, sx, sy, sw, sh, 0, 0, cols, rows);
    let d;
    try { d = gApp.getImageData(0, 0, cols, rows).data; } catch (e) { return null; }
    const n = cols * rows, lum = new Float32Array(n), alfa = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = i * 4;
      alfa[i] = d[k + 3] / 255;
      lum[i] = (0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]) / 255;
    }
    return { d, lum, alfa, n };
  }

  // Tavolozza: ogni tono con la sua luminosità e la sua «tinta» (colore meno luminosità)
  function tavolozzaDi(lista) {
    return lista.map((h) => {
      const [r, g, b] = rgb(h), l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return [r - l, g - l, b - l, l];
    });
  }
  // Tono più vicino: conta soprattutto la tinta, poco la luminosità (quella la danno i caratteri)
  function vicino(tav, r, g, b) {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let best = 0, min = Infinity;
    for (let k = 0; k < tav.length; k++) {
      const t = tav[k], a = r - l - t[0], c = g - l - t[1], e = b - l - t[2], dl = l - t[3];
      const v = 2 * (a * a + c * c + e * e) + 0.5 * dl * dl;
      if (v < min) { min = v; best = k; }
    }
    return best;
  }

  // Campione → indice del carattere nella rampa e indice del colore
  function converti(c, R, o, tav) {
    const { lum, alfa, d, n } = c;
    const val = new Float32Array(n);
    let max = 0.01;
    for (let i = 0; i < n; i++) {
      // sagoma: conta la presenza (alfa) più della luce, così anche un mostro scuro resta pieno
      val[i] = o.sagoma ? alfa[i] * (0.4 + 0.6 * lum[i]) : alfa[i] * lum[i];
      if (val[i] > max) max = val[i];
    }
    if (o.normalizza === false) max = 1;
    const gamma = o.gamma || 0.75, soglia = o.soglia ?? 0.1;
    const car = new Uint8Array(n), col = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = Math.pow(val[i] / max, gamma);
      if (v < soglia) continue;
      car[i] = Math.min(R - 1, 1 + Math.floor(v * (R - 1)));
      if (tav) col[i] = vicino(tav, d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    }
    return { car, col };
  }

  // ---------- Tela: disegna caratteri a tratti dello stesso colore per riga ----------

  function Tela(contenitore, classe) {
    this.cv = document.createElement('canvas');
    this.cv.setAttribute('aria-hidden', 'true');
    if (classe) this.cv.className = classe;
    contenitore.appendChild(this.cv);
    this.g = this.cv.getContext('2d');
    this.cols = 0; this.rows = 0; this.fs = 10; this.cw = 6;
  }
  Tela.prototype.dimensiona = function (cols, rows, fs, dprMax) {
    const dpr = Math.min(dprMax || 2, window.devicePixelRatio || 1);
    const g = this.g, font = fs + 'px ' + FONT;
    // passo del carattere misurato alla misura vera (ridimensionare il canvas azzera il contesto)
    g.font = font;
    const cw = g.measureText('M').width || fs * aspettoFont();
    this.cols = cols; this.rows = rows; this.fs = fs; this.cw = cw;
    this.cv.width = Math.max(1, Math.ceil(cols * cw * dpr));
    this.cv.height = Math.max(1, Math.ceil(rows * fs * dpr));
    this.cv.style.width = cols * cw + 'px';
    this.cv.style.height = rows * fs + 'px';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.font = font;
    g.textBaseline = 'top';
  };
  // car: indici in `alfabeto` (0 = spazio), col: indici in `colori`
  Tela.prototype.disegna = function (car, col, alfabeto, colori) {
    const { g, cols, rows, fs, cw } = this;
    g.clearRect(0, 0, cols * cw + 2, rows * fs + 2);
    let stile = '';
    for (let y = 0; y < rows; y++) {
      let tratto = '', c = -1, x0 = 0;
      const yy = y * fs;
      for (let x = 0, i = y * cols; x < cols; x++, i++) {
        const ch = car[i];
        if (!ch) { if (c >= 0) tratto += ' '; continue; }
        const k = col[i];
        if (k !== c) {
          if (tratto) {
            if (stile !== colori[c]) g.fillStyle = stile = colori[c];
            g.fillText(tratto, x0 * cw, yy);
          }
          c = k; x0 = x; tratto = '';
        }
        tratto += alfabeto[ch];
      }
      if (tratto) {
        if (stile !== colori[c]) g.fillStyle = stile = colori[c];
        g.fillText(tratto, x0 * cw, yy);
      }
    }
  };

  // ---------- Ciclo lento: fps fissi, fermo fuori schermo e a scheda nascosta ----------

  function anima(el, fps, fn) {
    let n = 0;
    fn(performance.now() / 1000, n++);
    if (FERMO) return;
    const passo = 1000 / fps;
    let id = 0, prima = 0, acc = 0, visibile = !('IntersectionObserver' in window);
    const gira = (t) => {
      id = requestAnimationFrame(gira);
      acc += Math.min(250, t - prima);
      prima = t;
      if (acc < passo) return;
      acc %= passo;
      fn(t / 1000, n++);
    };
    const aggiorna = () => {
      const vai = visibile && !document.hidden;
      if (vai && !id) { prima = performance.now(); acc = 0; id = requestAnimationFrame(gira); }
      else if (!vai && id) { cancelAnimationFrame(id); id = 0; }
    };
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((voci) => {
        visibile = voci[voci.length - 1].isIntersecting;
        aggiorna();
      }).observe(el);
    }
    document.addEventListener('visibilitychange', aggiorna);
    aggiorna();
  }

  // ---------- Blocco da immagine ----------
  // opz: contenitore, fotogramma(i) → [img, sx, sy, sw, sh], fotogrammi, quale(t) → indice,
  //      modo 'larghezza' (colonne(w), altezzaMax, rifila) | 'copri' (fs(w), fuoco [fx, fy]) | 'contieni' (fs(w)),
  //      colore (mono) oppure tavolozza ['#rrggbb', …], sagoma, gamma, soglia, effetto(st, t), fps, dpr, classe, misura() → {w, h}
  function blocco(opz) {
    const rampa = opz.rampa || RAMPA;
    const tav = opz.tavolozza ? tavolozzaDi(opz.tavolozza) : null;
    const colori = opz.tavolozza || [opz.colore || '#e9e6df'];
    const tela = new Tela(opz.contenitore, opz.classe);
    const st = { cols: 0, rows: 0, R: rampa.length, base: null, cur: null, pieni: null, n: 0 };
    let quadri = [], taglio = null, campRows = 0, y0 = 0, chiave = '', ultimo = 0;

    const misura = opz.misura || (() => ({ w: opz.contenitore.clientWidth, h: opz.contenitore.clientHeight }));

    // Fotogramma i → caratteri e colori (una volta per fotogramma e per misura)
    function quadro(i) {
      if (quadri[i]) return quadri[i];
      const [img, sx, sy, sw, sh] = opz.fotogramma(i);
      const [tx, ty, tw, th] = taglio(sw, sh);
      const c = campiona(img, sx + tx, sy + ty, tw, th, st.cols, campRows);
      if (!c) return null;
      let q = converti(c, rampa.length, opz, tav);
      if (campRows !== st.rows) {
        const a = y0 * st.cols, b = (y0 + st.rows) * st.cols;
        q = { car: q.car.slice(a, b), col: q.col.slice(a, b) };
      }
      q.pieni = [];
      for (let k = 0; k < q.car.length; k++) if (q.car[k]) q.pieni.push(k);
      return (quadri[i] = q);
    }

    function costruisci() {
      const { w, h } = misura();
      const k = w + 'x' + (opz.modo === 'larghezza' ? 0 : h);
      if (k === chiave) return true;
      chiave = '';
      quadri = [];
      const asp = aspettoFont();
      const [, , , sw, sh] = opz.fotogramma(0);
      let fs;
      taglio = (a, b) => [0, 0, a, b];
      if (opz.modo === 'larghezza') {
        st.cols = opz.colonne(w);
        campRows = Math.max(1, Math.round(st.cols * (sh / sw) * asp));
        st.rows = campRows; y0 = 0;
        const q = quadro(0);
        if (!q) return false;
        if (opz.rifila) {
          // via le righe vuote in alto e in basso
          const vuota = (y) => { for (let x = 0; x < st.cols; x++) if (q.car[y * st.cols + x]) return false; return true; };
          let a = 0, b = campRows;
          while (a < b && vuota(a)) a++;
          while (b > a && vuota(b - 1)) b--;
          if (b <= a) return false;
          a = Math.max(0, a - (opz.margineAlto || 0));   // righe vuote tenute in alto per chi ritocca sopra il disegno (bandiera del logo)
          y0 = a; st.rows = b - a; quadri = [];
        }
        fs = Math.min(w / (st.cols * asp), (opz.altezzaMax || 1e9) / st.rows);
        fs = Math.max(4, Math.floor(fs * 10) / 10);
      } else {
        fs = opz.fs(w);
        if (opz.modo === 'copri') {
          st.cols = Math.ceil(w / (fs * asp));
          st.rows = Math.ceil(h / fs);
          const rapp = (st.cols * asp) / st.rows, [fx, fy] = opz.fuoco || [0.5, 0.5];
          taglio = (a, b) => (a / b > rapp
            ? [(a - b * rapp) * fx, 0, b * rapp, b]
            : [0, (b - a / rapp) * fy, a, a / rapp]);
        } else {
          st.cols = Math.floor(w / (fs * asp));
          st.rows = Math.round(st.cols * asp * sh / sw);
          const maxR = Math.floor(h / fs);
          if (st.rows > maxR) { st.rows = maxR; st.cols = Math.round(st.rows * sw / (sh * asp)); }
        }
        campRows = st.rows; y0 = 0;
      }
      if (st.cols < 4 || st.rows < 2) return false;
      st.cur = new Uint8Array(st.cols * st.rows);
      tela.dimensiona(st.cols, st.rows, fs, opz.dpr);
      tela.y0 = y0; tela.campRows = campRows;   // righe tolte in alto dal rifilo e righe del campione (per chi sovrappone)
      st.y0 = y0; st.campRows = campRows;
      if (!quadro(0)) return false;
      chiave = k;
      return true;
    }

    function aggiorna(t, n) {
      ultimo = t;
      const q = quadro(opz.quale ? opz.quale(t) : 0) || quadri[0];
      if (!q) return;
      st.base = q.car; st.pieni = q.pieni; st.n = n;
      let col = q.col;
      if (opz.ritocco) {
        // (facoltativo) ritocco fisso di caratteri e colori su una copia del fotogramma, anche con movimento ridotto;
        // l'effetto lavora poi sul fotogramma ritoccato
        if (!st.baseR || st.baseR.length !== q.car.length) { st.baseR = new Uint8Array(q.car.length); st.colR = new Uint8Array(q.col.length); }
        st.baseR.set(q.car); st.colR.set(q.col);
        opz.ritocco(st.baseR, st.colR, st);
        st.base = st.baseR; col = st.colR;
      }
      st.cur.set(st.base);
      if (opz.effetto && !FERMO) opz.effetto(st, t);
      tela.disegna(st.cur, col, rampa, colori);
    }

    if (!costruisci()) { tela.cv.remove(); return null; }
    anima(tela.cv, opz.fps || 8, aggiorna);
    let atteso = 0;
    window.addEventListener('resize', () => {
      if (atteso) return;
      atteso = requestAnimationFrame(() => {
        atteso = 0;
        const prima = chiave;
        if (!costruisci()) { tela.cv.hidden = true; return; }
        tela.cv.hidden = false;
        if (chiave !== prima) aggiorna(ultimo, st.n);
      });
    });
    return tela;
  }

  // ---------- Effetti ----------

  // Logo: una riga schiarita che scende più qualche carattere che tremola
  function scansione(st) {
    const { cols, rows, cur, base, pieni, R } = st;
    const riga = st.n % rows;
    for (let x = 0, i = riga * cols; x < cols; x++, i++) if (base[i]) cur[i] = Math.min(R - 1, base[i] + 2);
    const quanti = Math.ceil(pieni.length * 0.015);
    for (let k = 0; k < quanti; k++) {
      const i = pieni[Math.floor(Math.random() * pieni.length)];
      cur[i] = Math.max(1, Math.min(R - 1, base[i] + (Math.random() < 0.5 ? -1 : 1)));
    }
  }

  // Sfondi: onda lenta di luminosità più una fascia chiara che scende
  function respiro(st, t) {
    const { cols, rows, cur, base, R } = st;
    const banda = ((t * 5) % (rows + 16)) - 8;
    for (let y = 0; y < rows; y++) {
      const dy = Math.abs(y - banda);
      const su = (dy < 1.5 ? 2 : dy < 4 ? 1 : 0) + Math.round(Math.sin(t * 0.8 - y * 0.16) * 0.9);
      if (!su) continue;
      for (let x = 0, i = y * cols; x < cols; x++, i++) {
        if (base[i]) cur[i] = Math.max(1, Math.min(R - 1, base[i] + su));
      }
    }
  }

  // ---------- Griglia: glifi pre-disegnati in un atlante e copiati con drawImage ----------
  // Niente fillText né misure del testo nel ciclo: l'atlante (alfabeto × colori) si fa una volta per misura;
  // a ogni disegno si ridisegnano solo le righe cambiate.

  const atlanti = new Map();
  function atlanteGlifi(alfabeto, colori, fs, dpr) {
    const chiave = alfabeto + '|' + colori.join(',') + '|' + fs + '|' + dpr;
    let a = atlanti.get(chiave);
    if (a) return a;
    const c = document.createElement('canvas'), g = c.getContext('2d');
    const font = fs * dpr + 'px ' + FONT;
    g.font = font;
    const cw = Math.max(1, Math.round(g.measureText('M').width)), ch = Math.max(1, Math.round(fs * dpr));
    c.width = cw * alfabeto.length; c.height = ch * colori.length;
    g.font = font;
    g.textBaseline = 'top';
    for (let k = 0; k < colori.length; k++) {
      g.fillStyle = colori[k];
      for (let i = 1; i < alfabeto.length; i++) g.fillText(alfabeto[i], i * cw, k * ch);
    }
    a = { c, cw, ch };
    if (atlanti.size > 24) atlanti.clear();
    atlanti.set(chiave, a);
    return a;
  }

  function Griglia(contenitore, classe) {
    this.cv = document.createElement('canvas');
    this.cv.setAttribute('aria-hidden', 'true');
    if (classe) this.cv.className = classe;
    if (contenitore) contenitore.appendChild(this.cv);
    this.g = this.cv.getContext('2d');
    this.cols = 0; this.rows = 0; this.a = null; this.cw = 6; this.ch = 10; this.dpr = 1;
    this.prec = null; this.precC = null; this.sporca = true;
  }
  // Glifi: alfabeto (indice 0 = spazio), colori, corpo in px CSS. Restituisce il passo del carattere in px CSS.
  Griglia.prototype.prepara = function (fs, alfabeto, colori, dprMax) {
    const dpr = Math.min(dprMax || 2, window.devicePixelRatio || 1);
    this.a = atlanteGlifi(alfabeto, colori, fs, dpr);
    this.dpr = dpr; this.cw = this.a.cw / dpr; this.ch = this.a.ch / dpr;
    return { cw: this.cw, ch: this.ch };
  };
  Griglia.prototype.dimensiona = function (cols, rows) {
    const a = this.a;
    this.cols = cols; this.rows = rows;
    this.cv.width = Math.max(1, cols * a.cw); this.cv.height = Math.max(1, rows * a.ch);
    this.cv.style.width = cols * this.cw + 'px';
    this.cv.style.height = rows * this.ch + 'px';
    this.prec = new Uint8Array(cols * rows); this.precC = new Uint8Array(cols * rows);
    this.sporca = true;
  };
  // car: indici nell'alfabeto (0 = vuoto), col: indici nei colori
  Griglia.prototype.disegna = function (car, col) {
    const g = this.g, cols = this.cols, rows = this.rows, a = this.a, prec = this.prec, precC = this.precC;
    if (!a) return;
    for (let y = 0; y < rows; y++) {
      const i0 = y * cols, i1 = i0 + cols;
      let cambia = this.sporca;
      for (let i = i0; !cambia && i < i1; i++) if (car[i] !== prec[i] || (car[i] && col[i] !== precC[i])) cambia = true;
      if (!cambia) continue;
      g.clearRect(0, y * a.ch, cols * a.cw, a.ch);
      for (let i = i0, x = 0; i < i1; i++, x++) {
        const c = car[i];
        prec[i] = c; precC[i] = col[i];
        if (c) g.drawImage(a.c, c * a.cw, col[i] * a.ch, a.cw, a.ch, x * a.cw, y * a.ch, a.cw, a.ch);
      }
    }
    this.sporca = false;
  };

  window.RocciaAscii = { FONT, RAMPA, FERMO, aspettoFont, Tela, Griglia, glifi: atlanteGlifi, anima, blocco, effetti: { scansione, respiro } };
})();
