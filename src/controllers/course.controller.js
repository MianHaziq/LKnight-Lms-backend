const prisma = require('../config/db');

/**
 * Capitalize first letter, lowercase rest (e.g., "PUBLISHED" -> "Published")
 */
const capitalize = (str) => {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

/**
 * Generate slug from title
 */
const generateSlug = (title) => {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

/**
 * @desc    Get all courses with filters and pagination
 * @route   GET /api/courses
 * @access  Public (Published) / Admin (All)
 */
const getAllCourses = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      category,
      level,
      status,
      sortBy = 'createdAt',
      order = 'desc',
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Build where clause
    const where = {};

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { summary: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (category) {
      where.categoryId = category;
    }

    if (level) {
      where.level = level.toUpperCase();
    }

    if (status) {
      where.status = status.toUpperCase();
    }

    // Build orderBy
    const validSortFields = ['title', 'price', 'createdAt', 'updatedAt'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const sortOrder = order === 'asc' ? 'asc' : 'desc';

    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        where,
        skip,
        take,
        orderBy: { [sortField]: sortOrder },
        include: {
          category: {
            select: { id: true, name: true, slug: true },
          },
          instructor: {
            select: { id: true, firstName: true, lastName: true, avatar: true },
          },
          _count: {
            select: { enrollments: true, modules: true },
          },
        },
      }),
      prisma.course.count({ where }),
    ]);

    // Transform courses
    const transformedCourses = courses.map((course) => ({
      id: course.id,
      title: course.title,
      slug: course.slug,
      summary: course.summary,
      thumbnail: course.thumbnail,
      price: course.price,
      level: capitalize(course.level),
      status: capitalize(course.status),
      category: course.category,
      instructor: course.instructor,
      enrollments: course._count.enrollments,
      moduleCount: course._count.modules,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    }));

    res.status(200).json({
      success: true,
      data: {
        courses: transformedCourses,
        pagination: {
          page: parseInt(page),
          limit: take,
          total,
          totalPages: Math.ceil(total / take),
          hasNext: skip + take < total,
          hasPrev: parseInt(page) > 1,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get single course by ID
 * @route   GET /api/courses/:id
 * @access  Public
 */
const getCourseById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const course = await prisma.course.findUnique({
      where: { id },
      include: {
        category: {
          select: { id: true, name: true, slug: true },
        },
        instructor: {
          select: { id: true, firstName: true, lastName: true, avatar: true },
        },
        modules: {
          orderBy: { order: 'asc' },
          include: {
            lessons: {
              orderBy: { order: 'asc' },
              select: {
                id: true,
                title: true,
                duration: true,
                order: true,
              },
            },
            documents: {
              orderBy: { order: 'asc' },
              select: { id: true, title: true, fileName: true, fileSize: true, fileType: true, order: true, createdAt: true },
            },
          },
        },
        documents: {
          orderBy: { order: 'asc' },
          select: { id: true, title: true, fileName: true, fileSize: true, fileType: true, order: true, createdAt: true },
        },
        _count: {
          select: { enrollments: true },
        },
      },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    // Calculate total duration and lessons
    let totalDuration = 0;
    let totalLessons = 0;
    course.modules.forEach((module) => {
      totalLessons += module.lessons.length;
      module.lessons.forEach((lesson) => {
        totalDuration += lesson.duration || 0;
      });
    });

    // Calculate revenue
    const revenue = await prisma.enrollment.aggregate({
      where: { courseId: id, status: { not: 'REFUNDED' } },
      _sum: { price: true },
    });

    res.status(200).json({
      success: true,
      data: {
        ...course,
        level: capitalize(course.level),
        status: capitalize(course.status),
        enrollments: course._count.enrollments,
        totalDuration,
        totalLessons,
        revenue: revenue._sum.price || 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create new course
 * @route   POST /api/courses
 * @access  Admin/Instructor
 */
const createCourse = async (req, res, next) => {
  try {
    const {
      title,
      summary,
      description,
      thumbnail,
      categoryId,
      category: categoryName, // Frontend may send category name instead of ID
      level = 'BEGINNER',
      price = 0,
      status = 'DRAFT',
      instructorId,
    } = req.body;

    // Validation
    if (!title || title.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Course title is required',
      });
    }

    // Handle category - accept either categoryId or category name
    let resolvedCategoryId = categoryId;

    if (!resolvedCategoryId && categoryName) {
      // Find category by name
      const categoryByName = await prisma.category.findFirst({
        where: { name: { equals: categoryName, mode: 'insensitive' } },
      });
      if (categoryByName) {
        resolvedCategoryId = categoryByName.id;
      }
    }

    if (!resolvedCategoryId) {
      return res.status(400).json({
        success: false,
        message: 'Category is required',
      });
    }

    // Check category exists
    const category = await prisma.category.findUnique({
      where: { id: resolvedCategoryId },
    });

    if (!category) {
      return res.status(400).json({
        success: false,
        message: 'Category not found',
      });
    }

    // Handle instructor - use provided ID, authenticated user, or find first instructor
    let resolvedInstructorId = instructorId;

    if (!resolvedInstructorId) {
      // Try to use authenticated user ID if available
      if (req.userId) {
        resolvedInstructorId = req.userId;
      } else if (req.user?.id) {
        resolvedInstructorId = req.user.id;
      } else {
        // Find first instructor or admin user as fallback
        const defaultInstructor = await prisma.user.findFirst({
          where: {
            OR: [{ role: 'INSTRUCTOR' }, { role: 'ADMIN' }],
          },
          orderBy: { createdAt: 'asc' },
        });

        if (defaultInstructor) {
          resolvedInstructorId = defaultInstructor.id;
        }
      }
    }

    if (!resolvedInstructorId) {
      return res.status(400).json({
        success: false,
        message: 'Instructor is required. Please provide an instructorId.',
      });
    }

    // Check instructor exists
    const instructor = await prisma.user.findUnique({
      where: { id: resolvedInstructorId },
    });

    if (!instructor) {
      return res.status(400).json({
        success: false,
        message: 'Instructor not found',
      });
    }

    // Generate unique slug
    let slug = generateSlug(title);
    let slugExists = await prisma.course.findUnique({ where: { slug } });
    let counter = 1;

    while (slugExists) {
      slug = `${generateSlug(title)}-${counter}`;
      slugExists = await prisma.course.findUnique({ where: { slug } });
      counter++;
    }

    const course = await prisma.course.create({
      data: {
        title: title.trim(),
        slug,
        summary: summary?.trim() || null,
        description: description?.trim() || null,
        thumbnail: thumbnail || null,
        categoryId: resolvedCategoryId,
        instructorId: resolvedInstructorId,
        level: level.toUpperCase(),
        price: parseFloat(price) || 0,
        status: status.toUpperCase(),
      },
      include: {
        category: {
          select: { id: true, name: true, slug: true },
        },
        instructor: {
          select: { id: true, firstName: true, lastName: true, avatar: true },
        },
      },
    });

    res.status(201).json({
      success: true,
      message: 'Course created successfully',
      data: {
        ...course,
        level: capitalize(course.level),
        status: capitalize(course.status),
        enrollments: 0,
        moduleCount: 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update course
 * @route   PUT /api/courses/:id
 * @access  Admin/Instructor
 */
const updateCourse = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      title,
      summary,
      description,
      thumbnail,
      categoryId,
      level,
      price,
      status,
    } = req.body;

    // Check course exists
    const existingCourse = await prisma.course.findUnique({
      where: { id },
    });

    if (!existingCourse) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    const updateData = {};

    if (title && title.trim() !== '') {
      updateData.title = title.trim();

      // Generate new slug if title changed
      if (title.trim() !== existingCourse.title) {
        let slug = generateSlug(title);
        let slugExists = await prisma.course.findFirst({
          where: { slug, id: { not: id } },
        });
        let counter = 1;

        while (slugExists) {
          slug = `${generateSlug(title)}-${counter}`;
          slugExists = await prisma.course.findFirst({
            where: { slug, id: { not: id } },
          });
          counter++;
        }
        updateData.slug = slug;
      }
    }

    if (summary !== undefined) {
      updateData.summary = summary?.trim() || null;
    }

    if (description !== undefined) {
      updateData.description = description?.trim() || null;
    }

    if (thumbnail !== undefined) {
      updateData.thumbnail = thumbnail || null;
    }

    if (categoryId) {
      const category = await prisma.category.findUnique({
        where: { id: categoryId },
      });
      if (!category) {
        return res.status(400).json({
          success: false,
          message: 'Category not found',
        });
      }
      updateData.categoryId = categoryId;
    }

    if (level) {
      updateData.level = level.toUpperCase();
    }

    if (price !== undefined) {
      updateData.price = parseFloat(price) || 0;
    }

    if (status) {
      updateData.status = status.toUpperCase();
    }

    const updatedCourse = await prisma.course.update({
      where: { id },
      data: updateData,
      include: {
        category: {
          select: { id: true, name: true, slug: true },
        },
        instructor: {
          select: { id: true, firstName: true, lastName: true, avatar: true },
        },
        _count: {
          select: { enrollments: true, modules: true },
        },
      },
    });

    res.status(200).json({
      success: true,
      message: 'Course updated successfully',
      data: {
        ...updatedCourse,
        level: capitalize(updatedCourse.level),
        status: capitalize(updatedCourse.status),
        enrollments: updatedCourse._count.enrollments,
        moduleCount: updatedCourse._count.modules,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete course
 * @route   DELETE /api/courses/:id
 * @access  Admin
 */
const deleteCourse = async (req, res, next) => {
  try {
    const { id } = req.params;

    const course = await prisma.course.findUnique({
      where: { id },
      include: {
        _count: {
          select: { enrollments: true },
        },
      },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    // Check if course has enrollments
    if (course._count.enrollments > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete course. It has ${course._count.enrollments} enrollment(s).`,
      });
    }

    // Delete course (modules and lessons will be cascade deleted)
    await prisma.course.delete({
      where: { id },
    });

    res.status(200).json({
      success: true,
      message: 'Course deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Toggle course status (Draft/Published)
 * @route   PATCH /api/courses/:id/status
 * @access  Admin/Instructor
 */
const toggleCourseStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const course = await prisma.course.findUnique({
      where: { id },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    const newStatus = status
      ? status.toUpperCase()
      : course.status === 'DRAFT'
        ? 'PUBLISHED'
        : 'DRAFT';

    const updatedCourse = await prisma.course.update({
      where: { id },
      data: { status: newStatus },
      select: {
        id: true,
        title: true,
        status: true,
      },
    });

    res.status(200).json({
      success: true,
      message: `Course ${newStatus.toLowerCase()} successfully`,
      data: {
        ...updatedCourse,
        status: capitalize(updatedCourse.status),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get course statistics
 * @route   GET /api/courses/stats
 * @access  Admin
 */
const getCourseStats = async (req, res, next) => {
  try {
    const [totalCourses, publishedCourses, draftCourses, totalEnrollments] =
      await Promise.all([
        prisma.course.count(),
        prisma.course.count({ where: { status: 'PUBLISHED' } }),
        prisma.course.count({ where: { status: 'DRAFT' } }),
        prisma.enrollment.count(),
      ]);

    res.status(200).json({
      success: true,
      data: {
        total: totalCourses,
        published: publishedCourses,
        draft: draftCourses,
        totalEnrollments,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllCourses,
  getCourseById,
  createCourse,
  updateCourse,
  deleteCourse,
  toggleCourseStatus,
  getCourseStats,
};
