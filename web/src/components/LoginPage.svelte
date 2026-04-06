<script lang="ts">
  let {
    isLocal = false,
    connectionState = 'disconnected',
    authError = '',
    isAuthenticating = false,
    onpasswordauth,
    onsshkeyauth,
    ontokenauth,
    onpairingauth,
    onretrylocal,
  }: {
    isLocal?: boolean;
    connectionState?: string;
    authError?: string;
    isAuthenticating?: boolean;
    onpasswordauth?: (detail: { username: string; password: string; rememberMe: boolean }) => void;
    onsshkeyauth?: (detail: { username: string; privateKeyPem: string; rememberMe: boolean }) => void;
    ontokenauth?: (detail: { token: string }) => void;
    onpairingauth?: (detail: { code: string }) => void;
    onretrylocal?: () => void;
  } = $props();

  // Tab state
  let activeTab: 'password' | 'sshkey' | 'token' | 'pairing' = $state('password');

  // Password form
  let username = $state('');
  let password = $state('');
  let rememberMe = $state(true);

  // SSH Key form
  let sshUsername = $state('');
  let sshKeyPem = $state('');
  let sshKeyFileName = $state('');

  // Token form
  let token = $state('');

  // Pairing form
  let pairingCode = $state('');

  function handlePasswordSubmit() {
    if (!username || !password) return;
    onpasswordauth?.({ username, password, rememberMe });
  }

  function handleSshKeySubmit() {
    if (!sshUsername || !sshKeyPem) return;
    onsshkeyauth?.({ username: sshUsername, privateKeyPem: sshKeyPem, rememberMe });
  }

  function handleTokenSubmit() {
    if (!token) return;
    ontokenauth?.({ token });
  }

  function handlePairingSubmit() {
    if (!pairingCode || pairingCode.length < 6) return;
    onpairingauth?.({ code: pairingCode });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      switch (activeTab) {
        case 'password': handlePasswordSubmit(); break;
        case 'sshkey': handleSshKeySubmit(); break;
        case 'token': handleTokenSubmit(); break;
        case 'pairing': handlePairingSubmit(); break;
      }
    }
  }

  async function handleFileUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) return;
    sshKeyFileName = file.name;
    sshKeyPem = await file.text();
  }
</script>

<div class="login-container">
  <h1>terminar</h1>

  {#if isLocal && connectionState === 'connecting'}
    <div class="status-row">
      <div class="spinner"></div>
      <p>Connecting to local server...</p>
    </div>
  {:else if isLocal && connectionState === 'disconnected'}
    <p class="error-text">Failed to connect to local server.</p>
    <button onclick={() => onretrylocal?.()} class="btn">
      Retry Connection
    </button>
  {:else if !isLocal}
    <div class="tabs">
      <button
        class="tab" class:active={activeTab === 'password'}
        onclick={() => activeTab = 'password'}>Password</button>
      <button
        class="tab" class:active={activeTab === 'sshkey'}
        onclick={() => activeTab = 'sshkey'}>SSH Key</button>
      <button
        class="tab" class:active={activeTab === 'token'}
        onclick={() => activeTab = 'token'}>Token</button>
      <button
        class="tab" class:active={activeTab === 'pairing'}
        onclick={() => activeTab = 'pairing'}>Pairing Code</button>
    </div>

    <div class="tab-content">
      {#if activeTab === 'password'}
        <div class="form-group">
          <label for="username">Username</label>
          <input
            id="username"
            type="text"
            placeholder="OS username"
            bind:value={username}
            onkeydown={handleKeydown}
            class="input"
            disabled={isAuthenticating}
          />
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input
            id="password"
            type="password"
            placeholder="Password"
            bind:value={password}
            onkeydown={handleKeydown}
            class="input"
            disabled={isAuthenticating}
          />
        </div>
        <label class="checkbox-row">
          <input type="checkbox" bind:checked={rememberMe} />
          <span>Remember me</span>
        </label>
        <button onclick={handlePasswordSubmit} class="btn" disabled={isAuthenticating || !username || !password}>
          {isAuthenticating ? 'Authenticating...' : 'Sign In'}
        </button>

      {:else if activeTab === 'sshkey'}
        <div class="form-group">
          <label for="ssh-username">Username</label>
          <input
            id="ssh-username"
            type="text"
            placeholder="OS username"
            bind:value={sshUsername}
            onkeydown={handleKeydown}
            class="input"
            disabled={isAuthenticating}
          />
        </div>
        <div class="form-group">
          <label>Private Key</label>
          <div class="file-upload">
            <label class="btn-secondary file-label">
              {sshKeyFileName || 'Choose key file...'}
              <input type="file" accept=".pem,.key,id_*" onchange={handleFileUpload} style="display:none" />
            </label>
          </div>
          <span class="hint">Or paste your private key below:</span>
          <textarea
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
            bind:value={sshKeyPem}
            class="input textarea"
            rows="6"
            disabled={isAuthenticating}
          ></textarea>
        </div>
        <label class="checkbox-row">
          <input type="checkbox" bind:checked={rememberMe} />
          <span>Remember me</span>
        </label>
        <button onclick={handleSshKeySubmit} class="btn" disabled={isAuthenticating || !sshUsername || !sshKeyPem}>
          {isAuthenticating ? 'Authenticating...' : 'Sign In with SSH Key'}
        </button>

      {:else if activeTab === 'token'}
        <p class="description">Enter the Server API Key (UUID token):</p>
        <input
          type="text"
          placeholder="UUID Token or JWT"
          bind:value={token}
          onkeydown={handleKeydown}
          class="input"
          disabled={isAuthenticating}
        />
        <button onclick={handleTokenSubmit} class="btn" disabled={isAuthenticating || !token}>
          {isAuthenticating ? 'Connecting...' : 'Connect'}
        </button>

      {:else if activeTab === 'pairing'}
        <p class="description">Enter the pairing code from the terminal:</p>
        <input
          type="text"
          placeholder="Enter 8-digit code"
          bind:value={pairingCode}
          onkeydown={handleKeydown}
          maxlength="8"
          class="input pairing-input"
          disabled={isAuthenticating}
        />
        <button onclick={handlePairingSubmit} class="btn" disabled={isAuthenticating || pairingCode.length < 6}>
          {isAuthenticating ? 'Verifying...' : 'Submit'}
        </button>
        <div class="pairing-instructions">
          <p><strong>How to get a pairing code:</strong></p>
          <ol>
            <li>Open the VS Code extension or terminal</li>
            <li>Run the "Request Pairing Code" command</li>
            <li>Enter the code shown above</li>
          </ol>
          <p class="hint">Code expires in 5 minutes</p>
        </div>
      {/if}
    </div>

    {#if authError}
      <p class="error-text">{authError}</p>
    {/if}
  {/if}
</div>

<style>
  .login-container {
    zoom: var(--controls-zoom, 1);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 40px;
    background: var(--ui-bg-primary, #0d0e10);
    color: var(--ui-text-primary, #e0e0e0);
  }

  h1 {
    font-size: 24px;
    margin-bottom: 24px;
    color: var(--ui-text-primary, #fdfbfe);
  }

  .tabs {
    display: flex;
    gap: 0;
    margin-bottom: 24px;
    border-bottom: 1px solid var(--ui-border, #444);
    width: 100%;
    max-width: 400px;
  }

  .tab {
    flex: 1;
    padding: 10px 16px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--ui-text-muted, #757578);
    cursor: pointer;
    font-size: 14px;
    transition: color 0.2s, border-color 0.2s;
  }

  .tab:hover {
    color: var(--ui-text-primary, #fdfbfe);
  }

  .tab.active {
    color: #4fc3f7;
    border-bottom-color: #4fc3f7;
  }

  .tab-content {
    width: 100%;
    max-width: 400px;
  }

  .form-group {
    margin-bottom: 16px;
    width: 100%;
  }

  .form-group label {
    display: block;
    margin-bottom: 6px;
    font-size: 13px;
    color: var(--ui-text-secondary, #aaa);
  }

  .input {
    width: 100%;
    padding: 10px 12px;
    background: var(--ui-bg-secondary, #181a1c);
    border: 1px solid var(--ui-border, #444);
    color: var(--ui-text-primary, #e0e0e0);
    border-radius: 4px;
    font-size: 14px;
    box-sizing: border-box;
  }

  .input:focus {
    outline: none;
    border-color: #4fc3f7;
  }

  .textarea {
    font-family: monospace;
    resize: vertical;
  }

  .btn {
    width: 100%;
    max-width: 400px;
    padding: 10px;
    background: #4fc3f7;
    color: #000;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    margin-top: 8px;
  }

  .btn:hover:not(:disabled) {
    background: #81d4fa;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: transparent;
    color: #4fc3f7;
    border: 1px solid #4fc3f7;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
  }

  .btn-secondary:hover {
    background: rgba(79, 195, 247, 0.1);
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 12px 0;
    font-size: 13px;
    color: var(--ui-text-secondary, #aaa);
    cursor: pointer;
  }

  .error-text {
    color: var(--ui-destructive, #ff6b6b);
    margin-top: 12px;
    font-size: 13px;
  }

  .description {
    color: var(--ui-text-secondary, #aaa);
    margin-bottom: 12px;
    font-size: 13px;
  }

  .hint {
    color: var(--ui-text-muted, #666);
    font-size: 12px;
    margin-top: 4px;
    display: block;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--ui-border, #444);
    border-top-color: #4fc3f7;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .file-upload {
    margin-bottom: 8px;
  }

  .file-label {
    display: inline-block;
  }

  .pairing-input {
    text-align: center;
    font-size: 24px;
    letter-spacing: 4px;
  }

  .pairing-instructions {
    margin-top: 20px;
    padding: 16px;
    background: var(--ui-bg-secondary, #181a1c);
    border-radius: 4px;
    font-size: 13px;
  }

  .pairing-instructions ol {
    padding-left: 20px;
    margin: 8px 0;
  }
</style>
