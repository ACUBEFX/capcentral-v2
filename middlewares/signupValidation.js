const validateSignupInput = (req, res, next) => {
    const { username, email, password, Retypepassword } = req.body;

    // Check required fields
    if (!username || !email || !password || !Retypepassword) {
        return res.status(400).send('All fields are required.');
    }

    // Username: only letters, min 3 characters
const usernameRegex = /^[a-zA-Z0-9 ._]{3,20}$/;
    if (!usernameRegex.test(username)) {
        return res.status(400).send('Username must be at least 3 letters and contain only alphabets.');
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).send('Invalid email format.');
    }

    // Password length
    if (password.length < 6) {
        return res.status(400).send('Password must be at least 6 characters long.');
    }

    // Password match
    if (password !== Retypepassword) {
        return res.status(400).send('Passwords do not match.');
    }

    next();
};

module.exports = validateSignupInput;
