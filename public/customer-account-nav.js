document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('cc-account-menu-toggle');
    const links = document.getElementById('cc-account-nav-links');

    if (!toggle || !links) return;

    toggle.addEventListener('click', () => {
        const isOpen = links.classList.toggle('nav-active');
        toggle.setAttribute('aria-expanded', String(isOpen));
    });

    links.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            links.classList.remove('nav-active');
            toggle.setAttribute('aria-expanded', 'false');
        });
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 760) {
            links.classList.remove('nav-active');
            toggle.setAttribute('aria-expanded', 'false');
        }
    });
});
