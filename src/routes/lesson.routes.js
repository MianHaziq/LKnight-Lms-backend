const express = require('express');
const router = express.Router({ mergeParams: true });
const {
  getLessonsByModule,
  getLessonById,
  createLesson,
  updateLesson,
  deleteLesson,
  reorderLessons,
  uploadLessonVideo,
  getLessonVideoUrl,
  getLessonVideoStatus,
} = require('../controllers/lesson.controller');
const { verifyToken, verifyInstructorOrAdmin } = require('../middleware/auth');
const { uploadVideo } = require('../middleware/upload');

/**
 * @swagger
 * components:
 *   schemas:
 *     Lesson:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         title:
 *           type: string
 *         videoUrl:
 *           type: string
 *         duration:
 *           type: integer
 *           description: Duration in seconds
 *         order:
 *           type: integer
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     LessonInput:
 *       type: object
 *       required:
 *         - title
 *       properties:
 *         title:
 *           type: string
 *         videoUrl:
 *           type: string
 *         duration:
 *           type: integer
 *           description: Duration in seconds
 */

/**
 * @swagger
 * /api/modules/{moduleId}/lessons:
 *   get:
 *     summary: Get all lessons for a module
 *     tags: [Lessons]
 *     parameters:
 *       - in: path
 *         name: moduleId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of lessons
 *       404:
 *         description: Module not found
 */
router.get('/', getLessonsByModule);

/**
 * @swagger
 * /api/modules/{moduleId}/lessons/reorder:
 *   patch:
 *     summary: Reorder lessons within a module
 *     tags: [Lessons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: moduleId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               lessons:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *     responses:
 *       200:
 *         description: Lessons reordered successfully
 *       404:
 *         description: Module not found
 */
router.patch('/reorder', verifyInstructorOrAdmin, reorderLessons);

/**
 * @swagger
 * /api/modules/{moduleId}/lessons:
 *   post:
 *     summary: Create a new lesson
 *     tags: [Lessons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: moduleId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LessonInput'
 *     responses:
 *       201:
 *         description: Lesson created successfully
 *       404:
 *         description: Module not found
 */
router.post('/', verifyInstructorOrAdmin, createLesson);

module.exports = router;

// Standalone lesson routes (not nested under modules)
const standaloneRouter = express.Router();

/**
 * @swagger
 * /api/lessons/{id}:
 *   get:
 *     summary: Get lesson by ID
 *     tags: [Lessons]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lesson details
 *       404:
 *         description: Lesson not found
 */
standaloneRouter.get('/:id', getLessonById);

/**
 * @swagger
 * /api/lessons/{id}:
 *   put:
 *     summary: Update a lesson
 *     tags: [Lessons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LessonInput'
 *     responses:
 *       200:
 *         description: Lesson updated successfully
 *       404:
 *         description: Lesson not found
 */
standaloneRouter.put('/:id', verifyInstructorOrAdmin, updateLesson);

/**
 * @swagger
 * /api/lessons/{id}:
 *   delete:
 *     summary: Delete a lesson
 *     tags: [Lessons]
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
 *         description: Lesson deleted successfully
 *       404:
 *         description: Lesson not found
 */
standaloneRouter.delete('/:id', verifyInstructorOrAdmin, deleteLesson);

/**
 * @swagger
 * /api/lessons/{id}/video:
 *   post:
 *     summary: Upload video to Bunny Stream for a lesson
 *     tags: [Lessons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               video:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Video uploaded successfully
 *       400:
 *         description: No video file provided
 *       404:
 *         description: Lesson not found
 */
standaloneRouter.post('/:id/video', verifyInstructorOrAdmin, uploadVideo.single('video'), uploadLessonVideo);

/**
 * @swagger
 * /api/lessons/{id}/video-url:
 *   get:
 *     summary: Get signed video embed URL for playback
 *     tags: [Lessons]
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
 *         description: Signed embed URL
 *       404:
 *         description: Lesson or video not found
 */
standaloneRouter.get('/:id/video-url', verifyToken, getLessonVideoUrl);

/**
 * @swagger
 * /api/lessons/{id}/video-status:
 *   get:
 *     summary: Get video encoding status
 *     tags: [Lessons]
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
 *         description: Video encoding status
 *       404:
 *         description: Lesson not found
 */
standaloneRouter.get('/:id/video-status', verifyToken, getLessonVideoStatus);

module.exports.standaloneRouter = standaloneRouter;
