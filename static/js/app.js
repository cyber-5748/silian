import api from './api.js';
import sessionManager from './session.js';
import MindmapRenderer from './mindmap.js';
import ChatModule from './chat.js';

class App {
    constructor() {
        this.mindmapRenderer = null;
        this.chatModule = null;
        this.currentSession = null;
        this.activeNodeId = 'root';
        this.nodeConversationMap = new Map();
    }

    init() {
        this.initTheme();
        this.initMindmap();
        this.initChat();
        this.initSessionUI();
        this.initToolbar();
        this.initExportModal();

        sessionManager.init();

        sessionManager.subscribe(this.handleSessionChange.bind(this));

        this.loadCurrentSession();

        sessionManager.initFromBackend().then(() => {
            this.loadCurrentSession();
        });
    }

    initTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
    }

    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
    }

    initMindmap() {
        const container = document.getElementById('mindmapContainer');
        this.mindmapRenderer = new MindmapRenderer(container);

        this.mindmapRenderer.setOnNodeSelect((info) => this.handleNodeSelect(info));

        container.addEventListener('mindmap:nodeClick', (e) => {
            console.log('节点点击:', e.detail);
        });
    }

    handleNodeSelect(info) {
        const nodeId = this.mindmapRenderer.selectedNodeId || 'root';
        this.activeNodeId = nodeId;
        this.chatModule.setActiveNodeId(nodeId);

        const conversation = this.nodeConversationMap.get(nodeId);
        this.chatModule.showNodeConversation({
            userMessage: conversation ? conversation.userMessage : (info.fullContent || ''),
            aiReply: conversation ? conversation.aiReply : ''
        });
    }

    initChat() {
        const container = document.getElementById('chatPanel');
        this.chatModule = new ChatModule(container);

        this.chatModule.subscribe(async (event, data) => {
            if (event === 'message') {
                this.handleUserMessage(data);
            } else if (event === 'response') {
                this.handleAIResponse(data);
            } else if (event === 'error') {
                this.handleError(data);
            }
        });
    }

    initSessionUI() {
        const sessionList = document.getElementById('sessionList');
        const newSessionBtn = document.getElementById('newSessionBtn');
        const clearAllBtn = document.getElementById('clearAllSessionsBtn');
        const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
        const sidebar = document.getElementById('sidebar');

        newSessionBtn.addEventListener('click', () => {
            sessionManager.createSession('新会话');
        });

        clearAllBtn.addEventListener('click', () => {
            if (confirm('确定要清空所有会话吗？此操作不可恢复。')) {
                sessionManager.clearAllSessions();
            }
        });

        toggleSidebarBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    initToolbar() {
        const themeToggleBtn = document.getElementById('themeToggleBtn');
        const zoomInBtn = document.getElementById('zoomInBtn');
        const zoomOutBtn = document.getElementById('zoomOutBtn');
        const resetViewBtn = document.getElementById('resetViewBtn');
        const createBranchBtn = document.getElementById('createBranchBtn');

        themeToggleBtn.addEventListener('click', () => this.toggleTheme());
        zoomInBtn.addEventListener('click', () => this.mindmapRenderer.zoomIn());
        zoomOutBtn.addEventListener('click', () => this.mindmapRenderer.zoomOut());
        resetViewBtn.addEventListener('click', () => this.mindmapRenderer.resetView());

        if (createBranchBtn) {
            createBranchBtn.addEventListener('click', () => this.handleCreateBranchFromToolbar());
        }
    }

    handleCreateBranchFromToolbar() {
        const session = sessionManager.getCurrentSession();
        if (!session) {
            alert('请先选择一个会话');
            return;
        }

        const selectedNodeId = this.mindmapRenderer.selectedNodeId;
        if (selectedNodeId && selectedNodeId !== 'root') {
            this.mindmapRenderer.handleCreateBranch(selectedNodeId);
        } else {
            this.mindmapRenderer.handleCreateBranch('root');
        }
    }

    initExportModal() {
        const exportBtn = document.getElementById('exportBtn');
        const exportModal = document.getElementById('exportModal');
        const closeExportModal = document.getElementById('closeExportModal');
        const exportPDF = document.getElementById('exportPDF');
        const exportMM = document.getElementById('exportMM');
        const exportJSON = document.getElementById('exportJSON');
        const exportMarkdown = document.getElementById('exportMarkdown');
        const importJSON = document.getElementById('importJSON');
        const importFileInput = document.getElementById('importFileInput');

        exportBtn.addEventListener('click', () => {
            exportModal.classList.add('active');
        });

        closeExportModal.addEventListener('click', () => {
            exportModal.classList.remove('active');
        });

        exportModal.addEventListener('click', (e) => {
            if (e.target === exportModal) {
                exportModal.classList.remove('active');
            }
        });

        if (exportPDF) {
            exportPDF.addEventListener('click', async () => {
                const session = sessionManager.getCurrentSession();
                if (!session) {
                    alert('请先选择一个会话');
                    return;
                }
                try {
                    await api.exportPDF(session.id);
                } catch (error) {
                    console.error('PDF导出失败:', error);
                    alert('PDF导出失败: ' + error.message);
                }
                exportModal.classList.remove('active');
            });
        }

        if (exportMM) {
            exportMM.addEventListener('click', async () => {
                const session = sessionManager.getCurrentSession();
                if (!session) {
                    alert('请先选择一个会话');
                    return;
                }
                try {
                    await api.exportMM(session.id);
                } catch (error) {
                    console.error('.mm导出失败:', error);
                    alert('.mm导出失败: ' + error.message);
                }
                exportModal.classList.remove('active');
            });
        }

        if (exportJSON) {
            exportJSON.addEventListener('click', async () => {
                const data = await sessionManager.exportAllData();
                this.downloadFile(
                    JSON.stringify(data, null, 2),
                    `mindmap_export_${new Date().toISOString().slice(0, 10)}.json`,
                    'application/json'
                );
                exportModal.classList.remove('active');
            });
        }

        if (exportMarkdown) {
            exportMarkdown.addEventListener('click', () => {
                const session = sessionManager.getCurrentSession();
                const markdown = this.mindmapRenderer.exportToMarkdown(session);
                this.downloadFile(markdown, 'mindmap.md', 'text/markdown');
                exportModal.classList.remove('active');
            });
        }

        if (importJSON && importFileInput) {
            importJSON.addEventListener('click', () => {
                importFileInput.click();
            });

            importFileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                try {
                    const text = await file.text();
                    const importData = JSON.parse(text);

                    if (!importData.sessions && !Array.isArray(importData)) {
                        alert('无效的备份文件格式');
                        return;
                    }

                    const sessionsData = importData.sessions || importData;
                    const merge = confirm('是否合并数据？点击"确定"合并（保留现有数据），点击"取消"替换所有数据');

                    const result = await sessionManager.importData(
                        { ...importData, sessions: sessionsData },
                        merge
                    );

                    alert(result.message || '导入成功');
                    this.loadCurrentSession();
                } catch (error) {
                    console.error('导入失败:', error);
                    alert('导入失败: ' + error.message);
                }

                importFileInput.value = '';
                exportModal.classList.remove('active');
            });
        }
    }

    handleSessionChange({ sessions, currentSessionId, currentSession }) {
        this.renderSessionList(sessions, currentSessionId);

        if (currentSession) {
            this.loadSession(currentSession);
        }
    }

    renderSessionList(sessions, currentSessionId) {
        const sessionList = document.getElementById('sessionList');
        sessionList.innerHTML = '';

        sessions.forEach(session => {
            const item = document.createElement('div');
            item.classList.add('session-item');
            if (session.id === currentSessionId) {
                item.classList.add('active');
            }

            const title = document.createElement('span');
            title.classList.add('session-item-title');
            title.textContent = session.title || session.name || '未命名会话';

            const date = document.createElement('span');
            date.classList.add('session-item-date');
            date.textContent = this.formatDate(session.updatedAt || session.updated_at);

            item.appendChild(title);
            item.appendChild(date);

            item.addEventListener('click', () => {
                sessionManager.switchSession(session.id);
            });

            sessionList.appendChild(item);
        });
    }

    loadCurrentSession() {
        const session = sessionManager.getCurrentSession();
        if (session) {
            this.loadSession(session);
        }
    }

    async loadSession(session) {
        const sessionChanged = !this.currentSession || this.currentSession.id !== session.id;
        this.currentSession = session;

        if (session.id) {
            this.mindmapRenderer.setSessionId(session.id);
            this.chatModule.setSessionId(session.id);
            this.chatModule.setActiveNodeId('root');
            this.activeNodeId = 'root';
        }

        if (sessionChanged) {
            this.chatModule.clear();

            if (session.id && !session.id.startsWith('session_')) {
                try {
                    const treeData = await api.getSessionTree(session.id);
                    this.mindmapRenderer.render(this.convertTreeData(treeData));
                } catch (e) {
                    this.mindmapRenderer.clear();
                }
            } else {
                this.mindmapRenderer.clear();
            }
        }
    }

    handleUserMessage(data) {
        // 用户消息已通过流式API发送到后端，无需额外处理
    }

    handleAIResponse(data) {
        const session = sessionManager.getCurrentSession();
        if (!session) return;

        api.getSessionTree(session.id).then(treeData => {
            this.mindmapRenderer.render(this.convertTreeData(treeData));
            if (data.nodeId) {
                this.activeNodeId = data.nodeId;
                this.chatModule.setActiveNodeId(data.nodeId);
            }
        }).catch(e => {
            console.error('重新加载思维导图失败:', e);
        });
    }

    handleError(data) {
        console.error('聊天错误:', data.message);
    }

    convertTreeData(treeData) {
        if (!treeData) return null;

        this.nodeConversationMap.clear();

        const convertNode = (node) => {
            if (node.user_message || node.ai_reply) {
                this.nodeConversationMap.set(node.id, {
                    userMessage: node.user_message || '',
                    aiReply: node.ai_reply || ''
                });
            }

            const result = {
                id: node.id,
                content: node.ai_reply
                    ? (node.ai_reply.length > 30 ? node.ai_reply.slice(0, 30) + '...' : node.ai_reply)
                    : (node.user_message
                        ? (node.user_message.length > 30 ? node.user_message.slice(0, 30) + '...' : node.user_message)
                        : '根节点'),
                fullContent: node.ai_reply || node.user_message || '',
                role: node.ai_reply ? 'assistant' : (node.user_message ? 'user' : null),
                timestamp: node.timestamp,
                children: []
            };

            if (node.branch_color) {
                result.branchColor = node.branch_color;
                result.isBranch = true;
                result.branch_name = node.user_message || '分支';
            }

            if (node.children && node.children.length > 0) {
                result.children = node.children.map(child => convertNode(child));
            }

            return result;
        };

        return { root: convertNode(treeData) };
    }

    formatDate(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;

        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;

        return date.toLocaleDateString('zh-CN', {
            month: 'short',
            day: 'numeric'
        });
    }

    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
});

export default App;
