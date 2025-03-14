const axios = require('axios');

const sendAnnoncementNotification = async ({ token, announcement, trackName }) => {
    const cleanedMessage = announcement.trim().slice(0, 200); // Adjust the length if needed
    const messagePayload = {
        to: token,
        sound: 'default',
        title: 'TrackMate',
        subtitle: trackName,
        body: cleanedMessage
    };
    // @${currentUser.userName}`
    try {
        await axios.post('https://exp.host/--/api/v2/push/send', messagePayload, {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Error sending push notification:', error);
    }
};
module.exports = sendAnnoncementNotification; 