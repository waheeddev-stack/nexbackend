/**
 * The file has both function as well as router available
 * Use whatever u feel like
 * 
 * Database Tables needed:
 * 
 * 1) referalcodes:
 * Columns: userid(index), code (unique)
 * 
 * 2) refer_transaction:
 * columns: refeerid, referedid, refered_at (timestamp)
 */

import express from "express"
import { customAlphabet } from "nanoid";
import verifyToken from "../middleware/auth";
import pool from "../config/db";

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
            "SELECT userid FROM referalcodes WHERE code = ?",
            [referalCode]
        )

        if (codeRows.length === 0) {
            await connection.rollback()
            return { success: false, status: 404, message: "Invalid referral code" }
        }

        const referrerid = codeRows[0].userid

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
            "INSERT INTO refer_transaction(refeerid, referedid, refered_at) VALUES (?, ?, NOW())",
            [referrerid, referedId]
        )

        // 4. Grant credits to both wallets
        // TODO: uncomment and adjust once wallet table/schema is confirmed
        // await connection.execute(
        //     "UPDATE wallet SET credits = credits + 40 WHERE userid = ?",
        //     [referrerid]
        // )
        // await connection.execute(
        //     "UPDATE wallet SET credits = credits + 80 WHERE userid = ?",
        //     [referedId]
        // )

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
 * Creates a new referral code for a user, or returns an existing one if already generated.
 * Handles code collisions with a retry loop (requires UNIQUE constraint on `code`,
 * and UNIQUE constraint on `userid` to guard against concurrent duplicate-user races).
 *
 * @param {number|string} userId
 * @param {string} username
 * @returns {Promise<{success: boolean, status: number, message: string, code?: string}>}
 */
async function generateReferalCodeForUser(userId, username) {
    if (!userId) {
        return { success: false, status: 401, message: "Authentication required" }
    }

    if (!username || username.trim().length === 0 || !/^[A-Za-z]+$/.test(username.trim())) {
        return { success: false, status: 400, message: "Invalid username" }
    }

    const [records] = await pool.execute(
        "SELECT * FROM referalcodes WHERE userid = ?",
        [userId]
    )

    if (records.length !== 0) {
        return { success: false, status: 403, message: "Referal code with given userid already exists" }
    }

    const MAX_ATTEMPTS = 5
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const referalCode = generateReferalCode(username)
        try {
            await pool.execute(
                "INSERT INTO referalcodes(userid, code) VALUES(?,?)",
                [userId, referalCode]
            )
            return { success: true, status: 200, message: "Referal code generated", code: referalCode }
        } catch (error) {
            if (error.errno === 1062) {
                if (error.sqlMessage?.includes("userid")) {
                    // Someone else's concurrent request beat us to it for this userId
                    return { success: false, status: 403, message: "Referal code with given userid already exists" }
                }
                // Code collision — loop and try again with a fresh code
                continue
            }
            console.log("New Referal code couldn't be added: " + error)
            return { success: false, status: 500, message: "Internal Server error" }
        }
    }

    return { success: false, status: 500, message: "Could not generate a unique referral code, please try again" }
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
        "SELECT code FROM referalcodes WHERE userid = ?",
        [userId]
    )

    if (rows.length === 0) {
        return { success: false, status: 404, message: "No referral code found for this user" }
    }

    return { success: true, status: 200, message: "Referral code fetched", code: rows[0].code }
}

// ===================================
//  Use the below router if needed
// ===================================

const referalRouter = express.Router();

referalRouter.post(
    "/refer/generateCode",
    verifyToken,
    async (req, res) => {
        try {
            const userId = req.user?.id
            if (!userId) {
                return res.status(401).json({ status: false, message: "Authentication required" })
            }

            const username = req.body.username

            // Validate: must exist, non-blank, letters only (adjust regex if you want to allow spaces/hyphens)
            if (!username || username.trim().length === 0 || !/^[A-Za-z]+$/.test(username.trim())) {
                return res.status(400).json({ status: false, message: "Invalid username" })
            }

            const [records] = await pool.execute(
                "SELECT * FROM referalcodes WHERE userid = ?",
                [userId]
            )

            if (records.length !== 0) {
                return res.status(403).json({ status: false, message: "Referal code with given userid already exists" })
            }

            // Retry loop in case of rare code collisions (requires UNIQUE constraint on `code`)
            const MAX_ATTEMPTS = 5
            for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                const referalCode = generateReferalCode(username)
                try {
                    await pool.execute(
                        "INSERT INTO referalcodes(userid, code) VALUES(?,?)",
                        [userId, referalCode]
                    )
                    return res.status(200).json({ status: true, message: "Referal code generated", code: referalCode })
                } catch (error) {
                    // ER_DUP_ENTRY = 1062 in MySQL
                    if (error.errno === 1062) {
                        if (error.sqlMessage?.includes("userid")) {
                            // Someone else's concurrent request beat us to it for this userId
                            return res.status(403).json({ status: false, message: "Referal code with given userid already exists" })
                        }
                        // Code collision — loop and try again with a fresh code
                        continue
                    }
                    console.log("New Referal code couldn't be added: " + error)
                    return res.status(500).json({ status: false, message: "Internal Server error" })
                }
            }

            return res.status(500).json({ status: false, message: "Could not generate a unique referral code, please try again" })

        } catch (error) {
            console.log("Error occurred at Referal Route: " + error)
            return res.status(500).json({ status: false, message: "Internal Server error" })
        }
    })

referalRouter.post(
    "/refer/claimReward",
    verifyToken,
    async (req, res) => {
        try {
            const referedId = req.user?.id
            const { referalCode } = req.body

            if (!referedId) {
                return res.status(401).json({ success: false, message: "Authentication required" })
            }
            if (!referalCode || referalCode.trim().length === 0) {
                return res.status(400).json({ success: false, message: "Referral code is required" })
            }

            const result = await grantReferralReward(referalCode.trim(), referedId)
            return res.status(result.status).json({ success: result.success, message: result.message })

        } catch (error) {
            console.log("Error occurred at claimReward route: " + error)
            return res.status(500).json({ success: false, message: "Internal Server error" })
        }
    }
)

export default referalRouter