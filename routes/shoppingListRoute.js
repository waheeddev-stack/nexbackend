import express from "express";
import pool from "../config/db.js";
import upload from "../config/upload.js";
import cloudinary from "../config/cloudinary.js";
import verifyToken from "../middleware/auth.js";
import streamifier from "streamifier";

const router = express.Router();

// POST /api/shopping-list - Save a new shopping list (written text list, image, or both)
router.post("/", verifyToken, upload.single("image"), async (req, res) => {
  try {
    const userId = req.user.id;
    const { items } = req.body;

    let imageUrl = null;
    let cloudinaryPublicId = null;

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
          const stream = cloudinary.uploader.upload_stream(
            { folder: "shopping_lists" },
            (error, result) => {
              if (error) return reject(error);
              resolve(result);
            }
          );
          streamifier.createReadStream(req.file.buffer).pipe(stream);
        });
        imageUrl = result.secure_url;
        cloudinaryPublicId = result.public_id;
      } catch (uploadError) {
        console.error("Cloudinary upload error:", uploadError);
        return res.status(500).json({
          success: false,
          message: "Failed to upload image to Cloudinary",
        });
      }
    }

    // Save list to database
    const [result] = await pool.query(
      "INSERT INTO shopping_lists (user_id, items, image_url, cloudinary_public_id) VALUES (?, ?, ?, ?)",
      [userId, items || null, imageUrl, cloudinaryPublicId]
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

// DELETE /api/shopping-list/:id - Manually delete a shopping list and its associated Cloudinary image
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const listId = req.params.id;

    // Retrieve list to check ownership and get Cloudinary public ID
    const [[list]] = await pool.query(
      "SELECT id, user_id, cloudinary_public_id FROM shopping_lists WHERE id = ? AND user_id = ?",
      [listId, userId]
    );

    if (!list) {
      return res.status(404).json({
        success: false,
        message: "Shopping list not found or unauthorized",
      });
    }

    // Delete image from Cloudinary
    if (list.cloudinary_public_id) {
      try {
        await cloudinary.uploader.destroy(list.cloudinary_public_id);
      } catch (cloudinaryError) {
        console.error(
          `Failed to delete Cloudinary image on manual delete:`,
          cloudinaryError
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
