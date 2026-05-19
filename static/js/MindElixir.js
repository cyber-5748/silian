class SimpleMindMap {
    static SIDE = 1;
    
    constructor(options) {
        this.el = options.el;
        this.nodeData = null;
        this.linkData = [];
        this.scale = 1;
        this.bus = {
            listeners: {},
            addListener: function(event, callback) {
                if (!this.listeners[event]) this.listeners[event] = [];
                this.listeners[event].push(callback);
            },
            fire: function(event, data) {
                if (this.listeners[event]) {
                    this.listeners[event].forEach(cb => cb(data));
                }
            }
        };
        this.direction = options.direction || 1;
        this.selectedNode = null;
    }

    init(data) {
        this.nodeData = data.nodeData;
        this.render();
    }

    render() {
        this.el.innerHTML = '';
        const container = document.createElement('div');
        container.className = 'mindmap-tree';
        container.style.transform = `scale(${this.scale})`;
        container.style.transformOrigin = 'center center';
        
        if (this.nodeData) {
            const rootNode = this.renderNode(this.nodeData, 0);
            container.appendChild(rootNode);
        }
        
        this.el.appendChild(container);
    }

    renderNode(node, depth) {
        const wrapper = document.createElement('div');
        wrapper.className = 'mind-node-wrapper';
        wrapper.style.marginLeft = depth > 0 ? '30px' : '0';
        
        const nodeEl = document.createElement('div');
        nodeEl.className = 'mind-elixir-node custom-node';
        nodeEl.dataset.nodeid = node.id;
        
        if (node.root) {
            nodeEl.classList.add('root-node');
        }
        
        if (node.style) {
            Object.assign(nodeEl.style, node.style);
        }
        
        const topic = document.createElement('div');
        topic.className = 'mind-elixir-topic node-topic';
        topic.textContent = node.topic;
        nodeEl.appendChild(topic);
        
        nodeEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectNode(node);
        });
        
        wrapper.appendChild(nodeEl);
        
        if (node.children && node.children.length > 0 && node.expanded !== false) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'mind-children';
            
            node.children.forEach(child => {
                const childNode = this.renderNode(child, depth + 1);
                childrenContainer.appendChild(childNode);
            });
            
            wrapper.appendChild(childrenContainer);
            
            if (node.children.length > 0) {
                const expander = document.createElement('div');
                expander.className = 'mind-elixir-expander';
                expander.textContent = node.expanded !== false ? '−' : '+';
                expander.addEventListener('click', (e) => {
                    e.stopPropagation();
                    node.expanded = node.expanded === false ? true : false;
                    this.render();
                    this.bus.fire('expandNode', node);
                });
                nodeEl.appendChild(expander);
            }
        }
        
        return wrapper;
    }

    selectNode(node) {
        if (this.selectedNode) {
            const prevEl = this.el.querySelector(`[data-nodeid="${this.selectedNode.id}"]`);
            if (prevEl) prevEl.classList.remove('selected');
        }
        this.selectedNode = node;
        const nodeEl = this.el.querySelector(`[data-nodeid="${node.id}"]`);
        if (nodeEl) nodeEl.classList.add('selected');
        this.bus.fire('selectNode', node);
    }

    center() {
        const container = this.el.querySelector('.mindmap-tree');
        if (container) {
            container.style.display = 'flex';
            container.style.justifyContent = 'center';
            container.style.alignItems = 'center';
            container.style.minHeight = '100%';
        }
    }
}

const MindElixir = SimpleMindMap;
MindElixir.SIDE = 1;
