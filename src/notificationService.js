const axios = require('axios');

const sendPushNotification = async (pushToken, currentUser, message) => {
    // Clean message (trim whitespace and limit length)
    const cleanedMessage = message.trim().slice(0, 200); // Adjust the length if needed

    const messagePayload = {
        to: pushToken,
        sound: 'default',
        title: `TrackMate @${currentUser.userName}`,
        body: cleanedMessage,
    };

    try {
        await axios.post('https://exp.host/--/api/v2/push/send', messagePayload, {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Error sending push notification:', error);
    }
};
module.exports = sendPushNotification; 