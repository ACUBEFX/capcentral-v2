
// =====================================================
// CAPCENTRAL - DATABASE-DRIVEN CAPS CATALOGUE
// File: public/caps-catalog.js
// =====================================================

(() => {
    const currentScript = document.currentScript;
    const capType = String(currentScript?.dataset.capType || '').trim();
    const category = 'Caps';

    document.addEventListener('DOMContentLoaded', initializeCatalogue);

    async function initializeCatalogue() {
        const grid = document.querySelector('.product-grid');

        if (!grid) return;

        const main = grid.closest('main') || grid.parentElement;
        if (!main) return;

        const state = {
            products: [],
            search: '',
            capType: capType,
            availability: 'all',
            sort: 'newest'
        };

        const escapeHtml = (value) =>
            String(value ?? '').replace(/[&<>"']/g, character => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            })[character]);

        function normalizeImageUrl(value) {
            const image = String(value || '').trim();

            if (!image) return '';

            // Accept only local paths or HTTP(S) image URLs.
            if (/^https?:\/\//i.test(image)) return image;

            if (image.startsWith('/') && !image.startsWith('//')) {
                return image;
            }

            if (/^[a-zA-Z0-9_\-./]+$/.test(image)) {
                return '/' + image.replace(/^\/+/, '');
            }

            return '';
        }

        function formatPrice(value) {
            return '₦' + (Number(value) || 0).toLocaleString('en-NG', {
                maximumFractionDigits: 2
            });
        }

        function isSoldOut(product) {
            return Number(product.stock_quantity) <= 0;
        }

        function getCapTypes() {
            return [...new Set(
                state.products
                    .map(product => String(product.cap_type || '').trim())
                    .filter(Boolean)
            )].sort((a, b) => a.localeCompare(b));
        }

        function createToolbar() {
            const toolbar = document.createElement('section');
            toolbar.className = 'catalogue-toolbar';
            toolbar.setAttribute('aria-label', 'Product search and filters');

            toolbar.innerHTML = `
                <div class="catalogue-search">
                    <label for="catalogue-search-input">Search products</label>
                    <input
                        id="catalogue-search-input"
                        type="search"
                        placeholder="Search by name or product code..."
                        autocomplete="off"
                    >
                </div>

                <div class="catalogue-filter">
                    <label for="catalogue-cap-type">Cap type</label>
                    <select id="catalogue-cap-type">
                        <option value="">All cap types</option>
                    </select>
                </div>

                <div class="catalogue-filter">
                    <label for="catalogue-availability">Availability</label>
                    <select id="catalogue-availability">
                        <option value="all">All products</option>
                        <option value="available">In stock</option>
                        <option value="sold">Sold out</option>
                    </select>
                </div>

                <div class="catalogue-filter">
                    <label for="catalogue-sort">Sort by</label>
                    <select id="catalogue-sort">
                        <option value="newest">Newest first</option>
                        <option value="price-low">Price: low to high</option>
                        <option value="price-high">Price: high to low</option>
                        <option value="name">Name: A to Z</option>
                    </select>
                </div>

                <button
                    type="button"
                    id="catalogue-reset"
                    class="catalogue-reset"
                >
                    Clear filters
                </button>
            `;

            const heading = main.querySelector('.products-header');
            if (heading) {
                heading.insertAdjacentElement('afterend', toolbar);
            } else {
                grid.insertAdjacentElement('beforebegin', toolbar);
            }

            return toolbar;
        }

        const toolbar = createToolbar();

        const searchInput = toolbar.querySelector('#catalogue-search-input');
        const capTypeSelect = toolbar.querySelector('#catalogue-cap-type');
        const availabilitySelect = toolbar.querySelector('#catalogue-availability');
        const sortSelect = toolbar.querySelector('#catalogue-sort');
        const resetButton = toolbar.querySelector('#catalogue-reset');

        const resultsSummary = document.createElement('p');
        resultsSummary.className = 'catalogue-results-summary';
        resultsSummary.setAttribute('aria-live', 'polite');
        toolbar.insertAdjacentElement('afterend', resultsSummary);

        function populateCapTypes() {
            const options = getCapTypes();

            capTypeSelect.replaceChildren();

            const allOption = document.createElement('option');
            allOption.value = '';
            allOption.textContent = 'All cap types';
            capTypeSelect.appendChild(allOption);

            options.forEach(type => {
                const option = document.createElement('option');
                option.value = type;
                option.textContent = type;
                capTypeSelect.appendChild(option);
            });

            if (capType && options.includes(capType)) {
                capTypeSelect.value = capType;
            }
        }

        function createCard(product) {
            const card = document.createElement('article');
            card.className = 'product-card';

            const stock = Math.max(0, Number(product.stock_quantity) || 0);
            const price = Math.max(0, Number(product.price) || 0);
            const sold = stock <= 0;
            const image = normalizeImageUrl(product.image_url);
            const name = String(product.name || 'Unnamed product');
            const description = String(product.description || '');

            card.dataset.productId = String(product.id);
            card.dataset.productCode = String(product.product_code || '');
            card.dataset.category = String(product.category || category);
            card.dataset.capType = String(product.cap_type || '');
            card.dataset.stockQuantity = String(stock);
            card.dataset.price = String(price);

            const imageContainer = document.createElement('div');
            imageContainer.className = 'product-image-container';

            if (image) {
                const imageElement = document.createElement('img');
                imageElement.className = 'product-image';
                imageElement.src = image;
                imageElement.alt = name;
                imageElement.loading = 'lazy';

                imageElement.addEventListener('error', () => {
                    imageElement.remove();
                    const placeholder = document.createElement('div');
                    placeholder.className = 'product-image product-image-placeholder';
                    placeholder.textContent = 'CapCentral';
                    placeholder.setAttribute('role', 'img');
                    placeholder.setAttribute('aria-label', 'Product image unavailable');
                    imageContainer.prepend(placeholder);
                }, { once: true });

                imageContainer.appendChild(imageElement);
            } else {
                const placeholder = document.createElement('div');
                placeholder.className = 'product-image product-image-placeholder';
                placeholder.textContent = 'CapCentral';
                placeholder.setAttribute('role', 'img');
                placeholder.setAttribute('aria-label', 'No product image available');
                imageContainer.appendChild(placeholder);
            }

            if (sold) {
                const soldBadge = document.createElement('span');
                soldBadge.className = 'sold-overlay-badge';
                soldBadge.textContent = 'SOLD OUT';
                imageContainer.appendChild(soldBadge);
                card.classList.add('product-sold');
            }

            const info = document.createElement('div');
            info.className = 'product-info';

            const nameElement = document.createElement('h3');
            nameElement.className = 'product-name';
            nameElement.textContent = name;

            const priceElement = document.createElement('div');
            priceElement.className = 'product-price';
            priceElement.textContent = formatPrice(price);

            const stockElement = document.createElement('div');
            stockElement.className = 'product-stock';
            stockElement.textContent = sold ? 'Sold out' : 'Available';
            stockElement.classList.toggle('out-of-stock', sold);

            const descriptionElement = document.createElement('p');
            descriptionElement.className = 'product-desc';
            descriptionElement.textContent = description;

            const sizeContainer = document.createElement('div');
            sizeContainer.className = 'product-size';

            const sizeSelect = document.createElement('select');
            sizeSelect.setAttribute('aria-label', `Choose size for ${name}`);

            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = 'Select size';
            sizeSelect.appendChild(defaultOption);

            ['22', '22½', '23', '23½'].forEach(size => {
                const option = document.createElement('option');
                option.value = size;
                option.textContent = size;
                sizeSelect.appendChild(option);
            });

            sizeSelect.disabled = sold;
            sizeContainer.appendChild(sizeSelect);

            const addButton = document.createElement('button');
            addButton.type = 'button';
            addButton.className = 'add-to-cart-button';
            addButton.disabled = sold;
            addButton.textContent = sold ? 'Sold out' : 'Add to Cart';

            info.append(
                nameElement,
                priceElement,
                stockElement,
                descriptionElement,
                sizeContainer,
                addButton
            );

            card.append(imageContainer, info);

            return card;
        }

        function getFilteredProducts() {
            const search = state.search.toLowerCase();

            let products = state.products.filter(product => {
                const matchesSearch =
                    String(product.name || '').toLowerCase().includes(search) ||
                    String(product.product_code || '').toLowerCase().includes(search) ||
                    String(product.description || '').toLowerCase().includes(search);

                const matchesType =
                    !state.capType || product.cap_type === state.capType;

                const sold = isSoldOut(product);

                const matchesAvailability =
                    state.availability === 'all' ||
                    (state.availability === 'available' && !sold) ||
                    (state.availability === 'sold' && sold);

                return matchesSearch && matchesType && matchesAvailability;
            });

            products = [...products];

            if (state.sort === 'price-low') {
                products.sort((a, b) => Number(a.price) - Number(b.price));
            } else if (state.sort === 'price-high') {
                products.sort((a, b) => Number(b.price) - Number(a.price));
            } else if (state.sort === 'name') {
                products.sort((a, b) =>
                    String(a.name || '').localeCompare(String(b.name || ''))
                );
            } else {
                products.sort((a, b) => Number(b.id) - Number(a.id));
            }

            return products;
        }

        function renderProducts() {
            const products = getFilteredProducts();

            grid.replaceChildren();

            if (!products.length) {
                const empty = document.createElement('p');
                empty.className = 'empty-products';
                empty.textContent = state.products.length
                    ? 'No products match your search or filters.'
                    : 'No active caps are available right now.';

                grid.appendChild(empty);
            } else {
                const fragment = document.createDocumentFragment();

                products.forEach(product => {
                    fragment.appendChild(createCard(product));
                });

                grid.appendChild(fragment);
            }

            resultsSummary.textContent =
                `${products.length} product${products.length === 1 ? '' : 's'} found`;
        }

        function resetFilters() {
            state.search = '';
            state.capType = capType;
            state.availability = 'all';
            state.sort = 'newest';

            searchInput.value = '';
            capTypeSelect.value = capType;
            availabilitySelect.value = 'all';
            sortSelect.value = 'newest';

            renderProducts();
        }

        searchInput.addEventListener('input', () => {
            state.search = searchInput.value.trim();
            renderProducts();
        });

        capTypeSelect.addEventListener('change', () => {
            state.capType = capTypeSelect.value;
            renderProducts();
        });

        availabilitySelect.addEventListener('change', () => {
            state.availability = availabilitySelect.value;
            renderProducts();
        });

        sortSelect.addEventListener('change', () => {
            state.sort = sortSelect.value;
            renderProducts();
        });

        resetButton.addEventListener('click', resetFilters);

        // Delegate clicks so recreated cards keep working.
        grid.addEventListener('click', event => {
            const addButton = event.target.closest('.add-to-cart-button');

            if (addButton) {
                event.preventDefault();
                event.stopPropagation();

                if (addButton.disabled) return;

                const card = addButton.closest('.product-card');
                if (!card) return;

                const size = card.querySelector('.product-size select')?.value || '';

                if (!size) {
                    alert('Please select a size before adding to cart.');
                    return;
                }

                if (Number(card.dataset.stockQuantity) <= 0) {
                    alert('This cap has already been sold.');
                    return;
                }

                if (typeof window.addToCart !== 'function') {
                    alert('The shopping cart could not be loaded. Please refresh the page.');
                    return;
                }

                window.addToCart({
                    name: card.querySelector('.product-name')?.textContent.trim() || '',
                    price: Number(card.dataset.price) || 0,
                    size,
                    productId: card.dataset.productId || null,
                    productCode: card.dataset.productCode || null,
                    category: card.dataset.category || category
                });

                return;
            }

            const card = event.target.closest('.product-card');

            if (
                card &&
                !event.target.closest('select') &&
                typeof window.openModal === 'function'
            ) {
                window.openModal(card);
            }
        });

        grid.addEventListener('change', event => {
            if (event.target.matches('.product-size select')) {
                event.stopPropagation();
            }
        });

        try {
            const params = new URLSearchParams({ category });

            // Fetch all active Caps; filtering happens in the browser.
            const response = await fetch('/api/products?' + params.toString(), {
                cache: 'no-store',
                headers: { Accept: 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`Product request failed (${response.status})`);
            }

            const products = await response.json();

            if (!Array.isArray(products)) {
                throw new Error('The product API returned an invalid response.');
            }

            state.products = products.filter(product =>
                product &&
                product.id !== undefined &&
                product.id !== null
            );

            populateCapTypes();
            renderProducts();
        } catch (error) {
            console.error('Could not load cap products:', error);

            const notice = document.createElement('p');
            notice.className = 'empty-products';
            notice.textContent =
                'Products could not be loaded. Please refresh the page.';

            grid.replaceChildren(notice);
            resultsSummary.textContent = '';
        }
    }
})();
