const prisma = require('../config/db');
const bcrypt = require('bcryptjs');

// ==================== ADMIN CRUD ====================

// Create a new admin
const createAdmin = async (req, res, next) => {
  try {
    const { email, name, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const admin = await prisma.admin.create({
      data: { email, name, password: hashedPassword, role },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    res.status(201).json({
      success: true,
      data: admin,
    });
  } catch (error) {
    next(error);
  }
};

// Get all admins
const getAllAdmins = async (req, res, next) => {
  try {
    const admins = await prisma.admin.findMany({
      select: { id: true, email: true, name: true, role: true, createdAt: true, updatedAt: true },
    });

    res.status(200).json({
      success: true,
      count: admins.length,
      data: admins,
    });
  } catch (error) {
    next(error);
  }
};

// Get admin by ID
const getAdminById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const admin = await prisma.admin.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, email: true, name: true, role: true, createdAt: true, updatedAt: true },
    });

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found',
      });
    }

    res.status(200).json({
      success: true,
      data: admin,
    });
  } catch (error) {
    next(error);
  }
};

// Update admin
const updateAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { email, name, password, role } = req.body;

    const updateData = { email, name, role };
    if (password) {
      updateData.password = await bcrypt.hash(password, 12);
    }

    const admin = await prisma.admin.update({
      where: { id: parseInt(id) },
      data: updateData,
      select: { id: true, email: true, name: true, role: true, createdAt: true, updatedAt: true },
    });

    res.status(200).json({
      success: true,
      data: admin,
    });
  } catch (error) {
    next(error);
  }
};

// Delete admin
const deleteAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;

    await prisma.admin.delete({
      where: { id: parseInt(id) },
    });

    res.status(200).json({
      success: true,
      message: 'Admin deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

// ==================== USER MANAGEMENT BY ADMIN ====================

// Get all users (admin view)
const fetchAllUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' } },
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: parseInt(limit),
        select: { id: true, email: true, firstName: true, lastName: true, createdAt: true, updatedAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      count: users.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      data: users,
    });
  } catch (error) {
    next(error);
  }
};

// Get user by ID (admin view)
const fetchUserById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, firstName: true, lastName: true, createdAt: true, updatedAt: true },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

// Update user (admin)
const updateUserByAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { email, firstName, lastName, password } = req.body;

    const updateData = { email, firstName, lastName };
    if (password) {
      updateData.password = await bcrypt.hash(password, 12);
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: { id: true, email: true, firstName: true, lastName: true, createdAt: true, updatedAt: true },
    });

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

// Delete user (admin)
const deleteUserByAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;

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

module.exports = {
  createAdmin,
  getAllAdmins,
  getAdminById,
  updateAdmin,
  deleteAdmin,
  fetchAllUsers,
  fetchUserById,
  updateUserByAdmin,
  deleteUserByAdmin,
};
