const express = require('express');
const router = express.Router();
const { submitContact } = require('../controllers/contact.controller');

/**
 * @swagger
 * tags:
 *   name: Contact
 *   description: Contact form API
 */

/**
 * @swagger
 * /api/contact:
 *   post:
 *     summary: Submit contact form
 *     tags: [Contact]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firstName
 *               - email
 *               - message
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               phone:
 *                 type: string
 *               subject:
 *                 type: string
 *                 enum: [general, support, sales, other]
 *               message:
 *                 type: string
 *     responses:
 *       200:
 *         description: Message sent successfully
 *       400:
 *         description: Missing required fields
 */
router.post('/', submitContact);

module.exports = router;
