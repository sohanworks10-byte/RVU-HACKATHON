// Supabase Edge Function: generate-script
// Deploy this to your Supabase project to enable AI script generation
//
// 1. Install Supabase CLI: npm install -g supabase
// 2. Login: supabase login
// 3. Link your project: supabase link --project-ref psnrofnlgpqkfprjrbnm
// 4. Create the function: supabase functions new generate-script
// 5. Replace the generated index.ts with this code
// 6. Deploy: supabase functions deploy generate-script
//
// Make sure you have GEMINI_API_KEY set in Edge Function Secrets

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { prompt } = await req.json()

        if (!prompt) {
            return new Response(
                JSON.stringify({ error: 'No prompt provided' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Get API key from Edge Function Secrets
        const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')

        if (!GEMINI_API_KEY) {
            return new Response(
                JSON.stringify({ error: 'GEMINI_API_KEY not configured in Edge Function Secrets' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Call Gemini API
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 2048
                    }
                })
            }
        )

        if (!response.ok) {
            const errData = await response.json()
            return new Response(
                JSON.stringify({ error: errData.error?.message || 'Gemini API error' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const data = await response.json()
        let script = data.candidates?.[0]?.content?.parts?.[0]?.text || ''

        // Clean up markdown code blocks if present
        script = script.replace(/```bash\n?/g, '').replace(/```\n?/g, '').trim()

        return new Response(
            JSON.stringify({ script }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
