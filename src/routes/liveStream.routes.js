const express = require('express');
const router = express.Router();
const prisma = require('../config/db');
const { verifyToken, verifyAdmin } = require('../middleware/auth');
const { userHasActiveSubscription } = require('../controllers/subscription.controller');
const {
  createStream,
  listStreams,
  getStreamById,
  updateStream,
  deleteStream,
  getActiveStream,
  getPlaybackById,
  getStreamActiveStatus,
} = require('../controllers/liveStream.controller');

const requirePaidOrTrial = async (req, res, next) => {
  try {
    // Admins can always watch live stream (e.g. to verify it works)
    let isAdmin = req.userRole === 'ADMIN';
    if (!isAdmin && req.userId) {
      const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { role: true },
      });
      isAdmin = user?.role === 'ADMIN';
    }
    if (isAdmin) {
      return next();
    }
    const hasAccess = await userHasActiveSubscription(req.userId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Live stream is available only for paid or trial plan members. Please upgrade to access.',
        code: 'LIVE_REQUIRES_SUBSCRIPTION',
      });
    }
    next();
  } catch (err) {
    next(err);
  }
};

// ---- Public (no auth) - must be before /:id ----
router.get('/active-status', getStreamActiveStatus);

// ---- Viewer routes (authenticated + paid/trial) - must be before /:id ----
router.get('/playback/active', verifyToken, requirePaidOrTrial, getActiveStream);
router.get('/playback/:id', verifyToken, requirePaidOrTrial, getPlaybackById);

// ---- Admin routes ----
router.post('/', verifyToken, verifyAdmin, createStream);
router.get('/', verifyToken, verifyAdmin, listStreams);
router.get('/:id', verifyToken, verifyAdmin, getStreamById);
router.patch('/:id', verifyToken, verifyAdmin, updateStream);
router.delete('/:id', verifyToken, verifyAdmin, deleteStream);

module.exports = router;
