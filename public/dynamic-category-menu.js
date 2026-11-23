
document.addEventListener('DOMContentLoaded', async () => {
    const menu = document.getElementById('dynamic-category-menu');

    if (!menu) return;

    // Categories that already have dedicated sidebar links.
    const existingCategories = new Set([
        'zanna bukar',
        'bongol',
        'atiku',
        'tinubu/fila',
        'miyaram',
        'kindea',
        'tangaran',
        'tonak',
        'caps',
        'thobes',
        'throbe',
        'shoes',
        'trucker hats',
        'truckerhats',
        'services'
    ]);

    try {
        const response = await fetch('/api/categories', {
            cache: 'no-store',
            headers: { Accept: 'application/json' }
        });

        if (!response.ok) {
            throw new Error(
                `Categories request failed: ${response.status}`
            );
        }

        const categories = await response.json();

        if (!Array.isArray(categories)) {
            throw new Error('Invalid categories response.');
        }

        menu.replaceChildren();

        categories.forEach(category => {
            const name = String(category.name || '').trim();
            const slug = String(category.slug || '').trim();

            if (!name || !slug) return;

            // Do not duplicate categories that already have sidebar links.
            if (existingCategories.has(name.toLowerCase())) return;

            const wrapper = document.createElement('div');

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'dropdown-btn';
            button.textContent = name;

            button.addEventListener('click', () => {
                window.location.href =
                    `/category/${encodeURIComponent(slug)}`;
            });

            wrapper.appendChild(button);
            menu.appendChild(wrapper);
        });
    } catch (error) {
        console.error(
            'Could not load dynamic category menu:',
            error
        );
    }
});
