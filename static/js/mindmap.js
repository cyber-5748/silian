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

const NODE_WIDTH = 240;
const NODE_MIN_HEIGHT = 60;
const NODE_MAX_HEIGHT = 80;
const LEVEL_HEIGHT = 100;
const NODE_GAP = 40;
const NODE_RADIUS = 12;
const ROOT_RADIUS = 16;

class MindmapRenderer {
    constructor(container) {
        this.container = container;
        this.canvas = container.querySelector('#mindmapCanvas');
        this.currentData = null;
        this.selectedNodeId = null;
        this.onNodeSelect = null;
        this.currentSessionId = null;
        this.contextMenu = null;
        this.onBranchCreated = null;
        this.onBranchDeleted = null;

        // SVG state
        this.svg = null;
        this.mainGroup = null;
        this.scale = 1;
        this.panX = 0;
        this.panY = 0;
        this.isPanning = false;
        this.panStartX = 0;
        this.panStartY = 0;
        this.panStartPanX = 0;
        this.panStartPanY = 0;

        // Layout data
        this.nodePositions = new Map();
        this.nodeDataMap = new Map();
        this.colorIndex = 0;
        this.rootId = 'root';

        this.init();
    }

    init() {
        this.createSVG();
        this.initNodeDetailModal();
        this.initContextMenu();
        this.initPanAndZoom();
    }

    setSessionId(sessionId) {
        this.currentSessionId = sessionId;
    }

    // ==================== SVG Creation ====================

    createSVG() {
        const svgNS = 'http://www.w3.org/2000/svg';
        this.svg = document.createElementNS(svgNS, 'svg');
        this.svg.setAttribute('width', '100%');
        this.svg.setAttribute('height', '100%');
        this.svg.style.overflow = 'visible';

        // Defs for gradients, filters, markers
        const defs = document.createElementNS(svgNS, 'defs');

        // Root node gradient
        const rootGradient = document.createElementNS(svgNS, 'linearGradient');
        rootGradient.setAttribute('id', 'rootGradient');
        rootGradient.setAttribute('x1', '0%');
        rootGradient.setAttribute('y1', '0%');
        rootGradient.setAttribute('x2', '100%');
        rootGradient.setAttribute('y2', '100%');
        const stop1 = document.createElementNS(svgNS, 'stop');
        stop1.setAttribute('offset', '0%');
        stop1.setAttribute('stop-color', '#6366f1');
        const stop2 = document.createElementNS(svgNS, 'stop');
        stop2.setAttribute('offset', '100%');
        stop2.setAttribute('stop-color', '#8b5cf6');
        rootGradient.appendChild(stop1);
        rootGradient.appendChild(stop2);
        defs.appendChild(rootGradient);

        // Shadow filter
        const shadowFilter = document.createElementNS(svgNS, 'filter');
        shadowFilter.setAttribute('id', 'nodeShadow');
        shadowFilter.setAttribute('x', '-10%');
        shadowFilter.setAttribute('y', '-10%');
        shadowFilter.setAttribute('width', '130%');
        shadowFilter.setAttribute('height', '140%');
        const feOffset = document.createElementNS(svgNS, 'feOffset');
        feOffset.setAttribute('result', 'offOut');
        feOffset.setAttribute('in', 'SourceAlpha');
        feOffset.setAttribute('dx', '0');
        feOffset.setAttribute('dy', '2');
        const feGaussian = document.createElementNS(svgNS, 'feGaussianBlur');
        feGaussian.setAttribute('result', 'blurOut');
        feGaussian.setAttribute('in', 'offOut');
        feGaussian.setAttribute('stdDeviation', '3');
        const feBlend = document.createElementNS(svgNS, 'feBlend');
        feBlend.setAttribute('in', 'SourceGraphic');
        feBlend.setAttribute('in2', 'blurOut');
        feBlend.setAttribute('mode', 'normal');
        shadowFilter.appendChild(feOffset);
        shadowFilter.appendChild(feGaussian);
        shadowFilter.appendChild(feBlend);
        defs.appendChild(shadowFilter);

        // Selected node shadow
        const selectedShadow = document.createElementNS(svgNS, 'filter');
        selectedShadow.setAttribute('id', 'selectedShadow');
        selectedShadow.setAttribute('x', '-15%');
        selectedShadow.setAttribute('y', '-15%');
        selectedShadow.setAttribute('width', '140%');
        selectedShadow.setAttribute('height', '150%');
        const feOffset2 = document.createElementNS(svgNS, 'feOffset');
        feOffset2.setAttribute('result', 'offOut');
        feOffset2.setAttribute('in', 'SourceAlpha');
        feOffset2.setAttribute('dx', '0');
        feOffset2.setAttribute('dy', '3');
        const feGaussian2 = document.createElementNS(svgNS, 'feGaussianBlur');
        feGaussian2.setAttribute('result', 'blurOut');
        feGaussian2.setAttribute('in', 'offOut');
        feGaussian2.setAttribute('stdDeviation', '5');
        const feBlend2 = document.createElementNS(svgNS, 'feBlend');
        feBlend2.setAttribute('in', 'SourceGraphic');
        feBlend2.setAttribute('in2', 'blurOut');
        feBlend2.setAttribute('mode', 'normal');
        selectedShadow.appendChild(feOffset2);
        selectedShadow.appendChild(feGaussian2);
        selectedShadow.appendChild(feBlend2);
        defs.appendChild(selectedShadow);

        this.svg.appendChild(defs);

        // Main group for transform
        this.mainGroup = document.createElementNS(svgNS, 'g');
        this.mainGroup.setAttribute('class', 'flowchart-main-group');
        this.svg.appendChild(this.mainGroup);

        // Clear existing canvas content and add SVG
        this.canvas.innerHTML = '';
        this.canvas.appendChild(this.svg);
    }

    // ==================== Context Menu ====================

    initContextMenu() {
        this.contextMenu = document.createElement('div');
        this.contextMenu.className = 'context-menu';
        this.contextMenu.innerHTML = `
            <div class="context-menu-item" data-action="createBranch">
                <svg viewBox="0 0 24 24" width="16" height="16">
                    <path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                </svg>
                <span>从此处分叉对话</span>
            </div>
            <div class="context-menu-item" data-action="viewDetails">
                <svg viewBox="0 0 24 24" width="16" height="16">
                    <path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                </svg>
                <span>查看详情</span>
            </div>
            <div class="context-menu-divider"></div>
            <div class="context-menu-item" data-action="deleteBranch">
                <svg viewBox="0 0 24 24" width="16" height="16">
                    <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
                <span>删除此分支</span>
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
    }

    showContextMenu(event, nodeId) {
        if (nodeId === this.rootId) return;

        this.contextMenuNodeId = nodeId;
        const nodeData = this.nodeDataMap.get(nodeId);
        const deleteItem = this.contextMenu.querySelector('[data-action="deleteBranch"]');

        // Show delete option for non-root nodes
        if (deleteItem) {
            deleteItem.style.display = 'flex';
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

        switch (action) {
            case 'createBranch':
                await this.handleCreateBranch(nodeId);
                break;
            case 'deleteBranch':
                this.showDeleteBranchConfirm(nodeId);
                break;
            case 'viewDetails':
                const nodeData = this.nodeDataMap.get(nodeId);
                if (nodeData) {
                    this.showNodeDetail({
                        nodeId: nodeData.id,
                        fullContent: nodeData.userMessage || nodeData.aiReply || '',
                        role: nodeData.userMessage ? 'user' : 'assistant',
                        userMessage: nodeData.userMessage,
                        aiReply: nodeData.aiReply
                    });
                    this.highlightNode(nodeId);
                }
                break;
        }
    }

    handleCreateBranch(parentNodeId) {
        // 分叉=选中该节点并聚焦聊天输入框,用户发送消息后自动形成分支
        this.highlightNode(parentNodeId);
        this.selectedNodeId = parentNodeId;
        if (this.onNodeSelect) {
            const nodeData = this.findNodeData(parentNodeId);
            this.onNodeSelect({
                nodeId: parentNodeId,
                userMessage: nodeData?.userMessage || nodeData?.user_message || '',
                aiReply: nodeData?.aiReply || nodeData?.ai_reply || '',
                parentId: nodeData?.parentId || nodeData?.parent_id || null,
                branchColor: nodeData?.branchColor || nodeData?.branch_color || ''
            });
        }
        // 聚焦聊天输入框
        const chatInput = document.getElementById('chatInput');
        if (chatInput) chatInput.focus();
    }

    showDeleteBranchConfirm(branchNodeId) {
        const nodeData = this.nodeDataMap.get(branchNodeId);
        const name = nodeData ? (nodeData.userMessage || '未命名节点').slice(0, 20) : '未命名分支';
        const confirmed = confirm(`确定要删除节点 "${name}" 吗？\n\n删除将同时删除该节点下的所有子节点，此操作不可恢复。`);
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
            const response = await fetch(`/api/sessions/${this.currentSessionId}/nodes/${branchNodeId}?cascade=true`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) throw new Error('删除节点失败');

            if (this.onBranchDeleted) {
                this.onBranchDeleted(branchNodeId);
            }
            this.refresh();
        } catch (error) {
            console.error('删除节点失败:', error);
            alert('删除节点失败: ' + error.message);
        }
    }

    setOnBranchCreated(callback) {
        this.onBranchCreated = callback;
    }

    setOnBranchDeleted(callback) {
        this.onBranchDeleted = callback;
    }

    // ==================== Node Detail Modal ====================

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

    showNodeDetail(messageInfo) {
        if (messageInfo.userMessage && messageInfo.aiReply) {
            // Show both user and AI messages
            this.modalRole.textContent = '对话详情';
            this.modalRole.className = 'node-detail-role';
            this.modalBody.innerHTML = `
                <div style="margin-bottom: 12px;">
                    <div style="font-size: 12px; font-weight: 600; color: #3b82f6; margin-bottom: 4px;">👤 用户提问</div>
                    <div style="white-space: pre-wrap; word-wrap: break-word;">${this.escapeHtml(messageInfo.userMessage)}</div>
                </div>
                <div style="border-top: 1px solid var(--border-color); padding-top: 12px;">
                    <div style="font-size: 12px; font-weight: 600; color: #10b981; margin-bottom: 4px;">🤖 AI回复</div>
                    <div style="white-space: pre-wrap; word-wrap: break-word;">${this.escapeHtml(messageInfo.aiReply)}</div>
                </div>
            `;
        } else {
            this.modalRole.textContent = messageInfo.role === 'user' ? '用户消息' : 'AI回复';
            this.modalRole.className = `node-detail-role ${messageInfo.role}`;
            this.modalBody.textContent = messageInfo.fullContent || '';
        }
        this.modal.classList.add('active');

        if (this.onNodeSelect) {
            this.onNodeSelect(messageInfo);
        }
    }

    hideNodeDetail() {
        this.modal.classList.remove('active');
        this.clearNodeHighlight();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ==================== Pan and Zoom ====================

    initPanAndZoom() {
        // Mouse wheel zoom
        this.svg.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const newScale = Math.max(0.3, Math.min(2, this.scale * delta));

            // Zoom towards mouse position
            const rect = this.svg.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const scaleChange = newScale / this.scale;
            this.panX = mouseX - scaleChange * (mouseX - this.panX);
            this.panY = mouseY - scaleChange * (mouseY - this.panY);
            this.scale = newScale;

            this.applyTransform();
        });

        // Pan with mouse drag on blank area
        this.svg.addEventListener('mousedown', (e) => {
            if (e.button === 0 && !e.target.closest('.flowchart-node-group')) {
                this.isPanning = true;
                this.panStartX = e.clientX;
                this.panStartY = e.clientY;
                this.panStartPanX = this.panX;
                this.panStartPanY = this.panY;
                this.svg.style.cursor = 'grabbing';
                e.preventDefault();
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (this.isPanning) {
                this.panX = this.panStartPanX + (e.clientX - this.panStartX);
                this.panY = this.panStartPanY + (e.clientY - this.panStartY);
                this.applyTransform();
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.isPanning) {
                this.isPanning = false;
                this.svg.style.cursor = '';
            }
        });

        // Right-click context menu on nodes
        this.svg.addEventListener('contextmenu', (e) => {
            const nodeGroup = e.target.closest('.flowchart-node-group');
            if (nodeGroup) {
                e.preventDefault();
                const nodeId = nodeGroup.dataset.nodeid;
                this.showContextMenu(e, nodeId);
            }
        });
    }

    applyTransform() {
        this.mainGroup.setAttribute('transform',
            `translate(${this.panX}, ${this.panY}) scale(${this.scale})`
        );
    }

    zoomIn() {
        this.scale = Math.min(2, this.scale * 1.2);
        this.applyTransform();
    }

    zoomOut() {
        this.scale = Math.max(0.3, this.scale / 1.2);
        this.applyTransform();
    }

    resetView() {
        this.scale = 1;
        this.centerView();
    }

    centerView() {
        if (this.nodePositions.size === 0) {
            this.panX = 0;
            this.panY = 0;
            this.applyTransform();
            return;
        }

        const rect = this.svg.getBoundingClientRect();
        const svgCenterX = rect.width / 2;
        const svgCenterY = 40;

        // Find the root node position
        const rootPos = this.nodePositions.get(this.rootId || 'root');
        if (rootPos) {
            this.panX = svgCenterX - rootPos.x * this.scale;
            this.panY = svgCenterY;
        }

        this.applyTransform();
    }

    // ==================== Data Conversion ====================

    convertTreeData(treeData) {
        this.nodeDataMap.clear();
        this.colorIndex = 0;

        // Handle both old format (treeData.root) and new format (treeData is the root)
        let root = treeData;
        if (treeData && treeData.root) {
            root = treeData.root;
        }

        if (!root) return null;

        // Determine root node: either id === 'root' or the top-level node
        this.rootId = root.id;
        this.processNode(root, 0, null);
        return root;
    }

    processNode(node, depth, parentColor) {
        if (!node) return;

        // Support both backend format (user_message, ai_reply, branch_color)
        // and app.js converted format (userMessage, aiReply, branchColor)
        const color = node.branch_color || node.branchColor || parentColor || BRANCH_COLORS[0];

        // Determine node type and content
        const isRoot = node.id === this.rootId;
        const userMessage = node.user_message || node.userMessage || node.content || '';
        const aiReply = node.ai_reply || node.aiReply || '';
        const branchColor = node.branch_color || node.branchColor || color;

        const processedNode = {
            id: node.id,
            parentId: node.parent_id || (isRoot ? null : 'root'),
            userMessage: userMessage,
            aiReply: aiReply,
            branchColor: branchColor,
            timestamp: node.timestamp || '',
            isRoot: isRoot,
            depth: depth,
            children: []
        };

        this.nodeDataMap.set(node.id, processedNode);

        if (node.children && node.children.length > 0) {
            let childColor = branchColor;
            node.children.forEach((child, index) => {
                if (index > 0) {
                    // Branch: assign new color for siblings after the first
                    childColor = BRANCH_COLORS[this.colorIndex % BRANCH_COLORS.length];
                    this.colorIndex++;
                } else {
                    childColor = child.branch_color || child.branchColor || branchColor;
                }
                this.processNode(child, depth + 1, childColor);
                processedNode.children.push(child.id);
            });
        }
    }

    // ==================== Layout Algorithm ====================

    calculateLayout() {
        this.nodePositions.clear();
        const root = this.nodeDataMap.get(this.rootId || 'root');
        if (!root) return;

        // Calculate subtree widths bottom-up
        this.calculateSubtreeWidths(root);

        // Layout top-down
        const startX = 0;
        const startY = 0;
        this.layoutNode(root, startX, startY);
    }

    calculateSubtreeWidths(node) {
        if (!node.children || node.children.length === 0) {
            node.subtreeWidth = NODE_WIDTH;
            return NODE_WIDTH;
        }

        let totalWidth = 0;
        node.children.forEach((childId, index) => {
            const child = this.nodeDataMap.get(childId);
            if (child) {
                const childWidth = this.calculateSubtreeWidths(child);
                totalWidth += childWidth;
                if (index > 0) {
                    totalWidth += NODE_GAP;
                }
            }
        });

        node.subtreeWidth = Math.max(NODE_WIDTH, totalWidth);
        return node.subtreeWidth;
    }

    layoutNode(node, x, y) {
        const nodeHeight = this.getNodeHeight(node);
        this.nodePositions.set(node.id, { x, y, width: NODE_WIDTH, height: nodeHeight });

        if (!node.children || node.children.length === 0) return;

        const totalChildWidth = node.children.reduce((sum, childId, index) => {
            const child = this.nodeDataMap.get(childId);
            return sum + (child ? child.subtreeWidth : NODE_WIDTH) + (index > 0 ? NODE_GAP : 0);
        }, 0);

        let currentX = x - totalChildWidth / 2;

        node.children.forEach((childId, index) => {
            const child = this.nodeDataMap.get(childId);
            if (child) {
                const childX = currentX + child.subtreeWidth / 2;
                this.layoutNode(child, childX, y + LEVEL_HEIGHT);
                currentX += child.subtreeWidth + NODE_GAP;
            }
        });
    }

    getNodeHeight(node) {
        if (node.isRoot) return 50;
        const hasUser = node.userMessage && node.userMessage.trim();
        const hasAI = node.aiReply && node.aiReply.trim();
        if (hasUser && hasAI) return NODE_MAX_HEIGHT;
        return NODE_MIN_HEIGHT;
    }

    // ==================== SVG Rendering ====================

    render(treeData) {
        if (!treeData) {
            this.renderEmptyState();
            return;
        }

        this.currentData = treeData;
        const root = this.convertTreeData(treeData);
        if (!root) {
            this.renderEmptyState();
            return;
        }

        this.calculateLayout();
        this.renderSVG();

        // Center view after render
        requestAnimationFrame(() => {
            this.centerView();
        });
    }

    renderSVG() {
        const svgNS = 'http://www.w3.org/2000/svg';

        // Clear main group and dynamic markers
        this.mainGroup.innerHTML = '';
        const defs = this.svg.querySelector('defs');
        // Remove dynamic arrow markers (keep gradients and filters)
        defs.querySelectorAll('[id^="arrowhead-"]').forEach(m => m.remove());

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

        // Render connections first (behind nodes)
        this.renderConnections(svgNS, isDark);

        // Render nodes
        this.nodeDataMap.forEach((node, nodeId) => {
            const pos = this.nodePositions.get(nodeId);
            if (pos) {
                this.renderNode(svgNS, node, pos, isDark);
            }
        });
    }

    renderConnections(svgNS, isDark) {
        const createdMarkers = new Set();

        this.nodeDataMap.forEach((node, nodeId) => {
            if (!node.children || node.children.length === 0) return;

            const parentPos = this.nodePositions.get(nodeId);
            if (!parentPos) return;

            node.children.forEach(childId => {
                const childPos = this.nodePositions.get(childId);
                const childNode = this.nodeDataMap.get(childId);
                if (!childPos || !childNode) return;

                const lineColor = childNode.branchColor || '#94a3b8';

                // Create a unique marker for this color if not already created
                const markerId = `arrowhead-${lineColor.replace('#', '')}`;
                if (!createdMarkers.has(markerId)) {
                    this.createArrowMarker(svgNS, markerId, lineColor);
                    createdMarkers.add(markerId);
                }

                // Parent bottom center to child top center
                const x1 = parentPos.x;
                const y1 = parentPos.y + parentPos.height / 2;
                const x2 = childPos.x;
                const y2 = childPos.y - childPos.height / 2;

                // Draw curved path with rounded corners
                const midY = (y1 + y2) / 2;
                const radius = 12;

                let pathD;
                if (Math.abs(x2 - x1) < 1) {
                    // Straight vertical line
                    pathD = `M ${x1} ${y1} L ${x2} ${y2}`;
                } else {
                    // Curved path with rounded corners
                    const dir = x2 > x1 ? 1 : -1;
                    pathD = `M ${x1} ${y1} L ${x1} ${midY - radius} Q ${x1} ${midY} ${x1 + dir * radius} ${midY} L ${x2 - dir * radius} ${midY} Q ${x2} ${midY} ${x2} ${midY + radius} L ${x2} ${y2}`;
                }

                const path = document.createElementNS(svgNS, 'path');
                path.setAttribute('d', pathD);
                path.setAttribute('stroke', lineColor);
                path.setAttribute('stroke-width', '2');
                path.setAttribute('fill', 'none');
                path.setAttribute('marker-end', `url(#${markerId})`);
                path.setAttribute('class', 'flowchart-connection');
                this.mainGroup.appendChild(path);
            });
        });
    }

    createArrowMarker(svgNS, markerId, color) {
        const defs = this.svg.querySelector('defs');
        const marker = document.createElementNS(svgNS, 'marker');
        marker.setAttribute('id', markerId);
        marker.setAttribute('markerWidth', '8');
        marker.setAttribute('markerHeight', '6');
        marker.setAttribute('refX', '8');
        marker.setAttribute('refY', '3');
        marker.setAttribute('orient', 'auto');
        const markerPath = document.createElementNS(svgNS, 'path');
        markerPath.setAttribute('d', 'M0,0 L8,3 L0,6 Z');
        markerPath.setAttribute('fill', color);
        marker.appendChild(markerPath);
        defs.appendChild(marker);
    }

    renderNode(svgNS, node, pos, isDark) {
        const group = document.createElementNS(svgNS, 'g');
        group.setAttribute('class', 'flowchart-node-group');
        group.setAttribute('data-nodeid', node.id);
        group.style.cursor = 'pointer';

        const x = pos.x - pos.width / 2;
        const y = pos.y - pos.height / 2;

        if (node.isRoot) {
            this.renderRootNode(svgNS, group, node, x, y, pos, isDark);
        } else {
            this.renderDialogueNode(svgNS, group, node, x, y, pos, isDark);
        }

        // Add selection highlight
        if (this.selectedNodeId === node.id) {
            group.classList.add('selected');
        }

        // Event listeners
        group.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleNodeClick(node);
        });

        group.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            this.handleNodeDoubleClick(node);
        });

        this.mainGroup.appendChild(group);
    }

    renderRootNode(svgNS, group, node, x, y, pos, isDark) {
        const rect = document.createElementNS(svgNS, 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', pos.width);
        rect.setAttribute('height', pos.height);
        rect.setAttribute('rx', ROOT_RADIUS);
        rect.setAttribute('ry', ROOT_RADIUS);
        rect.setAttribute('fill', 'url(#rootGradient)');
        rect.setAttribute('filter', 'url(#nodeShadow)');
        rect.setAttribute('class', 'flowchart-root-rect');
        group.appendChild(rect);

        const text = document.createElementNS(svgNS, 'text');
        text.setAttribute('x', pos.x);
        text.setAttribute('y', pos.y + 5);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('fill', '#ffffff');
        text.setAttribute('font-size', '16');
        text.setAttribute('font-weight', '600');
        text.setAttribute('font-family', 'var(--font-family)');

        // Display session title or default text
        const displayText = node.userMessage || '开始对话';
        text.textContent = this.truncateText(displayText, 14);
        group.appendChild(text);
    }

    renderDialogueNode(svgNS, group, node, x, y, pos, isDark) {
        const bgColor = isDark ? '#1e293b' : '#ffffff';
        const textColor = isDark ? '#f1f5f9' : '#1e293b';
        const borderColor = isDark ? '#334155' : '#e2e8f0';
        const branchColor = node.branchColor || '#6366f1';

        // Main rect with left border accent
        const rect = document.createElementNS(svgNS, 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', pos.width);
        rect.setAttribute('height', pos.height);
        rect.setAttribute('rx', NODE_RADIUS);
        rect.setAttribute('ry', NODE_RADIUS);
        rect.setAttribute('fill', bgColor);
        rect.setAttribute('stroke', borderColor);
        rect.setAttribute('stroke-width', '1');
        rect.setAttribute('filter', 'url(#nodeShadow)');
        rect.setAttribute('class', 'flowchart-dialogue-rect');
        group.appendChild(rect);

        // Left accent border
        const accentRect = document.createElementNS(svgNS, 'rect');
        accentRect.setAttribute('x', x);
        accentRect.setAttribute('y', y + NODE_RADIUS);
        accentRect.setAttribute('width', '4');
        accentRect.setAttribute('height', pos.height - NODE_RADIUS * 2);
        accentRect.setAttribute('rx', '2');
        accentRect.setAttribute('fill', branchColor);
        group.appendChild(accentRect);

        const padding = 14;
        const innerX = x + padding + 4;
        const innerWidth = pos.width - padding * 2 - 4;
        let currentY = y + padding;

        // User message line
        const hasUser = node.userMessage && node.userMessage.trim();
        const hasAI = node.aiReply && node.aiReply.trim();

        if (hasUser) {
            // User icon + text
            const userIcon = document.createElementNS(svgNS, 'text');
            userIcon.setAttribute('x', innerX);
            userIcon.setAttribute('y', currentY + 4);
            userIcon.setAttribute('font-size', '11');
            userIcon.setAttribute('fill', '#3b82f6');
            userIcon.setAttribute('font-weight', '600');
            userIcon.textContent = '👤';
            group.appendChild(userIcon);

            const userText = document.createElementNS(svgNS, 'text');
            userText.setAttribute('x', innerX + 16);
            userText.setAttribute('y', currentY + 4);
            userText.setAttribute('font-size', '12');
            userText.setAttribute('fill', isDark ? '#93c5fd' : '#1e40af');
            userText.setAttribute('font-weight', '500');
            userText.setAttribute('font-family', 'var(--font-family)');
            userText.textContent = this.truncateText(node.userMessage, 22);
            group.appendChild(userText);

            currentY += 20;
        }

        if (hasAI) {
            // AI icon + text
            const aiIcon = document.createElementNS(svgNS, 'text');
            aiIcon.setAttribute('x', innerX);
            aiIcon.setAttribute('y', currentY + 4);
            aiIcon.setAttribute('font-size', '11');
            aiIcon.setAttribute('fill', '#10b981');
            aiIcon.setAttribute('font-weight', '600');
            aiIcon.textContent = '🤖';
            group.appendChild(aiIcon);

            const aiText = document.createElementNS(svgNS, 'text');
            aiText.setAttribute('x', innerX + 16);
            aiText.setAttribute('y', currentY + 4);
            aiText.setAttribute('font-size', '12');
            aiText.setAttribute('fill', isDark ? '#6ee7b7' : '#065f46');
            aiText.setAttribute('font-weight', '500');
            aiText.setAttribute('font-family', 'var(--font-family)');
            aiText.textContent = this.truncateText(node.aiReply, 30);
            group.appendChild(aiText);
        }

        // If neither user nor AI message, show placeholder
        if (!hasUser && !hasAI) {
            const placeholder = document.createElementNS(svgNS, 'text');
            placeholder.setAttribute('x', pos.x);
            placeholder.setAttribute('y', pos.y + 4);
            placeholder.setAttribute('text-anchor', 'middle');
            placeholder.setAttribute('dominant-baseline', 'middle');
            placeholder.setAttribute('font-size', '12');
            placeholder.setAttribute('fill', isDark ? '#64748b' : '#94a3b8');
            placeholder.setAttribute('font-family', 'var(--font-family)');
            placeholder.textContent = '空节点';
            group.appendChild(placeholder);
        }
    }

    // ==================== Node Interactions ====================

    handleNodeClick(node) {
        this.highlightNode(node.id);

        if (this.onNodeSelect) {
            this.onNodeSelect({
                nodeId: node.id,
                userMessage: node.userMessage,
                aiReply: node.aiReply,
                parentId: node.parentId,
                branchColor: node.branchColor
            });
        }
    }

    handleNodeDoubleClick(node) {
        this.showNodeDetail({
            nodeId: node.id,
            userMessage: node.userMessage,
            aiReply: node.aiReply,
            fullContent: node.userMessage || node.aiReply || '',
            role: node.userMessage ? 'user' : 'assistant'
        });
        this.highlightNode(node.id);
    }

    highlightNode(nodeId) {
        this.clearNodeHighlight();
        this.selectedNodeId = nodeId;

        const group = this.svg.querySelector(`[data-nodeid="${nodeId}"]`);
        if (group) {
            group.classList.add('selected');
            const mainRect = group.querySelector('.flowchart-dialogue-rect, .flowchart-root-rect');
            if (mainRect) {
                mainRect.setAttribute('filter', 'url(#selectedShadow)');
                const node = this.nodeDataMap.get(nodeId);
                if (node && !node.isRoot) {
                    mainRect.setAttribute('stroke', node.branchColor || '#6366f1');
                    mainRect.setAttribute('stroke-width', '2.5');
                }
            }
        }
    }

    clearNodeHighlight() {
        if (this.selectedNodeId) {
            const group = this.svg.querySelector(`[data-nodeid="${this.selectedNodeId}"]`);
            if (group) {
                group.classList.remove('selected');
                const mainRect = group.querySelector('.flowchart-dialogue-rect, .flowchart-root-rect');
                if (mainRect) {
                    mainRect.setAttribute('filter', 'url(#nodeShadow)');
                    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
                    const node = this.nodeDataMap.get(this.selectedNodeId);
                    if (node && !node.isRoot) {
                        mainRect.setAttribute('stroke', isDark ? '#334155' : '#e2e8f0');
                        mainRect.setAttribute('stroke-width', '1');
                    }
                }
            }
            this.selectedNodeId = null;
        }
    }

    setOnNodeSelect(callback) {
        this.onNodeSelect = callback;
    }

    // ==================== Utility ====================

    truncateText(text, maxLength) {
        if (!text) return '';
        if (text.length <= maxLength) return text;
        return text.slice(0, maxLength) + '...';
    }

    renderEmptyState() {
        this.nodeDataMap.clear();
        this.nodePositions.clear();
        this.rootId = 'root';

        // Create a simple root node
        const emptyRoot = {
            id: 'root',
            parentId: null,
            userMessage: '开始对话',
            aiReply: '',
            branchColor: '#6366f1',
            isRoot: true,
            depth: 0,
            children: [],
            subtreeWidth: NODE_WIDTH
        };
        this.nodeDataMap.set('root', emptyRoot);
        this.nodePositions.set('root', { x: 0, y: 0, width: NODE_WIDTH, height: 50 });

        this.renderSVG();
        requestAnimationFrame(() => this.centerView());
    }

    refresh() {
        if (this.currentData) {
            this.render(this.currentData);
        }
    }

    clear() {
        this.nodeDataMap.clear();
        this.nodePositions.clear();
        this.renderEmptyState();
    }

    // ==================== Export ====================

    exportToJSON() {
        const data = {
            nodes: Array.from(this.nodeDataMap.entries()).map(([id, node]) => ({
                id: node.id,
                parentId: node.parentId,
                userMessage: node.userMessage,
                aiReply: node.aiReply,
                branchColor: node.branchColor,
                timestamp: node.timestamp
            }))
        };
        return JSON.stringify(data, null, 2);
    }

    exportToMarkdown(session) {
        let markdown = `# ${session?.title || '思维导图'}\n\n`;

        const traverseNode = (nodeId, depth = 0) => {
            const node = this.nodeDataMap.get(nodeId);
            if (!node) return;

            const indent = '  '.repeat(depth);
            if (node.isRoot) {
                markdown += `${indent}- ${node.userMessage || '开始对话'}\n`;
            } else {
                if (node.userMessage) {
                    markdown += `${indent}- 👤 ${node.userMessage}\n`;
                }
                if (node.aiReply) {
                    markdown += `${indent}  - 🤖 ${this.truncateText(node.aiReply, 50)}\n`;
                }
            }

            if (node.children) {
                node.children.forEach(childId => traverseNode(childId, depth + 1));
            }
        };

        traverseNode(this.rootId || 'root');
        return markdown;
    }

    destroy() {
        this.nodeDataMap.clear();
        this.nodePositions.clear();
    }
}

export default MindmapRenderer;
