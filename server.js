import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import userrouter from "./routes/userRoute.js";

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/auth", userrouter);

// Default route
app.get("/", (req, res) => {
  res.send("Server is running!");
});

// Server start
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
