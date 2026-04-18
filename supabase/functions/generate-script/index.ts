// Supabase Edge Function: generate-script
// Uses server context to generate smart, tailored bash scripts

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
        const { prompt, serverContext, mode = 'script', chatHistory = [] } = await req.json()

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

        // Build enhanced prompt with server context
        let enhancedPrompt = '';


        if (mode === 'command') {
            enhancedPrompt = `You are a Linux shell expert. Generate a single-line command (or a short chain of commands) for this request:

"${prompt}"

REQUIREMENTS:
- Output ONLY the command(s). No markdown, no comments, no explanations.
- Do NOT start with #!/bin/bash.
- Make it efficient and safe.
- Use context below if relevant.
`;
        } else if (mode === 'json-command') {
            enhancedPrompt = `You are a Linux shell expert. Analyze this request and generate a command.

Request: "${prompt}"

REQUIREMENTS:
- Output ONLY a JSON object with two keys: "summary" and "command".
- "summary": A short, clear, human-readable description of what the command does (e.g., "Install Docker" or "Restart Nginx Service").
- "command": The actual bash command(s) to execute.
- No markdown formatting. Just the raw JSON string.
`;
        } else if (mode === 'chat') {
            enhancedPrompt = `You are "Server Copilot", a friendly and expert DevOps assistant. 
            
User Query: "${prompt}"

STRICT INSTRUCTIONS:
1. ALWAYS provide a conversational greeting and explanation.
2. If the user just says "Hi", "Hello", or asks a general question, ONLY reply with text. DO NOT generate any code block.
3. If the user asks for a simple, safe status check (e.g., "check disk", "uptime", "list files"), provide the script AND add "SAFE_TO_AUTORUN: true" at the bottom.
4. If the user asks for a modification (e.g. "deploy", "install", "restart", "delete"), provide the script BUT DO NOT add the safe flag.
5. Always wrap scripts in \`\`\`bash ... \`\`\`.
6. Add "NAVIGATE_TO: [view]" if applicable.
`;
        } else {
            enhancedPrompt = `You are a Linux shell scripting expert. Generate a bash script based on this description:

"${prompt}"

REQUIREMENTS:
- Output ONLY the bash script, no explanations before or after
- Start with #!/bin/bash
- Include error handling where appropriate
- Make it production-ready
- Add brief comments for clarity
- Keep it concise but functional
`;
        }

        if (serverContext) {
            enhancedPrompt += `
SERVER CONTEXT (use this information to write accurate scripts):
- Operating System: ${serverContext.os || 'Unknown'}
- Current User: ${serverContext.user || 'Unknown'}
- Home Directory: ${serverContext.home || 'Unknown'}
- Disk Space: ${serverContext.disk || 'Unknown'}

Installed Tools:
${serverContext.tools || 'Unknown'}

Home Directory Contents:
${serverContext.homeDir || 'Unknown'}

Running Services:
${serverContext.services || 'Unknown'}

`;
        }


        // Build Chat Contents with History
        let contents = [];
        if (chatHistory && Array.isArray(chatHistory)) {
            contents = chatHistory.map((msg: any) => ({
                role: msg.role === 'ai' ? 'model' : 'user',
                parts: [{ text: msg.text }]
            }));
        }
        contents.push({ role: 'user', parts: [{ text: enhancedPrompt }] });


        // Call Gemini API
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: contents,
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 4096
                    }
                })
            }
        );

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

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        return new Response(
            JSON.stringify({ error: errorMessage }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
