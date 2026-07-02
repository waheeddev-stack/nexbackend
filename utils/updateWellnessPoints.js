import pool from "../config/db";
import verifyToken from "../middleware/auth";
import checkSubscriptionStatus from "../middleware/checkSubscription";
import {shopkeeperRouter} from "../routes/shopkeeperRoute";
import { awardWellnessPoints } from "./wellnessPoints";

shopkeeperRouter.patch(
    "/shopkeeper/updateCredits",
    verifyToken,
    // verifyShopkeeperStatus,
    checkSubscriptionStatus,
    async (req, res) => {
        try {
            const shopkeeperid = req.shopkeeperid
            const customerid = req.body.customerid
            const credits_awarded = req.body.credits_awarded

            if (!shopkeeperid) {
                return res.status(400).json({ success: false, message: "Shopkeeper Id is empty" })
            }
            if (!customerid) {
                return res.status(400).json({ success: false, message: "Customer Id is empty" })
            }
            if (credits_awarded === undefined || credits_awarded === null || isNaN(credits_awarded)) {
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