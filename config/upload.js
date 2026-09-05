import multer from "multer";

// store file in memory before upload, limit to 5MB to prevent OOM
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

export default upload;
