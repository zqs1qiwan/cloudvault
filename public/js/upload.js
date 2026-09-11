window.UploadManager = {
  queue: [],
  active: 0,
  maxConcurrent: 3,
  chunkSize: 5 * 1024 * 1024,

  addFiles(files, folder) {
    for (const file of files) {
      this.queue.push({ id: crypto.randomUUID(), file, folder, status: 'pending', progress: 0 });
    }
    this.processQueue();
  },

  clearCompleted() {
    this.queue = this.queue.filter(q => q.status === 'pending' || q.status === 'uploading');
    window.dispatchEvent(new CustomEvent('upload-progress'));
  },

  fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
  },

  processQueue() {
    while (this.active < this.maxConcurrent) {
      const item = this.queue.find(q => q.status === 'pending');
      if (!item) break;
      item.status = 'uploading';
      this.active++;
      this.uploadFile(item).finally(() => {
        this.active--;
        this.processQueue();
      });
    }
  },

  async uploadFile(item) {
    const { file, folder } = item;
    try {
      if (file.size < 10 * 1024 * 1024) {
        await this.directUpload(item);
      } else {
        await this.multipartUpload(item);
      }
      item.status = 'done';
      item.progress = 100;
      window.dispatchEvent(new CustomEvent('upload-complete', { detail: { name: file.name } }));
    } catch (err) {
      item.status = 'error';
      window.dispatchEvent(new CustomEvent('upload-error', { detail: { name: file.name, error: err.message } }));
    }
  },

  directUpload(item) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/files/upload');
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(item.file.name));
      xhr.setRequestHeader('X-Folder', encodeURIComponent(item.folder || 'root'));
      xhr.setRequestHeader('Content-Type', item.file.type || 'application/octet-stream');
      xhr.withCredentials = true;

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          item.progress = Math.round((e.loaded / e.total) * 100);
          window.dispatchEvent(new CustomEvent('upload-progress'));
        }
      };

      xhr.onload = () => {
        if (xhr.status === 401) { window.location.href = '/login'; reject(new Error('Session expired')); return; }
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch { reject(new Error('Invalid upload response')); }
        } else reject(new Error(xhr.responseText || 'Upload failed'));
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.timeout = 10 * 60 * 1000;
      xhr.ontimeout = () => reject(new Error('Upload timed out'));
      xhr.send(item.file);
    });
  },

  async multipartUpload(item) {
    const { file, folder } = item;
    const totalParts = Math.ceil(file.size / this.chunkSize);
    let session = null;
    try {
      const createRes = await this.fetchWithTimeout('/api/files/upload?action=mpu-create', {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'X-File-Name': encodeURIComponent(file.name),
          'X-Folder': encodeURIComponent(folder || 'root'),
          'Content-Type': file.type || 'application/octet-stream',
        },
        credentials: 'same-origin',
      }, 30000);
      if (createRes.status === 401) { window.location.href = '/login'; throw new Error('Session expired'); }
      if (!createRes.ok) throw new Error('Failed to create multipart upload');
      const { uploadId, key } = await createRes.json();
      session = { uploadId, key };
      item.multipart = session;

      const parts = [];
      for (let i = 0; i < totalParts; i++) {
        const start = i * this.chunkSize;
        const end = Math.min(start + this.chunkSize, file.size);
        const chunk = file.slice(start, end);

        const partUrl = `/api/files/upload?action=mpu-upload&uploadId=${encodeURIComponent(uploadId)}&partNumber=${i + 1}&key=${encodeURIComponent(key)}`;
        let partRes = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            partRes = await this.fetchWithTimeout(
              partUrl,
              { method: 'PUT', body: chunk, credentials: 'same-origin', redirect: 'manual' },
              5 * 60 * 1000
            );
            if (partRes.ok) break;
          } catch {
            if (attempt === 3) throw new Error(`Part ${i + 1} timed out`);
          }
          if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 750));
        }
        if (!partRes?.ok) throw new Error(`Failed to upload part ${i + 1}`);
        const partData = await partRes.json();
        parts.push({ partNumber: i + 1, etag: partData.etag });

        item.progress = Math.round(((i + 1) / totalParts) * 100);
        window.dispatchEvent(new CustomEvent('upload-progress'));
      }

      const completeRes = await this.fetchWithTimeout('/api/files/upload?action=mpu-complete', {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId, key, parts }),
        credentials: 'same-origin',
      }, 60000);
      const contentType = completeRes.headers.get('Content-Type') || '';
      if (!completeRes.ok || completeRes.redirected || !contentType.includes('application/json')) {
        throw new Error('Failed to complete multipart upload');
      }
      const completed = await completeRes.json();
      if (completed.key !== key || !completed.id) throw new Error('Invalid completion response');
      item.multipart = null;
    } catch (error) {
      if (session) {
        try {
          await this.abortMultipart(session);
          item.multipart = null;
        } catch { /* Retain the session so pagehide can retry; lifecycle remains the final fallback. */ }
      }
      throw error;
    }
  },

  async abortMultipart(session, keepalive = false) {
    const attempts = keepalive ? 1 : 2;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetch('/api/files/upload?action=mpu-abort', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(session),
          credentials: 'same-origin',
          redirect: 'manual',
          keepalive,
        });
        if (response.ok && !response.redirected) return response;
      } catch {
        if (attempt === attempts) throw new Error('Failed to abort multipart upload');
      }
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Failed to abort multipart upload');
  },
};

window.addEventListener('pagehide', () => {
  for (const item of window.UploadManager.queue) {
    if (item.multipart) window.UploadManager.abortMultipart(item.multipart, true).catch(() => {});
  }
});

async function readDroppedEntries(dataTransfer) {
  const files = [];
  const items = dataTransfer.items;

  if (items && items[0] && items[0].webkitGetAsEntry) {
    const entries = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    for (const entry of entries) {
      await readEntry(entry, '', files);
    }
  } else {
    for (const file of dataTransfer.files) {
      files.push({ file, relativePath: '' });
    }
  }
  return files;
}

function readEntry(entry, path, files) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((file) => {
        files.push({ file, relativePath: path });
        resolve();
      });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readBatch = () => reader.readEntries(async (entries) => {
        if (entries.length === 0) { resolve(); return; }
        for (const e of entries) {
          await readEntry(e, path ? path + '/' + entry.name : entry.name, files);
        }
        readBatch();
      });
      readBatch();
    } else {
      resolve();
    }
  });
}

window.readDroppedEntries = readDroppedEntries;
