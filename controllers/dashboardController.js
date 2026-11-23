
const dashboard = (req, res) => {
    const sessionUser = req.session.user;

    if (!sessionUser || !sessionUser.id) {
        return res.redirect('/login');
    }

    return res.redirect('/profile');
};

module.exports = { dashboard };
