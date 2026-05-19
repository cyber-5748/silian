import api from './api.js';

class ChatModule {
    constructor(container) {
        this.container = container;
        this.messagesContainer = container.querySelector('#chatMessages');
        this.input = container.querySelector('#chatInput');
        this.sendBtn = container.querySelector('#sendBtn');
        this.isProcessing = false;
        this.listeners = new Set();
        this.currentSessionId = null;
        this.typewriterQueue = [];
        this.isTypewriting = false;
        this.typewriterSpeed = 20;
        this.currentAIMessage = null;
        this.currentAIMessageContent = '';
        this.abortController = null;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.autoResizeInput();
    }

    setupEventListeners() {
        this.sendBtn.addEventListener('click', () => this.handleSend());
        
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSend();
            }
        });

        this.input.addEventListener('input', () => this.autoResizeInput());
    }

    autoResizeInput() {
        this.input.style.height = 'auto';
        this.input.style.height = Math.min(this.input.scrollHeight, 120) + 'px';
    }

    setSessionId(sessionId) {
        this.currentSessionId = sessionId;
    }

    async handleSend() {
        const content = this.input.value.trim();
        if (!content || this.isProcessing) return;

        if (!this.currentSessionId) {
            this.notifyListeners('error', { message: '请先选择或创建一个会话' });
            return;
        }

        this.isProcessing = true;
        this.sendBtn.disabled = true;
        this.input.value = '';
        this.autoResizeInput();

        this.addMessage({ role: 'user', content });
        this.notifyListeners('message', { role: 'user', content });

        this.currentAIMessage = this.createAIMessageElement();
        this.currentAIMessageContent = '';

        try {
            this.abortController = new AbortController();
            
            const streamGenerator = api.streamMessage(content, this.currentSessionId);
            
            for await (const chunk of streamGenerator) {
                if (chunk.type === 'start') {
                    this.currentAIMessageContent = '';
                } else if (chunk.type === 'chunk') {
                    await this.typewriterEffect(chunk.content);
                } else if (chunk.type === 'done') {
                    this.finalizeAIMessage(chunk.content, chunk.node_id);
                    this.notifyListeners('response', {
                        content: chunk.content,
                        nodeId: chunk.node_id
                    });
                } else if (chunk.type === 'error') {
                    this.showError(chunk.content);
                    this.notifyListeners('error', { message: chunk.content });
                }
            }
        } catch (error) {
            console.error('发送消息失败:', error);
            this.showError(error.message || '抱歉，发生了错误，请稍后重试。');
            this.notifyListeners('error', { message: error.message });
        } finally {
            this.isProcessing = false;
            this.sendBtn.disabled = false;
            this.abortController = null;
        }
    }

    createAIMessageElement() {
        const messageEl = document.createElement('div');
        messageEl.classList.add('message', 'assistant', 'streaming');
        
        const avatar = document.createElement('div');
        avatar.classList.add('message-avatar');
        avatar.textContent = 'AI';
        
        const content = document.createElement('div');
        content.classList.add('message-content');
        
        const text = document.createElement('p');
        text.classList.add('streaming-text');
        content.appendChild(text);
        
        messageEl.appendChild(avatar);
        messageEl.appendChild(content);
        
        this.messagesContainer.appendChild(messageEl);
        this.scrollToBottom();
        
        return { element: messageEl, textElement: text };
    }

    async typewriterEffect(chunk) {
        if (!this.currentAIMessage) return;
        
        this.currentAIMessageContent += chunk;
        
        const textEl = this.currentAIMessage.textElement;
        
        for (const char of chunk) {
            if (textEl.textContent !== this.currentAIMessageContent.slice(0, textEl.textContent.length + 1)) {
                textEl.textContent += char;
            } else {
                textEl.textContent = this.currentAIMessageContent;
            }
            
            if (this.typewriterSpeed > 0) {
                await this.sleep(this.typewriterSpeed);
            }
        }
        
        textEl.textContent = this.currentAIMessageContent;
        this.scrollToBottom();
    }

    finalizeAIMessage(content, nodeId) {
        if (!this.currentAIMessage) return;
        
        const { element, textElement } = this.currentAIMessage;
        element.classList.remove('streaming');
        textElement.classList.remove('streaming-text');
        textElement.textContent = content;
        
        if (nodeId) {
            element.dataset.nodeId = nodeId;
        }
        
        this.currentAIMessage = null;
        this.currentAIMessageContent = '';
        this.scrollToBottom();
    }

    showError(message) {
        if (this.currentAIMessage) {
            const { element, textElement } = this.currentAIMessage;
            element.classList.remove('streaming');
            element.classList.add('error');
            textElement.classList.remove('streaming-text');
            textElement.textContent = message;
            this.currentAIMessage = null;
        } else {
            this.addMessage({
                role: 'assistant',
                content: message,
                isError: true
            });
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    addMessage(message) {
        const messageEl = document.createElement('div');
        messageEl.classList.add('message', message.role);
        if (message.isError) {
            messageEl.classList.add('error');
        }
        if (message.nodeId) {
            messageEl.dataset.nodeId = message.nodeId;
        }
        
        const avatar = document.createElement('div');
        avatar.classList.add('message-avatar');
        avatar.textContent = message.role === 'user' ? '我' : 'AI';
        
        const content = document.createElement('div');
        content.classList.add('message-content');
        
        const text = document.createElement('p');
        text.textContent = message.content;
        content.appendChild(text);
        
        messageEl.appendChild(avatar);
        messageEl.appendChild(content);
        
        this.messagesContainer.appendChild(messageEl);
        this.scrollToBottom();
        
        return messageEl;
    }

    showTypingIndicator() {
        const indicator = document.createElement('div');
        indicator.classList.add('message', 'assistant', 'typing-indicator');
        indicator.innerHTML = `
            <div class="message-avatar">AI</div>
            <div class="message-content">
                <p class="typing-dots">
                    <span>.</span><span>.</span><span>.</span>
                </p>
            </div>
        `;
        this.messagesContainer.appendChild(indicator);
        this.scrollToBottom();
    }

    removeTypingIndicator() {
        const indicator = this.messagesContainer.querySelector('.typing-indicator');
        if (indicator) {
            indicator.remove();
        }
    }

    updateLastMessage(content) {
        const messages = this.messagesContainer.querySelectorAll('.message.assistant:not(.typing-indicator)');
        const lastMessage = messages[messages.length - 1];
        if (lastMessage) {
            const contentEl = lastMessage.querySelector('.message-content p');
            if (contentEl) {
                contentEl.textContent = content;
            }
        }
    }

    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    clear() {
        this.messagesContainer.innerHTML = `
            <div class="message assistant">
                <div class="message-avatar">AI</div>
                <div class="message-content">
                    <p>你好！我是思维导图AI助手。你可以向我提问，我会将对话内容以思维导图的形式展示出来。</p>
                </div>
            </div>
        `;
    }

    loadMessages(messages) {
        this.clear();
        if (messages && messages.length > 0) {
            messages.forEach(msg => {
                this.addMessage({
                    role: msg.role,
                    content: msg.content,
                    nodeId: msg.node_id
                });
            });
        }
    }

    subscribe(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    notifyListeners(event, data) {
        this.listeners.forEach(callback => {
            try {
                callback(event, data);
            } catch (error) {
                console.error('聊天监听器错误:', error);
            }
        });
    }

    setInputEnabled(enabled) {
        this.input.disabled = !enabled;
        this.sendBtn.disabled = !enabled;
    }

    setTypewriterSpeed(speed) {
        this.typewriterSpeed = speed;
    }

    abort() {
        if (this.abortController) {
            this.abortController.abort();
            this.isProcessing = false;
            this.sendBtn.disabled = false;
        }
    }

    async loadHistory(sessionId) {
        try {
            const response = await api.getChatHistory(sessionId);
            this.loadMessages(response.messages);
            return response;
        } catch (error) {
            console.error('加载历史消息失败:', error);
            throw error;
        }
    }

    highlightMessage(nodeId) {
        const messages = this.messagesContainer.querySelectorAll('.message');
        
        messages.forEach(msg => {
            msg.classList.remove('highlighted');
        });
        
        messages.forEach(msg => {
            if (msg.dataset.nodeId === nodeId) {
                msg.classList.add('highlighted');
                msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    }
}

export default ChatModule;
