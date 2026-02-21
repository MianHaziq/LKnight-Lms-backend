const prisma = require('../config/db');
const bunnyService = require('../services/bunny.service');

/**
 * @desc    Get all lessons for a module
 * @route   GET /api/modules/:moduleId/lessons
 * @access  Public
 */
const getLessonsByModule = async (req, res, next) => {
  try {
    const { moduleId } = req.params;

    // Check module exists
    const module = await prisma.module.findUnique({
      where: { id: moduleId },
      select: { id: true, title: true, courseId: true },
    });

    if (!module) {
      return res.status(404).json({
        success: false,
        message: 'Module not found',
      });
    }

    const lessons = await prisma.lesson.findMany({
      where: { moduleId },
      orderBy: { order: 'asc' },
    });

    // Calculate total duration
    const totalDuration = lessons.reduce(
      (acc, lesson) => acc + (lesson.duration || 0),
      0
    );

    res.status(200).json({
      success: true,
      data: lessons,
      stats: {
        lessonCount: lessons.length,
        totalDuration,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get single lesson by ID
 * @route   GET /api/lessons/:id
 * @access  Public
 */
const getLessonById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const lesson = await prisma.lesson.findUnique({
      where: { id },
      include: {
        module: {
          select: {
            id: true,
            title: true,
            courseId: true,
            course: {
              select: { id: true, title: true, slug: true },
            },
          },
        },
        documents: {
          orderBy: { order: 'asc' },
          select: { id: true, title: true, fileName: true, fileSize: true, fileType: true, order: true, createdAt: true },
        },
      },
    });

    if (!lesson) {
      return res.status(404).json({
        success: false,
        message: 'Lesson not found',
      });
    }

    // Auto-sync video status from Bunny if still processing (webhooks can't reach localhost)
    if (lesson.bunnyVideoId && lesson.videoStatus && lesson.videoStatus !== 'finished' && lesson.videoStatus !== 'none' && lesson.videoStatus !== 'failed') {
      try {
        const bunnyVideo = await bunnyService.getVideo(lesson.bunnyVideoId);
        const liveStatus = bunnyService.mapWebhookStatus(bunnyVideo.status);
        if (liveStatus !== lesson.videoStatus) {
          const updateData = { videoStatus: liveStatus };
          if (liveStatus === 'finished' && bunnyVideo.length) {
            updateData.duration = Math.round(bunnyVideo.length);
            updateData.thumbnailUrl = bunnyService.getThumbnailUrl(lesson.bunnyVideoId);
          }
          await prisma.lesson.update({ where: { id }, data: updateData });
          lesson.videoStatus = liveStatus;
          if (updateData.duration) lesson.duration = updateData.duration;
          if (updateData.thumbnailUrl) lesson.thumbnailUrl = updateData.thumbnailUrl;
        }
      } catch (err) {
        console.warn('[LESSON] Failed to sync Bunny video status:', err.message);
      }
    }

    // Include signed embed URL if Bunny video is ready
    let embedUrl = null;
    if (lesson.bunnyVideoId && lesson.videoStatus === 'finished') {
      try {
        const signed = bunnyService.generateSignedEmbedUrl(lesson.bunnyVideoId);
        embedUrl = signed.url;
      } catch (err) {
        console.warn('[LESSON] Failed to generate embed URL:', err.message);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        ...lesson,
        embedUrl,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create new lesson
 * @route   POST /api/modules/:moduleId/lessons
 * @access  Admin/Instructor
 */
const createLesson = async (req, res, next) => {
  try {
    const { moduleId } = req.params;
    const { title, description, videoUrl, content, contentType, duration } = req.body;

    // Validation
    if (!title || title.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Lesson title is required',
      });
    }

    // Check module exists
    const module = await prisma.module.findUnique({
      where: { id: moduleId },
    });

    if (!module) {
      return res.status(404).json({
        success: false,
        message: 'Module not found',
      });
    }

    // Get max order
    const maxOrderLesson = await prisma.lesson.findFirst({
      where: { moduleId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    const order = maxOrderLesson ? maxOrderLesson.order + 1 : 0;

    const lesson = await prisma.lesson.create({
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        videoUrl: videoUrl?.trim() || null,
        content: content || null,
        contentType: contentType || null,
        duration: parseInt(duration) || 0,
        moduleId,
        order,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Lesson created successfully',
      data: lesson,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update lesson
 * @route   PUT /api/lessons/:id
 * @access  Admin/Instructor
 */
const updateLesson = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, videoUrl, content, contentType, duration } = req.body;

    // Check lesson exists
    const existingLesson = await prisma.lesson.findUnique({
      where: { id },
    });

    if (!existingLesson) {
      return res.status(404).json({
        success: false,
        message: 'Lesson not found',
      });
    }

    const updateData = {};

    if (title && title.trim() !== '') {
      updateData.title = title.trim();
    }

    if (description !== undefined) {
      updateData.description = description?.trim() || null;
    }

    if (videoUrl !== undefined) {
      updateData.videoUrl = videoUrl?.trim() || null;
    }

    if (content !== undefined) {
      updateData.content = content || null;
    }

    if (contentType !== undefined) {
      updateData.contentType = contentType || null;
    }

    if (duration !== undefined) {
      updateData.duration = parseInt(duration) || 0;
    }

    const updatedLesson = await prisma.lesson.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({
      success: true,
      message: 'Lesson updated successfully',
      data: updatedLesson,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete lesson
 * @route   DELETE /api/lessons/:id
 * @access  Admin/Instructor
 */
const deleteLesson = async (req, res, next) => {
  try {
    const { id } = req.params;

    const lesson = await prisma.lesson.findUnique({
      where: { id },
    });

    if (!lesson) {
      return res.status(404).json({
        success: false,
        message: 'Lesson not found',
      });
    }

    // Clean up Bunny Stream video if it exists
    if (lesson.bunnyVideoId) {
      try {
        await bunnyService.deleteVideo(lesson.bunnyVideoId);
      } catch (err) {
        console.warn('[LESSON] Failed to delete Bunny video:', err.message);
      }
    }

    // Delete lesson
    await prisma.lesson.delete({
      where: { id },
    });

    // Reorder remaining lessons
    const remainingLessons = await prisma.lesson.findMany({
      where: { moduleId: lesson.moduleId },
      orderBy: { order: 'asc' },
    });

    await prisma.$transaction(
      remainingLessons.map((les, index) =>
        prisma.lesson.update({
          where: { id: les.id },
          data: { order: index },
        })
      )
    );

    res.status(200).json({
      success: true,
      message: 'Lesson deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Reorder lessons within a module
 * @route   PATCH /api/modules/:moduleId/lessons/reorder
 * @access  Admin/Instructor
 */
const reorderLessons = async (req, res, next) => {
  try {
    const { moduleId } = req.params;
    const { lessons } = req.body;

    if (!Array.isArray(lessons) || lessons.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Lessons array is required',
      });
    }

    // Check module exists
    const module = await prisma.module.findUnique({
      where: { id: moduleId },
    });

    if (!module) {
      return res.status(404).json({
        success: false,
        message: 'Module not found',
      });
    }

    // Update order for each lesson
    await prisma.$transaction(
      lessons.map((les, index) =>
        prisma.lesson.update({
          where: { id: les.id },
          data: { order: index },
        })
      )
    );

    res.status(200).json({
      success: true,
      message: 'Lessons reordered successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Upload video to Bunny Stream for a lesson
 * @route   POST /api/lessons/:id/video
 * @access  Admin/Instructor
 */
const uploadLessonVideo = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No video file provided',
      });
    }

    // Check lesson exists
    const lesson = await prisma.lesson.findUnique({ where: { id } });
    if (!lesson) {
      return res.status(404).json({
        success: false,
        message: 'Lesson not found',
      });
    }

    // If lesson already has a Bunny video, delete the old one
    if (lesson.bunnyVideoId) {
      try {
        await bunnyService.deleteVideo(lesson.bunnyVideoId);
      } catch (err) {
        console.warn('[LESSON] Failed to delete old Bunny video:', err.message);
      }
    }

    // Step 1: Create video entry in Bunny
    const bunnyVideo = await bunnyService.createVideo(lesson.title);

    // Step 2: Upload the file buffer to Bunny
    await bunnyService.uploadVideo(bunnyVideo.guid, req.file.buffer);

    // Step 3: Update lesson in database
    const updatedLesson = await prisma.lesson.update({
      where: { id },
      data: {
        bunnyVideoId: bunnyVideo.guid,
        bunnyLibraryId: String(bunnyVideo.videoLibraryId),
        videoStatus: 'uploaded',
        thumbnailUrl: bunnyService.getThumbnailUrl(bunnyVideo.guid),
        // Clear deprecated Base64 content
        content: null,
        contentType: null,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Video uploaded successfully. Encoding will begin shortly.',
      data: {
        lessonId: updatedLesson.id,
        bunnyVideoId: updatedLesson.bunnyVideoId,
        videoStatus: updatedLesson.videoStatus,
        thumbnailUrl: updatedLesson.thumbnailUrl,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get signed video embed URL for playback
 * @route   GET /api/lessons/:id/video-url
 * @access  Authenticated
 */
const getLessonVideoUrl = async (req, res, next) => {
  try {
    const { id } = req.params;

    const lesson = await prisma.lesson.findUnique({
      where: { id },
      select: {
        id: true,
        bunnyVideoId: true,
        videoStatus: true,
        thumbnailUrl: true,
      },
    });

    if (!lesson) {
      return res.status(404).json({
        success: false,
        message: 'Lesson not found',
      });
    }

    if (!lesson.bunnyVideoId) {
      return res.status(404).json({
        success: false,
        message: 'No video associated with this lesson',
      });
    }

    // Generate signed embed URL (1-hour expiry)
    const { url, expires } = bunnyService.generateSignedEmbedUrl(
      lesson.bunnyVideoId,
      3600
    );

    res.status(200).json({
      success: true,
      data: {
        embedUrl: url,
        expires,
        videoStatus: lesson.videoStatus,
        thumbnailUrl: lesson.thumbnailUrl,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get video encoding status
 * @route   GET /api/lessons/:id/video-status
 * @access  Admin/Instructor
 */
const getLessonVideoStatus = async (req, res, next) => {
  try {
    const { id } = req.params;

    const lesson = await prisma.lesson.findUnique({
      where: { id },
      select: {
        id: true,
        bunnyVideoId: true,
        videoStatus: true,
        thumbnailUrl: true,
      },
    });

    if (!lesson) {
      return res.status(404).json({
        success: false,
        message: 'Lesson not found',
      });
    }

    // Fetch live encoding progress from Bunny if not yet finished
    let live = null;
    if (lesson.bunnyVideoId && lesson.videoStatus !== 'finished' && lesson.videoStatus !== 'none') {
      try {
        const bunnyVideo = await bunnyService.getVideo(lesson.bunnyVideoId);
        live = {
          status: bunnyVideo.status,
          encodeProgress: bunnyVideo.encodeProgress,
          length: bunnyVideo.length,
        };
      } catch (err) {
        console.warn('[LESSON] Failed to fetch live video status:', err.message);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        videoStatus: lesson.videoStatus,
        bunnyVideoId: lesson.bunnyVideoId,
        thumbnailUrl: lesson.thumbnailUrl,
        live,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getLessonsByModule,
  getLessonById,
  createLesson,
  updateLesson,
  deleteLesson,
  reorderLessons,
  uploadLessonVideo,
  getLessonVideoUrl,
  getLessonVideoStatus,
};
