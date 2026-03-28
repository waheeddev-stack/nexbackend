import express from "express";

const router = express.Router();

/**
 * @route   GET /reset-password
 * @desc    Redirect to app deep link for password reset
 * @access  Public
 *
 * This route handles password reset links from emails.
 * It creates an HTML page that automatically redirects to the app's deep link.
 * If the app is not installed, it shows instructions.
 */
router.get("/reset-password", (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Invalid Reset Link - NexKirana</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            max-width: 400px;
            text-align: center;
          }
          .icon {
            font-size: 64px;
            margin-bottom: 20px;
          }
          h1 {
            color: #333;
            margin: 0 0 10px 0;
            font-size: 24px;
          }
          p {
            color: #666;
            line-height: 1.6;
            margin: 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">⚠️</div>
          <h1>Invalid Reset Link</h1>
          <p>This password reset link is invalid or incomplete. Please request a new password reset from the app.</p>
        </div>
      </body>
      </html>
    `);
  }

  // Create the deep link
  const deepLink = `nexkirana://reset-password?token=${encodeURIComponent(token)}`;

  // Send HTML page that attempts to open the app
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Opening NexKirana App...</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          margin: 0;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
          background: white;
          padding: 40px;
          border-radius: 12px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.2);
          max-width: 500px;
          text-align: center;
        }
        .spinner {
          border: 4px solid #f3f3f3;
          border-top: 4px solid #667eea;
          border-radius: 50%;
          width: 50px;
          height: 50px;
          animation: spin 1s linear infinite;
          margin: 0 auto 20px;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        h1 {
          color: #333;
          margin: 0 0 10px 0;
          font-size: 24px;
        }
        p {
          color: #666;
          line-height: 1.6;
          margin: 0 0 20px 0;
        }
        .button {
          display: inline-block;
          background: #667eea;
          color: white;
          padding: 12px 30px;
          border-radius: 6px;
          text-decoration: none;
          font-weight: 600;
          margin-top: 10px;
          transition: background 0.3s;
        }
        .button:hover {
          background: #5568d3;
        }
        .instructions {
          margin-top: 30px;
          padding: 20px;
          background: #f8f9fa;
          border-radius: 8px;
          text-align: left;
          display: none;
        }
        .instructions h2 {
          font-size: 16px;
          margin: 0 0 10px 0;
          color: #333;
        }
        .instructions ol {
          margin: 0;
          padding-left: 20px;
          color: #666;
        }
        .instructions li {
          margin-bottom: 8px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="spinner"></div>
        <h1>Opening NexKirana App...</h1>
        <p>Please wait while we redirect you to the app.</p>
        <a href="${deepLink}" class="button" id="openAppBtn">Open App Manually</a>
        
        <div class="instructions" id="instructions">
          <h2>App Not Opening?</h2>
          <ol>
            <li>Make sure the NexKirana app is installed on your device</li>
            <li>Click the "Open App Manually" button above</li>
            <li>If that doesn't work, copy the link and open it in your browser</li>
            <li>Still having issues? Request a new password reset from the app</li>
          </ol>
        </div>
      </div>

      <script>
        // Attempt to open the app immediately
        window.location.href = '${deepLink}';
        
        // Show instructions after 3 seconds if still on page
        setTimeout(function() {
          document.getElementById('instructions').style.display = 'block';
        }, 3000);

        // Track if user clicked the manual button
        document.getElementById('openAppBtn').addEventListener('click', function(e) {
          e.preventDefault();
          window.location.href = '${deepLink}';
          
          // Show instructions immediately after manual click
          setTimeout(function() {
            document.getElementById('instructions').style.display = 'block';
          }, 1000);
        });
      </script>
    </body>
    </html>
  `);
});

export default router;
