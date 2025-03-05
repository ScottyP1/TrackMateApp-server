// Load environment variables
require('dotenv').config();

// Models
require('./models/User');
require('./models/Inbox');
require('./models/Track');
require('./models/TrackComments');

// Routes
const authRoutes = require('./routes/authRoutes');
const trackRoutes = require('./routes/trackRoutes');
const trackCommentsRoutes = require('./routes/trackCommentsRoutes');
const inboxRoutes = require('./routes/inboxRoutes');

// Dependencies
const mongoose = require('mongoose');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const Inbox = require('./models/Inbox');

// Push 
const sendPushNotification = require('./notificationService');


// Initialize app and server
const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

app.use(express.json());  // Use built-in express.json() for parsing JSON
app.use(authRoutes);
app.use(trackRoutes);
app.use(trackCommentsRoutes);
app.use(inboxRoutes);

// Socket.io authentication middleware
io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;

    if (!token) {
        return next(new Error('Authentication error: Token is missing'));
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = { id: decoded.userId }; // Attach userId from the token
        next();
    } catch (err) {
        return next(new Error('Authentication error: Invalid token'));
    }
});

// Handling socket events
const User = require('./models/User'); // Import User model
const connectedUsers = new Map(); // userId -> [socketId1, socketId2, ...]

// Socket.io handling for fetchConversations
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user.id}, Socket ID: ${socket.id}`);
    if (!connectedUsers.has(socket.user.id)) {
        connectedUsers.set(socket.user.id, []);
    }
    connectedUsers.get(socket.user.id).push(socket.id);

    socket.on('joinRoom', (conversationId) => {
        console.log(`User ${socket.user.id} joining room: ${conversationId}`);
        socket.join(conversationId);  // This joins the user to the room
        io.to(socket.user.id).emit('joinRoom', conversationId);  // Notify all users in the room
    });

    socket.on('leaveRoom', (conversationId) => {
        console.log(`User ${socket.user.id} leaving room: ${conversationId}`);
        socket.leave(conversationId);  // This leaves the user from the room
        io.to(socket.user.id).emit('leaveRoom', conversationId);  // Notify all users in the room
    });

    // Listen for the sendMessage event
    socket.on('sendMessage', async ({ receiverId, conversationId, message }) => {
        try {
            const newMessage = new Inbox({
                conversationId,
                senderId: socket.user.id,
                receiverId,
                text: message,
                createdAt: new Date(),
                isSent: true, // Set before saving
            });

            await newMessage.save();

            const [otherUser, currentUser] = await Promise.all([
                User.findById(receiverId).select('userName profileAvatar pushToken'),
                User.findById(socket.user.id),
            ]);

            const messageData = { ...newMessage.toObject(), otherUser };

            // Emit to all active sockets of the receiver
            const receiverSockets = connectedUsers.get(receiverId) || [];
            receiverSockets.forEach(socketId => {
                io.to(socketId).emit('messageSent', messageData);
            });

            // Emit to the sender as well (for real-time updates)
            const senderSockets = connectedUsers.get(socket.user.id) || [];
            senderSockets.forEach(socketId => {
                io.to(socketId).emit('messageSent', messageData);
            });

            // Send push notification if the receiver has a push token
            if (otherUser.pushToken) {
                try {
                    console.log('sending notification', socket.user.id, otherUser.pushToken)
                    await sendPushNotification(otherUser.pushToken, currentUser, message);
                } catch (error) {
                    console.error("Failed to send push notification:", error);
                }
            }

        } catch (err) {
            console.error('Error sending message:', err);
        }
    });


    socket.on('markMessagesAsRead', async (conversationId) => {
        try {
            // Find all messages in this conversation where the current user is the receiver and messages are unread
            const messages = await Inbox.find({
                conversationId,
                receiverId: socket.user.id,
                isRead: false
            });

            if (!messages.length) {
                throw new Error('No unread messages found for this conversation');
            }

            // Update all unread messages for the current user to 'read'
            await Inbox.updateMany(
                { conversationId, receiverId: socket.user.id, isRead: false },
                { $set: { isRead: true } }
            );

            // Emit the update to all sockets of both users in the conversation
            const userSockets = connectedUsers.get(socket.user.id) || [];
            userSockets.forEach(socketId => {
                io.to(socketId).emit('messagesRead', { conversationId });
            });

            // Find the sender of the messages
            const senderMessage = await Inbox.findOne({ conversationId, receiverId: socket.user.id });
            if (!senderMessage) {
                throw new Error('No sender found for this conversation');
            }

            const senderId = senderMessage.senderId; // Get the sender ID from an existing message

            // Notify the sender that their messages were read
            const senderSockets = connectedUsers.get(senderId) || [];
            senderSockets.forEach(socketId => {
                io.to(socketId).emit('messagesRead', { conversationId });
            });

        } catch (err) {
            console.error('Error marking messages as read:', err.message);
        }
    });



    // Socket.io handling for deleteConversationForUser
    socket.on('deleteConversationForUser', async (conversationId) => {
        try {
            // Add the user's ID to the removedFromConvo array for all messages in the conversation
            await Inbox.updateMany(
                { conversationId },
                { $addToSet: { removedFromConvo: socket.user.id } }
            );

            // Fetch all messages in the conversation
            const messages = await Inbox.find({ conversationId });

            // Check if all messages have both users in removedFromConvo
            const allRemoved = messages.every(msg => {
                return msg.removedFromConvo.includes(msg.senderId.toString()) &&
                    msg.removedFromConvo.includes(msg.receiverId.toString());
            });

            if (allRemoved) {
                // If both users have removed all messages, delete them
                await Inbox.deleteMany({ conversationId });

                console.log('Conversation and messages deleted as both users removed it');

                // Notify both users
                const firstMessage = messages[0]; // Use first message to get sender/receiver
                const otherUserId =
                    firstMessage.senderId.toString() === socket.user.id
                        ? firstMessage.receiverId
                        : firstMessage.senderId;

                const otherUserSockets = connectedUsers.get(otherUserId) || [];
                otherUserSockets.forEach(socketId => {
                    io.to(socketId).emit('conversationDeletedForUser', { conversationId });
                });

                const currentUserSockets = connectedUsers.get(socket.user.id) || [];
                currentUserSockets.forEach(socketId => {
                    io.to(socketId).emit('conversationDeletedForUser', { conversationId });
                });
            }

            socket.emit('conversationDeletedForUser');
        } catch (err) {
            console.error('Error deleting conversation for user:', err);
            socket.emit('error', 'Failed to delete conversation for user');
        }
    });


    // Fetch messages for a specific conversation
    socket.on('fetchMessages', async (conversationId) => {
        try {
            const messages = await Inbox.find({
                conversationId,
                removedFromConvo: { $ne: socket.user.id }, // Exclude messages where the user was removed
            }).sort({ createdAt: 1 });

            // Fetch other user's details for each message
            const messagesWithUserInfo = await Promise.all(messages.map(async (message) => {
                const otherUserId = message.senderId.toString() === socket.user.id ? message.receiverId : message.senderId;
                const otherUser = await User.findById(otherUserId).select('userName profileAvatar');

                return {
                    ...message.toObject(),
                    otherUser,
                };
            }));

            socket.emit('messagesFetched', messagesWithUserInfo);
        } catch (error) {
            socket.emit('error', 'Failed to fetch messages');
        }
    });


    // Fetch all conversations for the logged-in user
    socket.on('fetchConversations', async () => {
        try {
            // Find all conversations where the user is either the sender or the receiver
            const conversations = await Inbox.find({
                $or: [{ senderId: socket.user.id }, { receiverId: socket.user.id }],
                removedFromConvo: { $ne: socket.user.id }, // Exclude deleted conversations for this user
            }).sort({ createdAt: -1 });

            // Get unique conversationIds
            const uniqueConversations = [...new Map(conversations.map((conv) => [conv.conversationId, conv])).values()];

            // Fetch the most recent message for each unique conversationId and unread message count
            const conversationsWithDetails = await Promise.all(uniqueConversations.map(async (conversation) => {
                // Determine the other user (the one who is not the current user)
                const otherUserId = conversation.senderId.toString() === socket.user.id ? conversation.receiverId : conversation.senderId;

                // Fetch the other user's details (username and profileAvatar)
                const otherUser = await User.findById(otherUserId).select('userName profileAvatar _id');

                // Find the last message for this conversation
                const lastMessage = await Inbox.findOne({ conversationId: conversation.conversationId })
                    .sort({ createdAt: -1 })
                    .limit(1); // Get the latest message

                // Count unread messages for the current user in this conversation
                const unreadCount = await Inbox.countDocuments({
                    conversationId: conversation.conversationId,
                    receiverId: socket.user.id,
                    isRead: false, // Assuming you have a "read" field to track unread messages
                });

                // Attach the other user's details, the last message, and unread count to the conversation
                return {
                    ...conversation.toObject(), // Convert Mongoose document to plain object
                    otherUser,  // Attach the other user's details
                    lastMessage: lastMessage ? {
                        text: lastMessage.text,
                        createdAt: lastMessage.createdAt
                    } : { text: "No messages yet", createdAt: null }, // Handle missing messages
                    unreadCount, // Attach the unread message count
                };
            }));

            // Emit the conversations with last message, other user's details, and unread message count to the client
            socket.emit('conversationsFetched', conversationsWithDetails);
        } catch (error) {
            socket.emit('error', 'Failed to fetch conversations');
        }
    });


    // Handle user disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.user.id);
    });
});





// MongoDB connection
const mongoUri = process.env.MONGOURI;
mongoose.connect(mongoUri)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('Error connecting to MongoDB', err));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});