const multer = require('multer');

const storage = multer.memoryStorage();

const videoFileFilter = (req, file, cb) => {
  const allowedTypes = [
    'video/mp4',
    'video/webm',
    'video/quicktime',   // .mov
    'video/x-msvideo',   // .avi
    'video/x-matroska',  // .mkv
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Only video files (MP4, WebM, MOV, AVI, MKV) are allowed.`), false);
  }
};

const uploadVideo = multer({
  storage,
  fileFilter: videoFileFilter,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB
  },
});

module.exports = { uploadVideo };
