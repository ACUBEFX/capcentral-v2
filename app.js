const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');


const session = require('express-session');
const path = require('path');
require('dotenv').config();
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

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware

app.use(flash());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, // 1 day
    httpOnly: true,
    sameSite: 'lax',
    secure: false
  }
}));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.json());

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
        return res.status(403).send('Forbidden: Invalid or missing security token.');
    }

    // Handle other errors
    return res.status(500).send('Something went wrong!');
});
// Server start
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
