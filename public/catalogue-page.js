
function initCataloguePage() {
    console.log('CATALOGUE SCRIPT STARTED');

    const config = window.CAPCENTRAL_CATALOGUE || {};
    const category = config.category || 'Hats';
    const requiresSize = Boolean(config.requiresSize);
    const fallbackSizes = config.sizes || [];

    const grid = document.querySelector('.product-grid');

    if (!grid) {
        console.error('Catalogue error: .product-grid was not found.');
        return;
    }

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

    function getVariants(product) {
        return Array.isArray(product.variants)
            ? product.variants
            : [];
    }

    function getTotalStock(product) {
        const variants = getVariants(product);

        if (variants.length > 0) {
            return variants.reduce(
                (total, variant) =>
                    total + Math.max(0, Number(variant.stock_quantity) || 0),
                0
            );
        }

        return Math.max(0, Number(product.stock_quantity) || 0);
    }

    function getDisplayPrice(product) {
        const variants = getVariants(product);

        if (variants.length > 0) {
            const prices = variants.map(v => Number(v.price) || 0);
            const minimum = Math.min(...prices);
            const maximum = Math.max(...prices);

            return minimum === maximum
                ? formatPrice(minimum)
                : `${formatPrice(minimum)} – ${formatPrice(maximum)}`;
        }

        return formatPrice(product.price);
    }

    let allProducts = [];

    function updateCardSelection(card) {
        const select = card.querySelector('.catalogue-size');
        const button = card.querySelector('.catalogue-add-button');
        const priceNode = card.querySelector('.product-price');
        const stockNode = card.querySelector('.product-stock');

        if (!select) return;

        const option = select.selectedOptions[0];

        if (!option || !option.value) {
            button.disabled = true;
            return;
        }

        const stock = Number(option.dataset.stock || 0);
        const price = Number(option.dataset.price || 0);
        const variantId = option.dataset.variantId || '';

        card.dataset.selectedVariantId = variantId;
        card.dataset.selectedSize = option.value;
        card.dataset.selectedPrice = String(price);
        card.dataset.selectedStock = String(stock);
        card.dataset.stockQuantity = String(stock);
        card.dataset.price = String(price);

        priceNode.textContent = formatPrice(price);

        stockNode.textContent = stock > 0
            ? `In stock: ${stock}`
            : 'Out of stock';

        stockNode.classList.toggle('out-of-stock', stock <= 0);

        button.disabled = stock <= 0;
        button.textContent = stock > 0
            ? 'Add to Cart'
            : 'Out of stock';
    }

    function createCard(product, index) {
        const card = document.createElement('article');

        const variants = getVariants(product);
        const hasVariants = variants.length > 0;
        const stock = getTotalStock(product);
        const outOfStock = stock <= 0;
        const image = getImageUrl(product.image_url);

        card.className = 'product-card';
        card.dataset.productId = String(product.id);
        card.dataset.cardIndex = String(index + 1);
        card.dataset.productCode = product.product_code || '';
        card.dataset.category = product.category || category;
        card.dataset.price = String(Number(product.price) || 0);
        card.dataset.stockQuantity = String(stock);

        let sizeMarkup = '';

        if (requiresSize) {
            const availableSizes = hasVariants
                ? variants
                : fallbackSizes.map(size => ({
                    id: '',
                    size,
                    price: product.price,
                    stock_quantity: product.stock_quantity
                }));

            sizeMarkup = `
                <div class="product-size">
                    <label>
                        Size
                        <select class="catalogue-size"
                            aria-label="Select size for ${escapeHtml(product.name)}">

                            <option value="">Select size</option>

                            ${availableSizes.map(variant => {
                                const variantStock =
                                    Math.max(0, Number(variant.stock_quantity) || 0);

                                return `
                                    <option
                                        value="${escapeHtml(variant.size)}"
                                        data-variant-id="${escapeHtml(variant.id || '')}"
                                        data-price="${Number(variant.price) || 0}"
                                        data-stock="${variantStock}"
                                        ${variantStock <= 0 ? 'disabled' : ''}
                                    >
                                        ${escapeHtml(variant.size)}
                                        ${variantStock <= 0 ? '(Out of stock)' : ''}
                                    </option>
                                `;
                            }).join('')}

                        </select>
                    </label>
                </div>
            `;
        }

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
                    : ''
                }

            </div>

            <div class="product-info">

                <div class="product-name">
                    ${escapeHtml(product.name)}
                </div>

                <div class="product-price">
                    ${getDisplayPrice(product)}
                </div>

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

        const sizeSelect = card.querySelector('.catalogue-size');

        if (sizeSelect) {
            sizeSelect.addEventListener('change', () => {
                updateCardSelection(card);
            });

            card.querySelector('.catalogue-add-button').disabled = true;
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
                <input type="search"
                    class="catalogue-search"
                    placeholder="Search products..."
                    autocomplete="off">
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

            const stock = getTotalStock(product);

            return searchable.includes(search) &&
                (stockFilter === 'all' ||
                (stockFilter === 'available' && stock > 0) ||
                (stockFilter === 'sold' && stock <= 0));
        });

        if (sort === 'price-low') {
            products.sort((a, b) =>
                Number(a.price) - Number(b.price));
        } else if (sort === 'price-high') {
            products.sort((a, b) =>
                Number(b.price) - Number(a.price));
        } else if (sort === 'name') {
            products.sort((a, b) =>
                String(a.name).localeCompare(String(b.name)));
        } else {
            products.sort((a, b) =>
                Number(b.id) - Number(a.id));
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

            const sizeSelect = card.querySelector('.catalogue-size');
            const option = sizeSelect?.selectedOptions[0];

            const size = sizeSelect?.value || '';

            if (requiresSize && !size) {
                alert('Please select a size first.');
                return;
            }

            const selectedVariant = option
                ? {
                    variantId: option.dataset.variantId || null,
                    price: Number(option.dataset.price) || 0,
                    stock: Number(option.dataset.stock) || 0
                }
                : null;

            if (selectedVariant && selectedVariant.stock <= 0) {
                alert('This size is out of stock.');
                return;
            }

            if (typeof window.addToCart !== 'function') {
                alert('Cart function unavailable. Check script.js.');
                return;
            }

            window.addToCart({
                name: card.querySelector('.product-name')?.textContent.trim() || '',
                price: selectedVariant
                    ? selectedVariant.price
                    : Number(card.dataset.price) || 0,
                size: size || 'One Size',
                productId: card.dataset.productId,
                productCode: card.dataset.productCode,
                category: card.dataset.category,
                variantId: selectedVariant?.variantId || null,
                stockQuantity: selectedVariant
                    ? selectedVariant.stock
                    : Number(card.dataset.stockQuantity) || 0
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
}

if (document.readyState === 'loading') {
    document.addEventListener(
        'DOMContentLoaded',
        initCataloguePage,
        { once: true }
    );
} else {
    initCataloguePage();
}
