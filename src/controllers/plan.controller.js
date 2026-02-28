const prisma = require('../config/db');

/**
 * Generate slug from name
 */
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

/**
 * @desc    Get all active plans (for pricing page)
 * @route   GET /api/plans
 * @access  Public
 */
const getAllPlans = async (req, res, next) => {
  try {
    const plans = await prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
    });

    res.status(200).json({
      success: true,
      data: plans,
      count: plans.length,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all plans (admin - includes inactive and subscription counts)
 * @route   GET /api/plans/admin
 * @access  Admin
 */
const getAllPlansAdmin = async (req, res, next) => {
  try {
    const plans = await prisma.plan.findMany({
      orderBy: { order: 'asc' },
      include: {
        _count: {
          select: { subscriptions: true },
        },
      },
    });

    const transformedPlans = plans.map((plan) => ({
      ...plan,
      subscriptionCount: plan._count.subscriptions,
      _count: undefined,
    }));

    res.status(200).json({
      success: true,
      data: transformedPlans,
      count: transformedPlans.length,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get single plan by ID (admin)
 * @route   GET /api/plans/admin/:id
 * @access  Admin
 */
const getPlanById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const plan = await prisma.plan.findUnique({
      where: { id },
      include: {
        _count: {
          select: { subscriptions: true },
        },
      },
    });

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found',
      });
    }

    res.status(200).json({
      success: true,
      data: {
        ...plan,
        subscriptionCount: plan._count.subscriptions,
        _count: undefined,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create new plan
 * @route   POST /api/plans
 * @access  Admin
 */
const createPlan = async (req, res, next) => {
  try {
    const {
      name,
      description,
      tagline,
      closeLine,
      monthlyPrice,
      yearlyPrice,
      maxUsers,
      additionalUserPrice,
      features,
      ctaText,
      ctaType,
      isPopular,
      isActive,
      stripeMonthlyPriceId,
      stripeYearlyPriceId,
      stripeProductId,
    } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Plan name is required',
      });
    }

    // Generate slug
    const slug = generateSlug(name);

    // Check if slug exists
    const existingPlan = await prisma.plan.findUnique({
      where: { slug },
    });

    if (existingPlan) {
      return res.status(409).json({
        success: false,
        message: 'A plan with this name already exists',
      });
    }

    // Get max order
    const maxOrderPlan = await prisma.plan.findFirst({
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    const order = maxOrderPlan ? maxOrderPlan.order + 1 : 0;

    const plan = await prisma.plan.create({
      data: {
        name: name.trim(),
        slug,
        description: description?.trim() || null,
        tagline: tagline?.trim() || null,
        closeLine: closeLine?.trim() || null,
        monthlyPrice: monthlyPrice != null ? parseFloat(monthlyPrice) : null,
        yearlyPrice: yearlyPrice != null ? parseFloat(yearlyPrice) : null,
        maxUsers: maxUsers ? parseInt(maxUsers) : 1,
        additionalUserPrice: additionalUserPrice != null ? parseFloat(additionalUserPrice) : null,
        features: features || [],
        ctaText: ctaText?.trim() || 'Get Started',
        ctaType: ctaType || 'CHECKOUT',
        isPopular: isPopular || false,
        isActive: isActive !== undefined ? isActive : true,
        stripeMonthlyPriceId: stripeMonthlyPriceId?.trim() || null,
        stripeYearlyPriceId: stripeYearlyPriceId?.trim() || null,
        stripeProductId: stripeProductId?.trim() || null,
        order,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Plan created successfully',
      data: plan,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update plan
 * @route   PUT /api/plans/:id
 * @access  Admin
 */
const updatePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      tagline,
      closeLine,
      monthlyPrice,
      yearlyPrice,
      maxUsers,
      additionalUserPrice,
      features,
      ctaText,
      ctaType,
      isPopular,
      isActive,
      stripeMonthlyPriceId,
      stripeYearlyPriceId,
      stripeProductId,
    } = req.body;

    // Check if plan exists
    const existingPlan = await prisma.plan.findUnique({
      where: { id },
    });

    if (!existingPlan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found',
      });
    }

    const updateData = {};

    if (name && name.trim() !== '') {
      updateData.name = name.trim();
      updateData.slug = generateSlug(name);

      // Check if new slug conflicts with another plan
      const slugConflict = await prisma.plan.findFirst({
        where: {
          slug: updateData.slug,
          id: { not: id },
        },
      });

      if (slugConflict) {
        return res.status(409).json({
          success: false,
          message: 'A plan with this name already exists',
        });
      }
    }

    if (description !== undefined) updateData.description = description?.trim() || null;
    if (tagline !== undefined) updateData.tagline = tagline?.trim() || null;
    if (closeLine !== undefined) updateData.closeLine = closeLine?.trim() || null;
    if (monthlyPrice !== undefined) updateData.monthlyPrice = monthlyPrice != null ? parseFloat(monthlyPrice) : null;
    if (yearlyPrice !== undefined) updateData.yearlyPrice = yearlyPrice != null ? parseFloat(yearlyPrice) : null;
    if (maxUsers !== undefined) updateData.maxUsers = parseInt(maxUsers);
    if (additionalUserPrice !== undefined) updateData.additionalUserPrice = additionalUserPrice != null ? parseFloat(additionalUserPrice) : null;
    if (features !== undefined) updateData.features = features;
    if (ctaText !== undefined) updateData.ctaText = ctaText?.trim() || 'Get Started';
    if (ctaType !== undefined) updateData.ctaType = ctaType;
    if (isPopular !== undefined) updateData.isPopular = isPopular;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (stripeMonthlyPriceId !== undefined) updateData.stripeMonthlyPriceId = stripeMonthlyPriceId?.trim() || null;
    if (stripeYearlyPriceId !== undefined) updateData.stripeYearlyPriceId = stripeYearlyPriceId?.trim() || null;
    if (stripeProductId !== undefined) updateData.stripeProductId = stripeProductId?.trim() || null;

    const updatedPlan = await prisma.plan.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({
      success: true,
      message: 'Plan updated successfully',
      data: updatedPlan,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete plan
 * @route   DELETE /api/plans/:id
 * @access  Admin
 */
const deletePlan = async (req, res, next) => {
  try {
    const { id } = req.params;

    const plan = await prisma.plan.findUnique({
      where: { id },
      include: {
        _count: {
          select: { subscriptions: true },
        },
      },
    });

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found',
      });
    }

    // Check if plan has active subscriptions
    const activeSubscriptions = await prisma.subscription.count({
      where: {
        planId: id,
        status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
      },
    });

    if (activeSubscriptions > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete plan. It has ${activeSubscriptions} active subscription(s).`,
      });
    }

    await prisma.plan.delete({
      where: { id },
    });

    res.status(200).json({
      success: true,
      message: 'Plan deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Reorder plans
 * @route   PATCH /api/plans/reorder
 * @access  Admin
 */
const reorderPlans = async (req, res, next) => {
  try {
    const { plans } = req.body;

    if (!Array.isArray(plans) || plans.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Plans array is required',
      });
    }

    await prisma.$transaction(
      plans.map((plan, index) =>
        prisma.plan.update({
          where: { id: plan.id },
          data: { order: index },
        })
      )
    );

    res.status(200).json({
      success: true,
      message: 'Plans reordered successfully',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllPlans,
  getAllPlansAdmin,
  getPlanById,
  createPlan,
  updatePlan,
  deletePlan,
  reorderPlans,
};
