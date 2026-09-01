import ImageKit from "imagekit";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const publicKey = process.env.IMAGEKIT_PUBLIC_KEY || "";
const privateKey = process.env.IMAGEKIT_PRIVATE_KEY || "";
const urlEndpoint = process.env.IMAGEKIT_URL_ENDPOINT || "";

let imagekit = null;

if (publicKey && privateKey && urlEndpoint) {
  imagekit = new ImageKit({
    publicKey,
    privateKey,
    urlEndpoint,
  });
  console.log("✅ ImageKit configured");
} else {
  console.warn(
    "⚠️ ImageKit not fully configured (IMAGEKIT_PUBLIC_KEY/PRIVATE_KEY/URL_ENDPOINT missing). Image uploads will fail until env is set."
  );
}

/**
 * Upload a buffer to ImageKit.
 * @param {Buffer} buffer
 * @param {string} folder - ImageKit folder e.g. "products"
 * @param {string} fileName - optional file name
 * @returns {Promise<{secure_url: string, url: string, public_id: string, fileId: string, filePath: string}>}
 */
export async function uploadBufferToImageKit(
  buffer,
  folder = "products",
  fileName = `upload_${Date.now()}.jpg`
) {
  if (!imagekit) throw new Error("ImageKit not configured");
  const base64 = buffer.toString("base64");
  const result = await imagekit.upload({
    file: base64,
    fileName,
    folder: `/${folder}`,
    useUniqueFileName: true,
  });
  return {
    secure_url: result.url,
    url: result.url,
    public_id: result.fileId,
    fileId: result.fileId,
    filePath: result.filePath,
    thumbnailUrl: result.thumbnailUrl,
  };
}

/**
 * Delete a file from ImageKit by fileId.
 * Cloudinary API compatibility: destroy(public_id)
 */
export async function deleteFromImageKit(fileId) {
  if (!imagekit) {
    console.warn("ImageKit not configured — skip delete");
    return;
  }
  if (!fileId) return;
  await imagekit.deleteFile(fileId);
}

/**
 * Cloudinary-compatible shim so existing code using
 * cloudinary.uploader.upload_stream / .destroy keeps working
 * while actually calling ImageKit under the hood.
 */
const imagekitShim = {
  uploader: {
    upload_stream: (opts, callback) => {
      // cloudinary style: opts = { folder }, callback = (err, result) => {}
      if (typeof opts === "function") {
        callback = opts;
        opts = {};
      }
      const folder = opts?.folder || "products";
      const chunks = [];
      return {
        write(chunk) {
          chunks.push(chunk);
        },
        end(chunk) {
          if (chunk) chunks.push(chunk);
          const buffer = Buffer.concat(chunks);
          const fileName = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
          uploadBufferToImageKit(buffer, folder, fileName)
            .then((res) => callback(null, res))
            .catch((err) => callback(err));
        },
        // streamifier compatibility: pipe support
        on() {
          return this;
        },
      };
    },
    destroy: async (publicId) => {
      return deleteFromImageKit(publicId);
    },
  },
  // helpers for new code
  uploadBuffer: uploadBufferToImageKit,
  deleteFile: deleteFromImageKit,
  isConfigured: () => !!imagekit,
  instance: () => imagekit,
};

export default imagekitShim;
export { imagekit };
