const express = require('express');
const router = express.Router();
const {
  getAllPlans,
  getAllPlansAdmin,
  getPlanById,
  createPlan,
  updatePlan,
  deletePlan,
  reorderPlans,
} = require('../controllers/plan.controller');
const { verifyAdmin } = require('../middleware/auth');

// ============================================
// PUBLIC ROUTES
// ============================================

/**
 * @swagger
 * /api/plans:
 *   get:
 *     summary: Get all active plans (for pricing page)
 *     tags: [Plans]
 *     responses:
 *       200:
 *         description: List of active plans
 */
router.get('/', getAllPlans);

// ============================================
// ADMIN ROUTES
// ============================================

/**
 * @swagger
 * /api/plans/admin:
 *   get:
 *     summary: Get all plans (admin - includes inactive)
 *     tags: [Plans]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all plans with subscription counts
 */
router.get('/admin', verifyAdmin, getAllPlansAdmin);

/**
 * @swagger
 * /api/plans/reorder:
 *   patch:
 *     summary: Reorder plans
 *     tags: [Plans]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               plans:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *     responses:
 *       200:
 *         description: Plans reordered successfully
 */
router.patch('/reorder', verifyAdmin, reorderPlans);

/**
 * @swagger
 * /api/plans/admin/{id}:
 *   get:
 *     summary: Get plan by ID (admin)
 *     tags: [Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Plan details
 *       404:
 *         description: Plan not found
 */
router.get('/admin/:id', verifyAdmin, getPlanById);

/**
 * @swagger
 * /api/plans:
 *   post:
 *     summary: Create a new plan
 *     tags: [Plans]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Plan created successfully
 *       400:
 *         description: Validation error
 *       409:
 *         description: Plan already exists
 */
router.post('/', verifyAdmin, createPlan);

/**
 * @swagger
 * /api/plans/{id}:
 *   put:
 *     summary: Update a plan
 *     tags: [Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Plan updated successfully
 *       404:
 *         description: Plan not found
 */
router.put('/:id', verifyAdmin, updatePlan);

/**
 * @swagger
 * /api/plans/{id}:
 *   delete:
 *     summary: Delete a plan
 *     tags: [Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Plan deleted successfully
 *       400:
 *         description: Cannot delete - has active subscriptions
 *       404:
 *         description: Plan not found
 */
router.delete('/:id', verifyAdmin, deletePlan);

module.exports = router;
