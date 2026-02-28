const prisma = require('../config/db');
const stripe = require('../config/stripe');

/**
 * Check if a user has an active subscription (direct or via team membership)
 * Shared utility used by both subscription and enrollment controllers
 */
const userHasActiveSubscription = async (userId) => {
  // Check direct subscription
  const directSub = await prisma.subscription.findFirst({
    where: {
      userId,
      status: { in: ['ACTIVE', 'TRIALING'] },
      currentPeriodEnd: { gt: new Date() },
    },
  });
  if (directSub) return true;

  // Check team membership
  const memberSub = await prisma.subscriptionMember.findFirst({
    where: {
      userId,
      subscription: {
        status: { in: ['ACTIVE', 'TRIALING'] },
        currentPeriodEnd: { gt: new Date() },
      },
    },
  });
  return !!memberSub;
};

/**
 * @desc    Create Stripe Checkout Session for subscription
 * @route   POST /api/subscriptions/create-checkout-session
 * @access  User
 */
const createSubscriptionCheckout = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { planId, billingCycle, organizationName } = req.body;

    if (!planId) {
      return res.status(400).json({
        success: false,
        message: 'planId is required',
      });
    }

    // Check if plan exists and is active
    const plan = await prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan || !plan.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found or is not available',
      });
    }

    // Enterprise/Contact Sales plans cannot use checkout
    if (plan.ctaType === 'CONTACT_SALES') {
      return res.status(400).json({
        success: false,
        message: 'This plan requires contacting sales. Please use the contact form.',
      });
    }

    // Check if user already has an active subscription
    const existingSubscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ['ACTIVE', 'TRIALING'] },
        currentPeriodEnd: { gt: new Date() },
      },
    });

    if (existingSubscription) {
      return res.status(409).json({
        success: false,
        message: 'You already have an active subscription. Please cancel your current plan before subscribing to a new one.',
      });
    }

    // Verify Stripe is configured
    if (!stripe) {
      return res.status(503).json({
        success: false,
        message: 'Payment service is not configured. Please contact support.',
      });
    }

    // Determine billing cycle and price ID
    const cycle = billingCycle === 'MONTHLY' ? 'MONTHLY' : 'YEARLY';
    const stripePriceId = cycle === 'MONTHLY' ? plan.stripeMonthlyPriceId : plan.stripeYearlyPriceId;

    if (!stripePriceId) {
      return res.status(400).json({
        success: false,
        message: `This plan does not support ${cycle.toLowerCase()} billing.`,
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

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    // Find or create Stripe customer to avoid duplicate customer issues
    let stripeCustomerId;
    const existingCustomers = await stripe.customers.list({
      email: user.email,
      limit: 1,
    });

    if (existingCustomers.data.length > 0) {
      stripeCustomerId = existingCustomers.data[0].id;
    } else {
      const newCustomer = await stripe.customers.create({
        email: user.email,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        metadata: { userId },
      });
      stripeCustomerId = newCustomer.id;
    }

    // Create Stripe Checkout Session for subscription
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: stripePriceId,
          quantity: 1,
        },
      ],
      metadata: {
        userId,
        planId,
        billingCycle: cycle,
        organizationName: organizationName || '',
        planName: plan.name,
      },
      subscription_data: {
        metadata: {
          userId,
          planId,
          billingCycle: cycle,
          organizationName: organizationName || '',
        },
      },
      success_url: `${frontendUrl}/dashboard/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/pricing?canceled=true`,
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
 * @desc    Get current user's active subscription
 * @route   GET /api/subscriptions/my-subscription
 * @access  User
 */
const getMySubscription = async (req, res, next) => {
  try {
    const userId = req.userId;

    // Check direct subscription
    let subscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
      },
      include: {
        plan: {
          select: {
            id: true,
            name: true,
            slug: true,
            monthlyPrice: true,
            yearlyPrice: true,
            maxUsers: true,
          },
        },
        _count: {
          select: { members: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // If no direct subscription, check team membership
    if (!subscription) {
      const membership = await prisma.subscriptionMember.findFirst({
        where: {
          userId,
          subscription: {
            status: { in: ['ACTIVE', 'TRIALING'] },
            currentPeriodEnd: { gt: new Date() },
          },
        },
        include: {
          subscription: {
            include: {
              plan: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                },
              },
            },
          },
        },
      });

      if (membership) {
        return res.status(200).json({
          success: true,
          data: {
            id: membership.subscription.id,
            status: membership.subscription.status,
            billingCycle: membership.subscription.billingCycle,
            currentPeriodEnd: membership.subscription.currentPeriodEnd,
            plan: membership.subscription.plan,
            isTeamMember: true,
            memberRole: membership.role,
          },
        });
      }

      return res.status(200).json({
        success: true,
        data: null,
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: subscription.id,
        status: subscription.status,
        billingCycle: subscription.billingCycle,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        maxUsers: subscription.maxUsers,
        organizationName: subscription.organizationName,
        plan: subscription.plan,
        memberCount: subscription._count.members,
        isTeamMember: false,
        createdAt: subscription.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Cancel subscription (at period end)
 * @route   POST /api/subscriptions/cancel
 * @access  User
 */
const cancelSubscription = async (req, res, next) => {
  try {
    const userId = req.userId;

    const subscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ['ACTIVE', 'TRIALING'] },
      },
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'No active subscription found',
      });
    }

    // Cancel at period end on Stripe
    if (stripe && subscription.stripeSubscriptionId) {
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
    }

    // Update local record
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: true },
    });

    res.status(200).json({
      success: true,
      message: 'Subscription will be canceled at the end of the current billing period.',
      data: {
        cancelAtPeriodEnd: true,
        currentPeriodEnd: subscription.currentPeriodEnd,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Check if user has access to all courses
 * @route   GET /api/subscriptions/check-access
 * @access  User
 */
const checkAccess = async (req, res, next) => {
  try {
    const userId = req.userId;

    // Check accessAll flag
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { accessAll: true },
    });

    if (user?.accessAll) {
      return res.status(200).json({
        success: true,
        data: { hasAccess: true, accessAll: true },
      });
    }

    // Check direct subscription
    const directSub = await prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ['ACTIVE', 'TRIALING'] },
        currentPeriodEnd: { gt: new Date() },
      },
      include: {
        plan: { select: { id: true, name: true, slug: true } },
      },
    });

    if (directSub) {
      return res.status(200).json({
        success: true,
        data: {
          hasAccess: true,
          accessAll: false,
          subscription: {
            id: directSub.id,
            planName: directSub.plan.name,
            expiresAt: directSub.currentPeriodEnd,
          },
        },
      });
    }

    // Check team membership
    const memberSub = await prisma.subscriptionMember.findFirst({
      where: {
        userId,
        subscription: {
          status: { in: ['ACTIVE', 'TRIALING'] },
          currentPeriodEnd: { gt: new Date() },
        },
      },
      include: {
        subscription: {
          include: {
            plan: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });

    if (memberSub) {
      return res.status(200).json({
        success: true,
        data: {
          hasAccess: true,
          accessAll: false,
          subscription: {
            id: memberSub.subscription.id,
            planName: memberSub.subscription.plan.name,
            expiresAt: memberSub.subscription.currentPeriodEnd,
            isTeamMember: true,
          },
        },
      });
    }

    res.status(200).json({
      success: true,
      data: { hasAccess: false, accessAll: false },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get subscription by Stripe session ID (for success page polling)
 * @route   GET /api/subscriptions/session/:sessionId
 * @access  User
 */
const getSubscriptionBySessionId = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { sessionId } = req.params;

    // Retrieve the session from Stripe to get the subscription ID
    if (!stripe) {
      return res.status(503).json({
        success: false,
        message: 'Payment service not configured',
      });
    }

    let stripeSession;
    try {
      stripeSession = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (stripeErr) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }

    if (!stripeSession.subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not yet created. Payment may still be processing.',
      });
    }

    const subscription = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: stripeSession.subscription },
      include: {
        plan: {
          select: { id: true, name: true, slug: true },
        },
      },
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found. Payment may still be processing.',
      });
    }

    // Verify the subscription belongs to the requesting user
    if (subscription.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: subscription.id,
        status: subscription.status,
        billingCycle: subscription.billingCycle,
        plan: subscription.plan,
        currentPeriodEnd: subscription.currentPeriodEnd,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get team members of a subscription
 * @route   GET /api/subscriptions/:id/members
 * @access  Subscription Owner
 */
const getTeamMembers = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    // Verify ownership
    const subscription = await prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription || subscription.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only the subscription owner can manage team members.',
      });
    }

    const members = await prisma.subscriptionMember.findMany({
      where: { subscriptionId: id },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true, avatar: true },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });

    res.status(200).json({
      success: true,
      data: members,
      count: members.length,
      maxUsers: subscription.maxUsers,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Add team member to subscription
 * @route   POST /api/subscriptions/:id/members
 * @access  Subscription Owner
 */
const addTeamMember = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    // Verify ownership
    const subscription = await prisma.subscription.findUnique({
      where: { id },
      include: {
        _count: { select: { members: true } },
      },
    });

    if (!subscription || subscription.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only the subscription owner can manage team members.',
      });
    }

    // Check max users limit (include the owner in the count)
    const totalUsers = subscription._count.members + 1; // +1 for owner
    if (totalUsers >= subscription.maxUsers) {
      return res.status(400).json({
        success: false,
        message: `Team member limit reached (${subscription.maxUsers} users). Please upgrade your plan or contact sales for additional seats.`,
      });
    }

    // Find user by email
    const memberUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!memberUser) {
      return res.status(404).json({
        success: false,
        message: 'No user found with this email. They must create an account first.',
      });
    }

    // Can't add the owner as a member
    if (memberUser.id === userId) {
      return res.status(400).json({
        success: false,
        message: 'You are already the subscription owner.',
      });
    }

    // Check if already a member
    const existingMember = await prisma.subscriptionMember.findUnique({
      where: {
        userId_subscriptionId: { userId: memberUser.id, subscriptionId: id },
      },
    });

    if (existingMember) {
      return res.status(409).json({
        success: false,
        message: 'This user is already a member of your subscription.',
      });
    }

    const member = await prisma.subscriptionMember.create({
      data: {
        userId: memberUser.id,
        subscriptionId: id,
        role: 'member',
      },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true, avatar: true },
        },
      },
    });

    res.status(201).json({
      success: true,
      message: 'Team member added successfully',
      data: member,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Remove team member from subscription
 * @route   DELETE /api/subscriptions/:id/members/:memberId
 * @access  Subscription Owner
 */
const removeTeamMember = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { id, memberId } = req.params;

    // Verify ownership
    const subscription = await prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription || subscription.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only the subscription owner can manage team members.',
      });
    }

    // Check member exists
    const member = await prisma.subscriptionMember.findUnique({
      where: { id: memberId },
    });

    if (!member || member.subscriptionId !== id) {
      return res.status(404).json({
        success: false,
        message: 'Team member not found',
      });
    }

    await prisma.subscriptionMember.delete({
      where: { id: memberId },
    });

    res.status(200).json({
      success: true,
      message: 'Team member removed successfully',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  userHasActiveSubscription,
  createSubscriptionCheckout,
  getMySubscription,
  cancelSubscription,
  checkAccess,
  getSubscriptionBySessionId,
  getTeamMembers,
  addTeamMember,
  removeTeamMember,
};
