import express from "express";
import pool from "../config/db.js";
import upload from "../config/upload.js";
import imagekit from "../config/imagekit.js";
import verifyToken from "../middleware/auth.js";
import streamifier from "streamifier";

const router = express.Router();

// POST /api/shopping-list - Save a new shopping list (written text list, image, or both)
router.post("/", verifyToken, upload.single("image"), async (req, res) => {
  try {
    const userId = req.user.id;
    const { items } = req.body;

    let imageUrl = null;
    let imagekitFileId = null;
    let cloudinaryPublicId = null; // legacy alias

    // Validate that at least items (text) or an image is provided
    if (!items && !req.file) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide a written list (items) or upload a shopping list image.",
      });
    }

    if (req.file) {
      try {
        const result = await new Promise((resolve, reject) => {
          const stream = imagekit.uploader.upload_stream(
            { folder: "shopping_lists" },
            (error, result) => {
              if (error) return reject(error);
              resolve(result);
            }
          );
          streamifier.createReadStream(req.file.buffer).pipe(stream);
        });
        imageUrl = result.secure_url || result.url;
        imagekitFileId = result.fileId || result.public_id;
        cloudinaryPublicId = imagekitFileId;
      } catch (uploadError) {
        console.error("ImageKit upload error:", uploadError);
        return res.status(500).json({
          success: false,
          message: "Failed to upload image to ImageKit",
        });
      }
    }

    // Save list to database (store both columns for backward compat)
    const [result] = await pool.query(
      "INSERT INTO shopping_lists (user_id, items, image_url, cloudinary_public_id, imagekit_file_id) VALUES (?, ?, ?, ?, ?)",
      [userId, items || null, imageUrl, cloudinaryPublicId, imagekitFileId]
    );

    // Fetch the newly created shopping list record
    const [[newShoppingList]] = await pool.query(
      "SELECT id, user_id, items, image_url, created_at FROM shopping_lists WHERE id = ?",
      [result.insertId]
    );

    return res.status(201).json({
      success: true,
      message: "Shopping list saved successfully",
      shoppingList: newShoppingList,
    });
  } catch (error) {
    console.error("Error saving shopping list:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save shopping list",
    });
  }
});

// GET /api/shopping-list - Retrieve all saved shopping lists for the authenticated user
router.get("/", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [lists] = await pool.query(
      "SELECT id, user_id, items, image_url, created_at FROM shopping_lists WHERE user_id = ? ORDER BY created_at DESC",
      [userId]
    );

    return res.json({
      success: true,
      shoppingLists: lists,
    });
  } catch (error) {
    console.error("Error retrieving shopping lists:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve shopping lists",
      error: error.message,
    });
  }
});

// GET /api/shopping-list/:id/image - Retrieve / redirect to the uploaded image of a specific shopping list
router.get("/:id/image", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const listId = req.params.id;

    const [[list]] = await pool.query(
      "SELECT image_url FROM shopping_lists WHERE id = ? AND user_id = ?",
      [listId, userId]
    );

    if (!list) {
      return res.status(404).json({
        success: false,
        message: "Shopping list not found or unauthorized",
      });
    }

    if (!list.image_url) {
      return res.status(400).json({
        success: false,
        message: "This shopping list does not have an image",
      });
    }

    return res.redirect(list.image_url);
  } catch (error) {
    console.error("Error retrieving shopping list image:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve shopping list image",
      error: error.message,
    });
  }
});

// DELETE /api/shopping-list/:id - Manually delete a shopping list and its associated ImageKit image
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const listId = req.params.id;

    // Retrieve list to check ownership and get ImageKit file ID
    const [[list]] = await pool.query(
      "SELECT id, user_id, cloudinary_public_id, imagekit_file_id FROM shopping_lists WHERE id = ? AND user_id = ?",
      [listId, userId]
    );

    if (!list) {
      return res.status(404).json({
        success: false,
        message: "Shopping list not found or unauthorized",
      });
    }

    // Delete image from ImageKit (fallback to legacy Cloudinary id)
    const fileId = list.imagekit_file_id || list.cloudinary_public_id;
    if (fileId) {
      try {
        await imagekit.uploader.destroy(fileId);
      } catch (imagekitError) {
        console.error(
          `Failed to delete ImageKit image on manual delete:`,
          imagekitError
        );
      }
    }

    // Delete record from database
    await pool.query("DELETE FROM shopping_lists WHERE id = ?", [listId]);

    return res.json({
      success: true,
      message: "Shopping list deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting shopping list:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete shopping list",
      error: error.message,
    });
  }
});

export default router;
