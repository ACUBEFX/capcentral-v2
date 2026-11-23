const burger = document.getElementById('burger');
    const navLinks = document.getElementById('nav-links');
    
    burger.addEventListener('click', () => {
      navLinks.classList.toggle('nav-active');
      burger.classList.toggle('toggle');
    });
  
    document.querySelectorAll('.nav-links a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('nav-active');
        burger.classList.remove('toggle');
      });
    });
  
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
    "url('jpg/atiku/atiku1.JPG",//atiku
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
const emailUsLink = document.getElementById('emailUsLink');
const closeBtn = document.getElementsByClassName('close')[0];

// Open modal when "Email us" is clicked
if (emailUsLink) {
  emailUsLink.addEventListener('click', function(event) {
    event.preventDefault();
    modal.style.display = 'block';
  });
}

// Close modal when the close (×) is clicked
if (closeBtn) {
  closeBtn.addEventListener('click', function() {
    modal.style.display = 'none';
  });
}

// Close modal when clicking outside the modal content
window.addEventListener('click', function(event) {
  if (event.target === modal) {
    modal.style.display = 'none';
  }
});

// Optional: Hide modal when form is submitted (form will still submit to /contact)
const emailForm = document.getElementById('emailForm');
if (emailForm) {
  emailForm.addEventListener('submit', function() {
    modal.style.display = 'none'; // Just visually hides it; form still submits
  });
}

// Show alert if message=success is in the URL query params
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
