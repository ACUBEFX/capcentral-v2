/* =====================================
   HOMEPAGE SIDEBAR TOGGLE
===================================== */

const burger = document.getElementById('burger');
const navLinks = document.getElementById('nav-links');
const homepageSidebar = document.getElementById('homepageSidebar');

if (burger && navLinks && homepageSidebar) {

  burger.addEventListener('click', () => {
    const isOpen = homepageSidebar.classList.toggle('sidebar-open');

    burger.classList.toggle('toggle', isOpen);
    burger.setAttribute('aria-expanded', String(isOpen));
  });

  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      homepageSidebar.classList.remove('sidebar-open');
      burger.classList.remove('toggle');
      burger.setAttribute('aria-expanded', 'false');
    });
  });

  // Close sidebar when clicking outside it.
  document.addEventListener('click', event => {
    const clickedInsideSidebar = homepageSidebar.contains(event.target);
    const clickedBurger = burger.contains(event.target);

    if (!clickedInsideSidebar && !clickedBurger) {
      homepageSidebar.classList.remove('sidebar-open');
      burger.classList.remove('toggle');
      burger.setAttribute('aria-expanded', 'false');
    }
  });

  // Close sidebar with Escape key.
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      homepageSidebar.classList.remove('sidebar-open');
      burger.classList.remove('toggle');
      burger.setAttribute('aria-expanded', 'false');
    }
  });
}


/* =====================================
   FONT AWESOME
===================================== */

const linkElement = document.createElement('link');

linkElement.rel = 'stylesheet';
linkElement.href =
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta2/css/all.min.css';

document.head.appendChild(linkElement);


/* =====================================
   HERO IMAGE SLIDER
===================================== */

function initHeroSlider(heroId, images) {

  const hero = document.getElementById(heroId);

  if (!hero || !images.length) {
    return;
  }

  let currentIndex = 0;
  const slideDuration = 1500;

  function setBackground() {
    hero.style.backgroundImage = images[currentIndex];
  }

  function nextSlide() {
    currentIndex = (currentIndex + 1) % images.length;
    setBackground();
  }

  // Initialize first slide.
  setBackground();

  // Start slideshow.
  const slideInterval = setInterval(nextSlide, slideDuration);

  // Cleanup function.
  return () => {
    clearInterval(slideInterval);
  };
}


/* =====================================
   INITIALIZE BOTH HERO SLIDERS
===================================== */

document.addEventListener('DOMContentLoaded', () => {

  const hero1Images = [
    "url('jpg/kindea/kindea5.JPG')",   // kindea
    "url('jpg/throbe4.jpeg')",         // throbe
    "url('jpg/bongool/bongool1.JPG')",  // bongool
    "url('jpg/shoes/shoe1.JPG')"       // shoe
  ];

  const hero2Images = [
    "url('jpg/atiku/atiku1.JPG')",     // atiku
    "url('jpg/shoes/shoe4.jpg')",      // shoe
    "url('jpg/miyaram/miyaram1.JPG')", // miyaram
    "url('jpg/cap5.jpeg')"             // cap
  ];

  initHeroSlider('hero1', hero1Images);
  initHeroSlider('hero2', hero2Images);

});


/* =====================================
   PHONE NUMBER FUNCTIONALITY
===================================== */

const phoneNumberLink = document.getElementById('phoneNumber');

if (phoneNumberLink) {

  phoneNumberLink.addEventListener('click', function(event) {

    event.preventDefault();

    const phoneNumber = phoneNumberLink.textContent.trim();

    window.location.href = 'tel:' + phoneNumber;

  });

}


/* =====================================
   EMAIL AND CONTACT FUNCTIONALITY
===================================== */

const modal = document.getElementById('emailModal');
const emailForm = document.getElementById('emailForm');
const openContactForm = document.getElementById('openContactForm');

const emailUsLinks = document.querySelectorAll('#emailUsLink');
const closeBtn = document.querySelector('.close');


/* Open contact modal */

emailUsLinks.forEach(link => {

  link.addEventListener('click', function(event) {

    event.preventDefault();

    if (modal) {

      modal.style.display = 'block';

      if (emailForm) {
        emailForm.hidden = true;
      }

      const contactOptions = modal.querySelector('.contact-options');

      if (contactOptions) {
        contactOptions.hidden = false;
      }

    }

  });

});


/* Close modal using close button */

if (closeBtn && modal) {

  closeBtn.addEventListener('click', () => {

    modal.style.display = 'none';

    if (emailForm) {
      emailForm.hidden = true;
    }

    const contactOptions = modal.querySelector('.contact-options');

    if (contactOptions) {
      contactOptions.hidden = false;
    }

  });

}


/* Close modal by clicking outside it */

window.addEventListener('click', event => {

  if (modal && event.target === modal) {

    modal.style.display = 'none';

    if (emailForm) {
      emailForm.hidden = true;
    }

    const contactOptions = modal.querySelector('.contact-options');

    if (contactOptions) {
      contactOptions.hidden = false;
    }

  }

});


/* Open contact form */

if (openContactForm && emailForm) {

  openContactForm.addEventListener('click', () => {

    emailForm.hidden = false;

    const contactOptions = modal
      ? modal.querySelector('.contact-options')
      : null;

    if (contactOptions) {
      contactOptions.hidden = true;
    }

  });

}


/* Hide modal after form submission */

if (emailForm && modal) {

  emailForm.addEventListener('submit', () => {

    modal.style.display = 'none';

  });

}


/* =====================================
   SUCCESS MESSAGE
===================================== */

const params = new URLSearchParams(window.location.search);

if (params.get('message') === 'success') {

  alert('Message sent successfully!');

}


/* =====================================
   ADDRESS / GOOGLE MAPS FUNCTIONALITY
===================================== */

const addressLinkElement = document.getElementById('addressLink');

if (addressLinkElement) {

  const address = addressLinkElement.textContent.trim();

  addressLinkElement.addEventListener('click', function(event) {

    event.preventDefault();

    window.open(
      'https://www.google.com/maps?q=' + encodeURIComponent(address),
      '_blank',
      'noopener,noreferrer'
    );

  });

}


/* =====================================
   TRUCKER
===================================== */
