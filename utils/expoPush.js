import fetch from "node-fetch";

export async function sendExpoPush(expoPushToken, title, body, data = {}) {
  if (!expoPushToken) return null;
  const messages = [
    {
      to: expoPushToken,
      sound: "default",
      title,
      body,
      data,
    },
  ];

  try {
    const resp = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
    const json = await resp.json();
    // log and return response for caller to handle invalid tokens
    console.log("Expo push response:", json);
    return json;
  } catch (err) {
    console.error("sendExpoPush error:", err);
    return null;
  }
}