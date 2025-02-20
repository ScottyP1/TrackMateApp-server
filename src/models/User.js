const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// Define the schema
const userSchema = new mongoose.Schema({
    userName: { type: String, required: true, unique: true },
    admin: { type: String },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    pushToken: { type: String, default: '' },
    profileAvatar: { type: String, default: '' },
    favorites: { type: [String], default: [] },
    friendsId: { type: [String], default: [] },
    owned: { type: [String], default: [] }, // New field for storing favorite track ids
    userBike: {
        type: {
            name: { type: String, required: true },  // Bike name
            color: { type: String, required: true }  // Bike color
        },
        required: true
    }
});

// Hash the password before saving the user
userSchema.pre('save', function (next) {
    const user = this;
    if (!user.isModified('password')) {
        return next();
    }

    bcrypt.genSalt(12, (err, salt) => {
        if (err) {
            return next(err);
        }
        bcrypt.hash(user.password, salt, (err, hash) => {
            if (err) {
                return next(err);
            }
            user.password = hash;
            next();
        });
    });
});

// Method to compare the password
userSchema.methods.comparePassword = function (userPassword) {
    return new Promise((resolve, reject) => {
        bcrypt.compare(userPassword, this.password, (err, isMatch) => {
            if (err) {
                console.error("Error during password comparison:", err); // Log the error
                return reject(new Error("Error comparing passwords"));
            }
            if (!isMatch) {
                return reject(new Error("Invalid email or password"));
            }
            resolve(true);
        });
    });
};



// Check if the model is already defined, and only define it if it's not
const User = mongoose.models.User || mongoose.model('User', userSchema);

module.exports = User;
