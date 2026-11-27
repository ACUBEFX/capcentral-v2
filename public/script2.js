
const burger = document.getElementById('burger');
const navLinks = document.getElementById('nav-links');

if (burger && navLinks) {
  burger.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('nav-active');

    burger.classList.toggle('toggle', isOpen);
    burger.setAttribute('aria-expanded', String(isOpen));
  });

  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('nav-active');
      burger.classList.remove('toggle');
      burger.setAttribute('aria-expanded', 'false');
    });
  });
}

  
    const linkElement = document.createElement('link');
    linkElement.rel = 'stylesheet';
    linkElement.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta2/css/all.min.css';
    document.head.appendChild(linkElement);
  
    function initHeroSlider(heroId, images) {
  const hero = document.getElementById(heroId);
  if (!hero || !images.length) return;

  let currentIndex = 0;
  const slideDuration = 1500; // 3 seconds

  function setBackground() {
    hero.style.backgroundImage = images[currentIndex];
  }

  function nextSlide() {
    currentIndex = (currentIndex + 1) % images.length;
    setBackground();
  }

  // Initialize first slide
  setBackground();

  // Start slideshow
  const slideInterval = setInterval(nextSlide, slideDuration);

  // Cleanup function
  return () => {
    clearInterval(slideInterval);
  };
}

// Initialize both sliders
document.addEventListener('DOMContentLoaded', () => {
  const hero1Images = [
    "url('jpg/kindea/kindea5.JPG')",//kindea
    "url('jpg/throbe4.jpeg')",//throbe
    "url('jpg/bongool/bongool1.JPG')",//bongool
    "url('jpg/shoes/shoe1.JPG')"//shoe
  ];

  const hero2Images = [
    "url('jpg/atiku/atiku1.JPG')",//atiku
    "url('jpg/shoes/shoe4.jpg')",//shoe
    "url('jpg/miyaram/miyaram1.JPG')",//miyaram
    "url('jpg/cap5.jpeg')" 
  ];

  initHeroSlider('hero1', hero1Images);
  initHeroSlider('hero2', hero2Images);
});
  
    const phoneNumberLink = document.getElementById('phoneNumber');
    if (phoneNumberLink) {
      phoneNumberLink.addEventListener('click', function(event) {
        event.preventDefault();
        const phoneNumber = phoneNumberLink.textContent.trim();
        window.location.href = "tel:" + phoneNumber;
      });
    }

 ///////////////////////////////////////////////////
 /////// Email Functionality ///////////////////

const modal = document.getElementById('emailModal');
const emailUsLinks = document.querySelectorAll('#emailUsLink');
const closeBtn = document.querySelector('.close');

emailUsLinks.forEach(link => {
  link.addEventListener('click', function(event) {
    event.preventDefault();

    if (modal) {
      modal.style.display = 'block';
    }
  });
});

if (closeBtn && modal) {
  closeBtn.addEventListener('click', () => {
    modal.style.display = 'none';
  });
}

window.addEventListener('click', event => {
  if (modal && event.target === modal) {
    modal.style.display = 'none';
  }
});

const emailForm = document.getElementById('emailForm');
const openContactForm = document.getElementById('openContactForm');

if (openContactForm && emailForm) {
  openContactForm.addEventListener('click', () => {
    emailForm.hidden = false;
    openContactForm.closest('.contact-options').hidden = true;
  });
}

if (emailForm && modal) {
  emailForm.addEventListener('submit', () => {
    modal.style.display = 'none';
  });
}

const params = new URLSearchParams(window.location.search);

if (params.get('message') === 'success') {
  alert('Message sent successfully!');
      }


  
    const addressLinkElement = document.getElementById('addressLink');
    if (addressLinkElement) {
      const address = addressLinkElement.innerHTML.trim();
      addressLinkElement.addEventListener('click', function(event) {
        event.preventDefault();
        window.open('https://www.google.com/maps?q=' + encodeURIComponent(address), '_blank');
      });
    }




    ///////////////////////////////////////////TRUCKER///////////////////////////////////////////////
