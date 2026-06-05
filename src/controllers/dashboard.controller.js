const prisma = require('../config/db');

/**
 * Capitalize first letter, lowercase rest (e.g., "PENDING" -> "Pending")
 */
const capitalize = (str) => {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

/**
 * Get subscription-based revenue: sum of (plan price at signup) for each subscription in range.
 * Price = plan.yearlyPrice or plan.monthlyPrice based on Subscription.billingCycle.
 */
const getSubscriptionRevenueForRange = async (startDate, endDate = null) => {
  const where = { createdAt: { gte: startDate } };
  if (endDate) where.createdAt.lte = endDate;

  const subscriptions = await prisma.subscription.findMany({
    where,
    include: { plan: { select: { monthlyPrice: true, yearlyPrice: true } } },
  });

  let revenue = 0;
  for (const sub of subscriptions) {
    const plan = sub.plan;
    const price =
      sub.billingCycle === 'YEARLY'
        ? (plan?.yearlyPrice ?? 0)
        : (plan?.monthlyPrice ?? 0);
    revenue += price;
  }
  return { revenue, count: subscriptions.length };
};

/**
 * Get all-time subscription revenue (each subscription counted once at creation).
 */
const getAllTimeSubscriptionRevenue = async () => {
  const subscriptions = await prisma.subscription.findMany({
    include: { plan: { select: { monthlyPrice: true, yearlyPrice: true } } },
  });
  let revenue = 0;
  for (const sub of subscriptions) {
    const plan = sub.plan;
    const price =
      sub.billingCycle === 'YEARLY'
        ? (plan?.yearlyPrice ?? 0)
        : (plan?.monthlyPrice ?? 0);
    revenue += price;
  }
  return revenue;
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

    // Get current period stats (revenue from subscriptions, not enrollments)
    const nowForEnd = new Date();
    const [
      currentPeriodRevenue,
      previousPeriodRevenue,
      totalUsers,
      previousUsers,
      totalCourses,
      previousCourses,
      totalEnrollments,
      previousEnrollments,
    ] = await Promise.all([
      getSubscriptionRevenueForRange(startDate, nowForEnd),
      getSubscriptionRevenueForRange(previousStartDate, startDate),
      // Users (admins are excluded from all dashboard user metrics)
      prisma.user.count({
        where: { role: { not: 'ADMIN' }, createdAt: { gte: startDate } },
      }),
      prisma.user.count({
        where: { role: { not: 'ADMIN' }, createdAt: { gte: previousStartDate, lt: startDate } },
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

    const currentRevenue = currentPeriodRevenue.revenue;
    const prevRevenue = previousPeriodRevenue.revenue;

    // Get all-time totals
    const [allTimeUsers, allTimeCourses, allTimeEnrollments, allTimeRevenue] =
      await Promise.all([
        prisma.user.count({ where: { role: { not: 'ADMIN' } } }),
        prisma.course.count(),
        prisma.enrollment.count(),
        getAllTimeSubscriptionRevenue(),
      ]);

    res.status(200).json({
      success: true,
      data: {
        // Flat structure for frontend compatibility
        totalRevenue: allTimeRevenue,
        revenueChange: calculateChange(currentRevenue, prevRevenue),
        totalUsers: allTimeUsers,
        usersChange: calculateChange(totalUsers, previousUsers),
        totalCourses: allTimeCourses,
        coursesChange: calculateChange(totalCourses, previousCourses),
        totalEnrollments: allTimeEnrollments,
        enrollmentsChange: calculateChange(totalEnrollments, previousEnrollments),
        // Detailed structure for advanced usage
        revenue: {
          value: allTimeRevenue,
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
 * @desc    Get revenue chart data (subscription-based)
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

      const { revenue } = await getSubscriptionRevenueForRange(
        startOfMonth,
        endOfMonth
      );

      chartData.push({
        label: startOfMonth.toLocaleString('default', { month: 'short' }),
        value: revenue,
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
          role: { not: 'ADMIN' },
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
 * @desc    Get recent enrollments (course activity; price deprecated, plan shown when available)
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

    const userIds = [...new Set(enrollments.map((e) => e.userId))];
    const subscriptions = await prisma.subscription.findMany({
      where: {
        userId: { in: userIds },
        status: { in: ['ACTIVE', 'TRIALING'] },
      },
      include: { plan: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const planByUser = new Map();
    for (const sub of subscriptions) {
      if (!planByUser.has(sub.userId)) planByUser.set(sub.userId, sub.plan.name);
    }

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
          thumbnail: enrollment.course.thumbnail,
        },
        planName: planByUser.get(enrollment.userId) || null,
        enrolledAt: enrollment.enrolledAt,
        status: capitalize(enrollment.status),
      })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get top performing courses by engagement (enrollment count; revenue not per-course)
 * @route   GET /api/admin/dashboard/top-courses
 * @access  Admin
 */
const getTopCourses = async (req, res, next) => {
  try {
    const { limit = 5 } = req.query;

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const courses = await prisma.course.findMany({
      take: parseInt(limit),
      where: { status: 'PUBLISHED' },
      include: {
        _count: { select: { enrollments: true } },
        enrollments: {
          where: { status: { not: 'REFUNDED' } },
          select: { enrolledAt: true },
        },
      },
      orderBy: { enrollments: { _count: 'desc' } },
    });

    const topCourses = courses.map((course) => {
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
        trend = 100;
      }

      const baseRating = 4.0;
      const enrollmentBonus = Math.min(course._count.enrollments * 0.01, 0.5);
      const rating =
        Math.round((baseRating + enrollmentBonus) * 10) / 10;

      return {
        id: course.id,
        title: course.title,
        thumbnail: course.thumbnail,
        enrollments: course._count.enrollments,
        students: course._count.enrollments,
        revenue: 0,
        rating: Math.min(rating, 5.0),
        trend,
      };
    });

    res.status(200).json({
      success: true,
      data: topCourses,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get analytics overview (revenue from subscriptions; avg plan value = ARPU)
 * @route   GET /api/admin/analytics/overview
 * @access  Admin
 */
const getAnalyticsOverview = async (req, res, next) => {
  try {
    const { period = '30d' } = req.query;

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
      subscriptionRevenueResult,
      totalUsers,
      totalEnrollments,
      completedEnrollments,
      averageRating,
    ] = await Promise.all([
      getSubscriptionRevenueForRange(startDate, now),
      prisma.user.count({
        where: { role: { not: 'ADMIN' }, createdAt: { gte: startDate } },
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
      Promise.resolve(4.8),
    ]);

    const revenue = subscriptionRevenueResult.revenue;
    const newSubscriptionsCount = subscriptionRevenueResult.count;
    const avgOrderValue =
      newSubscriptionsCount > 0
        ? Math.round((revenue / newSubscriptionsCount) * 100) / 100
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
        avgSessionDuration: 2.5,
        satisfactionRate: 92,
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

/** Fixed palette for revenue-by-plan and subscriptions-by-plan charts */
const PLAN_CHART_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16',
];

/**
 * Normalize plan name: strip " (old)" suffix so legacy and current plans merge for display.
 * Result is used as base for "PlanName Monthly" / "PlanName Yearly" labels.
 */
const normalizePlanName = (name) => {
  if (!name || typeof name !== 'string') return 'Unknown';
  return name.replace(/\s*\(old\)\s*$/i, '').trim() || 'Unknown';
};

/**
 * Build chart label: "Individual Plan Monthly" or "Individual Plan Yearly".
 */
const planCycleLabel = (normalizedName, billingCycle) => {
  const cycle = billingCycle === 'YEARLY' ? 'Yearly' : 'Monthly';
  return `${normalizedName} ${cycle}`;
};

/**
 * @desc    Get revenue by plan (for pie chart) — grouped by plan + billing cycle (Monthly/Yearly)
 * @route   GET /api/admin/dashboard/analytics/revenue-by-plan
 * @access  Admin
 */
const getRevenueByPlan = async (req, res, next) => {
  try {
    const { period = 'all' } = req.query;
    const now = new Date();
    let startDate = new Date(0);
    let endDate = now;

    if (period !== 'all') {
      switch (period) {
        case '7d':
          startDate.setDate(now.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(now.getDate() - 30);
          break;
        case '90d':
          startDate.setDate(now.getDate() - 90);
          break;
        case '12m':
          startDate.setMonth(now.getMonth() - 12);
          break;
        default:
          break;
      }
    }

    const subscriptions = await prisma.subscription.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
      },
      include: { plan: { select: { name: true, monthlyPrice: true, yearlyPrice: true } } },
    });

    // Group by normalized plan name + billing cycle so we get "Individual Plan Monthly", "Individual Plan Yearly", etc.
    const byPlanCycle = new Map();
    for (const sub of subscriptions) {
      const plan = sub.plan;
      const normalizedName = normalizePlanName(plan?.name);
      const cycle = sub.billingCycle || 'YEARLY';
      const price =
        cycle === 'YEARLY'
          ? (plan?.yearlyPrice ?? 0)
          : (plan?.monthlyPrice ?? 0);
      const key = `${normalizedName}|${cycle}`;
      if (!byPlanCycle.has(key)) {
        byPlanCycle.set(key, { label: planCycleLabel(normalizedName, cycle), value: 0 });
      }
      byPlanCycle.get(key).value += price;
    }

    const planRevenue = [...byPlanCycle.entries()].map(([_, v], index) => ({
      label: v.label,
      value: v.value,
      color: PLAN_CHART_COLORS[index % PLAN_CHART_COLORS.length],
    }));
    planRevenue.sort((a, b) => b.value - a.value);

    res.status(200).json({
      success: true,
      data: planRevenue,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get subscription counts by plan and billing cycle (for "Enrollments by Plans" chart)
 * @route   GET /api/admin/dashboard/analytics/subscriptions-by-plan
 * @access  Admin
 */
const getSubscriptionsByPlan = async (req, res, next) => {
  try {
    const { period = 'all', limit = 20 } = req.query;
    const now = new Date();
    let startDate = new Date(0);
    let endDate = now;

    if (period !== 'all') {
      switch (period) {
        case '7d':
          startDate.setDate(now.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(now.getDate() - 30);
          break;
        case '90d':
          startDate.setDate(now.getDate() - 90);
          break;
        case '12m':
          startDate.setMonth(now.getMonth() - 12);
          break;
        default:
          break;
      }
    }

    const subscriptions = await prisma.subscription.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
      },
      include: { plan: { select: { name: true } } },
    });

    const byPlanCycle = new Map();
    for (const sub of subscriptions) {
      const normalizedName = normalizePlanName(sub.plan?.name);
      const cycle = sub.billingCycle || 'YEARLY';
      const key = `${normalizedName}|${cycle}`;
      byPlanCycle.set(key, (byPlanCycle.get(key) || 0) + 1);
    }

    let planCounts = [...byPlanCycle.entries()].map(([key, value]) => {
      const lastPipe = key.lastIndexOf('|');
      const normalizedName = lastPipe >= 0 ? key.slice(0, lastPipe) : key;
      const cycle = lastPipe >= 0 ? key.slice(lastPipe + 1) : 'YEARLY';
      return {
        label: planCycleLabel(normalizedName, cycle),
        value,
      };
    });
    planCounts.sort((a, b) => b.value - a.value);
    planCounts = planCounts.slice(0, parseInt(limit, 10));

    res.status(200).json({
      success: true,
      data: planCounts,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get recent subscriptions (for dashboard widget — users who bought which plan)
 * @route   GET /api/admin/dashboard/recent-subscriptions
 * @access  Admin
 */
const getRecentSubscriptions = async (req, res, next) => {
  try {
    const { limit = 5 } = req.query;

    const subscriptions = await prisma.subscription.findMany({
      take: parseInt(limit, 10),
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        plan: {
          select: { name: true, monthlyPrice: true, yearlyPrice: true },
        },
      },
    });

    const data = subscriptions.map((sub) => {
      const plan = sub.plan;
      const amount =
        sub.billingCycle === 'YEARLY'
          ? (plan?.yearlyPrice ?? 0)
          : (plan?.monthlyPrice ?? 0);
      const billingLabel = sub.billingCycle === 'YEARLY' ? 'Yearly' : 'Monthly';
      return {
        id: sub.id,
        user: {
          id: sub.user.id,
          firstName: sub.user.firstName,
          lastName: sub.user.lastName,
          email: sub.user.email,
        },
        planName: plan?.name ?? 'Unknown',
        billingCycle: billingLabel,
        amount,
        subscribedAt: sub.createdAt,
        status: capitalize(sub.status),
      };
    });

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get subscriptions list with pagination (for View all / admin subscriptions page)
 * @route   GET /api/admin/dashboard/subscriptions
 * @access  Admin
 */
const getSubscriptionsList = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);

    const [subscriptions, total] = await Promise.all([
      prisma.subscription.findMany({
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          plan: {
            select: { name: true, monthlyPrice: true, yearlyPrice: true },
          },
        },
      }),
      prisma.subscription.count(),
    ]);

    const data = subscriptions.map((sub) => {
      const plan = sub.plan;
      const amount =
        sub.billingCycle === 'YEARLY'
          ? (plan?.yearlyPrice ?? 0)
          : (plan?.monthlyPrice ?? 0);
      const billingLabel = sub.billingCycle === 'YEARLY' ? 'Yearly' : 'Monthly';
      return {
        id: sub.id,
        user: {
          id: sub.user.id,
          firstName: sub.user.firstName,
          lastName: sub.user.lastName,
          email: sub.user.email,
        },
        planName: plan?.name ?? 'Unknown',
        billingCycle: billingLabel,
        amount,
        subscribedAt: sub.createdAt,
        status: capitalize(sub.status),
      };
    });

    const totalPages = Math.ceil(total / take);

    res.status(200).json({
      success: true,
      data,
      pagination: {
        page: parseInt(page, 10),
        limit: take,
        total,
        totalPages,
        hasNext: skip + take < total,
        hasPrev: parseInt(page, 10) > 1,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get revenue by category (legacy; kept for backward compatibility, returns plan-based if preferred)
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
  getRecentSubscriptions,
  getSubscriptionsList,
  getTopCourses,
  getAnalyticsOverview,
  getEnrollmentsByCourse,
  getRevenueByCategory,
  getRevenueByPlan,
  getSubscriptionsByPlan,
  getEnrollmentChart,
};
