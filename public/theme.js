// Run before styles are loaded: no inline script or relaxed CSP required.
(() => {
  let saved;
  try { saved = localStorage.getItem('vydo_theme'); } catch {}
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const chosen = saved === 'light' || saved === 'dark' ? saved : null;
  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#0c0d13' : '#ffffff';
    const button = document.getElementById('theme-toggle');
    if (button) {
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      button.setAttribute('aria-label', theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro');
    }
  }
  let selection = chosen;
  apply(selection || (system.matches ? 'dark' : 'light'));
  system.addEventListener('change', () => { if (!selection) apply(system.matches ? 'dark' : 'light'); });
  document.addEventListener('DOMContentLoaded', () => {
    apply(document.documentElement.dataset.theme);
    document.getElementById('theme-toggle').addEventListener('click', () => {
      selection = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('vydo_theme', selection); } catch {}
      apply(selection);
    });
  });
})();
