const prisma = require('../config/db');

// ============================================
// HELPER: Strip user identity for anonymity
// ============================================

/**
 * Returns display author info based on role.
 * - If the author is ADMIN → show "Admin"
 * - All other users (including self) → show "Anonymous"
 * - isOwn flag is set so the user can delete their own posts
 */
const getAuthorDisplay = (authorId, authorRole, requestingUserId) => {
  if (authorRole === 'ADMIN') {
    return { displayName: 'Admin', isAdmin: true, isOwn: authorId === requestingUserId };
  }
  return { displayName: 'Anonymous', isAdmin: false, isOwn: authorId === requestingUserId };
};

// ============================================
// GET /api/vault/discussions
// List discussions with cursor-based pagination (10 per page)
// ============================================
const getDiscussions = async (req, res, next) => {
  try {
    const { category, cursor, limit = 10 } = req.query;
    const take = Math.min(parseInt(limit) || 10, 50);
    const userId = req.userId;

    const where = {};
    if (category && category !== 'all') {
      where.category = category;
    }

    // Cursor-based pagination for infinite scroll
    const queryOptions = {
      where,
      take: take + 1, // Fetch one extra to check if there's a next page
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, role: true } },
        _count: { select: { comments: true, likes: true } },
        likes: {
          where: { userId },
          select: { id: true },
        },
      },
    };

    if (cursor) {
      queryOptions.cursor = { id: cursor };
      queryOptions.skip = 1; // Skip the cursor itself
    }

    const discussions = await prisma.vaultDiscussion.findMany(queryOptions);

    const hasMore = discussions.length > take;
    const results = hasMore ? discussions.slice(0, take) : discussions;

    const formatted = results.map((d) => {
      const author = getAuthorDisplay(d.user.id, d.user.role, userId);
      return {
        id: d.id,
        title: d.title,
        description: d.description,
        category: d.category,
        createdAt: d.createdAt,
        author: author.displayName,
        isAdmin: author.isAdmin,
        isOwn: author.isOwn,
        likesCount: d._count.likes,
        commentsCount: d._count.comments,
        isLiked: d.likes.length > 0,
      };
    });

    res.json({
      success: true,
      data: {
        discussions: formatted,
        nextCursor: hasMore ? results[results.length - 1].id : null,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// GET /api/vault/discussions/:id
// Get single discussion with its comments
// ============================================
const getDiscussionById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const discussion = await prisma.vaultDiscussion.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, role: true } },
        _count: { select: { comments: true, likes: true } },
        likes: {
          where: { userId },
          select: { id: true },
        },
      },
    });

    if (!discussion) {
      return res.status(404).json({ success: false, message: 'Discussion not found' });
    }

    const author = getAuthorDisplay(discussion.user.id, discussion.user.role, userId);

    res.json({
      success: true,
      data: {
        id: discussion.id,
        title: discussion.title,
        description: discussion.description,
        category: discussion.category,
        createdAt: discussion.createdAt,
        author: author.displayName,
        isAdmin: author.isAdmin,
        isOwn: author.isOwn,
        likesCount: discussion._count.likes,
        commentsCount: discussion._count.comments,
        isLiked: discussion.likes.length > 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// POST /api/vault/discussions
// Create a new discussion
// ============================================
const createDiscussion = async (req, res, next) => {
  try {
    const { title, description, category } = req.body;
    const userId = req.userId;
    const userRole = req.userRole;

    if (!title || !description || !category) {
      return res.status(400).json({
        success: false,
        message: 'Title, description, and category are required',
      });
    }

    const discussion = await prisma.vaultDiscussion.create({
      data: { title, description, category, userId },
    });

    const isAdmin = userRole === 'ADMIN';

    res.status(201).json({
      success: true,
      data: {
        id: discussion.id,
        title: discussion.title,
        description: discussion.description,
        category: discussion.category,
        createdAt: discussion.createdAt,
        author: isAdmin ? 'Admin' : 'Anonymous',
        isAdmin,
        isOwn: true,
        likesCount: 0,
        commentsCount: 0,
        isLiked: false,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// DELETE /api/vault/discussions/:id
// Delete own discussion (or admin can delete any)
// ============================================
const deleteDiscussion = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const userRole = req.userRole;

    const discussion = await prisma.vaultDiscussion.findUnique({ where: { id } });

    if (!discussion) {
      return res.status(404).json({ success: false, message: 'Discussion not found' });
    }

    if (discussion.userId !== userId && userRole !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await prisma.vaultDiscussion.delete({ where: { id } });

    res.json({ success: true, message: 'Discussion deleted' });
  } catch (error) {
    next(error);
  }
};

// ============================================
// POST /api/vault/discussions/:id/like
// Toggle like on a discussion
// ============================================
const toggleDiscussionLike = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const existing = await prisma.vaultLike.findUnique({
      where: { userId_discussionId: { userId, discussionId: id } },
    });

    if (existing) {
      await prisma.vaultLike.delete({ where: { id: existing.id } });
    } else {
      await prisma.vaultLike.create({
        data: { userId, discussionId: id },
      });
    }

    const likesCount = await prisma.vaultLike.count({ where: { discussionId: id } });

    res.json({
      success: true,
      data: { isLiked: !existing, likesCount },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// GET /api/vault/discussions/:id/comments
// Get comments for a discussion (cursor-based, 10 per page)
// ============================================
const getComments = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { cursor, limit = 10 } = req.query;
    const take = Math.min(parseInt(limit) || 10, 50);
    const userId = req.userId;

    const queryOptions = {
      where: { discussionId: id, parentId: null }, // Only top-level comments
      take: take + 1,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, role: true } },
        _count: { select: { replies: true, likes: true } },
        likes: {
          where: { userId },
          select: { id: true },
        },
        replies: {
          take: 3, // Preload first 3 replies
          orderBy: { createdAt: 'asc' },
          include: {
            user: { select: { id: true, role: true } },
            _count: { select: { replies: true, likes: true } },
            likes: {
              where: { userId },
              select: { id: true },
            },
          },
        },
      },
    };

    if (cursor) {
      queryOptions.cursor = { id: cursor };
      queryOptions.skip = 1;
    }

    const comments = await prisma.vaultComment.findMany(queryOptions);

    const hasMore = comments.length > take;
    const results = hasMore ? comments.slice(0, take) : comments;

    const formatComment = (c) => {
      const author = getAuthorDisplay(c.user.id, c.user.role, userId);
      return {
        id: c.id,
        content: c.content,
        createdAt: c.createdAt,
        author: author.displayName,
        isAdmin: author.isAdmin,
        isOwn: author.isOwn,
        likesCount: c._count.likes,
        repliesCount: c._count.replies,
        isLiked: c.likes.length > 0,
        replies: c.replies ? c.replies.map(formatComment) : [],
      };
    };

    res.json({
      success: true,
      data: {
        comments: results.map(formatComment),
        nextCursor: hasMore ? results[results.length - 1].id : null,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// GET /api/vault/comments/:commentId/replies
// Load more replies for a comment (cursor-based)
// ============================================
const getReplies = async (req, res, next) => {
  try {
    const { commentId } = req.params;
    const { cursor, limit = 10 } = req.query;
    const take = Math.min(parseInt(limit) || 10, 50);
    const userId = req.userId;

    const queryOptions = {
      where: { parentId: commentId },
      take: take + 1,
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, role: true } },
        _count: { select: { replies: true, likes: true } },
        likes: {
          where: { userId },
          select: { id: true },
        },
      },
    };

    if (cursor) {
      queryOptions.cursor = { id: cursor };
      queryOptions.skip = 1;
    }

    const replies = await prisma.vaultComment.findMany(queryOptions);

    const hasMore = replies.length > take;
    const results = hasMore ? replies.slice(0, take) : replies;

    const formatted = results.map((r) => {
      const author = getAuthorDisplay(r.user.id, r.user.role, userId);
      return {
        id: r.id,
        content: r.content,
        createdAt: r.createdAt,
        author: author.displayName,
        isAdmin: author.isAdmin,
        isOwn: author.isOwn,
        likesCount: r._count.likes,
        repliesCount: r._count.replies,
        isLiked: r.likes.length > 0,
      };
    });

    res.json({
      success: true,
      data: {
        replies: formatted,
        nextCursor: hasMore ? results[results.length - 1].id : null,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// POST /api/vault/discussions/:id/comments
// Add a comment or reply to a discussion
// ============================================
const createComment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { content, parentId } = req.body;
    const userId = req.userId;
    const userRole = req.userRole;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: 'Content is required',
      });
    }

    // Verify discussion exists
    const discussion = await prisma.vaultDiscussion.findUnique({ where: { id } });
    if (!discussion) {
      return res.status(404).json({ success: false, message: 'Discussion not found' });
    }

    // If parentId is set, verify parent comment exists and belongs to same discussion
    if (parentId) {
      const parent = await prisma.vaultComment.findUnique({ where: { id: parentId } });
      if (!parent || parent.discussionId !== id) {
        return res.status(400).json({ success: false, message: 'Invalid parent comment' });
      }
    }

    const comment = await prisma.vaultComment.create({
      data: {
        content,
        userId,
        discussionId: id,
        parentId: parentId || null,
      },
    });

    const isAdmin = userRole === 'ADMIN';

    res.status(201).json({
      success: true,
      data: {
        id: comment.id,
        content: comment.content,
        createdAt: comment.createdAt,
        author: isAdmin ? 'Admin' : 'Anonymous',
        isAdmin,
        isOwn: true,
        likesCount: 0,
        repliesCount: 0,
        isLiked: false,
        replies: [],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// POST /api/vault/comments/:commentId/like
// Toggle like on a comment
// ============================================
const toggleCommentLike = async (req, res, next) => {
  try {
    const { commentId } = req.params;
    const userId = req.userId;

    const existing = await prisma.vaultLike.findUnique({
      where: { userId_commentId: { userId, commentId } },
    });

    if (existing) {
      await prisma.vaultLike.delete({ where: { id: existing.id } });
    } else {
      await prisma.vaultLike.create({
        data: { userId, commentId },
      });
    }

    const likesCount = await prisma.vaultLike.count({ where: { commentId } });

    res.json({
      success: true,
      data: { isLiked: !existing, likesCount },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// DELETE /api/vault/comments/:commentId
// Delete own comment (or admin can delete any)
// ============================================
const deleteComment = async (req, res, next) => {
  try {
    const { commentId } = req.params;
    const userId = req.userId;
    const userRole = req.userRole;

    const comment = await prisma.vaultComment.findUnique({ where: { id: commentId } });

    if (!comment) {
      return res.status(404).json({ success: false, message: 'Comment not found' });
    }

    if (comment.userId !== userId && userRole !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await prisma.vaultComment.delete({ where: { id: commentId } });

    res.json({ success: true, message: 'Comment deleted' });
  } catch (error) {
    next(error);
  }
};

// ============================================
// GET /api/vault/stats
// Community stats for the sidebar
// ============================================
const getStats = async (req, res, next) => {
  try {
    const [totalDiscussions, totalComments, totalMembers] = await Promise.all([
      prisma.vaultDiscussion.count(),
      prisma.vaultComment.count(),
      prisma.vaultDiscussion.findMany({
        select: { userId: true },
        distinct: ['userId'],
      }),
    ]);

    res.json({
      success: true,
      data: {
        activeMembers: totalMembers.length,
        discussions: totalDiscussions,
        replies: totalComments,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
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
};
