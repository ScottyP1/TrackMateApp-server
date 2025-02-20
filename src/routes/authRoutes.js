const express = require('express');
const mongoose = require('mongoose');
const User = mongoose.model('User');
const Inbox = mongoose.model('Inbox')

const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');

const router = express.Router();

router.post(
    '/Register',
    [
        body('userName').trim().notEmpty().withMessage('Username is required').escape(),
        body('email').isEmail().withMessage('Invalid email').normalizeEmail(),
        body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long').escape(),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({ errors: errors.array() });
        }

        const { userName, email, password, userBike, profileAvatar, acceptedNotifications } = req.body;
        const lowerCaseEmail = email.toLowerCase();
        const lowerCaseUserName = userName.toLowerCase();

        // Check if email or username is already in use
        const existingUser = await User.findOne({
            $or: [{ email: lowerCaseEmail }, { userName: lowerCaseUserName }]
        });

        if (existingUser) {
            return res.status(400).json({ message: "Email or Username already in use" });
        }

        // Create user with the acceptedNotifications field
        const user = new User({
            userName: lowerCaseUserName,
            email: lowerCaseEmail,
            admin: false,
            userBike: { name: userBike?.name || 'No Preference', color: userBike?.color || '#000' },
            password,
            profileAvatar,
            friendsId: [],
            favorites: [],
            owned: []
        });

        await user.save();
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);

        res.send({
            token,
            id: user._id,
            admin: user.admin,
            email: user.email,
            profileAvatar: user.profileAvatar,
            userName: user.userName,
            userBike: user.userBike,
            friendsId: [],
            favorites: [],
            owned: [],
        });
    }
);



// Login Route with Validation and Sanitization
router.post(
    '/Login',
    [
        body('emailOrUsername').trim().escape(),
        body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long').escape(),
    ],
    async (req, res) => {
        const { emailOrUsername, password } = req.body;
        const lowerCaseInput = emailOrUsername.toLowerCase();

        try {
            const user = await User.findOne({
                $or: [{ email: lowerCaseInput }, { userName: lowerCaseInput }]
            });

            if (!user) {
                return res.status(422).json({ error: 'Invalid email or password' });
            }

            const isMatch = await user.comparePassword(password);
            if (!isMatch) {
                return res.status(422).json({ error: 'Invalid email or password' });
            }

            const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);
            res.json({
                token,
                id: user._id,
                admin: user.admin,
                email: user.email,
                profileAvatar: user.profileAvatar,
                userName: user.userName,
                userBike: user.userBike,
                friendsId: user.friendsId || [],
                favorites: user.favorites || [],
                owned: user.owned || [],
            });
        } catch (err) {
            console.error("Login error:", err);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

// Delete user account
// Delete user account and their conversations
router.delete('/Account', async (req, res) => {
    const { email, id } = req.body;

    // Validate required fields
    if (!email && !id) {
        return res.status(400).json({ error: 'Email or ID is required' });
    }

    try {
        // Find the user by email or ID
        let user;
        if (email) {
            user = await User.findOne({ email: email.toLowerCase() });
        } else if (id) {
            user = await User.findById(id);
        }

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Delete conversations where the user is involved (either sender or receiver)
        await Inbox.deleteMany({
            $or: [
                { senderId: user._id },
                { receiverId: user._id }
            ]
        });
        // Now delete the user account
        await user.deleteOne();

        res.json({ message: 'User account and associated conversations deleted successfully' });
    } catch (err) {
        console.error("Error deleting user:", err);
        res.status(500).json({ error: 'Server error' });
    }
});




router.get('/check-email', async (req, res) => {
    const { email } = req.query;
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    try {
        const lowerCaseEmail = email.toLowerCase();
        const emailExists = await User.findOne({ email: lowerCaseEmail });
        res.json({ available: !emailExists }); // Return true if available, false if taken
    } catch (err) {
        console.error("Error checking email:", err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Check if username is available
router.get('/check-username', async (req, res) => {
    const { userName } = req.query;

    if (!userName) {
        return res.status(400).json({ error: 'Username is required' });
    }

    try {
        const lowerCaseUserName = userName.toLowerCase();
        const usernameExists = await User.findOne({ userName: lowerCaseUserName });

        res.json({ available: !usernameExists }); // Return true if available, false if taken
    } catch (err) {
        console.error("Error checking username:", err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Fetch account details
router.get('/Account', async (req, res) => {
    let { email, id, userIds } = req.query;

    if (!email && !id && !userIds) {
        return res.status(400).send({ error: 'Provide email, id, or an array of user IDs' });
    }

    try {
        let users;

        if (userIds) {
            // Ensure userIds is an array (handle case where it comes as a string)
            const idsArray = Array.isArray(userIds) ? userIds : userIds.split(',');
            users = await User.find({ _id: { $in: idsArray } });
            if (!users.length) {
                return res.status(404).send({ error: 'No users found' });
            }

            return res.send(users.map(user => ({
                id: user._id,
                profileAvatar: user.profileAvatar,
                userName: user.userName,
                userBike: user.userBike
            }))
            );
        } else {
            // Fetch a single user
            let user = null;

            if (email) {
                user = await User.findOne({ email: email.toLowerCase() });
            }

            if (id && !user) {
                user = await User.findById(id);
            }

            if (!user) {
                return res.status(404).send({ error: 'User not found' });
            }

            return res.send({
                id: user._id,
                email: user.email,
                admin: user.admin,
                profileAvatar: user.profileAvatar,
                userName: user.userName,
                userBike: user.userBike,
                friendsId: user.friendsId || [],
                favorites: user.favorites || [],
                owned: user.owned || [],
            });
        }
    } catch (err) {
        console.error("Error fetching user(s):", err.message);
        res.status(500).send({ error: 'Server error' });
    }
});



router.patch('/Account', async (req, res) => {
    const { email, updates } = req.body;
    // Validate required fields
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }
    if (!updates || typeof updates !== 'object') {
        return res.status(400).json({ error: 'No updates provided' });
    }

    try {
        // Find the user by email
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Update the user's fields based on the provided updates
        Object.keys(updates).forEach((key) => {
            if (key === "friendsId") {
                const newFriends = Array.isArray(updates.friendsId) ? updates.friendsId : [updates.friendsId];

                // Allow empty arrays to be valid
                if (JSON.stringify(user.friendsId) !== JSON.stringify(newFriends)) {
                    user.friendsId = newFriends;  // Directly assign if it's a new list, even if empty
                }
            } else {
                user[key] = updates[key]; // Update the other fields as usual
            }
        });

        // Save the updated user to the database
        await user.save();
        res.json({ user });
    } catch (err) {
        console.error("Error updating user:", err);
        res.status(500).json({ error: 'Server error' });
    }
});







// Search users based on input query
router.get('/search-users', async (req, res) => {
    const { query } = req.query;

    if (!query || query.trim() === "") {
        return res.status(400).json({ error: 'Search query is required' });
    }

    try {
        const regex = new RegExp(query, 'i');
        const users = await User.find({
            $or: [{ email: { $regex: regex } }, { userName: { $regex: regex } }]
        });

        res.json(users.map(({ _id, email, profileAvatar, userName, userBike, friendsId, favorites, owned }) => ({
            id: _id,
            email,
            profileAvatar,
            userName,
            userBike,
            friendsId: friendsId || [],
            favorites: favorites || [],
            owned: owned || [],
        })));
    } catch (err) {
        console.error("Search error:", err);
        res.status(500).json({ error: 'Server error' });
    }
});



module.exports = router;
