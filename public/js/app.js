function cloudvault() {
  return {
    files: [],
    folders: [],
    expandedFolders: { '__root__': true },
    _expandVer: 0,
    _folderShareHash: '',
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
    _branding: JSON.parse(document.getElementById('branding-data')?.textContent || '{"siteName":"CloudVault","siteIconUrl":""}'),
    settingsModal: { show: false, guestPageEnabled: false, showLoginButton: true, siteName: 'CloudVault', siteIconUrl: '', _iconError: false },
    renameFolderModal: { show: false, oldName: '', newName: '' },
    deleteFolderModal: { show: false, folder: '' },
    typeFilter: 'all',
    previewModal: { show: false, file: null, content: '', loading: false },
    lightbox: { show: false, images: [], currentIndex: 0 },
    folderShareLinkModal: { show: false, folder: '', token: null, password: '', expiresInDays: 0, hasPassword: false, expiresAt: null },

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
      const now = Date.now();
      if (this._lastToggle && now - this._lastToggle < 50) return;
      this._lastToggle = now;
      if (this.expandedFolders[path]) delete this.expandedFolders[path];
      else this.expandedFolders[path] = true;
      this._expandVer++;
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
              excluded: fd ? fd.excluded : false,
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
        const isExpanded = !!this.expandedFolders[node.path];
        const hasChildren = node.children && node.children.length > 0;
        const indent = depth * 16;
        let sharedBadge = '';
        if (node.excluded) {
          sharedBadge = '<span class="folder-share-badge excluded" title="Excluded from share">\u2298</span>';
        } else if (node.directlyShared) {
          sharedBadge = '<span class="folder-share-badge guest" title="Guest shared">\uD83D\uDC41</span>';
        } else if (node.shared) {
          sharedBadge = '<span class="folder-share-badge inherited" title="Inherited share">\u25CB</span>';
        }
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
    _hasSharedAncestor(folderPath, excludeFolder) {
      const parts = folderPath.split('/');
      let path = '';
      for (let i = 0; i < parts.length - 1; i++) {
        path = path ? path + '/' + parts[i] : parts[i];
        if (path === excludeFolder) continue;
        const f = this.folders.find(fd => fd.name === path);
        if (f && f.directlyShared && !f.excluded) return true;
      }
      return false;
    },

    async toggleFolderShare(folder) {
      this.folderCtxMenu.show = false;
      if (!folder) return;
      const folderName = folder.name;
      try {
        const res = await this.apiFetch('/api/folders/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder: folderName }),
        });
        if (res && res.ok) {
          const data = await res.json();
          const nowShared = !!data.shared;
          this.folders = this.folders.map(f => {
            if (f.name === folderName) {
              return { ...f, directlyShared: nowShared, shared: nowShared, excluded: false };
            }
            if (f.name.startsWith(folderName + '/')) {
              if (nowShared && !f.excluded) {
                return { ...f, shared: true };
              } else if (!nowShared) {
                const inherited = this._hasSharedAncestor(f.name, folderName);
                return { ...f, shared: inherited };
              }
            }
            return f;
          });
          this._folderShareHash = this.folders.map(f => f.name + (f.shared ? 1 : 0) + (f.directlyShared ? 1 : 0) + (f.excluded ? 1 : 0)).join('|');
          this._expandVer++;
          this.showToast(nowShared ? 'Folder shared' : 'Folder unshared', 'success');
        } else { this.showToast('Failed to toggle folder sharing', 'error'); }
      } catch { this.showToast('Failed to toggle folder sharing', 'error'); }
    },

    async toggleFolderExclude(folder) {
      this.folderCtxMenu.show = false;
      if (!folder) return;
      const folderName = folder.name;
      try {
        const res = await this.apiFetch('/api/folders/exclude', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder: folderName }),
        });
        if (res && res.ok) {
          const data = await res.json();
          const nowExcluded = !!data.excluded;
          this.folders = this.folders.map(f => {
            if (f.name === folderName) {
              return { ...f, excluded: nowExcluded, shared: nowExcluded ? false : this._hasSharedAncestor(f.name, null) || f.directlyShared };
            }
            if (f.name.startsWith(folderName + '/')) {
              if (nowExcluded) {
                return { ...f, shared: false };
              } else {
                const inherited = f.directlyShared || this._hasSharedAncestor(f.name, null);
                return { ...f, shared: inherited };
              }
            }
            return f;
          });
          this._folderShareHash = this.folders.map(f => f.name + (f.shared ? 1 : 0) + (f.directlyShared ? 1 : 0) + (f.excluded ? 1 : 0)).join('|');
          this._expandVer++;
          this.showToast(nowExcluded ? 'Folder excluded from share' : 'Folder included in share', 'success');
        } else { this.showToast('Failed to toggle folder exclusion', 'error'); }
      } catch { this.showToast('Failed to toggle folder exclusion', 'error'); }
    },

    showRenameFolderModal(folder) {
      this.folderCtxMenu.show = false;
      if (!folder) return;
      const shortName = folder.name.includes('/') ? folder.name.split('/').pop() : folder.name;
      this.renameFolderModal = { show: true, oldName: folder.name, newName: shortName };
    },

    async confirmRenameFolder() {
      const { oldName, newName } = this.renameFolderModal;
      if (!newName.trim()) { this.renameFolderModal.show = false; return; }
      const parent = oldName.includes('/') ? oldName.substring(0, oldName.lastIndexOf('/')) : '';
      const fullNewName = parent ? parent + '/' + newName.trim() : newName.trim();
      if (fullNewName === oldName) { this.renameFolderModal.show = false; return; }
      this.renameFolderModal.show = false;
      try {
        const res = await this.apiFetch('/api/folders', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldName, newName: fullNewName }),
        });
        if (res && res.ok) {
          if (this.currentFolder === oldName || this.currentFolder.startsWith(oldName + '/')) {
            this.currentFolder = fullNewName + this.currentFolder.slice(oldName.length);
          }
          if (this.expandedFolders[oldName]) {
            delete this.expandedFolders[oldName];
            this.expandedFolders[fullNewName] = true;
          }
          this.folders = this.folders.map(f => {
            if (f.name === oldName) return { ...f, name: fullNewName };
            if (f.name.startsWith(oldName + '/')) return { ...f, name: fullNewName + f.name.slice(oldName.length) };
            return f;
          });
          this._folderShareHash = this.folders.map(f => f.name + (f.shared ? 1 : 0) + (f.directlyShared ? 1 : 0) + (f.excluded ? 1 : 0)).join('|');
          this._expandVer++;
          this.showToast('Folder renamed', 'success');
          await this.fetchFiles();
        } else { this.showToast('Rename failed', 'error'); }
      } catch { this.showToast('Rename failed', 'error'); }
    },

    showDeleteFolderModal(folder) {
      this.folderCtxMenu.show = false;
      if (!folder) return;
      this.deleteFolderModal = { show: true, folder: folder.name };
    },

    async confirmDeleteFolder() {
      const folder = this.deleteFolderModal.folder;
      this.deleteFolderModal.show = false;
      try {
        const res = await this.apiFetch('/api/folders', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder }),
        });
        if (res && res.ok) {
          const data = await res.json();
          if (this.currentFolder === folder || this.currentFolder.startsWith(folder + '/')) {
            this.currentFolder = 'root';
          }
          delete this.expandedFolders[folder];
          this.folders = this.folders.filter(f => f.name !== folder && !f.name.startsWith(folder + '/'));
          this._folderShareHash = this.folders.map(f => f.name + (f.shared ? 1 : 0) + (f.directlyShared ? 1 : 0) + (f.excluded ? 1 : 0)).join('|');
          this._expandVer++;
          var parts = [];
          if (data.deletedFiles > 0) parts.push(data.deletedFiles + ' file' + (data.deletedFiles > 1 ? 's' : ''));
          if (data.deletedSubfolders > 0) parts.push(data.deletedSubfolders + ' subfolder' + (data.deletedSubfolders > 1 ? 's' : ''));
          var msg = 'Folder deleted' + (parts.length ? ' — removed ' + parts.join(' and ') : '');
          this.showToast(msg, 'success');
          await this.fetchFiles();
        } else { this.showToast('Delete failed', 'error'); }
      } catch { this.showToast('Delete failed', 'error'); }
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
      const folders = (data.folders || []).map(f => typeof f === 'string' ? { name: f, shared: false, directlyShared: false, excluded: false } : f);
      this.folders = folders;
      this._folderShareHash = folders.map(f => f.name + (f.shared ? 1 : 0) + (f.directlyShared ? 1 : 0) + (f.excluded ? 1 : 0)).join('|');
    },

    async fetchStats() {
      const res = await this.apiFetch('/api/stats');
      if (!res) return;
      this.stats = await res.json();
    },

    get filteredFiles() {
      let result = [...this.files];
      if (this.typeFilter !== 'all') {
        result = result.filter(f => this.getFileCategory(f.type, f.name) === this.typeFilter);
      }
      const cmp = (a, b) => {
        let va, vb;
        if (this.sortBy === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
        else if (this.sortBy === 'size') { va = a.size; vb = b.size; }
        else if (this.sortBy === 'type') { va = this.getFileCategory(a.type, a.name); vb = this.getFileCategory(b.type, b.name); }
        else { va = a.uploadedAt; vb = b.uploadedAt; }
        if (va < vb) return this.sortDir === 'asc' ? -1 : 1;
        if (va > vb) return this.sortDir === 'asc' ? 1 : -1;
        return 0;
      };
      result.sort(cmp);
      return result;
    },

    navigateFolder(folder) {
      const now = Date.now();
      if (this._lastNav && now - this._lastNav < 50) return;
      this._lastNav = now;
      const wasOnSameFolder = this.currentFolder === folder;
      this.currentFolder = folder;
      this.searchQuery = '';
      this.clearSelection();
      this.sidebarOpen = false;
      if (folder !== 'root') {
        // Always expand the target folder and all parents on navigation
        const parts = folder.split('/');
        let path = '';
        for (let i = 0; i < parts.length; i++) {
          path = path ? path + '/' + parts[i] : parts[i];
          this.expandedFolders[path] = true;
        }
        this._expandVer++;
      }
      if (!wasOnSameFolder) this.fetchFiles();
    },

    toggleSort(field) {
      if (this.sortBy === field) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
      else { this.sortBy = field; this.sortDir = field === 'name' ? 'asc' : 'desc'; }
    },

    selectFile(id, event) {
      if (event.shiftKey && this.selectedFiles.size > 0) {
        const ids = this.filteredFiles.map(f => f.id);
        const lastSelected = [...this.selectedFiles].pop();
        const from = ids.indexOf(lastSelected);
        const to = ids.indexOf(id);
        const [start, end] = from < to ? [from, to] : [to, from];
        for (let i = start; i <= end; i++) this.selectedFiles.add(ids[i]);
        this.selectedFiles = new Set(this.selectedFiles);
      } else {
        this.toggleSelect(id);
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
          const fullName = this.currentFolder === 'root' ? name : this.currentFolder + '/' + name;
          if (!this.folders.find(f => f.name === fullName)) {
            const parentFolder = this.currentFolder !== 'root' ? this.folders.find(f => f.name === this.currentFolder) : null;
            const inherited = parentFolder ? (parentFolder.shared || parentFolder.directlyShared) && !parentFolder.excluded : false;
            this.folders = [...this.folders, { name: fullName, shared: inherited, directlyShared: false, excluded: false }];
          }
          this._folderShareHash = this.folders.map(f => f.name + (f.shared ? 1 : 0) + (f.directlyShared ? 1 : 0) + (f.excluded ? 1 : 0)).join('|');
          if (this.currentFolder !== 'root') {
            const parts = this.currentFolder.split('/');
            let path = '';
            for (const part of parts) {
              path = path ? path + '/' + part : part;
              this.expandedFolders[path] = true;
            }
          }
          this._expandVer++;
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

    async shareFolderLink(folder) {
      this.folderCtxMenu.show = false;
      if (!folder) return;
      this.folderShareLinkModal = { show: true, folder: folder.name, token: null, password: '', expiresInDays: 0, hasPassword: false, expiresAt: null };
      try {
        var res = await this.apiFetch('/api/folder-share-link/' + encodeURIComponent(folder.name));
        if (res && res.ok) {
          var data = await res.json();
          if (data.token) {
            this.folderShareLinkModal.token = data.token;
            this.folderShareLinkModal.hasPassword = data.hasPassword;
            this.folderShareLinkModal.expiresAt = data.expiresAt;
          }
        }
      } catch { /* use defaults */ }
    },

    async createFolderShareLink() {
      var { folder, password, expiresInDays } = this.folderShareLinkModal;
      try {
        var body = { folder };
        if (password) body.password = password;
        if (expiresInDays > 0) body.expiresInDays = expiresInDays;
        var res = await this.apiFetch('/api/folder-share-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res && res.ok) {
          var data = await res.json();
          this.folderShareLinkModal.token = data.token;
          this.folderShareLinkModal.hasPassword = data.hasPassword;
          this.folderShareLinkModal.expiresAt = data.expiresAt;
          this.showToast('Folder share link created', 'success');
          this.copyShareLink(data.token);
        } else { this.showToast('Failed to create folder share link', 'error'); }
      } catch { this.showToast('Failed to create folder share link', 'error'); }
    },

    async revokeFolderShareLink(folder) {
      try {
        var res = await this.apiFetch('/api/folder-share-link/' + encodeURIComponent(folder), { method: 'DELETE' });
        if (res && res.ok) {
          this.folderShareLinkModal.show = false;
          this.showToast('Folder share link revoked', 'success');
        } else { this.showToast('Failed to revoke folder share link', 'error'); }
      } catch { this.showToast('Failed to revoke folder share link', 'error'); }
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

    async previewFile(file) {
      if (file.type.startsWith('image/')) {
        this.openLightbox(file);
        return;
      }

      this.previewModal = { show: true, file, content: '', loading: true };
      const previewUrl = '/api/files/' + file.id + '/preview';

      try {
        if (file.type.startsWith('video/')) {
          this.previewModal.content = '<video controls autoplay class="preview-media"><source src="' + previewUrl + '" type="' + this._escAttr(file.type) + '">Your browser does not support video.</video>';
          this.previewModal.loading = false;
        } else if (file.type.startsWith('audio/')) {
          this.previewModal.content = '<div class="preview-audio-wrap"><span class="text-6xl mb-4">\uD83C\uDFB5</span><audio controls autoplay class="w-full"><source src="' + previewUrl + '" type="' + this._escAttr(file.type) + '"></audio></div>';
          this.previewModal.loading = false;
        } else if (file.type === 'application/pdf') {
          this.previewModal.content = '<iframe src="' + previewUrl + '" class="preview-iframe"></iframe>';
          this.previewModal.loading = false;
        } else if (file.type.startsWith('text/') || file.type.includes('javascript') || file.type.includes('json') || file.type.includes('xml') ||
                   file.name.match(/\.(js|ts|py|rb|go|rs|java|c|cpp|h|sh|yaml|yml|json|toml|md|html|css|sql|swift|kt|php|lua|tsx|jsx)$/i)) {
          const res = await this.apiFetch(previewUrl);
          if (!res) return;
          const text = await res.text();

          if (file.name.endsWith('.md')) {
            this.previewModal.content = '<div class="preview-markdown">' + (typeof marked !== 'undefined' ? marked.parse(text) : '<pre>' + this._escHtml(text) + '</pre>') + '</div>';
          } else {
            const ext = file.name.split('.').pop().toLowerCase();
            const langMap = {js:'javascript',ts:'typescript',py:'python',rb:'ruby',rs:'rust',sh:'bash',yml:'yaml',md:'markdown',jsx:'jsx',tsx:'tsx'};
            const lang = langMap[ext] || ext;
            let highlighted = this._escHtml(text);
            if (typeof Prism !== 'undefined' && Prism.languages[lang]) {
              highlighted = Prism.highlight(text, Prism.languages[lang], lang);
            }
            this.previewModal.content = '<pre class="preview-code"><code class="language-' + lang + '">' + highlighted + '</code></pre>';
          }
          this.previewModal.loading = false;
        } else {
          this.previewModal.content = '<div class="preview-unsupported"><span class="text-5xl mb-3">' + this.getFileIcon(file.type, file.name) + '</span><p class="text-sm" style="color:var(--text-secondary)">Preview not available for this file type</p></div>';
          this.previewModal.loading = false;
        }
      } catch (e) {
        this.previewModal.content = '<div class="preview-unsupported"><p class="text-sm" style="color:var(--danger)">Failed to load preview</p></div>';
        this.previewModal.loading = false;
      }
    },

    openLightbox(file) {
      const images = this.filteredFiles.filter(f => f.type.startsWith('image/'));
      const idx = images.findIndex(f => f.id === file.id);
      this.lightbox = { show: true, images, currentIndex: idx >= 0 ? idx : 0 };
    },

    lightboxPrev() {
      if (this.lightbox.images.length === 0) return;
      this.lightbox.currentIndex = (this.lightbox.currentIndex - 1 + this.lightbox.images.length) % this.lightbox.images.length;
    },

    lightboxNext() {
      if (this.lightbox.images.length === 0) return;
      this.lightbox.currentIndex = (this.lightbox.currentIndex + 1) % this.lightbox.images.length;
    },

    async downloadZip() {
      const ids = [...this.selectedFiles];
      if (ids.length === 0) return;
      try {
        const res = await this.apiFetch('/api/files/zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });
        if (!res || !res.ok) { this.showToast('Failed to download zip', 'error'); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'cloudvault-' + new Date().toISOString().slice(0, 10) + '.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.showToast('Zip downloaded', 'success');
      } catch { this.showToast('Failed to download zip', 'error'); }
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
          this.settingsModal.siteName = data.siteName || 'CloudVault';
          this.settingsModal.siteIconUrl = data.siteIconUrl || '';
          this.settingsModal._iconError = false;
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
            siteName: this.settingsModal.siteName,
            siteIconUrl: this.settingsModal.siteIconUrl,
          }),
        });
        if (res && res.ok) {
          this._branding.siteName = this.settingsModal.siteName || 'CloudVault';
          this._branding.siteIconUrl = this.settingsModal.siteIconUrl || '';
          document.title = this._branding.siteName;
          var fi = document.querySelector('link[rel="icon"]');
          if (this._branding.siteIconUrl) { if (!fi) { fi = document.createElement('link'); fi.rel = 'icon'; document.head.appendChild(fi); } fi.href = this._branding.siteIconUrl; }
          else if (fi) { fi.remove(); }
          this.settingsModal.show = false;
          this.showToast('Settings saved', 'success');
        } else { this.showToast('Failed to save settings', 'error'); }
      } catch { this.showToast('Failed to save settings', 'error'); }
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
      if (e.key === 'ArrowLeft' && this.lightbox.show) { e.preventDefault(); this.lightboxPrev(); }
      if (e.key === 'ArrowRight' && this.lightbox.show) { e.preventDefault(); this.lightboxNext(); }
      if (e.key === 'Escape') {
        this.clearSelection();
        this.ctxMenu.show = false;
        this.folderCtxMenu.show = false;
        this.shareModal.show = false;
        this.renameModal.show = false;
        this.deleteModal.show = false;
        this.moveModal.show = false;
        this.showNewFolderModal = false;
        this.previewModal.show = false;
        this.lightbox.show = false;
        this.renameFolderModal.show = false;
        this.deleteFolderModal.show = false;
        this.folderShareLinkModal.show = false;
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

    getFileCategory(type, name) {
      if (!type) return 'other';
      if (type.startsWith('image/')) return 'images';
      if (type.startsWith('video/')) return 'videos';
      if (type.startsWith('audio/')) return 'audio';
      if (type === 'application/pdf' || type.includes('document') || type.includes('spreadsheet') ||
          name?.match(/\.(doc|docx|xls|xlsx|ppt|pptx|csv)$/i)) return 'documents';
      if (type.includes('zip') || type.includes('tar') || type.includes('gzip') || type.includes('rar') ||
          name?.match(/\.(zip|tar|gz|rar|7z)$/i)) return 'archives';
      if (type.startsWith('text/') || type.includes('javascript') || type.includes('json') || type.includes('xml') ||
          name?.match(/\.(js|ts|py|rb|go|rs|java|c|cpp|h|sh|yaml|yml|json|toml|md|html|css|sql|swift|kt|php|lua|tsx|jsx)$/i)) return 'code';
      return 'other';
    },

    getFileIcon(type, name) {
      if (!type) return '\uD83D\uDCC4';
      const n = (name || '').toLowerCase();
      if (type.startsWith('image/')) return '\uD83D\uDDBC\uFE0F';
      if (type.startsWith('video/')) return '\uD83C\uDFAC';
      if (type.startsWith('audio/')) return '\uD83C\uDFB5';
      if (type === 'application/pdf') return '\uD83D\uDCC4';
      if (type.includes('zip') || type.includes('tar') || type.includes('gzip') || type.includes('rar') ||
          type.includes('x-7z') || n.match(/\.(zip|tar|gz|rar|7z|bz2|xz|tgz)$/)) return '\uD83D\uDCE6';
      if (n.match(/\.(apk|aab)$/)) return '\uD83E\uDD16';
      if (n.match(/\.(ipa)$/)) return '\uD83D\uDCF1';
      if (n.match(/\.(exe|msi|dmg|pkg|deb|rpm|appimage)$/)) return '\uD83D\uDCBF';
      if (n.match(/\.(iso|img)$/)) return '\uD83D\uDCBF';
      if (n.match(/\.(ttf|otf|woff|woff2|eot)$/)) return '\uD83D\uDD24';
      if (n.match(/\.(svg)$/)) return '\uD83C\uDFA8';
      if (n.match(/\.(torrent)$/)) return '\uD83E\uDDF2';
      if (n.match(/\.(db|sqlite|sqlite3|mdb)$/)) return '\uD83D\uDDC4\uFE0F';
      if (n.match(/\.(key|pem|cer|crt|p12|pfx)$/)) return '\uD83D\uDD10';
      if (type.includes('spreadsheet') || n.match(/\.(csv|xls|xlsx)$/)) return '\uD83D\uDCCA';
      if (type.includes('presentation') || n.match(/\.(ppt|pptx|key)$/)) return '\uD83D\uDCCA';
      if (type.includes('document') || n.match(/\.(doc|docx|odt|rtf)$/)) return '\uD83D\uDCC3';
      if (type.startsWith('text/') || type.includes('javascript') || type.includes('json') || type.includes('xml') ||
          n.match(/\.(js|ts|py|rb|go|rs|java|c|cpp|h|sh|yaml|yml|json|toml|md|html|css|sql|swift|kt|php|lua|tsx|jsx|vue|svelte|zig|nim|dart|r|m|mm|scala|clj|ex|exs|hs|erl|ps1|bat|cmd)$/)) return '\uD83D\uDCDD';
      return '\uD83D\uDCC4';
    },
  };
}
