// Based on React Bits PixelBlast (JS-CSS) — reactbits.dev
// Cambiato: niente React, solo la forma quadrata e niente piano inclinato; colori del gioco, velo scuro al centro,
// pixel tenui e più vivi sotto il cursore; eventi sulla sezione #gioca, deriva lenta su touch, fermo con reduced-motion.
(function avvia() {
  'use strict';

  // Opzioni regolabili (nomi come le props dell'originale)
  var OPZIONI = {
    pixelSize: 6,              // lato del pixel in px CSS (pixel art)
    color: '#4a0008',          // bordeaux: pixel a riposo
    accentColor: '#e3000f',    // rosso del gioco: zone dense e sotto il cursore
    hotColor: '#ff2a36',       // tinta dei pixel più caldi (al posto del bianco)
    patternScale: 2,
    patternDensity: 0.7,       // densità bassa
    speed: 0.35,
    drift: 0.2,
    driftAngle: 30,
    softness: 0.6,
    smoothing: 1,
    glow: 0.3,
    twinkle: 0.2,
    edgeFade: 0.35,            // dissolvenza ai bordi
    hoverRadius: 150,          // px CSS
    enableRipples: true,
    rippleSpeed: 0.3,
    rippleThickness: 0.1,
    rippleIntensityScale: 1.2,
    intro: true,               // onda d'apertura la prima volta che la sezione è visibile
    dim: 0.5,                  // luminosità a riposo (1 = come l'originale)
    veil: 0.85,                // velo radiale scuro dietro testo e bottone (0 = niente)
    veilSize: [380, 240],      // raggi del velo in px CSS
    wanderPresence: 0.55,      // su touch: forza della luce che vaga da sola
    maxDpr: 1.5
  };

  var sezione = document.getElementById('gioca');
  var canvas = sezione && sezione.querySelector('.gioca__sfondo');
  if (!canvas) return;
  // Sezione nascosta (telefono, stile.css): niente WebGL; parte se lo schermo si allarga e la sezione si vede
  if (window.getComputedStyle(sezione).display === 'none') {
    var riprova = function () {
      if (window.getComputedStyle(sezione).display === 'none') return;
      window.removeEventListener('resize', riprova);
      avvia();
    };
    window.addEventListener('resize', riprova);
    return;
  }
  var gl = null;
  try {
    gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  } catch (e) { gl = null; }
  if (!gl) return; // senza WebGL2 la sezione resta nera

  var MAX_CLICKS = 10;
  var INTRO_SECONDS = 1.8;
  var RANGE_MIN = -6;
  var RANGE_MAX = 10;
  function bayer2(x, y) { return (Math.floor(x) / 2 + Math.floor(y) * Math.floor(y) * 0.75) % 1; }
  function bayer8(x, y) { return (bayer2(x / 4, y / 4) * 0.25 + bayer2(x / 2, y / 2)) * 0.25 + bayer2(x, y); }
  var tabella = [];
  for (var b = 0; b < 64; b++) tabella.push(bayer8(b % 8, Math.floor(b / 8)).toFixed(6));
  var BAYER_TABLE = tabella.join(', ');

  var VERTEX = '#version 300 es\n' +
    'void main() {\n' +
    '  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));\n' +
    '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);\n' +
    '}';

  var PACKING = `
const float RANGE_MIN = ${RANGE_MIN.toFixed(1)};
const float RANGE_MAX = ${RANGE_MAX.toFixed(1)};
vec2 pack16(float value) {
  float x = floor(clamp((value - RANGE_MIN) / (RANGE_MAX - RANGE_MIN), 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(x / 256.0);
  return vec2(hi, x - hi * 256.0) / 255.0;
}
float unpack16(vec2 c) {
  float x = floor(c.x * 255.0 + 0.5) * 256.0 + floor(c.y * 255.0 + 0.5);
  return RANGE_MIN + x / 65535.0 * (RANGE_MAX - RANGE_MIN);
}
`;

  // Passo 1 (come l'originale): campo di rumore per cella, onde dei clic, scia del cursore
  var CELL_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uResolution;
uniform float uTime;
uniform float uPixelSize;
uniform float uScale;
uniform float uDensity;
uniform int uEnableRipples;
uniform float uRippleSpeed;
uniform float uRippleThickness;
uniform float uRippleIntensity;
uniform vec2 uClickPos[${MAX_CLICKS}];
uniform float uClickAge[${MAX_CLICKS}];
uniform ivec2 uOrigin;
uniform vec2 uDrift;
uniform vec2 uMouse;
uniform float uMouseRadius;
uniform float uMousePresence;
uniform float uIntro;
uniform sampler2D uPrev;
uniform float uDecay;
uniform float uFresh;
out vec4 outCell;
${PACKING}
float hash11(float n) { return fract(sin(n) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 ip = floor(p);
  vec3 fp = fract(p);
  float n000 = hash11(dot(ip + vec3(0.0, 0.0, 0.0), vec3(1.0, 57.0, 113.0)));
  float n100 = hash11(dot(ip + vec3(1.0, 0.0, 0.0), vec3(1.0, 57.0, 113.0)));
  float n010 = hash11(dot(ip + vec3(0.0, 1.0, 0.0), vec3(1.0, 57.0, 113.0)));
  float n110 = hash11(dot(ip + vec3(1.0, 1.0, 0.0), vec3(1.0, 57.0, 113.0)));
  float n001 = hash11(dot(ip + vec3(0.0, 0.0, 1.0), vec3(1.0, 57.0, 113.0)));
  float n101 = hash11(dot(ip + vec3(1.0, 0.0, 1.0), vec3(1.0, 57.0, 113.0)));
  float n011 = hash11(dot(ip + vec3(0.0, 1.0, 1.0), vec3(1.0, 57.0, 113.0)));
  float n111 = hash11(dot(ip + vec3(1.0, 1.0, 1.0), vec3(1.0, 57.0, 113.0)));
  vec3 w = fp * fp * fp * (fp * (fp * 6.0 - 15.0) + 10.0);
  float x00 = mix(n000, n100, w.x);
  float x10 = mix(n010, n110, w.x);
  float x01 = mix(n001, n101, w.x);
  float x11 = mix(n011, n111, w.x);
  float y0 = mix(x00, x10, w.y);
  float y1 = mix(x01, x11, w.y);
  return mix(y0, y1, w.z) * 2.0 - 1.0;
}
float fbm2(vec2 uv, float t) {
  vec3 p = vec3(uv * uScale, t);
  float amp = 1.0;
  float freq = 1.0;
  float sum = 1.0;
  for (int i = 0; i < 5; ++i) {
    sum += amp * vnoise(p * freq);
    freq *= 1.25;
  }
  return sum * 0.5 + 0.5;
}
void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  float aspectRatio = uResolution.x / uResolution.y;
  float cellPixelSize = 8.0 * uPixelSize;
  vec2 cellId = vec2(texel + uOrigin);
  vec2 cellCoord = cellId * cellPixelSize;
  vec2 uv = cellCoord / uResolution * vec2(aspectRatio, 1.0);

  float base = fbm2(uv + uDrift, uTime * 0.05);
  base = base * 0.5 - 0.65;
  float feed = base + (uDensity - 0.5) * 0.3;
  if (uEnableRipples == 1) {
    for (int i = 0; i < ${MAX_CLICKS}; ++i) {
      vec2 pos = uClickPos[i];
      if (pos.x < 0.0) continue;
      vec2 cuv = (((pos - uResolution * 0.5 - cellPixelSize * 0.5) / uResolution)) * vec2(aspectRatio, 1.0);
      float t = max(uClickAge[i], 0.0);
      float r = distance(uv, cuv);
      float waveR = uRippleSpeed * t;
      float ring = exp(-pow((r - waveR) / uRippleThickness, 2.0));
      float atten = exp(-1.0 * t) * exp(-10.0 * r);
      feed = max(feed, ring * atten * uRippleIntensity);
    }
  }
  if (uIntro < 1.0) {
    vec2 center = (-cellPixelSize * 0.5 / uResolution) * vec2(aspectRatio, 1.0);
    float reach = length(vec2(aspectRatio, 1.0)) * 0.5 + 0.2;
    float eased = 1.0 - pow(1.0 - uIntro, 2.4);
    float front = eased * reach;
    float r = distance(uv, center);
    float shown = smoothstep(front + 0.04, front - 0.06, r);
    float ring = exp(-pow((r - front) / 0.07, 2.0)) * (1.0 - uIntro);
    feed = mix(-1.0, feed, shown);
    feed = max(feed, ring * 1.4);
  }
  // effetto "reveal" dell'originale
  vec2 d = (cellCoord + cellPixelSize * 0.5 + uResolution * 0.5 - uMouse) / max(uMouseRadius, 1.0);
  float brush = exp(-dot(d, d)) * uMousePresence;
  vec4 prev = texelFetch(uPrev, texel, 0) * (1.0 - uFresh);
  float trail = max(brush, max(prev.a * uDecay - 1.0 / 255.0, 0.0));
  feed += trail * 0.9;
  outCell = vec4(pack16(feed), clamp((feed + 0.5) * 0.5, 0.0, 1.0), trail);
}`;

  // Passo 2: retino Bayer a pixel quadrati, bagliore, scintillio, bordi sfumati e velo centrale
  var MAIN_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform vec3 uColor;
uniform vec3 uAccent;
uniform vec3 uHot;
uniform vec2 uResolution;
uniform float uClock;
uniform float uPixelSize;
uniform float uEdgeFade;
uniform sampler2D uCells;
uniform ivec2 uOrigin;
uniform ivec2 uCellCount;
uniform float uSoftness;
uniform float uSmoothing;
uniform float uGlow;
uniform float uTwinkle;
uniform float uDim;
uniform float uVeil;
uniform vec2 uVeilSize;
out vec4 fragColor;
${PACKING}
const float BAYER[64] = float[64](${BAYER_TABLE});
vec2 gDx;
vec2 gDy;
float aaFrom(vec2 grad) { return abs(dot(grad, gDx)) + abs(dot(grad, gDy)); }
float maskSquare(vec2 p, float cov, float soft) {
  if (soft <= 0.0) return cov;
  float side = 0.5 * sqrt(clamp(cov, 0.0, 1.0));
  vec2 c = p - 0.5;
  vec2 q = abs(c) - side;
  float d = max(q.x, q.y);
  vec2 grad = q.x > q.y ? vec2(sign(c.x), 0.0) : vec2(0.0, sign(c.y));
  float aa = max(aaFrom(grad), 1e-4);
  return 1.0 - smoothstep(-aa * 0.5, aa * 0.5, d);
}
void main() {
  float pixelSize = uPixelSize;
  vec2 fragCoord = gl_FragCoord.xy - uResolution * 0.5;
  gDx = dFdx(fragCoord) / pixelSize;
  gDy = dFdy(fragCoord) / pixelSize;

  float cellPixelSize = 8.0 * pixelSize;
  vec2 cellId = floor(fragCoord / cellPixelSize);
  ivec2 texel = clamp(ivec2(cellId) - uOrigin, ivec2(0), uCellCount - 1);
  vec2 smoothAt = (fragCoord / cellPixelSize - vec2(uOrigin)) / vec2(uCellCount);
  vec4 blended = texture(uCells, smoothAt);
  float smoothFeed = blended.b * 2.0 - 0.5;
  float feed = smoothFeed;
  float trail = 0.0;
  if (uSmoothing < 1.0) {
    vec4 cell = texelFetch(uCells, texel, 0);
    feed = mix(unpack16(cell.rg), smoothFeed, uSmoothing);
    trail = cell.a;
  } else {
    trail = blended.a;
  }
  if (feed < -0.12 * uSoftness && smoothFeed < 0.2) {
    fragColor = vec4(0.0);
    return;
  }

  vec2 pixelId = floor(fragCoord / pixelSize);
  vec2 pixelUV = fragCoord / pixelSize - pixelId;
  ivec2 cellBits = ivec2(mod(pixelId, 8.0));
  float bayer = BAYER[cellBits.y * 8 + cellBits.x] - 0.5;
  float margin = feed + bayer - 0.5;
  float bw = uSoftness > 0.0 ? smoothstep(-0.12 * uSoftness, 0.12 * uSoftness, margin) : step(0.0, margin);

  float h = fract(sin(dot(pixelId, vec2(127.1, 311.7))) * 43758.5453);
  float heat = max(trail, clamp((feed - 1.0) * 2.5, 0.0, 1.0) * min(uGlow * 2.0, 1.0));
  float coverage = bw * (1.0 + heat * 0.35);
  float M = maskSquare(pixelUV, coverage, uSoftness);

  if (uTwinkle > 0.0) {
    float rate = 1.5 + 3.0 * fract(h * 7.31);
    float wave = 0.5 + 0.5 * sin(uClock * rate + h * 37.0);
    M *= 1.0 - uTwinkle * 0.55 * wave * wave;
  }

  float density = clamp(smoothFeed, 0.0, 1.0);
  float glow = 0.0;
  if (uGlow > 0.0) {
    float bloom = smoothstep(0.2, 1.0, density);
    glow = bloom * bloom * uGlow * 0.22;
  }

  float fade = 1.0;
  if (uEdgeFade > 0.0) {
    vec2 norm = gl_FragCoord.xy / uResolution;
    vec2 edgeA = clamp(norm / uEdgeFade, 0.0, 1.0);
    vec2 edgeB = clamp((1.0 - norm) / uEdgeFade, 0.0, 1.0);
    vec2 sa = edgeA * edgeA * edgeA * (edgeA * (edgeA * 6.0 - 15.0) + 10.0);
    vec2 sb = edgeB * edgeB * edgeB * (edgeB * (edgeB * 6.0 - 15.0) + 10.0);
    fade *= sa.x * sa.y * sb.x * sb.y;
  }
  // tenue a riposo, pieno sotto il cursore; velo radiale dietro il testo
  float hot = clamp(heat, 0.0, 1.0);
  vec2 q = fragCoord / max(uVeilSize, vec2(1.0));
  float veil = uVeil * exp(-dot(q, q));
  fade *= mix(uDim, 1.0, hot) * (1.0 - veil * (1.0 - 0.5 * hot));

  M = clamp(M, 0.0, 1.0) * fade;
  glow *= fade;

  float tone = smoothstep(0.3, 1.0, density) * 0.85;
  vec3 color = mix(uColor, uAccent, max(tone, hot));
  vec3 lit = mix(color, uHot, 0.45 * hot);
  float alpha = M + glow * (1.0 - M);
  vec3 premul = lit * M + color * glow * (1.0 - M);
  fragColor = vec4(premul, alpha);
}`;

  function compila(tipo, sorgente) {
    var s = gl.createShader(tipo);
    if (!s) return null;
    gl.shaderSource(s, sorgente);
    gl.compileShader(s);
    if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s;
    gl.deleteShader(s);
    return null;
  }

  function collega(frammento) {
    var v = compila(gl.VERTEX_SHADER, VERTEX);
    var f = compila(gl.FRAGMENT_SHADER, frammento);
    var p = gl.createProgram();
    if (!v || !f || !p) return null;
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { gl.deleteProgram(p); return null; }
    var u = {};
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(p, i);
      if (!info) continue;
      var nome = info.name.replace(/\[0\]$/, '');
      u[nome] = gl.getUniformLocation(p, nome);
    }
    return { program: p, uniforms: u };
  }

  function rgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  var cellShader = collega(CELL_FRAGMENT);
  var mainShader = collega(MAIN_FRAGMENT);
  if (!cellShader || !mainShader) return;
  var cu = cellShader.uniforms;
  var mu = mainShader.uniforms;
  var vao = gl.createVertexArray();

  // Due bersagli in ping-pong per la scia del cursore
  var targets = [0, 1].map(function () {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    var fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { texture: t, framebuffer: fb };
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  var o = OPZIONI;
  var mm = window.matchMedia ? function (q) { return window.matchMedia(q).matches; } : function () { return false; };
  var fermo = mm('(prefers-reduced-motion: reduce)');
  var touch = mm('(hover: none)');
  var colore = rgb(o.color), accento = rgb(o.accentColor), caldo = rgb(o.hotColor);

  var view = { width: 1, height: 1, ratio: 1 };
  var cells = { x: 0, y: 0, w: 1, h: 1, key: '' };
  var pointer = { x: 0, y: 0, inside: false };
  var mouse = { x: 0, y: 0, ready: false };
  var clickPos = new Float32Array(MAX_CLICKS * 2).fill(-1);
  var clickAt = new Float32Array(MAX_CLICKS);
  var clickAge = new Float32Array(MAX_CLICKS);
  var clickIndex = 0, current = 0, fresh = true;
  var timeOffset = Math.random() * 1000;
  var elapsed = 0, clock = 0, presence = 0, driftX = 0, driftY = 0;
  var introClock = o.intro && !fermo ? 0 : 1;
  var raf = 0, last = 0, visible = false;

  function layoutCells() {
    var cps = 8 * o.pixelSize * view.ratio;
    var w = canvas.width, h = canvas.height;
    var x0 = Math.floor((-w / 2 - cps) / cps);
    var x1 = Math.floor((w / 2 + cps) / cps);
    var y0 = Math.floor((-h / 2 - cps) / cps);
    var y1 = Math.floor((h / 2 + cps) / cps);
    var cw = Math.max(1, Math.min(2048, x1 - x0 + 1));
    var ch = Math.max(1, Math.min(2048, y1 - y0 + 1));
    var key = x0 + ':' + y0 + ':' + cw + ':' + ch;
    if (key === cells.key) return;
    cells.key = key; cells.x = x0; cells.y = y0; cells.w = cw; cells.h = ch;
    targets.forEach(function (t) {
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cw, ch, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    });
    fresh = true;
  }

  function stepCells(decay) {
    var source = targets[current], target = targets[1 - current];
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, cells.w, cells.h);
    gl.disable(gl.BLEND);
    gl.useProgram(cellShader.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source.texture);
    gl.uniform1i(cu.uPrev, 0);
    gl.uniform2f(cu.uResolution, canvas.width, canvas.height);
    gl.uniform1f(cu.uTime, timeOffset + elapsed * o.speed);
    gl.uniform1f(cu.uPixelSize, o.pixelSize * view.ratio);
    gl.uniform1f(cu.uScale, o.patternScale);
    gl.uniform1f(cu.uDensity, o.patternDensity);
    gl.uniform1i(cu.uEnableRipples, o.enableRipples ? 1 : 0);
    gl.uniform1f(cu.uRippleSpeed, o.rippleSpeed);
    gl.uniform1f(cu.uRippleThickness, Math.max(0.001, o.rippleThickness));
    gl.uniform1f(cu.uRippleIntensity, o.rippleIntensityScale);
    gl.uniform2fv(cu.uClickPos, clickPos);
    gl.uniform1fv(cu.uClickAge, clickAge);
    gl.uniform2i(cu.uOrigin, cells.x, cells.y);
    gl.uniform2f(cu.uDrift, driftX, driftY);
    gl.uniform2f(cu.uMouse, mouse.x, mouse.y);
    gl.uniform1f(cu.uMouseRadius, o.hoverRadius * view.ratio);
    gl.uniform1f(cu.uMousePresence, presence);
    gl.uniform1f(cu.uIntro, introClock);
    gl.uniform1f(cu.uDecay, decay);
    gl.uniform1f(cu.uFresh, fresh ? 1 : 0);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    current = 1 - current;
    fresh = false;
  }

  function draw() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(mainShader.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets[current].texture);
    gl.uniform1i(mu.uCells, 0);
    gl.uniform3fv(mu.uColor, colore);
    gl.uniform3fv(mu.uAccent, accento);
    gl.uniform3fv(mu.uHot, caldo);
    gl.uniform2f(mu.uResolution, canvas.width, canvas.height);
    gl.uniform1f(mu.uClock, clock);
    gl.uniform1f(mu.uPixelSize, o.pixelSize * view.ratio);
    gl.uniform1f(mu.uEdgeFade, o.edgeFade);
    gl.uniform2i(mu.uOrigin, cells.x, cells.y);
    gl.uniform2i(mu.uCellCount, cells.w, cells.h);
    gl.uniform1f(mu.uSoftness, o.softness);
    gl.uniform1f(mu.uSmoothing, o.smoothing);
    gl.uniform1f(mu.uGlow, o.glow);
    gl.uniform1f(mu.uTwinkle, fermo ? 0 : o.twinkle);
    gl.uniform1f(mu.uDim, o.dim);
    gl.uniform1f(mu.uVeil, o.veil);
    gl.uniform2f(mu.uVeilSize, o.veilSize[0] * view.ratio, o.veilSize[1] * view.ratio);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  function resize() {
    view.width = Math.max(1, sezione.clientWidth);
    view.height = Math.max(1, sezione.clientHeight);
    view.ratio = Math.min(window.devicePixelRatio || 1, o.maxDpr);
    canvas.width = Math.max(1, Math.round(view.width * view.ratio));
    canvas.height = Math.max(1, Math.round(view.height * view.ratio));
    if (!mouse.ready) {
      mouse.ready = true;
      mouse.x = canvas.width / 2;
      mouse.y = canvas.height / 2;
    }
    layoutCells();
    stepCells(0);
    draw();
    wake();
  }

  function frame(now) {
    raf = 0;
    if (!visible || document.hidden || fermo) return;
    var dt = last ? Math.min(Math.max((now - last) / 1000, 0), 1 / 20) : 0;
    last = now;
    elapsed += dt;
    clock += dt;
    var a = o.driftAngle * Math.PI / 180;
    driftX += Math.cos(a) * o.drift * dt * 0.05;
    driftY += Math.sin(a) * o.drift * dt * 0.05;
    for (var k = 0; k < MAX_CLICKS; k++) clickAge[k] = (clock - clickAt[k]) * 0.5;

    // su touch, senza dito sullo schermo, una luce vaga lenta (deriva)
    var vaga = touch && !pointer.inside;
    var tx, ty, meta;
    if (vaga) {
      tx = view.width * (0.5 + 0.38 * Math.sin(clock * 0.11)) * view.ratio;
      ty = view.height * (0.5 + 0.34 * Math.sin(clock * 0.17 + 1.3)) * view.ratio;
      meta = o.wanderPresence;
    } else {
      tx = pointer.x * view.ratio;
      ty = (view.height - pointer.y) * view.ratio;
      meta = pointer.inside ? 1 : 0;
    }
    if (pointer.inside || vaga) {
      var follow = 1 - Math.exp(-dt / (vaga ? 0.6 : 0.08));
      mouse.x += (tx - mouse.x) * follow;
      mouse.y += (ty - mouse.y) * follow;
    }
    presence += (meta - presence) * (1 - Math.exp(-dt / 0.25));

    layoutCells();
    stepCells(Math.exp(-dt / 0.45));
    draw();
    if (introClock < 1) introClock = Math.min(1, introClock + dt / INTRO_SECONDS);
    raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (!raf && visible && !document.hidden && !fermo) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  }

  function locate(e) {
    var r = sezione.getBoundingClientRect();
    var x = e.clientX - r.left, y = e.clientY - r.top;
    return { x: x, y: y, inside: x >= 0 && y >= 0 && x <= r.width && y <= r.height };
  }

  function addRipple(x, y) {
    clickPos[clickIndex * 2] = x * view.ratio;
    clickPos[clickIndex * 2 + 1] = (view.height - y) * view.ratio;
    clickAt[clickIndex] = clock;
    clickIndex = (clickIndex + 1) % MAX_CLICKS;
    wake();
  }

  // Eventi sulla sezione (il canvas ha pointer-events: none)
  if (!fermo) {
    sezione.addEventListener('pointermove', function (e) {
      var p = locate(e);
      var era = pointer.inside;
      pointer.inside = p.inside;
      if (p.inside) {
        pointer.x = p.x;
        pointer.y = p.y;
        if (!era && !touch) {
          mouse.x = p.x * view.ratio;
          mouse.y = (view.height - p.y) * view.ratio;
        }
      }
    }, { passive: true });
    sezione.addEventListener('pointerdown', function (e) {
      var p = locate(e);
      if (!p.inside) return;
      pointer.inside = true;
      pointer.x = p.x;
      pointer.y = p.y;
      if (o.enableRipples) addRipple(p.x, p.y);
    }, { passive: true });
    sezione.addEventListener('pointerleave', function () { pointer.inside = false; });
    // il dito che si alza non è più un cursore
    var alza = function (e) { if (e.pointerType !== 'mouse') pointer.inside = false; };
    sezione.addEventListener('pointerup', alza, { passive: true });
    sezione.addEventListener('pointercancel', alza, { passive: true });
    document.addEventListener('visibilitychange', wake);
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (voci) {
      visible = voci.some(function (v) { return v.isIntersecting; });
      if (visible) wake();
    }).observe(sezione);
  } else {
    visible = true;
  }

  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(sezione);
  else window.addEventListener('resize', resize);
  resize();
})();
