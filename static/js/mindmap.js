const BRANCH_COLORS = [
    '#6366f1',
    '#10b981',
    '#f59e0b',
    '#ef4444',
    '#8b5cf6',
    '#06b6d4',
    '#ec4899',
    '#84cc16'
];

const USER_COLOR = '#3b82f6';
const ASSISTANT_COLOR = '#10b981';

class MindmapRenderer {
    constructor(container) {
        this.container = container;
        this.canvas = container.querySelector('#mindmapCanvas');
        this.mindElixir = null;
        this.currentData = null;
        this.nodeMessages = new Map();
        this.colorIndex = 0;
        this.selectedNodeId = null;
        this.onNodeSelect = null;
        this.currentSessionId = null;
        this.branchColors = new Map();
        this.contextMenu = null;
        this.onBranchCreated = null;
        this.onBranchDeleted = null;
        
        this.init();
    }

    init() {
        this.initMindElixir();
        this.initNodeDetailModal();
        this.initContextMenu();
    }

    setSessionId(sessionId) {
        this.currentSessionId = sessionId;
    }

    initContextMenu() {
        this.contextMenu = document.createElement('div');
        this.contextMenu.className = 'context-menu';
        this.contextMenu.innerHTML = `
            <div class="context-menu-item" data-action="createBranch">
                <svg viewBox="0 0 24 24" width="16" height="16">
                    <path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                </svg>
                <span>从此处创建分支</span>
            </div>
            <div class="context-menu-item" data-action="deleteBranch">
                <svg viewBox="0 0 24 24" width="16" height="16">
                    <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
                <span>删除此分支</span>
            </div>
            <div class="context-menu-divider"></div>
            <div class="context-menu-item" data-action="viewDetails">
                <svg viewBox="0 0 24 24" width="16" height="16">
                    <path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                </svg>
                <span>查看详情</span>
            </div>
        `;
        document.body.appendChild(this.contextMenu);

        this.contextMenu.addEventListener('click', (e) => {
            const item = e.target.closest('.context-menu-item');
            if (item) {
                const action = item.dataset.action;
                this.handleContextMenuAction(action);
            }
        });

        document.addEventListener('click', (e) => {
            if (!this.contextMenu.contains(e.target)) {
                this.hideContextMenu();
            }
        });

        document.addEventListener('contextmenu', (e) => {
            const nodeEl = e.target.closest('.mind-elixir-node');
            if (nodeEl && this.canvas.contains(nodeEl)) {
                e.preventDefault();
                this.showContextMenu(e, nodeEl.dataset.nodeid);
            }
        });
    }

    showContextMenu(event, nodeId) {
        if (nodeId === 'root') {
            return;
        }

        this.contextMenuNodeId = nodeId;
        const nodeData = this.findNodeData(nodeId);
        const deleteItem = this.contextMenu.querySelector('[data-action="deleteBranch"]');
        
        if (nodeData && nodeData.isBranch) {
            deleteItem.style.display = 'flex';
        } else {
            deleteItem.style.display = 'none';
        }

        this.contextMenu.style.left = `${event.pageX}px`;
        this.contextMenu.style.top = `${event.pageY}px`;
        this.contextMenu.classList.add('visible');
    }

    hideContextMenu() {
        this.contextMenu.classList.remove('visible');
    }

    async handleContextMenuAction(action) {
        this.hideContextMenu();
        
        if (!this.contextMenuNodeId) return;
        
        const nodeId = this.contextMenuNodeId;
        const nodeData = this.findNodeData(nodeId);
        
        switch (action) {
            case 'createBranch':
                await this.handleCreateBranch(nodeId);
                break;
            case 'deleteBranch':
                if (nodeData && nodeData.isBranch) {
                    this.showDeleteBranchConfirm(nodeId, nodeData.branch_name || '未命名分支');
                }
                break;
            case 'viewDetails':
                const messageInfo = this.nodeMessages.get(nodeId);
                if (messageInfo) {
                    this.showNodeDetail(messageInfo);
                    this.highlightNode(nodeId);
                }
                break;
        }
    }

    async handleCreateBranch(parentNodeId) {
        const branchName = prompt('请输入分支名称:', `分支 ${this.branchColors.size + 1}`);
        if (branchName === null) return;
        
        if (!this.currentSessionId) {
            alert('请先选择一个会话');
            return;
        }

        try {
            const response = await fetch('/api/branches/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    session_id: this.currentSessionId,
                    parent_node_id: parentNodeId,
                    branch_name: branchName
                })
            });

            if (!response.ok) {
                throw new Error('创建分支失败');
            }

            const branch = await response.json();
            
            this.branchColors.set(branch.id, branch.branch_color);
            
            this.addBranchNodeToMap(branch, parentNodeId);
            
            if (this.onBranchCreated) {
                this.onBranchCreated(branch);
            }
            
            this.refresh();
            
        } catch (error) {
            console.error('创建分支失败:', error);
            alert('创建分支失败: ' + error.message);
        }
    }

    addBranchNodeToMap(branch, parentNodeId) {
        const parentNode = this.findNodeData(parentNodeId);
        if (parentNode) {
            if (!parentNode.children) {
                parentNode.children = [];
            }
            parentNode.children.push({
                id: branch.id,
                topic: branch.branch_name,
                isBranch: true,
                branchColor: branch.branch_color,
                children: []
            });
        }
    }

    showDeleteBranchConfirm(branchNodeId, branchName) {
        const confirmed = confirm(`确定要删除分支 "${branchName}" 吗？\n\n删除分支将同时删除该分支下的所有内容，此操作不可恢复。`);
        if (confirmed) {
            this.handleDeleteBranch(branchNodeId);
        }
    }

    async handleDeleteBranch(branchNodeId) {
        if (!this.currentSessionId) {
            alert('请先选择一个会话');
            return;
        }

        try {
            const response = await fetch('/api/branches/delete', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    session_id: this.currentSessionId,
                    branch_node_id: branchNodeId,
                    delete_children: true
                })
            });

            if (!response.ok) {
                throw new Error('删除分支失败');
            }

            this.branchColors.delete(branchNodeId);
            
            if (this.onBranchDeleted) {
                this.onBranchDeleted(branchNodeId);
            }
            
            this.refresh();
            
        } catch (error) {
            console.error('删除分支失败:', error);
            alert('删除分支失败: ' + error.message);
        }
    }

    setOnBranchCreated(callback) {
        this.onBranchCreated = callback;
    }

    setOnBranchDeleted(callback) {
        this.onBranchDeleted = callback;
    }

    initMindElixir() {
        const options = {
            el: this.canvas,
            direction: MindElixir.SIDE,
            locale: 'zh_CN',
            draggable: true,
            editable: false,
            contextMenu: false,
            toolBar: false,
            nodeMenu: false,
            keypress: false,
            overflowHidden: false,
            mainNodeVerticalGap: 30,
            mainNodeHorizontalGap: 100,
            subTreeVerticalGap: 15,
            subTreeHorizontalGap: 80,
            allowUndo: false,
            generateNewNodeData: this.generateNewNodeData.bind(this)
        };

        const initialData = {
            nodeData: {
                id: 'root',
                topic: '开始对话',
                root: true,
                children: []
            }
        };

        this.mindElixir = new MindElixir(options);
        this.mindElixir.init(initialData);

        this.mindElixir.bus.addListener('selectNode', this.handleNodeSelect.bind(this));
        this.mindElixir.bus.addListener('expandNode', this.handleNodeExpand.bind(this));

        this.applyCustomStyles();
    }

    generateNewNodeData() {
        return {
            id: `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            topic: '新节点',
            children: []
        };
    }

    initNodeDetailModal() {
        this.modal = this.container.querySelector('#nodeDetailModal');
        this.modalRole = this.container.querySelector('#nodeDetailRole');
        this.modalBody = this.container.querySelector('#nodeDetailBody');
        const closeBtn = this.container.querySelector('#closeNodeDetail');

        closeBtn.addEventListener('click', () => this.hideNodeDetail());
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.hideNodeDetail();
            }
        });
    }

    handleNodeSelect(nodeData) {
        if (nodeData && nodeData.id !== 'root') {
            const messageInfo = this.nodeMessages.get(nodeData.id);
            if (messageInfo) {
                this.showNodeDetail(messageInfo);
                this.highlightNode(nodeData.id);
            }
        }
    }

    handleNodeExpand(nodeData) {
        setTimeout(() => {
            this.applyCustomStyles();
            this.renderCustomNodeContent();
        }, 50);
    }

    showNodeDetail(messageInfo) {
        this.modalRole.textContent = messageInfo.role === 'user' ? '用户消息' : 'AI回复';
        this.modalRole.className = `node-detail-role ${messageInfo.role}`;
        this.modalBody.textContent = messageInfo.fullContent;
        this.modal.classList.add('active');
        
        if (this.onNodeSelect) {
            this.onNodeSelect(messageInfo);
        }
    }

    hideNodeDetail() {
        this.modal.classList.remove('active');
        this.clearNodeHighlight();
    }

    highlightNode(nodeId) {
        this.clearNodeHighlight();
        this.selectedNodeId = nodeId;
        const nodeEl = this.canvas.querySelector(`[data-nodeid="${nodeId}"]`);
        if (nodeEl) {
            nodeEl.classList.add('selected');
        }
    }

    clearNodeHighlight() {
        if (this.selectedNodeId) {
            const nodeEl = this.canvas.querySelector(`[data-nodeid="${this.selectedNodeId}"]`);
            if (nodeEl) {
                nodeEl.classList.remove('selected');
            }
            this.selectedNodeId = null;
        }
    }

    setOnNodeSelect(callback) {
        this.onNodeSelect = callback;
    }

    render(mindmapData) {
        if (!mindmapData || !mindmapData.root) {
            this.renderEmptyState();
            return;
        }

        this.currentData = mindmapData;
        this.nodeMessages.clear();
        this.colorIndex = 0;

        const elixirData = this.convertToElixirFormat(mindmapData.root);
        
        this.mindElixir.nodeData = elixirData;
        this.mindElixir.linkData = this.generateLinkData(elixirData);
        
        this.mindElixir.render();

        setTimeout(() => {
            this.applyCustomStyles();
            this.renderCustomNodeContent();
            this.mindElixir.center();
        }, 100);
    }

    convertToElixirFormat(node, depth = 0, parentColor = null) {
        const color = depth === 0 ? BRANCH_COLORS[0] : 
                      depth === 1 ? this.getNextColor() : parentColor;

        const isUserNode = node.role === 'user';
        const isAssistantNode = node.role === 'assistant';
        const isBranchNode = node.isBranch === true;
        
        let displayTopic = this.truncateText(node.content || node.topic || node.branch_name || '', 25);
        
        if (isBranchNode) {
            displayTopic = node.branch_name || node.topic || '分支';
            if (node.branchColor) {
                this.branchColors.set(node.id, node.branchColor);
            }
        }
        
        const elixirNode = {
            id: node.id,
            topic: displayTopic,
            root: depth === 0,
            style: this.getNodeStyle(depth, color, node.role, node),
            children: [],
            expanded: true,
            isBranch: isBranchNode,
            branchColor: node.branchColor || color,
            branchName: node.branch_name
        };

        if ((node.fullContent || node.role) && !isBranchNode) {
            this.nodeMessages.set(node.id, {
                fullContent: node.fullContent || node.content,
                role: node.role || 'assistant',
                summary: this.truncateText(node.content || '', 25),
                timestamp: node.timestamp || Date.now()
            });
        }

        if (node.children && node.children.length > 0) {
            elixirNode.children = node.children.map(child => 
                this.convertToElixirFormat(child, depth + 1, color)
            );
        }

        return elixirNode;
    }

    getNextColor() {
        const color = BRANCH_COLORS[this.colorIndex % BRANCH_COLORS.length];
        this.colorIndex++;
        return color;
    }

    getNodeStyle(depth, color, role = null, nodeData = null) {
        if (depth === 0) {
            return {
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: '#ffffff',
                fontSize: '16px',
                padding: '14px 24px',
                borderRadius: '16px',
                fontWeight: '600'
            };
        }

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        
        if (nodeData && nodeData.isBranch) {
            const branchColor = nodeData.branchColor || color;
            return {
                background: isDark ? '#1e293b' : '#ffffff',
                color: isDark ? '#f1f5f9' : '#1e293b',
                fontSize: '14px',
                padding: '12px 18px',
                borderRadius: '12px',
                borderLeft: `5px solid ${branchColor}`,
                boxShadow: `0 2px 8px ${branchColor}33`,
                fontWeight: '600'
            };
        }
        
        if (role === 'user') {
            return {
                background: isDark ? '#1e3a5f' : '#e0f2fe',
                color: isDark ? '#93c5fd' : '#1e40af',
                fontSize: depth === 1 ? '14px' : '13px',
                padding: depth === 1 ? '12px 18px' : '10px 14px',
                borderRadius: '12px',
                borderLeft: `4px solid ${USER_COLOR}`,
                boxShadow: '0 2px 8px rgba(59, 130, 246, 0.15)'
            };
        }
        
        if (role === 'assistant') {
            return {
                background: isDark ? '#134e4a' : '#d1fae5',
                color: isDark ? '#6ee7b7' : '#065f46',
                fontSize: depth === 1 ? '14px' : '13px',
                padding: depth === 1 ? '12px 18px' : '10px 14px',
                borderRadius: '12px',
                borderLeft: `4px solid ${ASSISTANT_COLOR}`,
                boxShadow: '0 2px 8px rgba(16, 185, 129, 0.15)'
            };
        }
        
        return {
            background: isDark ? '#1e293b' : '#ffffff',
            color: isDark ? '#f1f5f9' : '#1e293b',
            fontSize: depth === 1 ? '14px' : '13px',
            padding: depth === 1 ? '10px 16px' : '8px 12px',
            borderRadius: '8px',
            borderLeft: `4px solid ${color}`,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
        };
    }

    generateLinkData(nodeData) {
        const links = [];
        
        const traverse = (node) => {
            if (node.children && node.children.length > 0) {
                node.children.forEach(child => {
                    links.push({
                        from: node.id,
                        to: child.id
                    });
                    traverse(child);
                });
            }
        };
        
        traverse(nodeData);
        return links;
    }

    applyCustomStyles() {
        const nodes = this.canvas.querySelectorAll('.mind-elixir-node');
        
        nodes.forEach(node => {
            const nodeId = node.dataset.nodeid;
            const nodeData = this.findNodeData(nodeId);
            const messageInfo = this.nodeMessages.get(nodeId);
            
            if (nodeData) {
                this.styleNode(node, nodeData, messageInfo);
                this.attachNodeEvents(node, nodeId);
            }
        });
    }

    renderCustomNodeContent() {
        const nodes = this.canvas.querySelectorAll('.mind-elixir-node');
        
        nodes.forEach(nodeEl => {
            const nodeId = nodeEl.dataset.nodeid;
            const messageInfo = this.nodeMessages.get(nodeId);
            const nodeData = this.findNodeData(nodeId);
            
            if (!messageInfo || nodeData?.root) return;
            
            const topicEl = nodeEl.querySelector('.mind-elixir-topic');
            if (!topicEl) return;
            
            const existingContent = topicEl.querySelector('.node-custom-content');
            if (existingContent) return;
            
            topicEl.innerHTML = '';
            
            const contentWrapper = document.createElement('div');
            contentWrapper.className = 'node-custom-content';
            
            const header = document.createElement('div');
            header.className = 'node-header';
            
            const roleIcon = document.createElement('span');
            roleIcon.className = `node-role-icon ${messageInfo.role}`;
            roleIcon.innerHTML = messageInfo.role === 'user' 
                ? '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>'
                : '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>';
            
            const roleLabel = document.createElement('span');
            roleLabel.className = 'node-role-label';
            roleLabel.textContent = messageInfo.role === 'user' ? '用户' : 'AI';
            
            header.appendChild(roleIcon);
            header.appendChild(roleLabel);
            
            const summary = document.createElement('div');
            summary.className = 'node-summary';
            summary.textContent = messageInfo.summary;
            
            contentWrapper.appendChild(header);
            contentWrapper.appendChild(summary);
            
            topicEl.appendChild(contentWrapper);
        });
    }

    findNodeData(nodeId) {
        if (!this.mindElixir.nodeData) return null;
        
        const traverse = (node) => {
            if (node.id === nodeId) return node;
            if (node.children) {
                for (const child of node.children) {
                    const found = traverse(child);
                    if (found) return found;
                }
            }
            return null;
        };
        
        return traverse(this.mindElixir.nodeData);
    }

    styleNode(nodeElement, nodeData, messageInfo) {
        const isRoot = nodeData.root;
        const depth = this.getNodeDepth(nodeData.id);
        const isBranch = nodeData.isBranch;
        
        nodeElement.classList.add('custom-node');
        if (isRoot) {
            nodeElement.classList.add('root-node');
        } else if (isBranch) {
            nodeElement.classList.add('branch-node');
            if (nodeData.branchColor) {
                nodeElement.style.setProperty('--branch-color', nodeData.branchColor);
            }
        } else if (messageInfo?.role === 'user') {
            nodeElement.classList.add('user-node');
        } else if (messageInfo?.role === 'assistant') {
            nodeElement.classList.add('assistant-node');
        } else if (depth === 1) {
            nodeElement.classList.add('branch-node');
        } else {
            nodeElement.classList.add('sub-node');
        }

        const topicEl = nodeElement.querySelector('.mind-elixir-topic');
        if (topicEl) {
            topicEl.classList.add('node-topic');
        }
    }

    getNodeDepth(nodeId) {
        if (!this.mindElixir.nodeData) return 0;
        
        const traverse = (node, depth) => {
            if (node.id === nodeId) return depth;
            if (node.children) {
                for (const child of node.children) {
                    const found = traverse(child, depth + 1);
                    if (found !== -1) return found;
                }
            }
            return -1;
        };
        
        return traverse(this.mindElixir.nodeData, 0);
    }

    attachNodeEvents(nodeElement, nodeId) {
        const expander = nodeElement.querySelector('.mind-elixir-expander');
        
        if (expander) {
            expander.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleNodeExpand(nodeId);
            });
        }

        nodeElement.addEventListener('click', (e) => {
            if (e.target.closest('.mind-elixir-expander')) return;
            e.stopPropagation();
            
            const messageInfo = this.nodeMessages.get(nodeId);
            if (messageInfo) {
                this.showNodeDetail(messageInfo);
                this.highlightNode(nodeId);
            }
        });

        nodeElement.addEventListener('mouseenter', () => {
            if (!nodeElement.classList.contains('selected')) {
                nodeElement.style.transform = 'translateY(-2px)';
                nodeElement.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
            }
        });

        nodeElement.addEventListener('mouseleave', () => {
            if (!nodeElement.classList.contains('selected')) {
                nodeElement.style.transform = '';
                nodeElement.style.boxShadow = '';
            }
        });
    }

    toggleNodeExpand(nodeId) {
        const nodeData = this.findNodeData(nodeId);
        if (nodeData && nodeData.children && nodeData.children.length > 0) {
            nodeData.expanded = !nodeData.expanded;
            this.mindElixir.render();
            setTimeout(() => {
                this.applyCustomStyles();
                this.renderCustomNodeContent();
            }, 50);
        }
    }

    renderEmptyState() {
        this.nodeMessages.clear();
        
        const emptyData = {
            nodeData: {
                id: 'root',
                topic: '开始对话',
                root: true,
                children: []
            }
        };

        this.mindElixir.nodeData = emptyData.nodeData;
        this.mindElixir.linkData = [];
        this.mindElixir.render();

        setTimeout(() => {
            this.applyCustomStyles();
            this.renderCustomNodeContent();
        }, 100);
    }

    truncateText(text, maxLength) {
        if (!text) return '';
        if (text.length <= maxLength) return text;
        return text.slice(0, maxLength) + '...';
    }

    zoomIn() {
        if (this.mindElixir) {
            this.mindElixir.scale = Math.min(2, this.mindElixir.scale * 1.2);
            this.mindElixir.render();
        }
    }

    zoomOut() {
        if (this.mindElixir) {
            this.mindElixir.scale = Math.max(0.3, this.mindElixir.scale / 1.2);
            this.mindElixir.render();
        }
    }

    resetView() {
        if (this.mindElixir) {
            this.mindElixir.scale = 1;
            this.mindElixir.center();
        }
    }

    refresh() {
        if (this.currentData) {
            this.render(this.currentData);
        }
    }

    exportToJSON() {
        if (!this.mindElixir || !this.mindElixir.nodeData) {
            return JSON.stringify({}, null, 2);
        }

        const data = {
            mindmap: this.mindElixir.nodeData,
            messages: Object.fromEntries(this.nodeMessages)
        };
        
        return JSON.stringify(data, null, 2);
    }

    exportToMarkdown(session) {
        let markdown = `# ${session?.title || '思维导图'}\n\n`;
        
        const traverseNode = (node, depth = 0) => {
            const indent = '  '.repeat(depth);
            const messageInfo = this.nodeMessages.get(node.id);
            const prefix = messageInfo?.role === 'user' ? '👤 ' : 
                          messageInfo?.role === 'assistant' ? '🤖 ' : '';
            markdown += `${indent}- ${prefix}${node.topic || node.content}\n`;
            if (node.children) {
                node.children.forEach(child => traverseNode(child, depth + 1));
            }
        };
        
        if (this.mindElixir && this.mindElixir.nodeData) {
            traverseNode(this.mindElixir.nodeData);
        }
        
        return markdown;
    }

    exportToPNG() {
        return new Promise((resolve, reject) => {
            if (!this.canvas) {
                reject(new Error('画布不存在'));
                return;
            }
            
            const svgElement = this.canvas.querySelector('svg');
            if (!svgElement) {
                reject(new Error('SVG元素不存在'));
                return;
            }

            try {
                const svgData = new XMLSerializer().serializeToString(svgElement);
                const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
                const url = URL.createObjectURL(svgBlob);
                
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width * 2;
                    canvas.height = img.height * 2;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    
                    canvas.toBlob((blob) => {
                        URL.revokeObjectURL(url);
                        resolve(blob);
                    }, 'image/png');
                };
                img.onerror = () => {
                    URL.revokeObjectURL(url);
                    reject(new Error('图片加载失败'));
                };
                img.src = url;
            } catch (error) {
                reject(error);
            }
        });
    }

    clear() {
        this.nodeMessages.clear();
        this.renderEmptyState();
    }

    destroy() {
        if (this.mindElixir) {
            this.mindElixir = null;
        }
        this.nodeMessages.clear();
    }
}

export default MindmapRenderer;
