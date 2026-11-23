
// =====================================================
// PAYMENT SUCCESS - CLEAR CART
// =====================================================

const paymentParams = new URLSearchParams(
    window.location.search
);

const paymentSuccessful =
    paymentParams.get('payment') === 'success';


// =====================================================
// CART LOGIC WITH LOCAL STORAGE PERSISTENCE
// =====================================================

let cart = JSON.parse(
    localStorage.getItem('cart')
) || [];


// =====================================================
// CLEAR CART AFTER SUCCESSFUL PAYMENT
// =====================================================

if (paymentSuccessful) {

    // Remove saved cart from browser storage
    localStorage.removeItem('cart');

    // Clear current cart variable
    cart = [];

    console.log(
        'âœ… Payment successful. Cart cleared.'
    );
}


// =====================================================
// CART COUNT
// =====================================================

const cartCount =
    document.querySelector('.cart-count');


// =====================================================
// UPDATE CART ICON COUNT
// =====================================================

function updateCartCount() {

    if (!cartCount) {
        return;
    }

    const totalItems = cart.reduce(
        (sum, item) =>
            sum + item.quantity,
        0
    );

    cartCount.textContent = totalItems;
}


// =====================================================
// SAVE CART TO LOCAL STORAGE
// =====================================================

function saveCart() {

    localStorage.setItem(
        'cart',
        JSON.stringify(cart)
    );

    updateCartCount();
}


// =====================================================
// RENDER CART UI
// =====================================================

function renderCart() {

    const cartItemsContainer =
        document.querySelector('.cart-items');

    if (!cartItemsContainer) {
        return;
    }

    cartItemsContainer.innerHTML = `
        <button
            type="button"
            class="close-cart-button"
        >
            &times;
        </button>

        <h2>Your Cart</h2>
    `;


    // =================================================
    // EMPTY CART
    // =================================================

    if (cart.length === 0) {

        cartItemsContainer.innerHTML += `
            <p>
                <i>
                    Nothing is added to the cart list
                </i>
            </p>
        `;

        const closeButton =
            cartItemsContainer.querySelector(
                '.close-cart-button'
            );

        if (closeButton) {
            closeButton.addEventListener(
                'click',
                toggleCart
            );
        }

        return;
    }


    // =================================================
    // CART ITEMS
    // =================================================

    let total = 0;

    const itemsList =
        document.createElement('div');

    itemsList.classList.add(
        'cart-items-list'
    );


    cart.forEach((item, index) => {

        total +=
            item.price *
            item.quantity;

        itemsList.innerHTML += `
            <div class="cart-item">

                <div class="cart-item-details">

                    <p class="cart-item-name">
                        <strong>
                            ${item.name}
                        </strong>
                    </p>

                    <p class="cart-item-size">
                        Size:
                        <strong>
                            ${item.size}
                        </strong>
                    </p>

                    <p class="cart-item-price">
                        Price:
                        <strong>
                            â‚¦${item.price.toLocaleString()}
                        </strong>
                    </p>

                    <p class="cart-item-quantity">
                        Quantity:
                        <strong>
                            ${item.quantity}
                        </strong>
                    </p>

                </div>

                <button
                    type="button"
                    class="remove-item-button"
                    data-index="${index}"
                >
                    Remove
                </button>

            </div>
        `;
    });


    cartItemsContainer.appendChild(
        itemsList
    );


    // =================================================
    // CART FOOTER
    // =================================================

    const cartFooter =
        document.createElement('div');

    cartFooter.classList.add(
        'cart-footer'
    );


    cartFooter.innerHTML = `
        <div class="cart-total">
            <strong>Total:</strong>
            â‚¦${total.toLocaleString()}
        </div>

        <form
            action="/checkout"
            method="POST"
            style="margin-top: 10px;"
        >

            <input
                type="hidden"
                name="cart"
                value='${JSON.stringify(cart)}'
            >

            <input
                type="hidden"
                name="total"
                value="${total}"
            >

            <input
                type="hidden"
                name="returnUrl"
                value="${window.location.pathname}${window.location.search}"
            >

            <button
                type="submit"
                class="checkout-button"
            >
                Proceed to Checkout
            </button>

        </form>
    `;


    cartItemsContainer.appendChild(
        cartFooter
    );


    // =================================================
    // REMOVE ITEM BUTTONS
    // =================================================

    cartItemsContainer
        .querySelectorAll(
            '.remove-item-button'
        )
        .forEach(button => {

            button.addEventListener(
                'click',
                (e) => {

                    removeFromCart(
                        e.target.dataset.index
                    );

                }
            );

        });


    // =================================================
    // CLOSE CART BUTTON
    // =================================================

    const closeButton =
        cartItemsContainer.querySelector(
            '.close-cart-button'
        );

    if (closeButton) {

        closeButton.addEventListener(
            'click',
            toggleCart
        );

    }
}


// =====================================================
// REMOVE ITEM FROM CART
// =====================================================

function removeFromCart(index) {

    cart.splice(
        index,
        1
    );

    saveCart();

    renderCart();
}


async function isCustomerLoggedIn() {
    try {
        const response = await fetch('/check-session', {
            credentials: 'same-origin',
            cache: 'no-store'
        });

        if (!response.ok) {
            return false;
        }

        const data = await response.json();
        return data.loggedIn === true;
    } catch (error) {
        console.error('Unable to verify login session:', error);
        return false;
    }
}

// =====================================================
// ADD ITEM TO CART
// =====================================================

async function addToCart(product) {

    // Require login before adding a product.
    const loggedIn = await isCustomerLoggedIn();

    if (!loggedIn) {
        window.location.href = '/login';
        return;
    }

    const variantId = product.variantId || product.variant_id || null;
    const stockQuantity = Number(product.stockQuantity);

    // Check stock for the selected variant or legacy product.
    if (Number.isFinite(stockQuantity) && stockQuantity <= 0) {
        alert('This selected size is out of stock.');
        return;
    }

    // Caps without variants retain the old unique-item behaviour.
    const isUniqueCap =
        String(product.category || '').toLowerCase() === 'caps' &&
        !variantId;

    const existingItemIndex = cart.findIndex(item => {
        if (variantId) {
            return String(item.variantId || item.variant_id || '') ===
                String(variantId);
        }

        if (isUniqueCap) {
            return (
                String(item.productId || '') === String(product.productId || '') ||
                String(item.productCode || '') === String(product.productCode || '')
            );
        }

        return (
            !item.variantId &&
            !item.variant_id &&
            item.name === product.name &&
            item.size === product.size
        );
    });

    if (existingItemIndex !== -1) {
        const existingItem = cart[existingItemIndex];

        if (isUniqueCap) {
            alert('This cap is already in your cart.');
            return;
        }

        const availableStock = Number(
            existingItem.stockQuantity ?? product.stockQuantity
        );

        if (
            Number.isFinite(availableStock) &&
            existingItem.quantity >= availableStock
        ) {
            alert('You cannot add more than the available stock.');
            return;
        }

        existingItem.quantity += 1;
    } else {
        cart.push({
            ...product,
            variantId,
            quantity: 1
        });
    }

    saveCart();
    renderCart();
}

// =====================================================
// TOGGLE CART UI
// =====================================================

const cartIcon =
    document.querySelector(
        '.cart-icon'
    );

const cartItems =
    document.querySelector(
        '.cart-items'
    );


function toggleCart() {

    if (!cartItems) {
        return;
    }

    cartItems.style.display =
        cartItems.style.display === 'block'
            ? 'none'
            : 'block';


    if (
        cartItems.style.display ===
        'block'
    ) {

        renderCart();

    }
}


if (cartIcon) {

    cartIcon.addEventListener(
        'click',
        (e) => {

            e.stopPropagation();

            toggleCart();

        }
    );

}


document.addEventListener(
    'click',
    () => {

        if (cartItems) {
            cartItems.style.display =
                'none';
        }

    }
);


if (cartItems) {

    cartItems.addEventListener(
        'click',
        (e) =>
            e.stopPropagation()
    );

}

// Open cart automatically when requested by a navigation link.
const openCartOnLoad =
    new URLSearchParams(window.location.search)
        .get('openCart') === '1';

if (openCartOnLoad && cartItems) {
    cartItems.style.display = 'block';
    renderCart();
}


// =====================================================
// ADD TO CART VIA MODAL
// =====================================================

const addToCartButton = document.getElementById('add-to-cart-button');

if (addToCartButton) {
    addToCartButton.addEventListener('click', () => {
        const modal = document.getElementById('product-modal');
        if (!modal) return;

        const productId = modal.dataset.productId;

        const productCard = productId
            ? document.querySelector(
                `.product-card[data-product-id="${CSS.escape(String(productId))}"]`
            )
            : null;

        if (!productCard) {
            alert('This product is no longer available. Please refresh the page.');
            closeModal();
            return;
        }

        const productName =
            productCard.querySelector('.product-name')?.textContent.trim() || '';

       const sizeSelect = modal.querySelector('#modal-size-select');
       const sizeContainer = modal.querySelector('#modal-product-size');

       const requiresSize = sizeContainer &&
            sizeContainer.style.display !== 'none';

       const selectedOption = requiresSize
            ? sizeSelect?.selectedOptions[0]
            : null;

       const productSize = requiresSize
            ? (sizeSelect?.value || '')
            : 'One Size';

        if (requiresSize && !productSize) {
            alert('Please select a size before adding to cart.');
            return;
        }
       const variantId = selectedOption?.dataset.variantId || null;
       const productPrice = variantId
            ? Number(selectedOption.dataset.price)
            : Number(productCard.dataset.price || 0);

        const stockQuantity = variantId
            ? Number(selectedOption.dataset.stock || 0)
            : Number(productCard.dataset.stockQuantity || 0);

        if (stockQuantity <= 0) {
            alert('The selected size is out of stock.');
            return;
        }

        addToCart({
            name: productName,
            price: productPrice,
            size: productSize,
            variantId,
            stockQuantity,
            productId: productCard.dataset.productId || null,
            productCode: productCard.dataset.productCode || null,
            category: productCard.dataset.category || inferPageCategory()
        });

        closeModal();
    });
}



// =====================================================
// SIZE SELECTION - NORMAL PRODUCT CARDS
// =====================================================

function updateSizeButtonState(button, sizeSelect, productCard) {
    if (!button || !sizeSelect) return;

    const option = sizeSelect.selectedOptions[0];

    const stockValue =
        option?.dataset.stock ??
        productCard?.dataset.stockQuantity;

    const stock = stockValue === undefined || stockValue === ''
        ? NaN
        : Number(stockValue);

    const unavailable =
        !option ||
        option.disabled ||
        (Number.isFinite(stock) && stock <= 0);

    button.disabled = !sizeSelect.value || unavailable;
}

// Initialize all existing product cards.
document.querySelectorAll('.product-card').forEach(card => {
    const sizeSelect = card.querySelector('.product-size select');
    const button = card.querySelector('.add-to-cart-button');

    if (!sizeSelect || !button) return;

    updateSizeButtonState(button, sizeSelect, card);

    sizeSelect.addEventListener('change', () => {
        updateSizeButtonState(button, sizeSelect, card);
    });
});




// Keep the original static brand pages working; category pages replace their cards
// from the database and use their own delegated click handler.
document.querySelectorAll('.product-card .add-to-cart-button').forEach(button => {
    button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();

        const productCard = button.closest('.product-card');
        if (!productCard) return;

        const productName =
            productCard.querySelector('.product-name')?.textContent.trim() || '';

        const sizeSelect = productCard.querySelector('.product-size select');
        const selectedOption = sizeSelect?.selectedOptions[0];

        const productSize = sizeSelect?.value ||
            (inferPageCategory() === 'Hats' ? 'One Size' : '');

        if (!productSize) {
            alert('Please select a size before adding to cart.');
            return;
        }

        const variantId = selectedOption?.dataset.variantId || null;

        const price = variantId
            ? Number(selectedOption.dataset.price)
            : Number(productCard.dataset.price ||
                productCard.querySelector('.product-price')?.textContent.replace(/[^\d.]/g, '') || 0);

        const stockQuantity = variantId
            ? Number(selectedOption.dataset.stock || 0)
            : Number(productCard.dataset.stockQuantity || 0);

        if (stockQuantity <= 0) {
            alert('This product or selected size is out of stock.');
            return;
        }

        addToCart({
            name: productName,
            price,
            size: productSize,
            variantId,
            stockQuantity,
            productId: productCard.dataset.productId || null,
            productCode: productCard.dataset.productCode || null,
            category: productCard.dataset.category || inferPageCategory()
        });
    });
});

function inferPageCategory() {
    const path = String(window.location.pathname || '').toLowerCase();
    if (path.includes('shoe')) return 'Shoes';
    if (path.includes('throbe')) return 'Thobes';
    if (path.includes('trucker')) return 'Hats';
    return 'Caps';
}




// =====================================================
// MODAL SIZE SELECTION BUTTON STATE
// =====================================================

function updateModalAddButtonState() {
    const modal = document.getElementById('product-modal');
    const button = document.getElementById('add-to-cart-button');

    if (!modal || !button) return;

    const productId = modal.dataset.productId;

    const productCard = productId
        ? document.querySelector(
            `.product-card[data-product-id="${CSS.escape(String(productId))}"]`
        )
        : null;

    // Check whether the actual product card requires a size.
    const cardSize = productCard?.querySelector('.product-size select');

    if (cardSize) {
        const modalSize = modal.querySelector('#modal-size-select');
        updateSizeButtonState(button, modalSize, productCard);
    } else {
        // Products without sizes should not be disabled for missing a size.
        button.disabled =
            Number(productCard?.dataset.stockQuantity) <= 0;
    }
}

// =====================================================
// MODAL FUNCTIONALITY
// =====================================================

function openModal(productOrIndex) {
    const modal = document.getElementById('product-modal');
    if (!modal) return;

    let productCard = null;
    if (productOrIndex && typeof productOrIndex === 'object' && productOrIndex.classList?.contains('product-card')) {
        productCard = productOrIndex;
    } else {
        const productCards = document.querySelectorAll('.product-card');
        const index = Number(productOrIndex);
        if (!Number.isInteger(index) || index < 1 || index > productCards.length) return;
        productCard = productCards[index - 1];
    }
    if (!productCard) return;

    const productName = productCard.querySelector('.product-name')?.textContent.trim() || '';
    const productPrice = Number(productCard.dataset.price || productCard.querySelector('.product-price')?.textContent.replace(/[^\d.]/g, '') || 0);
    const productDesc = productCard.querySelector('.product-desc')?.textContent.trim() || '';
    const productImage = productCard.querySelector('.product-image')?.src || '';

    const nameNode = document.getElementById('modal-product-name');
    const priceNode = document.getElementById('modal-product-price');
    const descNode = document.getElementById('modal-product-description');
    const imageNode = document.getElementById('modal-product-image');
    if (nameNode) nameNode.textContent = productName;
    if (priceNode) priceNode.textContent = `â‚¦${productPrice.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
    if (descNode) descNode.textContent = productDesc;
    if (imageNode) {
        if (productImage) {
            imageNode.src = productImage;
            imageNode.style.display = '';
        } else {
            imageNode.removeAttribute('src');
            imageNode.style.display = 'none';
        }
    }

   // Show the size selector only when the product card has one.
const modalSize = modal.querySelector('#modal-size-select');
const modalSizeContainer = modal.querySelector('#modal-product-size');
const cardSize = productCard.querySelector('.product-size select');

if (modalSizeContainer) {
    modalSizeContainer.style.display = cardSize ? '' : 'none';
}

if (modalSize && cardSize) {
    modalSize.innerHTML = cardSize.innerHTML;
    modalSize.value = cardSize.value || '';
    modalSize.disabled = cardSize.disabled;
}

    modal.dataset.productId = productCard.dataset.productId || '';
    modal.dataset.productCode = productCard.dataset.productCode || '';
    modal.dataset.category = productCard.dataset.category || inferPageCategory();

    const modalSizeSelect = modal.querySelector('#modal-size-select');

if (modalSizeSelect && !modalSizeSelect.dataset.buttonStateListener) {
    modalSizeSelect.addEventListener('change', updateModalAddButtonState);
    modalSizeSelect.dataset.buttonStateListener = 'true';
}

updateModalAddButtonState();
    modal.dataset.cardIndex = String(Array.from(document.querySelectorAll('.product-card')).indexOf(productCard));
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

// =====================================================
// CLOSE MODAL
// =====================================================

function closeModal() {

    const modal =
        document.getElementById(
            'product-modal'
        );


    if (!modal) {
        return;
    }


    modal.style.display =
        'none';


    document.body.style.overflow =
        'auto';


    modal.dataset.productId = '';
    modal.dataset.productCode = '';
    modal.dataset.category = '';
    modal.dataset.cardIndex = '';
}


// =====================================================
// MODAL EVENT LISTENERS
// =====================================================

window.addEventListener(
    'click',
    (event) => {

        const modal =
            document.getElementById(
                'product-modal'
            );


        if (
            modal &&
            event.target === modal
        ) {

            closeModal();

        }

    }
);


document
    .querySelectorAll('.close')
    .forEach(
        closeBtn => {

            closeBtn.addEventListener(
                'click',
                closeModal
            );

        }
    );


document
    .querySelectorAll(
        '.product-size select'
    )
    .forEach(
        select => {

            select.addEventListener(
                'click',
                (e) =>
                    e.stopPropagation()
            );

        }
    );


// =====================================================
// BURGER MENU & SIDEBAR
// =====================================================

const burgerMenu =
    document.querySelector(
        '.burger-menu'
    );

const sidebar =
    document.querySelector(
        '.sidebar'
    );

const overlay =
    document.querySelector(
        '.overlay'
    );


if (
    burgerMenu &&
    sidebar &&
    overlay
) {

    burgerMenu.addEventListener(
        'click',
        function() {

            this.classList.toggle(
                'open'
            );

            sidebar.classList.toggle(
                'active'
            );

            overlay.classList.toggle(
                'active'
            );


            document.body.style.overflow =
                this.classList.contains(
                    'open'
                )
                    ? 'hidden'
                    : 'auto';

        }
    );


    overlay.addEventListener(
        'click',
        function() {

            burgerMenu.classList.remove(
                'open'
            );

            sidebar.classList.remove(
                'active'
            );

            this.classList.remove(
                'active'
            );

            document.body.style.overflow =
                'auto';

        }
    );

}


document
    .querySelectorAll(
        '.sidebar a'
    )
    .forEach(
        link => {

            link.addEventListener(
                'click',
                () => {

                    if (burgerMenu) {
                        burgerMenu.classList.remove(
                            'open'
                        );
                    }

                    if (sidebar) {
                        sidebar.classList.remove(
                            'active'
                        );
                    }

                    if (overlay) {
                        overlay.classList.remove(
                            'active'
                        );
                    }

                    document.body.style.overflow =
                        'auto';

                }
            );

        }
    );


document
    .querySelectorAll(
        '.dropdown-btn'
    )
    .forEach(
        button => {

            button.addEventListener(
                'click',
                function() {

                    this.classList.toggle(
                        'active'
                    );


                    const dropdownContent =
                        this.nextElementSibling;


                    if (
                        dropdownContent &&
                        dropdownContent.classList.contains(
                            'dropdown-content-sidebar'
                        )
                    ) {

                        dropdownContent.style.display =
                            dropdownContent.style.display ===
                            'block'
                                ? 'none'
                                : 'block';

                    }


                    document
                        .querySelectorAll(
                            '.dropdown-btn'
                        )
                        .forEach(
                            otherButton => {

                                if (
                                    otherButton !==
                                    this &&
                                    otherButton
                                        .nextElementSibling &&
                                    otherButton
                                        .nextElementSibling
                                        .classList
                                        .contains(
                                            'dropdown-content-sidebar'
                                        )
                                ) {

                                    otherButton
                                        .classList
                                        .remove(
                                            'active'
                                        );


                                    otherButton
                                        .nextElementSibling
                                        .style
                                        .display =
                                        'none';

                                }

                            }
                        );

                }
            );

        }
    );


// =====================================================
// EMAIL MODAL FUNCTIONALITY
// =====================================================

const emailModal =
    document.getElementById(
        'email-modal'
    );

const emailUsLink =
    document.getElementById(
        'emailUsLink'
    );

const emailCloseBtn =
    document.getElementsByClassName(
        'close'
    )[0];


if (emailUsLink) {

    emailUsLink.addEventListener(
        'click',
        function(event) {

            event.preventDefault();

            if (emailModal) {
                emailModal.style.display =
                    'block';
            }

        }
    );

}


if (emailCloseBtn) {

    emailCloseBtn.addEventListener(
        'click',
        function() {

            if (emailModal) {
                emailModal.style.display =
                    'none';
            }

        }
    );

}


window.addEventListener(
    'click',
    function(event) {

        if (
            emailModal &&
            event.target === emailModal
        ) {

            emailModal.style.display =
                'none';

        }

    }
);


// =====================================================
// SUCCESS MESSAGE
// =====================================================

const params =
    new URLSearchParams(
        window.location.search
    );


if (
    params.get('message') ===
    'success'
) {

    alert(
        'Message sent successfully!'
    );

}


// =====================================================
// REMOVE PAYMENT SUCCESS FROM URL
// =====================================================

if (paymentSuccessful) {

    window.history.replaceState(
        {},
        document.title,
        window.location.pathname
    );

}


// =====================================================
// PROFILE ICON / SESSION LOGIC
// =====================================================

window.onload = async function() {

    try {

        // Update cart count
        updateCartCount();


        // Check login session
        const response =
            await fetch(
                '/check-session'
            );


        const data =
            await response.json();


        const profileIcon =
            document.getElementById(
                'profile-icon'
            );


        if (
            profileIcon
        ) {

            if (data.loggedIn) {

                profileIcon.href =
                    '/dashboard';

            } else {

                profileIcon.href =
                    '/login';

            }

        }

    } catch (error) {

        console.error(
            'Error checking session:',
            error
        );

    }

};


// =====================================================
// INITIALIZE CART COUNT
// =====================================================

updateCartCount();

