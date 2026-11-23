const validateLoginInput = (req, res, next) => {
    const { email, password } = req.body;
  
    // Basic validation
    if (!email || !password) {
      return res.status(400).send('Both email and password are required.');
    }
  
    // Simple email regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).send('Invalid email format.');
    }
  
    // Optional: Check password length
    if (password.length < 6) {
      return res.status(400).send('Password must be at least 6 characters.');
    }
  
    next(); // Proceed to login controller
  };
  
  module.exports = validateLoginInput;
  