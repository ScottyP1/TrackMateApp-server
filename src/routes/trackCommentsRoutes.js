const express = require('express');
const mongoose = require('mongoose');
const xss = require('xss');

const TrackComments = mongoose.model('TrackComments');
const User = mongoose.model('User');

const router = express.Router();

// GET endpoint to fetch comments for a specific track
router.get('/TrackComments', async (req, res) => {
    const { trackId, page = 1, limit = 10 } = req.query;  // Default to page 1 and limit 10

    if (!trackId) {
        return res.status(400).json({ message: "Track ID is required" });
    }

    try {
        const skip = (page - 1) * limit;

        // Fetch comments for the given track ID, sorted by the latest, and apply pagination
        const comments = await TrackComments.find({ trackId })
            .sort({ createdAt: -1 })  // Sort by latest
            .skip(skip)  // Skip previous pages
            .limit(Number(limit))  // Limit the number of comments per page
            .populate("userId", "userName profileAvatar userBike")
            .populate("replies.userId", "userName profileAvatar userBike");

        return res.status(200).json({ comments });
    } catch (error) {
        console.error("Error fetching comments:", error);
        return res.status(500).json({ message: "Failed to fetch comments" });
    }
});

// POST endpoint to create a new comment
router.post('/TrackComments', async (req, res) => {
    const { text, trackId, userId } = req.body;

    if (!text || !trackId || !userId) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    try {
        // Sanitize the text to prevent XSS
        const sanitizedText = xss(text);

        // Find the user by userId
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Create a new comment with sanitized text
        const newComment = new TrackComments({
            text: sanitizedText,
            trackId,
            userId: user._id,
        });

        // Save the comment and populate the user's info
        await newComment.save();
        const populatedComment = await newComment.populate("userId", "userName profileAvatar");

        return res.status(201).json(populatedComment);
    } catch (err) {
        console.error("Error in comment submission:", err);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

// PATCH endpoint to handle actions like 'like', 'unlike', or 'reply'
router.patch('/TrackComments', async (req, res) => {
    const { commentId, userId, action, text, replyUserName } = req.body;

    if (!commentId || !userId || !action) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    try {
        // Find the user by userId
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Find the comment by ID
        const comment = await TrackComments.findById(commentId);
        if (!comment) {
            return res.status(404).json({ message: "Comment not found" });
        }

        // Handle 'like' or 'unlike' action
        if (action === "like" || action === "unlike") {
            const hasLiked = comment.likes.includes(user._id);

            if (action === "like" && !hasLiked) {
                comment.likes.push(user._id);
            } else if (action === "unlike" && hasLiked) {
                comment.likes = comment.likes.filter(like => !like.equals(user._id));
            }
        }

        // Handle 'reply' action
        if (action === "reply") {
            if (!text) {
                return res.status(400).json({ message: "Missing reply text" });
            }

            // Add the reply to the replies array
            const reply = {
                text,
                userId: user._id,
                userName: replyUserName || "Anonymous",  // Default to "Anonymous" if no replyUserName
            };
            comment.replies.push(reply);
        }

        // Save the updated comment document
        await comment.save();

        // Populate replies with user data and return updated comment
        const populatedComment = await comment.populate({
            path: "replies.userId",
            select: "name profileAvatar",
        });

        return res.status(200).json({
            likes: populatedComment.likes,
            replies: populatedComment.replies,
        });
    } catch (error) {
        console.error("Error updating comment:", error);
        return res.status(500).json({ message: "Failed to update comment" });
    }
});

// DELETE endpoint to delete a comment or a reply
router.delete('/TrackComments', async (req, res) => {
    const { commentId, replyId } = req.query;

    if (!commentId) {
        return res.status(400).json({ message: "Comment ID is required" });
    }

    try {
        if (replyId) {
            // Find the comment to delete the reply from
            const comment = await TrackComments.findById(commentId);
            if (!comment) {
                return res.status(404).json({ message: "Comment not found" });
            }

            // Find the reply index and remove the reply
            const replyIndex = comment.replies.findIndex(reply => reply._id.toString() === replyId);
            if (replyIndex === -1) {
                return res.status(404).json({ message: "Reply not found" });
            }

            comment.replies.splice(replyIndex, 1);
            await comment.save();

            return res.status(200).json({ message: "Reply deleted successfully" });
        } else {
            // Delete the entire comment if replyId is not provided
            const deletedComment = await TrackComments.findByIdAndDelete(commentId);
            if (!deletedComment) {
                return res.status(404).json({ message: "Comment not found" });
            }

            return res.status(200).json({ message: "Comment deleted successfully" });
        }
    } catch (error) {
        console.error("Error deleting comment or reply:", error);
        return res.status(500).json({ message: "Failed to delete comment or reply" });
    }
});

module.exports = router;
