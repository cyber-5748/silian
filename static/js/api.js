const API_BASE_URL = '/api';

class APIModule {
    constructor() {
        this.baseUrl = API_BASE_URL;
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        };

        if (options.body && typeof options.body === 'object') {
            config.body = JSON.stringify(options.body);
        }

        try {
            const response = await fetch(url, config);
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: '请求失败' }));
                throw new Error(error.message || error.detail || `HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('API请求错误:', error);
            throw error;
        }
    }

    async sendMessage(content, sessionId, parentNodeId = 'root', options = {}) {
        return this.request('/chat/send', {
            method: 'POST',
            body: {
                content,
                session_id: sessionId,
                parent_node_id: parentNodeId,
                stream: false,
                ...options
            }
        });
    }

    async *streamMessage(content, sessionId, parentNodeId = 'root', options = {}) {
        const url = `${this.baseUrl}/chat/send`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content,
                session_id: sessionId,
                parent_node_id: parentNodeId,
                stream: true,
                ...options
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: '请求失败' }));
            throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (!data) continue;
                    
                    try {
                        const parsed = JSON.parse(data);
                        yield parsed;
                    } catch (e) {
                        console.warn('解析SSE数据失败:', data, e);
                    }
                }
            }
        }

        if (buffer.startsWith('data: ')) {
            const data = buffer.slice(6).trim();
            if (data) {
                try {
                    const parsed = JSON.parse(data);
                    yield parsed;
                } catch (e) {
                    console.warn('解析SSE数据失败:', buffer, e);
                }
            }
        }
    }

    async getChatHistory(sessionId, limit = 50, offset = 0) {
        return this.request(`/chat/history/${sessionId}?limit=${limit}&offset=${offset}`);
    }

    async buildContext(sessionId, options = {}) {
        const params = new URLSearchParams();
        params.append('session_id', sessionId);
        if (options.nodeId) params.append('node_id', options.nodeId);
        if (options.maxTokens) params.append('max_tokens', options.maxTokens);
        if (options.compressionStrategy) params.append('compression_strategy', options.compressionStrategy);

        return this.request(`/chat/context/build?${params.toString()}`, {
            method: 'POST'
        });
    }

    async getContextStats(sessionId) {
        return this.request(`/chat/context/stats/${sessionId}`);
    }

    async regenerateResponse(sessionId, nodeId, options = {}) {
        const params = new URLSearchParams();
        if (options.modelId) params.append('model_id', options.modelId);
        if (options.temperature !== undefined) params.append('temperature', options.temperature);
        if (options.maxTokens) params.append('max_tokens', options.maxTokens);
        params.append('stream', options.stream !== false ? 'true' : 'false');

        return this.request(`/chat/regenerate/${sessionId}/${nodeId}?${params.toString()}`, {
            method: 'POST'
        });
    }

    async *regenerateStream(sessionId, nodeId, options = {}) {
        const params = new URLSearchParams();
        if (options.modelId) params.append('model_id', options.modelId);
        if (options.temperature !== undefined) params.append('temperature', options.temperature);
        if (options.maxTokens) params.append('max_tokens', options.maxTokens);
        params.append('stream', 'true');

        const url = `${this.baseUrl}/chat/regenerate/${sessionId}/${nodeId}?${params.toString()}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: '请求失败' }));
            throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (!data) continue;
                    
                    try {
                        const parsed = JSON.parse(data);
                        yield parsed;
                    } catch (e) {
                        console.warn('解析SSE数据失败:', data, e);
                    }
                }
            }
        }
    }

    async getSessions() {
        return this.request('/sessions');
    }

    async getSession(sessionId) {
        return this.request(`/sessions/${sessionId}`);
    }

    async createSession(title = '新会话') {
        return this.request('/sessions', {
            method: 'POST',
            body: { title }
        });
    }

    async updateSession(sessionId, data) {
        return this.request(`/sessions/${sessionId}`, {
            method: 'PUT',
            body: data
        });
    }

    async deleteSession(sessionId) {
        return this.request(`/sessions/${sessionId}`, {
            method: 'DELETE'
        });
    }

    async getMindmap(sessionId) {
        return this.request(`/sessions/${sessionId}/mindmap`);
    }

    async getSessionTree(sessionId) {
        return this.request(`/sessions/${sessionId}/tree`);
    }

    async updateMindmap(sessionId, mindmapData) {
        return this.request(`/sessions/${sessionId}/mindmap`, {
            method: 'PUT',
            body: mindmapData
        });
    }

    async exportMindmap(sessionId, format = 'json') {
        return this.request(`/sessions/${sessionId}/export?format=${format}`);
    }

    async createBranch(sessionId, parentNodeId, branchName = null) {
        return this.request('/branches/create', {
            method: 'POST',
            body: {
                session_id: sessionId,
                parent_node_id: parentNodeId,
                branch_name: branchName
            }
        });
    }

    async deleteBranch(sessionId, branchNodeId, deleteChildren = true) {
        return this.request('/branches/delete', {
            method: 'DELETE',
            body: {
                session_id: sessionId,
                branch_node_id: branchNodeId,
                delete_children: deleteChildren
            }
        });
    }

    async getBranches(sessionId) {
        return this.request(`/branches/list/${sessionId}`);
    }

    async updateBranch(sessionId, branchNodeId, updates) {
        return this.request('/branches/update', {
            method: 'PUT',
            body: {
                session_id: sessionId,
                branch_node_id: branchNodeId,
                ...updates
            }
        });
    }

    async getBranchTree(sessionId, branchNodeId) {
        return this.request(`/branches/tree/${sessionId}/${branchNodeId}`);
    }

    async getBranchColors() {
        return this.request('/branches/colors');
    }

    async getAIModels() {
        return this.request('/ai/models');
    }

    async autosaveSession(sessionId, data) {
        return this.request(`/sessions/${sessionId}/autosave`, {
            method: 'POST',
            body: data
        });
    }

    async importSessions(sessions, merge = true) {
        return this.request('/sessions/import', {
            method: 'POST',
            body: { sessions, merge }
        });
    }

    async createBackup() {
        return this.request('/sessions/backup', {
            method: 'POST'
        });
    }

    async exportPDF(sessionId) {
        const url = `${this.baseUrl}/sessions/${sessionId}/export/pdf`;
        const response = await fetch(url);
        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: 'PDF导出失败' }));
            throw new Error(error.message || error.detail || 'PDF导出失败');
        }
        const blob = await response.blob();
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = 'export.pdf';
        if (contentDisposition) {
            const match = contentDisposition.match(/filename\*=UTF-8''(.+)/);
            if (match) {
                filename = decodeURIComponent(match[1]);
            } else {
                const simpleMatch = contentDisposition.match(/filename="?(.+?)"?$/);
                if (simpleMatch) {
                    filename = simpleMatch[1];
                }
            }
        }
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(downloadUrl);
        return { success: true, filename };
    }

    async exportMM(sessionId) {
        const url = `${this.baseUrl}/sessions/${sessionId}/export/mm`;
        const response = await fetch(url);
        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: 'MM导出失败' }));
            throw new Error(error.message || error.detail || 'MM导出失败');
        }
        const blob = await response.blob();
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = 'export.mm';
        if (contentDisposition) {
            const match = contentDisposition.match(/filename\*=UTF-8''(.+)/);
            if (match) {
                filename = decodeURIComponent(match[1]);
            } else {
                const simpleMatch = contentDisposition.match(/filename="?(.+?)"?$/);
                if (simpleMatch) {
                    filename = simpleMatch[1];
                }
            }
        }
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(downloadUrl);
        return { success: true, filename };
    }
}

const api = new APIModule();

export default api;
export { APIModule };
