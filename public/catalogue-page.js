
document.addEventListener('DOMContentLoaded', () => {
    const config = window.CAPCENTRAL_CATALOGUE || {};
    const category = config.category || 'Hats';
    const requiresSize = Boolean(config.requiresSize);
    const sizes = config.sizes || [];

    const grid = document.querySelector('.product-grid');
    if (!grid) {
        console.error('Catalogue error: .product-grid was not found.');
        return;
    }


    
    
async function loadCategoryMenu() {
    // These pages should not display the extra catalogue category bar.
    const currentPath = window.location.pathname.toLowerCase();

    const pagesWithoutCategoryMenu = [
        '/shoes',
        '/thobes',
        '/throbe',
        '/trucker',
        '/trucker-hats'
    ];

    const existingMenu = document.querySelector('.catalogue-category-menu');

    if (pagesWithoutCategoryMenu.includes(currentPath)) {
        if (existingMenu) {
            existingMenu.remove();
        }
        return;
    }

    try {
        const response = await fetch('/api/categories/public', {
            cache: 'no-store',
            headers: { Accept: 'application/json' }
        });

        if (!response.ok) {
            throw new Error(`Category API returned HTTP ${response.status}`);
        }

        const result = await response.json();

        if (!result.success || !Array.isArray(result.categories)) {
            throw new Error('Invalid category response.');
        }

        let menu = document.querySelector('.catalogue-category-menu');

        if (!menu) {
            menu = document.createElement('nav');
            menu.className = 'catalogue-category-menu';
            menu.setAttribute('aria-label', 'Product categories');
            grid.parentNode.insertBefore(menu, grid);
        }

        menu.replaceChildren();

        result.categories.forEach(item => {
            const link = document.createElement('a');
            link.textContent = item.name;
            link.href = '/' + encodeURIComponent(item.slug);
            link.className = 'catalogue-category-link';

            if (item.name.toLowerCase() === category.toLowerCase()) {
                link.classList.add('active');
                link.setAttribute('aria-current', 'page');
            }

            menu.appendChild(link);
        });
    } catch (error) {
        console.error('Could not load category menu:', error);
    }
}


    loadCategoryMenu();


    const escapeHtml = value =>
        String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[char]);

    const formatPrice = value =>
        '₦' + (Number(value) || 0).toLocaleString('en-NG');

    function getImageUrl(value) {
        const image = String(value || '').trim();
        if (!image) return '';

        if (/^https?:\/\//i.test(image) || image.startsWith('/')) {
            return image;
        }

        return '/' + image.replace(/^\.\/+/, '');
    }

    let allProducts = [];

    function createCard(product, index) {
        const card = document.createElement('article');
        const stock = Math.max(0, Number(product.stock_quantity) || 0);
        const outOfStock = stock <= 0;
        const image = getImageUrl(product.image_url);

        card.className = 'product-card';
        card.dataset.productId = String(product.id);
        card.dataset.cardIndex = String(index + 1);
        card.dataset.productCode = product.product_code || '';
        card.dataset.category = product.category || category;
        card.dataset.price = String(Number(product.price) || 0);
        card.dataset.stockQuantity = String(stock);

        const sizeMarkup = requiresSize
            ? `<div class="product-size">
                <label>
                    Size
                    <select class="catalogue-size"
                        aria-label="Select size for ${escapeHtml(product.name)}">
                        <option value="">Select size</option>
                        ${sizes.map(size =>
                            `<option value="${escapeHtml(size)}">${escapeHtml(size)}</option>`
                        ).join('')}
                    </select>
                </label>
            </div>`
            : '';

        card.innerHTML = `
            <div class="product-image-container">
                ${image
                    ? `<img class="product-image"
                        src="${escapeHtml(image)}"
                        alt="${escapeHtml(product.name)}"
                        loading="lazy">`
                    : `<div class="product-image product-image-placeholder">
                        Image unavailable
                    </div>`
                }
                ${outOfStock
                    ? '<span class="sold-overlay-badge">OUT OF STOCK</span>'
                    : ''}
            </div>

            <div class="product-info">
                <div class="product-name">${escapeHtml(product.name)}</div>
                <div class="product-price">${formatPrice(product.price)}</div>

                <div class="product-stock ${outOfStock ? 'out-of-stock' : ''}">
                    ${outOfStock ? 'Out of stock' : `In stock: ${stock}`}
                </div>

                <div class="product-desc">
                    ${escapeHtml(product.description || '')}
                </div>

                ${sizeMarkup}

                <button type="button"
                    class="add-to-cart-button catalogue-add-button"
                    ${outOfStock ? 'disabled' : ''}>
                    ${outOfStock ? 'Out of stock' : 'Add to Cart'}
                </button>
            </div>
        `;

        const img = card.querySelector('img.product-image');

        if (img) {
            img.addEventListener('error', () => {
                const placeholder = document.createElement('div');
                placeholder.className =
                    'product-image product-image-placeholder';
                placeholder.textContent = 'Image unavailable';
                img.replaceWith(placeholder);
            }, { once: true });
        }

        return card;
    }

    function addControls() {
        if (document.querySelector('.catalogue-controls')) return;

        const controls = document.createElement('div');
        controls.className = 'catalogue-controls';

        controls.innerHTML = `
            <label>
                Search products
                <input type="search" class="catalogue-search"
                    placeholder="Search products..." autocomplete="off">
            </label>

            <label>
                Availability
                <select class="catalogue-stock-filter">
                    <option value="all">All products</option>
                    <option value="available">In stock</option>
                    <option value="sold">Out of stock</option>
                </select>
            </label>

            <label>
                Sort by
                <select class="catalogue-sort">
                    <option value="newest">Newest</option>
                    <option value="price-low">Price: low to high</option>
                    <option value="price-high">Price: high to low</option>
                    <option value="name">Name: A to Z</option>
                </select>
            </label>
        `;

        grid.parentNode.insertBefore(controls, grid);
    }

    function renderProducts() {
        const search =
            document.querySelector('.catalogue-search')?.value
                .trim().toLowerCase() || '';

        const stockFilter =
            document.querySelector('.catalogue-stock-filter')?.value || 'all';

        const sort =
            document.querySelector('.catalogue-sort')?.value || 'newest';

        let products = allProducts.filter(product => {
            const searchable = [
                product.name,
                product.product_code,
                product.description
            ].join(' ').toLowerCase();

            const stock = Number(product.stock_quantity) || 0;

            return searchable.includes(search) &&
                (stockFilter === 'all' ||
                (stockFilter === 'available' && stock > 0) ||
                (stockFilter === 'sold' && stock <= 0));
        });

        if (sort === 'price-low') {
            products.sort((a, b) => Number(a.price) - Number(b.price));
        } else if (sort === 'price-high') {
            products.sort((a, b) => Number(b.price) - Number(a.price));
        } else if (sort === 'name') {
            products.sort((a, b) =>
                String(a.name).localeCompare(String(b.name)));
        } else {
            products.sort((a, b) => Number(b.id) - Number(a.id));
        }

        grid.replaceChildren();

        if (!products.length) {
            const message = document.createElement('p');
            message.className = 'empty-products';
            message.textContent = allProducts.length
                ? 'No products match your search or filters.'
                : `No active products found in ${category}.`;
            grid.appendChild(message);
            return;
        }

        products.forEach((product, index) => {
            grid.appendChild(createCard(product, index));
        });
    }

    async function loadProducts() {
        grid.textContent = 'Loading products...';

        try {
            const response = await fetch(
                '/api/products?category=' + encodeURIComponent(category),
                {
                    cache: 'no-store',
                    headers: { Accept: 'application/json' }
                }
            );

            if (!response.ok) {
                throw new Error(`API returned HTTP ${response.status}`);
            }

            const data = await response.json();

            if (!Array.isArray(data)) {
                throw new Error('The API did not return a product array.');
            }

            allProducts = data;

            addControls();
            renderProducts();

            document.querySelector('.catalogue-search')
                ?.addEventListener('input', renderProducts);

            document.querySelector('.catalogue-stock-filter')
                ?.addEventListener('change', renderProducts);

            document.querySelector('.catalogue-sort')
                ?.addEventListener('change', renderProducts);

            console.log(`Loaded ${data.length} ${category} products.`);
        } catch (error) {
            console.error('Catalogue loading failed:', error);

            grid.replaceChildren();

            const message = document.createElement('p');
            message.className = 'empty-products';
            message.textContent =
                'Could not load products. Check the browser console for details.';
            grid.appendChild(message);
        }
    }

    grid.addEventListener('click', event => {
        const button = event.target.closest('.catalogue-add-button');

        if (button) {
            event.preventDefault();
            event.stopPropagation();

            const card = button.closest('.product-card');
            if (!card || button.disabled) return;

            let size = '';

            if (requiresSize) {
                size = card.querySelector('.catalogue-size')?.value || '';

                if (!size) {
                    alert('Please select a size first.');
                    return;
                }
            }

            if (typeof window.addToCart !== 'function') {
                alert('Cart function unavailable. Check script.js.');
                return;
            }

            window.addToCart({
                name: card.querySelector('.product-name')?.textContent.trim() || '',
                price: Number(card.dataset.price) || 0,
                productId: card.dataset.productId,
                productCode: card.dataset.productCode,
                category: card.dataset.category,
                ...(requiresSize ? { size } : {})
            });

            return;
        }

        const card = event.target.closest('.product-card');
        if (!card || event.target.closest('select')) return;

        const index = Number(card.dataset.cardIndex);

        if (index > 0 && typeof window.openModal === 'function') {
            window.openModal(index);
        }
    });

    loadProducts();
});
