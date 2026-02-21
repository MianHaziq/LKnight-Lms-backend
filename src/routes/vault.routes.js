const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const {
  getDiscussions,
  getDiscussionById,
  createDiscussion,
  deleteDiscussion,
  toggleDiscussionLike,
  getComments,
  getReplies,
  createComment,
  toggleCommentLike,
  deleteComment,
  getStats,
} = require('../controllers/vault.controller');

// All vault routes require authentication
router.use(verifyToken);

// Stats
router.get('/stats', getStats);

// Discussions
router.get('/discussions', getDiscussions);
router.get('/discussions/:id', getDiscussionById);
router.post('/discussions', createDiscussion);
router.delete('/discussions/:id', deleteDiscussion);

// Discussion likes
router.post('/discussions/:id/like', toggleDiscussionLike);

// Comments on a discussion
router.get('/discussions/:id/comments', getComments);
router.post('/discussions/:id/comments', createComment);

// Comment replies
router.get('/comments/:commentId/replies', getReplies);

// Comment likes & delete
router.post('/comments/:commentId/like', toggleCommentLike);
router.delete('/comments/:commentId', deleteComment);

module.exports = router;
