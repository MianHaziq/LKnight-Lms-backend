const express = require('express');
const router = express.Router();
const {
  getDashboardStats,
  getRevenueChart,
  getUserGrowthChart,
  getRecentEnrollments,
  getRecentSubscriptions,
  getSubscriptionsList,
  getTopCourses,
  getAnalyticsOverview,
  getEnrollmentsByCourse,
  getRevenueByCategory,
  getRevenueByPlan,
  getSubscriptionsByPlan,
  getEnrollmentChart,
} = require('../controllers/dashboard.controller');
const { verifyAdmin } = require('../middleware/auth');

/**
 * @swagger
 * tags:
 *   - name: Dashboard
 *     description: Admin dashboard statistics and charts
 *   - name: Analytics
 *     description: Detailed analytics and reports
 */

// Apply admin verification to all routes
router.use(verifyAdmin);

// ============================================
// DASHBOARD ROUTES
// ============================================

/**
 * @swagger
 * /api/admin/dashboard/stats:
 *   get:
 *     summary: Get dashboard overview statistics
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly, yearly]
 *           default: monthly
 *     responses:
 *       200:
 *         description: Dashboard statistics
 */
router.get('/stats', getDashboardStats);

/**
 * @swagger
 * /api/admin/dashboard/revenue-chart:
 *   get:
 *     summary: Get revenue chart data (12 months)
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: months
 *         schema:
 *           type: integer
 *           default: 12
 *     responses:
 *       200:
 *         description: Revenue chart data
 */
router.get('/revenue-chart', getRevenueChart);

/**
 * @swagger
 * /api/admin/dashboard/user-growth:
 *   get:
 *     summary: Get user growth chart data
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: months
 *         schema:
 *           type: integer
 *           default: 12
 *     responses:
 *       200:
 *         description: User growth chart data with trend
 */
router.get('/user-growth', getUserGrowthChart);

/**
 * @swagger
 * /api/admin/dashboard/recent-enrollments:
 *   get:
 *     summary: Get recent enrollments
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 5
 *     responses:
 *       200:
 *         description: Recent enrollments list
 */
router.get('/recent-enrollments', getRecentEnrollments);

/**
 * @swagger
 * /api/admin/dashboard/recent-subscriptions:
 *   get:
 *     summary: Get recent plan subscriptions (for dashboard widget)
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 5
 *     responses:
 *       200:
 *         description: Recent subscriptions with user, plan, billing, amount
 */
router.get('/recent-subscriptions', getRecentSubscriptions);

/**
 * @swagger
 * /api/admin/dashboard/subscriptions:
 *   get:
 *     summary: Get subscriptions list with pagination
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Subscriptions list with pagination
 */
router.get('/subscriptions', getSubscriptionsList);

/**
 * @swagger
 * /api/admin/dashboard/top-courses:
 *   get:
 *     summary: Get top performing courses by revenue
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 5
 *     responses:
 *       200:
 *         description: Top courses list
 */
router.get('/top-courses', getTopCourses);

// ============================================
// ANALYTICS ROUTES
// ============================================

/**
 * @swagger
 * /api/admin/analytics/overview:
 *   get:
 *     summary: Get analytics overview
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [7d, 30d, 90d, 12m, all]
 *           default: 30d
 *     responses:
 *       200:
 *         description: Analytics overview data
 */
router.get('/analytics/overview', getAnalyticsOverview);

/**
 * @swagger
 * /api/admin/analytics/enrollments-by-course:
 *   get:
 *     summary: Get enrollments by course (for bar chart)
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Enrollments by course data
 */
router.get('/analytics/enrollments-by-course', getEnrollmentsByCourse);

/**
 * @swagger
 * /api/admin/analytics/revenue-by-category:
 *   get:
 *     summary: Get revenue by category (legacy pie chart)
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Revenue by category data
 */
router.get('/analytics/revenue-by-category', getRevenueByCategory);

/**
 * @swagger
 * /api/admin/analytics/revenue-by-plan:
 *   get:
 *     summary: Get revenue by plan (for pie chart, plan-based flow)
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [7d, 30d, 90d, 12m, all]
 *           default: all
 *     responses:
 *       200:
 *         description: Revenue by plan data
 */
router.get('/analytics/revenue-by-plan', getRevenueByPlan);

/**
 * @swagger
 * /api/admin/analytics/subscriptions-by-plan:
 *   get:
 *     summary: Get subscription counts by plan and billing cycle (Enrollments by Plans)
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [7d, 30d, 90d, 12m, all]
 *           default: all
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Subscriptions by plan (label + value)
 */
router.get('/analytics/subscriptions-by-plan', getSubscriptionsByPlan);

/**
 * @swagger
 * /api/admin/analytics/enrollment-chart:
 *   get:
 *     summary: Get monthly enrollment chart data
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: months
 *         schema:
 *           type: integer
 *           default: 12
 *     responses:
 *       200:
 *         description: Monthly enrollment chart data
 */
router.get('/analytics/enrollment-chart', getEnrollmentChart);

module.exports = router;
