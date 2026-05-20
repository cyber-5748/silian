const STORAGE_KEY = 'mindmap_ai_sessions';
const CURRENT_SESSION_KEY = 'mindmap_ai_current_session';

class SessionManager {
    constructor() {
        this.sessions = [];
        this.currentSessionId = null;
        this.listeners = new Set();
        this.autosaveTimer = null;
        this.autosaveDelay = 1000;
        this.pendingAutosave = null;
    }

    init() {
        this.loadFromStorage();
        if (this.sessions.length === 0) {
            this.createSession('新会话');
        } else {
            const savedCurrentId = localStorage.getItem(CURRENT_SESSION_KEY);
            this.currentSessionId = savedCurrentId && this.sessions.find(s => s.id === savedCurrentId)
                ? savedCurrentId
                : this.sessions[0].id;
        }
        this.notifyListeners();
    }

    async initFromBackend() {
        try {
            const apiModule = await import('./api.js');
            const api = apiModule.default;

            const backendData = await api.getSessions();
            const backendSessions = backendData.sessions || [];

            // 用后端会话作为基础
            const backendMap = new Map(backendSessions.map(s => [s.id, s]));
            const result = [];

            // 1. 加入所有后端会话
            for (const bs of backendSessions) {
                const localSession = this.sessions.find(s => s.id === bs.id);
                if (localSession) {
                    const backendTime = new Date(bs.updated_at || 0).getTime();
                    const localTime = new Date(localSession.updatedAt || 0).getTime();
                    result.push(backendTime >= localTime ? this.mapBackendSession(bs) : localSession);
                } else {
                    result.push(this.mapBackendSession(bs));
                }
            }

            // 2. 处理本地独有的会话(包括 session_xxx ID的)
            const backendIds = new Set(backendSessions.map(s => s.id));
            for (const localSession of this.sessions) {
                if (!backendIds.has(localSession.id)) {
                    // 本地会话不在后端,需要同步
                    try {
                        const backendSession = await api.createSession(localSession.title || '新会话');
                        if (backendSession && backendSession.id) {
                            const oldId = localSession.id;
                            const newId = backendSession.id;
                            localSession.id = newId;
                            localSession.createdAt = backendSession.created_at || localSession.createdAt;
                            localSession.updatedAt = backendSession.updated_at || localSession.updatedAt;
                            if (this.currentSessionId === oldId) {
                                this.currentSessionId = newId;
                            }
                            // 同步消息和思维导图数据
                            if (localSession.messages && localSession.messages.length > 0) {
                                try {
                                    await api.updateSession(newId, {
                                        title: localSession.title,
                                        messages: localSession.messages,
                                    });
                                } catch (e) {
                                    console.warn('同步会话数据到后端失败:', e);
                                }
                            }
                        }
                    } catch (e) {
                        console.warn('同步本地会话到后端失败:', e);
                    }
                    result.push(localSession);
                }
            }

            this.sessions = result;
            this.saveToStorage();

            // 3. 加载当前会话的完整数据
            if (this.currentSessionId) {
                const currentSession = this.getCurrentSession();
                if (currentSession && !currentSession.id.startsWith('session_')) {
                    try {
                        const fullSession = await api.getSession(currentSession.id);
                        if (fullSession) {
                            const idx = this.sessions.findIndex(s => s.id === currentSession.id);
                            if (idx !== -1) {
                                this.sessions[idx] = {
                                    ...this.sessions[idx],
                                    ...this.mapBackendSession(fullSession),
                                };
                                this.saveToStorage();
                            }
                        }
                    } catch (e) {
                        console.warn('加载后端完整会话数据失败:', e);
                    }
                }
            }

            this.notifyListeners();
        } catch (error) {
            console.warn('从后端加载会话失败，使用本地数据:', error);
        }
    }

    mapBackendSession(backendSession) {
        return {
            id: backendSession.id,
            title: backendSession.name || backendSession.title || '未命名会话',
            pinned: backendSession.pinned || false,
            createdAt: backendSession.created_at,
            updatedAt: backendSession.updated_at,
            messages: backendSession.messages || [],
            nodes: backendSession.nodes || [],
            conversation_tree: backendSession.conversation_tree || null,
        };
    }

    mergeSessions(backendSessions, localSessions) {
        const localMap = new Map(localSessions.map(s => [s.id, s]));
        const backendMap = new Map(backendSessions.map(s => [s.id, s]));
        const merged = [];

        for (const [id, backendSession] of backendMap) {
            const localSession = localMap.get(id);
            if (localSession) {
                const backendTime = new Date(backendSession.updated_at || 0).getTime();
                const localTime = new Date(localSession.updatedAt || 0).getTime();
                if (backendTime >= localTime) {
                    merged.push(this.mapBackendSession(backendSession));
                } else {
                    merged.push(localSession);
                }
            } else {
                merged.push(this.mapBackendSession(backendSession));
            }
        }

        for (const [id, localSession] of localMap) {
            if (!backendMap.has(id)) {
                merged.push(localSession);
            }
        }

        merged.sort((a, b) => {
            const timeA = new Date(a.updatedAt || a.created_at || 0).getTime();
            const timeB = new Date(b.updatedAt || b.updated_at || 0).getTime();
            return timeB - timeA;
        });

        return merged;
    }

    loadFromStorage() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            this.sessions = data ? JSON.parse(data) : [];
        } catch (error) {
            console.error('加载会话数据失败:', error);
            this.sessions = [];
        }
    }

    saveToStorage() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.sessions));
            if (this.currentSessionId) {
                localStorage.setItem(CURRENT_SESSION_KEY, this.currentSessionId);
            }
        } catch (error) {
            console.error('保存会话数据失败:', error);
        }
    }

    async createSession(title = '新会话') {
        let session = {
            id: this.generateId(),
            title,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: []
        };
        this.sessions.unshift(session);
        this.currentSessionId = session.id;
        this.saveToStorage();
        this.notifyListeners();

        try {
            const apiModule = await import('./api.js');
            const api = apiModule.default;
            const backendSession = await api.createSession(title);
            if (backendSession && backendSession.id) {
                const oldId = session.id;
                const newId = backendSession.id;
                session.id = newId;
                session.createdAt = backendSession.created_at || session.createdAt;
                session.updatedAt = backendSession.updated_at || session.updatedAt;
                if (this.currentSessionId === oldId) {
                    this.currentSessionId = newId;
                }
                this.saveToStorage();
                this.notifyListeners();
            }
        } catch (e) {
            console.warn('后端创建会话失败，使用本地会话:', e);
        }

        return session;
    }

    generateId() {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    getCurrentSession() {
        return this.sessions.find(s => s.id === this.currentSessionId) || null;
    }

    getSession(sessionId) {
        return this.sessions.find(s => s.id === sessionId) || null;
    }

    switchSession(sessionId) {
        const session = this.getSession(sessionId);
        if (session) {
            this.currentSessionId = sessionId;
            this.saveToStorage();
            this.notifyListeners();
            return session;
        }
        return null;
    }

    updateSession(sessionId, updates) {
        const session = this.getSession(sessionId);
        if (session) {
            Object.assign(session, updates, {
                updatedAt: new Date().toISOString()
            });
            this.saveToStorage();
            this.notifyListeners();
            this.autosaveToBackend(sessionId);
            return session;
        }
        return null;
    }

    updateSessionTitle(sessionId, title) {
        return this.updateSession(sessionId, { title });
    }

    addMessage(sessionId, message) {
        const session = this.getSession(sessionId);
        if (session) {
            session.messages.push({
                id: `msg_${Date.now()}`,
                role: message.role,
                content: message.content,
                timestamp: new Date().toISOString(),
                node_id: message.node_id || null
            });
            session.updatedAt = new Date().toISOString();
            if (session.messages.length === 1 && session.title === '新会话') {
                session.title = message.content.slice(0, 30) + (message.content.length > 30 ? '...' : '');
            }
            this.saveToStorage();
            this.notifyListeners();
            this.autosaveToBackend(sessionId);
        }
    }

    deleteSession(sessionId) {
        const index = this.sessions.findIndex(s => s.id === sessionId);
        if (index !== -1) {
            this.sessions.splice(index, 1);
            if (this.currentSessionId === sessionId) {
                this.currentSessionId = this.sessions.length > 0 ? this.sessions[0].id : null;
                if (!this.currentSessionId) {
                    this.createSession('新会话');
                }
            }
            this.saveToStorage();
            this.notifyListeners();

            if (!sessionId.startsWith('session_')) {
                import('./api.js').then(apiModule => {
                    apiModule.default.deleteSession(sessionId).catch(e => {
                        console.warn('后端删除会话失败:', e);
                    });
                });
            }

            return true;
        }
        return false;
    }

    async togglePin(sessionId) {
        const session = this.getSession(sessionId);
        if (!session) return false;

        try {
            const apiModule = await import('./api.js');
            const api = apiModule.default;
            const result = await api.pinSession(sessionId);
            session.pinned = result.pinned;
            this.saveToStorage();
            this.notifyListeners();
            return result.pinned;
        } catch (e) {
            console.warn('后端置顶操作失败:', e);
            session.pinned = !session.pinned;
            this.saveToStorage();
            this.notifyListeners();
            return session.pinned;
        }
    }

    async renameSession(sessionId, newName) {
        const session = this.getSession(sessionId);
        if (!session) return false;

        const oldName = session.title;
        session.title = newName;
        this.saveToStorage();
        this.notifyListeners();

        try {
            const apiModule = await import('./api.js');
            const api = apiModule.default;
            await api.renameSession(sessionId, newName);
        } catch (e) {
            console.warn('后端重命名失败:', e);
            session.title = oldName;
            this.saveToStorage();
            this.notifyListeners();
        }

        return true;
    }

    clearAllSessions() {
        this.sessions = [];
        this.currentSessionId = null;
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(CURRENT_SESSION_KEY);
        this.createSession('新会话');
    }

    getAllSessions() {
        return [...this.sessions];
    }

    autosaveToBackend(sessionId) {
        const session = this.getSession(sessionId);
        if (!session) return;

        if (sessionId.startsWith('session_')) {
            return;
        }

        this.pendingAutosave = {
            sessionId,
            data: {
                title: session.title,
                messages: session.messages,
            }
        };

        if (this.autosaveTimer) {
            clearTimeout(this.autosaveTimer);
        }

        this.autosaveTimer = setTimeout(async () => {
            if (this.pendingAutosave) {
                try {
                    const apiModule = await import('./api.js');
                    const api = apiModule.default;
                    await api.updateSession(
                        this.pendingAutosave.sessionId,
                        this.pendingAutosave.data
                    );
                    this.pendingAutosave = null;
                } catch (error) {
                    console.warn('自动保存到后端失败:', error);
                }
            }
        }, this.autosaveDelay);
    }

    async exportAllData() {
        return {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            sessions: this.sessions,
        };
    }

    async importData(importData, merge = true) {
        if (!importData || !importData.sessions) {
            throw new Error('无效的导入数据格式');
        }

        const sessionsToImport = importData.sessions;

        try {
            const apiModule = await import('./api.js');
            const api = apiModule.default;
            const result = await api.importSessions(sessionsToImport, merge);
            await this.initFromBackend();
            return result;
        } catch (error) {
            console.warn('后端导入失败，使用本地导入:', error);

            if (merge) {
                const existingIds = new Set(this.sessions.map(s => s.id));
                let imported = 0;
                let skipped = 0;
                for (const session of sessionsToImport) {
                    if (!session.id) continue;
                    if (existingIds.has(session.id)) {
                        skipped++;
                    } else {
                        this.sessions.push(session);
                        imported++;
                    }
                }
                this.saveToStorage();
                this.notifyListeners();
                return { imported, skipped, message: `本地导入完成: 新增 ${imported} 个, 跳过 ${skipped} 个` };
            } else {
                this.sessions = sessionsToImport;
                if (this.sessions.length > 0) {
                    this.currentSessionId = this.sessions[0].id;
                }
                this.saveToStorage();
                this.notifyListeners();
                return { imported: sessionsToImport.length, message: `本地导入完成: 替换为 ${sessionsToImport.length} 个会话` };
            }
        }
    }

    async createBackup() {
        try {
            const apiModule = await import('./api.js');
            const api = apiModule.default;
            return await api.createBackup();
        } catch (error) {
            console.warn('后端备份失败:', error);
            const data = this.exportAllData();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `mindmap_backup_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            return { success: true, message: '本地备份已下载' };
        }
    }

    subscribe(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    notifyListeners() {
        this.listeners.forEach(callback => {
            try {
                callback({
                    sessions: this.getAllSessions(),
                    currentSessionId: this.currentSessionId,
                    currentSession: this.getCurrentSession()
                });
            } catch (error) {
                console.error('会话监听器错误:', error);
            }
        });
    }
}

const sessionManager = new SessionManager();

export default sessionManager;
export { SessionManager };
