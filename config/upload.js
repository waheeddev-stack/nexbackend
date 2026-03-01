import multer from "multer";

// store file in memory before upload
const storage = multer.memoryStorage();
const upload = multer({ storage });

export default upload;