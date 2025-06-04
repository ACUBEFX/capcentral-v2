// --- CART LOGIC WITH LOCAL STORAGE PERSISTENCE ---

let cart = JSON.parse(localStorage.getItem('cart')) || [];
const cartCount = document.querySelector('.cart-count');

// Update cart icon count
function updateCartCount() {
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    cartCount.textContent = totalItems;
}

// Save cart to localStorage
function saveCart() {
    localStorage.setItem('cart', JSON.stringify(cart));
    updateCartCount();
}

// Render cart UI
function renderCart() {
    const cartItemsContainer = document.querySelector('.cart-items');
    cartItemsContainer.innerHTML = `
        <button type="button" class="close-cart-button">&times;</button>
        <h2>Your Cart</h2>
    `;

    if (cart.length === 0) {
        cartItemsContainer.innerHTML += `<p><i>Nothing is added to the cart list</i></p>`;
        document.querySelector('.close-cart-button').addEventListener('click', toggleCart);
        return;
    }

    let total = 0;
    const itemsList = document.createElement('div');
    itemsList.classList.add('cart-items-list');

    cart.forEach((item, index) => {
        total += item.price * item.quantity;
        itemsList.innerHTML += `
            <div class="cart-item">
                <div class="cart-item-details">
                    <p class="cart-item-name"><strong>${item.name}</strong></p>
                    <p class="cart-item-size">Size: <strong>${item.size}</strong></p>
                    <p class="cart-item-price">Price: <strong>₦${item.price.toLocaleString()}</strong></p>
                    <p class="cart-item-quantity">Quantity: <strong>${item.quantity}</strong></p>
                </div>
                <button type="button" class="remove-item-button" data-index="${index}">Remove</button>
            </div>
        `;
    });

    cartItemsContainer.appendChild(itemsList);

    // Cart footer: total and proceed to checkout
    const cartFooter = document.createElement('div');
    cartFooter.classList.add('cart-footer');
    cartFooter.innerHTML = `
        <div class="cart-total">
            <strong>Total:</strong> ₦${total.toLocaleString()}
        </div>
        <form action="/checkout" method="POST" style="margin-top: 10px;">
            <input type="hidden" name="cart" value='${JSON.stringify(cart)}'>
            <input type="hidden" name="total" value="${total}">
            <button type="submit" class="checkout-button">Proceed to Checkout</button>
        </form>
    `;
    cartItemsContainer.appendChild(cartFooter);

    // Remove item buttons
    cartItemsContainer.querySelectorAll('.remove-item-button').forEach(button => {
        button.addEventListener('click', (e) => {
            removeFromCart(e.target.dataset.index);
        });
    });

    cartItemsContainer.querySelector('.close-cart-button').addEventListener('click', toggleCart);
}

// Remove item from cart
function removeFromCart(index) {
    cart.splice(index, 1);
    saveCart();
    renderCart();
}

// Add to cart
function addToCart(product) {
    const existingItemIndex = cart.findIndex(item => item.name === product.name && item.size === product.size);
    if (existingItemIndex !== -1) {
        cart[existingItemIndex].quantity += 1;
    } else {
        cart.push({ ...product, quantity: 1 });
    }
    saveCart();
    renderCart();
}

// --- TOGGLE CART UI ---
const cartIcon = document.querySelector('.cart-icon');
const cartItems = document.querySelector('.cart-items');

function toggleCart() {
    cartItems.style.display = cartItems.style.display === 'block' ? 'none' : 'block';
    if (cartItems.style.display === 'block') renderCart();
}

cartIcon.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCart();
});
document.addEventListener('click', () => { cartItems.style.display = 'none'; });
cartItems.addEventListener('click', (e) => e.stopPropagation());

// Add to cart via modal
document.getElementById('add-to-cart-button').addEventListener('click', () => {
    const modal = document.getElementById('product-modal');
    const productId = modal.dataset.productId;
    const productCard = document.querySelectorAll('.product-card')[productId - 1];
    const productName = productCard.querySelector('.product-name').textContent;
    const productPrice = parseFloat(productCard.querySelector('.product-price').textContent.replace('₦', '').replace(',', ''));
    const productSize = modal.querySelector('#modal-size-select').value;

    if (!productSize) {
        alert("Please select a size before adding to cart.");
        return;
    }

    const product = {
        name: productName,
        price: productPrice,
        size: productSize
    };

    addToCart(product);
    closeModal();
});

// Add to cart via product card
document.querySelectorAll('.add-to-cart-button').forEach((button) => {
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        const productCard = button.closest('.product-card');
        const productName = productCard.querySelector('.product-name').textContent;
        const productPrice = parseFloat(productCard.querySelector('.product-price').textContent.replace('₦', '').replace(',', ''));
        const productSize = productCard.querySelector('.product-size select').value;

        if (!productSize) {
            alert("Please select a size before adding to cart.");
            return;
        }

        const product = {
            name: productName,
            price: productPrice,
            size: productSize
        };

        addToCart(product);
    });
});

// --- MODAL FUNCTIONALITY ---
function openModal(productId) {
    const modal = document.getElementById('product-modal');
    const productCards = document.querySelectorAll('.product-card');
    if (productId < 1 || productId > productCards.length) return;

    const productCard = productCards[productId - 1];
    const productName = productCard.querySelector('.product-name').textContent;
    const productPrice = parseFloat(productCard.querySelector('.product-price').textContent.replace('₦', '').replace(',', ''));
    const productDesc = productCard.querySelector('.product-desc').textContent;
    const productImage = productCard.querySelector('.product-image').src;

    document.getElementById('modal-product-name').textContent = productName;
    document.getElementById('modal-product-price').textContent = `₦${productPrice.toLocaleString()}`;
    document.getElementById('modal-product-description').textContent = productDesc;
    document.getElementById('modal-product-image').src = productImage;

    modal.dataset.productId = productId;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    const modal = document.getElementById('product-modal');
    modal.style.display = 'none';
    document.body.style.overflow = 'auto';
    modal.dataset.productId = '';
}

// Modal event listeners
window.addEventListener('click', (event) => {
    const modal = document.getElementById('product-modal');
    if (event.target === modal) closeModal();
});
document.querySelectorAll('.close').forEach(closeBtn => {
    closeBtn.addEventListener('click', closeModal);
});
document.querySelectorAll('.product-size select').forEach(select => {
    select.addEventListener('click', (e) => e.stopPropagation());
});

// --- BURGER MENU & SIDEBAR ---
const burgerMenu = document.querySelector('.burger-menu');
const sidebar = document.querySelector('.sidebar');
const overlay = document.querySelector('.overlay');

burgerMenu.addEventListener('click', function() {
    this.classList.toggle('open');
    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
    document.body.style.overflow = this.classList.contains('open') ? 'hidden' : 'auto';
});
overlay.addEventListener('click', function() {
    burgerMenu.classList.remove('open');
    sidebar.classList.remove('active');
    this.classList.remove('active');
    document.body.style.overflow = 'auto';
});
document.querySelectorAll('.sidebar a').forEach(link => {
    link.addEventListener('click', () => {
        burgerMenu.classList.remove('open');
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
        document.body.style.overflow = 'auto';
    });
});
document.querySelectorAll('.dropdown-btn').forEach(button => {
    button.addEventListener('click', function() {
        this.classList.toggle('active');
        const dropdownContent = this.nextElementSibling;
        if (dropdownContent && dropdownContent.classList.contains('dropdown-content-sidebar')) {
            dropdownContent.style.display = dropdownContent.style.display === 'block' ? 'none' : 'block';
        }
        document.querySelectorAll('.dropdown-btn').forEach(otherButton => {
            if (otherButton !== this && otherButton.nextElementSibling && otherButton.nextElementSibling.classList.contains('dropdown-content-sidebar')) {
                otherButton.classList.remove('active');
                otherButton.nextElementSibling.style.display = 'none';
            }
        });
    });
});

// --- EMAIL MODAL FUNCTIONALITY ---
const emailModal = document.getElementById('email-modal');
const emailUsLink = document.getElementById('emailUsLink');
const emailCloseBtn = document.getElementsByClassName('close')[0];

if (emailUsLink) {
  emailUsLink.addEventListener('click', function(event) {
    event.preventDefault();
    emailModal.style.display = 'block';
  });
}
if (emailCloseBtn) {
  emailCloseBtn.addEventListener('click', function() {
    emailModal.style.display = 'none';
  });
}
window.addEventListener('click', function(event) {
  if (event.target === emailModal) {
    emailModal.style.display = 'none';
  }
});
const params = new URLSearchParams(window.location.search);
if (params.get('message') === 'success') {
  alert('Message sent successfully!');
}

// --- PROFILE ICON SESSION LOGIC ---
window.onload = async function() {
  try {
    updateCartCount();
    const response = await fetch('/check-session');
    const data = await response.json();
    const profileIcon = document.getElementById('profile-icon');
    if (data.loggedIn) {
      profileIcon.href = "/dashboard";
    } else {
      profileIcon.href = "/login";
    }
  } catch (error) {
    console.error('Error checking session:', error);
  }
}

// Initialize cart count on page load
updateCartCount();