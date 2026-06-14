import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createClient } from '@supabase/supabase-js';
import Groq from 'groq-sdk';
import crypto from 'crypto';
import 'dotenv/config';

// ============================================================================
// Initialization & Config
// ============================================================================

const { SUPABASE_URL, SUPABASE_ANON_KEY, PORT, ENCRYPTION_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("CRITICAL: Missing Supabase environment variables.");
  process.exit(1);
}

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
  console.error("CRITICAL: Missing or invalid ENCRYPTION_KEY. Must be exactly 64 hex characters (32 bytes).");
  process.exit(1);
}

const fastify = Fastify({ logger: true });

fastify.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS']
});

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================================
// Strict Groq System Prompt
// ============================================================================

const SYSTEM_PROMPT = `You are ReflexNet, an elite mouse sensitivity optimization AI.
You receive raw telemetry data from a sequential aim assessment (Flicking -> Micro -> Tracking) and must calculate the optimal physical cm/360 sensitivity.

CRITICAL INSTRUCTIONS:
1. You MUST output ONLY valid JSON. Absolutely no markdown wrappers, no conversational text.
2. Your response MUST strictly adhere to the exact schema below:
{
  "recommended_cm_per_360": <number>,
  "diagnostic_summary": "<string explaining exactly why you chose this value in 2-3 sentences>",
  "confidence_score": <number between 0.0 and 1.0>
}

LOGIC RULES:
- The telemetry payload includes the user's "current_cm360". Your "recommended_cm_per_360" MUST be an adjustment from this baseline. For example, if current_cm360 is 45.0, and they overshoot, you might output 48.5 (slower).
- The telemetry data represents 120 seconds of continuous gameplay per drill. Frame counts and target counts should be evaluated against this 2-minute baseline.
- If the user is completely new and didn't provide a sensitivity, current_cm360 will be 40.0 (a neutral, industry-standard baseline). Adjust carefully from 40.0 based on their telemetry.
- cm/360 is a physical distance (e.g. 20.0 to 70.0). Higher cm/360 = SLOWER sensitivity. Lower cm/360 = FASTER sensitivity.
- Analyze the user's current sequential assessment AND their complete historical timeline to track macro-progression.
- High overshoot rate (> 0.5) = The player is flinging past targets. You must LOWER the sensitivity (INCREASE the cm/360).
- Low path efficiency (< 0.8) or poor tracking accuracy = The player has shaky control. Lower the sensitivity.`;

// ============================================================================
// Types & Math Engine Constants
// ============================================================================

const GAME_YAW_RATES: Record<string, number> = {
  "CS2": 0.022,
  "VALORANT": 0.07,
  "Apex Legends": 0.022,
  "Call of Duty": 0.0066,
  "The Finals": 0.0066,
  "Overwatch 2": 0.0066,
  "Rainbow Six Siege": 0.00573,
  "Fortnite": 0.005555
};

interface AnalyzePayload {
  target_game: string;
  dpi: number;
  polling_rate: number;
  currentSens?: number;
  metrics_summary: {
    flicking?: {
      overshoot_rate: number;
      undershoot_rate: number;
      path_efficiency: number;
      ttk_ms: number;
    };
    micro_adjustment?: {
      overshoot_rate: number;
      undershoot_rate: number;
      path_efficiency: number;
      ttk_ms: number;
    };
    tracking?: {
      tracking_accuracy: number;
      hovered_frames: number;
      total_frames: number;
    };
  };
}

// ============================================================================
// Encryption Utilities
// ============================================================================

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(ENCRYPTION_KEY!, 'hex');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(hash: string): string {
  const parts = hash.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encryptedText = parts[2];
  
  const key = Buffer.from(ENCRYPTION_KEY!, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// ============================================================================
// Verification Endpoint
// ============================================================================

fastify.post('/api/verify-groq', async (request, reply) => {
  const { apiKey } = request.body as { apiKey?: string };
  if (!apiKey) {
    return reply.status(400).send({ error: 'Missing API Key.' });
  }

  try {
    const tempGroq = new Groq({ apiKey });
    await tempGroq.models.list(); // Test connection
    const encryptedKey = encrypt(apiKey);
    return reply.status(200).send({ success: true, encryptedKey });
  } catch (err) {
    // Deliberately NOT logging the error object which may contain the raw API key
    return reply.status(401).send({ error: 'Invalid Groq API Key.' });
  }
});

// ============================================================================
// Middleware: JWT Verification
// ============================================================================

fastify.addHook('preHandler', async (request, reply) => {
  // Skip auth for verify-groq if needed, though frontend sends it, we'll just let it pass or require it.
  if (request.routerPath === '/api/verify-groq') return;

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    request.log.warn(`Auth failed: ${error?.message}`);
    return reply.status(401).send({ error: 'Invalid or expired JWT token' });
  }

  (request as any).user = user;
});

// ============================================================================
// Main Route: POST /api/analyze
// ============================================================================

fastify.post('/api/analyze', async (request, reply) => {
  const user = (request as any).user;
  const payload = request.body as AnalyzePayload;
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    return reply.status(401).send({ error: 'Missing auth header' });
  }

  // Dictionary Validation
  const yaw = GAME_YAW_RATES[payload.target_game];
  if (!yaw) {
    return reply.status(400).send({ error: 'Unsupported target game. Ensure the game is mapped in the engine.' });
  }

  // Compute Baseline
  let current_cm360 = 46.5; // Optimal 800 eDPI fallback
  if (payload.currentSens) {
    current_cm360 = (360 * 2.54) / (payload.dpi * payload.currentSens * yaw);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } }
  });

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  const [profileResult, countResult, historyResult] = await Promise.all([
    userClient.from('profiles').select('encrypted_groq_key').eq('id', user.id).single(),
    userClient.from('telemetry_sessions').select('*', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', twentyFourHoursAgo),
    userClient.from('telemetry_sessions').select('created_at, recommended_cm_per_360, metrics_summary').eq('user_id', user.id).order('created_at', { ascending: false }).limit(10)
  ]);

  const { data: profile } = profileResult;
  const encryptedGroqKey = profile?.encrypted_groq_key;
  if (!encryptedGroqKey) {
    return reply.status(401).send({ error: 'Groq API Key not configured. Please complete setup.' });
  }

  let decryptedKey: string;
  try {
    decryptedKey = decrypt(encryptedGroqKey);
  } catch (err) {
    return reply.status(403).send({ error: 'Failed to decrypt API Key or key tampered.' });
  }

  const { count, error: countError } = countResult;

  if (countError) {
    request.log.error(countError);
    return reply.status(500).send({ error: 'Database error during rate limit verification.' });
  }

  // 1. RATE LIMITER: Maximum 50 analysis requests per 24 hours
  if (count !== null && count >= 50) {
    return reply.status(429).send({ error: 'Rate limit exceeded. Maximum 50 analysis requests per 24 hours allowed.' });
  }

  // 2. HISTORICAL LOG AGGREGATION (Last 10 entries)
  const { data: historyData } = historyResult;

  // 3. GROQ AI EXECUTION
  // Feeding the ENTIRE uncompressed array
  const fullHistory = (historyData || []).reverse();
  const userPrompt = `CURRENT BASELINE:\ncm/360: ${current_cm360}\n\nCURRENT ASSESSMENT:\n${JSON.stringify(payload.metrics_summary)}\n\nHISTORICAL TIMELINE:\n${JSON.stringify(fullHistory)}`;
  let aiResponseText = "{}";

  try {
    const groq = new Groq({ apiKey: decryptedKey });
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      model: 'llama-3.1-8b-instant',
      response_format: { type: 'json_object' }, 
      temperature: 0.1, 
      max_tokens: 300,
    });

    aiResponseText = completion.choices[0]?.message?.content || "{}";
  } catch (groqError) {
    request.log.error(groqError);
    return reply.status(502).send({ error: 'Upstream Groq AI engine failed.' });
  }

  let aiResult;
  try {
    let sanitizedText = aiResponseText.trim();
    const startIdx = sanitizedText.indexOf('{');
    const endIdx = sanitizedText.lastIndexOf('}');

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      sanitizedText = sanitizedText.substring(startIdx, endIdx + 1);
    }
    
    aiResult = JSON.parse(sanitizedText);
  } catch (parseError) {
    request.log.error(`Failed to parse AI text: ${aiResponseText}`);
    return reply.status(500).send({ error: 'AI formatting failed' });
  }

  // 4. MATH ENGINE CALCULATIONS
  const finalCm360 = aiResult.recommended_cm_per_360;
  const recommendedSens = (360 * 2.54) / (payload.dpi * finalCm360 * yaw);
  const recommendedEDPI = recommendedSens * payload.dpi;

  // 5. RECORD SESSION TO SUPABASE
  const { error: insertError } = await userClient
    .from('telemetry_sessions')
    .insert({
      user_id: user.id,
      target_game: payload.target_game,
      dpi: payload.dpi,
      polling_rate: payload.polling_rate,
      metrics_summary: payload.metrics_summary,
      recommended_cm_per_360: finalCm360,
      recommended_sens: recommendedSens,
      recommended_edpi: Math.round(recommendedEDPI)
    });

  if (insertError) {
    request.log.error(`Failed to record session in DB: ${insertError.message}`);
  }

  // 5. ENFORCE 10-SESSION HISTORY LIMIT
  const { error: rpcError } = await userClient.rpc('enforce_session_limit', { 
    p_user_id: user.id, 
    keep_count: 10 
  });
  if (rpcError) {
    request.log.warn(`Failed to enforce session limit: ${rpcError.message}`);
  }

  // 7. RETURN CLEAN AI OBJECT TO FRONTEND
  return reply.send({
    ...aiResult,
    target_game: payload.target_game,
    current_cm360,
    current_sens: payload.currentSens || null,
    recommended_sens: recommendedSens,
    recommended_edpi: recommendedEDPI
  });
});

// ============================================================================
// Server Startup (Railway config)
// ============================================================================

const start = async () => {
  try {
    const port = parseInt(PORT || '8080', 10);
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`ReflexNet Proxy running on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();