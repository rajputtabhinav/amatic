/**
 * Master Brain Endpoint
 * The "Conductor" of the Amatic AI experience.
 * 
 * Capabilities:
 * 1. Receives Canvas Context + User Query
 * 2. Streams Multi-Modal Response (Voice, Visuals, Text) via SSE
 * 3. Handles Interrupts
 */

const Anthropic = require("@anthropic-ai/sdk");

// ---------------------------------------------------------------------------
// Lightweight content-type classifier (inline, no dependencies)
// Based on lib/ai/content-type-classifier.ts — determines optimal text/visual ratio
// ---------------------------------------------------------------------------
const CONTENT_PATTERNS_JS = {
  mathematical: ["equation","formula","proof","theorem","calculate","solve","integral","derivative","algebra","geometry","calculus","matrix","vector","polynomial","pythagorean","quadratic","logarithm"],
  scientific:   ["theory of","relativity","quantum","evolution","gravity","thermodynamics","big bang","plate tectonics","electromagnetic","molecular","genetic","entropy","nucleus","photosynthesis","dna"],
  philosophical:["philosophy","ethics","moral","kant","aristotle","plato","existential","utilitarianism","virtue","epistemology","metaphysics","consciousness"],
  historical:   ["history","ancient","century","war","empire","civilization","revolution","colonialism","dynasty","medieval","renaissance","industrial"],
  technical:    ["code","algorithm","programming","function","variable","loop","class","object","api","database","server","javascript","python","software"],
};
// text ratio = fraction of content that should be canvas_text (rest = voice + visual_prompt)
const RATIO_MAP = { mathematical: 0.40, scientific: 0.30, philosophical: 0.35, historical: 0.25, technical: 0.45, simple: 0.12 };

function classifyMessage(msg) {
  const lower = (msg || "").toLowerCase();
  let best = "simple", bestScore = 0;
  for (const [type, keywords] of Object.entries(CONTENT_PATTERNS_JS)) {
    const score = keywords.filter(k => lower.includes(k)).length;
    if (score > bestScore) { bestScore = score; best = type; }
  }
  const textRatio = RATIO_MAP[best] ?? 0.12;
  const visualRatio = 1 - textRatio;
  return { type: best, textRatio, visualRatio, requiresEquations: best === "mathematical" || best === "technical" };
}

module.exports = async (req, res) => {
    // Validate HTTP method
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    // Set up SSE headers for streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
        const {
            message: rawMessage,
            canvasContext,
            userIntent,
            pointedElement,
            voiceTranscript,
            memoryContext,
            canvasImage,      // base64 JPEG of canvas — enables Claude vision
            teachingBrief,    // pre-built brief from /api/ai/recognize fast path
        } = req.body || {};

        // Extract enriched context fields (added by canvas-monitor upgrade)
        const toolInfo = canvasContext?.toolInfo;
        const canvasZones = canvasContext?.canvasZones;
        const viewport = canvasContext?.viewport;
        const elementStats = canvasContext?.elementStats;
        const message = typeof rawMessage === "string" ? rawMessage.trim() : "";

        // Validate message
        if (!message) {
            res.write(`data: ${JSON.stringify({ type: "error", message: "Valid message required" })}\n\n`);
            return res.end();
        }
        if (message.length > 10000) {
            res.write(`data: ${JSON.stringify({ type: "error", message: "Message too long (max 10,000 characters)" })}\n\n`);
            return res.end();
        }

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            res.write(`data: ${JSON.stringify({ type: "error", message: "API Key missing" })}\n\n`);
            return res.end();
        }

        const client = new Anthropic({ apiKey });

        // 1. Amatic AI system prompt: canvas-first teaching, full spatial + tool awareness
        const systemPrompt = `You are Amatic, the AI tutor inside Amatic — a living educational canvas.
You see EVERYTHING on the canvas and know EXACTLY what tool the student is using.

CONTEXT YOU RECEIVE:
- CANVAS STATE: all elements with full details (type, position, size, color, font, connections)
- ACTIVE TOOL: the drawing tool the student currently has selected
- CANVAS ZONES: a 4×6 grid (□=empty ▪=AI content ■=user content) showing which areas are free
- VIEWPORT: current scroll and zoom so you know what the student can see
- ELEMENT STATS: counts of shapes, text, drawings by type and creator
- POINTED ELEMENT: what the student is selecting/hovering
- VOICE: what the student just said
- MEMORY: what you previously taught in this session

YOUR JOB: TEACH by showing, speaking, and writing on the canvas.

TOOL-AWARE BEHAVIOR:
- "freedraw" active → student is sketching; recognize what they drew and respond to it
- "text" active → student is about to write; help them structure their thoughts
- "selection" or "lasso" active → student is reviewing; explain what they've selected
- "eraser" active → student is correcting something; offer guidance
- "arrow" active → student is connecting concepts; reinforce the relationship
- "rectangle"/"diamond"/"ellipse" active → student is building a diagram; guide the structure

CANVAS PLACEMENT RULES:
- The zone grid tells you EXACTLY which areas are free (□) vs occupied (■ or ▪)
- NEVER place canvas_text or visuals in areas already marked as occupied
- Prefer empty zones that are below or to the right of existing content
- Keep related canvas_text elements grouped together (same region)
- canvas_text is for SHORT labels, formulas, and titles only (max 60 chars each)

WHEN TO TEACH:
- Student drew something (no voice) → identify it and teach about it proactively
- Student wrote a question → answer with visuals + voice
- Student is pointing at something → explain THAT specific element
- Student spoke → respond naturally to their words

OUTPUT FORMAT — JSON objects, one per line. Do NOT output markdown, do NOT wrap in code blocks.
- { "type": "voice", "text": "..." }
- { "type": "visual_prompt", "prompt": "detailed image description for Gemini image generation...", "style": "photorealistic" }
- { "type": "canvas_text", "content": "short label or formula", "fontSize": 20 }
- { "type": "next_topic", "suggestion": "one concept to explore next", "prompt": "short question the student can ask" }
- { "type": "done" }

RULES:
1. NEVER say "I see you drew", "I can see that", "I notice you drew", or acknowledge the drawing.
   Start teaching the topic immediately. The student knows what they drew.
   BAD: "I can see you drew a heart! Let me show you..."
   GOOD: "The heart pumps about 2,000 gallons of blood every single day..."
2. Stream in THIS ORDER: voice first → canvas_text next → visual_prompt last.
   The first event must always be a voice event.
3. If TEACHING BRIEF says "Visuals already dispatched", emit ONLY voice and canvas_text.
   Do NOT generate visual_prompt events — Gemini workers are already running.
4. Voice should feel like a knowledgeable friend mid-explanation — expressive, varied, rhythmic.
   Write voice text with natural pacing:
   - Use SHORT punchy sentences (max 15 words each) for better delivery
   - End dramatic statements with "..." for natural pause: "And then something remarkable happens..."
   - Use rhetorical questions to create suspense: "But why does the heart have four chambers?"
   - Vary rhythm: mix short exclamations ("Incredible!") with longer explanations
   - Never write monotone lists — turn facts into a story the student can feel
5. If canvasImage is included, you can SEE the drawing — use that to be specific.
6. canvas_text: SHORT labels, formulas, titles only — max 60 chars each.
7. Generate 3-6 visual_prompts with EXPERT-LEVEL Gemini descriptions (only when not dispatched).
8. If MEMORY says you already taught this, go deeper or connect to a new concept.
9. If MEMORY includes DEPTH LEVEL: Advanced — use technical vocabulary, introduce edge cases,
   connect to adjacent disciplines. Never repeat the same explanation verbatim.
   If DEPTH LEVEL: Intermediate — add mechanistic detail, explain the "why" behind the basics.
10. After all visuals and voice, emit ONE { "type": "next_topic" } event with a related concept the student could explore next.
    Example: { "type": "next_topic", "suggestion": "Blood Pressure", "prompt": "How does blood pressure work?" }
    This helps the student discover the next step in their learning journey.
11. End every response with { "type": "done" }.`;

        // Build a focused, readable user prompt from enriched context
        const toolLine = toolInfo
            ? `ACTIVE TOOL: ${toolInfo.activeTool}${toolInfo.toolLocked ? " (locked)" : ""}${toolInfo.penMode ? " [pen mode]" : ""}\nTOOL CONTEXT: ${toolInfo.recentToolUsage}`
            : "";

        const zoneLine = canvasZones
            ? `CANVAS ZONES:\n${canvasZones.summary}`
            : "";

        const viewportLine = viewport
            ? `VIEWPORT: ${viewport.width}×${viewport.height}px, zoom: ${Math.round(viewport.zoom * 100)}%, scroll: (${viewport.scrollX}, ${viewport.scrollY})`
            : "";

        const statsLine = elementStats
            ? `CANVAS STATS: ${elementStats.total} elements total (${elementStats.userCount} user, ${elementStats.aiCount} AI). Types: ${Object.entries(elementStats.byType).map(([t, n]) => `${n} ${t}`).join(", ")}`
            : "";

        // Send elements summary (truncated to avoid hitting token limits)
        const elements = canvasContext?.elements ?? [];
        const userElements = elements.filter(e => e.creator === "user");
        const aiElements = elements.filter(e => e.creator === "ai");
        const elementsSummary = [
            userElements.length > 0
                ? `USER ELEMENTS:\n${userElements.slice(0, 30).map(e => `  [${e.id.slice(0,8)}] ${e.type}${e.content ? ': "' + String(e.content).slice(0,60) + '"' : ""}${e.style ? " (" + e.style + ")" : ""} at (${e.position.x}, ${e.position.y})`).join("\n")}`
                : "USER ELEMENTS: (none)",
            aiElements.length > 0
                ? `AI ELEMENTS ALREADY ON CANVAS:\n${aiElements.slice(0, 20).map(e => `  [${e.id.slice(0,8)}] ${e.type}${e.content ? ': "' + String(e.content).slice(0,60) + '"' : ""} at (${e.position.x}, ${e.position.y})`).join("\n")}`
                : "",
        ].filter(Boolean).join("\n");

        const recentChanges = canvasContext?.changes ?? [];
        const changesLine = recentChanges.length > 0
            ? `RECENT CHANGES:\n${recentChanges.slice(-5).map(c => `  ${c.type}: ${c.details}`).join("\n")}`
            : "";

        // Classify the message to determine optimal content ratios
        const classification = classifyMessage(message);
        const classificationLine = `CONTENT TYPE: ${classification.type} — recommended ratios: `
          + `${Math.round(classification.visualRatio * 100)}% visual_prompt, `
          + `${Math.round(classification.textRatio * 100)}% canvas_text`
          + (classification.requiresEquations ? ". This topic requires equations/formulas — prioritize canvas_text for those." : ".");

        // Build teaching brief section (highest priority — goes at the top)
        const briefLine = teachingBrief
            ? [
                `TEACHING BRIEF (pre-analyzed by vision AI):`,
                `Topic: ${teachingBrief.topic} (confidence: ${teachingBrief.confidence})`,
                teachingBrief.visualsAlreadyDispatched
                    ? `STATUS: Gemini workers already dispatched with expert prompts. DO NOT emit visual_prompt events. Focus ONLY on voice narration and canvas_text labels.`
                    : `STATUS: No visuals dispatched yet. You should generate visual_prompt events.`,
                teachingBrief.canvasLabels?.length > 0
                    ? `Suggested canvas labels: ${teachingBrief.canvasLabels.map(l => `"${l.content}"`).join(", ")}`
                    : "",
                teachingBrief.voiceIntro
                    ? `Suggested voice opener (use or improve): "${teachingBrief.voiceIntro}"`
                    : "",
              ].filter(Boolean).join("\n")
            : "";

        const userPrompt = [
            briefLine,
            classificationLine,
            toolLine,
            zoneLine,
            viewportLine,
            statsLine,
            elementsSummary,
            changesLine,
            `USER INTENT: ${userIntent}`,
            `USER MESSAGE: "${message}"`,
            pointedElement ? `POINTED ELEMENT (selected/hovered): ${pointedElement}` : "",
            voiceTranscript ? `VOICE TRANSCRIPT: "${voiceTranscript}"` : "",
            memoryContext ? `MEMORY (previous teaching this session):\n${memoryContext}` : "",
        ].filter(Boolean).join("\n\n");

        // 2. Build multimodal message content
        // If a canvas image was provided, Claude sees the actual drawing
        const userContent = [];
        if (canvasImage && typeof canvasImage === "string" && canvasImage.length > 0) {
            userContent.push({
                type: "image",
                source: {
                    type: "base64",
                    media_type: "image/jpeg",
                    data: canvasImage,
                },
            });
        }
        userContent.push({ type: "text", text: userPrompt });

        // 3. Start the Stream
        // betas: enables 1M token input context window (canvas state + memory can grow large).
        // Note: 1M context applies to INPUT only. max_tokens controls OUTPUT (max 64K for Sonnet 4.6).
        // The 200K-1M input range costs 2x, but only if the canvas context actually reaches that size.
        const stream = await client.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 64000, // maximum output for claude-sonnet-4-6 — full capacity for richest possible teaching responses
            temperature: 0.7,
            system: systemPrompt,
            messages: [{ role: "user", content: userContent }],
            stream: true,
            betas: ["context-1m-2025-08-07"], // enable 1M token input context window
        });

        // Handle client disconnect to abort stream and stop wasting API credits
        let aborted = false;
        req.on('close', () => {
            aborted = true;
            console.log('[Master] Client disconnected, aborting stream');
        });

        // 4. Process the Stream: accumulate text, parse complete JSON objects, emit typed SSE events
        let buffer = "";
        const emitParsed = (obj) => {
            if (obj.type === "voice" && obj.text) {
                res.write(`data: ${JSON.stringify({ type: "voice", text: obj.text })}\n\n`);
            } else if (obj.type === "visual_prompt" && obj.prompt) {
                res.write(`data: ${JSON.stringify({ type: "visual_prompt", prompt: obj.prompt, style: obj.style || "schematic", location: obj.location })}\n\n`);
            } else if (obj.type === "canvas_text" && obj.content != null) {
                res.write(`data: ${JSON.stringify({ type: "canvas_text", content: obj.content, x: obj.x ?? 100, y: obj.y ?? 100, fontSize: obj.fontSize ?? 24 })}\n\n`);
            } else if (obj.type === "next_topic" && obj.suggestion) {
                res.write(`data: ${JSON.stringify({ type: "next_topic", suggestion: obj.suggestion, prompt: obj.prompt ?? "" })}\n\n`);
            }
        };
        const tryParseBuffer = () => {
            let trimmed = buffer.trim();
            while (trimmed.length > 0) {
                const start = trimmed.indexOf("{");
                if (start === -1) break;
                trimmed = trimmed.slice(start);
                let depth = 0;
                let end = -1;
                for (let i = 0; i < trimmed.length; i++) {
                    if (trimmed[i] === "{") depth++;
                    else if (trimmed[i] === "}") {
                        depth--;
                        if (depth === 0) {
                            end = i;
                            break;
                        }
                    }
                }
                if (end === -1) break;
                const slice = trimmed.slice(0, end + 1);
                try {
                    const obj = JSON.parse(slice);
                    if (obj && typeof obj.type === "string") emitParsed(obj);
                } catch (_) {}
                trimmed = trimmed.slice(end + 1).trim();
            }
            buffer = trimmed;
        };

        for await (const chunk of stream) {
            if (aborted) break;
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                buffer += chunk.delta.text || "";
                tryParseBuffer();
            }
        }
        tryParseBuffer();

        // 5. Finish
        res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        res.end();

    } catch (error) {
        console.error("Master Brain Error:", error);
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            message:
              process.env.NODE_ENV === "production"
                ? "An error occurred"
                : error.message,
          })}\n\n`,
        );
        res.end();
    }
};
