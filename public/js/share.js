(function () {
  const dataEl = document.getElementById('file-data');
  let fileData;
  try {
    fileData = JSON.parse(dataEl?.textContent || '{}');
  } catch {
    fileData = {};
  }

  if (fileData.needsPassword) {
    showPasswordGate();
    return;
  }

  if (fileData.error) {
    showError(fileData.error);
    return;
  }

  if (!fileData.name) {
    showError('This share link may have expired or been revoked.');
    return;
  }

  showFile(fileData);

  function showPasswordGate() {
    document.getElementById('password-gate').classList.remove('hidden');
    const form = document.getElementById('password-form');
    form.action = window.location.pathname + '/verify';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new URLSearchParams(new FormData(form));
      try {
        const res = await fetch(form.action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData,
          credentials: 'same-origin',
          redirect: 'follow',
        });
        if (res.redirected) {
          window.location.href = res.url;
        } else if (res.ok) {
          window.location.reload();
        } else {
          const err = document.getElementById('password-error');
          err.textContent = 'Incorrect password';
          err.classList.remove('hidden');
        }
      } catch {
        const err = document.getElementById('password-error');
        err.textContent = 'Connection error';
        err.classList.remove('hidden');
      }
    });
  }

  function showError(msg) {
    document.getElementById('error-view').classList.remove('hidden');
    document.getElementById('error-message').textContent = msg;
  }

  function showFile(file) {
    document.getElementById('file-view').classList.remove('hidden');
    document.getElementById('file-name').textContent = file.name;
    document.getElementById('file-size').textContent = formatBytes(file.size);
    document.getElementById('file-date').textContent = formatDate(file.uploadedAt);
    document.getElementById('file-downloads').textContent = (file.downloads || 0) + ' downloads';
    document.getElementById('file-icon').textContent = getFileIcon(file.type, file.name);
    document.title = file.name + ' — CloudVault';

    const token = window.location.pathname.split('/').pop();
    const downloadUrl = '/s/' + token + '/download';
    const previewUrl = '/s/' + token + '/preview';
    document.getElementById('download-btn').href = downloadUrl;

    setupPreview(file, previewUrl);
    setupCopyButton(token);
  }

  function setupPreview(file, previewUrl) {
    const container = document.getElementById('preview-area');
    const type = file.type || '';

    if (type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = previewUrl;
      img.alt = file.name;
      img.loading = 'lazy';
      container.appendChild(img);
    } else if (type.startsWith('video/')) {
      const video = document.createElement('video');
      video.src = previewUrl;
      video.controls = true;
      video.preload = 'metadata';
      container.appendChild(video);
    } else if (type.startsWith('audio/')) {
      container.style.padding = '40px';
      const audio = document.createElement('audio');
      audio.src = previewUrl;
      audio.controls = true;
      audio.style.width = '100%';
      container.appendChild(audio);
    } else if (type === 'application/pdf') {
      const iframe = document.createElement('iframe');
      iframe.src = previewUrl;
      container.appendChild(iframe);
    } else if (type.startsWith('text/') || isCodeFile(file.name)) {
      fetch(previewUrl)
        .then(r => r.text())
        .then(text => {
          const pre = document.createElement('pre');
          const code = document.createElement('code');
          code.textContent = text.slice(0, 100000);
          pre.appendChild(code);
          container.appendChild(pre);
        })
        .catch(() => showNoPreview(container, file));
    } else {
      showNoPreview(container, file);
    }
  }

  function showNoPreview(container, file) {
    container.style.padding = '60px 20px';
    container.style.flexDirection = 'column';
    container.innerHTML =
      '<div style="font-size:64px;margin-bottom:16px">' + getFileIcon(file.type, file.name) + '</div>' +
      '<p style="color:#6b7280;font-size:14px">Preview not available for this file type</p>';
  }

  function isCodeFile(name) {
    return /\.(js|ts|tsx|jsx|py|rb|go|rs|java|c|cpp|h|sh|bash|yaml|yml|toml|json|xml|sql|graphql|md|html|css|scss|less)$/i.test(name || '');
  }

  function setupCopyButton(token) {
    const btn = document.getElementById('copy-btn');
    const toast = document.getElementById('copy-toast');
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(window.location.origin + '/s/' + token).then(() => {
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
      });
    });
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function getFileIcon(type, name) {
    if (!type) return '\uD83D\uDCC4';
    if (type.startsWith('image/')) return '\uD83D\uDDBC\uFE0F';
    if (type.startsWith('video/')) return '\uD83C\uDFAC';
    if (type.startsWith('audio/')) return '\uD83C\uDFB5';
    if (type === 'application/pdf') return '\uD83D\uDCC4';
    if (type.includes('zip') || type.includes('tar')) return '\uD83D\uDCE6';
    if (type.startsWith('text/') || isCodeFile(name)) return '\uD83D\uDCDD';
    return '\uD83D\uDCC1';
  }
})();
