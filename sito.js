// Roccia Games — piccoli comportamenti del sito

// (Carlo 18/11) La demo non è ancora giocabile: i bottoni non portano da nessuna parte
// (il cursore «e volevi» è in stile.css). Quando la demo sarà in linea: mettere qui
// l'indirizzo e togliere il blocco del clic.
const DEMO_URL = null;

document.querySelectorAll('[data-demo]').forEach((a) => {
  if (DEMO_URL) { a.href = DEMO_URL; return; }
  a.setAttribute('href', '#');
  a.setAttribute('aria-disabled', 'true');
  a.addEventListener('click', (e) => { e.preventDefault(); });
});

const fermo = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// (Carlo 18/11) «Guarda il gameplay»: apre il video demo in uno schermo sopra il sito e lo avvia; X, Esc o un tocco fuori lo chiudono.
{
  const schermo = document.getElementById('video-demo'), v = schermo && schermo.querySelector('video');
  if (schermo && v && typeof schermo.showModal === 'function') {
    document.querySelectorAll('[data-guarda]').forEach((a) => {
      a.addEventListener('click', (e) => { e.preventDefault(); schermo.showModal(); v.play().catch(() => {}); });
    });
    schermo.querySelectorAll('[data-chiudi-video]').forEach((b) => b.addEventListener('click', () => { v.pause(); schermo.close(); }));
    schermo.addEventListener('click', (e) => { if (e.target === schermo) schermo.close(); });   // tocco sul fondo, fuori dal video
    schermo.addEventListener('close', () => { v.pause(); });
  }
}

// Con movimento ridotto restano i poster: niente video in riproduzione.
if (!fermo) {
  const avvia = (v) => { v.play().catch(() => {}); };

  // Clip: partono quando entrano nello schermo, si fermano quando escono.
  const clip = document.querySelectorAll('video[data-vista]');
  if ('IntersectionObserver' in window) {
    const osservatore = new IntersectionObserver((voci) => {
      voci.forEach(({ target, isIntersecting }) => {
        if (isIntersecting) avvia(target);
        else target.pause();
      });
    }, { threshold: 0.35 });
    clip.forEach((v) => osservatore.observe(v));
  } else {
    clip.forEach(avvia);
  }
}
