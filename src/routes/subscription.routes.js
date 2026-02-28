const express = require('express');
const router = express.Router();
const {
  createSubscriptionCheckout,
  getMySubscription,
  cancelSubscription,
  checkAccess,
  getSubscriptionBySessionId,
  getTeamMembers,
  addTeamMember,
  removeTeamMember,
} = require('../controllers/subscription.controller');
const { verifyToken } = require('../middleware/auth');

/**
 * @swagger
 * /api/subscriptions/create-checkout-session:
 *   post:
 *     summary: Create Stripe checkout session for subscription
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - planId
 *             properties:
 *               planId:
 *                 type: string
 *               billingCycle:
 *                 type: string
 *                 enum: [MONTHLY, YEARLY]
 *               organizationName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Checkout session created
 */
router.post('/create-checkout-session', verifyToken, createSubscriptionCheckout);

/**
 * @swagger
 * /api/subscriptions/my-subscription:
 *   get:
 *     summary: Get current user's active subscription
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current subscription details or null
 */
router.get('/my-subscription', verifyToken, getMySubscription);

/**
 * @swagger
 * /api/subscriptions/cancel:
 *   post:
 *     summary: Cancel subscription at period end
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Subscription will be canceled at period end
 */
router.post('/cancel', verifyToken, cancelSubscription);

/**
 * @swagger
 * /api/subscriptions/check-access:
 *   get:
 *     summary: Check if user has access to all courses
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Access check result
 */
router.get('/check-access', verifyToken, checkAccess);

/**
 * @swagger
 * /api/subscriptions/session/{sessionId}:
 *   get:
 *     summary: Get subscription by Stripe session ID (for success page polling)
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Subscription details
 */
router.get('/session/:sessionId', verifyToken, getSubscriptionBySessionId);

/**
 * @swagger
 * /api/subscriptions/{id}/members:
 *   get:
 *     summary: Get team members of a subscription
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of team members
 */
router.get('/:id/members', verifyToken, getTeamMembers);

/**
 * @swagger
 * /api/subscriptions/{id}/members:
 *   post:
 *     summary: Add team member by email
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       201:
 *         description: Team member added
 */
router.post('/:id/members', verifyToken, addTeamMember);

/**
 * @swagger
 * /api/subscriptions/{id}/members/{memberId}:
 *   delete:
 *     summary: Remove team member
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Team member removed
 */
router.delete('/:id/members/:memberId', verifyToken, removeTeamMember);

module.exports = router;
