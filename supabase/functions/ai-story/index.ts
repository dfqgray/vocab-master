// Supabase Edge Function — AI Story Generator via DeepSeek
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { words } = await req.json();
    if (!words || !Array.isArray(words) || words.length === 0) {
      return new Response(JSON.stringify({ error: "请提供单词列表" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("DEEPSEEK_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "API Key 未配置" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const wordList = words.map((w: { word: string; meaning: string }) =>
      `${w.word}（${w.meaning}）`
    ).join(", ");

    const prompt = `Write a short English story (150-250 words) for a B1/PET level learner.
The story must be interesting, natural-sounding, and suitable for a teenager.
Include ALL of these vocabulary words naturally in the story: ${wordList}
Mark each vocabulary word by wrapping it in double asterisks like **word**.
Only mark the FIRST occurrence of each word.
Return ONLY the story text, no title, no explanation.`;

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 800,
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `API 请求失败 ${response.status}`);
    }

    const data = await response.json();
    const story = data.choices[0].message.content.trim();

    return new Response(JSON.stringify({ story }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message || "生成失败" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
