import pool from "../config/db.js";
import verifyToken from "../middleware/auth.js";
import checkSubscriptionStatus from "../middleware/checkSubscription.js";
import { shopkeeperRouter } from "../routes/shopkeeperRoute.js";

const verifyShopkeeperStatus = async (req, res, next) => {
    try {
        const [user] = await pool.execute("SELECT * FROM shopkeepers WHERE id = ?", [
            req.user.id,
        ]);

        if (user.length === 0) {
            return res
                .status(404)
                .json({ success: false, message: "Shopkeeper not found" });
        }

        // Check verification status with proper handling for all states
        const shopkeeper = user[0];
        const verificationStatus = shopkeeper.is_verified;

        if (verificationStatus === 0) {
            // Rejected
            return res.status(403).json({
                success: false,
                message:
                    "Your account has been denied. Please contact support for more information.",
                verification_status: "rejected",
            });
        } else if (
            verificationStatus === null ||
            verificationStatus === "" ||
            verificationStatus === undefined
        ) {
            // Pending
            return res.status(403).json({
                success: false,
                message:
                    "Your account is pending verification. Please wait for admin approval.",
                verification_status: "pending",
            });
        } else if (verificationStatus !== 1) {
            // Any other invalid status
            return res.status(403).json({
                success: false,
                message:
                    "Your account verification status is unclear. Please contact support.",
                verification_status: "unknown",
            });
        }

        // Only approved shopkeepers (is_verified = 1) can proceed

        next();
    } catch (err) {
        console.error("Verification check error:", err);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

shopkeeperRouter.patch(
    "/shopkeeper/updateCredits",
    verifyToken,
    verifyShopkeeperStatus,
    checkSubscriptionStatus,
    async (req, res) => {
        try {
            const shopkeeperid = req.user?.id
            const customerid = req.body.customerid
            const credits_awarded = Number(req.body.credits_awarded)

            if (!shopkeeperid) {
                return res.status(400).json({ success: false, message: "Shopkeeper Id is empty" })
            }
            if (!customerid) {
                return res.status(400).json({ success: false, message: "Customer Id is empty" })
            }
            if (!Number.isFinite(credits_awarded) || credits_awarded <=0) {
                return res.status(400).json({ success: false, message: "New credits were not sent." })
            }

            const [result] = await pool.execute(
                "UPDATE credits_table SET credits = credits + ? WHERE customerid = ? AND shopkeeperid = ?",
                [credits_awarded, customerid, shopkeeperid]
            )

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: "No matching credits record found for this customer/shopkeeper." })
            }

            return res.status(200).json({ success: true, message: "Credits awarded successfully" })

        } catch (error) {
            console.log("Error occurred while updating credits: " + error)
            return res.status(500).json({ success: false, message: "Internal Server error" })
        }
    }
)

shopkeeperRouter.get(
    "/shopkeeper/:shopkeeperid/getcustomers",
    verifyToken,
    verifyShopkeeperStatus,
    checkSubscriptionStatus,
    async (req, res) => {
        try {
            const shopkeeperIdFromToken = req.user?.id
            const { shopkeeperid: shopkeeperIdFromParams } = req.params

            if (!shopkeeperIdFromToken) {
                return res.status(401).json({ success: false, message: "Authentication required" })
            }
            if (String(shopkeeperIdFromParams) !== String(shopkeeperIdFromToken)) {
                return res.status(403).json({ success: false, message: "Forbidden" })
            }
            const shopkeeperid = shopkeeperIdFromToken

            const [rows] = await pool.execute(
                `SELECT customerid, credits FROM (
                    SELECT customerid, credits,
                        ROW_NUMBER() OVER (PARTITION BY customerid ORDER BY created_at DESC) AS rn
                    FROM credits_table
                    WHERE shopkeeperid = ?
                ) ranked WHERE rn = 1 ORDER BY credits DESC`,
                [shopkeeperid]
            )

            if (rows.length === 0) {
                return res.status(404).json({ success: false, message: "No customer records found" })
            }

            return res.status(200).json({ success: true, result: rows })

        } catch (error) {
            console.log("Error occurred at get customers: " + error)
            return res.status(500).json({ success: false, message: "Internal Server error" })
        }
    }
)