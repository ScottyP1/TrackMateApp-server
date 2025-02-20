const express = require('express');
const mongoose = require('mongoose');

const Inbox = mongoose.model('Inbox');
const User = mongoose.model('User');
const router = express.Router();

router.get('/Inbox', async (req, res) => {
    const { id } = req.query;

    try {
        if (!id) {
            return res.status(400).json({ message: "User ID is required." });
        }

        // Fetch all messages where the user is either sender or receiver
        const messages = await Inbox.find({
            $or: [{ senderId: id }, { receiverId: id }],
        })
            .populate('senderId receiverId', 'userName profileAvatar')
            .sort({ createdAt: -1 });

        if (!messages.length) {
            return res.status(200).json([]);
        }

        // Group messages into conversations
        const groupedConversations = groupMessagesIntoConversations(messages, id);

        return res.json(groupedConversations);
    } catch (error) {
        console.error('Error fetching Inbox:', error);
        return res.status(500).json({ error: 'Failed to fetch Inbox.' });
    }
});

router.get('/Inbox/messages', async (req, res) => {
    const { senderId, receiverId } = req.query;

    if (!senderId || !receiverId) {
        return res.status(400).json({ message: "Sender and Receiver IDs are required." });
    }

    try {
        // Generate the conversationId dynamically
        const conversationId = [senderId, receiverId].sort().join('-');

        const messages = await Inbox.find({ conversationId }).sort({ createdAt: -1 });


        return res.json(messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        return res.status(500).json({ error: 'Failed to fetch messages.' });
    }
});

router.post('/Inbox/messages', async (req, res) => {
    const { senderId, receiverId, text } = req.body;

    const sender = await User.findById(senderId);
    const receiver = await User.findById(receiverId);

    if (!sender || !receiver) {
        return res.status(400).json({ message: "Invalid sender or receiver ID." });
    }


    try {
        // Generate the conversationId by sorting senderId and receiverId
        const conversationId = [senderId, receiverId].sort().join('-');

        // Create the new message document
        const newMessage = new Inbox({
            senderId,
            receiverId,
            text,
            conversationId,  // Add the conversationId here
            createdAt: new Date(),
        });

        await newMessage.save();

        // Fetch the updated conversation with the new message
        const updatedConversation = await Inbox.find({
            conversationId
        })
            .sort({ createdAt: 1 });

        return res.json(updatedConversation);
    } catch (error) {
        console.error('Error sending message:', error);
        return res.status(500).json({ error: 'Failed to send message.' });
    }
});






module.exports = router;



const groupMessagesIntoConversations = (messages, userId) => {
    const grouped = new Map();

    try {
        messages.forEach((message) => {
            const otherUser = message.senderId._id.toString() === userId
                ? message.receiverId
                : message.senderId;

            const conversationId = [message.senderId._id, message.receiverId._id].sort().join('-');

            if (!grouped.has(conversationId)) {
                grouped.set(conversationId, {
                    conversationId,
                    senderId: message.senderId._id,
                    receiverId: message.receiverId._id,
                    userName: otherUser.userName,
                    profileAvatar: otherUser.profileAvatar,
                    lastMessage: message.text,
                    timestamp: message.createdAt,
                    messages: [],
                });
            }

            grouped.get(conversationId).messages.push(message);
        });

        Array.from(grouped.values()).forEach(conversation => {
            conversation.messages.sort((a, b) => b.createdAt - a.createdAt);
        });

        return Array.from(grouped.values());
    } catch (error) {
        console.error('Error grouping messages:', error);
        return [];
    }
};

