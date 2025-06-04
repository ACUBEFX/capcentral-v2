const db = require('../models/database'); // Ensure this path is correct

const dashboard = (req, res) => {
  const sessionUser = req.session.user;

  if (!sessionUser || !sessionUser.id) {
    return res.redirect('/login');
  }

  const sql = 'SELECT username, email, phone_number, address FROM signup WHERE id = ?';

  db.query(sql, [sessionUser.id], (err, results) => {
    if (err) {
      console.error('Error fetching user for dashboard:', err);
      return res.status(500).send('Error fetching dashboard data');
    }

    if (results.length === 0) {
      return res.status(404).send('User not found');
    }

    const userData = results[0]; // Fresh data from DB
    res.render('profile', { user: userData }); // or 'dashboard' if that's your intended view
  });
};

module.exports = { dashboard };
