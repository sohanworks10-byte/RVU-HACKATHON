import re

with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

start_marker = "alphainfra: () => `"
end_marker = "// MONITORING VIEW"

start_idx = html.find(start_marker)
end_idx = html.find(end_marker)

if start_idx == -1 or end_idx == -1:
    print("Markers not found")
    exit(1)

replacement = """alphainfra: () => `
                <div class="w-full flex flex-col font-sans overflow-hidden fade-in relative bg-white md:rounded-[2.5rem] border border-gray-100 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.05)] mb-4" style="height: calc(100vh - 120px); min-height: calc(100vh - 120px);">
                    
                    <!-- Chat Scrollable Canvas -->
                    <div id="alphainfra-full-messages" class="flex-1 overflow-y-auto chat-bubble-container scrollbar-hide p-6 md:p-10 flex flex-col">
                        
                        <!-- Initial Greeting (Flex Centers Automatically) -->
                        <div class="flex-1 flex flex-col items-center justify-center space-y-12">
                            <div class="relative mt-8">
                                <div class="absolute -inset-8 bg-gradient-to-r from-purple-500/20 to-indigo-500/20 blur-[60px] rounded-full animate-[pulse_4s_ease-in-out_infinite]"></div>
                                <div class="w-24 h-24 rounded-[2rem] bg-gradient-to-tr from-purple-600 via-indigo-600 to-purple-400 shadow-[0_20px_50px_-15px_rgba(147,51,234,0.5)] relative flex items-center justify-center p-0.5 z-10 transition-transform hover:scale-105 duration-500">
                                     <div class="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.4),transparent)] rounded-[2rem]"></div>
                                     <img src="https://xnlmfbnwyqxownvhsqoz.supabase.co/storage/v1/object/public/files/cropped_circle_image.png" class="w-[80%] h-[80%] object-contain relative z-20">
                                </div>
                            </div>
                            
                            <div class="text-center space-y-5">
                                <h1 class="text-4xl md:text-5xl font-black text-gray-900 tracking-tighter">What are we <span class="alphainfra-gradient-text italic">Building?</span></h1>
                                <p class="text-gray-500 text-lg max-w-md mx-auto leading-relaxed font-medium">Orchestrate enterprise-grade architecture via the synthesis engine.</p>
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-3xl">
                                <div onclick="document.getElementById('alphainfra-full-input').value = 'Provision a multi-AZ VPC on AWS with private subnets'; document.getElementById('alphainfra-full-input').focus();" class="p-6 rounded-3xl border border-gray-100 bg-gray-50/50 hover:bg-white hover:border-purple-200 hover:shadow-xl hover:shadow-purple-500/10 transition-all cursor-pointer group">
                                     <p class="text-[10px] font-black text-purple-600 uppercase tracking-[0.15em] mb-2">Cloud Infrastructure</p>
                                     <p class="text-[14px] font-bold text-gray-800 leading-snug">Multi-AZ AWS VPC with private subnets & NAT</p>
                                </div>
                                <div onclick="document.getElementById('alphainfra-full-input').value = 'Deploy a high-availability Redis cluster on Azure'; document.getElementById('alphainfra-full-input').focus();" class="p-6 rounded-3xl border border-gray-100 bg-gray-50/50 hover:bg-white hover:border-indigo-200 hover:shadow-xl hover:shadow-indigo-500/10 transition-all cursor-pointer group">
                                     <p class="text-[10px] font-black text-indigo-600 uppercase tracking-[0.15em] mb-2">Data Services</p>
                                     <p class="text-[14px] font-bold text-gray-800 leading-snug">High-availability Redis cluster on Azure</p>
                                </div>
                            </div>
                        </div>

                    </div>

                    <!-- Fixed Bottom Input Area -->
                    <div class="w-full shrink-0 flex justify-center pb-6 md:pb-8 px-6 md:px-10 bg-white border-t border-gray-50">
                        <div class="w-full max-w-3xl flex flex-col gap-4 mt-6">
                             <div class="relative chat-input-focus-ring bg-white border border-gray-200 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-500 group focus-within:shadow-[0_20px_50px_rgba(147,51,234,0.15)] focus-within:border-purple-300">
                                 <div class="flex items-end gap-3 p-3 px-6">
                                     <textarea id="alphainfra-full-input" 
                                        class="flex-1 bg-transparent border-0 text-[16px] text-gray-900 py-3 focus:ring-0 focus:outline-none leading-relaxed placeholder-gray-400 min-h-[52px] max-h-[250px] resize-none font-medium"
                                        placeholder="Message AlphaInfra..."
                                        oninput="this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px';"
                                        onkeydown="if(event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendAlphaInfraFullMessage(); }"
                                     ></textarea>
                                     <button onclick="sendAlphaInfraFullMessage()" class="w-12 h-12 bg-gray-900 text-white rounded-[1.2rem] shadow-xl hover:bg-purple-600 hover:-translate-y-1 transition-all duration-300 active:scale-95 flex items-center justify-center flex-shrink-0 group-focus-within:bg-purple-600">
                                         <i class="fas fa-arrow-up text-lg"></i>
                                     </button>
                                 </div>
                             </div>
                             <div class="flex items-center justify-between px-4">
                                 <div class="flex items-center gap-2">
                                     <span class="w-2 h-2 rounded-full bg-emerald-500 animate-[pulse_2s_infinite]"></span>
                                     <span class="text-[10px] font-bold text-gray-400 uppercase tracking-widest hidden sm:inline">Synthesis Eng V4.0 Ready</span>
                                     <span class="text-[10px] font-bold text-gray-400 uppercase tracking-widest sm:hidden">Ready</span>
                                 </div>
                                 <div class="flex items-center gap-4 md:gap-6">
                                     <button onclick="openAlphaInfraConfig()" class="flex items-center gap-2 cursor-pointer text-gray-400 hover:text-purple-600 transition-colors">
                                         <i class="fas fa-cog text-[10px]"></i>
                                         <span class="text-[10px] font-bold uppercase tracking-widest hidden sm:inline">Configuration</span>
                                     </button>
                                     <span class="text-gray-200 hidden sm:inline">|</span>
                                     <button onclick="clearAlphaInfraChat()" class="flex items-center gap-2 cursor-pointer text-gray-400 hover:text-red-500 transition-colors">
                                         <i class="fas fa-trash-alt text-[10px]"></i>
                                         <span class="text-[10px] font-bold uppercase tracking-widest hidden sm:inline">Clear Chat</span>
                                     </button>
                                 </div>
                             </div>
                        </div>
                    </div>
                </div>
            `,

                        """

new_html = html[:start_idx] + replacement + html[end_idx:]

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(new_html)

print("Replacement complete using python logic!")
