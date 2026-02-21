const prisma = require('../config/db');
const stripe = require('../config/stripe');
const nodemailer = require('nodemailer');

/**
 * Capitalize first letter, lowercase rest (e.g., "PENDING" -> "Pending")
 */
const capitalize = (str) => {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

/**
 * @desc    Get all enrollments with pagination and filters
 * @route   GET /api/enrollments
 * @access  Admin
 */
const getAllEnrollments = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      courseId,
      userId,
      sortBy = 'enrolledAt',
      order = 'desc',
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Build where clause
    const where = {};

    if (status) {
      where.status = status.toUpperCase();
    }

    if (courseId) {
      where.courseId = courseId;
    }

    if (userId) {
      where.userId = userId;
    }

    const [enrollments, total] = await Promise.all([
      prisma.enrollment.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: order },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              avatar: true,
            },
          },
          course: {
            select: {
              id: true,
              title: true,
              thumbnail: true,
              price: true,
            },
          },
        },
      }),
      prisma.enrollment.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: enrollments.map((e) => ({
        id: e.id,
        user: {
          id: e.user.id,
          name: `${e.user.firstName} ${e.user.lastName}`,
          email: e.user.email,
          avatar:
            e.user.avatar ||
            `${e.user.firstName?.charAt(0) || ''}${e.user.lastName?.charAt(0) || ''}`,
        },
        course: e.course,
        price: e.price,
        status: capitalize(e.status),
        progress: e.progress,
        enrolledAt: e.enrolledAt,
        completedAt: e.completedAt,
      })),
      pagination: {
        page: parseInt(page),
        limit: take,
        total,
        totalPages: Math.ceil(total / take),
        hasNext: skip + take < total,
        hasPrev: parseInt(page) > 1,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get enrollment by ID
 * @route   GET /api/enrollments/:id
 * @access  Admin
 */
const getEnrollmentById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const enrollment = await prisma.enrollment.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatar: true,
          },
        },
        course: {
          select: {
            id: true,
            title: true,
            thumbnail: true,
            price: true,
            level: true,
          },
        },
      },
    });

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: 'Enrollment not found',
      });
    }

    res.status(200).json({
      success: true,
      data: enrollment,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create new enrollment
 * @route   POST /api/enrollments
 * @access  Admin/User
 */
const createEnrollment = async (req, res, next) => {
  try {
    const { userId, courseId, price } = req.body;

    if (!userId || !courseId) {
      return res.status(400).json({
        success: false,
        message: 'User ID and Course ID are required',
      });
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Check if course exists
    const course = await prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    // Check if enrollment already exists
    const existingEnrollment = await prisma.enrollment.findUnique({
      where: {
        userId_courseId: { userId, courseId },
      },
    });

    if (existingEnrollment) {
      return res.status(409).json({
        success: false,
        message: 'User is already enrolled in this course',
      });
    }

    const enrollment = await prisma.enrollment.create({
      data: {
        userId,
        courseId,
        price: price !== undefined ? parseFloat(price) : course.price,
        status: 'PENDING',
        progress: 0,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        course: {
          select: {
            id: true,
            title: true,
            thumbnail: true,
          },
        },
      },
    });

    res.status(201).json({
      success: true,
      message: 'Enrollment created successfully',
      data: enrollment,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update enrollment status
 * @route   PATCH /api/enrollments/:id/status
 * @access  Admin
 */
const updateEnrollmentStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required',
      });
    }

    const validStatuses = ['PENDING', 'COMPLETED', 'REFUNDED'];
    if (!validStatuses.includes(status.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be PENDING, COMPLETED, or REFUNDED',
      });
    }

    const enrollment = await prisma.enrollment.findUnique({
      where: { id },
    });

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: 'Enrollment not found',
      });
    }

    const updateData = {
      status: status.toUpperCase(),
    };

    // Set completedAt if status is COMPLETED
    if (status.toUpperCase() === 'COMPLETED') {
      updateData.completedAt = new Date();
      updateData.progress = 100;
    }

    const updatedEnrollment = await prisma.enrollment.update({
      where: { id },
      data: updateData,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        course: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    res.status(200).json({
      success: true,
      message: `Enrollment ${status.toLowerCase()} successfully`,
      data: updatedEnrollment,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update enrollment progress
 * @route   PATCH /api/enrollments/:id/progress
 * @access  User
 */
const updateEnrollmentProgress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { progress } = req.body;

    if (progress === undefined || progress < 0 || progress > 100) {
      return res.status(400).json({
        success: false,
        message: 'Progress must be a number between 0 and 100',
      });
    }

    const enrollment = await prisma.enrollment.findUnique({
      where: { id },
    });

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: 'Enrollment not found',
      });
    }

    const updateData = {
      progress: parseInt(progress),
    };

    // Auto-complete if progress is 100
    if (parseInt(progress) === 100 && enrollment.status !== 'COMPLETED') {
      updateData.status = 'COMPLETED';
      updateData.completedAt = new Date();
    }

    const updatedEnrollment = await prisma.enrollment.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({
      success: true,
      message: 'Progress updated successfully',
      data: updatedEnrollment,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Process refund
 * @route   POST /api/enrollments/:id/refund
 * @access  Admin
 */
const processRefund = async (req, res, next) => {
  try {
    const { id } = req.params;

    const enrollment = await prisma.enrollment.findUnique({
      where: { id },
    });

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: 'Enrollment not found',
      });
    }

    if (enrollment.status === 'REFUNDED') {
      return res.status(400).json({
        success: false,
        message: 'Enrollment has already been refunded',
      });
    }

    const updatedEnrollment = await prisma.enrollment.update({
      where: { id },
      data: {
        status: 'REFUNDED',
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        course: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    res.status(200).json({
      success: true,
      message: 'Refund processed successfully',
      data: updatedEnrollment,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete enrollment
 * @route   DELETE /api/enrollments/:id
 * @access  Admin
 */
const deleteEnrollment = async (req, res, next) => {
  try {
    const { id } = req.params;

    const enrollment = await prisma.enrollment.findUnique({
      where: { id },
    });

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: 'Enrollment not found',
      });
    }

    await prisma.enrollment.delete({
      where: { id },
    });

    res.status(200).json({
      success: true,
      message: 'Enrollment deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get enrollment statistics
 * @route   GET /api/enrollments/stats
 * @access  Admin
 */
const getEnrollmentStats = async (req, res, next) => {
  try {
    const [total, pending, completed, refunded, revenue] = await Promise.all([
      prisma.enrollment.count(),
      prisma.enrollment.count({ where: { status: 'PENDING' } }),
      prisma.enrollment.count({ where: { status: 'COMPLETED' } }),
      prisma.enrollment.count({ where: { status: 'REFUNDED' } }),
      prisma.enrollment.aggregate({
        where: { status: { not: 'REFUNDED' } },
        _sum: { price: true },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        total,
        pending,
        completed,
        refunded,
        totalRevenue: revenue._sum.price || 0,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get current user's enrolled courses (for user dashboard)
 * @route   GET /api/enrollments/my-courses
 * @access  User
 */
const getMyEnrollments = async (req, res, next) => {
  try {
    const userId = req.userId;

    const enrollments = await prisma.enrollment.findMany({
      where: { userId },
      orderBy: { enrolledAt: 'desc' },
      include: {
        course: {
          include: {
            category: {
              select: { id: true, name: true, slug: true },
            },
            instructor: {
              select: { id: true, firstName: true, lastName: true },
            },
            _count: {
              select: { modules: true, enrollments: true },
            },
            modules: {
              select: {
                _count: { select: { lessons: true } },
              },
            },
          },
        },
      },
    });

    // Transform the data for frontend
    const courses = enrollments.map((e) => {
      const totalLessons = e.course.modules.reduce(
        (sum, m) => sum + m._count.lessons,
        0
      );
      return {
        enrollmentId: e.id,
        progress: e.progress,
        status: capitalize(e.status),
        enrolledAt: e.enrolledAt,
        completedAt: e.completedAt,
        course: {
          id: e.course.id,
          title: e.course.title,
          slug: e.course.slug,
          summary: e.course.summary,
          thumbnail: e.course.thumbnail,
          level: e.course.level,
          price: e.course.price,
          category: e.course.category,
          instructor: e.course.instructorName
            || (e.course.instructor
              ? `${e.course.instructor.firstName} ${e.course.instructor.lastName}`
              : null),
          moduleCount: e.course._count.modules,
          lessonCount: totalLessons,
          enrollments: e.course._count.enrollments,
        },
      };
    });

    res.status(200).json({
      success: true,
      data: courses,
      count: courses.length,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get user dashboard stats
 * @route   GET /api/enrollments/my-stats
 * @access  User
 */
const getUserDashboardStats = async (req, res, next) => {
  try {
    const userId = req.userId;

    // Exclude REFUNDED enrollments from all stats
    const activeWhere = { userId, status: { not: 'REFUNDED' } };

    const [
      totalEnrolled,
      inProgress,
      completed,
      avgResult,
    ] = await Promise.all([
      // Total active enrollments (PENDING + COMPLETED, excludes REFUNDED)
      prisma.enrollment.count({ where: activeWhere }),
      // In Progress = PENDING status (not yet completed)
      prisma.enrollment.count({
        where: { userId, status: 'PENDING' },
      }),
      // Completed courses
      prisma.enrollment.count({ where: { userId, status: 'COMPLETED' } }),
      // Average progress across active enrollments only
      prisma.enrollment.aggregate({
        where: activeWhere,
        _avg: { progress: true },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalEnrolled,
        inProgress,
        completed,
        avgProgress: Math.round(avgResult._avg.progress || 0),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all published courses with user's enrollment status
 * @route   GET /api/enrollments/all-courses
 * @access  User
 */
const getAllCoursesWithStatus = async (req, res, next) => {
  try {
    const userId = req.userId;

    // Get user info including accessAll
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { accessAll: true },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Get all published courses
    const courses = await prisma.course.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { createdAt: 'desc' },
      include: {
        category: {
          select: { id: true, name: true, slug: true },
        },
        instructor: {
          select: { id: true, firstName: true, lastName: true },
        },
        _count: {
          select: { modules: true, enrollments: true },
        },
        modules: {
          select: {
            _count: { select: { lessons: true } },
          },
        },
      },
    });

    // Get user's enrollments
    const enrollments = await prisma.enrollment.findMany({
      where: { userId },
      select: { courseId: true, id: true, progress: true, status: true, enrolledAt: true },
    });

    const enrollmentMap = new Map(enrollments.map((e) => [e.courseId, e]));

    // Transform courses with enrollment info
    const coursesWithStatus = courses.map((course) => {
      const enrollment = enrollmentMap.get(course.id);
      const totalLessons = course.modules.reduce(
        (sum, m) => sum + m._count.lessons,
        0
      );

      return {
        id: course.id,
        title: course.title,
        slug: course.slug,
        summary: course.summary,
        thumbnail: course.thumbnail,
        level: course.level,
        price: course.price,
        status: course.status,
        category: course.category,
        instructor: course.instructorName
          || (course.instructor
            ? `${course.instructor.firstName} ${course.instructor.lastName}`
            : null),
        moduleCount: course._count.modules,
        lessonCount: totalLessons,
        enrollments: course._count.enrollments,
        // Access status
        isEnrolled: !!enrollment,
        hasAccess: user.accessAll || !!enrollment,
        enrollmentId: enrollment?.id || null,
        progress: enrollment?.progress || 0,
        enrolledAt: enrollment?.enrolledAt || null,
      };
    });

    res.status(200).json({
      success: true,
      data: coursesWithStatus,
      count: coursesWithStatus.length,
      accessAll: user.accessAll,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Purchase/enroll in a single course (simulates payment)
 * @route   POST /api/enrollments/purchase/:courseId
 * @access  User
 */
const purchaseCourse = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { courseId } = req.params;

    // Check if course exists and is published
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        category: { select: { name: true } },
        instructor: { select: { firstName: true, lastName: true } },
      },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    if (course.status !== 'PUBLISHED') {
      return res.status(400).json({
        success: false,
        message: 'This course is not available for enrollment',
      });
    }

    // Check if already enrolled
    const existingEnrollment = await prisma.enrollment.findUnique({
      where: {
        userId_courseId: { userId, courseId },
      },
    });

    if (existingEnrollment) {
      return res.status(409).json({
        success: false,
        message: 'You are already enrolled in this course',
      });
    }

    // Create enrollment (simulate successful payment)
    const enrollment = await prisma.enrollment.create({
      data: {
        userId,
        courseId,
        price: course.price,
        status: 'PENDING',
        progress: 0,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Successfully enrolled in the course',
      data: {
        enrollmentId: enrollment.id,
        course: {
          id: course.id,
          title: course.title,
          slug: course.slug,
          thumbnail: course.thumbnail,
          price: course.price,
          instructor: course.instructorName
            || (course.instructor
              ? `${course.instructor.firstName} ${course.instructor.lastName}`
              : null),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get course details for subscription/checkout page
 * @route   GET /api/enrollments/checkout/:courseId
 * @access  User
 */
const getCheckoutDetails = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { courseId } = req.params;

    // Get course with full details
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        instructor: { select: { id: true, firstName: true, lastName: true } },
        modules: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            title: true,
            _count: { select: { lessons: true } },
          },
        },
        _count: { select: { enrollments: true } },
      },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    // Check if user already has access
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { accessAll: true },
    });

    const enrollment = await prisma.enrollment.findUnique({
      where: {
        userId_courseId: { userId, courseId },
      },
    });

    const totalLessons = course.modules.reduce(
      (sum, m) => sum + m._count.lessons,
      0
    );

    res.status(200).json({
      success: true,
      data: {
        id: course.id,
        title: course.title,
        slug: course.slug,
        summary: course.summary,
        description: course.description,
        thumbnail: course.thumbnail,
        level: course.level,
        price: course.price,
        category: course.category,
        instructor: course.instructorName
          || (course.instructor
            ? `${course.instructor.firstName} ${course.instructor.lastName}`
            : null),
        moduleCount: course.modules.length,
        lessonCount: totalLessons,
        enrollments: course._count.enrollments,
        modules: course.modules.map((m) => ({
          id: m.id,
          title: m.title,
          lessonCount: m._count.lessons,
        })),
        // User's access status
        hasAccess: user.accessAll || !!enrollment,
        isEnrolled: !!enrollment,
        enrollmentId: enrollment?.id || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Enroll current user in all published courses (temporary for free access)
 * @route   POST /api/enrollments/enroll-all
 * @access  User
 */
const enrollInAllCourses = async (req, res, next) => {
  try {
    const userId = req.userId;

    // Get all published courses
    const publishedCourses = await prisma.course.findMany({
      where: { status: 'PUBLISHED' },
      select: { id: true, price: true },
    });

    // Get user's existing enrollments
    const existingEnrollments = await prisma.enrollment.findMany({
      where: { userId },
      select: { courseId: true },
    });

    const enrolledCourseIds = new Set(existingEnrollments.map((e) => e.courseId));

    // Filter courses not yet enrolled
    const coursesToEnroll = publishedCourses.filter(
      (c) => !enrolledCourseIds.has(c.id)
    );

    if (coursesToEnroll.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Already enrolled in all available courses',
        data: { enrolled: 0 },
      });
    }

    // Create enrollments for all new courses
    const enrollments = await prisma.enrollment.createMany({
      data: coursesToEnroll.map((course) => ({
        userId,
        courseId: course.id,
        price: 0, // Free enrollment for now
        status: 'PENDING',
        progress: 0,
      })),
    });

    res.status(201).json({
      success: true,
      message: `Successfully enrolled in ${enrollments.count} courses`,
      data: { enrolled: enrollments.count },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Helper: Send email using SMTP (same pattern as contact.controller)
 */
const sendPaymentEmail = async (to, subject, html) => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: `"LKnight Learning Hub" <${process.env.FROM_EMAIL || 'noreply@lknightproductions.com'}>`,
    to,
    subject,
    html,
  });
};

/**
 * @desc    Create Stripe Checkout Session for course purchase
 * @route   POST /api/enrollments/create-checkout-session
 * @access  User
 */
const createCheckoutSession = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { courseId } = req.body;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: 'courseId is required',
      });
    }

    // Check if course exists and is published
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        instructor: { select: { firstName: true, lastName: true } },
      },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    if (course.status !== 'PUBLISHED') {
      return res.status(400).json({
        success: false,
        message: 'This course is not available for enrollment',
      });
    }

    // Check if already enrolled
    const existingEnrollment = await prisma.enrollment.findUnique({
      where: {
        userId_courseId: { userId, courseId },
      },
    });

    if (existingEnrollment) {
      return res.status(409).json({
        success: false,
        message: 'You are already enrolled in this course',
      });
    }

    // Get user info
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true, lastName: true },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // FREE COURSE: Enroll directly without Stripe
    if (course.price === 0) {
      const enrollment = await prisma.enrollment.create({
        data: {
          userId,
          courseId,
          price: 0,
          status: 'PENDING',
          progress: 0,
          paymentMethod: 'free',
        },
      });

      return res.status(201).json({
        success: true,
        message: 'Successfully enrolled in the free course',
        data: {
          enrollmentId: enrollment.id,
          free: true,
        },
      });
    }

    // PAID COURSE: Verify Stripe is configured
    if (!stripe) {
      return res.status(503).json({
        success: false,
        message: 'Payment service is not configured. Please contact support.',
      });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: course.title,
              description: course.instructorName
                ? `By ${course.instructorName}`
                : (course.instructor
                  ? `By ${course.instructor.firstName} ${course.instructor.lastName}`
                  : 'LKnight Learning Hub Course'),
            },
            unit_amount: Math.round(course.price * 100), // Stripe expects cents
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId,
        courseId,
        courseTitle: course.title,
      },
      success_url: `${frontendUrl}/dashboard/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/dashboard/checkout/${courseId}?canceled=true`,
      payment_intent_data: {
        receipt_email: user.email,
      },
    });

    res.status(200).json({
      success: true,
      data: {
        sessionId: session.id,
        sessionUrl: session.url,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Handle Stripe webhook events
 * @route   POST /api/webhooks/stripe
 * @access  Public (verified via Stripe signature)
 */
const handleStripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[STRIPE WEBHOOK] STRIPE_WEBHOOK_SECRET is not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[STRIPE WEBHOOK] Signature verification failed:', err.message);
    // Return 200 to prevent Stripe from retrying indefinitely on bad signatures
    return res.status(200).json({ error: 'Signature verification failed' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('[STRIPE WEBHOOK] checkout.session.completed:', session.id);

    try {
      const { userId, courseId, courseTitle } = session.metadata;

      if (!userId || !courseId) {
        console.error('[STRIPE WEBHOOK] Missing metadata in session:', session.id);
        return res.status(200).json({ received: true });
      }

      // IDEMPOTENCY: Check if this session was already processed
      const existingBySession = await prisma.enrollment.findUnique({
        where: { stripeSessionId: session.id },
      });

      if (existingBySession) {
        console.log('[STRIPE WEBHOOK] Already processed session:', session.id);
        return res.status(200).json({ received: true });
      }

      // DUPLICATE: Check if user already enrolled via another path
      const existingEnrollment = await prisma.enrollment.findUnique({
        where: {
          userId_courseId: { userId, courseId },
        },
      });

      if (existingEnrollment) {
        // Don't reactivate a refunded enrollment via a stale webhook
        if (existingEnrollment.status === 'REFUNDED') {
          console.warn('[STRIPE WEBHOOK] Skipping re-enrollment on refunded enrollment:',
            existingEnrollment.id, 'session:', session.id);
          return res.status(200).json({ received: true });
        }

        // Update existing enrollment with Stripe payment info
        await prisma.enrollment.update({
          where: { id: existingEnrollment.id },
          data: {
            stripeSessionId: session.id,
            stripePaymentId: session.payment_intent,
            paymentMethod: 'stripe',
          },
        });
        console.log('[STRIPE WEBHOOK] Updated existing enrollment:', existingEnrollment.id);
        return res.status(200).json({ received: true });
      }

      // CREATE ENROLLMENT — use session.amount_total (what user actually paid)
      const enrollment = await prisma.enrollment.create({
        data: {
          userId,
          courseId,
          price: session.amount_total ? (session.amount_total / 100) : 0,
          status: 'PENDING',
          progress: 0,
          stripeSessionId: session.id,
          stripePaymentId: session.payment_intent,
          paymentMethod: 'stripe',
        },
      });

      console.log('[STRIPE WEBHOOK] Enrollment created:', enrollment.id, 'for course:', courseTitle);

      // Send receipt email (non-blocking - don't fail enrollment if email fails)
      try {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { email: true, firstName: true },
        });

        if (user) {
          const amountPaid = (session.amount_total / 100).toFixed(2);
          await sendPaymentEmail(
            user.email,
            `Enrollment Confirmed: ${courseTitle}`,
            `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: #000E51; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
                  <h2 style="color: white; margin: 0; font-size: 22px;">LKnight Learning Hub</h2>
                </div>
                <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                  <div style="text-align: center; margin-bottom: 20px;">
                    <div style="width: 50px; height: 50px; background: #dcfce7; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;">
                      <span style="color: #16a34a; font-size: 24px;">&#10003;</span>
                    </div>
                  </div>
                  <h3 style="color: #000E51; margin: 0 0 16px 0; text-align: center;">Payment Confirmed!</h3>
                  <p style="color: #374151; margin: 0 0 8px 0;">Hi ${user.firstName},</p>
                  <p style="color: #374151; margin: 0 0 16px 0;">Your enrollment in <strong>${courseTitle}</strong> has been confirmed.</p>
                  <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                    <table style="width: 100%; border-collapse: collapse;">
                      <tr>
                        <td style="padding: 4px 0; color: #6b7280; font-size: 14px;">Course</td>
                        <td style="padding: 4px 0; color: #111827; font-size: 14px; text-align: right; font-weight: 600;">${courseTitle}</td>
                      </tr>
                      <tr>
                        <td style="padding: 4px 0; color: #6b7280; font-size: 14px;">Amount Paid</td>
                        <td style="padding: 4px 0; color: #111827; font-size: 14px; text-align: right; font-weight: 600;">$${amountPaid}</td>
                      </tr>
                      <tr>
                        <td style="padding: 4px 0; color: #6b7280; font-size: 14px;">Payment ID</td>
                        <td style="padding: 4px 0; color: #111827; font-size: 14px; text-align: right; font-family: monospace;">${session.payment_intent}</td>
                      </tr>
                    </table>
                  </div>
                  <div style="text-align: center;">
                    <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard"
                       style="display: inline-block; background: #FF6F00; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                      Go to Dashboard
                    </a>
                  </div>
                  <p style="color: #9ca3af; font-size: 12px; margin: 20px 0 0 0; text-align: center;">
                    If you have any questions, contact us at ${process.env.CONTACT_EMAIL || 'inquiries@lknightproductions.com'}
                  </p>
                </div>
              </div>
            `
          );
        }
      } catch (emailError) {
        console.error('[STRIPE WEBHOOK] Receipt email failed:', emailError.message);
      }

    } catch (dbError) {
      console.error('[STRIPE WEBHOOK] Database error:', session.id, dbError);
      // Return 500 so Stripe retries with exponential backoff (~3 days)
      // Idempotency check (stripeSessionId unique) prevents duplicates on retry
      return res.status(500).json({ error: 'Database error - will retry' });
    }
  }

  // Handle expired checkout sessions (user abandoned payment)
  if (event.type === 'checkout.session.expired') {
    const session = event.data.object;
    console.log('[STRIPE WEBHOOK] checkout.session.expired:', session.id,
      'userId:', session.metadata?.userId, 'courseId:', session.metadata?.courseId);
  }

  res.status(200).json({ received: true });
};

/**
 * @desc    Get enrollment status by Stripe session ID (for success page polling)
 * @route   GET /api/enrollments/session/:sessionId
 * @access  User
 */
const getEnrollmentBySessionId = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { sessionId } = req.params;

    const enrollment = await prisma.enrollment.findUnique({
      where: { stripeSessionId: sessionId },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            slug: true,
            thumbnail: true,
          },
        },
      },
    });

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: 'Enrollment not found. Payment may still be processing.',
      });
    }

    // Verify the enrollment belongs to the requesting user
    if (enrollment.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    res.status(200).json({
      success: true,
      data: {
        enrollmentId: enrollment.id,
        status: enrollment.status,
        course: enrollment.course,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllEnrollments,
  getEnrollmentById,
  createEnrollment,
  updateEnrollmentStatus,
  updateEnrollmentProgress,
  processRefund,
  deleteEnrollment,
  getEnrollmentStats,
  getMyEnrollments,
  getUserDashboardStats,
  getAllCoursesWithStatus,
  purchaseCourse,
  getCheckoutDetails,
  enrollInAllCourses,
  createCheckoutSession,
  handleStripeWebhook,
  getEnrollmentBySessionId,
};
