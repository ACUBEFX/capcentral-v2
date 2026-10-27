
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
        '✅ Payment successful. Cart cleared.'
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
                            ₦${item.price.toLocaleString()}
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
            ₦${total.toLocaleString()}
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


// =====================================================
// ADD ITEM TO CART
// =====================================================

function addToCart(product) {

    const card = product.productId
        ? document.querySelector(`.product-card[data-product-id="${CSS.escape(String(product.productId))}"]`)
        : null;
    if (card && Number(card.dataset.stockQuantity) <= 0) {
        alert(String(product.category || card.dataset.category || '').toLowerCase() === 'caps'
            ? 'This cap has already been sold.'
            : 'This product is out of stock.');
        return;
    }

    // Caps are unique items: do not add the same physical cap twice, even if
    // the customer selects a different size in the modal.
    const isUniqueCap = String(product.category || '').toLowerCase() === 'caps';
    const existingItemIndex = cart.findIndex(item =>
        (isUniqueCap && (String(item.productId || '') === String(product.productId || '') ||
                         String(item.productCode || '') === String(product.productCode || ''))) ||
        (!isUniqueCap && item.name === product.name && item.size === product.size)
    );

    if (existingItemIndex !== -1) {
        if (isUniqueCap) {
            alert('This cap is already in your cart. Each cap is a unique item.');
            return;
        }
        cart[existingItemIndex].quantity += 1;
    } else {
        cart.push({ ...product, quantity: 1 });
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


// =====================================================
// ADD TO CART VIA MODAL
// =====================================================

const addToCartButton = document.getElementById('add-to-cart-button');

if (addToCartButton) {
    addToCartButton.addEventListener('click', () => {
        const modal = document.getElementById('product-modal');
        if (!modal) return;

        const productId = modal.dataset.productId;
        let productCard = productId
            ? document.querySelector(`.product-card[data-product-id="${CSS.escape(String(productId))}"]`)
            : null;
        if (!productCard && modal.dataset.cardIndex !== undefined && modal.dataset.cardIndex !== '') {
            productCard = document.querySelectorAll('.product-card')[Number(modal.dataset.cardIndex)] || null;
        }

        if (!productCard) {
            alert('This product is no longer available. Please refresh the page.');
            closeModal();
            return;
        }

        const productName = productCard.querySelector('.product-name')?.textContent.trim() || '';
        const productPrice = Number(productCard.dataset.price || productCard.querySelector('.product-price')?.textContent.replace(/[^\d.]/g, '') || 0);
        const sizeSelect = modal.querySelector('#modal-size-select');
        const productSize = sizeSelect?.value || 'One Size';

        if (sizeSelect && !productSize) {
            alert('Please select a size before adding to cart.');
            return;
        }

        if (Number(productCard.dataset.stockQuantity) <= 0) {
            alert(String(productCard.dataset.category).toLowerCase() === 'caps'
                ? 'This cap has already been sold.'
                : 'This product is out of stock.');
            return;
        }

        addToCart({
            name: productName,
            price: productPrice,
            size: productSize,
            productId: productCard.dataset.productId || null,
            productCode: productCard.dataset.productCode || null,
            category: productCard.dataset.category || inferPageCategory()
        });

        closeModal();
    });
}

// Keep the original static brand pages working; category pages replace their cards
// from the database and use their own delegated click handler.
document.querySelectorAll('.product-card .add-to-cart-button').forEach((button) => {
    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const productCard = button.closest('.product-card');
        if (!productCard) return;

        const productName = productCard.querySelector('.product-name')?.textContent.trim() || '';
        const productPrice = Number(productCard.dataset.price || productCard.querySelector('.product-price')?.textContent.replace(/[^\d.]/g, '') || 0);
        const sizeSelect = productCard.querySelector('.product-size select');
        const productSize = sizeSelect?.value || (inferPageCategory() === 'Hats' ? 'One Size' : '');

        if (!productSize) {
            alert('Please select a size before adding to cart.');
            return;
        }

        addToCart({
            name: productName,
            price: productPrice,
            size: productSize,
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
    if (priceNode) priceNode.textContent = `₦${productPrice.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
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

    // Match the modal size choices to the selected product card.
    const modalSize = modal.querySelector('#modal-size-select');
    const cardSize = productCard.querySelector('.product-size select');
    if (modalSize && cardSize) {
        modalSize.innerHTML = cardSize.innerHTML;
        modalSize.value = cardSize.value || '';
        modalSize.disabled = cardSize.disabled;
    } else if (modalSize) {
        modalSize.innerHTML = '<option value="One Size">One Size</option>';
        modalSize.value = 'One Size';
    }

    modal.dataset.productId = productCard.dataset.productId || '';
    modal.dataset.productCode = productCard.dataset.productCode || '';
    modal.dataset.category = productCard.dataset.category || inferPageCategory();
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

