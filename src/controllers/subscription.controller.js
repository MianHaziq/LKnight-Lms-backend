const crypto = require('crypto');
const prisma = require('../config/db');
const stripe = require('../config/stripe');
const { sendTeamInvitationEmail } = require('../services/email.service');

/**
 * Check if a user has an active subscription (direct or via team membership)
 * Shared utility used by both subscription and enrollment controllers
 */
const userHasActiveSubscription = async (userId) => {
  // Admins always have permanent, full access — no subscription required.
  // This is the single shared access gate used for courses, live streams and the vault.
  const adminUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (adminUser?.role === 'ADMIN') return true;

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

    // Cancel any incomplete subscriptions to avoid checkout_amount_mismatch
    const incompleteSubs = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: 'incomplete',
    });
    for (const sub of incompleteSubs.data) {
      await stripe.subscriptions.cancel(sub.id);
    }

    // Create Stripe Checkout Session for subscription
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      automatic_tax: { enabled: false },
      adaptive_pricing: { enabled: false },
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

    // Check role and accessAll flag
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, accessAll: true },
    });

    // Admins always have permanent, full access — no subscription required
    if (user?.role === 'ADMIN') {
      return res.status(200).json({
        success: true,
        data: { hasAccess: true, accessAll: true, isAdmin: true },
      });
    }

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
 * @desc    Add team member / send invitation by email. Always sends email; if user exists, grants access; if not, sends invite link.
 * @route   POST /api/subscriptions/:id/members
 * @access  Subscription Owner
 */
const addTeamMember = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const email = (req.body.email || '').trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    // Verify ownership and load subscription with counts
    const subscription = await prisma.subscription.findUnique({
      where: { id },
      include: {
        _count: { select: { members: true } },
        plan: { select: { name: true } },
      },
    });

    if (!subscription || subscription.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only the subscription owner can manage team members.',
      });
    }

    // Inviter name for email
    const inviter = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    const inviterName = [inviter?.firstName, inviter?.lastName].filter(Boolean).join(' ') || 'A team owner';

    // Count: owner + members + pending invitations must not exceed maxUsers
    const memberCount = subscription._count.members;
    const pendingCount = await prisma.subscriptionInvitation.count({
      where: { subscriptionId: id, expiresAt: { gt: new Date() } },
    });
    const totalSeatsUsed = 1 + memberCount + pendingCount;
    const alreadyMemberOrInvited = await prisma.subscriptionMember.findFirst({
      where: { subscriptionId: id, user: { email } },
    });
    const existingInvite = await prisma.subscriptionInvitation.findUnique({
      where: { subscriptionId_email: { subscriptionId: id, email } },
    });
    if (existingInvite && existingInvite.expiresAt > new Date()) {
      // Resend invitation email only
      const acceptUrl = `${frontendUrl}/accept-invite?token=${existingInvite.token}`;
      const sent = await sendTeamInvitationEmail({
        to: email,
        inviterName,
        acceptUrl,
        isExistingUser: false,
      });
      return res.status(200).json({
        success: true,
        message: sent.sent ? 'Invitation email sent again.' : 'Invitation is pending; email could not be sent. Please try again.',
        data: { email, invited: true },
      });
    }
    if (alreadyMemberOrInvited) {
      const acceptUrl = `${frontendUrl}/dashboard`;
      await sendTeamInvitationEmail({
        to: email,
        inviterName,
        acceptUrl,
        isExistingUser: true,
      });
      return res.status(200).json({
        success: true,
        message: 'This user already has access. A reminder email was sent.',
        data: { email },
      });
    }

    if (totalSeatsUsed >= subscription.maxUsers) {
      return res.status(400).json({
        success: false,
        message: `Team member limit reached (${subscription.maxUsers} users). Please upgrade your plan or contact sales for additional seats.`,
      });
    }

    const memberUser = await prisma.user.findUnique({
      where: { email },
    });

    if (memberUser) {
      // Existing user: can't add self
      if (memberUser.id === userId) {
        return res.status(400).json({
          success: false,
          message: 'You cannot invite yourself.',
        });
      }

      const existingMember = await prisma.subscriptionMember.findUnique({
        where: { userId_subscriptionId: { userId: memberUser.id, subscriptionId: id } },
      });
      if (existingMember) {
        const acceptUrl = `${frontendUrl}/dashboard`;
        await sendTeamInvitationEmail({
          to: email,
          inviterName,
          acceptUrl,
          isExistingUser: true,
        });
        return res.status(200).json({
          success: true,
          message: 'This user already has access. A reminder email was sent.',
          data: { email },
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

      const acceptUrl = `${frontendUrl}/dashboard`;
      const sent = await sendTeamInvitationEmail({
        to: email,
        inviterName,
        acceptUrl,
        isExistingUser: true,
      });
      if (!sent.sent) {
        console.warn('[SUBSCRIPTION] Member added but invitation email failed:', sent.error?.message);
      }

      return res.status(201).json({
        success: true,
        message: 'Team member added and invitation email sent.',
        data: member,
      });
    }

    // New user: create pending invitation and send email
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.subscriptionInvitation.upsert({
      where: { subscriptionId_email: { subscriptionId: id, email } },
      create: {
        subscriptionId: id,
        email,
        token,
        expiresAt,
        invitedById: userId,
      },
      update: { token, expiresAt, invitedById: userId },
    });

    const acceptUrl = `${frontendUrl}/accept-invite?token=${token}`;
    const sent = await sendTeamInvitationEmail({
      to: email,
      inviterName,
      acceptUrl,
      isExistingUser: false,
    });

    if (!sent.sent) {
      return res.status(503).json({
        success: false,
        message: 'Invitation could not be sent. Please check email configuration (RESEND_API_KEY) and try again.',
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Invitation sent. They will get access when they sign up and accept.',
      data: { email, invited: true },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Accept a team invitation by token (logged-in user whose email matches invitation).
 * @route   POST /api/subscriptions/accept-invite
 * @access  User
 */
const acceptInvite = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Invitation token is required',
      });
    }

    const invitation = await prisma.subscriptionInvitation.findUnique({
      where: { token },
      include: {
        subscription: {
          include: {
            _count: { select: { members: true } },
          },
        },
      },
    });

    if (!invitation) {
      return res.status(404).json({
        success: false,
        message: 'Invitation not found or invalid',
      });
    }

    if (invitation.expiresAt < new Date()) {
      await prisma.subscriptionInvitation.delete({ where: { id: invitation.id } }).catch(() => {});
      return res.status(410).json({
        success: false,
        message: 'This invitation has expired',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      return res.status(403).json({
        success: false,
        message: 'This invitation was sent to a different email. Please sign in with that email.',
      });
    }

    const sub = invitation.subscription;
    if (sub._count.members + 1 >= sub.maxUsers) {
      return res.status(400).json({
        success: false,
        message: 'This team has reached its member limit. The invitation can no longer be accepted.',
      });
    }

    const existing = await prisma.subscriptionMember.findUnique({
      where: { userId_subscriptionId: { userId, subscriptionId: sub.id } },
    });
    if (existing) {
      await prisma.subscriptionInvitation.delete({ where: { id: invitation.id } }).catch(() => {});
      return res.status(200).json({
        success: true,
        message: 'You already have access.',
        data: { subscriptionId: sub.id },
      });
    }

    await prisma.$transaction([
      prisma.subscriptionMember.create({
        data: { userId, subscriptionId: sub.id, role: 'member' },
      }),
      prisma.subscriptionInvitation.delete({ where: { id: invitation.id } }),
    ]);

    res.status(200).json({
      success: true,
      message: 'Invitation accepted. You now have access.',
      data: { subscriptionId: sub.id },
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

/* ============================================================
 * SHAREABLE INVITE LINK (anyone-with-the-link joins)
 * Coexists with the per-email SubscriptionInvitation flow above.
 * ============================================================ */

// Allowed expiration windows for the share link.
const INVITE_LINK_EXPIRATION_PRESETS = {
  '1d': 1 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  never: null,
};

function buildInviteLinkUrl(token) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  return `${frontendUrl}/join/${token}`;
}

function serializeInviteLink(link) {
  if (!link) return null;
  return {
    id: link.id,
    token: link.token,
    url: buildInviteLinkUrl(link.token),
    isActive: link.isActive,
    maxUses: link.maxUses,
    usedCount: link.usedCount,
    expiresAt: link.expiresAt,
    createdAt: link.createdAt,
  };
}

async function getActiveSeatUsage(subscriptionId) {
  const [memberCount, pendingCount] = await Promise.all([
    prisma.subscriptionMember.count({ where: { subscriptionId } }),
    prisma.subscriptionInvitation.count({
      where: { subscriptionId, expiresAt: { gt: new Date() } },
    }),
  ]);
  // Owner counts as 1.
  return 1 + memberCount + pendingCount;
}

/**
 * @desc    Create (or rotate) the subscription's share link.
 * @route   POST /api/subscriptions/:id/invite-link
 * @access  Subscription Owner
 */
const createInviteLink = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const { expiresIn, maxUses } = req.body || {};

    const subscription = await prisma.subscription.findUnique({ where: { id } });
    if (!subscription || subscription.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only the subscription owner can manage invite links.',
      });
    }

    if (subscription.maxUsers <= 1) {
      return res.status(400).json({
        success: false,
        message: 'Share links are only available on team plans.',
      });
    }

    if (!['ACTIVE', 'TRIALING'].includes(subscription.status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot create a share link for an inactive subscription.',
      });
    }

    const expiresKey = expiresIn || '7d';
    if (!Object.prototype.hasOwnProperty.call(INVITE_LINK_EXPIRATION_PRESETS, expiresKey)) {
      return res.status(400).json({
        success: false,
        message: 'expiresIn must be one of: 1d, 7d, 30d, never',
      });
    }
    const expiresMs = INVITE_LINK_EXPIRATION_PRESETS[expiresKey];
    const expiresAt = expiresMs ? new Date(Date.now() + expiresMs) : null;

    let parsedMaxUses = null;
    if (maxUses !== undefined && maxUses !== null && maxUses !== '') {
      const n = Number(maxUses);
      if (!Number.isInteger(n) || n < 1 || n > 1000) {
        return res.status(400).json({
          success: false,
          message: 'maxUses must be an integer between 1 and 1000 (or omitted for unlimited).',
        });
      }
      parsedMaxUses = n;
    }

    // Rotating: deactivate any prior links so we keep exactly one active link.
    // This is a "regenerate" — the old URL stops working.
    await prisma.subscriptionInviteLink.updateMany({
      where: { subscriptionId: id, isActive: true },
      data: { isActive: false },
    });

    const token = crypto.randomBytes(24).toString('base64url');
    const link = await prisma.subscriptionInviteLink.create({
      data: {
        subscriptionId: id,
        createdById: userId,
        token,
        expiresAt,
        maxUses: parsedMaxUses,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Invite link created.',
      data: serializeInviteLink(link),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get the subscription's current share link (active one, if any).
 * @route   GET /api/subscriptions/:id/invite-link
 * @access  Subscription Owner
 */
const getInviteLink = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    const subscription = await prisma.subscription.findUnique({ where: { id } });
    if (!subscription || subscription.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only the subscription owner can manage invite links.',
      });
    }

    const link = await prisma.subscriptionInviteLink.findFirst({
      where: { subscriptionId: id, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      success: true,
      data: link ? serializeInviteLink(link) : null,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Revoke the share link.
 * @route   DELETE /api/subscriptions/:id/invite-link
 * @access  Subscription Owner
 */
const revokeInviteLink = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    const subscription = await prisma.subscription.findUnique({ where: { id } });
    if (!subscription || subscription.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only the subscription owner can manage invite links.',
      });
    }

    const result = await prisma.subscriptionInviteLink.updateMany({
      where: { subscriptionId: id, isActive: true },
      data: { isActive: false },
    });

    return res.status(200).json({
      success: true,
      message: result.count > 0 ? 'Invite link revoked.' : 'No active invite link to revoke.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Public preview of a share link (so the /join page can show org/inviter
 *          info before signup). Does not require auth.
 * @route   GET /api/subscriptions/invite-link/preview/:token
 * @access  Public
 */
const previewInviteLink = async (req, res, next) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).json({ success: false, message: 'Token is required.' });
    }

    const link = await prisma.subscriptionInviteLink.findUnique({
      where: { token },
      include: {
        subscription: {
          include: {
            plan: { select: { name: true } },
            user: { select: { firstName: true, lastName: true } },
          },
        },
        createdBy: { select: { firstName: true, lastName: true } },
      },
    });

    // Preview is intentionally tolerant — always returns 200 so the public /join
    // page can render a friendly state for each failure mode.
    if (!link) {
      return res.status(200).json({
        success: false,
        status: 'invalid',
        message: 'This invite link is invalid.',
      });
    }

    if (!link.isActive) {
      return res.status(200).json({
        success: false,
        status: 'revoked',
        message: 'This invite link has been revoked.',
      });
    }

    if (link.expiresAt && link.expiresAt < new Date()) {
      return res.status(200).json({
        success: false,
        status: 'expired',
        message: 'This invite link has expired.',
      });
    }

    if (link.maxUses !== null && link.usedCount >= link.maxUses) {
      return res.status(200).json({
        success: false,
        status: 'exhausted',
        message: 'This invite link has reached its maximum uses.',
      });
    }

    const sub = link.subscription;
    const subActive =
      ['ACTIVE', 'TRIALING'].includes(sub.status) &&
      (!sub.currentPeriodEnd || sub.currentPeriodEnd > new Date());
    if (!subActive) {
      return res.status(200).json({
        success: false,
        status: 'subscription_inactive',
        message: "This team's subscription is no longer active.",
      });
    }

    const seatsUsed = await getActiveSeatUsage(sub.id);
    if (seatsUsed >= sub.maxUsers) {
      return res.status(200).json({
        success: false,
        status: 'full',
        message: 'This team has reached its member limit.',
      });
    }

    const inviterFirst =
      link.createdBy?.firstName || sub.user?.firstName || null;

    return res.status(200).json({
      success: true,
      status: 'valid',
      data: {
        organizationName: sub.organizationName || null,
        planName: sub.plan?.name || null,
        inviterFirstName: inviterFirst,
        seatsRemaining: sub.maxUsers - seatsUsed,
        expiresAt: link.expiresAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Redeem a share link — logged-in user joins the subscription.
 * @route   POST /api/subscriptions/invite-link/redeem
 * @access  Logged-in User
 */
const redeemInviteLink = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { token } = req.body || {};
    if (!token) {
      return res.status(400).json({ success: false, message: 'Token is required.' });
    }

    // Single transaction so seat-race + usedCount stay consistent.
    const result = await prisma.$transaction(async (tx) => {
      const link = await tx.subscriptionInviteLink.findUnique({
        where: { token },
        include: { subscription: true },
      });

      if (!link) return { status: 'invalid', message: 'This invite link is invalid.' };
      if (!link.isActive) return { status: 'revoked', message: 'This invite link has been revoked.' };
      if (link.expiresAt && link.expiresAt < new Date()) {
        return { status: 'expired', message: 'This invite link has expired.' };
      }
      if (link.maxUses !== null && link.usedCount >= link.maxUses) {
        return { status: 'exhausted', message: 'This invite link has reached its maximum uses.' };
      }

      const sub = link.subscription;
      const subActive =
        ['ACTIVE', 'TRIALING'].includes(sub.status) &&
        (!sub.currentPeriodEnd || sub.currentPeriodEnd > new Date());
      if (!subActive) {
        return {
          status: 'subscription_inactive',
          message: "This team's subscription is no longer active.",
        };
      }

      // Owner can't join their own team.
      if (sub.userId === userId) {
        return {
          status: 'is_owner',
          message: 'You are the owner of this team — you already have full access.',
        };
      }

      // Idempotent: already a member? Treat as success.
      const existingMember = await tx.subscriptionMember.findUnique({
        where: { userId_subscriptionId: { userId, subscriptionId: sub.id } },
      });
      if (existingMember) {
        return {
          status: 'already_member',
          message: 'You already have access to this team.',
          data: { subscriptionId: sub.id },
        };
      }

      // Re-check seats inside the transaction to defeat races.
      const [memberCount, pendingCount] = await Promise.all([
        tx.subscriptionMember.count({ where: { subscriptionId: sub.id } }),
        tx.subscriptionInvitation.count({
          where: { subscriptionId: sub.id, expiresAt: { gt: new Date() } },
        }),
      ]);
      const seatsUsed = 1 + memberCount + pendingCount;
      if (seatsUsed >= sub.maxUsers) {
        return { status: 'full', message: 'This team has reached its member limit.' };
      }

      await tx.subscriptionMember.create({
        data: { userId, subscriptionId: sub.id, role: 'member' },
      });
      await tx.subscriptionInviteLink.update({
        where: { id: link.id },
        data: { usedCount: { increment: 1 } },
      });

      // If a pending email-invite exists for this user's email on this sub, clean it up.
      const userRow = await tx.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (userRow?.email) {
        await tx.subscriptionInvitation
          .deleteMany({
            where: { subscriptionId: sub.id, email: userRow.email.toLowerCase() },
          })
          .catch(() => {});
      }

      return {
        status: 'joined',
        message: 'You have joined the team. Welcome!',
        data: { subscriptionId: sub.id },
      };
    });

    // Always 200 — the `status` field is the source of truth so the client can
    // render specific UI per outcome without parsing error messages.
    return res.status(200).json({
      success: ['joined', 'already_member'].includes(result.status),
      status: result.status,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    // Unique-constraint races (two simultaneous joins of the same user) — treat as already_member.
    if (error && error.code === 'P2002') {
      return res.status(200).json({
        success: true,
        status: 'already_member',
        message: 'You already have access to this team.',
      });
    }
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
  acceptInvite,
  removeTeamMember,
  createInviteLink,
  getInviteLink,
  revokeInviteLink,
  previewInviteLink,
  redeemInviteLink,
};
