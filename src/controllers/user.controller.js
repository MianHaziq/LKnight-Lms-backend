const prisma = require('../config/db');
const bcrypt = require('bcryptjs');

/**
 * Capitalize first letter, lowercase rest (e.g., "ADMIN" -> "Admin")
 */
const capitalize = (str) => {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

/**
 * Helper to generate avatar initials from name
 */
const getAvatarInitials = (firstName, lastName) => {
  const first = firstName?.charAt(0)?.toUpperCase() || '';
  const last = lastName?.charAt(0)?.toUpperCase() || '';
  return `${first}${last}`;
};

/**
 * Helper to transform user data for frontend
 */
const transformUser = (user) => ({
  id: user.id,
  name: `${user.firstName} ${user.lastName}`,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  avatar: user.avatar || getAvatarInitials(user.firstName, user.lastName),
  role: capitalize(user.role) || 'Student',
  status: capitalize(user.status) || 'Active',
  enrolledCourses: user._count?.enrollments || 0,
  isEmailVerified: user.isEmailVerified,
  joinedAt: user.createdAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

/**
 * @desc    Create a new user
 * @route   POST /api/users
 * @access  Admin
 */
const createUser = async (req, res, next) => {
  try {
    const { email, firstName, lastName, password, role, status, avatar } = req.body;

    if (!email || !firstName || !lastName || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email, first name, last name, and password are required',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        password: hashedPassword,
        role: role?.toUpperCase() || 'STUDENT',
        status: status?.toUpperCase() || 'ACTIVE',
        avatar: avatar || null,
      },
      include: {
        _count: {
          select: { enrollments: true },
        },
      },
    });

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: transformUser(user),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all users with pagination, search, and filters
 * @route   GET /api/users
 * @access  Admin
 */
const getAllUsers = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      role,
      status,
      sortBy = 'createdAt',
      order = 'desc',
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Build where clause.
    // Admin accounts are never listed in the user-management table.
    const where = { role: { not: 'ADMIN' } };

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Allow filtering by role, but never override the admin exclusion
    if (role && role.toUpperCase() !== 'ADMIN') {
      where.role = role.toUpperCase();
    }

    if (status) {
      where.status = status.toUpperCase();
    }

    // Build orderBy
    const validSortFields = ['firstName', 'lastName', 'email', 'createdAt', 'role', 'status'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const sortOrder = order === 'asc' ? 'asc' : 'desc';

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { [sortField]: sortOrder },
        include: {
          _count: {
            select: { enrollments: true },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: users.map(transformUser),
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
 * @desc    Get user by ID
 * @route   GET /api/users/:id
 * @access  Admin
 */
const getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        _count: {
          select: { enrollments: true },
        },
        enrollments: {
          take: 5,
          orderBy: { enrolledAt: 'desc' },
          include: {
            course: {
              select: { id: true, title: true, thumbnail: true },
            },
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      data: {
        ...transformUser(user),
        recentEnrollments: user.enrollments,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update user
 * @route   PUT /api/users/:id
 * @access  Admin
 */
const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { email, firstName, lastName, password, role, status, avatar } = req.body;

    // Check user exists
    const existingUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const updateData = {};

    if (email) updateData.email = email;
    if (firstName) updateData.firstName = firstName;
    if (lastName) updateData.lastName = lastName;
    if (role) updateData.role = role.toUpperCase();
    if (status) updateData.status = status.toUpperCase();
    if (avatar !== undefined) updateData.avatar = avatar;

    if (password) {
      updateData.password = await bcrypt.hash(password, 12);
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      include: {
        _count: {
          select: { enrollments: true },
        },
      },
    });

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: transformUser(user),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete user
 * @route   DELETE /api/users/:id
 * @access  Admin
 */
const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Admin accounts are protected and can never be deleted
    if (user.role === 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Admin accounts cannot be deleted.',
      });
    }

    // An admin can never delete their own account
    if (req.userId && req.userId === id) {
      return res.status(403).json({
        success: false,
        message: 'You cannot delete your own account.',
      });
    }

    await prisma.user.delete({
      where: { id },
    });

    res.status(200).json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Toggle user status (Active/Inactive)
 * @route   PATCH /api/users/:id/status
 * @access  Admin
 */
const toggleUserStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const newStatus = status
      ? status.toUpperCase()
      : user.status === 'ACTIVE'
        ? 'INACTIVE'
        : 'ACTIVE';

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { status: newStatus },
      include: {
        _count: {
          select: { enrollments: true },
        },
      },
    });

    res.status(200).json({
      success: true,
      message: `User ${newStatus.toLowerCase()} successfully`,
      data: transformUser(updatedUser),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Change user role
 * @route   PATCH /api/users/:id/role
 * @access  Admin
 */
const changeUserRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({
        success: false,
        message: 'Role is required',
      });
    }

    const validRoles = ['STUDENT', 'INSTRUCTOR', 'ADMIN'];
    if (!validRoles.includes(role.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be STUDENT, INSTRUCTOR, or ADMIN',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { role: role.toUpperCase() },
      include: {
        _count: {
          select: { enrollments: true },
        },
      },
    });

    res.status(200).json({
      success: true,
      message: `User role changed to ${role}`,
      data: transformUser(updatedUser),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get user statistics
 * @route   GET /api/users/stats
 * @access  Admin
 */
const getUserStats = async (req, res, next) => {
  try {
    // Admin accounts are excluded from these stats (they are not listed users)
    const [totalUsers, students, instructors, admins, activeUsers, inactiveUsers] =
      await Promise.all([
        prisma.user.count({ where: { role: { not: 'ADMIN' } } }),
        prisma.user.count({ where: { role: 'STUDENT' } }),
        prisma.user.count({ where: { role: 'INSTRUCTOR' } }),
        prisma.user.count({ where: { role: 'ADMIN' } }),
        prisma.user.count({ where: { role: { not: 'ADMIN' }, status: 'ACTIVE' } }),
        prisma.user.count({ where: { role: { not: 'ADMIN' }, status: 'INACTIVE' } }),
      ]);

    res.status(200).json({
      success: true,
      data: {
        total: totalUsers,
        students,
        instructors,
        admins,
        active: activeUsers,
        inactive: inactiveUsers,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  toggleUserStatus,
  changeUserRole,
  getUserStats,
};
