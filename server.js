require('dotenv').config();
console.log('[SERVER] Starting application...');
console.log('[SERVER] NODE_ENV:', process.env.NODE_ENV);
console.log('[SERVER] PORT:', process.env.PORT);

const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./src/config/swagger');

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('[SERVER] Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[SERVER] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Route imports
const authRoutes = require('./src/routes/auth.routes');
const userRoutes = require('./src/routes/user.routes');
const adminRoutes = require('./src/routes/admin.routes');
const categoryRoutes = require('./src/routes/category.routes');
const courseRoutes = require('./src/routes/course.routes');
const moduleRoutes = require('./src/routes/module.routes');
const { standaloneRouter: moduleStandaloneRoutes } = require('./src/routes/module.routes');
const lessonRoutes = require('./src/routes/lesson.routes');
const { standaloneRouter: lessonStandaloneRoutes } = require('./src/routes/lesson.routes');
const dashboardRoutes = require('./src/routes/dashboard.routes');
const enrollmentRoutes = require('./src/routes/enrollment.routes');
const teamRoutes = require('./src/routes/team.routes');
const testimonialRoutes = require('./src/routes/testimonial.routes');
const contactRoutes = require('./src/routes/contact.routes');
const vaultRoutes = require('./src/routes/vault.routes');
const settingsRoutes = require('./src/routes/settings.routes');
const {
  courseDocumentRouter,
  moduleDocumentRouter,
  lessonDocumentRouter,
  standaloneRouter: documentStandaloneRoutes,
} = require('./src/routes/document.routes');

const errorHandler = require('./src/middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5000'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// ============================================
// STRIPE WEBHOOK (must be before express.json - needs raw body for signature verification)
// ============================================
const { handleStripeWebhook } = require('./src/controllers/enrollment.controller');
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);

const { handleBunnyWebhook } = require('./src/controllers/bunnyWebhook.controller');
app.post('/api/webhooks/bunny', express.raw({ type: 'application/json' }), handleBunnyWebhook);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Swagger Documentation
const swaggerOptions = {
  swaggerOptions: {
    tryItOutEnabled: true,           // Auto-enable "Try it out" for all endpoints
    persistAuthorization: true,      // Keep bearer token after page refresh
  },
};
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerOptions));

// Health check
app.get('/', (req, res) => {
  res.json({
    message: 'LKnight API is running',
    status: 'healthy',
    version: '1.0.0',
    docs: '/api-docs',
  });
});

// ============================================
// AUTH & USER ROUTES
// ============================================
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admins', adminRoutes);

// ============================================
// COURSE MANAGEMENT ROUTES
// ============================================
app.use('/api/categories', categoryRoutes);

// Document routes (registered before entity routes for proper path matching)
app.use('/api/courses/:courseId/documents', courseDocumentRouter);
app.use('/api/modules/:moduleId/documents', moduleDocumentRouter);
app.use('/api/lessons/:lessonId/documents', lessonDocumentRouter);
app.use('/api/documents', documentStandaloneRoutes);

app.use('/api/courses', courseRoutes);

// Nested routes for modules under courses
app.use('/api/courses/:courseId/modules', moduleRoutes);

// Standalone module routes
app.use('/api/modules', moduleStandaloneRoutes);

// Nested routes for lessons under modules
app.use('/api/modules/:moduleId/lessons', lessonRoutes);

// Standalone lesson routes
app.use('/api/lessons', lessonStandaloneRoutes);

// ============================================
// ENROLLMENT ROUTES
// ============================================
app.use('/api/enrollments', enrollmentRoutes);

// ============================================
// ADMIN DASHBOARD & ANALYTICS ROUTES
// ============================================
app.use('/api/admin/dashboard', dashboardRoutes);

// ============================================
// TEAM ROUTES
// ============================================
app.use('/api/team', teamRoutes);

// ============================================
// TESTIMONIAL ROUTES
// ============================================
app.use('/api/testimonials', testimonialRoutes);

// ============================================
// CONTACT ROUTES
// ============================================
app.use('/api/contact', contactRoutes);

// ============================================
// VAULT ROUTES
// ============================================
app.use('/api/vault', vaultRoutes);

// ============================================
// SETTINGS ROUTES
// ============================================
app.use('/api/settings', settingsRoutes);

// Error handling middleware
app.use(errorHandler);

// Start server - bind to 0.0.0.0 for Docker/Railway
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`[SERVER] ✓ Server is running on port ${PORT}`);
  console.log(`[SERVER] ✓ Local:   http://localhost:${PORT}`);
  console.log(`[SERVER] ✓ Swagger: http://localhost:${PORT}/api-docs`);
});

server.on('error', (err) => {
  console.error('[SERVER] Failed to start server:', err);
  process.exit(1);
});
