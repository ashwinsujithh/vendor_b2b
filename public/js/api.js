/* Fetch helper with JWT auth + uniform error handling */
const API = {
  token: localStorage.getItem('token') || '',

  async request(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    if (res.status === 401 && !path.startsWith('/api/auth/login')) {
      localStorage.removeItem('token');
      // Keep the server's reason (e.g. "signed in on another device") so the
      // login page can show why the session ended.
      try { if (json && json.message) localStorage.setItem('session_message', json.message); } catch { /* storage unavailable */ }
      location.href = '/';
    }
    if (!res.ok) {
      const message = (json && json.message) || `Request failed (${res.status})`;
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return json.data;
  },

  get: function (p) { return this.request(p); },
  post: function (p, b) { return this.request(p, { method: 'POST', body: b }); },
  put: function (p, b) { return this.request(p, { method: 'PUT', body: b }); },
  del: function (p) { return this.request(p, { method: 'DELETE' }); },

  /** Multipart POST with arbitrary FormData fields + files (field name per key). */
  postForm: function (p, formData) {
    const headers = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return fetch(p, { method: 'POST', headers, body: formData }).then(async (res) => {
      let json = null;
      try { json = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok) throw new Error((json && json.message) || `Request failed (${res.status})`);
      return json.data;
    });
  },

  /** Multipart upload (e.g. product images). files: FileList or File[]. */
  upload: function (p, files, field = 'images') {
    const fd = new FormData();
    for (const file of files) fd.append(field, file);
    const headers = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return fetch(p, { method: 'POST', headers, body: fd }).then(async (res) => {
      let json = null;
      try { json = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok) throw new Error((json && json.message) || `Upload failed (${res.status})`);
      return json.data;
    });
  },
};
