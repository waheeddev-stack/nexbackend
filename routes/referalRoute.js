import express from "express"
import { customAlphabet } from "nanoid";
import verifyToken from "../middleware/auth.js";
import pool from "../config/db.js";

function generateReferalCode(name) {
    const prefix = name.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, "X")
    const generateSuffix = customAlphabet("ABCDEFGHIJKLMNPQRSTUVWXYZ123456789", 5)
    return `${prefix}${generateSuffix()}`
}

async function grantReferralReward(referalCode, referedId) {
    const connection = await pool.getConnection()
    try {
        await connection.beginTransaction()

        // 1. Look up the referrer from the referral code
        const [codeRows] = await connection.execute(
            "SELECT id FROM users WHERE referalcode = ?",
            [referalCode]
        )

        if (codeRows.length === 0) {
            await connection.rollback()
            return { success: false, status: 404, message: "Invalid referral code" }
        }

        const referrerid = codeRows[0].id

        // Prevent self-referral
        if (String(referrerid) === String(referedId)) {
            await connection.rollback()
            return { success: false, status: 400, message: "You cannot use your own referral code" }
        }

        // 2. Check if this referred user has already been rewarded before
        const [existing] = await connection.execute(
            "SELECT id FROM refer_transaction WHERE referedid = ?",
            [referedId]
        )

        if (existing.length !== 0) {
            await connection.rollback()
            return { success: false, status: 403, message: "This user has already been referred" }
        }

        // 3. Record the referral transaction
        await connection.execute(
            "INSERT INTO refer_transaction(refererid, referedid, refered_at) VALUES (?, ?, NOW())",
            [referrerid, referedId]
        )

        // 4. Grant credits to both wallets
        await connection.execute(
            "UPDATE users SET wallet = COALESCE(wallet,0) + 40 WHERE id = ?",
            [referrerid]
        )
        await connection.execute(
            "UPDATE users SET wallet = COALESCE(wallet,0) + 80 WHERE id = ?",
            [referedId]
        )

        await connection.commit()
        return { success: true, status: 200, message: "Referral reward granted successfully" }

    } catch (error) {
        await connection.rollback()
        if (error.errno === 1062) {
            // Unique constraint on referedid caught a race — someone else's request beat us to it
            return { success: false, status: 403, message: "This user has already been referred" }
        }
        console.log("Error occurred while granting referral reward: " + error)
        return { success: false, status: 500, message: "Internal Server error" }
    } finally {
        connection.release()
    }
}

/**
 * Fetches the referral code belonging to a given user.
 *
 * @param {number|string} userId
 * @returns {Promise<{success: boolean, status: number, message: string, code?: string}>}
 */
async function getReferalCodeForUser(userId) {
    if (!userId) {
        return { success: false, status: 401, message: "Authentication required" }
    }

    const [rows] = await pool.execute(
        "SELECT referalcode FROM users WHERE id = ?",
        [userId]
    )

    if (rows.length === 0 || rows[0].referalcode === null) {
        return { success: false, status: 404, message: "No referral code found for this user" }
    }

    return { success: true, status: 200, message: "Referral code fetched", code: rows[0].referalcode }
}

// ===================================
//  Use the below router if needed
// ===================================

const referalRouter = express.Router();

// GET "api/refer/getReferalCode" = gets the referal code of the user
referalRouter.get(
    "/getReferalCode",
    verifyToken,
    async (req, res) => {
        try {
            const userId = req.user?.id
            const result = await getReferalCodeForUser(userId)
            return res.status(result.status).json(result)
        } catch (error) {
            console.log("Error occurred at getReferalCode route: " + error)
            return res.status(500).json({ success: false, message: "Internal Server error" })
        }
    }
)

// POST "/api/refer/claimReward" = Grants the reward in the wallet
// referalRouter.post(
//     "/claimReward",
//     verifyToken,
//     async (req, res) => {
//         try {
//             const referedId = req.user?.id
//             const { referalCode } = req.body

//             if (!referedId) {
//                 return res.status(401).json({ success: false, message: "Authentication required" })
//             }
//             if (!referalCode || referalCode.trim().length === 0) {
//                 return res.status(400).json({ success: false, message: "Referral code is required" })
//             }

//             const result = await grantReferralReward(referalCode.trim(), referedId)
//             return res.status(result.status).json({ success: result.success, message: result.message })

//         } catch (error) {
//             console.log("Error occurred at claimReward route: " + error)
//             return res.status(500).json({ success: false, message: "Internal Server error" })
//         }
//     }
// )

export { generateReferalCode };

export default referalRouter