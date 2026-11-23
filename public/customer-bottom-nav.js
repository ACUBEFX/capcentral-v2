(() => {
    'use strict';

    const initCustomerBottomNav = () => {
        const path = window.location.pathname.replace(/\/$/, '') || '/';
        if (path === '/profile') return;
        if (!document.querySelector('link[data-cc-bottom-nav-css]')) {
            const stylesheet = document.createElement('link');
            stylesheet.rel = 'stylesheet';
            stylesheet.href = '/customer-bottom-nav.css';
            stylesheet.dataset.ccBottomNavCss = 'true';
            document.head.appendChild(stylesheet);
        }

        if (!document.querySelector('link[href*="font-awesome"], link[href*="fontawesome"]')) {
            const icons = document.createElement('link');
            icons.rel = 'stylesheet';
            icons.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css';
            document.head.appendChild(icons);
        }

        if (document.querySelector('.customer-bottom-nav')) return;


        const isCategoryPage = path.startsWith('/category/');
        const isShopPage = path === '/products' || path === '/caps' ||
            isCategoryPage ||
            !['/', '/services', '/my-deliveries', '/profile'].includes(path);

        const nav = document.createElement('nav');
        nav.className = 'customer-bottom-nav';
        nav.setAttribute('aria-label', 'Customer navigation');

        const items = [
            { label: 'Home', href: '/', icon: 'fa-house', active: path === '/' },
            { label: 'Categories', href: '/products', icon: 'fa-layer-group', active: isCategoryPage, category: true },
            { label: 'Shop', href: '/products', icon: 'fa-store', active: isShopPage && !isCategoryPage },
            { label: 'My Orders', href: '/my-deliveries', icon: 'fa-box-open', active: path === '/my-deliveries' },
            { label: 'Services', href: '/services', icon: 'fa-screwdriver-wrench', active: path === '/services' }
        ];

        items.forEach(item => {
            const element = item.category ? document.createElement('button') : document.createElement('a');

            if (item.category) element.type = 'button';
            else element.href = item.href;

            element.className = item.active ? 'active' : '';
            if (item.active) element.setAttribute('aria-current', 'page');
            if (item.category) element.setAttribute('aria-haspopup', 'dialog');

            const icon = document.createElement('span');
            icon.className = 'cc-nav-icon';
            icon.setAttribute('aria-hidden', 'true');

            const iconElement = document.createElement('i');
            iconElement.className = `fa-solid ${item.icon}`;
            icon.appendChild(iconElement);

            const label = document.createElement('span');
            label.className = 'cc-nav-label';
            label.textContent = item.label;

            element.append(icon, label);

            if (item.category) element.addEventListener('click', openCategories);
            nav.appendChild(element);
        });

        document.body.appendChild(nav);

        function openCategories() {
            const existingBurger = document.querySelector('.burger-menu');
            const existingSidebar = document.querySelector('.sidebar');

            if (existingBurger && existingSidebar) {
                existingBurger.click();
                return;
            }

            let backdrop = document.querySelector('.cc-category-backdrop');

            if (!backdrop) {
                backdrop = document.createElement('div');
                backdrop.className = 'cc-category-backdrop';
                backdrop.innerHTML = `
                    <section class="cc-category-panel" role="dialog" aria-modal="true" aria-labelledby="cc-category-title">
                        <div class="cc-category-panel-header">
                            <h2 id="cc-category-title">Browse categories</h2>
                            <button class="cc-category-close" type="button" aria-label="Close categories">&times;</button>
                        </div>
                        <div class="cc-category-list">
                            <p class="cc-category-message">Loading categories...</p>
                        </div>
                    </section>`;

                document.body.appendChild(backdrop);

                backdrop.addEventListener('click', event => {
                    if (event.target === backdrop || event.target.closest('.cc-category-close')) {
                        closeCategories();
                    }
                });

                document.addEventListener('keydown', event => {
                    if (event.key === 'Escape') closeCategories();
                });
            }

            backdrop.classList.add('open');
            document.body.style.overflow = 'hidden';

            const list = backdrop.querySelector('.cc-category-list');
            if (list.dataset.loaded === 'true') return;

            fetch('/api/categories', {
                headers: { Accept: 'application/json' },
                cache: 'no-store'
            })
                .then(response => {
                    if (!response.ok) throw new Error('Could not load categories');
                    return response.json();
                })
                .then(categories => {
                    list.replaceChildren();

                    const visibleCategories = Array.isArray(categories) ? categories : [];

                    if (!visibleCategories.length) {
                        const message = document.createElement('p');
                        message.className = 'cc-category-message';
                        message.textContent = 'No categories are available yet.';
                        list.appendChild(message);
                    } else {
                        visibleCategories.forEach(category => {
                            if (!category || !category.slug || !category.name) return;

                            const link = document.createElement('a');
                            link.href = `/category/${encodeURIComponent(category.slug)}`;
                            link.textContent = category.name;
                            list.appendChild(link);
                        });
                    }

                    list.dataset.loaded = 'true';
                })
                .catch(() => {
                    list.replaceChildren();

                    const message = document.createElement('p');
                    message.className = 'cc-category-message';
                    message.textContent = 'Categories could not be loaded. Please try again.';
                    list.appendChild(message);
                });
        }

        function closeCategories() {
            const backdrop = document.querySelector('.cc-category-backdrop');
            if (backdrop) backdrop.classList.remove('open');
            document.body.style.overflow = '';
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCustomerBottomNav, { once: true });
    } else {
        initCustomerBottomNav();
    }
})();


