const mongoose = require('mongoose');

const inboxSchema = new mongoose.Schema({
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: { type: String, required: true },
    conversationId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    removedFromConvo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    isRead: { type: Boolean, default: false },
    isSent: { type: Boolean, default: false },
});

// Ensure conversationId is unique for each conversation (only if it doesn't already exist)
if (!inboxSchema.path('conversationId').options.index) {
    inboxSchema.index({ conversationId: 1 });
}

// Create the Inbox model
const Inbox = mongoose.models.Inbox || mongoose.model('Inbox', inboxSchema);

module.exports = Inbox;
