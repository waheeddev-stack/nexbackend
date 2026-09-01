// Deprecated shim: Cloudinary -> ImageKit migration
// This file kept for backward compatibility; it now re-exports ImageKit shim
// so existing `import cloudinary from "../config/cloudinary.js"` continues to work.
// New code should import from "./imagekit.js" directly.
import imagekitShim from "./imagekit.js";

if (process.env.CLOUDINARY_CLOUD_NAME) {
  console.warn(
    "⚠️ CLOUDINARY env vars detected — project has migrated to ImageKit. Use IMAGEKIT_* vars instead. Falling back to ImageKit shim."
  );
}

export default imagekitShim;
