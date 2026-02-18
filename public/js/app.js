function cloudvault() {
  return {
    files: [],
    folders: [],
    expandedFolders: new Set(),
    currentFolder: 'root',
    view: localStorage.getItem('cv-view') || 'grid',
    searchQuery: '',
    selectedFiles: new Set(),
    sortBy: 'date',
    sortDir: 'desc',
    stats: { totalFiles: 0, totalSize: 0, totalDownloads: 0, recentUploads: [], topDownloaded: [] },
    darkMode: !document.documentElement.classList.contains('light'),
    showDropZone: false,
    showNewFolderModal: false,
    newFolderName: '',
    loading: true,
    uploads: [],
    sidebarOpen: false,
    ctxMenu: { show: false, x: 0, y: 0, file: null },
    folderCtxMenu: { show: false, x: 0, y: 0, folder: null },
    shareModal: { show: false, file: null, password: '', expiresInDays: 0 },
    renameModal: { show: false, file: null, newName: '' },
    deleteModal: { show: false, ids: [] },
    moveModal: { show: false, files: [], targetFolder: 'root' },
    settingsModal: { show: false, guestPageEnabled: false, showLoginButton: true, guestFolders: [] },

    async init() {
      if (localStorage.getItem('cv-dark') === 'false') {
        this.darkMode = false;
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
      }

      this.setupDragDrop();
      this.setupUploadEvents();
      this.setupTreeEvents();

      await Promise.all([this.fetchFiles(), this.fetchFolders(), this.fetchStats()]);
      this.loading = false;
    },

    setupDragDrop() {
      let dragCounter = 0;
      document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        if (e.dataTransfer?.types?.includes('Files')) this.showDropZone = true;
      });
      document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) { this.showDropZone = false; dragCounter = 0; }
      });
      document.addEventListener('dragover', (e) => e.preventDefault());
      document.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        this.showDropZone = false;
      });
    },

    setupUploadEvents() {
      window.addEventListener('upload-progress', () => {
        this.uploads = [...window.UploadManager.queue.map(q => ({
          name: q.file.name, progress: q.progress, status: q.status
        }))];
      });
      window.addEventListener('upload-complete', async (e) => {
        this.uploads = [...window.UploadManager.queue.map(q => ({
          name: q.file.name, progress: q.progress, status: q.status
        }))];
        this.showToast(e.detail.name + ' uploaded', 'success');
        await Promise.all([this.fetchFiles(), this.fetchStats(), this.fetchFolders()]);
      });
      window.addEventListener('upload-error', (e) => {
        this.uploads = [...window.UploadManager.queue.map(q => ({
          name: q.file.name, progress: q.progress, status: q.status
        }))];
        this.showToast('Failed to upload ' + e.detail.name, 'error');
      });
    },

    setupTreeEvents() {
      const sidebar = document.querySelector('.sidebar');
      if (!sidebar) return;
      sidebar.addEventListener('click', (e) => {
        const toggleEl = e.target.closest('[data-toggle-folder]');
        if (toggleEl) {
          e.stopPropagation();
          this.toggleFolderExpand(toggleEl.dataset.toggleFolder);
          return;
        }
        const itemEl = e.target.closest('[data-folder-path]');
        if (itemEl) {
          this.navigateFolder(itemEl.dataset.folderPath);
        }
      });
      sidebar.addEventListener('contextmenu', (e) => {
        const itemEl = e.target.closest('[data-folder-path]');
        if (itemEl) {
          e.preventDefault();
          const path = itemEl.dataset.folderPath;
          const folder = this.folders.find(f => f.name === path);
          if (folder) {
            let x = e.clientX, y = e.clientY;
            if (x + 200 > window.innerWidth) x = window.innerWidth - 200;
            if (y + 200 > window.innerHeight) y = window.innerHeight - 200;
            this.folderCtxMenu = { show: true, x, y, folder };
          }
        }
      });
    },

    toggleFolderExpand(path) {
      if (this.expandedFolders.has(path)) this.expandedFolders.delete(path);
      else this.expandedFolders.add(path);
      this.expandedFolders = new Set(this.expandedFolders);
    },

    get folderTree() {
      const root = [];
      const map = {};
      for (const folder of this.folders) {
        const parts = folder.name.split('/');
        let currentPath = '';
        let currentLevel = root;
        for (let i = 0; i < parts.length; i++) {
          currentPath = currentPath ? currentPath + '/' + parts[i] : parts[i];
          if (!map[currentPath]) {
            const fd = this.folders.find(f => f.name === currentPath);
            const node = {
              name: parts[i], path: currentPath,
              shared: fd ? fd.shared : false,
              directlyShared: fd ? fd.directlyShared : false,
              children: [],
            };
            map[currentPath] = node;
            currentLevel.push(node);
          }
          currentLevel = map[currentPath].children;
        }
      }
      return root;
    },

    renderFolderTree(nodes, depth) {
      if (!nodes || nodes.length === 0) return '';
      let html = '';
      for (const node of nodes) {
        const isActive = this.currentFolder === node.path;
        const isExpanded = this.expandedFolders.has(node.path);
        const hasChildren = node.children && node.children.length > 0;
        const indent = depth * 16;
        const sharedBadge = node.directlyShared
          ? '<span class="folder-share-badge" title="Shared">\u25CF</span>'
          : (node.shared ? '<span class="folder-share-badge inherited" title="Inherited share">\u25CB</span>' : '');
        html += '<div class="sidebar-item tree-item' + (isActive ? ' active' : '') + '" ' +
          'style="padding-left:' + (12 + indent) + 'px" ' +
          'data-folder-path="' + this._escAttr(node.path) + '">' +
          (hasChildren
            ? '<svg class="w-3 h-3 tree-chevron' + (isExpanded ? ' expanded' : '') + '" data-toggle-folder="' + this._escAttr(node.path) + '" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>'
            : '<span class="w-3 h-3 inline-block"></span>') +
          '<span class="relative flex-shrink-0">' +
            '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"/></svg>' +
            sharedBadge +
          '</span>' +
          '<span class="truncate">' + this._escHtml(node.name) + '</span>' +
        '</div>';
        if (hasChildren && isExpanded) {
          html += this.renderFolderTree(node.children, depth + 1);
        }
      }
      return html;
    },

    _escHtml(s) {
      const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
    },
    _escAttr(s) {
      return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    },

    async toggleFolderShare(folder) {
      this.folderCtxMenu.show = false;
      if (!folder) return;
      try {
        const res = await this.apiFetch('/api/folders/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder: folder.name }),
        });
        if (res && res.ok) {
          const data = await res.json();
          this.showToast(data.shared ? 'Folder shared' : 'Folder unshared', 'success');
          await this.fetchFolders();
        } else { this.showToast('Failed to toggle folder sharing', 'error'); }
      } catch { this.showToast('Failed to toggle folder sharing', 'error'); }
    },

    showMoveModal(file) {
      this.ctxMenu.show = false;
      this.moveModal = { show: true, files: [file.id], targetFolder: 'root' };
    },

    moveSelected() {
      this.moveModal = { show: true, files: [...this.selectedFiles], targetFolder: 'root' };
    },

    async confirmMove() {
      const { files: ids, targetFolder } = this.moveModal;
      this.moveModal.show = false;
      try {
        const res = await this.apiFetch('/api/files/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids, targetFolder }),
        });
        if (res && res.ok) {
          const data = await res.json();
          this.showToast(data.moved + ' file(s) moved', 'success');
          await Promise.all([this.fetchFiles(), this.fetchFolders()]);
        } else { this.showToast('Move failed', 'error'); }
      } catch { this.showToast('Move failed', 'error'); }
    },

    async apiFetch(url, opts = {}) {
      const res = await fetch(url, { credentials: 'same-origin', ...opts });
      if (res.status === 401) { window.location.href = '/login'; return null; }
      return res;
    },

    async fetchFiles() {
      const params = new URLSearchParams();
      if (this.currentFolder !== 'root') params.set('folder', this.currentFolder);
      if (this.searchQuery) params.set('search', this.searchQuery);
      const res = await this.apiFetch('/api/files?' + params);
      if (!res) return;
      const data = await res.json();
      this.files = data.files || [];
    },

    async fetchFolders() {
      const res = await this.apiFetch('/api/folders');
      if (!res) return;
      const data = await res.json();
      this.folders = (data.folders || []).map(f => typeof f === 'string' ? { name: f, shared: false, directlyShared: false } : f);
    },

    async fetchStats() {
      const res = await this.apiFetch('/api/stats');
      if (!res) return;
      this.stats = await res.json();
    },

    get filteredFiles() {
      let result = [...this.files];
      const cmp = (a, b) => {
        let va, vb;
        if (this.sortBy === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
        else if (this.sortBy === 'size') { va = a.size; vb = b.size; }
        else { va = a.uploadedAt; vb = b.uploadedAt; }
        if (va < vb) return this.sortDir === 'asc' ? -1 : 1;
        if (va > vb) return this.sortDir === 'asc' ? 1 : -1;
        return 0;
      };
      result.sort(cmp);
      return result;
    },

    navigateFolder(folder) {
      this.currentFolder = folder;
      this.searchQuery = '';
      this.clearSelection();
      this.sidebarOpen = false;
      if (folder !== 'root') {
        const parts = folder.split('/');
        let path = '';
        for (let i = 0; i < parts.length - 1; i++) {
          path = path ? path + '/' + parts[i] : parts[i];
          this.expandedFolders.add(path);
        }
        this.expandedFolders = new Set(this.expandedFolders);
      }
      this.fetchFiles();
    },

    toggleSort(field) {
      if (this.sortBy === field) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
      else { this.sortBy = field; this.sortDir = field === 'name' ? 'asc' : 'desc'; }
    },

    selectFile(id, event) {
      if (event.ctrlKey || event.metaKey) {
        this.toggleSelect(id);
      } else if (event.shiftKey && this.selectedFiles.size > 0) {
        const ids = this.filteredFiles.map(f => f.id);
        const lastSelected = [...this.selectedFiles].pop();
        const from = ids.indexOf(lastSelected);
        const to = ids.indexOf(id);
        const [start, end] = from < to ? [from, to] : [to, from];
        for (let i = start; i <= end; i++) this.selectedFiles.add(ids[i]);
        this.selectedFiles = new Set(this.selectedFiles);
      } else {
        this.selectedFiles = new Set([id]);
      }
    },

    toggleSelect(id) {
      if (this.selectedFiles.has(id)) this.selectedFiles.delete(id);
      else this.selectedFiles.add(id);
      this.selectedFiles = new Set(this.selectedFiles);
    },

    selectAll() {
      this.selectedFiles = new Set(this.filteredFiles.map(f => f.id));
    },

    clearSelection() {
      this.selectedFiles = new Set();
    },

    deleteFiles(ids) {
      this.deleteModal.ids = ids;
      this.deleteModal.show = true;
      this.ctxMenu.show = false;
    },

    deleteSelected() {
      this.deleteFiles([...this.selectedFiles]);
    },

    async confirmDelete() {
      const ids = this.deleteModal.ids;
      this.deleteModal.show = false;
      try {
        const res = await this.apiFetch('/api/files/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });
        if (res && res.ok) {
          this.files = this.files.filter(f => !ids.includes(f.id));
          this.clearSelection();
          this.showToast(ids.length + ' file(s) deleted', 'success');
          this.fetchStats();
        } else {
          this.showToast('Failed to delete files', 'error');
        }
      } catch { this.showToast('Failed to delete files', 'error'); }
    },

    showRenameModal(file) {
      this.renameModal = { show: true, file, newName: file.name };
      this.ctxMenu.show = false;
    },

    async confirmRename() {
      const { file, newName } = this.renameModal;
      if (!newName.trim() || newName === file.name) { this.renameModal.show = false; return; }
      this.renameModal.show = false;
      try {
        const res = await this.apiFetch('/api/files/' + file.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName.trim() }),
        });
        if (res && res.ok) {
          file.name = newName.trim();
          this.showToast('File renamed', 'success');
        } else { this.showToast('Rename failed', 'error'); }
      } catch { this.showToast('Rename failed', 'error'); }
    },

    async createFolder() {
      const name = this.newFolderName.trim();
      if (!name) return;
      this.showNewFolderModal = false;
      this.newFolderName = '';
      try {
        const res = await this.apiFetch('/api/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, parent: this.currentFolder }),
        });
        if (res && res.ok) {
          await this.fetchFolders();
          this.showToast('Folder created', 'success');
        } else { this.showToast('Failed to create folder', 'error'); }
      } catch { this.showToast('Failed to create folder', 'error'); }
    },

    shareFile(file) {
      this.shareModal = { show: true, file, password: '', expiresInDays: 0 };
      this.ctxMenu.show = false;
    },

    async createShare() {
      const { file, password, expiresInDays } = this.shareModal;
      try {
        const body = { fileId: file.id };
        if (password) body.password = password;
        if (expiresInDays > 0) body.expiresInDays = expiresInDays;
        const res = await this.apiFetch('/api/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res && res.ok) {
          const data = await res.json();
          file.shareToken = data.token;
          this.shareModal.file = file;
          this.showToast('Share link created', 'success');
          this.copyShareLink(data.token);
        } else { this.showToast('Failed to create share link', 'error'); }
      } catch { this.showToast('Failed to create share link', 'error'); }
    },

    async revokeShare(fileId) {
      try {
        const res = await this.apiFetch('/api/share/' + fileId, { method: 'DELETE' });
        if (res && res.ok) {
          const file = this.files.find(f => f.id === fileId);
          if (file) file.shareToken = null;
          this.shareModal.show = false;
          this.showToast('Share link revoked', 'success');
        } else { this.showToast('Failed to revoke link', 'error'); }
      } catch { this.showToast('Failed to revoke link', 'error'); }
    },

    copyShareLink(token) {
      const url = window.location.origin + '/s/' + token;
      navigator.clipboard.writeText(url).then(() => this.showToast('Link copied to clipboard', 'info'));
    },

    downloadFile(file) {
      this.ctxMenu.show = false;
      if (file.shareToken) {
        window.open('/s/' + file.shareToken + '/download', '_blank');
      } else {
        window.open('/api/files/' + file.id + '/download', '_blank');
      }
    },

    previewFile(file) {
      if (file.shareToken) {
        window.open('/s/' + file.shareToken, '_blank');
      } else {
        this.downloadFile(file);
      }
    },

    openContextMenu(event, file) {
      const rect = document.body.getBoundingClientRect();
      let x = event.clientX;
      let y = event.clientY;
      if (x + 200 > window.innerWidth) x = window.innerWidth - 200;
      if (y + 200 > window.innerHeight) y = window.innerHeight - 200;
      this.ctxMenu = { show: true, x, y, file };
    },

    handleFileSelect(event) {
      const files = event.target.files;
      if (files.length) {
        window.UploadManager.addFiles(files, this.currentFolder);
        this.uploads = [...window.UploadManager.queue.map(q => ({
          name: q.file.name, progress: q.progress, status: q.status
        }))];
      }
      event.target.value = '';
    },

    async handleDrop(event) {
      this.showDropZone = false;
      const entries = await window.readDroppedEntries(event.dataTransfer);
      if (entries.length === 0) return;

      const byFolder = {};
      for (const { file, relativePath } of entries) {
        const folder = relativePath
          ? (this.currentFolder === 'root' ? relativePath.split('/')[0] : this.currentFolder + '/' + relativePath.split('/')[0])
          : this.currentFolder;
        if (!byFolder[folder]) byFolder[folder] = [];
        byFolder[folder].push(file);
      }
      for (const [folder, files] of Object.entries(byFolder)) {
        window.UploadManager.addFiles(files, folder);
      }
      this.uploads = [...window.UploadManager.queue.map(q => ({
        name: q.file.name, progress: q.progress, status: q.status
      }))];
    },

    toggleDarkMode() {
      this.darkMode = !this.darkMode;
      document.documentElement.classList.toggle('dark', this.darkMode);
      document.documentElement.classList.toggle('light', !this.darkMode);
      localStorage.setItem('cv-dark', this.darkMode);
    },

    async loadSettings() {
      try {
        const res = await this.apiFetch('/api/settings');
        if (res && res.ok) {
          const data = await res.json();
          this.settingsModal.guestPageEnabled = data.guestPageEnabled || false;
          this.settingsModal.showLoginButton = data.showLoginButton !== false;
          this.settingsModal.guestFolders = data.guestFolders || [];
        }
      } catch { /* use defaults */ }
    },

    async saveSettings() {
      try {
        const res = await this.apiFetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guestPageEnabled: this.settingsModal.guestPageEnabled,
            showLoginButton: this.settingsModal.showLoginButton,
            guestFolders: this.settingsModal.guestFolders,
          }),
        });
        if (res && res.ok) {
          this.settingsModal.show = false;
          this.showToast('Settings saved', 'success');
        } else { this.showToast('Failed to save settings', 'error'); }
      } catch { this.showToast('Failed to save settings', 'error'); }
    },

    toggleGuestFolder(folderName) {
      const idx = this.settingsModal.guestFolders.indexOf(folderName);
      if (idx >= 0) this.settingsModal.guestFolders.splice(idx, 1);
      else this.settingsModal.guestFolders.push(folderName);
    },

    async logout() {
      await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
      window.location.href = '/login';
    },

    handleKeyboard(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Delete' && this.selectedFiles.size > 0) {
        e.preventDefault();
        this.deleteSelected();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        this.selectAll();
      }
      if (e.key === 'Escape') {
        this.clearSelection();
        this.ctxMenu.show = false;
        this.folderCtxMenu.show = false;
        this.shareModal.show = false;
        this.renameModal.show = false;
        this.deleteModal.show = false;
        this.moveModal.show = false;
        this.showNewFolderModal = false;
      }
    },

    showToast(message, type = 'info') {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      const icons = { success: '\u2713', error: '\u2717', info: '\u24D8' };
      toast.innerHTML = '<span>' + (icons[type] || '') + '</span><span>' + message + '</span>';
      container.appendChild(toast);
      setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 200);
      }, 3000);
    },

    formatBytes(bytes) {
      if (!bytes || bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    },

    formatDate(iso) {
      if (!iso) return '';
      const date = new Date(iso);
      const now = new Date();
      const diff = now - date;
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'Just now';
      if (mins < 60) return mins + 'm ago';
      const hours = Math.floor(mins / 60);
      if (hours < 24) return hours + 'h ago';
      const days = Math.floor(hours / 24);
      if (days < 7) return days + 'd ago';
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
    },

    getFileIcon(type, name) {
      if (!type) return '\uD83D\uDCC4';
      if (type.startsWith('image/')) return '\uD83D\uDDBC\uFE0F';
      if (type.startsWith('video/')) return '\uD83C\uDFAC';
      if (type.startsWith('audio/')) return '\uD83C\uDFB5';
      if (type === 'application/pdf') return '\uD83D\uDCC4';
      if (type.includes('zip') || type.includes('tar') || type.includes('gzip')) return '\uD83D\uDCE6';
      if (type.includes('spreadsheet') || name?.endsWith('.csv') || name?.endsWith('.xlsx')) return '\uD83D\uDCCA';
      if (type.includes('document') || name?.endsWith('.doc') || name?.endsWith('.docx')) return '\uD83D\uDCC3';
      if (type.startsWith('text/') || name?.match(/\.(js|ts|py|rb|go|rs|java|c|cpp|h|sh|yaml|yml|json|toml|md|html|css|sql)$/i)) return '\uD83D\uDCDD';
      return '\uD83D\uDCC1';
    },
  };
}
