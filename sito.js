// Roccia Games — piccoli comportamenti del sito

// (Carlo 26/11) La demo è su itch.io: i due bottoni «Gioca la demo» portano alla sua pagina, in una scheda nuova.
const DEMO_URL = 'https://therealgallo.itch.io/superpersona';

document.querySelectorAll('[data-demo]').forEach((a) => {
  a.href = DEMO_URL; a.target = '_blank'; a.rel = 'noopener';
});

const fermo = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// (Carlo 18/11) «Guarda il gameplay»: apre il video demo in uno schermo sopra il sito e lo avvia; X, Esc o un tocco fuori lo chiudono.
{
  const schermo = document.getElementById('video-demo'), v = schermo && schermo.querySelector('video');
  if (schermo && v && typeof schermo.showModal === 'function') {
    const apri = () => { if (!schermo.open) schermo.showModal(); };
    document.querySelectorAll('[data-guarda]').forEach((a) => {
      a.addEventListener('click', (e) => { e.preventDefault(); apri(); v.play().catch(() => {}); });
    });
    schermo.querySelectorAll('[data-chiudi-video]').forEach((b) => b.addEventListener('click', () => { v.pause(); schermo.close(); }));
    schermo.addEventListener('click', (e) => { if (e.target === schermo) schermo.close(); });   // tocco sul fondo, fuori dal video
    schermo.addEventListener('close', () => {
      v.pause();
      zitto();
      // arrivati da video/ (#video): chiuso lo schermo, l'indirizzo torna quello della home
      if (location.hash === '#video') history.replaceState(null, '', location.pathname + location.search);
    });

    // Link condiviso (video/ → ../#video): schermo aperto sul poster, niente avvio con l'audio
    const daLink = () => { if (location.hash === '#video') apri(); };
    daLink();
    window.addEventListener('hashchange', daLink);

    // Condividi: navigator.share subito nel tocco; ripiego: copia del link e avviso; senza appunti, il link selezionabile
    const DATI = { title: 'SUPERPERSONA — video di gameplay', url: 'https://rocciagames.com/video/' };
    const tasto = schermo.querySelector('[data-condividi-video]');
    const testo = schermo.querySelector('[data-avviso-testo]'), campo = schermo.querySelector('[data-avviso-link]');
    let tempo = 0, occupato = false;
    function zitto() { clearTimeout(tempo); if (testo) testo.textContent = ''; if (campo) campo.hidden = true; }
    function avvisa(msg) { zitto(); testo.textContent = msg; tempo = setTimeout(zitto, 2500); }
    async function copia() {
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('niente appunti');
        await navigator.clipboard.writeText(DATI.url);
        avvisa('Link copiato');
      } catch (_) {
        zitto();
        testo.textContent = 'Copia il link:';
        campo.hidden = false;
        campo.focus();
        campo.select();
      }
    }
    if (tasto && testo && campo) {
      tasto.addEventListener('click', async () => {
        if (occupato) return;
        occupato = true;
        try {
          if (typeof navigator.share === 'function') await navigator.share(DATI);
          else await copia();
        } catch (err) {
          if (!err || err.name !== 'AbortError') await copia();   // annullato dal visitatore: niente
        } finally { occupato = false; }
      });
    }
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
