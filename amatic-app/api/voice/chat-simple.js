/**
 * Chat Simple Endpoint (voice-to-AI)
 * Thin wrapper for voice chat: accepts { message }, returns { response }.
 */

const Anthropic = require("@anthropic-ai/sdk");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { message } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message required" });
    }
    if (message.length > 10000) {
      return res
        .status(400)
        .json({ error: "Message too long (max 10,000 characters)" });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res
        .status(500)
        .json({ error: "Anthropic API key not configured" });
    }

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      temperature: 0.7,
      messages: [{ role: "user", content: message }],
    });

    const textBlock = response.content?.find((b) => b.type === "text");
    const content = textBlock && "text" in textBlock ? textBlock.text : "";

    res.json({
      response: content,
      model: "claude-sonnet-4",
      provider: "anthropic",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Chat simple error:", error);
    res.status(500).json({
      error: "Failed to generate response",
      ...(process.env.NODE_ENV === "production"
        ? {}
        : { details: error.message }),
    });
  }
};
