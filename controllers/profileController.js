// controllers/profileController.js
const db = require('../models/database');  // Assuming db is configured to interact with your SQL database.

exports.getProfile = (req, res) => {
  if (!req.session.user || !req.session.user.id) {
    return res.redirect('/login'); // No user session? Redirect to login
  }

  const userId = req.session.user.id;
  const sql = 'SELECT username, email, phone_number, address FROM signup WHERE id = ?';

  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).send('Internal Server Error');
    }

    if (results.length === 0) {
      return res.status(404).send('User not found');
    }

    const user = results[0]; // Latest profile data from DB
    res.render('profile', { user }); // Send to EJS template
  });
};


exports.updateProfile = (req, res) => {
  const { username, email, phone, address } = req.body;
  const user = req.session.user;

  if (!user || !user.id) {
    return res.redirect('/login');
  }

  const sql = 'UPDATE signup SET username = ?, email = ?, phone_number = ?, address = ? WHERE id = ?';

  db.query(sql, [username, email, phone, address, user.id], (err, results) => {
    if (err) {
      console.error('Update error:', err);
      return res.status(500).send('Error updating profile');
    }

    // ✅ Do not update req.session.user (to avoid stale data)
    // ✅ Just redirect — `getProfile` will fetch fresh DB data
    res.redirect('/profile');
  });
};
