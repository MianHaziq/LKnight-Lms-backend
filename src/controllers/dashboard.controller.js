const prisma = require('../config/db');

/**
 * Capitalize first letter, lowercase rest (e.g., "PENDING" -> "Pending")
 */
const capitalize = (str) => {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

/**
 * @desc    Get dashboard overview stats
 * @route   GET /api/admin/dashboard/stats
 * @access  Admin
 */
const getDashboardStats = async (req, res, next) => {
  try {
    const { period = 'monthly' } = req.query;

    // Calculate date range based on period
    const now = new Date();
    let startDate = new Date();
    let previousStartDate = new Date();

    switch (period) {
      case 'daily':
        startDate.setDate(now.getDate() - 1);
        previousStartDate.setDate(now.getDate() - 2);
        break;
      case 'weekly':
        startDate.setDate(now.getDate() - 7);
        previousStartDate.setDate(now.getDate() - 14);
        break;
      case 'yearly':
        startDate.setFullYear(now.getFullYear() - 1);
        previousStartDate.setFullYear(now.getFullYear() - 2);
        break;
      case 'monthly':
      default:
        startDate.setMonth(now.getMonth() - 1);
        previousStartDate.setMonth(now.getMonth() - 2);
    }

    // Get current period stats
    const [
      totalRevenue,
      previousRevenue,
      totalUsers,
      previousUsers,
      totalCourses,
      previousCourses,
      totalEnrollments,
      previousEnrollments,
    ] = await Promise.all([
      // Revenue
      prisma.enrollment.aggregate({
        where: {
          enrolledAt: { gte: startDate },
          status: { not: 'REFUNDED' },
        },
        _sum: { price: true },
      }),
      prisma.enrollment.aggregate({
        where: {
          enrolledAt: { gte: previousStartDate, lt: startDate },
          status: { not: 'REFUNDED' },
        },
        _sum: { price: true },
      }),
      // Users
      prisma.user.count({
        where: { createdAt: { gte: startDate } },
      }),
      prisma.user.count({
        where: { createdAt: { gte: previousStartDate, lt: startDate } },
      }),
      // Courses
      prisma.course.count({
        where: { createdAt: { gte: startDate } },
      }),
      prisma.course.count({
        where: { createdAt: { gte: previousStartDate, lt: startDate } },
      }),
      // Enrollments
      prisma.enrollment.count({
        where: { enrolledAt: { gte: startDate } },
      }),
      prisma.enrollment.count({
        where: { enrolledAt: { gte: previousStartDate, lt: startDate } },
      }),
    ]);

    // Calculate percentage changes
    const calculateChange = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100 * 10) / 10;
    };

    const currentRevenue = totalRevenue._sum.price || 0;
    const prevRevenue = previousRevenue._sum.price || 0;

    // Get all-time totals
    const [allTimeUsers, allTimeCourses, allTimeEnrollments, allTimeRevenue] =
      await Promise.all([
        prisma.user.count(),
        prisma.course.count(),
        prisma.enrollment.count(),
        prisma.enrollment.aggregate({
          where: { status: { not: 'REFUNDED' } },
          _sum: { price: true },
        }),
      ]);

    res.status(200).json({
      success: true,
      data: {
        // Flat structure for frontend compatibility
        totalRevenue: allTimeRevenue._sum.price || 0,
        revenueChange: calculateChange(currentRevenue, prevRevenue),
        totalUsers: allTimeUsers,
        usersChange: calculateChange(totalUsers, previousUsers),
        totalCourses: allTimeCourses,
        coursesChange: calculateChange(totalCourses, previousCourses),
        totalEnrollments: allTimeEnrollments,
        enrollmentsChange: calculateChange(totalEnrollments, previousEnrollments),
        // Detailed structure for advanced usage
        revenue: {
          value: allTimeRevenue._sum.price || 0,
          periodValue: currentRevenue,
          change: calculateChange(currentRevenue, prevRevenue),
        },
        users: {
          value: allTimeUsers,
          periodValue: totalUsers,
          change: calculateChange(totalUsers, previousUsers),
        },
        courses: {
          value: allTimeCourses,
          periodValue: totalCourses,
          change: calculateChange(totalCourses, previousCourses),
        },
        enrollments: {
          value: allTimeEnrollments,
          periodValue: totalEnrollments,
          change: calculateChange(totalEnrollments, previousEnrollments),
        },
      },
      period,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get revenue chart data
 * @route   GET /api/admin/dashboard/revenue-chart
 * @access  Admin
 */
const getRevenueChart = async (req, res, next) => {
  try {
    const { months = 12 } = req.query;

    const chartData = [];
    const now = new Date();

    for (let i = parseInt(months) - 1; i >= 0; i--) {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);

      const revenue = await prisma.enrollment.aggregate({
        where: {
          enrolledAt: {
            gte: startOfMonth,
            lte: endOfMonth,
          },
          status: { not: 'REFUNDED' },
        },
        _sum: { price: true },
      });

      chartData.push({
        label: startOfMonth.toLocaleString('default', { month: 'short' }),
        value: revenue._sum.price || 0,
      });
    }

    res.status(200).json({
      success: true,
      data: chartData,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get user growth chart data
 * @route   GET /api/admin/dashboard/user-growth
 * @access  Admin
 */
const getUserGrowthChart = async (req, res, next) => {
  try {
    const { months = 12 } = req.query;

    const chartData = [];
    const now = new Date();

    for (let i = parseInt(months) - 1; i >= 0; i--) {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);

      const users = await prisma.user.count({
        where: {
          createdAt: {
            gte: startOfMonth,
            lte: endOfMonth,
          },
        },
      });

      chartData.push({
        label: startOfMonth.toLocaleString('default', { month: 'short' }),
        value: users,
      });
    }

    // Calculate trend
    const lastMonth = chartData[chartData.length - 1]?.value || 0;
    const prevMonth = chartData[chartData.length - 2]?.value || 0;
    const trend =
      prevMonth > 0
        ? Math.round(((lastMonth - prevMonth) / prevMonth) * 100 * 10) / 10
        : 0;

    res.status(200).json({
      success: true,
      data: {
        data: chartData,
        trend,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get recent enrollments
 * @route   GET /api/admin/dashboard/recent-enrollments
 * @access  Admin
 */
const getRecentEnrollments = async (req, res, next) => {
  try {
    const { limit = 5 } = req.query;

    const enrollments = await prisma.enrollment.findMany({
      take: parseInt(limit),
      orderBy: { enrolledAt: 'desc' },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, avatar: true },
        },
        course: {
          select: { id: true, title: true, thumbnail: true },
        },
      },
    });

    res.status(200).json({
      success: true,
      data: enrollments.map((enrollment) => ({
        id: enrollment.id,
        user: {
          id: enrollment.user.id,
          firstName: enrollment.user.firstName,
          lastName: enrollment.user.lastName,
          avatar: enrollment.user.avatar,
        },
        course: {
          id: enrollment.course.id,
          title: enrollment.course.title,
          price: enrollment.price,
          thumbnail: enrollment.course.thumbnail,
        },
        enrolledAt: enrollment.enrolledAt,
        status: capitalize(enrollment.status),
      })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get top performing courses
 * @route   GET /api/admin/dashboard/top-courses
 * @access  Admin
 */
const getTopCourses = async (req, res, next) => {
  try {
    const { limit = 5 } = req.query;

    // Get date for trend calculation (last 30 days vs previous 30 days)
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const courses = await prisma.course.findMany({
      take: parseInt(limit),
      where: { status: 'PUBLISHED' },
      include: {
        _count: {
          select: { enrollments: true },
        },
        enrollments: {
          where: { status: { not: 'REFUNDED' } },
          select: { price: true, enrolledAt: true },
        },
      },
      orderBy: {
        enrollments: {
          _count: 'desc',
        },
      },
    });

    const topCourses = courses.map((course) => {
      const revenue = course.enrollments.reduce(
        (acc, e) => acc + (e.price || 0),
        0
      );

      // Calculate trend based on recent vs previous enrollments
      const recentEnrollments = course.enrollments.filter(
        (e) => new Date(e.enrolledAt) >= thirtyDaysAgo
      ).length;
      const previousEnrollments = course.enrollments.filter(
        (e) =>
          new Date(e.enrolledAt) >= sixtyDaysAgo &&
          new Date(e.enrolledAt) < thirtyDaysAgo
      ).length;

      let trend = 0;
      if (previousEnrollments > 0) {
        trend =
          Math.round(
            ((recentEnrollments - previousEnrollments) / previousEnrollments) *
              100 *
              10
          ) / 10;
      } else if (recentEnrollments > 0) {
        trend = 100; // New course with enrollments
      }

      // Generate a consistent rating based on course data (placeholder until Review model exists)
      // Rating ranges from 4.0 to 5.0 based on enrollment count and revenue
      const baseRating = 4.0;
      const enrollmentBonus = Math.min(course._count.enrollments * 0.01, 0.5);
      const revenueBonus = Math.min(revenue * 0.0001, 0.4);
      const rating =
        Math.round((baseRating + enrollmentBonus + revenueBonus) * 10) / 10;

      return {
        id: course.id,
        title: course.title,
        thumbnail: course.thumbnail,
        enrollments: course._count.enrollments,
        students: course._count.enrollments, // Alias for frontend
        revenue,
        rating: Math.min(rating, 5.0),
        trend,
      };
    });

    // Sort by revenue
    topCourses.sort((a, b) => b.revenue - a.revenue);

    res.status(200).json({
      success: true,
      data: topCourses,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get analytics overview
 * @route   GET /api/admin/analytics/overview
 * @access  Admin
 */
const getAnalyticsOverview = async (req, res, next) => {
  try {
    const { period = '30d' } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate = new Date();

    switch (period) {
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '90d':
        startDate.setDate(now.getDate() - 90);
        break;
      case '12m':
        startDate.setMonth(now.getMonth() - 12);
        break;
      case 'all':
        startDate = new Date(0);
        break;
      case '30d':
      default:
        startDate.setDate(now.getDate() - 30);
    }

    const [
      totalRevenue,
      totalUsers,
      totalEnrollments,
      completedEnrollments,
      averageRating,
    ] = await Promise.all([
      prisma.enrollment.aggregate({
        where: {
          enrolledAt: { gte: startDate },
          status: { not: 'REFUNDED' },
        },
        _sum: { price: true },
        _count: true,
      }),
      prisma.user.count({
        where: { createdAt: { gte: startDate } },
      }),
      prisma.enrollment.count({
        where: { enrolledAt: { gte: startDate } },
      }),
      prisma.enrollment.count({
        where: {
          enrolledAt: { gte: startDate },
          status: 'COMPLETED',
        },
      }),
      // Placeholder for average rating (would need a Review model)
      Promise.resolve(4.8),
    ]);

    const revenue = totalRevenue._sum.price || 0;
    const enrollmentCount = totalRevenue._count || 0;
    const avgOrderValue =
      enrollmentCount > 0
        ? Math.round((revenue / enrollmentCount) * 100) / 100
        : 0;
    const completionRate =
      totalEnrollments > 0
        ? Math.round((completedEnrollments / totalEnrollments) * 100)
        : 0;

    res.status(200).json({
      success: true,
      data: {
        totalRevenue: { value: revenue, currency: 'USD' },
        totalUsers: { value: totalUsers },
        totalEnrollments: { value: totalEnrollments },
        avgOrderValue: { value: avgOrderValue },
        completionRate: completionRate,
        averageRating: averageRating,
        avgSessionDuration: 2.5, // Placeholder
        satisfactionRate: 92, // Placeholder
      },
      period,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get enrollments by course (for chart)
 * @route   GET /api/admin/analytics/enrollments-by-course
 * @access  Admin
 */
const getEnrollmentsByCourse = async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;

    const courses = await prisma.course.findMany({
      take: parseInt(limit),
      where: { status: 'PUBLISHED' },
      include: {
        _count: {
          select: { enrollments: true },
        },
      },
      orderBy: {
        enrollments: {
          _count: 'desc',
        },
      },
    });

    res.status(200).json({
      success: true,
      data: courses.map((course) => ({
        label: course.title,
        value: course._count.enrollments,
      })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get revenue by category (for pie chart)
 * @route   GET /api/admin/analytics/revenue-by-category
 * @access  Admin
 */
const getRevenueByCategory = async (req, res, next) => {
  try {
    const categories = await prisma.category.findMany({
      include: {
        courses: {
          include: {
            enrollments: {
              where: { status: { not: 'REFUNDED' } },
              select: { price: true },
            },
          },
        },
      },
    });

    const categoryRevenue = categories.map((category) => {
      let revenue = 0;
      category.courses.forEach((course) => {
        course.enrollments.forEach((enrollment) => {
          revenue += enrollment.price || 0;
        });
      });
      return {
        label: category.name,
        value: revenue,
        color: category.iconBgColor,
      };
    });

    // Sort by revenue descending
    categoryRevenue.sort((a, b) => b.value - a.value);

    res.status(200).json({
      success: true,
      data: categoryRevenue,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get monthly enrollment chart data
 * @route   GET /api/admin/analytics/enrollment-chart
 * @access  Admin
 */
const getEnrollmentChart = async (req, res, next) => {
  try {
    const { months = 12 } = req.query;

    const chartData = [];
    const now = new Date();

    for (let i = parseInt(months) - 1; i >= 0; i--) {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);

      const count = await prisma.enrollment.count({
        where: {
          enrolledAt: {
            gte: startOfMonth,
            lte: endOfMonth,
          },
        },
      });

      chartData.push({
        label: startOfMonth.toLocaleString('default', { month: 'short' }),
        value: count,
      });
    }

    res.status(200).json({
      success: true,
      data: chartData,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboardStats,
  getRevenueChart,
  getUserGrowthChart,
  getRecentEnrollments,
  getTopCourses,
  getAnalyticsOverview,
  getEnrollmentsByCourse,
  getRevenueByCategory,
  getEnrollmentChart,
};
