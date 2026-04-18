import re

with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# 2. Find and replace addAlphaInfraMessage logic
add_msg_start = "function addAlphaInfraMessage(role, text, containerId, showActions = false) {"
add_msg_end = "messages.appendChild(messageRow);"

idx_start = html.find(add_msg_start)
if idx_start == -1:
    print("addAlphaInfraMessage not found")
    exit(1)
    
idx_end = html.find(add_msg_end, idx_start)

replacement_func = """function addAlphaInfraMessage(role, text, containerId, showActions = false) {
                        const messages = document.getElementById(containerId);
                        if (!messages) return;
                        
                        // Clear empty state
                        const emptyState = document.getElementById('alphainfra-empty-state');
                        if (emptyState) emptyState.remove();

                        const messageRow = document.createElement('div');
                        // Use the exact React styles from user's snippet
                        messageRow.className = `flex gap-4 w-full animate-[fadeIn_0.3s_ease-out] ${role === 'user' ? 'justify-end' : 'justify-start'}`;

                        let processedText = formatMessageText(text);

                        if (role === 'user') {
                            messageRow.innerHTML = `
                                <div class="flex flex-col gap-1 max-w-[85%] md:max-w-[75%] items-end">
                                  <div class="text-xs font-medium text-gray-400 px-1">You</div>
                                  <div class="px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed shadow-sm whitespace-pre-wrap bg-gray-800 text-white rounded-tr-sm">
                                    ${escapeHtml(text)}
                                  </div>
                                </div>
                                <div class="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 flex-shrink-0 flex items-center justify-center mt-1 text-white text-xs font-bold shadow-sm">
                                  US
                                </div>
                            `;
                        } else {
                            messageRow.innerHTML = `
                                <div class="w-8 h-8 rounded-full bg-white border border-gray-200 flex-shrink-0 flex items-center justify-center mt-1">
                                  <i class="fas fa-sparkles text-[16px] text-gray-800"></i>
                                </div>
                                <div class="flex flex-col gap-1 max-w-[85%] md:max-w-[75%] items-start">
                                  <div class="text-xs font-medium text-gray-400 px-1">Nexus AI</div>
                                  <div class="px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed shadow-sm whitespace-pre-wrap bg-white border border-gray-100 text-gray-800 rounded-tl-sm prose prose-sm max-w-none">
                                    ${processedText}
                                    ${showActions ? `
                                    <div class="mt-5 flex flex-wrap gap-2 pt-4 border-t border-gray-100/50">
                                         <button onclick="showCurrentPlan()" class="px-4 py-2 bg-black text-white text-[10px] font-black rounded-lg hover:bg-gray-800 transition-all shadow-sm uppercase tracking-widest">View Blueprint</button>
                                         <button onclick="deployInfrastructure()" class="px-4 py-2 bg-white border border-gray-200 text-gray-800 text-[10px] font-black rounded-lg hover:bg-gray-50 transition-all shadow-sm uppercase tracking-widest">Execute Deploy</button>
                                    </div>
                                    ` : ''}
                                  </div>
                                </div>
                            `;
                        }

                        messages.appendChild(messageRow);"""

new_html = html[:idx_start] + replacement_func + html[idx_end + len(add_msg_end):]

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(new_html)

print("Vanilla JS addAlphaInfraMessage rendering complete!")
