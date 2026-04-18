import re

with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# 1. Replace alphainfra: () => ... with the exact HTML translation of their React Chat Area
start_marker = "alphainfra: () => `"
end_marker = "// MONITORING VIEW"

start_idx = html.find(start_marker)
end_idx = html.find(end_marker)

if start_idx == -1 or end_idx == -1:
    print("alphainfra markers not found")
    exit(1)

alphainfra_replacement = """alphainfra: () => `
        <div class="flex-1 flex flex-col min-w-0 relative h-full bg-[#F9FAFB] font-sans overflow-hidden">
          
          <!-- Chat Area -->
          <div id="alphainfra-full-messages" class="flex-1 overflow-y-auto px-4 md:px-8 pb-32 pt-4">
            <div class="max-w-3xl mx-auto flex flex-col gap-6">
              
              <!-- Empty State (will be cleared by JS upon message) -->
              <div id="alphainfra-empty-state" class="flex flex-col items-center justify-center h-[60vh] animate-[fadeIn_0.7s_ease-out]">
                <div class="w-16 h-16 bg-white border border-gray-200 shadow-sm rounded-2xl flex items-center justify-center mb-6">
                  <i class="fas fa-sparkles text-[32px] text-gray-800"></i>
                </div>
                <h1 class="text-2xl md:text-3xl font-semibold text-gray-800 mb-8 text-center">
                  How can I help you today?
                </h1>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl px-4">
                    <button onclick="document.getElementById('alphainfra-full-input').value = 'Draft an email to a client'; document.getElementById('alphainfra-full-input').focus();" class="flex flex-col items-start gap-2 p-4 bg-white border border-gray-200 rounded-xl hover:border-gray-300 hover:shadow-sm transition-all text-left group">
                      <div class="text-gray-500 group-hover:text-black transition-colors">
                        <i class="fas fa-pen-nib text-[18px]"></i>
                      </div>
                      <span class="text-sm font-medium text-gray-600 group-hover:text-gray-900">
                        Draft an email to a client
                      </span>
                    </button>

                    <button onclick="document.getElementById('alphainfra-full-input').value = 'Help me debug a React hook'; document.getElementById('alphainfra-full-input').focus();" class="flex flex-col items-start gap-2 p-4 bg-white border border-gray-200 rounded-xl hover:border-gray-300 hover:shadow-sm transition-all text-left group">
                      <div class="text-gray-500 group-hover:text-black transition-colors">
                        <i class="fas fa-code text-[18px]"></i>
                      </div>
                      <span class="text-sm font-medium text-gray-600 group-hover:text-gray-900">
                        Help me debug a React hook
                      </span>
                    </button>

                    <button onclick="document.getElementById('alphainfra-full-input').value = 'Plan a trip to Japan'; document.getElementById('alphainfra-full-input').focus();" class="flex flex-col items-start gap-2 p-4 bg-white border border-gray-200 rounded-xl hover:border-gray-300 hover:shadow-sm transition-all text-left group">
                      <div class="text-gray-500 group-hover:text-black transition-colors">
                        <i class="fas fa-globe text-[18px]"></i>
                      </div>
                      <span class="text-sm font-medium text-gray-600 group-hover:text-gray-900">
                        Plan a trip to Japan
                      </span>
                    </button>

                    <button onclick="document.getElementById('alphainfra-full-input').value = 'Brainstorm startup ideas'; document.getElementById('alphainfra-full-input').focus();" class="flex flex-col items-start gap-2 p-4 bg-white border border-gray-200 rounded-xl hover:border-gray-300 hover:shadow-sm transition-all text-left group">
                      <div class="text-gray-500 group-hover:text-black transition-colors">
                        <i class="fas fa-sparkles text-[18px]"></i>
                      </div>
                      <span class="text-sm font-medium text-gray-600 group-hover:text-gray-900">
                        Brainstorm startup ideas
                      </span>
                    </button>
                </div>
              </div>
              
            </div>
          </div>

          <!-- Input Area (Sticky Bottom - Translated exactly from React) -->
          <div class="absolute bottom-0 w-full bg-gradient-to-t from-[#F9FAFB] via-[#F9FAFB] to-transparent pt-10 pb-6 px-4 md:px-8">
            <div class="max-w-3xl mx-auto relative">
              <div class="bg-white border border-gray-200 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden transition-all focus-within:ring-2 focus-within:ring-gray-200 focus-within:border-transparent flex flex-col">
                
                <textarea
                  id="alphainfra-full-input"
                  placeholder="Message Nexus AI..."
                  class="w-full max-h-48 resize-none bg-transparent outline-none p-4 pb-2 text-[15px] placeholder-gray-400 leading-relaxed border-0 focus:ring-0"
                  rows="1"
                  style="min-height: 56px;"
                  oninput="this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 200) + 'px';"
                  onkeydown="if(event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendAlphaInfraFullMessage(); }"
                ></textarea>
                
                <div class="flex justify-between items-center p-3 pt-1">
                  <div class="flex items-center gap-1 text-gray-400">
                    <button class="p-2 hover:bg-gray-100 rounded-lg transition-colors hover:text-gray-700" title="Attach file">
                      <i class="fas fa-paperclip text-[18px]"></i>
                    </button>
                    <button class="p-2 hover:bg-gray-100 rounded-lg transition-colors hover:text-gray-700" title="Upload image">
                      <i class="fas fa-image text-[18px]"></i>
                    </button>
                  </div>
                  
                  <div class="flex items-center gap-2">
                    <button class="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-700" title="Voice input">
                      <i class="fas fa-microphone text-[18px]"></i>
                    </button>
                    <button 
                      onclick="sendAlphaInfraFullMessage()"
                      class="p-2 rounded-xl flex items-center justify-center transition-all bg-black text-white hover:bg-gray-800 shadow-md transform hover:scale-105 active:scale-95"
                    >
                      <i class="fas fa-paper-plane text-[18px]"></i>
                    </button>
                  </div>
                </div>
              </div>
              <div class="text-center text-xs text-gray-400 mt-3 font-medium tracking-wide">
                AI can make mistakes. Consider verifying important information.
              </div>
            </div>
          </div>
        </div>
      `,

                        """

html = html[:start_idx] + alphainfra_replacement + html[end_idx:]

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print("Vanilla HTML layout replacement complete!")
