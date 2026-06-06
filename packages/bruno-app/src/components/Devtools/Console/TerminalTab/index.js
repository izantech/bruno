import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { IconTerminal2, IconPlus } from '@tabler/icons';
import { useTheme } from 'providers/Theme';
import StyledWrapper from './StyledWrapper';
import SessionList from './SessionList';
import '@xterm/xterm/css/xterm.css';
import { isElectron } from 'utils/common/platform';
import ipc from 'utils/common/ipc';

// Build xterm.js theme from app theme
const getTerminalTheme = (theme) => {
  return {
    background: theme.console.bg,
    foreground: theme.console.messageColor,
    cursor: theme.console.messageColor,
    selectionBackground: theme.status.info.background,
    black: theme.background.base,
    red: theme.status.danger.text,
    green: theme.status.success.text,
    yellow: theme.status.warning.text,
    blue: theme.status.info.text,
    magenta: theme.colors.text.purple,
    cyan: theme.codemirror.variable.prompt,
    white: theme.text,
    brightBlack: theme.colors.text.muted,
    brightRed: theme.status.danger.text,
    brightGreen: theme.status.success.text,
    brightYellow: theme.status.warning.text,
    brightBlue: theme.status.info.text,
    brightMagenta: theme.colors.text.purple,
    brightCyan: theme.codemirror.variable.prompt,
    brightWhite: theme.text
  };
};

// Terminal instances per session - Map<sessionId, { terminal, fitAddon, inputDisposable, resizeDisposable }>
const terminalInstances = new Map();

// Data listeners per session - Map<sessionId, { removeData, removeExit }>
const sessionListeners = new Map();

// Parking host for terminal DOM when view unmounts
let parkingHost = null;

// Export function to get current session ID (for backward compatibility)
export const getSessionId = () => {
  // Return the first active session ID if any
  if (terminalInstances.size > 0) {
    return Array.from(terminalInstances.keys())[0];
  }
  return null;
};

const ensureParkingHost = () => {
  if (parkingHost && document.body.contains(parkingHost)) return parkingHost;
  parkingHost = document.createElement('div');
  parkingHost.style.display = 'none';
  parkingHost.setAttribute('data-terminal-parking-host', 'true');
  document.body.appendChild(parkingHost);
  return parkingHost;
};

const createTerminalForSession = (sessionId, terminalTheme) => {
  if (terminalInstances.has(sessionId)) {
    return terminalInstances.get(sessionId);
  }

  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: terminalTheme,
    allowProposedApi: true
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  const inputDisposable = terminal.onData((data) => {
    if (data && sessionId && isElectron()) {
      ipc.send('terminal:input', sessionId, data);
    }
  });

  const resizeDisposable = terminal.onResize(({ cols, rows }) => {
    if (sessionId && isElectron()) {
      ipc.send('terminal:resize', sessionId, { cols, rows });
    }
  });

  const instance = {
    terminal,
    fitAddon,
    inputDisposable,
    resizeDisposable
  };

  terminalInstances.set(sessionId, instance);

  // Setup IPC listeners for this session
  if (isElectron() && !sessionListeners.has(sessionId)) {
    const onData = (data) => {
      if (!data) return;
      const inst = terminalInstances.get(sessionId);
      if (inst && inst.terminal) {
        try {
          inst.terminal.write(data);
        } catch (err) {
          console.warn('Failed to write terminal data:', err);
        }
      }
    };

    const onExit = ({ exitCode, signal } = {}) => {
      const msg = `\r\n[Process exited with code ${exitCode ?? ''} ${signal ? `(signal ${signal})` : ''}]\r\n`;
      const inst = terminalInstances.get(sessionId);
      if (inst && inst.terminal) {
        try {
          inst.terminal.write(msg);
        } catch (err) {
          console.warn('Failed to write terminal exit message:', err);
        }
      }
      // Cleanup on exit
      cleanupTerminalInstance(sessionId);
    };

    const removeData = ipc.on(`terminal:data:${sessionId}`, onData);
    const removeExit = ipc.on(`terminal:exit:${sessionId}`, onExit);

    sessionListeners.set(sessionId, { removeData, removeExit });
  }

  return instance;
};

const cleanupTerminalInstance = (sessionId) => {
  const instance = terminalInstances.get(sessionId);
  if (instance) {
    try {
      if (instance.inputDisposable) instance.inputDisposable.dispose();
      if (instance.resizeDisposable) instance.resizeDisposable.dispose();
      if (instance.terminal) {
        instance.terminal.dispose();
      }
    } catch (err) {
      console.warn('Error disposing terminal instance:', err);
    }
    terminalInstances.delete(sessionId);
  }

  // Remove IPC listeners
  const listeners = sessionListeners.get(sessionId);
  if (listeners && isElectron()) {
    try {
      listeners.removeData();
      listeners.removeExit();
    } catch (err) {
      console.warn('Error removing IPC listeners:', err);
    }
    sessionListeners.delete(sessionId);
  }
};

const openTerminalIntoContainer = async (container, sessionId, terminalTheme) => {
  if (!container || !sessionId) return;

  const instance = createTerminalForSession(sessionId, terminalTheme);
  const { terminal, fitAddon } = instance;

  if (!terminal.element) {
    terminal.open(container);
  } else {
    // Move terminal element to new container
    if (terminal.element.parentElement !== container) {
      container.appendChild(terminal.element);
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 50));
  try {
    fitAddon.fit();
    terminal.focus();
    const { cols, rows } = terminal;
    if (cols && rows && isElectron()) {
      ipc.send('terminal:resize', sessionId, { cols, rows });
    }
  } catch (e) {
    console.warn('Error fitting terminal:', e);
  }
};

let fitFrameRef;
const fitTerminal = (activeSessionId, container) => {
  if (!container) return;

  const instance = terminalInstances.get(activeSessionId);
  if (!instance?.fitAddon) return;

  if (fitFrameRef) {
    cancelAnimationFrame(fitFrameRef);
  }

  fitFrameRef = requestAnimationFrame(() => {
    fitFrameRef = null;

    // Avoid fitting when hidden/0-sized (common during tab switches/layout transitions)
    if (container.offsetWidth === 0 || container.offsetHeight === 0) return;

    try {
      instance.fitAddon.fit();
    } catch (e) {}
  });
};

const TerminalTab = () => {
  const terminalRef = useRef(null);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const { theme } = useTheme();
  const terminalTheme = getTerminalTheme(theme);

  // Load sessions list
  const loadSessions = useCallback(async (currentActiveSessionId = null) => {
    if (!isElectron()) return [];

    try {
      const sessionList = await ipc.invoke('terminal:list-sessions');
      setSessions(sessionList);

      // Use functional state updates to get the current activeSessionId
      setActiveSessionId((prevActiveSessionId) => {
        const activeId = currentActiveSessionId !== null ? currentActiveSessionId : prevActiveSessionId;

        // Auto-select first session if none selected
        if (!activeId && sessionList.length > 0) {
          return sessionList[0].sessionId;
        }

        // If active session no longer exists, select first available
        if (activeId && !sessionList.find((s) => s.sessionId === activeId)) {
          return sessionList.length > 0 ? sessionList[0].sessionId : null;
        }

        // Keep current selection if it still exists
        return activeId;
      });

      return sessionList;
    } catch (err) {
      console.error('Failed to load sessions:', err);
      return [];
    }
  }, []);

  // Create new terminal session
  const createNewSession = useCallback(
    async (cwd = null) => {
      if (!isElectron()) return null;

      try {
        const options = cwd ? { cwd } : {};
        const newSessionId = await ipc.invoke('terminal:create', options);
        if (newSessionId) {
          await loadSessions(newSessionId);
          setActiveSessionId(newSessionId);
          return newSessionId;
        }
      } catch (err) {
        console.error('Failed to create terminal session:', err);
      }
      return null;
    },
    [loadSessions]
  );

  // Listen for requests to open terminal at specific CWD
  useEffect(() => {
    const normalizePath = (path) => {
      if (!path) return '';
      // Normalize path separators and remove trailing separators for comparison
      return path.replace(/\\/g, '/').replace(/\/$/, '') || '/';
    };

    const handleOpenTerminalAtCwd = async (event) => {
      const { cwd } = event.detail;
      if (!cwd) return;

      const normalizedCwd = normalizePath(cwd);

      // Check if session already exists at this CWD
      const sessionList = await ipc.invoke('terminal:list-sessions');
      const existingSession = sessionList.find((s) => normalizePath(s.cwd) === normalizedCwd);

      if (existingSession) {
        // Switch to existing session
        await loadSessions(existingSession.sessionId);
        setActiveSessionId(existingSession.sessionId);
      } else {
        // Create new session at this CWD
        await createNewSession(cwd);
      }
    };

    window.addEventListener('terminal:open-at-cwd', handleOpenTerminalAtCwd);

    return () => {
      window.removeEventListener('terminal:open-at-cwd', handleOpenTerminalAtCwd);
    };
  }, [loadSessions, createNewSession]);

  // Close terminal session
  const closeSession = async (sessionId) => {
    if (!isElectron()) return;

    try {
      ipc.send('terminal:kill', sessionId);
      cleanupTerminalInstance(sessionId);

      // Load updated sessions (this will also handle active session switching)
      const updatedSessions = await loadSessions();

      // If we closed the active session and there are no sessions left, clear selection
      if (activeSessionId === sessionId && updatedSessions.length === 0) {
        setActiveSessionId(null);
      }
    } catch (err) {
      console.error('Failed to close terminal session:', err);
    }
  };

  // Load sessions on mount and set up polling
  useEffect(() => {
    if (!isElectron()) {
      setIsLoading(false);
      return;
    }

    let mounted = true;

    const initialLoad = async () => {
      const sessionList = await loadSessions();
      if (mounted) {
        setIsLoading(false);
      }
    };

    initialLoad();

    // Poll for session updates every 2 seconds
    // Note: We don't pass currentActiveSessionId here to avoid stale closures
    // The functional update inside loadSessions will use the current state
    const pollInterval = setInterval(() => {
      if (mounted) {
        loadSessions();
      }
    }, 2000);

    return () => {
      mounted = false;
      clearInterval(pollInterval);
    };
  }, []);

  // Update all terminal themes when app theme changes
  useEffect(() => {
    terminalInstances.forEach((instance) => {
      if (instance.terminal) {
        instance.terminal.options.theme = terminalTheme;
      }
    });
  }, [theme.mode]);

  // Handle terminal display for active session
  useEffect(() => {
    if (!activeSessionId || !terminalRef.current) return;

    let mounted = true;

    const setupTerminal = async () => {
      await openTerminalIntoContainer(terminalRef.current, activeSessionId, terminalTheme);

      if (mounted) {
        const instance = terminalInstances.get(activeSessionId);
        if (instance) {
          try {
            const { cols, rows } = instance.terminal;
            if (cols && rows && isElectron()) {
              ipc.send('terminal:resize', activeSessionId, { cols, rows });
            }
          } catch (err) {
            console.warn('Failed to perform initial resize:', err);
          }

          return () => {
            // Park terminal element when switching sessions
            if (instance.terminal && instance.terminal.element) {
              const host = ensureParkingHost();
              if (instance.terminal.element.parentElement !== host) {
                host.appendChild(instance.terminal.element);
              }
            }
          };
        }
      }
    };

    const cleanup = setupTerminal();

    return () => {
      mounted = false;
      Promise.resolve(cleanup).then((fn) => {
        if (typeof fn === 'function') fn();
      });
    };
  }, [activeSessionId]);

  const onSessionMount = useCallback(
    (node) => {
      if (!node) return;
      terminalRef.current = node;
      fitTerminal(activeSessionId, node);
      const ro = new ResizeObserver(() => fitTerminal(activeSessionId, node));
      ro.observe(node.parentNode);
      return () => ro.disconnect();
    },
    [activeSessionId]
  );

  return (
    <StyledWrapper>
      <div className="terminal-content">
        {/* Left Sidebar */}
        <div className="terminal-sessions-sidebar">
          <div className="terminal-sessions-header">
            <span>Sessions</span>
            <IconPlus
              size={16}
              style={{ cursor: 'pointer', color: '#888' }}
              onClick={(e) => {
                e.stopPropagation();
                createNewSession();
              }}
              title="New Terminal Session"
            />
          </div>
          <div className="terminal-sessions-list">
            {isLoading ? (
              <div style={{ padding: '12px', color: '#888', fontSize: '13px' }}>Loading sessions...</div>
            ) : sessions.length === 0 ? (
              <div style={{ padding: '12px', color: '#888', fontSize: '13px' }}>No active sessions</div>
            ) : (
              <SessionList
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSelectSession={setActiveSessionId}
                onCloseSession={closeSession}
              />
            )}
          </div>
        </div>

        {/* Right Terminal Display */}
        <div className="terminal-display-container">
          {!activeSessionId && isElectron() && (
            <div className="terminal-loading">
              <IconTerminal2 size={24} strokeWidth={1.5} />
              <span>No terminal session selected</span>
            </div>
          )}
          <div
            ref={onSessionMount}
            className="terminal-container"
            style={{
              height: '100%',
              width: '100%',
              display: activeSessionId ? 'block' : 'none'
            }}
          />
        </div>
      </div>
    </StyledWrapper>
  );
};

export default TerminalTab;
