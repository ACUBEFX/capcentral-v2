const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');


const session = require('express-session');
const path = require('path');
require('dotenv').config();
const { createSessionSecurity } = require('./config/sessionSecurity');
const {
  csrfSynchronisedProtection,
  generateToken
} = require('./middlewares/csrfProtection');
const reservationExpiryService = require('./services/reservationExpiryService');
const flash = require('connect-flash');

const authRoutes = require('./routes/authroutes');
const loginRoutes = require('./routes/authroutes');
const contactRoutes = require('./routes/contactroutes');
const resetRoutes = require('./routes/resetroutes');
const servicesRoutes = require('./routes/serviceroutes');
const paystackRoutes  = require('./routes/paystackroutes');
const dashboardRoutes = require('./routes/dashboardroutes');
const profileRoutes = require('./routes/profileroutes');
const checkoutRoutes = require('./routes/checkoutroutes');
const servingPages = require('./routes/serveroutes');
const adminRoutes = require('./routes/adminroutes');


const app = express();
const PORT = process.env.PORT || 3000;
const sessionSecurity = createSessionSecurity(process.env);

// Railway forwards one trusted proxy hop and sets X-Forwarded-Proto.
// Keep proxy trust disabled in local development and other environments.
app.set('trust proxy', sessionSecurity.trustProxy);

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware

app.use(flash());
app.use(session({
  secret: sessionSecurity.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, // 1 day
    httpOnly: true,
    sameSite: 'lax',
    secure: sessionSecurity.secureCookie
  }
}));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.json({
    verify: (req, res, buf) => {
        if (
            req.originalUrl.split('?')[0] ===
            '/checkout/webhook'
        ) {
            req.rawBody = Buffer.from(buf);
        }
    }
}));

// Protect every unsafe browser request. The CSRF middleware itself exempts
// only the Paystack server-to-server webhook endpoint.
app.use(csrfSynchronisedProtection);

app.get('/csrf-token', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Vary', 'Cookie');
  return res.json({ csrfToken: generateToken(req) });
});

// Routes
app.use('/', authRoutes);
app.use('/', loginRoutes);
app.use('/', contactRoutes);
app.use('/', resetRoutes);
app.use('/', servicesRoutes);
app.use('/', paystackRoutes);
app.use('/', dashboardRoutes);
app.use('/', profileRoutes);
app.use('/', servingPages);
app.use('/', checkoutRoutes);
app.use('/', adminRoutes);

console.log(Date.now());


// Default homepage (optional)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'homepage.html'));
});

// Endpoint to check if a user is logged in
app.get('/check-session', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true });
  } else {
    res.json({ loggedIn: false });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);

    // Handle CSRF errors separately
    if (
        err.code === 'EBADCSRFTOKEN' ||
        err.name === 'ForbiddenError'
    ) {
        res.set('X-CSRF-Error', '1');
        res.set('Cache-Control', 'no-store');
        return res.status(403).send(
          'Your security token is missing or expired. Reload the page and try again.'
        );
    }

    // Handle other errors
    return res.status(500).send('Something went wrong!');
});
// Server start
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
  reservationExpiryService.start();
});





